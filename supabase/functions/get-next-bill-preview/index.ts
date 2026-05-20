// get-next-bill-preview: returns a live preview of the restaurant's next
// monthly Cenaiva invoice — the $199.99 subscription + accumulated
// $1/booking fees that have been added as pending invoiceItems since the
// last bill. Powers the "Next bill: $X on Jun 1" tile in Settings → Billing.
//
// Auth: caller must be a restaurant owner. JWT decoded internally;
// `verify_jwt = false` in supabase/config.toml.
//
// Payload: { restaurant_id }
//
// Returns:
//   { ok: true, has_upcoming: true, next_amount_cents, next_date_iso,
//     currency, line_items: [{ description, amount_cents, quantity }] }
//   OR
//   { ok: true, has_upcoming: false, reason: "trialing" | "no_subscription" | "no_customer" }

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
        "get-next-bill-preview",
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
      .select("stripe_customer_id, stripe_subscription_id, subscription_status, currency")
      .eq("id", restaurantId)
      .maybeSingle();
    if (!rest) return jsonRes({ error: "Restaurant not found" }, 404);
    const row = rest as {
      stripe_customer_id: string | null;
      stripe_subscription_id: string | null;
      subscription_status: string | null;
      currency: string | null;
    };

    if (!row.stripe_customer_id) {
      return jsonRes({ ok: true, has_upcoming: false, reason: "no_customer" });
    }
    if (!row.stripe_subscription_id) {
      return jsonRes({
        ok: true,
        has_upcoming: false,
        reason: row.subscription_status === "trialing" ? "trialing" : "no_subscription",
      });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe not configured on server" }, 500);

    // Stripe deprecated /v1/invoices/upcoming (the SDK's retrieveUpcoming
    // helper) in late 2025. Use the replacement endpoint via raw fetch since
    // the SDK ships createPreview only in newer versions. POST form-encoded
    // matches Stripe's API contract.
    const previewBody = new URLSearchParams({
      customer: row.stripe_customer_id,
      subscription: row.stripe_subscription_id,
    });
    let upcoming: unknown;
    let previewStatus = 0;
    try {
      const res = await fetch("https://api.stripe.com/v1/invoices/create_preview", {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${stripeKey}:`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: previewBody.toString(),
      });
      previewStatus = res.status;
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        const errCode = (body as { error?: { code?: string } } | null)?.error?.code;
        // Stripe returns invoice_upcoming_none / nothing-to-invoice when the
        // customer has no convertible items. Treat as graceful empty.
        if (
          errCode === "invoice_upcoming_none" ||
          errCode === "invoice_no_customer_line_items"
        ) {
          return jsonRes({
            ok: true,
            has_upcoming: false,
            reason: row.subscription_status === "trialing" ? "trialing" : "no_subscription",
          });
        }
        const errMsg = (body as { error?: { message?: string } } | null)?.error?.message
          ?? `Stripe preview failed (${previewStatus})`;
        return jsonRes({ error: errMsg }, 502);
      }
      upcoming = body;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonRes({ error: `Preview fetch failed: ${msg}` }, 502);
    }

    const inv = upcoming as {
      amount_due?: number;
      currency?: string;
      next_payment_attempt?: number | null;
      period_end?: number | null;
      lines?: { data?: Array<{
        amount?: number;
        description?: string | null;
        quantity?: number | null;
        price?: { recurring?: { interval?: string } | null } | null;
      }>} | null;
    };
    const lines = inv.lines?.data ?? [];
    const lineItems = lines.map((l) => ({
      description: l.description ?? "Line item",
      amount_cents: typeof l.amount === "number" ? l.amount : 0,
      quantity: typeof l.quantity === "number" ? l.quantity : 1,
      is_subscription: Boolean(l.price?.recurring),
    }));

    const nextTs = inv.next_payment_attempt ?? inv.period_end ?? null;
    const nextDateIso = nextTs ? new Date(nextTs * 1000).toISOString() : null;

    return jsonRes({
      ok: true,
      has_upcoming: true,
      next_amount_cents: typeof inv.amount_due === "number" ? inv.amount_due : 0,
      next_date_iso: nextDateIso,
      currency: (inv.currency ?? row.currency ?? "cad").toLowerCase(),
      line_items: lineItems,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[get-next-bill-preview] unhandled error:", msg);
    return jsonRes({ error: msg }, 500);
  }
});
