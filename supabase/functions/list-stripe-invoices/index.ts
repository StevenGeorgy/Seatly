// list-stripe-invoices: returns paginated Stripe invoices for the
// restaurant's stripe_customer_id. Used by the dashboard Settings → Billing
// tab to render the real invoice history (replaces the prior hardcoded list).
//
// Auth: caller must be an owner of the restaurant.
// `verify_jwt = false` in supabase/config.toml — we decode the JWT ourselves.

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
  limit?: unknown;
  starting_after?: unknown;
};

type InvoiceOut = {
  id: string;
  number: string | null;
  status: string | null;
  amount_due_cents: number;
  amount_paid_cents: number;
  currency: string;
  created_iso: string;
  period_end_iso: string | null;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
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
    if (!restaurantId) return jsonRes({ error: "restaurant_id is required" }, 400);

    const requestedLimit =
      typeof payload.limit === "number" && Number.isFinite(payload.limit)
        ? Math.max(1, Math.min(50, Math.floor(payload.limit)))
        : 12;
    const startingAfter =
      typeof payload.starting_after === "string" && payload.starting_after.trim()
        ? payload.starting_after.trim()
        : undefined;

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "list-stripe-invoices",
        rateLimitIdentifier(req, user.id),
        { limit: 30, windowSeconds: 60 },
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
      return jsonRes({ invoices: [], has_more: false });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    const result = await stripe.invoices.list({
      customer: customerId,
      limit: requestedLimit,
      starting_after: startingAfter,
    });

    const invoices: InvoiceOut[] = result.data.map((inv) => ({
      id: inv.id,
      number: inv.number ?? null,
      status: inv.status ?? null,
      amount_due_cents: inv.amount_due ?? 0,
      amount_paid_cents: inv.amount_paid ?? 0,
      currency: (inv.currency ?? "cad").toUpperCase(),
      created_iso: new Date((inv.created ?? 0) * 1000).toISOString(),
      period_end_iso:
        typeof inv.period_end === "number"
          ? new Date(inv.period_end * 1000).toISOString()
          : null,
      hosted_invoice_url: inv.hosted_invoice_url ?? null,
      invoice_pdf: inv.invoice_pdf ?? null,
    }));

    return jsonRes({
      invoices,
      has_more: result.has_more,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
