// confirm-modify-payment: finalize a reservation modification after the
// diner has paid the deposit delta via Stripe.
//
// Flow:
//   1. Verify the PI succeeded.
//   2. Verify PI metadata.deposit_payment_ids includes the row we're flipping
//      (same metadata-binding pattern as confirm-deposit-paid).
//   3. Verify PI metadata.restaurant_id matches the reservation's restaurant.
//   4. Flip the pending reservation_deposit_payments row → charged.
//   5. Validate the new slot (shift availability, capacity, double-book).
//   6. Apply the modification via modify_reservation_slot RPC.
//   7. On RPC failure (e.g. slot got taken while paying), auto-refund the
//      just-paid PI and return error.
//   8. Send the modification SMS + email (with "Deposit paid: $X.XX").
//
// Anon-callable. Caller is auth'd via either:
//   - Bearer token (matches reservation.user_profile_id), OR
//   - confirmation_code + matching guest_email (guest checkout).
//
// Body: see ConfirmModifyPaymentSchema in _shared/validation/payment.ts.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { ConfirmModifyPaymentSchema } from "../_shared/validation/payment.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";
import { closureUnavailableMessage, findClosedSpecialDayForDate } from "../_shared/closures.ts";
import { localDayOfWeek, localToUTC } from "../_shared/time.ts";
import {
  formatReservationDate,
  sendReservationNotification,
} from "../_shared/reservation-notifications.ts";
import { formatCents } from "../_shared/money.ts";
import { refundPaymentIntent } from "../_shared/stripe-refund.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DepositRow = {
  id: string;
  reservation_id: string;
  amount_cents: number;
  status: string;
  stripe_payment_intent_id: string | null;
};

type ReservationRow = {
  id: string;
  restaurant_id: string;
  guest_id: string | null;
  user_profile_id: string | null;
  reserved_at: string;
  party_size: number;
  status: string | null;
  internal_notes: string | null;
  confirmation_code: string | null;
  guest_full_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  event_id: string | null;
  promotion_id: string | null;
  applied_promo_code: string | null;
};

type RestaurantRow = {
  name: string | null;
  slug: string | null;
  timezone: string | null;
  phone: string | null;
  hours_json: unknown;
  settings_json: { turnTimeMinutes?: number | null } | null;
  stripe_account_id: string | null;
};

type ShiftRow = {
  id: string;
  start_time: string | null;
  end_time: string | null;
  turn_time_minutes: number | null;
  max_covers: number | null;
};

