// publish-restaurant: 2026-05-20 deferred-trial flow. Atomically (a) creates
// the Stripe subscription with 90-day trial, (b) flips is_published=true on
// the restaurants row. The trial clock is anchored to publish day, NOT to
// card capture.
//
// Auth: caller must be the restaurant owner. We decode the JWT ourselves;
// `verify_jwt = false` in supabase/config.toml.
//
// Payload: { restaurant_id, disclosure_text }
//
// The disclosure_text is the publish-confirmation modal copy the user saw
// before clicking "Yes, publish". Logged to subscription_consent_log for
// audit defensibility (CRA-compliant).
//
// Re-publish short-circuit: if the restaurant already has an active or
// trialing subscription (grandfathered restaurants pre-2026-05-20 wizard),
// skip the Stripe sub creation and just flip the publish flag.
//
// Returns: { ok: true, subscription_id, subscription_status, trial_ends_at }
//          { error, stripe_code?, ... } on failure.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { PublishRestaurantSchema } from "../_shared/validation/restaurant-ops.ts";

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

async function ownerOfRestaurant(
  authUserId: string,
  restaurantId: string,
): Promise<{ ok: boolean; userProfileId: string | null }> {
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (!profile) return { ok: false, userProfileId: null };
  const userProfileId = (profile as { id: string }).id;
  const { data: role } = await supabaseAdmin
    .from("user_restaurant_roles")
    .select("role")
    .eq("user_id", userProfileId)
    .eq("restaurant_id", restaurantId)
    .eq("role", "owner")
    .maybeSingle();
  return { ok: Boolean(role), userProfileId };
}

function firstHopIp(req: Request): string | null {
  const xff = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for");
  if (!xff) return null;
  const first = xff.split(",")[0]?.trim();
  return first || null;
}

