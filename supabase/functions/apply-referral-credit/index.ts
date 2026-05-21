// apply-referral-credit: called by publish-restaurant (or directly) after a
// new restaurant goes live. Creates a Stripe coupon worth $199.99 CAD (one
// free month), applies it to BOTH the new restaurant's subscription AND the
// referrer's subscription, and logs two rows in `referral_credits` for audit.
//
// Auth: JWT-required. Caller must own the restaurant_id being published.
// `verify_jwt = false` in supabase/config.toml because we decode the JWT
// ourselves (consistency with the rest of the Stripe edge fns).
//
// Idempotent — a second call for the same restaurant returns
// `{ ok: true, already_applied: true }` and does NOT issue another coupon.
//
// Payload: { restaurant_id }
//
// Returns:
//   { ok: true, coupon_id, credits_applied: 2 }            — success
//   { ok: true, no_referral: true }                         — no referrer set
//   { ok: true, already_applied: true }                     — idempotent re-run
//   { ok: false, error: 'self_referral_blocked' }
//   { ok: false, error: 'referrer_not_found' }
//   { ok: false, error: 'missing_subscription' }
//   { error: string } on auth/validation failures

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { ApplyReferralCreditSchema } from "../_shared/validation/referral.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REFERRAL_AMOUNT_CENTS = 19999;
const ACTIVE_SUB_STATUSES = new Set(["trialing", "active", "past_due"]);

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

