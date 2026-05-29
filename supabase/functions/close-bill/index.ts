// close-bill: staff "close the tab" action — marks an order paid (e.g. a
// cash / house-account close) WITHOUT a Stripe charge.
//
// 2026-05-29 security #4: this was anon-callable with NO auth — anyone who
// knew an order_id could mark any restaurant's order paid for $0 and inject an
// arbitrary tip into total_amount. Now gated: the caller must be authenticated
// (checkAuth, ES256-verified) AND hold a staff role on the ORDER's restaurant.
// Rate-limited per user. Idempotent: a re-close of an already-paid order is a
// no-op. verify_jwt=false in config.toml because the gateway can't pass ES256
// tokens; the in-function checkAuth IS the signature check.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { checkAuth } from "../_shared/auth.ts";
import {
  enforceRateLimit,
  rateLimitIdentifier,
  RateLimitError,
} from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { CloseBillSchema } from "../_shared/validation/reservation-hold.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STAFF_ROLES = ["owner", "manager", "server", "host", "staff"];

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    // (1) Authenticate (cryptographic ES256 signature check).
    const auth = await checkAuth(req, supabase);
    if (!auth.ok) return jsonRes({ error: "Unauthorized" }, 401);

    // Resolve user_profiles.id (user_restaurant_roles.user_id references it).
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", auth.authUserId)
      .maybeSingle();
    if (!profile?.id) return jsonRes({ error: "Profile not found" }, 404);

    // Rate limit per user.
    try {
      await enforceRateLimit(
        supabase,
        "close-bill",
        rateLimitIdentifier(req, profile.id),
        { limit: 30, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const parsed = await parseJsonBody(req, CloseBillSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const orderId = parsed.data.order_id;
    const tipAmount = parsed.data.tip_amount ?? 0;
    const paymentMethod = parsed.data.payment_method || "card";
    if (!orderId) return jsonRes({ error: "order_id required" }, 400);

    const { data: order, error: fetchErr } = await supabase
      .from("orders")
      .select("id, subtotal, tax_amount, discount_amount, restaurant_id, status")
      .eq("id", orderId)
      .single();
    if (fetchErr || !order) return jsonRes({ error: "Order not found" }, 404);

    // (2) Authorize: caller must hold a staff role on THIS order's restaurant.
    const { data: roleRows } = await supabase
      .from("user_restaurant_roles")
      .select("id")
      .eq("restaurant_id", order.restaurant_id)
      .eq("user_id", profile.id)
      .in("role", STAFF_ROLES)
      .limit(1);
    if (!roleRows || roleRows.length === 0) {
      return jsonRes({ error: "Not authorized for this restaurant" }, 403);
    }

    // Idempotent: already-paid orders are a no-op (avoid re-stamping paid_at
    // / overwriting the tip+total on a double-click).
    if (order.status === "paid") {
      return jsonRes({ ok: true, order_id: orderId, already_paid: true });
    }

    const subtotal = Number(order.subtotal || 0);
    const taxAmount = Number(order.tax_amount || 0);
    const discountAmount = Number(order.discount_amount || 0);
    const totalAmount = subtotal + taxAmount - discountAmount + Number(tipAmount);
    const nowIso = new Date().toISOString();

    const { error: updateErr } = await supabase
      .from("orders")
      .update({
        tip_amount: tipAmount,
        total_amount: totalAmount,
        payment_method: paymentMethod,
        status: "paid",
        paid_at: nowIso,
        billed_at: nowIso,
      })
      .eq("id", orderId)
      .neq("status", "paid"); // guard against a concurrent close

    if (updateErr) return jsonRes({ error: updateErr.message }, 500);

    return jsonRes({ ok: true, order_id: orderId, paid_at: nowIso });
  } catch (err) {
    return jsonRes({ error: String(err) }, 500);
  }
});
