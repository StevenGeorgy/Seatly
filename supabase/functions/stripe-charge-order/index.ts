import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { OrderTipSchema } from "../_shared/validation/charge.ts";
import { computeDinerCharge } from "../_shared/stripe-fee.ts";
import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";

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

    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("id, stripe_customer_id")
      .eq("auth_user_id", authUserId)
      .single();
    if (!profile) return jsonRes({ error: "User profile not found" }, 404);

    // Rate limit: 5 charge attempts per minute per user. Prevents
    // accidental double-charge from a rapid retry storm and abuse.
    try {
      await enforceRateLimit(
        supabaseAdmin,
        "stripe-charge-order",
        rateLimitIdentifier(req, profile.id),
        { limit: 5, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const parsed = await parseJsonBody(req, OrderTipSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const { order_id, tip_amount: rawTipAmount, tip_percentage } = parsed.data;

    // Fetch and validate the order. Pull reservation join so we can reject
    // charges on cancelled reservations (security: prevents money being
    // taken after cancel, which would create a refund mess).
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, restaurant_id, subtotal, tax_amount, discount_amount, paid_at, guest_id, stripe_payment_intent_id, reservation_id")
      .eq("id", order_id)
      .single();
    if (!order) return jsonRes({ error: "Order not found" }, 404);
    if (order.paid_at) return jsonRes({ error: "Order is already paid" }, 400);

    // Reject charges on cancelled reservations. Without this guard, a
    // diner could cancel → restaurant refunds the deposit → diner walks
    // back through pay-the-bill and charges anyway, leaving the order
    // paid on a cancelled reservation. Manual reconciliation hell.
    const reservationId = (order as { reservation_id?: string | null }).reservation_id;
    if (reservationId) {
      const { data: reservation } = await supabaseAdmin
        .from("reservations")
        .select("status")
        .eq("id", reservationId)
        .maybeSingle();
      const status = (reservation as { status?: string } | null)?.status;
      if (status === "cancelled" || status === "no_show") {
        return jsonRes({
          ok: false,
          error: "This reservation was cancelled. You can't charge for it.",
          reservation_status: status,
        }, 409);
      }
    }
    // (The concurrent-charge guard is now an atomic DB claim just before the
    // Stripe charge — see CHARGING_SENTINEL below. The old SELECT-then-act
    // in-flight check here was TOCTOU.)

    // Verify ownership: user's guest must match this order's guest
    const { data: guest } = await supabaseAdmin
      .from("guests")
      .select("id")
      .eq("id", order.guest_id)
      .eq("user_profile_id", profile.id)
      .maybeSingle();
    if (!guest) return jsonRes({ error: "Unauthorized: order does not belong to you" }, 403);

    // Calculate base total. Split into food (commissionable) and tax
    // (pass-through). Cenaiva's 5.5% commission applies only to food;
    // tax is remitted by the restaurant. The diner pays food + tax
    // plus the Stripe processing fee; see computeDinerCharge below.
    const subtotal = Number(order.subtotal || 0);
    const tax = Number(order.tax_amount || 0);
    const discount = Number(order.discount_amount || 0);
    const tipAmount = rawTipAmount !== undefined
      ? rawTipAmount
      : tip_percentage !== undefined
        ? Math.round(subtotal * (tip_percentage / 100) * 100) / 100
        : 0;
    const foodAfterDiscount = subtotal - discount;
    const taxOnly = tax;
    // TODO(tip-handling): tips are currently passed to staff in person,
    // not through the platform. For back-compat we fold any non-zero
    // tipAmount into foodCents so the diner is still charged the same
    // total as before — but this means Cenaiva's 5.5% commission base
    // includes the tip. Revisit when we formalize tip routing.
    let foodCents = Math.round(foodAfterDiscount * 100);
    // Tip-independent base for the idempotency key (foodCents below gets the
    // tip folded in; keying on the tip would let two concurrent requests with
    // different tips mint two PIs — security #6).
    const foodExclTipCents = foodCents;
    const taxCents = Math.round(taxOnly * 100);
    if (tipAmount > 0) {
      console.warn(
        `[stripe-charge-order] order ${order_id}: non-zero tip (${tipAmount}) folded into foodCents; tip routing is out of scope`,
      );
      foodCents += Math.round(tipAmount * 100);
    }
    const baseTotal = Math.round(((foodCents + taxCents) / 100) * 100) / 100;

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const paidAt = new Date().toISOString();

    // ── Test mode ──
    if (!stripeKey) {
      const testIntentId = `test_pi_${Math.random().toString(36).slice(2, 12)}`;

      await supabaseAdmin.from("orders").update({
        tip_amount: tipAmount,
        total_amount: baseTotal,
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
        amount: baseTotal,
        currency: "cad",
        status: "succeeded",
        payment_type: "test",
      });

      return jsonRes({ ok: true, total_charged: baseTotal, tip_amount: tipAmount, paid_at: paidAt, mode: "test" });
    }

    // ── Live mode ──
    // Phase 9 of diner auth overhaul (2026-05-15): Connect-aware
    // refactor. The diner's `stripe_customer_id` lives on the platform
    // account. To route money to the restaurant, we clone the
    // PaymentMethod to the connected account (`stripeAccount` option)
    // and create the PI directly on the connected account with a 5.5%
    // application fee on the BASE. 2026-05-19 update: diner now pays
    // Stripe's processing fee on top (see computeDinerCharge); the PI
    // `amount` is grossed up and `application_fee_amount` stays 5.5%
    // of base. Restaurant nets 94.5% of base; Cenaiva keeps 5.5% of
    // base; Stripe's fee is fully covered by the gross-up.
    const stripe = await getStripeClient(stripeKey);

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

    const charge = computeDinerCharge(foodCents, taxCents);
    const dinerTotalCents = charge.dinerTotalCents;
    const processingFeeCents = charge.processingFeeCents;
    const applicationFeeCents = charge.applicationFeeCents;

    // Atomic claim (2026-05-29 security #6): move the order from
    // (paid_at NULL, stripe_payment_intent_id NULL) to a 'charging' sentinel
    // in ONE UPDATE so two concurrent requests can't both reach the Stripe
    // charge (the prior paid_at / in-flight checks were SELECT-then-act
    // TOCTOU). Only the request that wins the claim charges; the loser 409s.
    const CHARGING_SENTINEL = "__charging__";
    const { data: claimRows } = await supabaseAdmin
      .from("orders")
      .update({ stripe_payment_intent_id: CHARGING_SENTINEL })
      .eq("id", order_id)
      .is("paid_at", null)
      .is("stripe_payment_intent_id", null)
      .select("id");
    if (!claimRows || claimRows.length === 0) {
      return jsonRes({
        ok: false,
        error: "Order charge already in flight or paid. Please refresh and try again.",
        already_in_flight: true,
      }, 409);
    }
    // Release the claim (back to NULL) if we bail before a successful charge,
    // so a legitimate retry can re-claim. Only clears our own sentinel.
    const releaseClaim = async () => {
      await supabaseAdmin
        .from("orders")
        .update({ stripe_payment_intent_id: null })
        .eq("id", order_id)
        .eq("stripe_payment_intent_id", CHARGING_SENTINEL);
    };

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
      // Idempotency key keyed on order_id + base amount so the same
      // request retried within 24h reuses the existing PI rather than
      // creating a duplicate charge.
      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: dinerTotalCents,
          currency,
          payment_method: clonedPmId,
          off_session: true,
          confirm: true,
          application_fee_amount: applicationFeeCents,
          metadata: {
            order_id,
            restaurant_id: order.restaurant_id,
            user_profile_id: profile.id,
            base_amount_cents: String(foodCents),
            tax_cents: String(taxCents),
            processing_fee_cents: String(processingFeeCents),
            // Pointer back to the platform-side source for support /
            // reconciliation. Cenaiva's audit trail can find the
            // original PM by walking from this cloned PI.
            platform_source_pm: pmId,
            platform_source_customer: profile.stripe_customer_id!,
          },
        },
        {
          stripeAccount: stripeAccountId,
          idempotencyKey: `charge_order_${order_id}_${foodExclTipCents}_${taxCents}`,
        },
      );
    } catch (stripeErr: any) {
      await releaseClaim();
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
      // PI exists but needs SCA on the checkout page; don't leave the order
      // stuck on the sentinel — release so it can be re-attempted there.
      await releaseClaim();
      return jsonRes({
        ok: false,
        requires_action: true,
        client_secret: paymentIntent.client_secret,
        stripe_account_id: stripeAccountId, // needed for SCA confirm
        error: "Additional verification required for this card.",
      }, 402);
    }

    // orders.total_amount tracks the BASE the restaurant + Cenaiva net.
    // The grossed-up diner charge is recoverable from the PI / metadata.
    // The charge ALREADY succeeded at Stripe; if recording it fails we must
    // release the '__charging__' sentinel so a retry can re-confirm (the
    // tip-independent idempotency key returns the SAME PI -> no double charge)
    // and finish the bookkeeping. Otherwise the order is stuck uncharge-able.
    let recordErr: unknown = null;
    try {
      const { error: orderUpdateErr } = await supabaseAdmin.from("orders").update({
        tip_amount: tipAmount,
        total_amount: baseTotal,
        payment_method: "stripe",
        status: "paid",
        paid_at: paidAt,
        billed_at: paidAt,
        stripe_payment_intent_id: paymentIntent.id,
      }).eq("id", order_id);
      if (orderUpdateErr) {
        recordErr = orderUpdateErr;
      } else {
        const { error: paymentInsertErr } = await supabaseAdmin.from("payments").insert({
          order_id,
          restaurant_id: order.restaurant_id,
          user_profile_id: profile.id,
          stripe_payment_intent_id: paymentIntent.id,
          stripe_charge_id: paymentIntent.latest_charge as string || null,
          amount: baseTotal,
          currency,
          status: "succeeded",
          payment_type: "stripe",
        });
        if (paymentInsertErr) recordErr = paymentInsertErr;
      }
    } catch (e) {
      recordErr = e;
    }
    if (recordErr) {
      await releaseClaim();
      console.error("[stripe-charge-order] charge succeeded but recording failed", recordErr);
      return jsonRes({
        ok: false,
        error: "Payment went through but we couldn't record it. Please retry; you won't be charged twice.",
        recording_failed: true,
      }, 500);
    }

    return jsonRes({
      ok: true,
      total_charged: baseTotal,
      processing_fee: processingFeeCents / 100,
      diner_charged: dinerTotalCents / 100,
      tip_amount: tipAmount,
      paid_at: paidAt,
      mode: "live",
    });
  } catch (err) {
    return jsonRes({ error: String(err) }, 500);
  }
});
