// restart-subscription: for fully-cancelled restaurants. Creates a fresh
// Stripe subscription using the existing default_payment_method (no trial
// since it was already used) + republishes the restaurant.
//
// State transitions:
//   restaurant.subscription_status='canceled' + is_published=false
//   → new Stripe sub created (status='active' or 'incomplete' if first
//     invoice not paid yet)
//   → restaurant.is_published=true, paused_reason=null
//   → restaurant_live notification fired

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { RestaurantIdOnlySchema } from "../_shared/validation/subscription.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";
import { isOwnerOfRestaurant } from "../_shared/auth-restaurants.ts";
import { RECOVERABLE_SUBSCRIPTION_STATUSES } from "../_shared/subscription-status.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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


async function dispatchOwnerNotification(
  restaurantId: string,
  type: "restaurant_live",
  context: Record<string, unknown>,
): Promise<void> {
  try {
    const mod = await import("../_shared/owner-notifications.ts").catch(() => null);
    if (
      mod &&
      typeof (mod as { sendOwnerNotification?: unknown }).sendOwnerNotification === "function"
    ) {
      void (mod as {
        sendOwnerNotification: (opts: Record<string, unknown>) => Promise<unknown>;
      })
        .sendOwnerNotification({
          supabase: supabaseAdmin,
          restaurant_id: restaurantId,
          type,
          context,
        })
        .catch((e: unknown) => {
          console.warn("[restart-subscription] notification rejected", e);
        });
    }
  } catch (notifErr) {
    console.warn("[restart-subscription] notification import failed", notifErr);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return jsonRes({ error: "Missing authorization token" }, 401);

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) return jsonRes({ error: "Invalid or expired session" }, 401);

    const parsed = await parseJsonBody(req, RestaurantIdOnlySchema, { jsonRes });
    if ("response" in parsed) return parsed.response;
    const restaurantId = parsed.data.restaurant_id;

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "restart-subscription",
        rateLimitIdentifier(req, user.id),
        { limit: 5, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const isOwner = await isOwnerOfRestaurant(supabaseAdmin, user.id, restaurantId);
    if (!isOwner) return jsonRes({ error: "Not authorized for this restaurant" }, 403);

    const { data: rest } = await supabaseAdmin
      .from("restaurants")
      .select("id, name, stripe_customer_id, subscription_status, cover_photo_url, stripe_charges_enabled")
      .eq("id", restaurantId)
      .maybeSingle();
    if (!rest) return jsonRes({ error: "Restaurant not found" }, 404);
    const row = rest as {
      id: string;
      name: string | null;
      stripe_customer_id: string | null;
      subscription_status: string | null;
      cover_photo_url: string | null;
      stripe_charges_enabled: boolean | null;
    };
    if (!row.stripe_customer_id) {
      return jsonRes({ error: "Restaurant has no Stripe customer." }, 400);
    }
    if (!row.stripe_charges_enabled) {
      return jsonRes({
        error: "Stripe Connect verification incomplete. Finish KYC before restarting.",
      }, 400);
    }
    if (!row.cover_photo_url) {
      return jsonRes({ error: "Restaurant is missing a cover photo." }, 400);
    }
    if (
      row.subscription_status &&
      RECOVERABLE_SUBSCRIPTION_STATUSES.has(row.subscription_status)
    ) {
      return jsonRes({
        error: "Subscription is already active. Use Resume instead.",
        subscription_status: row.subscription_status,
      }, 409);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe not configured on server" }, 500);
    const priceId = Deno.env.get("STRIPE_SUBSCRIPTION_PRICE_ID");
    if (!priceId) return jsonRes({ error: "Stripe price not configured on server" }, 500);

    const stripe = await getStripeClient(stripeKey);

    // Pre-check: prevent duplicate subs (idempotency).
    const existing = await stripe.subscriptions.list({
      customer: row.stripe_customer_id,
      status: "all",
      limit: 5,
    });
    const liveExisting = existing.data.find((s) =>
      RECOVERABLE_SUBSCRIPTION_STATUSES.has(s.status ?? ""),
    );
    if (liveExisting) {
      return jsonRes({
        ok: true,
        subscription_id: liveExisting.id,
        subscription_status: liveExisting.status,
        deduplicated: true,
      });
    }

    // Customer must have a default payment method (set during onboarding
    // or via Change card). Restart does NOT walk through publish-restaurant
    // wizard again; we trust the existing card.
    const customer = await stripe.customers.retrieve(row.stripe_customer_id);
    const defaultPm =
      (customer as { invoice_settings?: { default_payment_method?: string | null } })
        .invoice_settings?.default_payment_method;
    if (!defaultPm) {
      return jsonRes({
        error: "No default payment method on file. Add a card first via Change card.",
      }, 400);
    }

    // Create the subscription. No trial — they used their free trial already.
    // Day-bucketed idempotency key prevents duplicate-sub on retry.
    //
    // `automatic_tax: { enabled: true }` is required: this is Cenaiva's own
    // revenue (subscription fee), so we must charge Canadian HST/GST per
    // province via Stripe Tax. Without it, restart flows undercharge the
    // restaurant and create a CRA compliance gap. Matches the publish-
    // restaurant flow's subscription-create call.
    const subscription = await stripe.subscriptions.create(
      {
        customer: row.stripe_customer_id,
        items: [{ price: priceId }],
        default_payment_method: defaultPm as string,
        payment_behavior: "default_incomplete",
        automatic_tax: { enabled: true },
        expand: ["latest_invoice.payment_intent"],
        metadata: { restaurant_id: row.id, restarted: "true" },
      },
      {
        idempotencyKey: `restart_${row.stripe_customer_id}_${new Date().toISOString().slice(0, 10)}_tax_v1`,
      },
    );

    // Republish + clear cancel flags.
    const trialEndsAt =
      typeof subscription.trial_end === "number"
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null;
    const { error: updateErr } = await supabaseAdmin
      .from("restaurants")
      .update({
        subscription_status: subscription.status,
        trial_ends_at: trialEndsAt,
        is_published: true,
        paused_reason: null,
        subscription_cancel_at_period_end: false,
        subscription_paused_at: null,
      })
      .eq("id", restaurantId);
    if (updateErr) {
      console.error("[restart-subscription] DB update failed", updateErr);
    }

    await dispatchOwnerNotification(restaurantId, "restaurant_live", {
      restaurantName: row.name ?? "your restaurant",
      restartedSubscription: true,
    });

    return jsonRes({
      ok: true,
      subscription_id: subscription.id,
      subscription_status: subscription.status,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[restart-subscription] unhandled error:", msg);
    return jsonRes({ error: msg }, 500);
  }
});
