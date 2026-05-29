// refund-payment-intent: Auto-refund a successful Stripe charge when the
// post-payment reservation creation fails (e.g. slot was taken in the
// milliseconds between Stripe success and create-public-booking returning).
//
// Anon-callable on purpose — the diner may not have an account at the moment
// of the slot-taken race. BUT the endpoint is NOT an unconditional "refund
// any pi_" primitive (2026-05-29 security fix #1). Before refunding it now
// BINDS the PI to a Cenaiva-originated, un-materialized booking:
//
//   1. The PI must carry metadata.restaurant_id — i.e. it was created by our
//      own create-public-payment-intent (only our secret key can stamp PIs
//      on our platform account). Foreign PIs are rejected.
//   2. For ANON callers, the PI must be an ORPHAN: no reservation bound to it
//      may already be materialized (confirmed/seated/completed/no_show).
//      A real, delivered booking must be refunded via cancel-reservation —
//      never here. This blocks an attacker replaying another diner's pi_.
//   3. For ANON callers, the PI must be RECENT (the race-recovery refund
//      happens within seconds; we allow a generous 60-minute window).
//
// The internal server-to-server caller (request-refund, which sends the
// SERVICE_ROLE bearer) bypasses the orphan/freshness checks because it does
// its own ownership + duplicate verification upstream (security fix #2).
//
// Refund itself is unchanged: routed through _shared/stripe-refund.ts which
// sets reverse_transfer:true (these are platform-account destination charges).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { refundPaymentIntent } from "../_shared/stripe-refund.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { RefundPaymentIntentSchema } from "../_shared/validation/payment.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// A booking bound to the PI in any of these states means a real reservation
// was delivered — refunds for those must go through cancel-reservation, not
// this race-recovery endpoint.
const MATERIALIZED_STATUSES = new Set([
  "confirmed",
  "seated",
  "completed",
  "no_show",
]);

// Anon race-recovery must fire promptly after the charge. Generous window to
// tolerate slow networks / a retry, but bounded so an old PI can't be abused.
const ANON_REFUND_WINDOW_MS = 60 * 60 * 1000;

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

type PaymentIntentLike = {
  id: string;
  status?: string;
  created?: number;
  metadata?: Record<string, string> | null;
};

// Collect reservation ids that the PI is bound to, across every linkage:
// PI metadata, deposit rows, orders, and the reservation's own deposit PI col.
async function boundReservationIds(
  paymentIntentId: string,
  metadata: Record<string, string> | null | undefined,
): Promise<string[]> {
  const ids = new Set<string>();
  const metaResId = metadata?.reservation_id;
  if (metaResId) ids.add(metaResId);

  const { data: rdpRows } = await supabaseAdmin
    .from("reservation_deposit_payments")
    .select("reservation_id")
    .eq("stripe_payment_intent_id", paymentIntentId);
  for (const r of (rdpRows ?? []) as Array<{ reservation_id: string | null }>) {
    if (r.reservation_id) ids.add(r.reservation_id);
  }

  const { data: orderRows } = await supabaseAdmin
    .from("orders")
    .select("reservation_id")
    .eq("stripe_payment_intent_id", paymentIntentId);
  for (const o of (orderRows ?? []) as Array<{ reservation_id: string | null }>) {
    if (o.reservation_id) ids.add(o.reservation_id);
  }

  const { data: resByDeposit } = await supabaseAdmin
    .from("reservations")
    .select("id")
    .eq("deposit_stripe_payment_intent_id", paymentIntentId);
  for (const r of (resByDeposit ?? []) as Array<{ id: string }>) {
    if (r.id) ids.add(r.id);
  }

  return [...ids];
}

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

    const parsed = await parseJsonBody(req, RefundPaymentIntentSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const paymentIntentId = parsed.data.payment_intent_id;
    const reason =
      parsed.data.reason && parsed.data.reason.trim()
        ? parsed.data.reason.trim()
        : "slot_taken";

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    // Trusted internal caller? request-refund posts the SERVICE_ROLE bearer
    // and gates ownership + duplicate-ness itself. Anyone else is anon.
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const isInternal = serviceKey.length > 0 && bearer === serviceKey;

    const stripe = await getStripeClient(stripeKey);

    // Bind the PI before refunding. Retrieve it (platform account — deposit/
    // pre-order PIs are destination charges created on our platform account).
    let pi: PaymentIntentLike;
    try {
      pi = (await stripe.paymentIntents.retrieve(paymentIntentId)) as PaymentIntentLike;
    } catch (err) {
      if ((err as { code?: string }).code === "resource_missing") {
        return jsonRes({ error: "payment_intent_not_found" }, 404);
      }
      throw err;
    }

    const metadata = pi.metadata ?? null;
    // (1) Must be a Cenaiva-originated PI (only our secret stamps restaurant_id).
    if (!metadata?.restaurant_id) {
      return jsonRes({ error: "payment_intent_not_recognized" }, 403);
    }

    if (!isInternal) {
      // (2) Orphan-only. The legitimate slot-taken race leaves NO successful
      // booking (create-public-booking failed → no paid order, no charged
      // deposit, no materialized reservation). So we refuse to refund a PI
      // that shows ANY sign of a recorded/successful booking. This deliberately
      // keys off money-settled signals (charged RDP row / paid order) rather
      // than reservation status alone, so it also protects 'pending'/
      // 'pending_payment' deposit/split bookings whose money is already taken
      // and Mode-B saved-card bookings (no reservation_id in PI metadata, but a
      // paid order links the PI). A real booking must be refunded via
      // cancel-reservation, never here.
      const [chargedDepRes, paidOrderRes, resIds] = await Promise.all([
        supabaseAdmin
          .from("reservation_deposit_payments")
          .select("id")
          .eq("stripe_payment_intent_id", paymentIntentId)
          .eq("status", "charged")
          .limit(1),
        supabaseAdmin
          .from("orders")
          .select("id")
          .eq("stripe_payment_intent_id", paymentIntentId)
          .eq("status", "paid")
          .limit(1),
        boundReservationIds(paymentIntentId, metadata),
      ]);
      let materialized = false;
      if (resIds.length > 0) {
        const { data: resRows } = await supabaseAdmin
          .from("reservations")
          .select("status")
          .in("id", resIds);
        materialized = (resRows ?? []).some(
          (r: { status: string | null }) => r.status && MATERIALIZED_STATUSES.has(r.status),
        );
      }
      const hasChargedDeposit = !!(chargedDepRes.data && chargedDepRes.data.length > 0);
      const hasPaidOrder = !!(paidOrderRes.data && paidOrderRes.data.length > 0);
      if (hasChargedDeposit || hasPaidOrder || materialized) {
        // Real booking — must cancel via cancel-reservation, not here.
        return jsonRes({ error: "reservation_already_materialized" }, 409);
      }

      // (3) Freshness: race-recovery is immediate; reject stale PIs.
      const createdMs = typeof pi.created === "number" ? pi.created * 1000 : 0;
      if (createdMs > 0 && Date.now() - createdMs > ANON_REFUND_WINDOW_MS) {
        return jsonRes({ error: "refund_window_expired" }, 403);
      }
    }

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
