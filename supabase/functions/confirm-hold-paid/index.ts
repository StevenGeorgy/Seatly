// @ts-nocheck
// confirm-hold-paid: Browser-side conversion of a reservation_hold into a
// real reservation after Stripe payment succeeds.
//
// Mirrors confirm-deposit-paid in shape:
//   - Anon-callable (diner may not have an account).
//   - We re-verify the PaymentIntent with Stripe before trusting the
//     conversion, AND verify the PI amount covers the expected charge
//     (total_amount_cents OR at least deposit_amount_cents), so a
//     malicious client can't flip an unpaid hold by guessing IDs.
//   - All write authority sits inside convert_reservation_hold_to_reservation,
//     which is SECURITY DEFINER and idempotent. We just orchestrate.
//
// This is the FAST PATH the FE polls/awaits while paying. The
// stripe-webhook also calls the same RPC when the webhook lands — whichever
// arrives first wins; the second is a no-op (idempotent: true).
//
// If the PI succeeded but the hold has expired past the grace window
// (P0011 → 410), the FE is expected to surface a refund flow. THIS
// FUNCTION DOES NOT REFUND — the webhook path does that (see
// stripe-webhook.ts) because the webhook is the source of truth for
// "payment definitely happened".
//
// Body: { hold_id: string, payment_intent_id: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";

type Payload = {
  hold_id?: unknown;
  payment_intent_id?: unknown;
};

type HoldRow = {
  id: string;
  status: string;
  total_amount_cents: number;
  deposit_amount_cents: number;
  converted_reservation_id: string | null;
};

type ConvertedRow = {
  reservation_id: string;
  confirmation_code: string;
  table_ids: string[];
  duration_minutes: number;
  idempotent: boolean;
};

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function jsonRes(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders(req) });
  }
  if (req.method !== "POST") return jsonRes(req, { error: "POST only" }, 405);

  try {
    try {
      await enforceRateLimit(
        supabaseAdmin,
        "confirm-hold-paid:min",
        rateLimitIdentifier(req),
        { limit: 60, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes(req, { error: err.message }, 429);
      throw err;
    }

    const payload = (await req.json().catch(() => ({}))) as Payload;
    const holdId =
      typeof payload.hold_id === "string" && payload.hold_id.trim()
        ? payload.hold_id.trim()
        : null;
    const paymentIntentId =
      typeof payload.payment_intent_id === "string" && payload.payment_intent_id.trim()
        ? payload.payment_intent_id.trim()
        : null;

    if (!holdId) return jsonRes(req, { error: "hold_id is required" }, 400);
    if (!paymentIntentId) return jsonRes(req, { error: "payment_intent_id is required" }, 400);
    if (!paymentIntentId.startsWith("pi_")) {
      return jsonRes(req, { error: "Invalid payment_intent_id format" }, 400);
    }

    // Step 0: load the hold to know the expected charge amount. This
    // mirrors confirm-deposit-paid — we will NOT trust the PI ID alone.
    const { data: holdRowRaw, error: holdErr } = await supabaseAdmin
      .from("reservation_holds")
      .select("id, status, total_amount_cents, deposit_amount_cents, converted_reservation_id")
      .eq("id", holdId)
      .maybeSingle();
    if (holdErr) return jsonRes(req, { error: holdErr.message }, 400);
    const holdRow = holdRowRaw as HoldRow | null;
    if (!holdRow) return jsonRes(req, { error: "hold_not_found" }, 404);

    // Step 1: re-verify the PaymentIntent with Stripe.
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes(req, { error: "Stripe is not configured on the server" }, 500);

    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== "succeeded") {
      return jsonRes(
        req,
        { error: "payment_not_succeeded", pi_status: pi.status },
        402,
      );
    }

    // PI may bundle deposit + pre-order (totalNow = food + deposit), so we
    // accept either total OR deposit being covered. The hold's RPC will
    // refuse to convert a row that hasn't actually been charged at the
    // expected level when the webhook lands — this is a defense-in-depth
    // check for the FE call path.
    const amountReceived = pi.amount_received ?? 0;
    const expectedTotal = holdRow.total_amount_cents ?? 0;
    const expectedDeposit = holdRow.deposit_amount_cents ?? 0;
    const meetsTotal = expectedTotal > 0 && amountReceived >= expectedTotal;
    const meetsDeposit = expectedDeposit > 0 && amountReceived >= expectedDeposit;
    // If both expected amounts are 0 (truly free hold — shouldn't happen
    // for a paid flow, but be permissive) we accept anything; otherwise
    // require at least one threshold met.
    const anyExpected = expectedTotal > 0 || expectedDeposit > 0;
    if (anyExpected && !meetsTotal && !meetsDeposit) {
      return jsonRes(req, { error: "payment_amount_too_low" }, 402);
    }

    // Step 2: convert. RPC owns expiry/grace + idempotency.
    const { data, error } = await supabaseAdmin.rpc(
      "convert_reservation_hold_to_reservation",
      {
        p_hold_id: holdId,
        p_payment_intent_id: paymentIntentId,
        p_grace_seconds: 120,
      },
    );

    if (error) {
      const code = (error as { code?: string }).code ?? null;
      if (code === "P0010") return jsonRes(req, { error: "hold_not_found" }, 404);
      if (code === "P0011") {
        // Caller should trigger refund flow via Stripe directly; this fn
        // doesn't refund. The webhook will refund if it lands later.
        return jsonRes(req, { error: "hold_expired" }, 410);
      }
      if (code === "P0012") return jsonRes(req, { error: "hold_not_convertible" }, 409);
      return jsonRes(req, { error: error.message }, 400);
    }

    const row = (data as ConvertedRow[] | null)?.[0] ?? null;
    if (!row) {
      return jsonRes(req, { error: "conversion_returned_no_row" }, 500);
    }

    // Step 3: post-conversion side effects (orders from cart_snapshot,
    // promotion usage, notifications). Only run on the FIRST conversion
    // — idempotent replays must not double-fire SMS/email or duplicate
    // orders. Best-effort: the conversion itself already succeeded, so we
    // do NOT fail the request if a side effect breaks.
    if (!row.idempotent) {
      try {
        const { runPostHoldConversion } = await import("../_shared/hold-conversion.ts");
        await runPostHoldConversion({
          supabase: supabaseAdmin,
          holdId,
          reservationId: row.reservation_id,
          paymentIntentId,
        });
      } catch (sideErr) {
        console.error("[confirm-hold-paid] post-conversion side effect failed", sideErr);
      }
    }

    return jsonRes(req, {
      reservation_id: row.reservation_id,
      confirmation_code: row.confirmation_code,
      table_ids: row.table_ids,
      duration_minutes: row.duration_minutes,
      idempotent: row.idempotent,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes(req, { error: msg }, 500);
  }
});
