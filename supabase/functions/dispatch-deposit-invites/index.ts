// dispatch-deposit-invites: Phase 7 of diner auth overhaul (2026-05-15).
//
// After a diner books a party with a split deposit, this fn fires once
// per reservation to email every non-organizer payer their magic link
// to `/deposit/<payment_id>`. The organizer's row is excluded (they
// paid inline at checkout via Stripe Elements).
//
// Idempotent: only sends to rows where status='pending' AND
// stripe_payment_intent_id IS NULL. Once a payer pays, their row
// flips to 'charged' so re-running this never double-sends.
//
// Email-only for v1 — the `reservation_deposit_payments` schema only
// has `payer_email`, not `payer_phone`. Adding payer_phone +
// SMS-via-Twilio is a future enhancement.
//
// Anon-callable. Body: { reservation_id, app_origin?: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend@4.0.0";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { DispatchDepositInvitesSchema } from "../_shared/validation/restaurant-ops.ts";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    try {
      await enforceRateLimit(
        supabaseAdmin,
        "dispatch-deposit-invites",
        rateLimitIdentifier(req),
        { limit: 10, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const parsed = await parseJsonBody(req, DispatchDepositInvitesSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const reservationId = parsed.data.reservation_id;
    const appOrigin = parsed.data.app_origin ?? "https://cenaiva.com";
    // EmailLower in the schema already lowercases + trims.
    const organizerEmail = parsed.data.organizer_email ?? null;

    // Resolve reservation + restaurant for the email body.
    const { data: reservationRaw } = await supabaseAdmin
      .from("reservations")
      .select("id, restaurant_id, reserved_at, party_size, guest_full_name")
      .eq("id", reservationId)
      .maybeSingle();
    const reservation = reservationRaw as
      | { id: string; restaurant_id: string; reserved_at: string; party_size: number; guest_full_name: string | null }
      | null;
    if (!reservation) return jsonRes({ error: "Reservation not found" }, 404);

    const { data: restaurantRaw } = await supabaseAdmin
      .from("restaurants")
      .select("name, timezone, currency")
      .eq("id", reservation.restaurant_id)
      .maybeSingle();
    const restaurant = restaurantRaw as
      | { name: string | null; timezone: string | null; currency: string | null }
      | null;
    const restaurantName = restaurant?.name?.trim() ?? "the restaurant";
    const tz = restaurant?.timezone ?? "America/Toronto";
    const currency = (restaurant?.currency ?? "CAD").toUpperCase();
    const reservedDate = new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: tz,
    }).format(new Date(reservation.reserved_at));

    // Pull every PENDING row with an email — these are the people who
    // owe a share. Skip rows already charged (idempotency).
    const { data: rowsRaw, error: rowsErr } = await supabaseAdmin
      .from("reservation_deposit_payments")
      .select("id, payer_email, payer_full_name, amount_cents, status, stripe_payment_intent_id")
      .eq("reservation_id", reservationId)
      .eq("status", "pending");
    if (rowsErr) return jsonRes({ error: rowsErr.message }, 400);
    const rows = (rowsRaw ?? []) as Array<{
      id: string;
      payer_email: string | null;
      payer_full_name: string | null;
      amount_cents: number;
      status: string;
      stripe_payment_intent_id: string | null;
    }>;

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
      // Skip the organizer's row (they already paid inline).
      if (organizerEmail && email.toLowerCase() === organizerEmail) {
        skipped++;
        continue;
      }
      // Skip rows that somehow already have a PI (defensive).
      if (row.stripe_payment_intent_id) {
        skipped++;
        continue;
      }

      const payUrl = `${appOrigin}/deposit/${row.id}`;
      const amountDisplay = `${currency} $${(row.amount_cents / 100).toFixed(2)}`;
      const organizer = reservation.guest_full_name?.trim() ?? "Your friend";
      const recipientName = row.payer_full_name?.trim() ?? "there";

      const subject = `${organizer} invited you to chip in for dinner at ${restaurantName}`;
      const text =
        `Hi ${recipientName},\n\n` +
        `${organizer} booked dinner at ${restaurantName} for ${reservation.party_size} ` +
        `${reservation.party_size === 1 ? "guest" : "guests"} on ${reservedDate} ` +
        `and asked you to chip in ${amountDisplay} for the deposit.\n\n` +
        `Pay your share here:\n${payUrl}\n\n` +
        `The reservation isn't confirmed until everyone has paid their share. ` +
        `Takes about 30 seconds.\n\n` +
        `— Cenaiva`;
      const html =
        `<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto;">` +
        `<h2 style="font-family: serif; color: #111;">${organizer} invited you to chip in</h2>` +
        `<p>${organizer} booked dinner at <strong>${restaurantName}</strong> for ` +
        `${reservation.party_size} ${reservation.party_size === 1 ? "guest" : "guests"} on ${reservedDate} ` +
        `and asked you to pay <strong>${amountDisplay}</strong> for the deposit.</p>` +
        `<p style="margin: 24px 0;"><a href="${payUrl}" style="display: inline-block; padding: 12px 24px; background: #D4AF37; color: #000; text-decoration: none; border-radius: 8px; font-weight: 600;">Pay your share</a></p>` +
        `<p style="color: #666; font-size: 14px;">The reservation isn't confirmed until everyone has paid. Takes about 30 seconds.</p>` +
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
          console.warn("[dispatch-deposit-invites] resend error:", error.message);
        } else {
          sent++;
        }
      } catch (err) {
        failed++;
        console.warn(
          "[dispatch-deposit-invites] resend threw:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    return jsonRes({
      ok: true,
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
