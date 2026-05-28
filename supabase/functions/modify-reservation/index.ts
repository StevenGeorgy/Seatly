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
import { DEFAULT_TAX_RATE_FALLBACK } from "../_shared/booking-defaults.ts";
import { proportionalSplitCents } from "../_shared/proportional-split.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
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

    // 2026-05-27: cart-modify path. Mixed payloads (cart + slot fields in
    // the SAME call) are rejected — each kind has its own payment surface.
    const cartItemsInput = parsed.data.cart_items;
    const isCartModify = cartItemsInput !== undefined;
    const hasSlotFields =
      parsed.data.date !== undefined ||
      parsed.data.time !== undefined ||
      parsed.data.party_size !== undefined ||
      parsed.data.partySize !== undefined;
    if (isCartModify && hasSlotFields) {
      return json(
        {
          error:
            "Cart and slot modifications must be sent separately. Submit one or the other.",
          unavailable_reason: "mixed_modify_not_allowed",
        },
        400,
      );
    }

    const date = parsed.data.date;
    const time = parsed.data.time;
    const partySize = parsed.data.party_size ?? parsed.data.partySize;
    const specialRequest =
      parsed.data.special_request ?? parsed.data.specialRequest ?? "";

    // Slot-only validation. Cart modify reuses the same auth + rate-limit
    // path below, then forks into its own branch and returns early.
    if (!isCartModify) {
      if (!time || parseTimeToMinutes(time) == null) {
        return json({ error: "Valid time is required" }, 400);
      }
      if (!date) {
        return json({ error: "Valid date is required" }, 400);
      }
      if (partySize == null) {
        return json({ error: "Party size is required" }, 400);
      }
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

    // ═══════════════════════════════════════════════════════════════════
    // CART-MODIFY BRANCH (2026-05-27)
    // ═══════════════════════════════════════════════════════════════════
    // Separate from the slot-modify path below. Validates 2h cutoff,
    // resolves promo, recomputes food + tax server-side, and either:
    //   delta > 0 → seeds a pending deposit row + cart snapshot, returns
    //               requires_payment so the client mounts a fresh
    //               StripePaymentForm and later calls
    //               confirm-modify-payment with change_type='cart_delta'.
    //   delta < 0 → refunds |delta| via reverse_transfer, replaces order
    //               items in-place, updates promo, returns success.
    //   delta = 0 → just replaces items + updates promo, returns success.
    if (isCartModify) {
      return await handleCartModify({
        adminClient,
        reservation,
        guest,
        cartItems: cartItemsInput!,
        appliedPromoCodeInput: parsed.data.applied_promo_code,
        clientTaxCents: parsed.data.tax_cents,
        specialRequest,
        json,
      });
    }
    // ═══════════════════════════════════════════════════════════════════

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
    // Slot-modify path: date/time/partySize were validated as present above.
    // Re-bind to non-null locals for TS narrowing (the cart branch above
    // returns early, but TS doesn't propagate that into these later refs).
    const slotDate = date!;
    const slotTime = time!;
    const slotPartySize = partySize!;
    const reservedAtIso = localToUTC(slotDate, slotTime, timezone);
    const reservedAt = new Date(reservedAtIso);
    if (Number.isNaN(reservedAt.getTime()) || reservedAt.getTime() < Date.now()) {
      return json({ error: "Reservation time must be in the future" }, 400);
    }
    const closure = findClosedSpecialDayForDate(restaurant?.hours_json, slotDate);
    if (closure) {
      return json({ error: closureUnavailableMessage(closure), unavailable_reason: "closed" }, 409);
    }

    const { data: floorCapacityData } = await adminClient.rpc("restaurant_floor_capacity", {
      p_restaurant_id: reservation.restaurant_id,
    });
    const floorCapacity = Number.isFinite(Number(floorCapacityData)) ? Number(floorCapacityData) : 0;
    if (slotPartySize > floorCapacity) {
      return json({ error: `Party size exceeds this restaurant's capacity of ${floorCapacity}` }, 400);
    }

    const dayOfWeek = localDayOfWeek(slotDate, timezone);
    const requestedMinute = parseTimeToMinutes(slotTime);
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
    const dayStart = localToUTC(slotDate, "00:00", timezone);
    const dayEnd = localToUTC(slotDate, "23:59", timezone);

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
    }, slotPartySize);
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
    let chargedRowsForSplit: Array<{
      id: string;
      amount_cents: number;
      payer_email: string | null;
      payer_full_name: string | null;
      payer_user_profile_id: string | null;
      stripe_payment_intent_id: string | null;
    }> = [];
    if (slotPartySize !== reservation.party_size) {
      const { data: newExpectedRaw } = await adminClient.rpc("compute_deposit_for_party", {
        p_restaurant_id: reservation.restaurant_id,
        p_party_size: slotPartySize,
      });
      const newExpectedCents = Number(newExpectedRaw) || 0;
      const { data: chargedRowsRaw } = await adminClient
        .from("reservation_deposit_payments")
        .select("id, amount_cents, payer_email, payer_full_name, payer_user_profile_id, stripe_payment_intent_id")
        .eq("reservation_id", reservationId)
        .eq("status", "charged")
        .order("created_at", { ascending: true });
      chargedRowsForSplit = (chargedRowsRaw ?? []) as typeof chargedRowsForSplit;
      currentChargedCents = chargedRowsForSplit
        .reduce((sum, r) => sum + (r.amount_cents ?? 0), 0);
      depositDeltaCents = newExpectedCents - currentChargedCents;

      if (depositDeltaCents > 0) {
        // 2026-05-28 (PR-K): split-tender awareness. A solo-payer reservation
        // continues to seed ONE pending row (legacy single-card shape). A
        // split-tender reservation (≥2 charged rows with amount > 0) seeds
        // N pending rows — one per existing payer — with the delta split
        // proportionally to each payer's original contribution. The client
        // mounts SplitTenderPaymentForm with all N rows; only after every
        // card succeeds does confirm-modify-payment apply the slot change.
        //
        // The dedup-on-retry shape from the single-row path is preserved
        // for the solo branch; for the multi-row branch we add a natural-
        // key dedup (same reservation, same payer set, same total amount,
        // same created-within-5min window).
        const activeChargedRows = chargedRowsForSplit.filter(
          (r) => (r.amount_cents ?? 0) > 0,
        );
        const isSplitTenderModify = activeChargedRows.length >= 2;
        const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();

        if (isSplitTenderModify) {
          const weights = activeChargedRows.map((r) => r.amount_cents);
          const perRowDelta = proportionalSplitCents(depositDeltaCents, weights);

          // Natural-key dedup: if a recent (<5min) set of pending rows
          // matches this reservation+amount, reuse them instead of seeding
          // new ones. Same shape as the solo-payer dedup but matches the
          // multi-row total.
          const { data: existingPendingRows } = await adminClient
            .from("reservation_deposit_payments")
            .select("id, amount_cents, payer_user_profile_id, payer_email")
            .eq("reservation_id", reservationId)
            .eq("status", "pending")
            .is("pending_cart_snapshot", null)
            .gte("created_at", fiveMinAgo)
            .order("created_at", { ascending: true });
          const existingPending = (existingPendingRows ?? []) as Array<{
            id: string;
            amount_cents: number;
            payer_user_profile_id: string | null;
            payer_email: string | null;
          }>;
          const existingSum = existingPending.reduce(
            (s, r) => s + (r.amount_cents ?? 0),
            0,
          );
          let pendingRowIds: string[] = [];
          let payerSnapshot: Array<{
            row_id: string;
            amount_cents: number;
            payer_full_name: string | null;
            payer_email: string | null;
          }> = [];

          if (
            existingPending.length === activeChargedRows.length &&
            existingSum === depositDeltaCents
          ) {
            // Reuse — match each existing pending row back to its source
            // charged row by payer identity so per-row amounts line up.
            pendingRowIds = existingPending.map((r) => r.id);
            payerSnapshot = activeChargedRows.map((charged, i) => ({
              row_id: pendingRowIds[i],
              amount_cents: perRowDelta[i],
              payer_full_name: charged.payer_full_name,
              payer_email: charged.payer_email,
            }));
          } else {
            // Seed N fresh pending rows, one per original payer.
            const inserts = activeChargedRows.map((charged, i) => ({
              reservation_id: reservationId,
              amount_cents: perRowDelta[i],
              status: "pending" as const,
              payer_email: charged.payer_email,
              payer_full_name: charged.payer_full_name,
              payer_user_profile_id: charged.payer_user_profile_id,
            }));
            const { data: insertedRows, error: insertErr } = await adminClient
              .from("reservation_deposit_payments")
              .insert(inserts)
              .select("id");
            if (insertErr || !insertedRows) {
              return json(
                { error: insertErr?.message ?? "Could not prepare split delta payments." },
                400,
              );
            }
            pendingRowIds = (insertedRows as Array<{ id: string }>).map((r) => r.id);
            payerSnapshot = activeChargedRows.map((charged, i) => ({
              row_id: pendingRowIds[i],
              amount_cents: perRowDelta[i],
              payer_full_name: charged.payer_full_name,
              payer_email: charged.payer_email,
            }));
          }

          return json({
            ok: false,
            requires_payment: true,
            is_split_tender: true,
            deposit_payment_row_ids: pendingRowIds,
            deposit_payment_row_id: pendingRowIds[0], // legacy convenience for older clients
            delta_cents: depositDeltaCents,
            restaurant_id: reservation.restaurant_id,
            reservation_id: reservationId,
            split_payers: payerSnapshot,
            // The diner's UI uses these to remember the requested change so
            // we can apply it post-payment via confirm-modify-payment.
            pending_date: slotDate,
            pending_time: slotTime,
            pending_party_size: slotPartySize,
            pending_special_request: specialRequest || null,
          });
        }

        // ── Single-payer (legacy) path ─────────────────────────────────
        // Insert a pending deposit row. The client's payment flow stamps
        // its UUID on the PaymentIntent metadata (deposit_payment_ids);
        // confirm-modify-payment later asserts that binding before
        // flipping the row to charged and applying the slot change.
        const payerEmail =
          reservation.guest_email?.trim() || guest?.email?.trim() || null;
        const payerName =
          reservation.guest_full_name?.trim() || guest?.full_name?.trim() || null;
        // 2026-05-27 dedup: if the diner double-clicks "Save changes"
        // or the network retries the modify call, we'd otherwise create
        // a second pending row with the same delta. Reuse any
        // pending row created in the last 5 minutes that matches this
        // (reservation, amount, payer) tuple. Same shape repeats in the
        // cart-delta branch below.
        let pendingRow: { id: string } | null = null;
        const { data: existingPending } = await adminClient
          .from("reservation_deposit_payments")
          .select("id")
          .eq("reservation_id", reservationId)
          .eq("amount_cents", depositDeltaCents)
          .eq("status", "pending")
          .eq("payer_user_profile_id", reservation.user_profile_id ?? "")
          .is("pending_cart_snapshot", null)
          .gte("created_at", fiveMinAgo)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existingPending) {
          pendingRow = existingPending as { id: string };
        } else {
          const { data: newRow, error: pendingErr } = await adminClient
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
          if (pendingErr || !newRow) {
            return json(
              { error: pendingErr?.message ?? "Could not prepare delta payment." },
              400,
            );
          }
          pendingRow = newRow as { id: string };
        }
        return json({
          ok: false,
          requires_payment: true,
          is_split_tender: false,
          deposit_payment_row_id: (pendingRow as { id: string }).id,
          deposit_payment_row_ids: [(pendingRow as { id: string }).id],
          delta_cents: depositDeltaCents,
          restaurant_id: reservation.restaurant_id,
          reservation_id: reservationId,
          // The diner's UI uses these to remember the requested change so
          // we can apply it post-payment via confirm-modify-payment.
          pending_date: slotDate,
          pending_time: slotTime,
          pending_party_size: slotPartySize,
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
      p_new_party_size: slotPartySize,
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
    // 2026-05-28 (PR-K): split-tender proportional refund. The previous
    // code refunded ONE row only (the most-recent charged one), so a
    // split-tender shrink left N-1 payer cards untouched. Now we distribute
    // |delta| (break-even adjusted) proportionally across ALL charged rows.
    // Solo bookings degenerate to the single-row path (one row gets it all).
    type DepositAdjustmentPerRow = {
      row_id: string;
      payer_full_name: string | null;
      payer_email: string | null;
      payment_intent_id: string | null;
      refund_cents: number;
      ok: boolean;
      error?: string;
    };
    type DepositAdjustment =
      | { kind: "none" }
      | {
          kind: "refunded";
          amount_cents: number;
          payment_intent_id: string | null;
          per_row?: DepositAdjustmentPerRow[];
          is_split_tender?: boolean;
        }
      | { kind: "failed"; reason: string; per_row?: DepositAdjustmentPerRow[] };
    let depositAdjustment: DepositAdjustment = { kind: "none" };

    if (depositDeltaCents < 0) {
      const deltaToRefund = -depositDeltaCents;
      const { data: chargedRowsRaw } = await adminClient
        .from("reservation_deposit_payments")
        .select("id, amount_cents, stripe_payment_intent_id, status, payer_email, payer_full_name")
        .eq("reservation_id", reservationId)
        .eq("status", "charged")
        .order("created_at", { ascending: true });
      const chargedRows = (chargedRowsRaw ?? []) as Array<{
        id: string;
        amount_cents: number;
        stripe_payment_intent_id: string | null;
        status: string;
        payer_email: string | null;
        payer_full_name: string | null;
      }>;
      const activeRows = chargedRows.filter((r) => (r.amount_cents ?? 0) > 0);
      if (activeRows.length === 0) {
        depositAdjustment = { kind: "none" };
      } else {
        // Total break-even refund across all rows.
        const cappedTotal = Math.min(
          deltaToRefund,
          activeRows.reduce((s, r) => s + (r.amount_cents ?? 0), 0),
        );
        const { refundCents: totalRefundCents } = computeBreakEvenRefund(cappedTotal);
        const perRowRefund = proportionalSplitCents(
          totalRefundCents,
          activeRows.map((r) => r.amount_cents),
        );
        const perRowDbDeduct = proportionalSplitCents(
          cappedTotal,
          activeRows.map((r) => r.amount_cents),
        );
        const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
        const stripe = stripeKey ? await getStripeClient(stripeKey) : null;
        const perRow: DepositAdjustmentPerRow[] = [];
        let totalRefundedCents = 0;
        let anyFailed = false;
        for (let i = 0; i < activeRows.length; i++) {
          const row = activeRows[i];
          const refundSlice = perRowRefund[i];
          const dbDeductSlice = perRowDbDeduct[i];
          if (refundSlice <= 0) {
            perRow.push({
              row_id: row.id,
              payer_full_name: row.payer_full_name,
              payer_email: row.payer_email,
              payment_intent_id: row.stripe_payment_intent_id,
              refund_cents: 0,
              ok: true,
            });
            continue;
          }
          const applyDbDeduct = async () => {
            const remaining = (row.amount_cents ?? 0) - dbDeductSlice;
            if (remaining <= 0) {
              await adminClient
                .from("reservation_deposit_payments")
                .update({ status: "refunded", amount_cents: 0 })
                .eq("id", row.id);
            } else {
              await adminClient
                .from("reservation_deposit_payments")
                .update({ amount_cents: remaining })
                .eq("id", row.id);
            }
          };
          if (stripe && row.stripe_payment_intent_id) {
            try {
              const outcome = await refundPaymentIntent(
                stripe,
                row.stripe_payment_intent_id,
                "modify_deposit_delta_refund",
                refundSlice,
              );
              if (outcome.ok) {
                await applyDbDeduct();
                totalRefundedCents += refundSlice;
                perRow.push({
                  row_id: row.id,
                  payer_full_name: row.payer_full_name,
                  payer_email: row.payer_email,
                  payment_intent_id: row.stripe_payment_intent_id,
                  refund_cents: refundSlice,
                  ok: true,
                });
              } else {
                anyFailed = true;
                console.warn(
                  `[modify-reservation] refund failed for row ${row.id}:`,
                  outcome.error,
                );
                perRow.push({
                  row_id: row.id,
                  payer_full_name: row.payer_full_name,
                  payer_email: row.payer_email,
                  payment_intent_id: row.stripe_payment_intent_id,
                  refund_cents: refundSlice,
                  ok: false,
                  error: outcome.error,
                });
              }
            } catch (err) {
              anyFailed = true;
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(
                `[modify-reservation] refund errored for row ${row.id}:`,
                msg,
              );
              perRow.push({
                row_id: row.id,
                payer_full_name: row.payer_full_name,
                payer_email: row.payer_email,
                payment_intent_id: row.stripe_payment_intent_id,
                refund_cents: refundSlice,
                ok: false,
                error: msg,
              });
            }
          } else {
            // Stub row (no PI) — DB-only adjust.
            await applyDbDeduct();
            totalRefundedCents += refundSlice;
            perRow.push({
              row_id: row.id,
              payer_full_name: row.payer_full_name,
              payer_email: row.payer_email,
              payment_intent_id: null,
              refund_cents: refundSlice,
              ok: true,
            });
          }
        }
        if (totalRefundedCents > 0) {
          depositAdjustment = {
            kind: "refunded",
            amount_cents: totalRefundedCents,
            payment_intent_id:
              activeRows.length === 1 ? activeRows[0].stripe_payment_intent_id : null,
            per_row: perRow,
            is_split_tender: activeRows.length >= 2,
          };
        } else if (anyFailed) {
          depositAdjustment = {
            kind: "failed",
            reason: "All per-row refunds failed",
            per_row: perRow,
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
      `to ${nextDateLabel} for ${slotPartySize} ${slotPartySize === 1 ? "guest" : "guests"}.` +
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
      party_size: slotPartySize,
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

// ════════════════════════════════════════════════════════════════════════
// Cart-modify branch (2026-05-27)
// ════════════════════════════════════════════════════════════════════════
//
// Called by Deno.serve handler ABOVE when the request body has
// `cart_items`. Strictly separate from the slot-modify path; the caller's
// mixed-payload guard ensures we never co-mingle.
//
// Behavior summary:
//   1. Enforce a 2-hour cutoff: cart can't be changed within 2h of the
//      reservation (kitchen lead time).
//   2. Resolve promo (tri-state): undefined keeps current,
//      string sets/replaces (validated against `promotions`),
//      null/"" clears.
//   3. Recompute food + tax server-side from `menu_items.price`. The
//      client's `tax_cents`, if supplied, is cross-checked; on mismatch
//      >1¢ we log a warning but use the server value (source of truth).
//   4. Diff against the current orders + order_items totals:
//        delta > 0 → seed a pending reservation_deposit_payments row
//                    AND stamp the new cart on `pending_cart_snapshot`
//                    so confirm-modify-payment can replay it.
//        delta < 0 → refund |delta| via refundPaymentIntent + replace
//                    items in-place + update promo on the reservation.
//        delta = 0 → just replace items + update promo.
//   5. Fire owner + diner notifications via the cart-modified helpers
//      that sub-agent E2 is adding. We call them defensively (try/catch)
//      so a missing template can't block the response.

// (GuestRow and ReservationRow types already declared at module top.)
type ReservationRowForCart = ReservationRow;
type CartItemInput = { menu_item_id: string; quantity: number };

type CartLineComputed = {
  menu_item_id: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
};

// 2-hour cutoff (kitchen prep window). Tunable per-restaurant via
// settings_json in a future change; for now 2h matches the existing
// pre-order policy elsewhere in the app.
const CART_MODIFY_CUTOFF_MS = 2 * 60 * 60 * 1000;

interface HandleCartModifyArgs {
  adminClient: ReturnType<typeof createClient>;
  reservation: ReservationRowForCart;
  guest: GuestRow | null;
  cartItems: CartItemInput[];
  appliedPromoCodeInput: string | null | undefined;
  clientTaxCents: number | undefined;
  specialRequest: string;
  json: (body: unknown, status?: number) => Response;
}

async function handleCartModify(args: HandleCartModifyArgs): Promise<Response> {
  const {
    adminClient,
    reservation,
    guest,
    cartItems,
    appliedPromoCodeInput,
    clientTaxCents,
    specialRequest,
    json,
  } = args;
  const reservationId = reservation.id;

  // ── (1) 2-hour cutoff ─────────────────────────────────────────────
  const reservedAtMs = new Date(reservation.reserved_at).getTime();
  if (!Number.isFinite(reservedAtMs)) {
    return json({ error: "Reservation time is invalid" }, 400);
  }
  if (reservedAtMs - Date.now() < CART_MODIFY_CUTOFF_MS) {
    return json(
      {
        error:
          "The cart can no longer be changed — your reservation is within 2 hours.",
        unavailable_reason: "cart_modify_too_late",
      },
      409,
    );
  }

  // ── (2) Promo resolution (tri-state) ──────────────────────────────
  // undefined        → keep existing reservation.applied_promo_code
  // string non-empty → validate against promotions; on success, use it
  // null OR "" string→ clear the promo
  type PromoState =
    | { kind: "keep"; code: string | null }
    | { kind: "clear" }
    | { kind: "set"; code: string; row: PromoRowForCompute };
  type PromoRowForCompute = {
    id: string;
    restaurant_id: string;
    is_active: boolean;
    starts_at: string;
    ends_at: string | null;
    promo_code: string | null;
    promo_type: "bogo" | "percentage" | "fixed" | "free_item";
    discount_value: number | null;
    min_order_amount: number | null;
    eligible_item_ids: string[] | null;
    free_item_id: string | null;
    bogo_item_ids: string[] | null;
    buy_quantity: number | null;
    get_quantity: number | null;
  };

  let promoState: PromoState;
  if (appliedPromoCodeInput === undefined) {
    promoState = { kind: "keep", code: reservation.applied_promo_code };
  } else if (
    appliedPromoCodeInput === null ||
    (typeof appliedPromoCodeInput === "string" &&
      appliedPromoCodeInput.trim() === "")
  ) {
    promoState = { kind: "clear" };
  } else {
    const codeRaw = String(appliedPromoCodeInput).trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,32}$/.test(codeRaw)) {
      return json(
        { error: "Invalid promo code format.", unavailable_reason: "promo_invalid" },
        400,
      );
    }
    const { data: promoRow, error: promoErr } = await adminClient
      .from("promotions")
      .select(
        "id, restaurant_id, is_active, starts_at, ends_at, promo_code, promo_type, discount_value, min_order_amount, eligible_item_ids, free_item_id, bogo_item_ids, buy_quantity, get_quantity",
      )
      .eq("restaurant_id", reservation.restaurant_id)
      .ilike("promo_code", codeRaw)
      .maybeSingle<PromoRowForCompute>();
    if (promoErr) {
      return json(
        { error: promoErr.message, unavailable_reason: "promo_invalid" },
        400,
      );
    }
    if (!promoRow) {
      return json(
        { error: "Promo code not found.", unavailable_reason: "promo_invalid" },
        400,
      );
    }
    const now = Date.now();
    const startsAtMs = Date.parse(promoRow.starts_at);
    const endsAtMs = promoRow.ends_at ? Date.parse(promoRow.ends_at) : Infinity;
    if (
      !promoRow.is_active ||
      !Number.isFinite(startsAtMs) ||
      now < startsAtMs ||
      now > endsAtMs
    ) {
      return json(
        {
          error: "This promo is no longer active.",
          unavailable_reason: "promo_invalid",
        },
        400,
      );
    }
    promoState = { kind: "set", code: codeRaw, row: promoRow };
  }

  // ── (3) Server-side food + tax computation ────────────────────────
  // Look up menu items by id, sum quantity * price. Reject if any
  // requested menu_item is missing, archived, or belongs to another
  // restaurant.
  const menuItemIds = Array.from(new Set(cartItems.map((c) => c.menu_item_id)));
  if (menuItemIds.length === 0) {
    // Empty cart_items is a valid request — diner is wiping their pre-order.
  }
  type MenuItemRow = {
    id: string;
    restaurant_id: string;
    name: string;
    price: number; // dollars (matches existing menu_items.price column)
    is_available: boolean;
  };
  const menuItemsById = new Map<string, MenuItemRow>();
  if (menuItemIds.length > 0) {
    const { data: menuRowsRaw, error: menuErr } = await adminClient
      .from("menu_items")
      .select("id, restaurant_id, name, price, is_available")
      .in("id", menuItemIds);
    if (menuErr) return json({ error: menuErr.message }, 400);
    for (const r of (menuRowsRaw ?? []) as MenuItemRow[]) {
      if (r.restaurant_id !== reservation.restaurant_id) continue;
      menuItemsById.set(r.id, r);
    }
    for (const id of menuItemIds) {
      const row = menuItemsById.get(id);
      if (!row) {
        return json(
          {
            error: `Menu item ${id} is not available for this restaurant.`,
            unavailable_reason: "menu_item_unavailable",
            menu_item_id: id,
          },
          400,
        );
      }
      if (!row.is_available) {
        return json(
          {
            error: `"${row.name}" is no longer available.`,
            unavailable_reason: "menu_item_unavailable",
            menu_item_id: id,
          },
          400,
        );
      }
    }
  }

  // Build computed lines (cents-based).
  const computedLines: CartLineComputed[] = cartItems.map((c) => {
    const row = menuItemsById.get(c.menu_item_id)!;
    const unitCents = Math.round(Number(row.price) * 100);
    return {
      menu_item_id: c.menu_item_id,
      name: row.name,
      quantity: c.quantity,
      unit_price_cents: unitCents,
      line_total_cents: unitCents * c.quantity,
    };
  });
  const rawFoodCents = computedLines.reduce((s, l) => s + l.line_total_cents, 0);

  // Apply promo discount in cents. Mirrors the client computePromoDiscount
  // semantics but works in integer cents.
  let discountCents = 0;
  if (promoState.kind === "set") {
    discountCents = computePromoDiscountCents(promoState.row, computedLines);
  } else if (promoState.kind === "keep" && promoState.code) {
    // The old promo may have been removed/expired; we re-fetch and
    // re-apply if still valid. If it's no longer valid we silently treat
    // the discount as zero (the original order's discount sticks for
    // historical reconciliation, but the new total just won't honor it).
    const { data: keepPromoRaw } = await adminClient
      .from("promotions")
      .select(
        "id, restaurant_id, is_active, starts_at, ends_at, promo_code, promo_type, discount_value, min_order_amount, eligible_item_ids, free_item_id, bogo_item_ids, buy_quantity, get_quantity",
      )
      .eq("restaurant_id", reservation.restaurant_id)
      .ilike("promo_code", promoState.code)
      .maybeSingle<PromoRowForCompute>();
    if (keepPromoRaw) {
      const now = Date.now();
      const sa = Date.parse(keepPromoRaw.starts_at);
      const ea = keepPromoRaw.ends_at ? Date.parse(keepPromoRaw.ends_at) : Infinity;
      if (keepPromoRaw.is_active && now >= sa && now <= ea) {
        discountCents = computePromoDiscountCents(keepPromoRaw, computedLines);
      }
    }
  }
  const newFoodCents = Math.max(0, rawFoodCents - discountCents);

  // Tax: server pulls from restaurants.tax_rate; falls back to default 13%.
  const { data: restRow, error: restErr } = await adminClient
    .from("restaurants")
    .select("tax_rate, name, timezone")
    .eq("id", reservation.restaurant_id)
    .maybeSingle<{ tax_rate: number | null; name: string | null; timezone: string | null }>();
  if (restErr) return json({ error: restErr.message }, 400);
  const taxRate =
    typeof restRow?.tax_rate === "number" && restRow.tax_rate >= 0
      ? restRow.tax_rate
      : DEFAULT_TAX_RATE_FALLBACK;
  const newTaxCents = Math.round(newFoodCents * taxRate);
  if (
    typeof clientTaxCents === "number" &&
    Math.abs(clientTaxCents - newTaxCents) > 1
  ) {
    console.warn(
      "[modify-reservation] cart tax mismatch — client:",
      clientTaxCents,
      "server:",
      newTaxCents,
      "(using server value)",
    );
  }

  // ── (4) Current totals from existing order + order_items ──────────
  const { data: existingOrderRaw } = await adminClient
    .from("orders")
    .select("id, subtotal, tax_amount, discount_amount, total_amount, order_items(id, line_total)")
    .eq("reservation_id", reservationId)
    .eq("is_preorder", true)
    .maybeSingle();
  const existingOrder = existingOrderRaw as
    | {
        id: string;
        subtotal: number | null;
        tax_amount: number | null;
        discount_amount: number | null;
        total_amount: number | null;
        order_items: Array<{ id: string; line_total: number | null }> | null;
      }
    | null;
  const currentFoodCents = existingOrder
    ? Math.round(Number(existingOrder.subtotal ?? 0) * 100) -
      Math.round(Number(existingOrder.discount_amount ?? 0) * 100)
    : 0;
  const currentTaxCents = existingOrder
    ? Math.round(Number(existingOrder.tax_amount ?? 0) * 100)
    : 0;
  const currentTotalCents = currentFoodCents + currentTaxCents;
  const newTotalCents = newFoodCents + newTaxCents;
  const deltaCents = newTotalCents - currentTotalCents;

  // Shared snapshot of the new cart (used by confirm-modify-payment for
  // delta>0, and for owner/diner notification bodies in all branches).
  const cartSnapshotForResponse = computedLines.map((l) => ({
    menu_item_id: l.menu_item_id,
    name: l.name,
    quantity: l.quantity,
    unit_price_cents: l.unit_price_cents,
    line_total_cents: l.line_total_cents,
  }));
  const newCartSummary = {
    items: cartSnapshotForResponse,
    food_cents: newFoodCents,
    tax_cents: newTaxCents,
    discount_cents: discountCents,
    total_cents: newTotalCents,
    applied_promo_code:
      promoState.kind === "set"
        ? promoState.code
        : promoState.kind === "clear"
          ? null
          : promoState.code,
  };

  // ── (5) Branch on delta ───────────────────────────────────────────
  if (deltaCents > 0) {
    // Diner owes more money. Seed a pending deposit row (or N rows for
    // split-tender) with the new cart snapshot stamped on each; client
    // mounts SplitTenderPaymentForm (or StripePaymentForm for solo) and
    // then calls confirm-modify-payment with change_type='cart_delta'.
    const cartSnapshotJson = {
      items: cartSnapshotForResponse,
      food_cents: newFoodCents,
      tax_cents: newTaxCents,
      discount_cents: discountCents,
      applied_promo_code:
        promoState.kind === "set"
          ? promoState.code
          : promoState.kind === "clear"
            ? null
            : promoState.code,
      special_request: specialRequest || null,
    };

    // 2026-05-28 (PR-K): split-tender awareness for cart deltas. Mirror
    // the party-delta path — if the original booking was split across N
    // payers, the cart upcharge is also split proportionally.
    const { data: chargedRowsForCartRaw } = await adminClient
      .from("reservation_deposit_payments")
      .select("id, amount_cents, payer_email, payer_full_name, payer_user_profile_id")
      .eq("reservation_id", reservationId)
      .eq("status", "charged")
      .order("created_at", { ascending: true });
    const chargedRowsForCart = (chargedRowsForCartRaw ?? []) as Array<{
      id: string;
      amount_cents: number;
      payer_email: string | null;
      payer_full_name: string | null;
      payer_user_profile_id: string | null;
    }>;
    const activeChargedRowsCart = chargedRowsForCart.filter(
      (r) => (r.amount_cents ?? 0) > 0,
    );
    const isSplitTenderCart = activeChargedRowsCart.length >= 2;
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();

    if (isSplitTenderCart) {
      const weights = activeChargedRowsCart.map((r) => r.amount_cents);
      const perRowDelta = proportionalSplitCents(deltaCents, weights);

      // Natural-key dedup mirror.
      const { data: existingPendingRows } = await adminClient
        .from("reservation_deposit_payments")
        .select("id, amount_cents")
        .eq("reservation_id", reservationId)
        .eq("status", "pending")
        .not("pending_cart_snapshot", "is", null)
        .gte("created_at", fiveMinAgo)
        .order("created_at", { ascending: true });
      const existingPendingCart = (existingPendingRows ?? []) as Array<{
        id: string;
        amount_cents: number;
      }>;
      const existingSum = existingPendingCart.reduce(
        (s, r) => s + (r.amount_cents ?? 0),
        0,
      );
      let pendingRowIds: string[] = [];
      let payerSnapshot: Array<{
        row_id: string;
        amount_cents: number;
        payer_full_name: string | null;
        payer_email: string | null;
      }> = [];

      if (
        existingPendingCart.length === activeChargedRowsCart.length &&
        existingSum === deltaCents
      ) {
        pendingRowIds = existingPendingCart.map((r) => r.id);
        payerSnapshot = activeChargedRowsCart.map((charged, i) => ({
          row_id: pendingRowIds[i],
          amount_cents: perRowDelta[i],
          payer_full_name: charged.payer_full_name,
          payer_email: charged.payer_email,
        }));
      } else {
        // Same snapshot stamped on EACH row (confirm-modify-payment reads
        // it from any one — they're identical, replays exactly once).
        const inserts = activeChargedRowsCart.map((charged, i) => ({
          reservation_id: reservationId,
          amount_cents: perRowDelta[i],
          status: "pending" as const,
          payer_email: charged.payer_email,
          payer_full_name: charged.payer_full_name,
          payer_user_profile_id: charged.payer_user_profile_id,
          pending_cart_snapshot: cartSnapshotJson,
        }));
        const { data: insertedRows, error: insertErr } = await adminClient
          .from("reservation_deposit_payments")
          .insert(inserts)
          .select("id");
        if (insertErr || !insertedRows) {
          return json(
            { error: insertErr?.message ?? "Could not prepare split cart payments." },
            400,
          );
        }
        pendingRowIds = (insertedRows as Array<{ id: string }>).map((r) => r.id);
        payerSnapshot = activeChargedRowsCart.map((charged, i) => ({
          row_id: pendingRowIds[i],
          amount_cents: perRowDelta[i],
          payer_full_name: charged.payer_full_name,
          payer_email: charged.payer_email,
        }));
      }

      return json({
        ok: false,
        requires_payment: true,
        is_split_tender: true,
        change_type: "cart_delta",
        deposit_payment_row_ids: pendingRowIds,
        deposit_payment_id: pendingRowIds[0], // legacy convenience
        restaurant_id: reservation.restaurant_id,
        reservation_id: reservationId,
        delta_cents: deltaCents,
        food_cents: newFoodCents - currentFoodCents,
        tax_cents: newTaxCents - currentTaxCents,
        split_payers: payerSnapshot,
        new_cart_summary: newCartSummary,
      });
    }

    // ── Single-payer (legacy) cart-delta path ─────────────────────────
    const payerEmail =
      reservation.guest_email?.trim() || guest?.email?.trim() || null;
    const payerName =
      reservation.guest_full_name?.trim() || guest?.full_name?.trim() || null;
    // 2026-05-27 dedup: mirror the party-delta branch above. On retry,
    // reuse a pending row from the last 5 minutes that targets the same
    // (reservation, amount, payer) tuple. The presence of
    // pending_cart_snapshot distinguishes cart-delta rows from
    // party-delta rows so the two branches don't conflate.
    let pendingRow: { id: string } | null = null;
    const { data: existingPending } = await adminClient
      .from("reservation_deposit_payments")
      .select("id")
      .eq("reservation_id", reservationId)
      .eq("amount_cents", deltaCents)
      .eq("status", "pending")
      .eq("payer_user_profile_id", reservation.user_profile_id ?? "")
      .not("pending_cart_snapshot", "is", null)
      .gte("created_at", fiveMinAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingPending) {
      pendingRow = existingPending as { id: string };
    } else {
      const { data: newRow, error: pendingErr } = await adminClient
        .from("reservation_deposit_payments")
        .insert({
          reservation_id: reservationId,
          amount_cents: deltaCents,
          status: "pending",
          payer_email: payerEmail,
          payer_full_name: payerName,
          payer_user_profile_id: reservation.user_profile_id,
          pending_cart_snapshot: cartSnapshotJson,
        })
        .select("id")
        .single();
      if (pendingErr || !newRow) {
        return json(
          { error: pendingErr?.message ?? "Could not prepare cart payment." },
          400,
        );
      }
      pendingRow = newRow as { id: string };
    }
    // 2026-05-27 BUG-fix: the client mounts StripePaymentForm with
    // amountCents=food_cents + taxCents=tax_cents to compute the diner
    // charge. Previously we returned the NEW totals here, so Stripe was
    // asked to charge the full new cart amount (e.g. $2.83) on top of
    // what the diner already paid for the original cart ($1.41) — a
    // ~2x overcharge. food_cents/tax_cents must be the DELTA the diner
    // owes for this modification, not the new totals. New totals live
    // in new_cart_summary for any caller that needs them (and in
    // pending_cart_snapshot for the confirm-modify-payment replay).
    return json({
      ok: false,
      requires_payment: true,
      is_split_tender: false,
      change_type: "cart_delta",
      deposit_payment_id: (pendingRow as { id: string }).id,
      deposit_payment_row_ids: [(pendingRow as { id: string }).id],
      restaurant_id: reservation.restaurant_id,
      reservation_id: reservationId,
      delta_cents: deltaCents,
      food_cents: newFoodCents - currentFoodCents,
      tax_cents: newTaxCents - currentTaxCents,
      new_cart_summary: newCartSummary,
    });
  }

  // delta <= 0 — apply the change in-place (then refund if shrink).
  // Replace order_items: delete existing, insert new. Wrap in a best-
  // effort sequence; if anything fails partway through, surface the
  // error (no money has moved yet at this point — refund happens AFTER).
  let orderIdToUse = existingOrder?.id ?? null;
  if (!orderIdToUse) {
    // No pre-order row exists yet. Create one so we have something to
    // attach items to. Confirmation code mirrors the reservation's so
    // owner-dashboard joins line up.
    const { data: createdOrder, error: orderCreateErr } = await adminClient
      .from("orders")
      .insert({
        restaurant_id: reservation.restaurant_id,
        reservation_id: reservationId,
        guest_id: reservation.guest_id,
        is_preorder: true,
        order_type: "dine_in",
        status: "pending",
        subtotal: newFoodCents / 100 + discountCents / 100, // pre-discount
        tax_amount: newTaxCents / 100,
        tip_amount: 0,
        total_amount: newTotalCents / 100,
        discount_amount: discountCents > 0 ? discountCents / 100 : null,
        payment_method: "card",
        source: "web",
        confirmation_code: reservation.confirmation_code,
      })
      .select("id")
      .single();
    if (orderCreateErr || !createdOrder) {
      return json(
        { error: orderCreateErr?.message ?? "Failed to create order row." },
        400,
      );
    }
    orderIdToUse = (createdOrder as { id: string }).id;
  } else {
    // Wipe old items
    await adminClient.from("order_items").delete().eq("order_id", orderIdToUse);
    // Update order totals
    await adminClient
      .from("orders")
      .update({
        subtotal: newFoodCents / 100 + discountCents / 100, // pre-discount
        tax_amount: newTaxCents / 100,
        total_amount: newTotalCents / 100,
        discount_amount: discountCents > 0 ? discountCents / 100 : null,
        status: "pending",
      })
      .eq("id", orderIdToUse);
  }
  // Insert new items
  if (computedLines.length > 0) {
    const { error: itemsErr } = await adminClient.from("order_items").insert(
      computedLines.map((l) => ({
        order_id: orderIdToUse,
        menu_item_id: l.menu_item_id,
        name: l.name,
        quantity: l.quantity,
        unit_price: l.unit_price_cents / 100,
        line_total: l.line_total_cents / 100,
        status: "pending",
      })),
    );
    if (itemsErr) return json({ error: itemsErr.message }, 400);
  }
  // Update reservation.applied_promo_code if it changed.
  if (promoState.kind === "set" || promoState.kind === "clear") {
    await adminClient
      .from("reservations")
      .update({
        applied_promo_code:
          promoState.kind === "set" ? promoState.code : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reservationId);
  }

  // Refund the shrink (if any). Mirrors the slot-modify shrink path:
  // find the most recent charged deposit row with a PI and partial-
  // refund |delta| via reverse_transfer.
  // 2026-05-28 (PR-K): split-tender proportional cart-shrink refund.
  // Mirror the party-delta DOWN branch.
  type CartRefundPerRow = {
    row_id: string;
    payer_full_name: string | null;
    payer_email: string | null;
    payment_intent_id: string | null;
    refund_cents: number;
    ok: boolean;
    error?: string;
  };
  type CartRefundResult =
    | { kind: "none" }
    | {
        kind: "refunded";
        amount_cents: number;
        payment_intent_id: string | null;
        refund_id: string | null;
        per_row?: CartRefundPerRow[];
        is_split_tender?: boolean;
      }
    | { kind: "failed"; reason: string; per_row?: CartRefundPerRow[] };
  let cartRefund: CartRefundResult = { kind: "none" };
  if (deltaCents < 0) {
    const refundAmount = -deltaCents;
    const { data: chargedRowsRaw } = await adminClient
      .from("reservation_deposit_payments")
      .select("id, amount_cents, stripe_payment_intent_id, status, payer_email, payer_full_name")
      .eq("reservation_id", reservationId)
      .eq("status", "charged")
      .order("created_at", { ascending: true });
    const chargedRows = (chargedRowsRaw ?? []) as Array<{
      id: string;
      amount_cents: number;
      stripe_payment_intent_id: string | null;
      status: string;
      payer_email: string | null;
      payer_full_name: string | null;
    }>;
    let activeRows = chargedRows.filter(
      (r) => (r.amount_cents ?? 0) > 0 && r.stripe_payment_intent_id,
    );
    // 2026-05-28: preorder-only fallback. Pure preorder bookings (no
    // deposit) have ZERO reservation_deposit_payments rows — the Stripe
    // charge lives on `orders.stripe_payment_intent_id` instead. Without
    // this fallback, cart-shrink on a preorder-only booking silently
    // skipped the refund (diner out the full cart cost). Synthesize a
    // pseudo "row" pointing at the order's PI so the refund loop below
    // treats it identically. amount_cents = full order total so the
    // proportional split picks it up.
    if (activeRows.length === 0) {
      const { data: orderRowsRaw } = await adminClient
        .from("orders")
        .select("id, stripe_payment_intent_id, total_amount")
        .eq("reservation_id", reservationId)
        .eq("is_preorder", true)
        .eq("status", "paid")
        .not("stripe_payment_intent_id", "is", null);
      const orderRows = (orderRowsRaw ?? []) as Array<{
        id: string;
        stripe_payment_intent_id: string | null;
        total_amount: number | string | null;
      }>;
      activeRows = orderRows.map((o) => ({
        id: `order:${o.id}`,
        amount_cents: Math.round(Number(o.total_amount ?? 0) * 100),
        stripe_payment_intent_id: o.stripe_payment_intent_id,
        status: "charged",
        payer_email: reservation.guest_email,
        payer_full_name: reservation.guest_full_name,
      })).filter((r) => r.amount_cents > 0 && r.stripe_payment_intent_id);
    }
    if (activeRows.length > 0) {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (stripeKey) {
        const stripe = await getStripeClient(stripeKey);
        const cappedTotal = Math.min(
          refundAmount,
          activeRows.reduce((s, r) => s + (r.amount_cents ?? 0), 0),
        );
        const perRowAmounts = proportionalSplitCents(
          cappedTotal,
          activeRows.map((r) => r.amount_cents),
        );
        const perRow: CartRefundPerRow[] = [];
        let totalRefunded = 0;
        let firstRefundId: string | null = null;
        let anyFailed = false;
        for (let i = 0; i < activeRows.length; i++) {
          const row = activeRows[i];
          const slice = perRowAmounts[i];
          if (slice <= 0) {
            perRow.push({
              row_id: row.id,
              payer_full_name: row.payer_full_name,
              payer_email: row.payer_email,
              payment_intent_id: row.stripe_payment_intent_id,
              refund_cents: 0,
              ok: true,
            });
            continue;
          }
          try {
            const outcome = await refundPaymentIntent(
              stripe,
              row.stripe_payment_intent_id!,
              "cart_shrink",
              slice,
            );
            if (outcome.ok) {
              totalRefunded += slice;
              if (!firstRefundId) firstRefundId = outcome.refund_id;
              // 2026-05-28: synthetic "order:<uuid>" rows route the
              // DB-side bookkeeping to the orders table instead of RDP.
              if (row.id.startsWith("order:")) {
                const realOrderId = row.id.slice("order:".length);
                const remaining = (row.amount_cents ?? 0) - slice;
                if (remaining <= 0) {
                  await adminClient
                    .from("orders")
                    .update({ status: "refunded" })
                    .eq("id", realOrderId);
                }
                // For partial cart-shrink on a preorder-only order, leave
                // status as "paid" — the order_items table already
                // reflects the new cart contents (modify-reservation
                // replaced items above) so the order total still maps
                // to the live snapshot.
              } else {
                const remaining = (row.amount_cents ?? 0) - slice;
                if (remaining <= 0) {
                  await adminClient
                    .from("reservation_deposit_payments")
                    .update({ status: "refunded", amount_cents: 0 })
                    .eq("id", row.id);
                } else {
                  await adminClient
                    .from("reservation_deposit_payments")
                    .update({ amount_cents: remaining })
                    .eq("id", row.id);
                }
              }
              perRow.push({
                row_id: row.id,
                payer_full_name: row.payer_full_name,
                payer_email: row.payer_email,
                payment_intent_id: row.stripe_payment_intent_id,
                refund_cents: slice,
                ok: true,
              });
            } else {
              anyFailed = true;
              console.warn(
                `[modify-reservation cart] shrink refund failed for row ${row.id}:`,
                outcome.error,
              );
              perRow.push({
                row_id: row.id,
                payer_full_name: row.payer_full_name,
                payer_email: row.payer_email,
                payment_intent_id: row.stripe_payment_intent_id,
                refund_cents: slice,
                ok: false,
                error: outcome.error,
              });
            }
          } catch (err) {
            anyFailed = true;
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(
              `[modify-reservation cart] shrink refund errored for row ${row.id}:`,
              msg,
            );
            perRow.push({
              row_id: row.id,
              payer_full_name: row.payer_full_name,
              payer_email: row.payer_email,
              payment_intent_id: row.stripe_payment_intent_id,
              refund_cents: slice,
              ok: false,
              error: msg,
            });
          }
        }
        if (totalRefunded > 0) {
          cartRefund = {
            kind: "refunded",
            amount_cents: totalRefunded,
            payment_intent_id:
              activeRows.length === 1 ? activeRows[0].stripe_payment_intent_id : null,
            refund_id: firstRefundId,
            per_row: perRow,
            is_split_tender: activeRows.length >= 2,
          };
        } else if (anyFailed) {
          cartRefund = {
            kind: "failed",
            reason: "All per-row refunds failed",
            per_row: perRow,
          };
        }
      }
    }
  }

  // ── (6) Notifications (owner + diner) ─────────────────────────────
  // Helpers are added by sub-agent E2; we call them defensively so a
  // missing template can never block the response.
  try {
    // deno-lint-ignore no-explicit-any
    const ownerMod: any = await import("../_shared/owner-notifications.ts");
    if (typeof ownerMod.notifyOwnerCartModified === "function") {
      await ownerMod.notifyOwnerCartModified({
        supabase: adminClient,
        restaurant_id: reservation.restaurant_id,
        reservation_id: reservationId,
        summary: newCartSummary,
      });
    }
  } catch (e) {
    console.warn("[modify-reservation cart] owner notify skipped:", e);
  }
  try {
    const guestEmailForDiner =
      reservation.guest_email?.trim() || guest?.email?.trim() || null;
    const guestPhoneForDiner =
      reservation.guest_phone?.trim() || guest?.phone?.trim() || null;
    const restaurantName = restRow?.name?.trim() || "the restaurant";
    const itemsLine =
      computedLines.length > 0
        ? `\nNew pre-order: ${computedLines
            .map((l) => `${l.quantity}× ${l.name}`)
            .join(", ")}`
        : "\nPre-order: (cart cleared)";
    const refundLine =
      cartRefund.kind === "refunded"
        ? `\nRefunded: ${formatCents(cartRefund.amount_cents)}`
        : "";
    await sendReservationNotification({
      supabase: adminClient,
      guestId: guest?.id ?? reservation.guest_id ?? null,
      restaurantId: reservation.restaurant_id,
      reservationId,
      // sub-agent E2 is adding the "reservation_cart_modified" template
      // — until that lands the generic helper will fall through with
      // body-only content, which is acceptable.
      type: "reservation_cart_modified",
      email: guestEmailForDiner,
      phone: guestPhoneForDiner,
      subject: `Your pre-order at ${restaurantName} was updated`,
      body:
        `Your pre-order at ${restaurantName} has been updated.` +
        itemsLine +
        `\nNew total: ${formatCents(newTotalCents)}` +
        refundLine,
    });
  } catch (e) {
    console.warn("[modify-reservation cart] diner notify skipped:", e);
  }

  return json({
    ok: true,
    requires_payment: false,
    change_type: "cart_delta",
    reservation_id: reservationId,
    delta_cents: deltaCents,
    food_cents: newFoodCents,
    tax_cents: newTaxCents,
    new_cart_summary: newCartSummary,
    refund: cartRefund,
  });
}

// Cents-based promo discount — mirrors apps/web/src/lib/computePromoDiscount.ts
// semantics. Operates on integer cents so we never lose pennies.
function computePromoDiscountCents(
  promo: {
    promo_type: "bogo" | "percentage" | "fixed" | "free_item";
    discount_value: number | null;
    min_order_amount: number | null;
    eligible_item_ids: string[] | null;
    bogo_item_ids: string[] | null;
    free_item_id: string | null;
    buy_quantity: number | null;
    get_quantity: number | null;
  },
  cart: CartLineComputed[],
): number {
  const cartTotalCents = cart.reduce((s, l) => s + l.line_total_cents, 0);
  if (cartTotalCents <= 0) return 0;
  const minOrderCents =
    promo.min_order_amount != null
      ? Math.round(Number(promo.min_order_amount) * 100)
      : null;

  switch (promo.promo_type) {
    case "bogo": {
      const eligibleIds = promo.bogo_item_ids ?? [];
      const eligible =
        eligibleIds.length > 0
          ? cart.filter((l) => eligibleIds.includes(l.menu_item_id))
          : cart;
      const buy = promo.buy_quantity ?? 1;
      const get = promo.get_quantity ?? 1;
      const cycle = buy + get;
      let discount = 0;
      for (const line of eligible) {
        const freeUnits = Math.floor(line.quantity / cycle) * get;
        if (freeUnits > 0) discount += freeUnits * line.unit_price_cents;
      }
      return Math.min(discount, cartTotalCents);
    }
    case "percentage": {
      if (!promo.discount_value) return 0;
      if (minOrderCents != null && cartTotalCents < minOrderCents) return 0;
      const eligibleIds = promo.eligible_item_ids ?? [];
      const eligible =
        eligibleIds.length > 0
          ? cart.filter((l) => eligibleIds.includes(l.menu_item_id))
          : cart;
      const eligibleSubtotal = eligible.reduce(
        (s, l) => s + l.line_total_cents,
        0,
      );
      return Math.min(
        Math.round(eligibleSubtotal * (Number(promo.discount_value) / 100)),
        cartTotalCents,
      );
    }
    case "fixed": {
      if (!promo.discount_value) return 0;
      if (minOrderCents != null && cartTotalCents < minOrderCents) return 0;
      const eligibleIds = promo.eligible_item_ids ?? [];
      const eligible =
        eligibleIds.length > 0
          ? cart.filter((l) => eligibleIds.includes(l.menu_item_id))
          : cart;
      const eligibleSubtotal = eligible.reduce(
        (s, l) => s + l.line_total_cents,
        0,
      );
      return Math.min(
        Math.round(Number(promo.discount_value) * 100),
        eligibleSubtotal,
        cartTotalCents,
      );
    }
    case "free_item": {
      if (!promo.free_item_id) return 0;
      const line = cart.find((l) => l.menu_item_id === promo.free_item_id);
      if (!line) return 0;
      return Math.min(line.unit_price_cents, cartTotalCents);
    }
    default:
      return 0;
  }
}
