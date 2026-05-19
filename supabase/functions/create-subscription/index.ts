// create-subscription: Phase D (Stripe wire-up). Creates the Stripe Customer
// (on the platform account, NOT the connected account) + the $200 CAD/month
// subscription with 90-day trial. Persists `stripe_customer_id`,
// `subscription_status`, and `trial_ends_at` to the restaurants row.
//
// Auth: caller must be the restaurant owner.
// `verify_jwt = false` in supabase/config.toml because we decode the JWT
// ourselves.
//
// Payload: { restaurant_id, payment_method_id }. The payment_method_id comes
// from Stripe Elements on the frontend (SetupIntent → confirmSetup result).

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
  payment_method_id?: unknown;
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

async function ownerOfRestaurant(authUserId: string, restaurantId: string): Promise<boolean> {
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (!profile) return false;
  const { data: role } = await supabaseAdmin
    .from("user_restaurant_roles")
    .select("role")
    .eq("user_id", (profile as { id: string }).id)
    .eq("restaurant_id", restaurantId)
    .eq("role", "owner")
    .maybeSingle();
  return Boolean(role);
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

    const payload = (await req.json().catch(() => ({}))) as Payload;
    const restaurantId =
      typeof payload.restaurant_id === "string" && payload.restaurant_id.trim()
        ? payload.restaurant_id.trim()
        : null;
    const paymentMethodId =
      typeof payload.payment_method_id === "string" && payload.payment_method_id.trim()
        ? payload.payment_method_id.trim()
        : null;
    if (!restaurantId) return jsonRes({ error: "restaurant_id is required" }, 400);
    if (!paymentMethodId) return jsonRes({ error: "payment_method_id is required" }, 400);

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "create-subscription",
        rateLimitIdentifier(req, user.id),
        { limit: 20, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const isOwner = await ownerOfRestaurant(user.id, restaurantId);
    if (!isOwner) return jsonRes({ error: "Not authorized for this restaurant" }, 403);

    const { data: restaurant, error: restErr } = await supabaseAdmin
      .from("restaurants")
      .select("id, name, email, stripe_account_id, stripe_customer_id")
      .eq("id", restaurantId)
      .maybeSingle();
    if (restErr || !restaurant) return jsonRes({ error: "Restaurant not found" }, 404);

    const row = restaurant as {
      id: string;
      name: string | null;
      email: string | null;
      stripe_account_id: string | null;
      stripe_customer_id: string | null;
    };
    if (!row.stripe_account_id) {
      return jsonRes({ error: "Stripe Connect account must exist before subscription" }, 400);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const priceId = Deno.env.get("STRIPE_SUBSCRIPTION_PRICE_ID");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);
    if (!priceId) {
      return jsonRes({ error: "STRIPE_SUBSCRIPTION_PRICE_ID is not configured" }, 500);
    }

    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    // Validate the Price ID early so the error tells us exactly what's wrong
    // (invalid id, wrong currency, one-time vs recurring, archived).
    try {
      const price = await stripe.prices.retrieve(priceId);
      if (!price.active) {
        return jsonRes({ error: `Price ${priceId} is archived/inactive`, attempted_price_id: priceId }, 500);
      }
      if (!price.recurring) {
        return jsonRes({ error: `Price ${priceId} is not recurring`, attempted_price_id: priceId, price_type: price.type }, 500);
      }
      if (price.currency !== "cad") {
        return jsonRes({ error: `Price ${priceId} currency is ${price.currency}, expected cad`, attempted_price_id: priceId }, 500);
      }
    } catch (err) {
      const e = err as { message?: string; code?: string; type?: string };
      return jsonRes({
        error: `Price retrieve failed: ${e.message ?? String(err)}`,
        stripe_code: e.code,
        stripe_type: e.type,
        attempted_price_id: priceId,
      }, 500);
    }

    let customerId = row.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: row.email ?? undefined,
        name: row.name ?? undefined,
        metadata: {
          restaurant_id: row.id,
          stripe_account_id: row.stripe_account_id,
        },
      });
      customerId = customer.id;
      const { error: updateErr } = await supabaseAdmin
        .from("restaurants")
        .update({ stripe_customer_id: customerId })
        .eq("id", row.id);
      if (updateErr) return jsonRes({ error: updateErr.message }, 500);
    }

    // Attach the payment method + set it as the default for invoices.
    try {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    } catch (err) {
      // If the method is already attached (re-submit), continue. Anything else
      // is a real error.
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes("already")) {
        return jsonRes({ error: msg }, 400);
      }
    }
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    let subscription;
    try {
      subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        trial_period_days: 90,
        payment_behavior: "default_incomplete",
        expand: ["latest_invoice.payment_intent"],
        metadata: { restaurant_id: row.id },
      });
    } catch (err) {
      const e = err as { message?: string; code?: string; type?: string; param?: string; raw?: unknown };
      return jsonRes({
        error: e.message ?? String(err),
        stripe_code: e.code,
        stripe_type: e.type,
        stripe_param: e.param,
        attempted_price_id: priceId,
        attempted_customer_id: customerId,
      }, 500);
    }

    const trialEndsAt =
      typeof subscription.trial_end === "number"
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null;

    const { error: subUpdateErr } = await supabaseAdmin
      .from("restaurants")
      .update({
        subscription_status: subscription.status,
        trial_ends_at: trialEndsAt,
      })
      .eq("id", row.id);
    if (subUpdateErr) return jsonRes({ error: subUpdateErr.message }, 500);

    return jsonRes({
      subscription_id: subscription.id,
      status: subscription.status,
      trial_ends_at: trialEndsAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