function jsonRes(body: unknown, status = 200): Response {
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

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    try {
      await enforceRateLimit(
        supabaseAdmin,
        "confirm-modify-payment",
        rateLimitIdentifier(req),
        { limit: 30, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const parsed = await parseJsonBody(req, ConfirmModifyPaymentSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const {
      reservation_id: reservationId,
      deposit_payment_row_id: depositRowId,
      payment_intent_id: paymentIntentId,
      date,
      time,
      party_size: partySize,
      special_request: specialRequest = "",
      confirmation_code: providedCode = "",
      email: providedEmail = "",
    } = parsed.data;

    // Load reservation + deposit row.
    const { data: reservationRaw, error: reservationErr } = await supabaseAdmin
      .from("reservations")
      .select(
        "id, restaurant_id, guest_id, user_profile_id, reserved_at, party_size, status, internal_notes, confirmation_code, guest_full_name, guest_email, guest_phone, event_id, promotion_id, applied_promo_code",
      )
      .eq("id", reservationId)
      .maybeSingle();
    if (reservationErr) return jsonRes({ error: reservationErr.message }, 400);
    const reservation = reservationRaw as ReservationRow | null;
    if (!reservation) return jsonRes({ error: "Reservation not found" }, 404);

    const { data: depositRowRaw } = await supabaseAdmin
      .from("reservation_deposit_payments")
      .select("id, reservation_id, amount_cents, status, stripe_payment_intent_id")
      .eq("id", depositRowId)
      .maybeSingle();
    const depositRow = depositRowRaw as DepositRow | null;
    if (!depositRow) return jsonRes({ error: "Deposit row not found" }, 404);
    if (depositRow.reservation_id !== reservationId) {
      return jsonRes({ error: "Deposit row does not match reservation" }, 400);
    }

    // Auth — bearer OR confirmation_code + email. Mirrors modify-reservation.
    const authHeader = req.headers.get("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    let authed = false;
    if (bearerToken) {
      const { data: { user } } = await supabaseAdmin.auth.getUser(bearerToken);
      if (user) {
        const { data: profile } = await supabaseAdmin
          .from("user_profiles")
          .select("id")
          .eq("auth_user_id", user.id)
          .maybeSingle();
        const profileId = (profile as { id: string } | null)?.id ?? null;
        if (profileId && reservation.user_profile_id === profileId) {
          authed = true;
        }
      }
    }
    if (!authed && providedCode) {
      const expectedCode = (reservation.confirmation_code ?? "").trim();
      const reservationEmail = (reservation.guest_email ?? "").trim().toLowerCase();
      if (
        expectedCode &&
        expectedCode.toLowerCase() === providedCode.trim().toLowerCase() &&
        reservationEmail &&
        reservationEmail === providedEmail.trim().toLowerCase()
      ) {
        authed = true;
      }
    }
    if (!authed) return jsonRes({ error: "Authentication required" }, 401);

    // Idempotency: deposit row already charged AND tied to this PI → finish silently.
    if (
      depositRow.status === "charged" &&
      depositRow.stripe_payment_intent_id === paymentIntentId
    ) {
      // Don't re-apply the modify (idempotent caller probably already
      // saw success); just return the current reservation state.
      return jsonRes({
        ok: true,
        idempotent: true,
        reservation_id: reservationId,
        reserved_at: reservation.reserved_at,
        party_size: reservation.party_size,
        deposit_adjustment: {
          kind: "charged",
          amount_cents: depositRow.amount_cents,
          payment_intent_id: paymentIntentId,
        },
      });
    }

    if (depositRow.status !== "pending") {
      return jsonRes(
        { error: `Deposit row is in unexpected status: ${depositRow.status}` },
        409,
      );
    }

    // Verify PI with Stripe.
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured" }, 500);
    const stripe = await getStripeClient(stripeKey);

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== "succeeded" && intent.status !== "processing") {
      return jsonRes(
        { error: `PaymentIntent not paid (status: ${intent.status})` },
        400,
      );
    }
    if ((intent.amount ?? 0) < depositRow.amount_cents) {
      return jsonRes(
        {
          error: `PaymentIntent amount (${intent.amount}¢) is less than deposit delta (${depositRow.amount_cents}¢)`,
        },
        400,
      );
    }

    // Metadata binding (same hardening as confirm-deposit-paid).
    const piRestaurantId = typeof intent.metadata?.restaurant_id === "string"
      ? intent.metadata.restaurant_id
      : null;
    if (!piRestaurantId || piRestaurantId !== reservation.restaurant_id) {
      return jsonRes({ error: "pi_restaurant_mismatch" }, 400);
    }
    const stampedRaw = typeof intent.metadata?.deposit_payment_ids === "string"
      ? intent.metadata.deposit_payment_ids
      : "";
    const stamped = stampedRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!stamped.includes(depositRowId)) {
      return jsonRes({ error: "pi_payment_id_mismatch" }, 400);
    }

    // Flip the row to charged BEFORE applying the modify, so a crash between
    // them leaves the diner paid + the system aware of the payment. The
    // modify_reservation_slot call below applies the actual slot change;
    // on failure we refund.
    const { error: flipErr } = await supabaseAdmin
      .from("reservation_deposit_payments")
      .update({
        status: "charged",
        stripe_payment_intent_id: paymentIntentId,
        paid_at: new Date().toISOString(),
      })
      .eq("id", depositRowId);
    if (flipErr) return jsonRes({ error: flipErr.message }, 400);

    // Look up restaurant + run the same shift/capacity validation as
    // modify-reservation. Below this point, any rejection must auto-refund.
    const refundAndError = async (
      message: string,
      reason: string,
      status = 409,
    ): Promise<Response> => {
      try {
        await refundPaymentIntent(
          stripe,
          paymentIntentId,
          "modify_deposit_delta_auto_refund",
          depositRow.amount_cents,
        );
        // Mark the row refunded so the books reconcile.
        await supabaseAdmin
          .from("reservation_deposit_payments")
          .update({ status: "refunded", amount_cents: 0 })
          .eq("id", depositRowId);
      } catch (refundErr) {
        console.error(
          "[confirm-modify-payment] auto-refund failed:",
          refundErr instanceof Error ? refundErr.message : refundErr,
        );
      }
      return jsonRes(
        { error: message, unavailable_reason: reason, refunded: true },
        status,
      );
    };

    const { data: restaurantRaw, error: restaurantErr } = await supabaseAdmin
      .from("restaurants")
      .select("name, slug, timezone, phone, hours_json, settings_json, stripe_account_id")
      .eq("id", reservation.restaurant_id)
      .maybeSingle();
    if (restaurantErr) return refundAndError(restaurantErr.message, "restaurant_lookup_failed", 400);
    const restaurant = restaurantRaw as RestaurantRow | null;

    const timezone = restaurant?.timezone || "America/Toronto";
    const restaurantName = restaurant?.name?.trim() || "the restaurant";
    const restaurantSlug = restaurant?.slug?.trim() || null;
    const restaurantPhone = restaurant?.phone?.trim() || null;

    const closure = findClosedSpecialDayForDate(restaurant?.hours_json, date);
    if (closure) {
      return refundAndError(closureUnavailableMessage(closure), "closed", 409);
    }

    const reservedAtIso = localToUTC(date, time, timezone);
    const reservedAt = new Date(reservedAtIso);
    if (Number.isNaN(reservedAt.getTime()) || reservedAt.getTime() < Date.now()) {
      return refundAndError("Reservation time must be in the future", "past_time", 400);
    }

    const dayOfWeek = localDayOfWeek(date, timezone);
    const requestedMinute = parseTimeToMinutes(time);
    const { data: shifts } = await supabaseAdmin
      .from("shifts")
      .select("id, start_time, end_time, turn_time_minutes, max_covers")
      .eq("restaurant_id", reservation.restaurant_id)
      .eq("is_active", true)
      .contains("days_of_week", [dayOfWeek])
      .returns<ShiftRow[]>();
    const selectedShift = (shifts ?? []).find((shift) =>
      requestedMinute == null ? false : shiftContainsMinute(shift, requestedMinute),
    );
    if (!selectedShift) {
      return refundAndError("No active shift is available at that time", "no_shift", 400);
    }

    const turnMinutes =
      (typeof restaurant?.settings_json?.turnTimeMinutes === "number"
        ? restaurant.settings_json.turnTimeMinutes
        : null) || selectedShift.turn_time_minutes || 90;

    const previousReservedAt = reservation.reserved_at;
    const previousPartySize = reservation.party_size;
    const previousDateLabel = formatReservationDate(new Date(previousReservedAt), timezone);
    const nextDateLabel = formatReservationDate(reservedAt, timezone);

    // Apply the modification.
    const { data: modifyRows, error: modifyError } = await supabaseAdmin.rpc(
      "modify_reservation_slot",
      {
        p_reservation_id: reservationId,
        p_restaurant_id: reservation.restaurant_id,
        p_shift_id: selectedShift.id,
        p_new_reserved_at: reservedAtIso,
        p_new_party_size: partySize,
        p_turn_minutes: turnMinutes,
      },
    );
    if (modifyError) {
      const code = (modifyError as { code?: string }).code;
      if (code === "P0001") {
        return refundAndError(
          "That time was just taken. We refunded your payment.",
          "slot_taken",
          409,
        );
      }
      if (code === "P0002") {
        return refundAndError(
          "That time no longer has cover capacity. We refunded your payment.",
          "over_cover_cap",
          409,
        );
      }
      return refundAndError(modifyError.message ?? "Modification failed", "rpc_error", 400);
    }
    const modifyRow = Array.isArray(modifyRows) ? modifyRows[0] : modifyRows;
    const nextTableIds: string[] = Array.isArray(modifyRow?.out_table_ids)
      ? modifyRow.out_table_ids.filter((id: unknown): id is string => typeof id === "string")
      : [];
    if (nextTableIds.length === 0) {
      return refundAndError(
        "That time was just taken. We refunded your payment.",
        "slot_taken",
        409,
      );
    }

    // Update notes (mirror modify-reservation's bookkeeping).
    const marker = `[Diner modified booking at ${new Date().toISOString()}]`;
    const previousNotes = reservation.internal_notes?.trim();
    const internalNotes = previousNotes ? `${previousNotes}\n${marker}` : marker;
    await supabaseAdmin
      .from("reservations")
      .update({
        special_request: specialRequest || null,
        internal_notes: internalNotes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reservationId);

    // Build + send notification.
    const guestName = reservation.guest_full_name?.trim() || "there";
    const guestEmail = reservation.guest_email || null;
    const guestPhone = reservation.guest_phone || null;
    const codeLine = reservation.confirmation_code?.trim()
      ? ` Confirmation code: ${reservation.confirmation_code.trim()}.`
      : "";

    let eventLine = "";
    let promoLine = "";
    if (reservation.event_id) {
      const { data: ev } = await supabaseAdmin
        .from("events")
        .select("name")
        .eq("id", reservation.event_id)
        .maybeSingle<{ name: string | null }>();
      if (ev?.name) eventLine = ` Event: ${ev.name}.`;
    }
    if (reservation.promotion_id) {
      const { data: pr } = await supabaseAdmin
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

    const body =
      `Hi ${guestName}, your reservation at ${restaurantName} was updated from ${previousDateLabel} ` +
      `to ${nextDateLabel} for ${partySize} ${partySize === 1 ? "guest" : "guests"}.` +
      codeLine + eventLine + promoLine +
      `\nDeposit charged: ${formatCents(depositRow.amount_cents)}` +
      (restaurantPhone ? `\nNeed to reach the restaurant directly? Call ${restaurantPhone}.` : "");
    void restaurantSlug; // reserved for future manage-link inclusion in modify SMS
    await sendReservationNotification({
      supabase: supabaseAdmin,
      guestId: reservation.guest_id ?? null,
      restaurantId: reservation.restaurant_id,
      reservationId,
      type: "reservation_modification",
      email: guestEmail,
      phone: guestPhone,
      subject: `Your reservation at ${restaurantName} was updated`,
      body,
    });

    return jsonRes({
      ok: true,
      reservation_id: reservationId,
      reserved_at: reservedAtIso,
      party_size: partySize,
      table_ids: nextTableIds,
      previous_reserved_at: previousReservedAt,
      previous_party_size: previousPartySize,
      deposit_adjustment: {
        kind: "charged",
        amount_cents: depositRow.amount_cents,
        payment_intent_id: paymentIntentId,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