async function logFailedCredits(
  beneficiaryId: string,
  referrerId: string,
  triggeredById: string,
  reason: string,
): Promise<void> {
  try {
    await supabaseAdmin.from("referral_credits").insert([
      {
        beneficiary_restaurant_id: beneficiaryId,
        referrer_restaurant_id: referrerId,
        triggered_by_restaurant_id: triggeredById,
        amount_cents: REFERRAL_AMOUNT_CENTS,
        currency: "cad",
        status: "failed",
        failure_reason: reason,
      },
      {
        beneficiary_restaurant_id: referrerId,
        referrer_restaurant_id: referrerId,
        triggered_by_restaurant_id: triggeredById,
        amount_cents: REFERRAL_AMOUNT_CENTS,
        currency: "cad",
        status: "failed",
        failure_reason: reason,
      },
    ]);
  } catch (err) {
    console.warn(
      "[apply-referral-credit] failed to log failed credits",
      err instanceof Error ? err.message : String(err),
    );
  }
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

    const parsed = await parseJsonBody(req, ApplyReferralCreditSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const restaurantId = parsed.data.restaurant_id;

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "apply-referral-credit",
        rateLimitIdentifier(req, user.id),
        { limit: 10, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const isOwner = await ownerOfRestaurant(user.id, restaurantId);
    if (!isOwner) return jsonRes({ error: "Not authorized for this restaurant" }, 403);

    // (3) Load the newly published restaurant.
    const { data: newRest, error: newRestErr } = await supabaseAdmin
      .from("restaurants")
      .select("id, name, referred_by_restaurant_id, stripe_customer_id, deleted_at")
      .eq("id", restaurantId)
      .maybeSingle();
    if (newRestErr || !newRest) return jsonRes({ error: "Restaurant not found" }, 404);

    const newRow = newRest as {
      id: string;
      name: string | null;
      referred_by_restaurant_id: string | null;
      stripe_customer_id: string | null;
      deleted_at: string | null;
    };

    // (4) No referrer set → nothing to do.
    if (!newRow.referred_by_restaurant_id) {
      return jsonRes({ ok: true, no_referral: true });
    }

    // Self-referral guard (defense in depth — the setter should also block).
    if (newRow.referred_by_restaurant_id === newRow.id) {
      console.warn(
        "[apply-referral-credit] self-referral blocked",
        { restaurant_id: newRow.id },
      );
      return jsonRes({ ok: false, error: "self_referral_blocked" }, 400);
    }

    // (5) Idempotency check — has any credit row already been written for
    // this trigger? Both 'applied' and 'failed' count; 'failed' should be
    // investigated by an operator before re-trying.
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("referral_credits")
      .select("id, status")
      .eq("triggered_by_restaurant_id", newRow.id)
      .limit(1)
      .maybeSingle();
    if (existingErr) {
      console.warn("[apply-referral-credit] idempotency lookup failed", existingErr.message);
      return jsonRes({ error: "Idempotency check failed" }, 500);
    }
    if (existing) {
      return jsonRes({ ok: true, already_applied: true });
    }

    // (6) Load the referrer.
    const { data: refRest, error: refRestErr } = await supabaseAdmin
      .from("restaurants")
      .select("id, name, stripe_customer_id, deleted_at")
      .eq("id", newRow.referred_by_restaurant_id)
      .maybeSingle();
    if (refRestErr || !refRest) {
      return jsonRes({ ok: false, error: "referrer_not_found" }, 404);
    }
    const refRow = refRest as {
      id: string;
      name: string | null;
      stripe_customer_id: string | null;
      deleted_at: string | null;
    };
    if (refRow.deleted_at) {
      return jsonRes({ ok: false, error: "referrer_not_found" }, 404);
    }

    // (7) Both must have stripe_customer_id.
    if (!newRow.stripe_customer_id || !refRow.stripe_customer_id) {
      const reason = !newRow.stripe_customer_id
        ? "subscription_not_found_for_beneficiary"
        : "subscription_not_found_for_referrer";
      await logFailedCredits(newRow.id, refRow.id, newRow.id, reason);
      return jsonRes({ ok: false, error: "missing_subscription", reason }, 400);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    // (8) Look up active subs for BOTH customers.
    const [newSubsResp, refSubsResp] = await Promise.all([
      stripe.subscriptions.list({ customer: newRow.stripe_customer_id, limit: 5 }),
      stripe.subscriptions.list({ customer: refRow.stripe_customer_id, limit: 5 }),
    ]);
    const newSub = newSubsResp.data.find((s) => ACTIVE_SUB_STATUSES.has(s.status));
    const referrerSub = refSubsResp.data.find((s) => ACTIVE_SUB_STATUSES.has(s.status));

    if (!newSub || !referrerSub) {
      const reason = !newSub
        ? "subscription_not_found_for_beneficiary"
        : "subscription_not_found_for_referrer";
      await logFailedCredits(newRow.id, refRow.id, newRow.id, reason);
      return jsonRes({ ok: false, error: "missing_subscription", reason }, 400);
    }

    // (9) Create the Stripe coupon.
    const referrerName = refRow.name ?? "Referrer";
    const newRestName = newRow.name ?? "New restaurant";
    let coupon;
    try {
      coupon = await stripe.coupons.create({
        amount_off: REFERRAL_AMOUNT_CENTS,
        currency: "cad",
        duration: "once",
        max_redemptions: 2,
        name: `Referral — ${referrerName} ↔ ${newRestName}`,
        metadata: {
          referrer_restaurant_id: refRow.id,
          new_restaurant_id: newRow.id,
          kind: "cenaiva_referral",
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[apply-referral-credit] coupon create failed", msg);
      await logFailedCredits(newRow.id, refRow.id, newRow.id, `coupon_create_failed: ${msg}`);
      return jsonRes({ ok: false, error: "coupon_create_failed", detail: msg }, 500);
    }

    // (10) Apply to both subs. If either update fails, mark both rows
    // 'failed' with the reason. We do NOT roll back the coupon — it has
    // max_redemptions=2 and the operator can clean it up manually.
    try {
      await stripe.subscriptions.update(newSub.id, {
        discounts: [{ coupon: coupon.id }],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[apply-referral-credit] beneficiary sub update failed", msg);
      await logFailedCredits(
        newRow.id,
        refRow.id,
        newRow.id,
        `beneficiary_subscription_update_failed: ${msg}`,
      );
      return jsonRes({ ok: false, error: "subscription_update_failed", detail: msg }, 500);
    }

    try {
      await stripe.subscriptions.update(referrerSub.id, {
        discounts: [{ coupon: coupon.id }],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[apply-referral-credit] referrer sub update failed", msg);
      await logFailedCredits(
        newRow.id,
        refRow.id,
        newRow.id,
        `referrer_subscription_update_failed: ${msg}`,
      );
      return jsonRes({ ok: false, error: "subscription_update_failed", detail: msg }, 500);
    }

    // (11) Insert the 2 audit rows.
    const nowIso = new Date().toISOString();
    const { error: insertErr } = await supabaseAdmin.from("referral_credits").insert([
      {
        beneficiary_restaurant_id: newRow.id,
        referrer_restaurant_id: refRow.id,
        triggered_by_restaurant_id: newRow.id,
        amount_cents: REFERRAL_AMOUNT_CENTS,
        currency: "cad",
        stripe_coupon_id: coupon.id,
        status: "applied",
        applied_at: nowIso,
      },
      {
        beneficiary_restaurant_id: refRow.id,
        referrer_restaurant_id: refRow.id,
        triggered_by_restaurant_id: newRow.id,
        amount_cents: REFERRAL_AMOUNT_CENTS,
        currency: "cad",
        stripe_coupon_id: coupon.id,
        status: "applied",
        applied_at: nowIso,
      },
    ]);
    if (insertErr) {
      // The coupon is already applied to both subs — Stripe is the source of
      // truth for the credit. Log + return success with a warning so the
      // caller doesn't retry and double-apply.
      console.warn(
        "[apply-referral-credit] audit insert failed (coupon already applied)",
        insertErr.message,
      );
      return jsonRes({
        ok: true,
        coupon_id: coupon.id,
        credits_applied: 2,
        audit_warning: insertErr.message,
      });
    }

    // (12) Done.
    return jsonRes({
      ok: true,
      coupon_id: coupon.id,
      credits_applied: 2,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
