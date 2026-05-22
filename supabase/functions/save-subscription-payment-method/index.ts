// save-subscription-payment-method: 2026-05-20 deferred-trial flow. Saves a
// payment method onto the restaurant's Stripe customer WITHOUT creating any
// subscription. The wizard's Step 8 Save-card form calls this after
// `stripe.confirmSetup` succeeds; the trial clock doesn't start until the
// owner clicks Publish (see publish-restaurant).
//
// Auth: caller must be the restaurant owner. We decode the JWT ourselves;
// `verify_jwt = false` in supabase/config.toml.
//
// Payload: { restaurant_id, payment_method_id, disclosure_text, referral_code? }
//
// Effects:
//   - Attach PM to the restaurant's Stripe customer (idempotency-keyed).
//   - Set as customer.invoice_settings.default_payment_method.
//   - First-attach wins: stamp restaurants.payment_method_attached_at iff NULL
//     (so re-submits don't reset the 90-day cleanup clock).
//   - Write a row to subscription_consent_log with the exact disclosure text
//     shown to the owner. Defensible CRA-compliant audit record.
//   - If `referral_code` is provided AND `restaurants.referred_by_restaurant_id`
//     is currently NULL: resolve the code to a restaurant_id and set the
//     reference (immutable after first set). Rejects self-referral. Invalid /
//     unknown codes are silently ignored (don't break the card-save path).
//
// Returns: { ok: true, payment_method_attached_at: <iso> }
//          { error, stripe_code?, ... } on failure.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { SaveSubscriptionPaymentMethodSchema } from "../_shared/validation/subscription.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";
import { getOwnerRestaurantRole } from "../_shared/auth-restaurants.ts";

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


