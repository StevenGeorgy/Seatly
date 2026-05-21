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

    const isOwner = await isOwnerOfRestaurant(supabaseAdmin, user.id, restaurantId);
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

    const stripe = await getStripeClient(stripeKey);

    // Two modes:
    //   onboarding (default) — wizard Step 8 first-time setup. Shows the
    //     classic Stripe onboarding form.
    //   management — dashboard re-verification. Shows account_management
    //     for ongoing settings + notification_banner for actionable errors
    //     (e.g. "address couldn't be verified — upload a document"). This
    //     surfaces the "Update info" CTAs that account_onboarding hides
    //     once details_submitted=true.
    const mode = (parsed.data as { mode?: string }).mode === "management"
      ? "management"
      : "onboarding";

    const components = mode === "management"
      ? {
        account_management: { enabled: true },
        notification_banner: { enabled: true },
      }
      : { account_onboarding: { enabled: true } };

    const session = await stripe.accountSessions.create({
      account: row.stripe_account_id,
      components,
    });

    return jsonRes({ client_secret: session.client_secret, mode });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
