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
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { ConfirmDepositPaidSchema } from "../_shared/validation/payment.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";

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

    const parsed = await parseJsonBody(req, ConfirmDepositPaidSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const paymentId = parsed.data.payment_id;
    const paymentIntentId = parsed.data.payment_intent_id;
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

    const stripe = await getStripeClient(stripeKey);

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

    // ── Security check: PI must have been created for THIS restaurant.
    // Without this, an attacker who knows a deposit's `payment_id` could
    // submit any unrelated succeeded PI of sufficient amount (e.g. their
    // own charge on another platform) and have us flip the deposit to
    // 'charged'. Verifying restaurant_id (stamped on PI creation) +
    // transfer_data.destination (the Connect routing target) closes the
    // attack: only PIs that were legitimately created via
    // create-public-payment-intent for the same restaurant pass.
    // Audit finding 2026-05-20 (Vuln 2).
    const { data: linkedReservation } = await supabaseAdmin
      .from("reservations")
      .select("restaurant_id, restaurants:restaurants(stripe_account_id)")
      .eq("id", depositRow.reservation_id)
      .maybeSingle();
    const linkedRow = linkedReservation as
      | { restaurant_id: string | null; restaurants: { stripe_account_id: string | null } | null }
      | null;
    const expectedRestaurantId = linkedRow?.restaurant_id ?? null;
    const expectedDestination = linkedRow?.restaurants?.stripe_account_id ?? null;
    const piRestaurantId = typeof intent.metadata?.restaurant_id === "string"
      ? intent.metadata.restaurant_id
      : null;
    if (!expectedRestaurantId || piRestaurantId !== expectedRestaurantId) {
      return jsonRes({ error: "pi_restaurant_mismatch" }, 400);
    }
    // Destination check only fires when the restaurant has Stripe-Connect-
    // routed payments configured. Pre-Connect bookings (legacy) or platform-
    // direct charges won't have a destination — skip the check in that case
    // rather than reject. The restaurant_id check above is the primary gate.
    const piDestination = (intent as { transfer_data?: { destination?: string | null } | null })
      ?.transfer_data?.destination ?? null;
    if (expectedDestination && piDestination && piDestination !== expectedDestination) {
      return jsonRes({ error: "pi_destination_mismatch" }, 400);
    }

    // Tightest check (Vuln 2 full hardening, 2026-05-20): PI's metadata
    // must list THIS deposit row. The producer (create-public-payment-intent)
    // stamps `metadata.deposit_payment_ids` at create time as a comma-joined
    // UUID list. Without this check, even with the restaurant_id +
    // destination guards above, an attacker could swap PIs between deposits
    // within the same restaurant (e.g. claim a friend's $5 PI to settle
    // their own $100 deposit). Strict from day 1 — no legacy fallback.
    const stampedRaw = typeof intent.metadata?.deposit_payment_ids === "string"
      ? intent.metadata.deposit_payment_ids
      : "";
    const stamped = stampedRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!stamped.includes(paymentId)) {
      return jsonRes({ error: "pi_payment_id_mismatch" }, 400);
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
