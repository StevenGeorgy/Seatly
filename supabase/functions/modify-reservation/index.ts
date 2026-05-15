import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { closureUnavailableMessage, findClosedSpecialDayForDate } from "../_shared/closures.ts";
import { localDayOfWeek, localToUTC } from "../_shared/time.ts";
import {
  formatReservationDate,
  sendReservationNotification,
} from "../_shared/reservation-notifications.ts";
import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { sendNotifyMeSms, type FulfilledAlertRow } from "../_shared/notify-me-sms.ts";
import { refundPaymentIntent } from "../_shared/stripe-refund.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RequestBody = {
  reservation_id?: unknown;
  reservationId?: unknown;
  date?: unknown;
  time?: unknown;
  party_size?: unknown;
  partySize?: unknown;
  special_request?: unknown;
  specialRequest?: unknown;
  confirmation_code?: unknown;
  confirmationCode?: unknown;
};

type ReservationRow = {
  id: string;
  restaurant_id: string;
  guest_id: string;
  user_profile_id: string | null;
  reserved_at: string;
  party_size: number;
  status: string | null;
  special_request: string | null;
  internal_notes: string | null;
  confirmation_code: string | null;
  guest_full_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  // Event/promo linkage — needed so the modification SMS body can include
  // the event name / promotion title + code that the diner originally booked.
  event_id: string | null;
  promotion_id: string | null;
  applied_promo_code: string | null;
};

type GuestRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

type RestaurantSettings = {
  turnTimeMinutes?: number | null;
};

type RestaurantRow = {
  name: string | null;
  timezone: string | null;
  hours_json: unknown;
  settings_json: RestaurantSettings | null;
  stripe_account_id: string | null;
  currency: string | null;
};

type ShiftRow = {
  id: string;
  start_time: string | null;
  end_time: string | null;
  turn_time_minutes: number | null;
  max_covers: number | null;
};

