// @ts-nocheck
// notify-no-show: fires after a restaurant owner marks a reservation as
// 'no_show'. Sends the diner an SMS + email letting them know the
// deposit was kept and how to dispute (call the restaurant within 48h).
// Silent no-show forfeits drive chargebacks; surfacing the decision and
// giving a quick path to dispute closes that loop.
//
// Anon-callable (verify_jwt = false). Caller is typically the owner
// dashboard's mark-no-show flow — we use the service-role admin client
// to look up reservation/guest/restaurant rows.
//
// Body: { reservation_id: string }
//
// Idempotent: a 'sent' communication_log row with type='reservation_no_show'
// and matching (guest_id, reservation_id, restaurant_id) short-circuits
// the function with { ok: true, already_sent: true } so retries are safe.
//
// Requires the reservation to currently be in status='no_show' — anything
// else returns 400. This is the trust boundary: callers can't trick the
// fn into emailing diners of confirmed reservations.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import {
  enforceRateLimit,
  rateLimitIdentifier,
  RateLimitError,
} from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { NotifyNoShowSchema } from "../_shared/validation/restaurant-ops.ts";
import {
  buildNoShowBody,
  formatReservationDate,
  sendReservationNotification,
} from "../_shared/reservation-notifications.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

type ReservationRow = {
  id: string;
  restaurant_id: string;
  guest_id: string | null;
  user_profile_id: string | null;
  reserved_at: string;
  party_size: number;
  status: string;
  confirmation_code: string | null;
  guest_full_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
};

type RestaurantRow = {
  name: string | null;
  timezone: string | null;
  phone: string | null;
};

type GuestRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

