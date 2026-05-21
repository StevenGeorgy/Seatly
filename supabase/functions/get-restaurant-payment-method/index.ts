// get-restaurant-payment-method: returns the brand + last4 + expiry of the
// default payment method on the restaurant's Stripe customer. Used by the
// wizard Step 8 + dashboard Settings to show "Visa ending in 4242" next to
// the Change card button, so the owner can tell at a glance which card is
// on file before they swap it.
//
// Auth: caller must be the restaurant owner. JWT decoded internally;
// `verify_jwt = false` in supabase/config.toml.
//
// Payload: { restaurant_id }
//
// Returns: { ok: true, has_card: bool, brand?, last4?, exp_month?, exp_year? }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { ObservabilityRestaurantOnlySchema } from "../_shared/validation/observability.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";
import { isOwnerOfRestaurant } from "../_shared/auth-restaurants.ts";

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


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return jsonRes({ error: "Missing authorization token" }, 401);

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) return jsonRes({ error: "Invalid or expired session" }, 401);

    const parsed = await parseJsonBody(req, ObservabilityRestaurantOnlySchema, {
      jsonRes,
    });
    if ("response" in parsed) return parsed.response;
    const restaurantId = parsed.data.restaurant_id;

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "get-restaurant-payment-method",
        rateLimitIdentifier(req, user.id),
        { limit: 30, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const isOwner = await isOwnerOfRestaurant(supabaseAdmin, user.id, restaurantId);
    if (!isOwner) return jsonRes({ error: "Not authorized for this restaurant" }, 403);

    const { data: restaurant } = await supabaseAdmin
      .from("restaurants")
      .select("stripe_customer_id")
      .eq("id", restaurantId)
      .maybeSingle();
    const customerId = (restaurant as { stripe_customer_id: string | null } | null)?.stripe_customer_id;
    if (!customerId) {
      return jsonRes({ ok: true, has_card: false });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const stripe = await getStripeClient(stripeKey);

    // Prefer the customer's default PM (invoice_settings). Fall back to the
    // first card in the customer's PM list. (`save-subscription-payment-method`
    // always sets the default, but legacy customers may not have it set.)
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) {
      return jsonRes({ ok: true, has_card: false });
    }
    const defaultPmId =
      typeof customer.invoice_settings?.default_payment_method === "string"
        ? customer.invoice_settings.default_payment_method
        : null;

    let pm: { card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number } } | null = null;
    if (defaultPmId) {
      try {
        const fetched = await stripe.paymentMethods.retrieve(defaultPmId);
        pm = fetched as never;
      } catch {
        pm = null;
      }
    }
    if (!pm) {
      const list = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
      if (list.data.length > 0) {
        pm = list.data[0] as never;
      }
    }
    if (!pm || !pm.card) {
      return jsonRes({ ok: true, has_card: false });
    }

    return jsonRes({
      ok: true,
      has_card: true,
      brand: pm.card.brand ?? null,
      last4: pm.card.last4 ?? null,
      exp_month: pm.card.exp_month ?? null,
      exp_year: pm.card.exp_year ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
