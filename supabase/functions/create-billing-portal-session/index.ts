// create-billing-portal-session: returns a short-lived Stripe Billing Portal
// session URL for the restaurant owner to (a) update their default payment
// method, (b) view past invoices, or (c) cancel the subscription. Used by
// the dashboard Settings → Billing tab's "Manage payment" and "Cancel plan"
// buttons.
//
// Auth: caller must be an owner of the restaurant.
// `verify_jwt = false` in supabase/config.toml — we decode the JWT ourselves.
//
// Payload: { restaurant_id, return_url?, flow? }
//   flow: "default" | "payment_method_update" | "subscription_cancel"
//     - default → portal home (manage payment + cancel + invoices in one place)
//     - payment_method_update → opens directly on the update-card flow
//     - subscription_cancel → opens directly on the cancel-subscription flow

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Flow = "default" | "payment_method_update" | "subscription_cancel";

type Payload = {
  restaurant_id?: unknown;
  return_url?: unknown;
  flow?: unknown;
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

function isAllowedReturnUrl(value: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    // Allow localhost for dev + any cenaiva.com host for prod. Reject everything
    // else so an attacker can't use the portal flow to redirect victims off-site.
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
    if (u.hostname === "cenaiva.com" || u.hostname.endsWith(".cenaiva.com")) return true;
    return false;
  } catch {
    return false;
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

    const payload = (await req.json().catch(() => ({}))) as Payload;
    const restaurantId =
      typeof payload.restaurant_id === "string" && payload.restaurant_id.trim()
        ? payload.restaurant_id.trim()
        : null;
    if (!restaurantId) return jsonRes({ error: "restaurant_id is required" }, 400);

    const flow: Flow =
      payload.flow === "payment_method_update" || payload.flow === "subscription_cancel"
        ? payload.flow
        : "default";

    const rawReturnUrl =
      typeof payload.return_url === "string" && payload.return_url.trim()
        ? payload.return_url.trim()
        : null;
    const returnUrl = rawReturnUrl && isAllowedReturnUrl(rawReturnUrl)
      ? rawReturnUrl
      : "https://cenaiva.com/dashboard/settings";

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "create-billing-portal-session",
        rateLimitIdentifier(req, user.id),
        { limit: 10, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const isOwner = await ownerOfRestaurant(user.id, restaurantId);
    if (!isOwner) return jsonRes({ error: "Not authorized for this restaurant" }, 403);

    const { data: restaurant, error: restErr } = await supabaseAdmin
      .from("restaurants")
      .select("id, stripe_customer_id")
      .eq("id", restaurantId)
      .maybeSingle();
    if (restErr || !restaurant) return jsonRes({ error: "Restaurant not found" }, 404);
    const customerId = (restaurant as { stripe_customer_id: string | null }).stripe_customer_id;
    if (!customerId) {
      return jsonRes({
        error: "No subscription found. Complete payment setup first.",
      }, 400);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    // Stripe Billing Portal flow_data is optional. When omitted, the portal
    // opens on its home view. When provided, it deep-links into a specific
    // flow (update payment method, cancel subscription). For the cancel and
    // update flows we need the active subscription id; look it up.
    let flowData: Record<string, unknown> | undefined;
    if (flow === "subscription_cancel") {
      const list = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 5,
      });
      const active = list.data.find(
        (s) => s.status === "active" || s.status === "trialing" || s.status === "past_due",
      );
      if (!active) {
        return jsonRes({ error: "No active subscription to cancel." }, 400);
      }
      flowData = {
        type: "subscription_cancel",
        subscription_cancel: { subscription: active.id },
      };
    } else if (flow === "payment_method_update") {
      flowData = { type: "payment_method_update" };
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
      ...(flowData ? { flow_data: flowData as never } : {}),
    });

    return jsonRes({ url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