type DepositRow = {
  amount_cents: number | null;
  status: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    try {
      await enforceRateLimit(
        supabaseAdmin,
        "notify-no-show",
        rateLimitIdentifier(req),
        { limit: 30, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const parsed = await parseJsonBody(req, NotifyNoShowSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const reservationId = parsed.data.reservation_id;

    // 1. Reservation — must currently be no_show. Anything else is rejected
    //    so the fn can't be used to spam diners of active reservations.
    const { data: reservationRaw, error: rErr } = await supabaseAdmin
      .from("reservations")
      .select(
        "id, restaurant_id, guest_id, user_profile_id, reserved_at, party_size, status, confirmation_code, guest_full_name, guest_email, guest_phone",
      )
      .eq("id", reservationId)
      .maybeSingle();
    if (rErr) return jsonRes({ error: rErr.message }, 400);
    const reservation = reservationRaw as ReservationRow | null;
    if (!reservation) return jsonRes({ error: "Reservation not found" }, 404);
    if (reservation.status !== "no_show") {
      return jsonRes(
        {
          error: "Reservation is not in no_show status",
          actual_status: reservation.status,
        },
        400,
      );
    }

    // 2. Idempotency — bail if we've already emailed this diner about this
    //    no-show. Only checked when we have a guest_id (the FK target for
    //    communication_log.guest_id). Guest-checkout rows without a guests
    //    link fall through and may be re-emailed on retry — acceptable
    //    because there's no canonical id to dedupe against.
    if (reservation.guest_id) {
      const { data: existingLog } = await supabaseAdmin
        .from("communication_log")
        .select("id")
        .eq("guest_id", reservation.guest_id)
        .eq("campaign_id", reservationId)
        .eq("type", "reservation_no_show")
        .eq("status", "sent")
        .limit(1)
        .maybeSingle();
      if (existingLog) {
        return jsonRes({ ok: true, already_sent: true });
      }
    }

    // 3. Restaurant — name + phone for body, timezone for date formatting.
    const { data: restaurantRaw } = await supabaseAdmin
      .from("restaurants")
      .select("name, timezone, phone")
      .eq("id", reservation.restaurant_id)
      .maybeSingle();
    const restaurant = restaurantRaw as RestaurantRow | null;
    const restaurantName = restaurant?.name?.trim() || "the restaurant";
    const restaurantPhone = restaurant?.phone?.trim() || null;
    const tz = restaurant?.timezone?.trim() || "America/Toronto";

    // 4. Guest contact — reservation row carries guest_email/guest_phone
    //    directly for guest checkout. For logged-in diners we may need to
    //    fall back to the linked guests row. Prefer reservation-level
    //    columns (they reflect what the diner entered at booking time).
    let guest: GuestRow | null = null;
    if (reservation.guest_id) {
      const { data: guestRaw } = await supabaseAdmin
        .from("guests")
        .select("id, full_name, email, phone")
        .eq("id", reservation.guest_id)
        .maybeSingle();
      guest = (guestRaw as GuestRow | null) ?? null;
    }
    const guestName =
      reservation.guest_full_name?.trim() ||
      guest?.full_name?.trim() ||
      "there";
    const guestEmail =
      reservation.guest_email?.trim() || guest?.email?.trim() || null;
    const guestPhone =
      reservation.guest_phone?.trim() || guest?.phone?.trim() || null;

    // 5. Deposit amount — sum 'charged' rows on reservation_deposit_payments.
    //    Split-tender reservations have multiple rows; single-payer has one.
    //    If no rows are charged the message still goes (deposit will read
    //    "$0.00") so the diner is at least notified about the status flip.
    //    Decided NOT to fall back to orders.total_cents — order totals
    //    represent pre-order food cost, not the deposit forfeiture amount.
    const { data: depositRows } = await supabaseAdmin
      .from("reservation_deposit_payments")
      .select("amount_cents, status")
      .eq("reservation_id", reservationId)
      .eq("status", "charged");
    const depositAmountCents = ((depositRows ?? []) as DepositRow[]).reduce(
      (sum, r) => sum + (typeof r.amount_cents === "number" ? r.amount_cents : 0),
      0,
    );

    // 6. No contact info — bail without firing. We don't insert a
    //    communication_log row in this case because the helper itself
    //    would skip the insert (status='skipped' on both channels).
    if (!guestEmail && !guestPhone) {
      return jsonRes({
        ok: true,
        sent: { email: false, sms: false },
        reason: "no_contact",
      });
    }

    // 7. Build body + dispatch. The helper currently sends the same `body`
    //    to both channels; we feed it the SMS body (under 160 chars) so the
    //    SMS render is clean, and rely on the email subject + a follow-up
    //    body call for the longer email block. Since the helper's signature
    //    only accepts one body, we send the SMS-shaped body so SMS stays
    //    under the 160-char cap; email gets the same text but with the
    //    no-show subject. If divergent SMS vs email copy is needed later,
    //    split this into two sendReservationNotification calls (one
    //    SMS-only, one email-only).
    const dateLabel = formatReservationDate(new Date(reservation.reserved_at), tz);
    const { subject, body, smsBody } = buildNoShowBody({
      guestName,
      restaurantName,
      restaurantPhone,
      reservationDateLabel: dateLabel,
      partySize: reservation.party_size,
      confirmationCode: reservation.confirmation_code?.trim() || "",
      depositAmountCents,
    });

    // Fire SMS-only call with the short SMS body (email skipped) and
    // email-only call with the long body (sms skipped). Two calls so
    // the long email body doesn't blow past the SMS 160-char cap and the
    // short SMS body doesn't lose dispute instructions in the email.
    const smsResult = await sendReservationNotification({
      supabase: supabaseAdmin,
      guestId: reservation.guest_id,
      restaurantId: reservation.restaurant_id,
      reservationId,
      type: "reservation_no_show",
      email: null,
      phone: guestPhone,
      subject,
      body: smsBody,
    });

    const emailResult = await sendReservationNotification({
      supabase: supabaseAdmin,
      guestId: reservation.guest_id,
      restaurantId: reservation.restaurant_id,
      reservationId,
      type: "reservation_no_show",
      email: guestEmail,
      phone: null,
      subject,
      body,
    });

    return jsonRes({
      ok: true,
      sent: {
        email: emailResult.email.status === "sent",
        sms: smsResult.sms.status === "sent",
      },
      channels: {
        email: emailResult.email,
        sms: smsResult.sms,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[notify-no-show] error:", msg);
    return jsonRes({ error: msg }, 500);
  }
});
