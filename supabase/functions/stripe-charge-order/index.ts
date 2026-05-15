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
    // Phase 9 of diner auth overhaul (2026-05-15): Connect-aware
    // refactor. The diner's `stripe_customer_id` lives on the platform
    // account. To route money to the restaurant, we clone the
    // PaymentMethod to the connected account (`stripeAccount` option)
    // and create the PI directly on the connected account with a 5%
    // application fee. 95% lands on the restaurant; 5% on Cenaiva's
    // platform. Same economics as destination charges, simpler refund
    // path. Mirrors Phase 4 saved-card-on-booking architecture.
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

    // Fetch restaurant currency + Stripe connected account
    const { data: restaurant } = await supabaseAdmin
      .from("restaurants")
      .select("currency, stripe_account_id, stripe_charges_enabled")
      .eq("id", order.restaurant_id)
      .single();
    const currency = (restaurant?.currency || "CAD").toLowerCase();
    const stripeAccountId = restaurant?.stripe_account_id as string | null;
    const chargesEnabled = restaurant?.stripe_charges_enabled === true;

    if (!stripeAccountId || !chargesEnabled) {
      return jsonRes({
        ok: false,
        error: "This restaurant cannot accept payments right now. Please contact them directly.",
      }, 400);
    }

    const totalCents = Math.round(total * 100);
    const applicationFeeCents = Math.max(Math.round(totalCents * 0.05), 1);

    let paymentIntent: any;
    let clonedPmId: string | null = null;
    try {
      // Step 1: clone the platform-account PaymentMethod onto the
      // restaurant's connected account. The clone is single-use here;
      // we don't persist its id (a future repeat charge would clone
      // again from the same source PM).
      const clonedPm = await stripe.paymentMethods.create(
        {
          customer: profile.stripe_customer_id!,
          payment_method: pmId,
        },
        { stripeAccount: stripeAccountId },
      );
      clonedPmId = clonedPm.id;

      // Step 2: create + confirm the PaymentIntent directly on the
      // connected account. Money lands in the restaurant's Stripe
      // balance; `application_fee_amount` is forwarded to the platform.
      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: totalCents,
          currency,
          payment_method: clonedPmId,
          off_session: true,
          confirm: true,
          application_fee_amount: applicationFeeCents,
          metadata: {
            order_id,
            restaurant_id: order.restaurant_id,
            user_profile_id: profile.id,
            // Pointer back to the platform-side source for support /
            // reconciliation. Cenaiva's audit trail can find the
            // original PM by walking from this cloned PI.
            platform_source_pm: pmId,
            platform_source_customer: profile.stripe_customer_id!,
          },
        },
        { stripeAccount: stripeAccountId },
      );
    } catch (stripeErr: any) {
      const code = stripeErr?.code as string | undefined;
      if (code === "authentication_required") {
        return jsonRes({
          ok: false,
          error: "Your card requires additional verification. Please use the checkout page.",
          requires_action: true,
          client_secret: stripeErr?.raw?.payment_intent?.client_secret ?? null,
        }, 402);
      }
      return jsonRes({ ok: false, error: stripeErr?.message || "Card declined." }, 402);
    }

    // If the PI returns requires_action (3D Secure / SCA), the
    // frontend needs the client_secret to call handleNextAction.
    if (paymentIntent.status === "requires_action") {
      return jsonRes({
        ok: false,
        requires_action: true,
        client_secret: paymentIntent.client_secret,
        stripe_account_id: stripeAccountId, // needed for SCA confirm
        error: "Additional verification required for this card.",
      }, 402);
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
