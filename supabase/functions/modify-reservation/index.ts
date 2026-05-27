import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { closureUnavailableMessage, findClosedSpecialDayForDate } from "../_shared/closures.ts";
import { localDayOfWeek, localToUTC } from "../_shared/time.ts";
import {
  buildConfirmationBody,
  formatReservationDate,
  sendReservationNotification,
} from "../_shared/reservation-notifications.ts";
import { formatCents } from "../_shared/money.ts";
import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { sendNotifyMeSms, type FulfilledAlertRow } from "../_shared/notify-me-sms.ts";
import { refundPaymentIntent } from "../_shared/stripe-refund.ts";
import { computeBreakEvenRefund } from "../_shared/refund-math.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { ModifyReservationSchema } from "../_shared/validation/booking.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

    const parsed = await parseJsonBody(req, ModifyReservationSchema, {
      jsonRes: (b, s) => json(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const reservationId = (parsed.data.reservation_id ?? parsed.data.reservationId)!;
    const providedCode =
      parsed.data.confirmation_code ?? parsed.data.confirmationCode ?? "";
    const date = parsed.data.date;
    const time = parsed.data.time;
    const partySize = (parsed.data.party_size ?? parsed.data.partySize)!;
    const specialRequest =
      parsed.data.special_request ?? parsed.data.specialRequest ?? "";

    if (parseTimeToMinutes(time) == null) {
      return json({ error: "Valid time is required" }, 400);
    }

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

      // Two ownership paths for logged-in users:
      //   (a) reservation.user_profile_id matches the caller's profile.id —
      //       happens when the diner booked while signed in. guest_id may
      //       be null (no separate guests row was created).
      //   (b) reservation has a guest_id AND that guest row is linked to
      //       this user's profile_id — legacy path for guest-checkout
      //       reservations that were later claimed by sign-in.
      const ownsByProfile = reservation.user_profile_id != null &&
        reservation.user_profile_id === profile.id;
      if (reservation.guest_id) {
        const { data: ownedGuest, error: guestError } = await adminClient
          .from("guests")
          .select("id, full_name, email, phone")
          .eq("id", reservation.guest_id)
          .eq("user_profile_id", profile.id)
          .maybeSingle<GuestRow>();
        if (guestError) return json({ error: guestError.message }, 400);
        if (!ownedGuest && !ownsByProfile) {
          return json({ error: "You can only modify your own reservations" }, 403);
        }
        guest = ownedGuest;
      } else if (!ownsByProfile) {
        // No guest row AND user_profile mismatch — not yours.
        return json({ error: "You can only modify your own reservations" }, 403);
      }
    } else if (providedCode) {
      // SECURITY (2026-05-22): code-only auth was vulnerable to enumeration.
      // Now requires the matching guest_email as a second factor. Mirrors
      // cancel-reservation. Both 401s deliberately use the same wording so
      // we don't reveal which field failed.
      const expectedCode = (reservation.confirmation_code ?? "").trim();
      if (!expectedCode || expectedCode.toLowerCase() !== providedCode.toLowerCase()) {
        return json({ error: "Invalid confirmation code" }, 401);
      }
      const providedEmail = (parsed.data.email ?? "").trim().toLowerCase();
      const reservationEmail = (reservation.guest_email ?? "").trim().toLowerCase();
      if (!providedEmail || !reservationEmail || providedEmail !== reservationEmail) {
        return json({ error: "Invalid confirmation code" }, 401);
      }
      if (reservation.guest_id) {
        const { data: linkedGuest } = await adminClient
          .from("guests")
          .select("id, full_name, email, phone")
          .eq("id", reservation.guest_id)
          .maybeSingle<GuestRow>();
        guest = linkedGuest;
      }
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
    // CLAUDE.md hard rule: "Never re-introduce COALESCE(s.max_covers, 100)
    // in any reservation RPC. NULL means 'no cap'; gate with IF v_max_covers
    // IS NOT NULL". The RPC follows this; the edge fn previously did not and
    // would reject valid bookings on uncapped shifts whose covers exceeded
    // 100 even though the restaurant's policy is "no cap". Preserve NULL
    // here and gate the cover-cap check on it below.
    const maxCovers: number | null =
      typeof selectedShift.max_covers === "number" ? selectedShift.max_covers : null;
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
    if (maxCovers !== null && totalCovers > maxCovers) {
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

    // 2026-05-27: Deposit delta pre-flight. We compute the new expected
    // deposit BEFORE applying the slot change. Three branches:
    //   * delta == 0 → continue, no money action
    //   * delta < 0  → continue, refund happens after the slot RPC succeeds
    //   * delta > 0  → SHORT-CIRCUIT: don't apply the slot change. Insert a
    //                  pending reservation_deposit_payments row, return
    //                  requires_payment so the client can mount Stripe
    //                  Elements for the delta. After payment succeeds,
    //                  confirm-modify-payment finalizes the modification.
    let depositDeltaCents = 0;
    let currentChargedCents = 0;
    if (partySize !== reservation.party_size) {
      const { data: newExpectedRaw } = await adminClient.rpc("compute_deposit_for_party", {
        p_restaurant_id: reservation.restaurant_id,
        p_party_size: partySize,
      });
      const newExpectedCents = Number(newExpectedRaw) || 0;
      const { data: chargedSumRaw } = await adminClient
        .from("reservation_deposit_payments")
        .select("amount_cents")
        .eq("reservation_id", reservationId)
        .eq("status", "charged");
      currentChargedCents = ((chargedSumRaw ?? []) as Array<{ amount_cents: number }>)
        .reduce((sum, r) => sum + (r.amount_cents ?? 0), 0);
      depositDeltaCents = newExpectedCents - currentChargedCents;

      if (depositDeltaCents > 0) {
        // Insert a pending deposit row. The client's payment flow stamps
        // its UUID on the PaymentIntent metadata (deposit_payment_ids);
        // confirm-modify-payment later asserts that binding before
        // flipping the row to charged and applying the slot change.
        const payerEmail =
          reservation.guest_email?.trim() || guest?.email?.trim() || null;
        const payerName =
          reservation.guest_full_name?.trim() || guest?.full_name?.trim() || null;
        const { data: pendingRow, error: pendingErr } = await adminClient
          .from("reservation_deposit_payments")
          .insert({
            reservation_id: reservationId,
            amount_cents: depositDeltaCents,
            status: "pending",
            payer_email: payerEmail,
            payer_full_name: payerName,
            payer_user_profile_id: reservation.user_profile_id,
          })
          .select("id")
          .single();
        if (pendingErr || !pendingRow) {
          return json(
            { error: pendingErr?.message ?? "Could not prepare delta payment." },
            400,
          );
        }
        return json({
          ok: false,
          requires_payment: true,
          deposit_payment_row_id: (pendingRow as { id: string }).id,
          delta_cents: depositDeltaCents,
          restaurant_id: reservation.restaurant_id,
          reservation_id: reservationId,
          // The diner's UI uses these to remember the requested change so
          // we can apply it post-payment via confirm-modify-payment.
          pending_date: date,
          pending_time: time,
          pending_party_size: partySize,
          pending_special_request: specialRequest || null,
        });
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

    // ─── Deposit refund phase ─────────────────────────────────────────
    // 2026-05-27: simplified. Delta > 0 is handled upstream via the
    // requires_payment short-circuit, so we only see delta == 0 or
    // delta < 0 here. Negative delta means we owe the diner a refund.
    //
    // Break-even policy (see _shared/refund-math.ts): the diner gets
    // back the delta minus Cenaiva's 5.5%. Above break-even (~$11.54),
    // the Stripe fee on the delta is absorbed by the restaurant; below,
    // the diner eats it.
    type DepositAdjustment =
      | { kind: "none" }
      | { kind: "refunded"; amount_cents: number; payment_intent_id: string | null }
      | { kind: "failed"; reason: string };
    let depositAdjustment: DepositAdjustment = { kind: "none" };

    if (depositDeltaCents < 0) {
      const deltaToRefund = -depositDeltaCents;
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
      const target = chargedRows.find((r) => (r.amount_cents ?? 0) > 0);
      if (!target) {
        depositAdjustment = { kind: "none" };
      } else {
        const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
        const applyDbAdjust = async () => {
          const remaining = (target.amount_cents ?? 0) - deltaToRefund;
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
          const stripe = await getStripeClient(stripeKey);
          try {
            const cappedDelta = Math.min(deltaToRefund, target.amount_cents ?? 0);
            const { refundCents } = computeBreakEvenRefund(cappedDelta);
            const outcome = await refundPaymentIntent(
              stripe,
              target.stripe_payment_intent_id,
              "modify_deposit_delta_refund",
              refundCents,
            );
            if (outcome.ok) {
              await applyDbAdjust();
              depositAdjustment = {
                kind: "refunded",
                amount_cents: refundCents,
                payment_intent_id: target.stripe_payment_intent_id,
              };
            } else {
              console.warn("[modify-reservation] refund failed:", outcome.error);
              depositAdjustment = { kind: "failed", reason: outcome.error };
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("[modify-reservation] refund errored:", msg);
            depositAdjustment = { kind: "failed", reason: msg };
          }
        } else {
          // Stub row (no PI) — DB-only adjust.
          await applyDbAdjust();
          depositAdjustment = {
            kind: "refunded",
            amount_cents: Math.min(deltaToRefund, target.amount_cents ?? 0),
            payment_intent_id: null,
          };
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

    // 2026-05-27: notification no longer gated on a non-null `guest` row.
    // For signed-in diners who booked without a separate guests row,
    // `guest` is null but the contact info is on the reservation. The
    // helper now tolerates a null guestId (just skips the
    // communication_log audit insert).
    //
    // Body enrichment: include preorder items + refund line when applicable.
    const { data: orderRow } = await adminClient
      .from("orders")
      .select("id, order_items(name, quantity)")
      .eq("reservation_id", reservationId)
      .eq("is_preorder", true)
      .maybeSingle();
    const preorderItemsList =
      orderRow && Array.isArray((orderRow as { order_items?: unknown }).order_items)
        ? ((orderRow as { order_items: Array<{ name?: unknown; quantity?: unknown }> }).order_items)
          .map((it) => ({
            name: typeof it.name === "string" ? it.name : "",
            quantity: typeof it.quantity === "number" ? it.quantity : Number(it.quantity ?? 1),
          }))
          .filter((it) => it.name && Number.isFinite(it.quantity) && it.quantity > 0)
        : [];
    const preorderLine = preorderItemsList.length > 0
      ? `\nPre-ordered: ${preorderItemsList.map((it) => `${it.quantity}× ${it.name}`).join(", ")}`
      : "";
    const refundLine = depositAdjustment.kind === "refunded" && depositAdjustment.amount_cents > 0
      ? `\nDeposit refunded: ${formatCents(depositAdjustment.amount_cents)}`
      : "";
    const modifyBody =
      `Hi ${guestName}, your reservation at ${restaurantName} was updated from ${previousDateLabel} ` +
      `to ${nextDateLabel} for ${partySize} ${partySize === 1 ? "guest" : "guests"}.` +
      codeLine +
      eventLine +
      promoLine +
      preorderLine +
      refundLine;
    const notification = await sendReservationNotification({
      supabase: adminClient,
      guestId: guest?.id ?? reservation.guest_id ?? null,
      restaurantId: reservation.restaurant_id,
      reservationId,
      type: "reservation_modification",
      email: guestEmail,
      phone: guestPhone,
      subject: `Your reservation at ${restaurantName} was updated`,
      body: modifyBody,
    });

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
