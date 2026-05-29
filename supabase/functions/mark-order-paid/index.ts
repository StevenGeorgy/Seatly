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
import { getStripeClient } from "../_shared/stripe-client.ts";

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

    const stripe = await getStripeClient(stripeKey);

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== "succeeded" && intent.status !== "processing") {
      return jsonRes(
        { error: `PaymentIntent not paid (status: ${intent.status})` },
        400,
      );
    }

    // Fetch the order so we can bind via its reservation when the PI carries
    // reservation_id instead of order_id.
    const { data: orderRow } = await supabaseAdmin
      .from("orders")
      .select("id, reservation_id")
      .eq("id", orderId)
      .maybeSingle();
    if (!orderRow) return jsonRes({ error: "Order not found" }, 404);

    // ── Security check: the PI must have been created BY US for THIS order —
    // either stamped with the exact order_id (stripe-charge-order, line 269)
    // OR with the order's reservation_id (deferred deposit / pre-order PIs from
    // create-public-payment-intent stamp reservation_id + deposit_payment_ids,
    // NOT order_id — without this branch those orders stayed 'pending' after a
    // real charge: voice/deep-link pre-orders). Both ids are stamped only by
    // our producers on our platform account, so an attacker's unrelated PI has
    // neither — still closing the id-enumeration hole (Vuln 3, 2026-05-20).
    const piOrderId = typeof intent.metadata?.order_id === "string" ? intent.metadata.order_id : null;
    const piReservationId = typeof intent.metadata?.reservation_id === "string" ? intent.metadata.reservation_id : null;
    const boundByOrder = piOrderId === orderId;
    const boundByReservation = !!piReservationId &&
      !!orderRow.reservation_id &&
      piReservationId === orderRow.reservation_id;
    if (!boundByOrder && !boundByReservation) {
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