type ExistingReservationRow = {
  id: string;
  shift_id: string | null;
  reserved_at: string;
  party_size: number | null;
  duration_minutes: number | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseTimeToMinutes(value: string): number | null {
  const trimmed = value.trim();
  const meridiem = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (meridiem) {
    let hours = Number(meridiem[1]);
    const minutes = Number(meridiem[2] ?? 0);
    const period = meridiem[3].toLowerCase();
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (period === "pm" && hours !== 12) hours += 12;
    if (period === "am" && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  const [hourPart, minutePart] = trimmed.split(":");
  const hours = Number(hourPart);
  const minutes = Number(minutePart ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function shiftContainsMinute(shift: ShiftRow, minute: number): boolean {
  const start = parseTimeToMinutes(shift.start_time ?? "17:00");
  const end = parseTimeToMinutes(shift.end_time ?? "23:00");
  if (start == null || end == null) return false;
  if (end > start) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const reservationId = cleanString(body.reservation_id ?? body.reservationId);
    const providedCode = cleanString(body.confirmation_code ?? body.confirmationCode);
    const date = cleanString(body.date);
    const time = cleanString(body.time);
    const partySize = Math.max(1, Math.floor(Number(body.party_size ?? body.partySize)));
    const specialRequest = cleanString(body.special_request ?? body.specialRequest);

    if (!reservationId) return json({ error: "reservation_id is required" }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Valid date is required" }, 400);
    if (!time || parseTimeToMinutes(time) == null) return json({ error: "Valid time is required" }, 400);
    if (!Number.isFinite(partySize) || partySize < 1) return json({ error: "Valid party size is required" }, 400);

    const { data: reservation, error: reservationError } = await adminClient
      .from("reservations")
      .select("id, restaurant_id, guest_id, user_profile_id, reserved_at, party_size, status, special_request, internal_notes, confirmation_code, guest_full_name, guest_email, guest_phone, event_id, promotion_id, applied_promo_code")
      .eq("id", reservationId)
      .maybeSingle<ReservationRow>();
    if (reservationError) return json({ error: reservationError.message }, 400);
    if (!reservation) return json({ error: "Reservation not found" }, 404);

    let guest: GuestRow | null = null;
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (bearerToken) {
      const {
        data: { user },
        error: userError,
      } = await adminClient.auth.getUser(bearerToken);
      if (userError || !user) return json({ error: "Invalid or expired session" }, 401);

      const { data: profile, error: profileError } = await adminClient
        .from("user_profiles")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (profileError) return json({ error: profileError.message }, 400);
      if (!profile) return json({ error: "User profile not found" }, 403);

      const { data: ownedGuest, error: guestError } = await adminClient
        .from("guests")
        .select("id, full_name, email, phone")
        .eq("id", reservation.guest_id)
        .eq("user_profile_id", profile.id)
        .maybeSingle<GuestRow>();
      if (guestError) return json({ error: guestError.message }, 400);
      if (!ownedGuest) return json({ error: "You can only modify your own reservations" }, 403);
      guest = ownedGuest;
    } else if (providedCode) {
      const expectedCode = (reservation.confirmation_code ?? "").trim();
      if (!expectedCode || expectedCode.toLowerCase() !== providedCode.toLowerCase()) {
        return json({ error: "Invalid confirmation code" }, 401);
      }
      const { data: linkedGuest } = await adminClient
        .from("guests")
        .select("id, full_name, email, phone")
        .eq("id", reservation.guest_id)
        .maybeSingle<GuestRow>();
      guest = linkedGuest;
    } else {
      return json({ error: "Authentication required" }, 401);
    }

    if (!["pending", "confirmed"].includes(reservation.status ?? "pending")) {
      return json({ error: "Only upcoming reservations can be modified" }, 400);
    }
    if (new Date(reservation.reserved_at).getTime() < Date.now()) {
      return json({ error: "Past reservations cannot be modified" }, 400);
    }

    try {
      await enforceRateLimit(
        adminClient,
        "modify",
        rateLimitIdentifier(req, reservation.user_profile_id ?? null),
        { limit: 15, windowSeconds: 60 },
      );
    } catch (e) {
      if (e instanceof RateLimitError) {
        return json({ error: e.message, unavailable_reason: "rate_limited" }, 429);
      }
      throw e;
    }

    const { data: restaurant, error: restaurantError } = await adminClient
      .from("restaurants")
      .select("name, timezone, hours_json, settings_json, stripe_account_id, currency")
      .eq("id", reservation.restaurant_id)
      .maybeSingle<RestaurantRow>();
    if (restaurantError) return json({ error: restaurantError.message }, 400);

    const timezone =
      typeof restaurant?.timezone === "string" && restaurant.timezone.trim()
        ? restaurant.timezone
        : "America/Toronto";
    const restaurantName =
      typeof restaurant?.name === "string" && restaurant.name.trim()
        ? restaurant.name.trim()
        : "the restaurant";
    const previousDateLabel = formatReservationDate(new Date(reservation.reserved_at), timezone);
    const reservedAtIso = localToUTC(date, time, timezone);
    const reservedAt = new Date(reservedAtIso);
    if (Number.isNaN(reservedAt.getTime()) || reservedAt.getTime() < Date.now()) {
      return json({ error: "Reservation time must be in the future" }, 400);
    }
    const closure = findClosedSpecialDayForDate(restaurant?.hours_json, date);
    if (closure) {
      return json({ error: closureUnavailableMessage(closure), unavailable_reason: "closed" }, 409);
    }

    const { data: floorCapacityData } = await adminClient.rpc("restaurant_floor_capacity", {
      p_restaurant_id: reservation.restaurant_id,
    });
    const floorCapacity = Number.isFinite(Number(floorCapacityData)) ? Number(floorCapacityData) : 0;
    if (partySize > floorCapacity) {
      return json({ error: `Party size exceeds this restaurant's capacity of ${floorCapacity}` }, 400);
    }

    const dayOfWeek = localDayOfWeek(date, timezone);
    const requestedMinute = parseTimeToMinutes(time);
    const { data: shifts, error: shiftsError } = await adminClient
      .from("shifts")
      .select("id, start_time, end_time, turn_time_minutes, max_covers")
      .eq("restaurant_id", reservation.restaurant_id)
      .eq("is_active", true)
      .contains("days_of_week", [dayOfWeek])
      .returns<ShiftRow[]>();
    if (shiftsError) return json({ error: shiftsError.message }, 400);

    const selectedShift = (shifts ?? []).find((shift) =>
      requestedMinute == null ? false : shiftContainsMinute(shift, requestedMinute),
    );
    if (!selectedShift) return json({ error: "No active shift is available at that time" }, 400);

    const configuredTurnMinutes =
      typeof restaurant?.settings_json?.turnTimeMinutes === "number"
        ? restaurant.settings_json.turnTimeMinutes
        : null;
    const turnMinutes = configuredTurnMinutes || selectedShift.turn_time_minutes || 90;
    const maxCovers = selectedShift.max_covers || 100;
    const slotEnd = new Date(reservedAt.getTime() + turnMinutes * 60_000);
    const dayStart = localToUTC(date, "00:00", timezone);
    const dayEnd = localToUTC(date, "23:59", timezone);

    const { data: activeReservations, error: activeReservationError } = await adminClient
      .from("reservations")
      .select("id, shift_id, reserved_at, party_size, duration_minutes")
      .eq("restaurant_id", reservation.restaurant_id)
      .neq("id", reservationId)
      .in("status", ["pending", "confirmed", "seated"])
      .gte("reserved_at", dayStart)
      .lte("reserved_at", dayEnd)
      .returns<ExistingReservationRow[]>();
    if (activeReservationError) return json({ error: activeReservationError.message }, 400);

    const totalCovers = (activeReservations ?? []).reduce((total, row) => {
      if (row.shift_id !== selectedShift.id) return total;
      const existingStart = new Date(row.reserved_at);
      const existingEnd = new Date(existingStart.getTime() + (row.duration_minutes || turnMinutes) * 60_000);
      if (reservedAt < existingEnd && slotEnd > existingStart) {
        return total + (row.party_size || 0);
      }
      return total;
    }, partySize);
    if (totalCovers > maxCovers) {
      return json({ error: "That time is no longer available for this party size" }, 409);
    }

    // Diner double-book guard. Mirrors create-public-booking: matches by
    // user_profile_id (logged-in) or guest_email/guest_phone (guest) and
    // rejects when the new [start, start+turnMinutes] window overlaps an
    // existing active reservation, whether it's at this restaurant or another.
    // The reservation being edited is excluded by id so it doesn't conflict
    // with itself.
    {
      const idClauses: string[] = [];
      const guestEmailRaw = reservation.guest_email?.trim() ?? null;
      const guestPhoneRaw = reservation.guest_phone?.trim() ?? null;
      if (reservation.user_profile_id) idClauses.push(`user_profile_id.eq.${reservation.user_profile_id}`);
      if (guestEmailRaw) idClauses.push(`guest_email.eq.${guestEmailRaw}`);
      if (guestPhoneRaw) idClauses.push(`guest_phone.eq.${guestPhoneRaw}`);
      if (idClauses.length > 0) {
        const windowStart = new Date(reservedAt.getTime() - 24 * 60 * 60_000).toISOString();
        const windowEnd = new Date(reservedAt.getTime() + 24 * 60 * 60_000).toISOString();
        const { data: otherBookings } = await adminClient
          .from("reservations")
          .select("id, restaurant_id, reserved_at, duration_minutes")
          .neq("id", reservationId)
          .in("status", ["pending", "confirmed", "seated"])
          .gte("reserved_at", windowStart)
          .lte("reserved_at", windowEnd)
          .or(idClauses.join(","));
        const overlap = (otherBookings ?? []).find((row) => {
          const otherStart = new Date(row.reserved_at);
          const minutes = typeof row.duration_minutes === "number" && row.duration_minutes > 0
            ? row.duration_minutes
            : 90;
          const otherEnd = new Date(otherStart.getTime() + minutes * 60_000);
          return reservedAt < otherEnd && otherStart < slotEnd;
        });
        if (overlap) {
          const sameRestaurant = overlap.restaurant_id === reservation.restaurant_id;
          return json(
            {
              error: sameRestaurant
                ? "You already have another reservation at this restaurant during that window. Please cancel or modify it first."
                : "You already have a reservation at this time at another restaurant. Please cancel or modify that booking first.",
              unavailable_reason: "diner_double_book",
            },
            409,
          );
        }
      }
    }

    const marker = `[Diner modified booking at ${new Date().toISOString()}]`;
    const previousNotes = reservation.internal_notes?.trim();
    const internalNotes = previousNotes ? `${previousNotes}\n${marker}` : marker;

    const { data: modifyRows, error: modifyError } = await adminClient.rpc("modify_reservation_slot", {
      p_reservation_id: reservationId,
      p_restaurant_id: reservation.restaurant_id,
      p_shift_id: selectedShift.id,
      p_new_reserved_at: reservedAtIso,
      p_new_party_size: partySize,
      p_turn_minutes: turnMinutes,
    });

    if (modifyError) {
      const code = (modifyError as { code?: string }).code;
      if (code === "P0001") {
        return json({ error: "That time is no longer available for this party size", unavailable_reason: "slot_taken" }, 409);
      }
      if (code === "P0002") {
        return json({ error: "That time is no longer available for this party size", unavailable_reason: "over_cover_cap" }, 409);
      }
      if (code === "P0003") {
        return json({ error: "No active shift is available at that time" }, 400);
      }
      if (code === "P0004") {
        return json({ error: "Only upcoming reservations can be modified" }, 400);
      }
      if (code === "P0005") {
        return json({ error: "Reservation not found" }, 404);
      }
      // P0006 raised by modify_reservation_slot's diner-overlap pre-check.
      // 23P01 is the partial-exclusion-constraint backstop covering the same
      // condition; map both to the same friendly response.
      if (code === "P0006" || code === "23P01") {
        return json(
          {
            error: "You already have a reservation at this time. Cancel or modify the existing one before booking again.",
            unavailable_reason: "diner_double_book",
          },
          409,
        );
      }
      if (code === "P0007") {
        return json(
          {
            error: "This reservation is missing contact info; please contact the restaurant to update it before modifying.",
            unavailable_reason: "missing_identifier",
          },
          400,
        );
      }
      if (code === "P0008") {
        return json(
          {
            error: "This time is past the shift's close. Pick an earlier slot.",
            unavailable_reason: "past_shift_close",
          },
          409,
        );
      }
      return json({ error: modifyError.message }, 400);
    }

    const modifyRow = Array.isArray(modifyRows) ? modifyRows[0] : modifyRows;
    const nextTableIds: string[] = Array.isArray(modifyRow?.out_table_ids)
      ? modifyRow.out_table_ids.filter((id: unknown): id is string => typeof id === "string")
      : [];
    if (nextTableIds.length === 0) {
      return json({ error: "That time is no longer available for this party size", unavailable_reason: "slot_taken" }, 409);
    }

    // Persist non-slot fields the RPC does not touch (special_request, internal_notes).
    const { error: notesError } = await adminClient
      .from("reservations")
      .update({
        special_request: specialRequest || null,
        internal_notes: internalNotes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reservationId);
    if (notesError) return json({ error: notesError.message }, 400);

    // ─── Deposit recalc phase ─────────────────────────────────────────
    // Phase 8 of diner auth overhaul (2026-05-15). When party_size
    // changes, the deposit owed may change too (per the restaurant's
    // `deposit_tiers`). Recompute and reconcile:
    //   - delta > 0 → charge the diner's saved card for the difference
    //   - delta < 0 → refund the difference via Stripe (partial refund
    //                 on a real-PI row, DB-only adjust on a stub row)
    //   - delta = 0 → nothing
    // Non-fatal: a refund/charge failure logs a warning but doesn't
    // block the modify response. The reservation has already been
    // moved; the deposit reconciliation is best-effort. For the charge
    // path, if there's no saved card on file we surface
    // `modify_requires_card` and the client prompts the diner to add
    // a card before retrying.
    type DepositAdjustment =
      | { kind: "none" }
      | { kind: "charged"; amount_cents: number; payment_intent_id: string | null }
      | { kind: "refunded"; amount_cents: number; payment_intent_id: string | null }
      | { kind: "failed"; reason: string };
    let depositAdjustment: DepositAdjustment = { kind: "none" };

    if (partySize !== reservation.party_size) {
      const { data: newExpectedRaw } = await adminClient.rpc("compute_deposit_for_party", {
        p_restaurant_id: reservation.restaurant_id,
        p_party_size: partySize,
      });
      const newExpectedCents = Number(newExpectedRaw) || 0;

      const { data: chargedRowsRaw } = await adminClient
        .from("reservation_deposit_payments")
        .select("id, amount_cents, stripe_payment_intent_id, status")
        .eq("reservation_id", reservationId)
        .eq("status", "charged")
        .order("created_at", { ascending: false });
      const chargedRows = (chargedRowsRaw ?? []) as Array<{
        id: string;
        amount_cents: number;
        stripe_payment_intent_id: string | null;
        status: string;
      }>;
      const currentCents = chargedRows.reduce(
        (sum, r) => sum + (r.amount_cents ?? 0),
        0,
      );
      const deltaCents = newExpectedCents - currentCents;

      if (deltaCents > 0) {
        // Need to charge more on the diner's saved card.
        // Preflight: must be logged-in diner with a default saved card.
        if (!reservation.user_profile_id) {
          return json(
            {
              error: "This booking needs an additional deposit. Please contact the restaurant to update.",
              unavailable_reason: "modify_requires_card",
              delta_cents: deltaCents,
            },
            402,
          );
        }
        const { data: profileRaw } = await adminClient
          .from("user_profiles")
          .select("id, stripe_customer_id")
          .eq("id", reservation.user_profile_id)
          .maybeSingle();
        const profile = profileRaw as { id: string; stripe_customer_id: string | null } | null;
        if (!profile?.stripe_customer_id) {
          return json(
            {
              error: "Adding to your party size needs a card on file. Add one in Account → Payment.",
              unavailable_reason: "modify_requires_card",
              delta_cents: deltaCents,
            },
            402,
          );
        }
        // Default card or fallback to most recent.
        const { data: defaultRaw } = await adminClient
          .from("saved_cards")
          .select("stripe_payment_method_id")
          .eq("user_profile_id", profile.id)
          .eq("is_default", true)
          .maybeSingle();
        let pmId = (defaultRaw as { stripe_payment_method_id: string | null } | null)?.stripe_payment_method_id;
        if (!pmId) {
          const { data: anyCardRaw } = await adminClient
            .from("saved_cards")
            .select("stripe_payment_method_id")
            .eq("user_profile_id", profile.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          pmId = (anyCardRaw as { stripe_payment_method_id: string | null } | null)?.stripe_payment_method_id;
        }
        if (!pmId) {
          return json(
            {
              error: "Adding to your party size needs a card on file. Add one in Account → Payment.",
              unavailable_reason: "modify_requires_card",
              delta_cents: deltaCents,
            },
            402,
          );
        }

        const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
        if (!stripeKey) {
          depositAdjustment = { kind: "failed", reason: "Stripe not configured" };
        } else {
          const { default: Stripe } = await import("npm:stripe@17");
          const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });
          const currency = (restaurant?.currency ?? "CAD").toLowerCase();
          const applicationFeeCents = Math.round(deltaCents * 0.05);
          const piParams: Record<string, unknown> = {
            amount: deltaCents,
            currency,
            customer: profile.stripe_customer_id,
            payment_method: pmId,
            off_session: true,
            confirm: true,
            metadata: {
              reservation_id: reservationId,
              kind: "modify_deposit_delta",
            },
            description: `Additional deposit for ${restaurantName}`,
          };
          if (restaurant?.stripe_account_id) {
            piParams.application_fee_amount = applicationFeeCents;
            piParams.transfer_data = { destination: restaurant.stripe_account_id };
          }

          try {
            const pi = await stripe.paymentIntents.create(piParams);
            if (pi.status === "succeeded" || pi.status === "processing") {
              const payerEmail =
                reservation.guest_email?.trim() || guest?.email?.trim() || "diner@unknown";
              const payerName =
                reservation.guest_full_name?.trim() || guest?.full_name?.trim() || "Diner";
              await adminClient
                .from("reservation_deposit_payments")
                .insert({
                  reservation_id: reservationId,
                  amount_cents: deltaCents,
                  stripe_payment_intent_id: pi.id,
                  status: "charged",
                  payer_email: payerEmail,
                  payer_full_name: payerName,
                  paid_at: new Date().toISOString(),
                  payer_user_profile_id: reservation.user_profile_id,
                });
              depositAdjustment = {
                kind: "charged",
                amount_cents: deltaCents,
                payment_intent_id: pi.id,
              };
            } else if (pi.status === "requires_action") {
              return json(
                {
                  error: "Your card needs additional verification. Please update the card in Account → Payment and try again.",
                  unavailable_reason: "modify_requires_card",
                  delta_cents: deltaCents,
                },
                402,
              );
            } else {
              depositAdjustment = { kind: "failed", reason: `Unexpected PI status: ${pi.status}` };
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("[modify-reservation] deposit delta charge failed:", msg);
            depositAdjustment = { kind: "failed", reason: msg };
          }
        }
      } else if (deltaCents < 0) {
        // Refund the difference. Pick the most-recent charged row that
        // can cover the refund. If no PI on the row, just adjust DB.
        const refundCents = -deltaCents;
        const target = chargedRows.find((r) => (r.amount_cents ?? 0) > 0);
        if (!target) {
          depositAdjustment = { kind: "none" };
        } else {
          const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
          const applyDbAdjust = async () => {
            const remaining = (target.amount_cents ?? 0) - refundCents;
            if (remaining <= 0) {
              await adminClient
                .from("reservation_deposit_payments")
                .update({ status: "refunded", amount_cents: 0 })
                .eq("id", target.id);
            } else {
              await adminClient
                .from("reservation_deposit_payments")
                .update({ amount_cents: remaining })
                .eq("id", target.id);
            }
          };

          if (stripeKey && target.stripe_payment_intent_id) {
            const { default: Stripe } = await import("npm:stripe@17");
            const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });
            try {
              const partialRefundCents = Math.min(refundCents, target.amount_cents ?? 0);
              const outcome = await refundPaymentIntent(
                stripe,
                target.stripe_payment_intent_id,
                "modify_deposit_delta_refund",
                partialRefundCents,
              );
              if (outcome.ok) {
                await applyDbAdjust();
                depositAdjustment = {
                  kind: "refunded",
                  amount_cents: partialRefundCents,
                  payment_intent_id: target.stripe_payment_intent_id,
                };
              } else {
                console.warn(
                  "[modify-reservation] refund failed:",
                  outcome.error,
                );
                depositAdjustment = { kind: "failed", reason: outcome.error };
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn("[modify-reservation] refund errored:", msg);
              depositAdjustment = { kind: "failed", reason: msg };
            }
          } else {
            // Stub row (no PI) — adjust DB only.
            await applyDbAdjust();
            depositAdjustment = {
              kind: "refunded",
              amount_cents: Math.min(refundCents, target.amount_cents ?? 0),
              payment_intent_id: null,
            };
          }
        }
      }
    }

    const guestName =
      reservation.guest_full_name?.trim() ||
      guest?.full_name?.trim() ||
      "there";
    const guestEmail = reservation.guest_email?.trim() || guest?.email?.trim() || null;
    const guestPhone = reservation.guest_phone?.trim() || guest?.phone?.trim() || null;
    const nextDateLabel = formatReservationDate(reservedAt, timezone);
    const codeLine = reservation.confirmation_code?.trim()
      ? ` Confirmation code: ${reservation.confirmation_code.trim()}.`
      : "";

    // Surface the event / promotion the reservation is linked to in the SMS
    // body so the diner sees the modification applied to *that* event/promo
    // (and isn't confused by a generic "your booking was updated" line).
    let eventLine = "";
    let promoLine = "";
    if (reservation.event_id) {
      const { data: ev } = await adminClient
        .from("events")
        .select("name")
        .eq("id", reservation.event_id)
        .maybeSingle<{ name: string | null }>();
      if (ev?.name) eventLine = ` Event: ${ev.name}.`;
    }
    if (reservation.promotion_id) {
      const { data: pr } = await adminClient
        .from("promotions")
        .select("title, promo_code")
        .eq("id", reservation.promotion_id)
        .maybeSingle<{ title: string | null; promo_code: string | null }>();
      if (pr?.title) {
        const codePart = pr.promo_code ? ` (code ${pr.promo_code})` : "";
        promoLine = ` Promo: ${pr.title}${codePart}.`;
      }
    } else if (reservation.applied_promo_code) {
      promoLine = ` Promo code: ${reservation.applied_promo_code}.`;
    }

    const notification = guest
      ? await sendReservationNotification({
          supabase: adminClient,
          guestId: guest.id,
          restaurantId: reservation.restaurant_id,
          reservationId,
          type: "reservation_modification",
          email: guestEmail,
          phone: guestPhone,
          subject: `Your reservation at ${restaurantName} was updated`,
          body:
            `Hi ${guestName}, your reservation at ${restaurantName} was updated from ${previousDateLabel} ` +
            `to ${nextDateLabel} for ${partySize} ${partySize === 1 ? "guest" : "guests"}.` +
            codeLine +
            eventLine +
            promoLine,
        })
      : ({ status: "skipped" as const, channel: null });

    // Notify Me fan-out: when a reservation is modified, the OLD slot frees up.
    // We ping availability_alerts matching the original reserved_at (not the new
    // one — that slot just got taken). The in-app notification + a best-effort
    // SMS get dispatched per matched alert. Wrapped in try/catch so a fan-out
    // failure can NEVER block the modify response. RPC is a no-op when zero
    // alerts.
    try {
      const rows: FulfilledAlertRow[] = [];
      const { data: restRows, error: restErr } = await adminClient.rpc(
        "match_availability_alerts_for_restaurant",
        {
          p_restaurant_id: reservation.restaurant_id,
          p_freed_at: reservation.reserved_at, // OLD slot
          p_freed_party_size: reservation.party_size, // OLD party
        },
      );
      if (!restErr && restRows) rows.push(...(restRows as FulfilledAlertRow[]));
      if (reservation.event_id) {
        const { data: evtRows, error: evtErr } = await adminClient.rpc(
          "match_availability_alerts_for_event",
          { p_event_id: reservation.event_id },
        );
        if (!evtErr && evtRows) rows.push(...(evtRows as FulfilledAlertRow[]));
      }
      if (rows.length > 0) {
        const dispatch = sendNotifyMeSms(adminClient, rows).catch((e) =>
          console.warn("[modify-reservation] notify-me SMS dispatch failed:", e),
        );
        const edge = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
          .EdgeRuntime;
        if (edge?.waitUntil) edge.waitUntil(dispatch);
      }
    } catch (e) {
      console.warn("[modify-reservation] notify-me fan-out failed:", e);
    }

    return json({
      ok: true,
      reservation_id: reservationId,
      reserved_at: reservedAtIso,
      party_size: partySize,
      special_request: specialRequest || null,
      table_ids: nextTableIds,
      notification_delivery: notification.status,
      notification_delivery_channel: notification.channel,
      deposit_adjustment: depositAdjustment,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
