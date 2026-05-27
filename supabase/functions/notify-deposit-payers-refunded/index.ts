// notify-deposit-payers-refunded: fires after a reservation with a split
// deposit is cancelled, emailing every non-organizer payer to let them
// know their share was refunded. Otherwise Stripe asynchronously credits
// their card and the friend has no idea why money showed up.
//
// Invoked fire-and-forget from `cancel-reservation` after the deposit
// refund loop completes. Anon-callable (verify_jwt = false). Caller
// passes `refunded_payer_ids` so we only email rows that actually got
// refunded this cycle — retries with the same set are idempotent because
// the friend won't get a duplicate email so long as the caller dedupes.
//
// Body: { reservation_id: string, refunded_payer_ids?: string[] }
// - When refunded_payer_ids is provided, only email those rows.
// - When omitted, email every non-organizer 'refunded' row on this
//   reservation (use cautiously — caller is responsible for dedupe).
//
// Resend env: RESEND_API_KEY + RESEND_FROM_EMAIL (fallback
// "Cenaiva <noreply@cenaiva.com>"). Rate-limited 30/60s per IP.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.0.0";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { NotifyDepositPayersRefundedSchema } from "../_shared/validation/restaurant-ops.ts";
import { formatCents } from "../_shared/money.ts";

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
  reserved_at: string;
  party_size: number;
  guest_full_name: string | null;
  guest_email: string | null;
  user_profile_id: string | null;
};

type RestaurantRow = {
  name: string | null;
  timezone: string | null;
  currency: string | null;
};

type DepositPaymentRow = {
  id: string;
  payer_email: string | null;
  payer_full_name: string | null;
  amount_cents: number;
  status: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    try {
      await enforceRateLimit(
        supabaseAdmin,
        "notify-deposit-payers-refunded",
        rateLimitIdentifier(req),
        { limit: 30, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const parsed = await parseJsonBody(req, NotifyDepositPayersRefundedSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const reservationId = parsed.data.reservation_id;
    const refundedPayerIds: string[] | null =
      parsed.data.refunded_payer_ids && parsed.data.refunded_payer_ids.length > 0
        ? parsed.data.refunded_payer_ids
        : null;

    // Load reservation + restaurant for the email body.
    const { data: reservationRaw, error: rErr } = await supabaseAdmin
      .from("reservations")
      .select("id, restaurant_id, reserved_at, party_size, guest_full_name, guest_email, user_profile_id")
      .eq("id", reservationId)
      .maybeSingle();
    if (rErr) return jsonRes({ error: rErr.message }, 400);
    const reservation = reservationRaw as ReservationRow | null;
    if (!reservation) return jsonRes({ error: "Reservation not found" }, 404);

    const { data: restaurantRaw } = await supabaseAdmin
      .from("restaurants")
      .select("name, timezone, currency")
      .eq("id", reservation.restaurant_id)
      .maybeSingle();
    const restaurant = restaurantRaw as RestaurantRow | null;
    const restaurantName = restaurant?.name?.trim() ?? "the restaurant";
    const tz = restaurant?.timezone ?? "America/Toronto";
    const currency = (restaurant?.currency ?? "CAD").toUpperCase();
    const reservedDate = new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: tz,
    }).format(new Date(reservation.reserved_at));

    // Resolve the organizer's email so we can exclude their row. The
    // reservation may carry guest_email directly (guest checkout) OR be
    // linked to a user_profile (logged-in diner). Try guest_email first,
    // then fall back to the profile's email.
    let organizerEmail = reservation.guest_email?.trim().toLowerCase() ?? null;
    if (!organizerEmail && reservation.user_profile_id) {
      const { data: profileRaw } = await supabaseAdmin
        .from("user_profiles")
        .select("email")
        .eq("id", reservation.user_profile_id)
        .maybeSingle();
      const profile = profileRaw as { email: string | null } | null;
      organizerEmail = profile?.email?.trim().toLowerCase() ?? null;
    }
    const organizerName = reservation.guest_full_name?.trim() ?? "Your friend";

    // Pull deposit payment rows. If the caller provided
    // refunded_payer_ids, restrict to those; otherwise pull every
    // 'refunded' row on this reservation.
    let query = supabaseAdmin
      .from("reservation_deposit_payments")
      .select("id, payer_email, payer_full_name, amount_cents, status")
      .eq("reservation_id", reservationId);
    if (refundedPayerIds && refundedPayerIds.length > 0) {
      query = query.in("id", refundedPayerIds);
    } else {
      query = query.eq("status", "refunded");
    }
    const { data: rowsRaw, error: rowsErr } = await query;
    if (rowsErr) return jsonRes({ error: rowsErr.message }, 400);
    const rows = (rowsRaw ?? []) as DepositPaymentRow[];

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const resend = resendKey ? new Resend(resendKey) : null;
    const fromAddress =
      Deno.env.get("RESEND_FROM_EMAIL") ?? "Cenaiva <noreply@cenaiva.com>";

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      const email = row.payer_email?.trim();
      if (!email) {
        skipped++;
        continue;
      }
      // Skip the organizer's row — they get the standard cancel toast +
      // notification through the cancel-reservation flow itself.
      if (organizerEmail && email.toLowerCase() === organizerEmail) {
        skipped++;
        continue;
      }

      const recipientName = row.payer_full_name?.trim() ?? "there";
      const amountDisplay = `${currency} ${formatCents(row.amount_cents)}`;

      const subject = `Your ${amountDisplay} refund — ${organizerName}'s ${restaurantName} reservation was cancelled`;
      const text =
        `Hi ${recipientName},\n\n` +
        `${organizerName}'s reservation at ${restaurantName} on ${reservedDate} was cancelled.\n\n` +
        `We've refunded your ${amountDisplay} share to the card you used. ` +
        `Refunds typically appear within 5–10 business days.\n\n` +
        `— Cenaiva`;
      const html =
        `<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">` +
        `<h2 style="font-family: serif; color: #111;">Your ${amountDisplay} refund</h2>` +
        `<p>Hi ${recipientName},</p>` +
        `<p><strong>${organizerName}'s</strong> reservation at <strong>${restaurantName}</strong> on ${reservedDate} was cancelled.</p>` +
        `<p style="margin: 24px 0; padding: 16px; background: #FAF7EA; border-left: 4px solid #D4AF37; border-radius: 4px;">` +
        `We've refunded <strong>${amountDisplay}</strong> to the card you used. Refunds typically appear within 5–10 business days.` +
        `</p>` +
        `<p style="color: #666; font-size: 14px;">No action needed on your end.</p>` +
        `<p style="color: #999; font-size: 12px; margin-top: 32px;">— Cenaiva</p>` +
        `</div>`;

      if (!resend) {
        // No Resend key configured — count as skipped so the caller
        // knows nothing went out.
        skipped++;
        continue;
      }

      try {
        const { error } = await resend.emails.send({
          from: fromAddress,
          to: email,
          subject,
          html,
          text,
        });
        if (error) {
          failed++;
          console.warn("[notify-deposit-payers-refunded] resend error:", error.message);
        } else {
          sent++;
        }
      } catch (err) {
        failed++;
        console.warn(
          "[notify-deposit-payers-refunded] resend threw:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    return jsonRes({
      ok: true,
      emailed_count: sent,
      total_rows: rows.length,
      sent,
      skipped,
      failed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
