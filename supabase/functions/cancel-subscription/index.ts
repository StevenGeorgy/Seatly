// cancel-subscription: sets cancel_at_period_end=true on the restaurant's
// Stripe subscription. Soft cancel — service continues until period_end,
// then auto-unpublishes when Stripe fires subscription.deleted.
//
// Owner can un-cancel any time before period_end via resume-subscription.
//
// Auth: owner role required. `verify_jwt = false` in config.toml; we decode
// the bearer token ourselves.
//
// Payload: { restaurant_id }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { RestaurantIdOnlySchema } from "../_shared/validation/subscription.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";
import { isOwnerOfRestaurant } from "../_shared/auth-restaurants.ts";
import { RECOVERABLE_SUBSCRIPTION_STATUSES } from "../_shared/subscription-status.ts";

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


async function dispatchOwnerNotification(
  restaurantId: string,
  type: "subscription_cancelled",
  context: Record<string, unknown>,
): Promise<void> {
  try {
    const mod = await import("../_shared/owner-notifications.ts").catch(() => null);
    if (
      mod &&
      typeof (mod as { sendOwnerNotification?: unknown }).sendOwnerNotification === "function"
    ) {
      void (mod as {
        sendOwnerNotification: (opts: Record<string, unknown>) => Promise<unknown>;
      })
        .sendOwnerNotification({
          supabase: supabaseAdmin,
          restaurant_id: restaurantId,
          type,
          context,
        })
        .catch((e: unknown) => {
          console.warn(
            "[cancel-subscription] sendOwnerNotification rejected",
            e instanceof Error ? e.message : String(e),
          );
        });
    }
  } catch (notifErr) {
    console.warn(
      "[cancel-subscription] notification import failed",
      notifErr instanceof Error ? notifErr.message : String(notifErr),
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

    const parsed = await parseJsonBody(req, RestaurantIdOnlySchema, { jsonRes });
    if ("response" in parsed) return parsed.response;
    const restaurantId = parsed.data.restaurant_id;

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "cancel-subscription",
        rateLimitIdentifier(req, user.id),
        { limit: 10, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const isOwner = await isOwnerOfRestaurant(supabaseAdmin, user.id, restaurantId);
    if (!isOwner) return jsonRes({ error: "Not authorized for this restaurant" }, 403);

    const { data: rest } = await supabaseAdmin
      .from("restaurants")
      .select("id, name, stripe_customer_id, subscription_status")
      .eq("id", restaurantId)
      .maybeSingle();
    if (!rest) return jsonRes({ error: "Restaurant not found" }, 404);
    const row = rest as {
      id: string;
      name: string | null;
      stripe_customer_id: string | null;
      subscription_status: string | null;
    };
    if (!row.stripe_customer_id) {
      return jsonRes({ error: "Restaurant has no Stripe customer; nothing to cancel." }, 400);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe not configured on server" }, 500);
    const stripe = await getStripeClient(stripeKey);

    // Find the active sub on this customer.
    const subs = await stripe.subscriptions.list({
      customer: row.stripe_customer_id,
      status: "all",
      limit: 5,
    });
    const active = subs.data.find((s) =>
      RECOVERABLE_SUBSCRIPTION_STATUSES.has(s.status ?? ""),
    );
    if (!active) {
      return jsonRes({
        error: "No active subscription found for this restaurant.",
        subscription_status: row.subscription_status,
      }, 404);
    }
    if (active.cancel_at_period_end) {
      // Already cancelled; idempotent return.
      const periodEndIso = active.current_period_end
        ? new Date(active.current_period_end * 1000).toISOString()
        : null;
      return jsonRes({
        ok: true,
        already_scheduled: true,
        period_end_iso: periodEndIso,
      });
    }

    const updated = await stripe.subscriptions.update(active.id, {
      cancel_at_period_end: true,
    });

    const periodEndIso = updated.current_period_end
      ? new Date(updated.current_period_end * 1000).toISOString()
      : null;

    // Mirror to DB so the dashboard pill picks up the new state without
    // waiting for the webhook (which also fires; idempotent dual-write).
    const { error: updateErr } = await supabaseAdmin
      .from("restaurants")
      .update({ subscription_cancel_at_period_end: true })
      .eq("id", restaurantId);
    if (updateErr) {
      console.error("[cancel-subscription] DB mirror failed", updateErr);
    }

    // Fire-and-forget email
    const periodEndLocal = periodEndIso
      ? new Date(periodEndIso).toLocaleDateString("en-CA", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
      : null;
    await dispatchOwnerNotification(restaurantId, "subscription_cancelled", {
      restaurantName: row.name ?? "your restaurant",
      periodEndDate: periodEndLocal,
    });

    return jsonRes({
      ok: true,
      subscription_id: updated.id,
      cancel_at_period_end: true,
      period_end_iso: periodEndIso,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cancel-subscription] unhandled error:", msg);
    return jsonRes({ error: msg }, 500);
  }
});
