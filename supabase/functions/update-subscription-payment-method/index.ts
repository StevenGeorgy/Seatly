// update-subscription-payment-method: swap the card backing a restaurant's
// Cenaiva subscription. The owner enters new card details in our wizard's
// "Change card" form (or the dashboard equivalent); the client confirms the
// SetupIntent against the restaurant's Stripe customer; this function then:
//
//   1. Verifies the PaymentMethod is attached to the restaurant's customer
//      (it should be — confirmSetup attaches it during the client-side flow).
//   2. Sets the new PM as `customer.invoice_settings.default_payment_method`
//      so future invoices/charges use it.
//   3. Sets the new PM as `subscription.default_payment_method` on the
//      restaurant's active subscription (covers any existing in-flight
//      invoice that resolves from the sub's default rather than the
//      customer's default).
//   4. Detaches every other PaymentMethod from the customer so the stored-
//      card list doesn't accumulate stale cards over time.
//
// Auth: caller must be the restaurant's owner. We decode the JWT ourselves;
// `verify_jwt = false` in supabase/config.toml.
//
// Payload: { restaurant_id, payment_method_id }
//
// Returns: { ok: true, default_payment_method: string, subscription_id: string | null }
//          { error: string } on failure.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { UpdateSubscriptionPaymentMethodSchema } from "../_shared/validation/subscription.ts";
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

    const parsed = await parseJsonBody(req, UpdateSubscriptionPaymentMethodSchema, {
      jsonRes,
    });
    if ("response" in parsed) return parsed.response;
    const restaurantId = parsed.data.restaurant_id;
    const paymentMethodId = parsed.data.payment_method_id;

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "update-subscription-payment-method",
        rateLimitIdentifier(req, user.id),
        { limit: 10, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const isOwner = await isOwnerOfRestaurant(supabaseAdmin, user.id, restaurantId);
    if (!isOwner) return jsonRes({ error: "Not authorized for this restaurant" }, 403);

    const { data: restaurant, error: restErr } = await supabaseAdmin
      .from("restaurants")
      .select("id, stripe_customer_id")
      .eq("id", restaurantId)
      .maybeSingle();
    if (restErr || !restaurant) return jsonRes({ error: "Restaurant not found" }, 404);
    const customerId = (restaurant as { stripe_customer_id: string | null }).stripe_customer_id;
    if (!customerId) {
      return jsonRes({ error: "No subscription found. Complete payment setup first." }, 400);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const stripe = await getStripeClient(stripeKey);

    // Verify the PM exists and belongs to this customer (confirmSetup on the
    // client should have attached it during the SetupIntent confirm step).
    // If it isn't attached yet (very-fast retry, attach not yet replicated),
    // attach it now — idempotent if already attached.
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      if (pm.customer && pm.customer !== customerId) {
        return jsonRes({
          error: "That card is attached to a different Stripe customer.",
          stripe_code: "payment_method_customer_mismatch",
        }, 400);
      }
      if (!pm.customer) {
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
      }
    } catch (err) {
      const e = err as { message?: string; code?: string };
      return jsonRes({
        error: e.message ?? String(err),
        stripe_code: e.code,
        attempted_payment_method_id: paymentMethodId,
      }, 400);
    }

    // (2) Set as the customer's default for future invoices.
    try {
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
    } catch (err) {
      const e = err as { message?: string; code?: string };
      return jsonRes({
        error: `Customer update failed: ${e.message ?? String(err)}`,
        stripe_code: e.code,
      }, 500);
    }

    // (3) Set as the active subscription's default too. Belt-and-suspenders:
    // the customer-level default covers most cases, but Stripe will use a
    // subscription-level override if one is set, so we update both to keep
    // them in sync. Find any sub in a meaningful billing state.
    let subscriptionId: string | null = null;
    try {
      const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 10,
      });
      const active = subs.data.find(
        (s) => s.status === "trialing" || s.status === "active" ||
               s.status === "past_due" || s.status === "incomplete",
      );
      if (active) {
        await stripe.subscriptions.update(active.id, {
          default_payment_method: paymentMethodId,
        });
        subscriptionId = active.id;
      }
    } catch (err) {
      // Non-fatal — the customer-level default is the primary mechanism.
      // Log and continue.
      console.warn(
        "[update-subscription-payment-method] subscription update failed",
        err instanceof Error ? err.message : String(err),
      );
    }

    // (4) Detach every OTHER card on this customer so the stored list stays
    // clean. Detach is idempotent if the PM isn't attached; harmless if the
    // customer has only the new one. Skip on errors to avoid blocking the
    // primary flow.
    try {
      const otherPms = await stripe.paymentMethods.list({
        customer: customerId,
        type: "card",
        limit: 20,
      });
      for (const pm of otherPms.data) {
        if (pm.id === paymentMethodId) continue;
        try {
          await stripe.paymentMethods.detach(pm.id);
        } catch (detachErr) {
          console.warn(
            "[update-subscription-payment-method] detach failed",
            pm.id,
            detachErr instanceof Error ? detachErr.message : String(detachErr),
          );
        }
      }
    } catch (err) {
      console.warn(
        "[update-subscription-payment-method] list-detach failed",
        err instanceof Error ? err.message : String(err),
      );
    }

    return jsonRes({
      ok: true,
      default_payment_method: paymentMethodId,
      subscription_id: subscriptionId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