const REFERRAL_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function randomReferralSuffix(n = 3): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += REFERRAL_ALPHA[Math.floor(Math.random() * REFERRAL_ALPHA.length)];
  }
  return out;
}
function namePrefix(name: string | null): string {
  const base = (name ?? "REST").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4);
  return base.padEnd(4, "X").slice(0, 4);
}
async function generateUniqueReferralCode(name: string | null): Promise<string | null> {
  const prefix = namePrefix(name);
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = `${prefix}${randomReferralSuffix(3)}`;
    const { data } = await supabaseAdmin
      .from("restaurants")
      .select("id")
      .eq("referral_code", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  return null; // Caller should leave referral_code NULL and try again later.
}

function ymd(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

const ACTIVE_SUB_STATUSES = new Set(["trialing", "active", "past_due", "incomplete"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return jsonRes({ error: "Missing authorization token" }, 401);

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) return jsonRes({ error: "Invalid or expired session" }, 401);

    const parsed = await parseJsonBody(req, PublishRestaurantSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const restaurantId = parsed.data.restaurant_id;
    const disclosureText = parsed.data.disclosure_text;

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "publish-restaurant",
        rateLimitIdentifier(req, user.id),
        { limit: 5, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const { ok: isOwner, userProfileId } = await ownerOfRestaurant(user.id, restaurantId);
    if (!isOwner) return jsonRes({ error: "Not authorized for this restaurant" }, 403);

    const { data: restaurant, error: restErr } = await supabaseAdmin
      .from("restaurants")
      .select(
        "id, name, stripe_customer_id, stripe_charges_enabled, cover_photo_url, " +
          "payment_method_attached_at, subscription_status, trial_ends_at, " +
          "is_published, deleted_at, referred_by_restaurant_id, referral_code",
      )
      .eq("id", restaurantId)
      .maybeSingle();
    if (restErr || !restaurant) return jsonRes({ error: "Restaurant not found" }, 404);

    const row = restaurant as {
      id: string;
      name: string | null;
      stripe_customer_id: string | null;
      stripe_charges_enabled: boolean | null;
      cover_photo_url: string | null;
      payment_method_attached_at: string | null;
      subscription_status: string | null;
      trial_ends_at: string | null;
      is_published: boolean | null;
      deleted_at: string | null;
      referred_by_restaurant_id: string | null;
      referral_code: string | null;
    };

    // Idempotent success — already published.
    if (row.is_published === true) {
      return jsonRes({
        ok: true,
        already_published: true,
        subscription_status: row.subscription_status,
        trial_ends_at: row.trial_ends_at,
      });
    }

    // Server-side publish-gate (mirrors the trigger so we return friendly errors).
    if (row.deleted_at !== null) {
      return jsonRes({ error: "publish_gate_restaurant_deleted" }, 400);
    }
    if (row.stripe_charges_enabled !== true) {
      return jsonRes({ error: "publish_gate_kyc_not_verified" }, 400);
    }
    if (!row.cover_photo_url) {
      return jsonRes({ error: "publish_gate_no_cover_photo" }, 400);
    }
    const subAlreadyActive =
      row.subscription_status === "trialing" || row.subscription_status === "active";
    if (!subAlreadyActive && !row.payment_method_attached_at) {
      return jsonRes({ error: "publish_gate_no_payment_method" }, 400);
    }
    if (!row.stripe_customer_id) {
      return jsonRes({ error: "publish_gate_no_stripe_customer" }, 400);
    }
    const customerId = row.stripe_customer_id;

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    let subscriptionId: string | null = null;
    let subscriptionStatus: string = row.subscription_status ?? "trialing";
    let trialEndsAt: string | null = row.trial_ends_at;

    if (subAlreadyActive) {
      // Grandfathered re-publish: subscription already exists. Look up its id
      // for the audit log; do NOT create a second one.
      try {
        const subs = await stripe.subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 5,
        });
        const active = subs.data.find(
          (s) => s.status === "trialing" || s.status === "active",
        );
        if (active) {
          subscriptionId = active.id;
          subscriptionStatus = active.status;
          trialEndsAt = typeof active.trial_end === "number"
            ? new Date(active.trial_end * 1000).toISOString()
            : trialEndsAt;
        }
      } catch (err) {
        console.warn(
          "[publish-restaurant] sub lookup failed (non-fatal)",
          err instanceof Error ? err.message : String(err),
        );
      }
    } else {
      // Fresh publish — validate price, then create the subscription.
      const priceId = Deno.env.get("STRIPE_SUBSCRIPTION_PRICE_ID");
      if (!priceId) {
        return jsonRes({ error: "STRIPE_SUBSCRIPTION_PRICE_ID is not configured" }, 500);
      }
      try {
        const price = await stripe.prices.retrieve(priceId);
        if (!price.active) {
          return jsonRes({
            error: `Price ${priceId} is archived/inactive`,
            attempted_price_id: priceId,
          }, 500);
        }
        if (!price.recurring) {
          return jsonRes({
            error: `Price ${priceId} is not recurring`,
            attempted_price_id: priceId,
            price_type: price.type,
          }, 500);
        }
        if (price.currency !== "cad") {
          return jsonRes({
            error: `Price ${priceId} currency is ${price.currency}, expected cad`,
            attempted_price_id: priceId,
          }, 500);
        }
      } catch (err) {
        const e = err as { message?: string; code?: string; type?: string };
        return jsonRes({
          error: `Price retrieve failed: ${e.message ?? String(err)}`,
          stripe_code: e.code,
          stripe_type: e.type,
          attempted_price_id: priceId,
        }, 500);
      }

      let subscription;
      try {
        subscription = await stripe.subscriptions.create({
          customer: customerId,
          items: [{ price: priceId }],
          trial_period_days: 90,
          payment_behavior: "default_incomplete",
          expand: ["latest_invoice.payment_intent"],
          metadata: { restaurant_id: row.id },
        }, {
          idempotencyKey: `publish_${restaurantId}_${ymd()}`,
        });
      } catch (err) {
        const e = err as {
          message?: string;
          code?: string;
          type?: string;
          param?: string;
        };
        return jsonRes({
          error: e.message ?? String(err),
          stripe_code: e.code,
          stripe_type: e.type,
          stripe_param: e.param,
          attempted_price_id: priceId,
          attempted_customer_id: customerId,
        }, 500);
      }

      subscriptionId = subscription.id;
      subscriptionStatus = subscription.status;
      trialEndsAt = typeof subscription.trial_end === "number"
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null;
    }

    // Referral program disabled. Keep existing referral_code values
    // untouched (we may re-enable later and historic codes need to keep
    // matching), but do NOT auto-generate one on publish.
    const referralCode = row.referral_code;

    // Atomic UPDATE — guard on `is_published = false` so a concurrent publish
    // can't double-flip. Clearing payment_method_attached_at keeps the
    // stale-card cleanup cron from ever touching a published restaurant.
    const updatePayload: Record<string, unknown> = {
      subscription_status: subscriptionStatus,
      trial_ends_at: trialEndsAt,
      is_published: true,
      payment_method_attached_at: null,
    };
    if (referralCode && !row.referral_code) updatePayload.referral_code = referralCode;

    const { data: updatedRows, error: updateErr } = await supabaseAdmin
      .from("restaurants")
      .update(updatePayload)
      .eq("id", restaurantId)
      .eq("is_published", false)
      .select("id");

    if (updateErr) {
      console.error("[publish-restaurant] atomic UPDATE failed", {
        error: updateErr,
        subscription_id: subscriptionId,
        restaurant_id: restaurantId,
      });
      return jsonRes({
        error: updateErr.message,
        subscription_id: subscriptionId,
        attempted_customer_id: customerId,
      }, 500);
    }

    if (!updatedRows || updatedRows.length === 0) {
      // Race: someone else won. Treat as success; their UPDATE applied.
      console.log("[publish-restaurant] UPDATE returned 0 rows — likely concurrent publish", {
        restaurant_id: restaurantId,
        subscription_id: subscriptionId,
      });
      return jsonRes({
        ok: true,
        already_published: true,
        subscription_id: subscriptionId,
        subscription_status: subscriptionStatus,
        trial_ends_at: trialEndsAt,
      });
    }

    // Consent audit log row.
    try {
      const { error: logErr } = await supabaseAdmin
        .from("subscription_consent_log")
        .insert({
          restaurant_id: restaurantId,
          user_profile_id: userProfileId,
          consent_type: "publish_trial_start",
          disclosure_text: disclosureText,
          ip_address: firstHopIp(req),
          user_agent: req.headers.get("user-agent"),
        });
      if (logErr) {
        console.error("[publish-restaurant] consent log insert failed", logErr);
      }
    } catch (logErr) {
      console.error("[publish-restaurant] consent log threw", logErr);
    }

    // Referral credit dispatch disabled. Historic referred_by_restaurant_id
    // values stay in the DB and resume earning credits when the program is
    // re-enabled.

    // Fire-and-forget: owner notification. Helper may not exist yet; wrap.
    try {
      const mod = await import("../_shared/owner-notifications.ts").catch(() => null);
      if (mod && typeof (mod as { sendOwnerNotification?: unknown }).sendOwnerNotification === "function") {
        void (mod as {
          sendOwnerNotification: (opts: Record<string, unknown>) => Promise<unknown>;
        }).sendOwnerNotification({
          supabase: supabaseAdmin,
          restaurant_id: restaurantId,
          type: "restaurant_live",
          context: { trial_ends_at: trialEndsAt, restaurant_name: row.name },
        }).catch((e: unknown) => {
          console.warn(
            "[publish-restaurant] sendOwnerNotification rejected",
            e instanceof Error ? e.message : String(e),
          );
        });
      }
    } catch (notifErr) {
      console.warn(
        "[publish-restaurant] notification import/dispatch failed",
        notifErr instanceof Error ? notifErr.message : String(notifErr),
      );
    }

    return jsonRes({
      ok: true,
      subscription_id: subscriptionId,
      subscription_status: subscriptionStatus,
      trial_ends_at: trialEndsAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
