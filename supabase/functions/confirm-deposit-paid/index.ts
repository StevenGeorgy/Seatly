// confirm-deposit-paid: Flips a reservation_deposit_payments row from
// 'pending' to 'charged' after the frontend confirms a Stripe
// PaymentIntent has succeeded. Required because reservation_deposit_payments
// RLS only permits service-role + staff UPDATEs — diners cannot mark their
// own deposit charged client-side (an earlier flow tried this and silently
// failed for non-staff diners).
//
// We re-verify the PaymentIntent state with Stripe before trusting the
// transition, AND check the PI amount covers the deposit, so a malicious
// client can't flip an unpaid deposit to charged by guessing IDs.
//
// Once the row is 'charged', the existing settle trigger flips the parent
// reservation from 'pending_payment' to 'confirmed' (when all the
// reservation's deposit rows are charged — supports future multi-payer
// splits).
//
// Anon-callable. The diner may not have an account.
//
// Body: { payment_id: string, payment_intent_id: string }

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
  payment_intent_id?: unknown;
};

type DepositRow = {
  id: string;
  reservation_id: string;
  amount_cents: number;
  status: string;
  stripe_payment_intent_id: string | null;
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
        "confirm-deposit-paid",
        rateLimitIdentifier(req),
        { limit: 60, windowSeconds: 60 },
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
    const paymentIntentId =
      typeof payload.payment_intent_id === "string" && payload.payment_intent_id.trim()
        ? payload.payment_intent_id.trim()
        : null;

    if (!paymentId) return jsonRes({ error: "payment_id is required" }, 400);
    if (!paymentIntentId) return jsonRes({ error: "payment_intent_id is required" }, 400);
    if (!paymentIntentId.startsWith("pi_")) {
      return jsonRes({ error: "Invalid payment_intent_id format" }, 400);
    }

    // Load the deposit row to verify the requested amount lines up with the
    // PaymentIntent. Without this an attacker who knows a payment_id could
    // associate it with an unrelated low-value PI (e.g. their own $1 charge
    // somewhere else) and fraudulently mark the deposit charged.
    const { data: depositRowRaw, error: depErr } = await supabaseAdmin
      .from("reservation_deposit_payments")
      .select("id, reservation_id, amount_cents, status, stripe_payment_intent_id")
      .eq("id", paymentId)
      .maybeSingle();
    if (depErr) return jsonRes({ error: depErr.message }, 400);
    const depositRow = depositRowRaw as DepositRow | null;
    if (!depositRow) return jsonRes({ error: "Deposit payment not found" }, 404);

    // Idempotent: if already charged with the SAME PI, return success.
    if (
      depositRow.status === "charged" &&
      depositRow.stripe_payment_intent_id === paymentIntentId
    ) {
      return jsonRes({ deposit: depositRow, idempotent: true });
    }

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

    // The PI may be larger than the deposit when it bundles a pre-order
    // (totalNow = food + deposit). Only require >= deposit, not exact match.
    if ((intent.amount ?? 0) < depositRow.amount_cents) {
      return jsonRes(
        {
          error: `PaymentIntent amount (${intent.amount}¢) is less than deposit (${depositRow.amount_cents}¢)`,
        },
        400,
      );
    }

    const { data, error } = await supabaseAdmin
      .from("reservation_deposit_payments")
      .update({
        status: "charged",
        stripe_payment_intent_id: paymentIntentId,
        paid_at: new Date().toISOString(),
      })
      .eq("id", paymentId)
      .select("id, reservation_id, status, amount_cents, stripe_payment_intent_id, paid_at")
      .single();
    if (error) return jsonRes({ error: error.message }, 400);

    return jsonRes({ deposit: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
