import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    if (!token) return jsonRes({ error: "Missing authorization token" }, 401);

    const jwtPayload = decodeJwtPayload(token);
    const authUserId = jwtPayload?.sub as string | undefined;
    if (!authUserId) return jsonRes({ error: "Unauthorized" }, 401);

    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("id, stripe_customer_id")
      .eq("auth_user_id", authUserId)
      .single();
    if (!profile) return jsonRes({ error: "User profile not found" }, 404);

    const body = await req.json().catch(() => ({}));
    const { order_id, tip_amount: rawTipAmount, tip_percentage } = body;
    if (!order_id) return jsonRes({ error: "order_id is required" }, 400);

    // Fetch and validate the order
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, restaurant_id, subtotal, tax_amount, discount_amount, paid_at, guest_id")
      .eq("id", order_id)
      .single();
    if (!order) return jsonRes({ error: "Order not found" }, 404);
    if (order.paid_at) return jsonRes({ error: "Order is already paid" }, 400);

    // Verify ownership: user's guest must match this order's guest
    const { data: guest } = await supabaseAdmin
      .from("guests")
      .select("id")
      .eq("id", order.guest_id)
      .eq("user_profile_id", profile.id)
      .maybeSingle();
    if (!guest) return jsonRes({ error: "Unauthorized: order does not belong to you" }, 403);

    // Calculate total
    const subtotal = Number(order.subtotal || 0);
    const tax = Number(order.tax_amount || 0);
    const discount = Number(order.discount_amount || 0);
    const tipAmount = rawTipAmount != null
      ? Number(rawTipAmount)
      : tip_percentage != null
        ? Math.round(subtotal * (Number(tip_percentage) / 100) * 100) / 100
        : 0;
    const total = Math.round((subtotal + tax - discount + tipAmount) * 100) / 100;

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const paidAt = new Date().toISOString();

    // ── Test mode ──
    if (!stripeKey) {
      const testIntentId = `test_pi_${Math.random().toString(36).slice(2, 12)}`;

      await supabaseAdmin.from("orders").update({
        tip_amount: tipAmount,
        total_amount: total,
        payment_method: "card_test",
        status: "paid",
        paid_at: paidAt,
        billed_at: paidAt,
        stripe_payment_intent_id: testIntentId,
      }).eq("id", order_id);

      await supabaseAdmin.from("payments").insert({
        order_id,
        restaurant_id: order.restaurant_id,
        user_profile_id: profile.id,
        stripe_payment_intent_id: testIntentId,
        amount: total,
        currency: "cad",
        status: "succeeded",
        payment_type: "test",
      });

      return jsonRes({ ok: true, total_charged: total, tip_amount: tipAmount, paid_at: paidAt, mode: "test" });
    }

    // ── Live mode ──
    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    if (!profile.stripe_customer_id) {
      return jsonRes({ ok: false, error: "No saved card. Please add one in Account > Payment." }, 400);
    }

    // Get default saved card for this user
    const { data: savedCard } = await supabaseAdmin
      .from("saved_cards")
      .select("stripe_payment_method_id")
      .eq("user_profile_id", profile.id)
      .eq("is_default", true)
      .maybeSingle();

    const pmId = savedCard?.stripe_payment_method_id
      || (await supabaseAdmin
        .from("saved_cards")
        .select("stripe_payment_method_id")
        .eq("user_profile_id", profile.id)
        .order("created_at")
        .limit(1)
        .single()
      ).data?.stripe_payment_method_id;

    if (!pmId) {
      return jsonRes({ ok: false, error: "No saved payment method found." }, 400);
    }

    // Fetch restaurant currency
    const { data: restaurant } = await supabaseAdmin
      .from("restaurants")
      .select("currency")
      .eq("id", order.restaurant_id)
      .single();
    const currency = (restaurant?.currency || "CAD").toLowerCase();

    let paymentIntent: any;
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(total * 100), // Stripe uses cents
        currency,
        customer: profile.stripe_customer_id,
        payment_method: pmId,
        off_session: true,
        confirm: true,
        metadata: { order_id, restaurant_id: order.restaurant_id, user_profile_id: profile.id },
      });
    } catch (stripeErr: any) {
      if (stripeErr?.code === "authentication_required") {
        return jsonRes({ ok: false, error: "Your card requires additional verification. Please use the checkout page.", requires_action: true }, 402);
      }
      return jsonRes({ ok: false, error: stripeErr?.message || "Card declined." }, 402);
    }

    await supabaseAdmin.from("orders").update({
      tip_amount: tipAmount,
      total_amount: total,
      payment_method: "stripe",
      status: "paid",
      paid_at: paidAt,
      billed_at: paidAt,
      stripe_payment_intent_id: paymentIntent.id,
    }).eq("id", order_id);

    await supabaseAdmin.from("payments").insert({
      order_id,
      restaurant_id: order.restaurant_id,
      user_profile_id: profile.id,
      stripe_payment_intent_id: paymentIntent.id,
      stripe_charge_id: paymentIntent.latest_charge as string || null,
      amount: total,
      currency,
      status: "succeeded",
      payment_type: "stripe",
    });

    return jsonRes({ ok: true, total_charged: total, tip_amount: tipAmount, paid_at: paidAt, mode: "live" });
  } catch (err) {
    return jsonRes({ error: String(err) }, 500);
  }
});
