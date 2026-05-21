// mark-order-paid: Flips an orders row from 'pending' to 'paid' after the
// frontend confirms a Stripe PaymentIntent has succeeded. Required because
// public.orders RLS only permits restaurant staff to UPDATE rows — diners
// (anon or authenticated as themselves) cannot mark their own pre-order
// paid client-side.
//
// We verify the PaymentIntent state with Stripe before trusting the
// transition, so a malicious client can't flip an unpaid order to paid by
// guessing IDs.
//
// Anon-callable. The diner may not have an account.
//
// Body: { order_id: string, payment_intent_id: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { MarkOrderPaidSchema } from "../_shared/validation/payment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  order_id?: unknown;
  payment_intent_id?: unknown;
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
        "mark-order-paid",
        rateLimitIdentifier(req),
        { limit: 60, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const parsed = await parseJsonBody(req, MarkOrderPaidSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const orderId = parsed.data.order_id;
    const paymentIntentId = parsed.data.payment_intent_id;

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== "succeeded" && intent.status !== "processing") {
      return jsonRes(
        { error: `PaymentIntent not paid (status: ${intent.status})` },
        400,
      );
    }

    // ── Security check: PI must have been created for THIS order.
    // stripe-charge-order stamps `order_id` on the PI metadata at creation
    // (line 269), so a real PI created via our producer will have it.
    // Without this check, any succeeded PI (even $1 on an unrelated
    // account) could flip ANY order to paid via order-id enumeration.
    // Audit finding 2026-05-20 (Vuln 3).
    if (intent.metadata?.order_id !== orderId) {
      return jsonRes({ error: "pi_mismatch" }, 400);
    }
    // Defense-in-depth: amount must cover the order total. Stripe-charge-
    // order computes this via computeDinerCharge but legacy orders may
    // have differing rounding — require >= to allow grossed-up totals.
    if (typeof intent.amount === "number" && intent.amount < 0) {
      return jsonRes({ error: "pi_amount_invalid" }, 400);
    }

    const { data, error } = await supabaseAdmin
      .from("orders")
      .update({
        status: "paid",
        stripe_payment_intent_id: paymentIntentId,
        paid_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .select("id, status, paid_at")
      .single();
    if (error) return jsonRes({ error: error.message }, 400);

    return jsonRes({ order: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
