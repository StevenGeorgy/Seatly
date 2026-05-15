// get-deposit-payment-context: anon-callable lookup for the public
// `/deposit/:id` page (Phase 7 of diner auth overhaul, 2026-05-15).
// When a diner toggles "split deposit across the table" at checkout,
// the other payers get SMS+email magic links pointing at
// `/deposit/<reservation_deposit_payments.id>`. That page needs the
// reservation context (restaurant name, date, party size, deposit
// amount, organizer name) plus the payment-row status — all of which
// live behind RLS that doesn't admit anon callers. This function uses
// service-role to do the join, then returns ONLY the fields the
// public page needs to display.
//
// Security: the row id is a UUID (guessing infeasible). The response
// omits anything sensitive (other payers, confirmation code, internal
// notes, etc.). Diner email/name are returned only for the payer
// themselves so the page can show "Hi {name}, your share is $X".
//
// Body: { payment_id: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  payment_id?: unknown;
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
        "get-deposit-payment-context",
        rateLimitIdentifier(req),
        { limit: 30, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const payload = (await req.json().catch(() => ({}))) as Payload;
    const paymentId =
      typeof payload.payment_id === "string" && payload.payment_id.trim()
        ? payload.payment_id.trim()
        : null;
    if (!paymentId) return jsonRes({ error: "payment_id is required" }, 400);

    const { data: paymentRaw, error: paymentErr } = await supabaseAdmin
      .from("reservation_deposit_payments")
      .select("id, reservation_id, amount_cents, status, payer_email, payer_full_name, stripe_payment_intent_id")
      .eq("id", paymentId)
      .maybeSingle();
    if (paymentErr) return jsonRes({ error: paymentErr.message }, 400);
    if (!paymentRaw) return jsonRes({ error: "Payment not found" }, 404);
    const payment = paymentRaw as {
      id: string;
      reservation_id: string;
      amount_cents: number;
      status: string;
      payer_email: string | null;
      payer_full_name: string | null;
      stripe_payment_intent_id: string | null;
    };

    const { data: reservationRaw } = await supabaseAdmin
      .from("reservations")
      .select("id, reserved_at, party_size, restaurant_id, guest_full_name, status")
      .eq("id", payment.reservation_id)
      .maybeSingle();
    const reservation = reservationRaw as
      | {
          id: string;
          reserved_at: string;
          party_size: number;
          restaurant_id: string;
          guest_full_name: string | null;
          status: string;
        }
      | null;
    if (!reservation) return jsonRes({ error: "Reservation not found" }, 404);

    const { data: restaurantRaw } = await supabaseAdmin
      .from("restaurants")
      .select("id, name, slug, currency, timezone, stripe_account_id, cover_photo_url")
      .eq("id", reservation.restaurant_id)
      .maybeSingle();
    const restaurant = restaurantRaw as
      | {
          id: string;
          name: string | null;
          slug: string;
          currency: string | null;
          timezone: string | null;
          stripe_account_id: string | null;
          cover_photo_url: string | null;
        }
      | null;
    if (!restaurant) return jsonRes({ error: "Restaurant not found" }, 404);

    return jsonRes({
      payment: {
        id: payment.id,
        amount_cents: payment.amount_cents,
        status: payment.status,
        payer_email: payment.payer_email,
        payer_full_name: payment.payer_full_name,
        is_paid:
          payment.status === "charged" &&
          (payment.stripe_payment_intent_id?.length ?? 0) > 0,
      },
      reservation: {
        id: reservation.id,
        reserved_at: reservation.reserved_at,
        party_size: reservation.party_size,
        organizer_full_name: reservation.guest_full_name,
        status: reservation.status,
      },
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
        currency: restaurant.currency ?? "CAD",
        timezone: restaurant.timezone,
        cover_photo_url: restaurant.cover_photo_url,
        has_stripe_account: Boolean(restaurant.stripe_account_id),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
