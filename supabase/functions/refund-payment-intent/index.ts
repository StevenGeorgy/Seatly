// refund-payment-intent: Auto-refund a successful Stripe charge when the
// post-payment reservation creation fails (e.g. slot was taken in the
// milliseconds between Stripe success and create-public-booking returning).
//
// Anon-callable. No auth required — the diner may not have an account, and
// we already know the payment_intent_id from the just-completed Stripe
// confirmation flow. Refund reason "requested_by_customer" so it's a clean
// reversal in the Stripe dashboard.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { refundPaymentIntent } from "../_shared/stripe-refund.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  payment_intent_id?: unknown;
  reason?: unknown;
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
        "refund-payment-intent",
        rateLimitIdentifier(req),
        { limit: 20, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const payload = (await req.json().catch(() => ({}))) as Payload;
    const paymentIntentId =
      typeof payload.payment_intent_id === "string" && payload.payment_intent_id.trim()
        ? payload.payment_intent_id.trim()
        : null;
    const reason =
      typeof payload.reason === "string" && payload.reason.trim()
        ? payload.reason.trim()
        : "slot_taken";

    if (!paymentIntentId) {
      return jsonRes({ error: "payment_intent_id is required" }, 400);
    }
    if (!paymentIntentId.startsWith("pi_")) {
      return jsonRes({ error: "Invalid payment_intent_id format" }, 400);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    const outcome = await refundPaymentIntent(stripe, paymentIntentId, reason);
    if (!outcome.ok) {
      return jsonRes({ error: outcome.error }, 500);
    }

    return jsonRes({
      refund_id: outcome.refund_id,
      status: outcome.status,
      amount: outcome.amount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
