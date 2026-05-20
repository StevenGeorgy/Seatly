// recover-restaurant: 2026-05-20 lifecycle. Reverses a soft-delete within
// the 30-day grace window. Sets cancel_at_period_end back to false on the
// Stripe sub, clears the deletion markers, and best-effort re-publishes
// (publish-gate trigger will reject if other conditions aren't met).
//
// Auth: caller must be the restaurant owner. JWT decoded here;
// `verify_jwt = false` in supabase/config.toml.
//
// Payload: { restaurant_id }
//
// Returns: { ok: true, republished: boolean }
//          { error, ... } on failure.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = { restaurant_id?: unknown };

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return jsonRes({ error: "Missing authorization token" }, 401);

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) return jsonRes({ error: "Invalid or expired session" }, 401);

    const payload = (await req.json().catch(() => ({}))) as Payload;
    const restaurantId =
      typeof payload.restaurant_id === "string" && payload.restaurant_id.trim()
        ? payload.restaurant_id.trim()
        : null;
    if (!restaurantId) return jsonRes({ error: "restaurant_id is required" }, 400);

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "recover-restaurant",
        rateLimitIdentifier(req, user.id),
        { limit: 5, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const isOwner = await ownerOfRestaurant(user.id, restaurantId);
    if (!isOwner) return jsonRes({ error: "Not authorized for this restaurant" }, 403);

    const { data: restaurant, error: restErr } = await supabaseAdmin
      .from("restaurants")
      .select(
        "id, name, stripe_customer_id, deleted_at, scheduled_purge_at, " +
          "subscription_status, is_published",
      )
      .eq("id", restaurantId)
      .maybeSingle();
    if (restErr || !restaurant) return jsonRes({ error: "Restaurant not found" }, 404);

    const row = restaurant as {
      id: string;
      name: string | null;
      stripe_customer_id: string | null;
      deleted_at: string | null;
      scheduled_purge_at: string | null;
      subscription_status: string | null;
      is_published: boolean | null;
    };

    if (!row.deleted_at) {
      return jsonRes({
        error: "deletion_not_pending",
        message: "This restaurant is not pending deletion.",
      }, 400);
    }
    const deletedAtMs = Date.parse(row.deleted_at);
    const graceCutoffMs = Date.now() - 30 * 86_400_000;
    if (Number.isNaN(deletedAtMs) || deletedAtMs < graceCutoffMs) {
      return jsonRes({
        error: "deletion_grace_expired",
        message: "The 30-day recovery window has passed.",
      }, 410);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe is not configured on the server" }, 500);

    const { default: Stripe } = await import("npm:stripe@17");
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-11-20.acacia" });

    // If Stripe sub still salvageable, clear cancel_at_period_end. If the sub
    // already auto-cancelled (period rolled over before recovery), tell the
    // owner to re-publish through the wizard.
    if (row.stripe_customer_id) {
      try {
        const subs = await stripe.subscriptions.list({
          customer: row.stripe_customer_id,
          status: "all",
          limit: 5,
        });
        const recoverable = subs.data.find(
          (s) =>
            s.status === "trialing" || s.status === "active" || s.status === "past_due",
        );
        const alreadyCancelled = subs.data.find((s) => s.status === "canceled");

        if (recoverable) {
          await stripe.subscriptions.update(recoverable.id, {
            cancel_at_period_end: false,
          });
        } else if (alreadyCancelled) {
          return jsonRes({
            error: "subscription_already_cancelled",
            message:
              "Your subscription already ended. Re-publish from the dashboard to start a new trial.",
          }, 410);
        }
        // If neither found, fall through — restoring the row is still useful.
      } catch (err) {
        console.warn(
          "[recover-restaurant] Stripe sub update failed (continuing)",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Clear deletion markers.
    const { error: clearErr } = await supabaseAdmin
      .from("restaurants")
      .update({
        deleted_at: null,
        scheduled_purge_at: null,
        paused_reason: null,
      })
      .eq("id", restaurantId);
    if (clearErr) return jsonRes({ error: clearErr.message }, 500);

    // Best-effort re-publish. The publish-gate trigger throws if other
    // conditions (KYC, cover photo, etc.) aren't met — catch and surface as
    // partial success rather than failing the whole recover call.
    let republished = false;
    let republishError: string | null = null;
    try {
      const { error: pubErr, data: pubRows } = await supabaseAdmin
        .from("restaurants")
        .update({ is_published: true })
        .eq("id", restaurantId)
        .eq("is_published", false)
        .select("id");
      if (pubErr) {
        republishError = pubErr.message;
      } else {
        republished = Boolean(pubRows && pubRows.length > 0);
      }
    } catch (e) {
      republishError = e instanceof Error ? e.message : String(e);
    }

    // Fire-and-forget notification.
    try {
      const mod = await import("../_shared/owner-notifications.ts").catch(() => null);
      if (mod && typeof (mod as { sendOwnerNotification?: unknown }).sendOwnerNotification === "function") {
        void (mod as {
          sendOwnerNotification: (opts: Record<string, unknown>) => Promise<unknown>;
        }).sendOwnerNotification({
          supabase: supabaseAdmin,
          restaurant_id: restaurantId,
          type: "restaurant_restored",
          context: {
            restaurant_name: row.name,
            republished,
            sub_state_message: republished
              ? "Your restaurant is back online."
              : "Re-publish from the dashboard when ready.",
          },
        }).catch((e: unknown) => {
          console.warn(
            "[recover-restaurant] sendOwnerNotification rejected",
            e instanceof Error ? e.message : String(e),
          );
        });
      }
    } catch (notifErr) {
      console.warn(
        "[recover-restaurant] notification import/dispatch failed",
        notifErr instanceof Error ? notifErr.message : String(notifErr),
      );
    }

    return jsonRes({
      ok: true,
      republished,
      republish_error: republishError,
      message: republished
        ? "Restaurant restored and re-published."
        : "Restaurant restored. Re-publish from the dashboard when ready.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
