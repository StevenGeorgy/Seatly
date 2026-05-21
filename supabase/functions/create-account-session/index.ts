// create-account-session: Phase D (Stripe wire-up). Issues a short-lived
// Stripe Account Session token for the embedded Connect onboarding component
// (`<ConnectAccountOnboarding />` on the client). Called every time the
// frontend mounts the component.
//
// Auth: same as create-stripe-account — caller must be the restaurant owner.
// `verify_jwt = false` in supabase/config.toml because we decode the JWT
// ourselves.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { RestaurantIdOnlySchema } from "../_shared/validation/subscription.ts";

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

    const parsed = await parseJsonBody(req, RestaurantIdOnlySchema, { jsonRes });
    if ("response" in parsed) return parsed.response;
    const restaurantId = parsed.data.restaurant_id;

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "create-account-session",
        rateLimitIdentifier(req, user.id),
        { limit: 60, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const isOwner = await ownerOfRestaurant(user.id, restaurantId);
    if (!isOwner) return jsonRes({ error: "Not authorized for this restaurant" }, 403);

    const { data: restaurant, error: restErr } = await supabaseAdmin
      .from("restaurants")
      .select("id, stripe_account_id")
      .eq("id", restaurantId)
      .maybeSingle();
    if (restErr || !restaurant) return jsonRes({ error: "Restaurant not found" }, 404);

    const row = restaurant as { id: string; stripe_account_id: string | null };
    if (!row.stripe_account_id) {
      return jsonRes(
        { error: "Stripe account not created yet — call create-stripe-account first" },
        400,
      );
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    const session = await stripe.accountSessions.create({
      account: row.stripe_account_id,
      components: {
        account_onboarding: { enabled: true },
      },
    });

    return jsonRes({ client_secret: session.client_secret });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
