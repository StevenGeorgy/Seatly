// delete-drafts: service-role bulk delete of restaurant DRAFTS (never-
// published restaurants) owned by the calling user. Required because
// `subscription_consent_log.restaurant_id` is FK `ON DELETE RESTRICT`
// (per CLAUDE.md — audit/consent tables outlive the parent for CRA
// retention), so a direct `.delete()` from the browser client fails on
// any draft that has saved a card during onboarding (the card_save row
// blocks the delete).
//
// This fn runs as service role and pre-cleans consent_log rows for the
// drafts before deleting the restaurant rows. Important: this is ONLY
// safe for drafts (is_published = false). For published restaurants the
// retention guarantee still applies — we never touch their consent log.
//
// Auth: caller must own every restaurant_id in the list (verified via
// user_restaurant_roles). Caller's JWT is decoded explicitly;
// verify_jwt = false in config.toml so the gateway doesn't reject
// ES256 tokens before our code runs.
//
// Payload: { restaurant_ids: string[] }  (max 50 per call)
// Returns: { ok: true, deleted_count: number, blocked_ids?: string[] }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "zod";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { Uuid } from "../_shared/validation/base.ts";

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

const BodySchema = z.object({
  // Use the shared Uuid (permissive — accepts any UUID version, not just v4).
  // Zod 4's z.string().uuid() rejects non-v4 like our seed restaurant ids.
  restaurant_ids: z.array(Uuid).min(1).max(50),
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return jsonRes({ error: "Missing authorization token" }, 401);

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) return jsonRes({ error: "Invalid or expired session" }, 401);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonRes({ error: "Invalid JSON body" }, 400);
    }
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return jsonRes({ error: "Invalid payload", issues: parsed.error.issues }, 400);
    }
    const restaurantIds = Array.from(new Set(parsed.data.restaurant_ids));

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "delete-drafts",
        rateLimitIdentifier(req, user.id),
        { limit: 5, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    // Resolve user_profile_id from auth.users.
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (profileErr || !profile) {
      return jsonRes({ error: "User profile not found" }, 404);
    }
    const userProfileId = (profile as { id: string }).id;

    // Filter to (a) restaurants owned by the user AND (b) not published.
    // The filter is the trust boundary — we only consent-log-clean rows
    // for drafts the user actually owns.
    const { data: ownerRows, error: ownerErr } = await supabaseAdmin
      .from("user_restaurant_roles")
      .select("restaurant_id, restaurants!inner(id, is_published)")
      .eq("user_id", userProfileId)
      .eq("role", "owner")
      .in("restaurant_id", restaurantIds);
    if (ownerErr) {
      return jsonRes({ error: "Couldn't verify ownership" }, 500);
    }
    type OwnerRow = {
      restaurant_id: string;
      restaurants: { id: string; is_published: boolean | null } | null;
    };
    const eligibleIds = ((ownerRows ?? []) as OwnerRow[])
      .filter((r) => r.restaurants?.is_published === false)
      .map((r) => r.restaurant_id);

    if (eligibleIds.length === 0) {
      return jsonRes({ ok: true, deleted_count: 0, blocked_ids: restaurantIds });
    }

    // Defensive: refuse to delete drafts that somehow have payments rows.
    // Drafts can't be booked publicly (publish gate blocks it), so they
    // should never have real Stripe charges. But if a row exists — even
    // accidentally — DO NOT auto-delete it. Surface a clear error and
    // let the user contact support. Real money rows must survive.
    {
      const { count: paymentCount, error: paymentCheckErr } = await supabaseAdmin
        .from("payments")
        .select("id", { count: "exact", head: true })
        .in("restaurant_id", eligibleIds);
      if (paymentCheckErr) {
        console.error("[delete-drafts] payments check failed", paymentCheckErr);
        return jsonRes({ error: "Couldn't verify draft state. Try again." }, 500);
      }
      if ((paymentCount ?? 0) > 0) {
        return jsonRes({
          error: "One or more drafts have payment records and can't be auto-deleted. Contact help@cenaiva.com so we can review.",
          blocked_reason: "payments_present",
        }, 409);
      }
    }

    // Pre-clean every blocking FK so the DELETE on restaurants can proceed.
    // CRITICAL: only drafts. Never-published restaurants have no audit
    // value (the partner agreement was never accepted, no live customer
    // data accrued). For published restaurants the FK RESTRICT remains
    // in force and audit rows outlive the parent per CRA retention.
    //
    // Tables touched (all scoped to eligibleIds = is_published=false):
    //   - subscription_consent_log   (RESTRICT — card_save from onboarding)
    //   - restaurant_notification_log (RESTRICT — onboarding/trial alerts)
    //   - referral_credits           (RESTRICT × 3 FKs — none live for drafts)
    //   - notifications              (NO ACTION — onboarding nudges)
    //   - ai_conversations           (NO ACTION — owner's onboarding AI chat)
    //   - ai_menu_suggestions        (NO ACTION — AI-generated menu drafts)
    //   - accountant_exports         (NO ACTION — empty for drafts but safe)
    //
    // Deliberately NOT touched: payments. Real money rows must survive even
    // if the draft path somehow created one (shouldn't, but defensive).
    type PreCleanStep = {
      table: string;
      column: string;
    };
    const preCleanSteps: PreCleanStep[] = [
      { table: "subscription_consent_log", column: "restaurant_id" },
      { table: "restaurant_notification_log", column: "restaurant_id" },
      { table: "referral_credits", column: "triggered_by_restaurant_id" },
      { table: "referral_credits", column: "beneficiary_restaurant_id" },
      { table: "referral_credits", column: "referrer_restaurant_id" },
      { table: "notifications", column: "restaurant_id" },
      { table: "ai_conversations", column: "restaurant_id" },
      { table: "ai_menu_suggestions", column: "restaurant_id" },
      { table: "accountant_exports", column: "restaurant_id" },
    ];
    for (const step of preCleanSteps) {
      const { error: stepErr } = await supabaseAdmin
        .from(step.table)
        .delete()
        .in(step.column, eligibleIds);
      if (stepErr) {
        // Treat "table doesn't exist" / "column doesn't exist" as non-fatal —
        // schemas drift across environments. Log and continue. Anything
        // worse (e.g. permission denied) is fatal.
        const msg = stepErr.message ?? "";
        const code = (stepErr as { code?: string }).code ?? "";
        const isMissingRelation = code === "42P01" || /does not exist/i.test(msg);
        if (isMissingRelation) {
          console.warn(`[delete-drafts] skipping ${step.table}.${step.column}: ${msg}`);
          continue;
        }
        console.error(`[delete-drafts] pre-clean failed for ${step.table}.${step.column}`, stepErr);
        return jsonRes({
          error: "Couldn't release dependent records before deleting drafts.",
        }, 500);
      }
    }

    // FK chain cleanup — handles indirect descendants whose FKs are
    // RESTRICT / NO ACTION. The natural cascade from restaurants would
    // otherwise hit:
    //   - order_items.menu_item_id (RESTRICT) when menu_items cascade-deletes
    //   - reservations.preorder_order_id (NO ACTION) when orders cascade-deletes
    //
    // We don't want to touch payments here — that's a separate rule (real
    // money). The payments-present guard above already refused the request
    // if any payments rows exist for these drafts.

    // 1. Collect menu_item IDs scoped to the drafts, then delete the
    //    order_items rows pointing at them. We must do this BEFORE
    //    DELETE FROM restaurants because the cascade -> menu_items would
    //    otherwise hit the RESTRICT FK.
    const { data: menuItemRows, error: menuItemErr } = await supabaseAdmin
      .from("menu_items")
      .select("id")
      .in("restaurant_id", eligibleIds);
    if (menuItemErr) {
      console.error("[delete-drafts] menu_items lookup failed", menuItemErr);
      return jsonRes({ error: "Couldn't enumerate draft menu items." }, 500);
    }
    const menuItemIds = (menuItemRows ?? []).map((r) => (r as { id: string }).id);
    if (menuItemIds.length > 0) {
      const { error: orderItemsErr } = await supabaseAdmin
        .from("order_items")
        .delete()
        .in("menu_item_id", menuItemIds);
      if (orderItemsErr) {
        console.error("[delete-drafts] order_items delete failed", orderItemsErr);
        return jsonRes({ error: "Couldn't release order_items pointing at draft menu items." }, 500);
      }
    }

    // 2. Null-out reservations.preorder_order_id so the orders cascade
    //    won't be blocked by NO ACTION on the back-reference. The
    //    reservations rows themselves will cascade-delete with the
    //    restaurant in step 4.
    const { error: preorderNullErr } = await supabaseAdmin
      .from("reservations")
      .update({ preorder_order_id: null })
      .in("restaurant_id", eligibleIds)
      .not("preorder_order_id", "is", null);
    if (preorderNullErr) {
      // Non-fatal — if the column doesn't exist on a non-prod schema,
      // continue. Cascade will still fail noisily below if there's a
      // real blocker.
      const msg = preorderNullErr.message ?? "";
      if (!/does not exist/i.test(msg)) {
        console.error("[delete-drafts] preorder_order_id null failed", preorderNullErr);
        return jsonRes({ error: "Couldn't unlink draft preorder references." }, 500);
      }
      console.warn("[delete-drafts] preorder_order_id null skipped:", msg);
    }

    // Now delete the restaurants. Belt-and-suspenders: re-assert
    // is_published = false at delete time so a race in publish-restaurant
    // can't cause us to silently delete a freshly-published row.
    const { data: deletedRows, error: deleteErr } = await supabaseAdmin
      .from("restaurants")
      .delete()
      .in("id", eligibleIds)
      .eq("is_published", false)
      .select("id");
    if (deleteErr) {
      console.error("[delete-drafts] restaurants delete failed", deleteErr);
      // Surface the FK constraint name in a server-side log entry so we
      // can keep extending the pre-clean list without a guessing game.
      // The user still sees only the friendly fallback (client-side
      // sanitizer ensures raw text doesn't leak).
      return jsonRes({
        error: "Couldn't delete drafts.",
        technical_code: (deleteErr as { code?: string }).code ?? null,
        technical_constraint: (deleteErr as { details?: string }).details ?? null,
      }, 500);
    }

    const deletedCount = deletedRows?.length ?? 0;
    const deletedIdSet = new Set((deletedRows ?? []).map((r) => (r as { id: string }).id));
    const blockedIds = restaurantIds.filter((id) => !deletedIdSet.has(id));

    return jsonRes({
      ok: true,
      deleted_count: deletedCount,
      blocked_ids: blockedIds.length > 0 ? blockedIds : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[delete-drafts] threw", msg);
    return jsonRes({ error: msg }, 500);
  }
});
