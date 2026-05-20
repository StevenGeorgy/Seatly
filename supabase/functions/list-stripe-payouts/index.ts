// list-stripe-payouts: returns the restaurant's pending + recent payouts
// from their Connect account, plus the current available balance. Powers
// the "Pending payout: $X — arrives in your bank by May 25" section on
// Settings → Billing.
//
// Auth: caller must be a restaurant owner. JWT decoded internally;
// `verify_jwt = false` in supabase/config.toml.
//
// Payload: { restaurant_id }
//
// Returns:
//   {
//     ok: true,
//     has_account: bool,
//     payouts_enabled: bool,
//     available_balance_cents: number,
//     pending_balance_cents: number,
//     payouts: [{
//       id, amount_cents, currency, status,
//       arrival_date_iso, created_iso,
//     }],
//   }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = { restaurant_id?: unknown };

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

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "list-stripe-payouts",
        rateLimitIdentifier(req, user.id),
        { limit: 30, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const isOwner = await ownerOfRestaurant(user.id, restaurantId);
    if (!isOwner) return jsonRes({ error: "Not authorized for this restaurant" }, 403);

    const { data: rest } = await supabaseAdmin
      .from("restaurants")
      .select("stripe_account_id, stripe_payouts_enabled")
      .eq("id", restaurantId)
      .maybeSingle();
    if (!rest) return jsonRes({ error: "Restaurant not found" }, 404);
    const row = rest as {
      stripe_account_id: string | null;
      stripe_payouts_enabled: boolean | null;
    };

    if (!row.stripe_account_id) {
      return jsonRes({
        ok: true,
        has_account: false,
        payouts_enabled: false,
        available_balance_cents: 0,
        pending_balance_cents: 0,
        payouts: [],
      });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe not configured on server" }, 500);
    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    // Both calls go AGAINST the connected account.
    const stripeAccount = row.stripe_account_id;
    let payoutsResp;
    let balanceResp;
    try {
      [payoutsResp, balanceResp] = await Promise.all([
        stripe.payouts.list({ limit: 10 }, { stripeAccount }),
        stripe.balance.retrieve({}, { stripeAccount }),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[list-stripe-payouts] Stripe error:", msg);
      // Most likely cause: KYC restrictions on the connected account.
      // Return an empty-but-valid shape so the UI shows the right empty state.
      return jsonRes({
        ok: true,
        has_account: true,
        payouts_enabled: Boolean(row.stripe_payouts_enabled),
        available_balance_cents: 0,
        pending_balance_cents: 0,
        payouts: [],
        stripe_error: msg,
      });
    }

    const availableSum = (balanceResp.available ?? [])
      .reduce((acc: number, b: { amount?: number }) => acc + (b.amount ?? 0), 0);
    const pendingSum = (balanceResp.pending ?? [])
      .reduce((acc: number, b: { amount?: number }) => acc + (b.amount ?? 0), 0);

    const payouts = (payoutsResp.data ?? []).map((p: {
      id: string;
      amount: number;
      currency: string;
      status: string;
      arrival_date: number;
      created: number;
    }) => ({
      id: p.id,
      amount_cents: p.amount,
      currency: p.currency,
      status: p.status,
      arrival_date_iso: p.arrival_date
        ? new Date(p.arrival_date * 1000).toISOString()
        : null,
      created_iso: p.created
        ? new Date(p.created * 1000).toISOString()
        : null,
    }));

    return jsonRes({
      ok: true,
      has_account: true,
      payouts_enabled: Boolean(row.stripe_payouts_enabled),
      available_balance_cents: availableSum,
      pending_balance_cents: pendingSum,
      payouts,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[list-stripe-payouts] unhandled error:", msg);
    return jsonRes({ error: msg }, 500);
  }
});
