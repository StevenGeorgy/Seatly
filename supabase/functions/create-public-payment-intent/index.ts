// create-public-payment-intent: Creates a Stripe PaymentIntent for a diner
// to pay a deposit and/or pre-order on a reservation.
//
// IMPORTANT: This function is called BEFORE the reservation row exists. The
// reservation is only created after the payment succeeds (avoids holding
// slots for users who bail mid-checkout). Metadata gets reservation_id added
// via stripe.paymentIntents.update() once the reservation is created.
//
// Fee model:
//   - 5% application_fee_amount to Cenaiva (taken off top via destination charge)
//   - Rest flows to restaurant's Connect account (transfer_data.destination)
//   - If restaurant has no stripe_account_id (grandfathered pre-launch), uses
//     a platform-only charge — Cenaiva collects the full amount; manual payout
//     to the restaurant happens out-of-band.
//
// Anon-callable. No auth required — the diner may not have an account.
//
// Body: { restaurant_id: string, amount_cents: number }
// Returns: { client_secret: string, payment_intent_id: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  restaurant_id?: unknown;
  amount_cents?: unknown;
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

const PLATFORM_FEE_PERCENT = 0.05;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    try {
      await enforceRateLimit(
        supabaseAdmin,
        "create-public-payment-intent",
        rateLimitIdentifier(req),
        { limit: 60, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const payload = (await req.json().catch(() => ({}))) as Payload;
    const restaurantId =
      typeof payload.restaurant_id === "string" && payload.restaurant_id.trim()
        ? payload.restaurant_id.trim()
        : null;
    const amountCents =
      typeof payload.amount_cents === "number" && Number.isFinite(payload.amount_cents)
        ? Math.round(payload.amount_cents)
        : null;

    if (!restaurantId) return jsonRes({ error: "restaurant_id is required" }, 400);
    if (amountCents === null || amountCents < 50) {
      return jsonRes({ error: "amount_cents must be a number >= 50" }, 400);
    }

    const { data: restaurant, error: restErr } = await supabaseAdmin
      .from("restaurants")
      .select("id, name, stripe_account_id, currency")
      .eq("id", restaurantId)
      .maybeSingle();
    if (restErr || !restaurant) {
      return jsonRes({ error: "Restaurant not found" }, 404);
    }
    const row = restaurant as {
      id: string;
      name: string | null;
      stripe_account_id: string | null;
      currency: string | null;
    };

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    const currency = (row.currency ?? "CAD").toLowerCase();
    const applicationFeeCents = Math.round(amountCents * PLATFORM_FEE_PERCENT);

    // reservation_id is intentionally absent here — it gets added via
    // paymentIntents.update() AFTER the reservation is created post-payment.
    const metadata: Record<string, string> = {
      restaurant_id: restaurantId,
      platform: "cenaiva",
    };

    const stripeParams: Record<string, unknown> = {
      amount: amountCents,
      currency,
      automatic_payment_methods: { enabled: true },
      metadata,
      description: `Reservation at ${row.name ?? "Cenaiva restaurant"}`,
    };

    if (row.stripe_account_id) {
      // Destination charge: funds settle to restaurant's Connect account.
      // application_fee_amount is taken off the top for Cenaiva.
      stripeParams.application_fee_amount = applicationFeeCents;
      stripeParams.transfer_data = { destination: row.stripe_account_id };
    }
    // If no Connect account, this becomes a platform-only charge; manual
    // payout to the restaurant happens out-of-band. Pre-launch fallback.

    const paymentIntent = await stripe.paymentIntents.create(stripeParams);

    return jsonRes({
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      amount_cents: amountCents,
      application_fee_cents: row.stripe_account_id ? applicationFeeCents : 0,
      destination: row.stripe_account_id ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