function firstHopIp(req: Request): string | null {
  const xff = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for");
  if (!xff) return null;
  const first = xff.split(",")[0]?.trim();
  return first || null;
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

    const parsed = await parseJsonBody(req, SaveSubscriptionPaymentMethodSchema, {
      jsonRes,
    });
    if ("response" in parsed) return parsed.response;
    const restaurantId = parsed.data.restaurant_id;
    const paymentMethodId = parsed.data.payment_method_id;
    const disclosureText = parsed.data.disclosure_text;
    // Referral program disabled — schema accepts referral_code for forward
    // compat but we deliberately ignore it here.
    const referralCode: string | null = null;

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "save-subscription-payment-method",
        rateLimitIdentifier(req, user.id),
        { limit: 10, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const { ok: isOwner, userProfileId } = await getOwnerRestaurantRole(supabaseAdmin, user.id, restaurantId);
    if (!isOwner) return jsonRes({ error: "Not authorized for this restaurant" }, 403);

    const { data: restaurant, error: restErr } = await supabaseAdmin
      .from("restaurants")
      .select(
        "id, stripe_customer_id, payment_method_attached_at, referred_by_restaurant_id, " +
          "address, city, province, postal_code, country, hst_registration_number",
      )
      .eq("id", restaurantId)
      .maybeSingle();
    if (restErr || !restaurant) return jsonRes({ error: "Restaurant not found" }, 404);

    const row = restaurant as {
      id: string;
      stripe_customer_id: string | null;
      payment_method_attached_at: string | null;
      referred_by_restaurant_id: string | null;
      address: string | null;
      city: string | null;
      province: string | null;
      postal_code: string | null;
      country: string | null;
      hst_registration_number: string | null;
    };
    const customerId = row.stripe_customer_id;
    if (!customerId) {
      return jsonRes({
        error:
          "No Stripe customer for this restaurant. Run stripe-setup-intent first.",
      }, 400);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const stripe = await getStripeClient(stripeKey);

    // Verify the PM belongs to (or can be attached to) this customer.
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      if (pm.customer && pm.customer !== customerId) {
        return jsonRes({
          error: "That card is attached to a different Stripe customer.",
          stripe_code: "payment_method_customer_mismatch",
        }, 400);
      }
      if (!pm.customer) {
        await stripe.paymentMethods.attach(
          paymentMethodId,
          { customer: customerId },
          { idempotencyKey: `attach_${restaurantId}_${paymentMethodId}` },
        );
      }
    } catch (err) {
      const e = err as { message?: string; code?: string; type?: string };
      return jsonRes({
        error: e.message ?? String(err),
        stripe_code: e.code,
        stripe_type: e.type,
        attempted_payment_method_id: paymentMethodId,
      }, 400);
    }

    // Push the restaurant's billing address onto the Stripe customer so
    // Stripe Tax can compute the per-province GST/HST rate when the
    // subscription invoices. Also push the HST registration number (if
    // provided) as a tax_id so it shows up on the invoice PDF for the
    // restaurant's own ITC records.
    const hasFullAddress = !!(row.address && row.city && row.province && row.postal_code);
    if (hasFullAddress) {
      try {
        await stripe.customers.update(customerId, {
          address: {
            line1: row.address as string,
            city: row.city as string,
            state: row.province as string,
            postal_code: row.postal_code as string,
            country: "CA",
          },
        });
      } catch (err) {
        console.warn(
          "[save-subscription-payment-method] customer address update failed",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    if (row.hst_registration_number) {
      try {
        await stripe.customers.createTaxId(customerId, {
          type: "ca_gst_hst",
          value: row.hst_registration_number as string,
        });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== "tax_id_already_exists") {
          console.warn("[save-subscription-payment-method] tax_id create failed", code, err);
        }
      }
    }

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

    // First-attach wins. The IS NULL guard makes re-submits idempotent and
    // prevents the cleanup clock from being reset by swap-card re-submissions.
    const { error: stampErr } = await supabaseAdmin
      .from("restaurants")
      .update({ payment_method_attached_at: new Date().toISOString() })
      .eq("id", restaurantId)
      .is("payment_method_attached_at", null);
    if (stampErr) {
      console.error("[save-subscription-payment-method] stamp failed", stampErr);
    }

    // Re-read to get the canonical timestamp (either the one we just stamped
    // or the pre-existing one if this was a re-submit).
    const { data: refreshed } = await supabaseAdmin
      .from("restaurants")
      .select("payment_method_attached_at")
      .eq("id", restaurantId)
      .maybeSingle();
    const attachedAt =
      (refreshed as { payment_method_attached_at: string | null } | null)
        ?.payment_method_attached_at ?? new Date().toISOString();

    // Referral code resolution. Immutable after first set — silently no-op
    // if referred_by_restaurant_id is already populated. Self-referral and
    // unknown codes are silently ignored (don't break the card-save path).
    if (referralCode && row.referred_by_restaurant_id === null) {
      try {
        const { data: referrerRow } = await supabaseAdmin
          .from("restaurants")
          .select("id")
          .eq("referral_code", referralCode)
          .is("deleted_at", null)
          .maybeSingle();
        const referrerId = (referrerRow as { id: string } | null)?.id;
        if (referrerId && referrerId !== restaurantId) {
          const { error: linkErr } = await supabaseAdmin
            .from("restaurants")
            .update({ referred_by_restaurant_id: referrerId })
            .eq("id", restaurantId)
            .is("referred_by_restaurant_id", null);
          if (linkErr) {
            console.error("[save-subscription-payment-method] referral link failed", linkErr);
          }
        }
      } catch (refErr) {
        console.error("[save-subscription-payment-method] referral lookup threw", refErr);
      }
    }

    // Consent audit log row. Defensible record of the exact disclosure shown
    // at the moment the owner consented to save their card.
    try {
      const { error: logErr } = await supabaseAdmin
        .from("subscription_consent_log")
        .insert({
          restaurant_id: restaurantId,
          user_profile_id: userProfileId,
          consent_type: "card_save",
          disclosure_text: disclosureText,
          ip_address: firstHopIp(req),
          user_agent: req.headers.get("user-agent"),
        });
      if (logErr) {
        console.error("[save-subscription-payment-method] consent log insert failed", logErr);
      }
    } catch (logErr) {
      console.error("[save-subscription-payment-method] consent log threw", logErr);
    }

    return jsonRes({
      ok: true,
      payment_method_attached_at: attachedAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
