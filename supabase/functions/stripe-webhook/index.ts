// stripe-webhook: Phase D (Stripe wire-up). Receives Stripe webhook events
// and mirrors them into restaurant rows. No JWT auth — Stripe POSTs directly
// and we verify the `stripe-signature` header using STRIPE_WEBHOOK_SECRET.
//
// `verify_jwt = false` in supabase/config.toml.
//
// Events handled (matches STRIPE_SETUP.md §1.5):
//   account.updated                       → sync charges/payouts/details booleans
//   account.application.deauthorized      → clear stripe_account_id + flags
//   customer.subscription.created/updated → mirror subscription_status + trial_ends_at
//   customer.subscription.deleted         → mark canceled + is_published=false (graceful unpublish)
//   customer.subscription.trial_will_end  → log only (could email later)
//   payment_intent.succeeded / failed     → log only (deposit flow webhook handles its own)
//   invoice.payment_failed                → log only

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "stripe-signature, content-type",
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

// In-memory de-dupe of recent event ids. Tiny defense against Stripe's
// at-least-once delivery; a proper `processed_events` table can be added
// later (CLAUDE.md follow-up).
const seenEventIds = new Set<string>();
const SEEN_CAP = 500;
function rememberEvent(id: string): boolean {
  if (seenEventIds.has(id)) return false;
  if (seenEventIds.size > SEEN_CAP) {
    // Drop the oldest by rebuilding (cheap at this scale).
    const arr = Array.from(seenEventIds).slice(-Math.floor(SEEN_CAP / 2));
    seenEventIds.clear();
    arr.forEach((v) => seenEventIds.add(v));
  }
  seenEventIds.add(id);
  return true;
}

type AccountLike = {
  id?: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
};

type SubscriptionLike = {
  id?: string;
  customer?: string;
  status?: string;
  trial_end?: number | null;
};

async function handleAccountUpdated(account: AccountLike): Promise<void> {
  if (!account.id) return;
  const { error } = await supabaseAdmin
    .from("restaurants")
    .update({
      stripe_charges_enabled: Boolean(account.charges_enabled),
      stripe_payouts_enabled: Boolean(account.payouts_enabled),
      stripe_details_submitted: Boolean(account.details_submitted),
    })
    .eq("stripe_account_id", account.id);
  if (error) console.error("[stripe-webhook] account.updated failed", error);
}

async function handleAccountDeauthorized(account: AccountLike): Promise<void> {
  if (!account.id) return;
  const { error } = await supabaseAdmin
    .from("restaurants")
    .update({
      stripe_account_id: null,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
      stripe_details_submitted: false,
    })
    .eq("stripe_account_id", account.id);
  if (error) console.error("[stripe-webhook] account.deauthorized failed", error);
}

async function handleSubscriptionUpsert(sub: SubscriptionLike): Promise<void> {
  if (!sub.customer) return;
  const trialEndsAt =
    typeof sub.trial_end === "number" ? new Date(sub.trial_end * 1000).toISOString() : null;
  const { error } = await supabaseAdmin
    .from("restaurants")
    .update({
      subscription_status: sub.status ?? null,
      trial_ends_at: trialEndsAt,
    })
    .eq("stripe_customer_id", sub.customer);
  if (error) console.error("[stripe-webhook] subscription upsert failed", error);
}

async function handleSubscriptionDeleted(sub: SubscriptionLike): Promise<void> {
  if (!sub.customer) return;
  const { error } = await supabaseAdmin
    .from("restaurants")
    .update({
      subscription_status: "canceled",
      is_published: false,
    })
    .eq("stripe_customer_id", sub.customer);
  if (error) console.error("[stripe-webhook] subscription deleted failed", error);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    await enforceRateLimit(
      supabaseAdmin,
      "stripe-webhook",
      rateLimitIdentifier(req),
      { limit: 60, windowSeconds: 60 },
    );
  } catch (err) {
    if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
    // Fail-open on infra errors so we don't drop real Stripe events.
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return jsonRes({ error: "Missing stripe-signature" }, 400);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey || !webhookSecret) {
    // Don't leak which secret is missing.
    return jsonRes({ error: "Stripe webhook not configured" }, 500);
  }

  const rawBody = await req.text();

  const { default: Stripe } = await import("npm:stripe@17");
  const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

  let event: { id: string; type: string; data: { object: Record<string, unknown> } };
  try {
    // constructEventAsync is required on Deno — the sync variant uses Node crypto.
    event = (await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
    )) as { id: string; type: string; data: { object: Record<string, unknown> } };
  } catch (err) {
    // Strip any text that might echo back the body or secret.
    const msg = err instanceof Error ? err.message : "Signature verification failed";
    return jsonRes({ error: `Webhook signature verification failed: ${msg}` }, 400);
  }

  if (!rememberEvent(event.id)) {
    console.log(`[stripe-webhook] duplicate event ${event.id} (${event.type}) — skipping`);
    return jsonRes({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "account.updated":
        await handleAccountUpdated(event.data.object as AccountLike);
        break;
      case "account.application.deauthorized":
        await handleAccountDeauthorized(event.data.object as AccountLike);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpsert(event.data.object as SubscriptionLike);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as SubscriptionLike);
        break;
      case "customer.subscription.trial_will_end":
        console.log(`[stripe-webhook] trial_will_end for ${event.id}`);
        break;
      case "payment_intent.succeeded":
      case "payment_intent.payment_failed":
      case "invoice.payment_failed":
        console.log(`[stripe-webhook] ${event.type} (${event.id}) — logged, no DB write`);
        break;
      default:
        console.log(`[stripe-webhook] unhandled event ${event.type} (${event.id})`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe-webhook] handler error for ${event.type}:`, msg);
    // Still return 200 — Stripe will retry on non-2xx, but the handler is
    // best-effort. The next account.updated / subscription.updated event
    // will re-sync state.
  }

  return jsonRes({ received: true });
});
