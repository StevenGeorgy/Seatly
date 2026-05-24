// create-stripe-account: Phase D (Stripe wire-up). Creates a Stripe Connect
// Custom account tied to a restaurant. Idempotent — if `restaurants.stripe_account_id`
// is already set, returns the existing account state without creating a new one.
//
// Auth: requires a valid Supabase user JWT. The function verifies the caller
// owns the restaurant via `user_restaurant_roles.role = 'owner'`.
// `verify_jwt = false` in supabase/config.toml because we decode the JWT
// ourselves (ES256 sessions on the gateway would 401 before our handler runs).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { RestaurantIdOnlySchema } from "../_shared/validation/subscription.ts";
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

    const parsed = await parseJsonBody(req, RestaurantIdOnlySchema, { jsonRes });
    if ("response" in parsed) return parsed.response;
    const restaurantId = parsed.data.restaurant_id;

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "create-stripe-account",
        rateLimitIdentifier(req, user.id),
        { limit: 20, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const isOwner = await isOwnerOfRestaurant(supabaseAdmin, user.id, restaurantId);
    if (!isOwner) return jsonRes({ error: "Not authorized for this restaurant" }, 403);

    const { data: restaurant, error: restErr } = await supabaseAdmin
      .from("restaurants")
      .select("id, name, email, stripe_account_id")
      .eq("id", restaurantId)
      .maybeSingle();
    if (restErr || !restaurant) return jsonRes({ error: "Restaurant not found" }, 404);

    const row = restaurant as {
      id: string;
      name: string | null;
      email: string | null;
      stripe_account_id: string | null;
    };

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const stripe = await getStripeClient(stripeKey);

    // Idempotent path: account already exists — refresh state from Stripe
    // AND mirror it back to the DB. This is the canonical sync path: any time
    // the wizard polls (e.g. after Stripe-hosted KYC return), DB columns get
    // brought into agreement with Stripe's truth. This makes the function
    // self-healing — even if the stripe-webhook `account.updated` event is
    // delayed, dropped, or fails signature verification, the next page load
    // converges state. Production-critical: without this, payouts_enabled
    // can stay stale forever and `restaurants_publish_gate` would block
    // ops the user has already completed.
    if (row.stripe_account_id) {
      try {
        const account = await stripe.accounts.retrieve(row.stripe_account_id);
        const chargesEnabled = Boolean(account.charges_enabled);
        const payoutsEnabled = Boolean(account.payouts_enabled);
        const detailsSubmitted = Boolean(account.details_submitted);
        // Derive `requirements_due` — is Stripe waiting on the OWNER for
        // something actionable (e.g. proof_of_liveness selfie not done)? We
        // surface this so the Step 8 wizard can show "Action required" + a
        // button instead of misleading "Banking verification in progress"
        // copy when payouts are paused on a known-owner-actionable reason.
        // `eventually_due` is info Stripe might ask for later — don't
        // surface yet. `disabled_reason` starting with `pending_verification`
        // means Stripe is processing on its end (not actionable).
        type AccountRequirements = {
          currently_due?: string[] | null;
          past_due?: string[] | null;
          pending_verification?: string[] | null;
        };
        const reqs = (account as { requirements?: AccountRequirements }).requirements ?? {};
        // Source of truth: currently_due / past_due minus pending_verification.
        // We ignore `disabled_reason` — its values like
        // "requirements.pending_verification" are informational and tricky to
        // parse correctly. currently_due + pending_verification arrays are
        // unambiguous.
        const pendingVerification = reqs.pending_verification ?? [];
        const pendingSet = new Set(pendingVerification);
        const actionableCurrentlyDue = (reqs.currently_due ?? []).filter(
          (f) => !pendingSet.has(f),
        );
        const actionablePastDue = (reqs.past_due ?? []).filter((f) => !pendingSet.has(f));
        const requirementsDue =
          actionableCurrentlyDue.length > 0 || actionablePastDue.length > 0;
        const requirementsProcessing =
          pendingVerification.length > 0 && !requirementsDue;
        // Mirror Stripe state into DB on every poll. Best-effort: we still
        // return success even if the UPDATE errors (don't fail the user-
        // visible flow on a DB hiccup; the next poll will retry).
        //
        // IMPORTANT: we deliberately do NOT sync `stripe_requirements_due` /
        // `stripe_requirements_processing` here. Those flicker during
        // Stripe's post-submit propagation lag (5-30s window where
        // `currently_due` stays briefly populated before clearing). The
        // `account.updated` webhook is the source of truth for those —
        // it only fires when Stripe ACTUALLY moves the account state, so
        // the DB columns stay stable and the wizard doesn't render a
        // misleading "Action required" yellow flash right after submit.
        // See Stripe docs on Handle verification updates.
        const { error: syncErr } = await supabaseAdmin
          .from("restaurants")
          .update({
            stripe_charges_enabled: chargesEnabled,
            stripe_payouts_enabled: payoutsEnabled,
            stripe_details_submitted: detailsSubmitted,
            stripe_onboarding_complete: chargesEnabled && payoutsEnabled && detailsSubmitted,
          })
          .eq("id", row.id);
        if (syncErr) {
          console.warn("[create-stripe-account] DB sync failed", syncErr.message);
        }
        return jsonRes({
          account_id: account.id,
          charges_enabled: chargesEnabled,
          payouts_enabled: payoutsEnabled,
          details_submitted: detailsSubmitted,
          requirements_due: requirementsDue,
          requirements_processing: requirementsProcessing,
        });
      } catch (err) {
        // If Stripe says the account is gone (deauthorized externally),
        // clear the column so the next call recreates it.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("no such account")) {
          await supabaseAdmin
            .from("restaurants")
            .update({
              stripe_account_id: null,
              stripe_charges_enabled: false,
              stripe_payouts_enabled: false,
              stripe_details_submitted: false,
              stripe_onboarding_complete: false,
            })
            .eq("id", row.id);
        } else {
          return jsonRes({ error: msg }, 500);
        }
      }
    }

    // Use type: "express" — Custom accounts require Stripe platform approval
    // most new platforms don't have. Express works out of the box and is fully
    // compatible with the ConnectAccountOnboarding embedded component (the
    // owner stays inside Cenaiva for KYC).
    //
    // Capabilities: ONLY `transfers`. Cenaiva's model is destination-charges:
    // diners pay Cenaiva's platform account, Stripe transfers the restaurant's
    // 94.5% share. The restaurant never directly charges a card. Requesting
    // `card_payments` here would create a capability mismatch with the
    // platform's Onboarding options (Payments isn't enabled for Canada at the
    // platform level) and causes the Embedded Connect iframe to fail with
    // "There was an error during authentication." If pay-the-table is ever
    // added later, enable Payments at platform level AND re-add card_payments
    // here in lock-step.
    const account = await stripe.accounts.create({
      type: "express",
      country: "CA",
      email: row.email ?? undefined,
      capabilities: {
        transfers: { requested: true },
      },
      business_profile: {
        name: row.name ?? undefined,
        mcc: "5812",
      },
      metadata: { restaurant_id: row.id, platform: "cenaiva" },
    });

    const { error: updateErr } = await supabaseAdmin
      .from("restaurants")
      .update({ stripe_account_id: account.id })
      .eq("id", row.id);
    if (updateErr) return jsonRes({ error: updateErr.message }, 500);

    return jsonRes({
      account_id: account.id,
      charges_enabled: Boolean(account.charges_enabled),
      payouts_enabled: Boolean(account.payouts_enabled),
      details_submitted: Boolean(account.details_submitted),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
