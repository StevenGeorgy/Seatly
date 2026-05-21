import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { parseJsonBody } from "../_shared/validation/parse.ts";
import { StripeSetupIntentSchema } from "../_shared/validation/payment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonRes(body: unknown, status = 200) {
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

  try {
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!bearerToken) return jsonRes({ error: "auth_required" }, 401);
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(bearerToken);
    if (authError || !user) return jsonRes({ error: "invalid_token" }, 401);
    const authUserId = user.id;

    const parsed = await parseJsonBody(req, StripeSetupIntentSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const restaurantId = parsed.data.restaurant_id ?? null;

    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("id, full_name, email, stripe_customer_id")
      .eq("auth_user_id", authUserId)
      .single();
    if (!profile) return jsonRes({ error: "User profile not found" }, 404);

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");

    // ── Test mode (no Stripe key) ──
    if (!stripeKey) {
      return jsonRes({ client_secret: null, mode: "test" });
    }

    // ── Live mode ──
    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    // Branch A — restaurant subscription onboarding. Target the restaurant's
    // customer so the resulting PaymentMethod can be used by create-subscription
    // without a customer-swap (Stripe blocks moving a PM between customers).
    if (restaurantId) {
      const { data: roleRow } = await supabaseAdmin
        .from("user_restaurant_roles")
        .select("role")
        .eq("user_id", (profile as { id: string }).id)
        .eq("restaurant_id", restaurantId)
        .eq("role", "owner")
        .maybeSingle();
      if (!roleRow) return jsonRes({ error: "Not authorized for this restaurant" }, 403);

      const { data: rest } = await supabaseAdmin
        .from("restaurants")
        .select("id, name, email, stripe_customer_id")
        .eq("id", restaurantId)
        .single();
      if (!rest) return jsonRes({ error: "Restaurant not found" }, 404);

      let customerId = (rest as { stripe_customer_id: string | null }).stripe_customer_id;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: (rest as { email: string | null }).email || undefined,
          name: (rest as { name: string | null }).name || undefined,
          metadata: { restaurant_id: (rest as { id: string }).id },
        });
        customerId = customer.id;
        await supabaseAdmin
          .from("restaurants")
          .update({ stripe_customer_id: customerId })
          .eq("id", (rest as { id: string }).id);
      }

      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ["card"],
        usage: "off_session",
      });

      return jsonRes({ client_secret: setupIntent.client_secret, mode: "live" });
    }

    // Branch B — diner saved-card flow. Target the diner's personal customer.
    let customerId = profile.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile.email || undefined,
        name: profile.full_name || undefined,
        metadata: { user_profile_id: profile.id },
      });
      customerId = customer.id;
      await supabaseAdmin
        .from("user_profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", profile.id);
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
    });

    return jsonRes({ client_secret: setupIntent.client_secret, mode: "live" });
  } catch (err) {
    return jsonRes({ error: String(err) }, 500);
  }
});
