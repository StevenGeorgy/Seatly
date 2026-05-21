// resume-subscription: state-aware "undo" for cancel-pending OR paused state.
//   - If subscription has cancel_at_period_end=true → unset it
//   - If subscription has pause_collection set → clear it
//   - Otherwise → no-op (already active)
//
// We do NOT auto-republish from paused state — that gates back through the
// publish-restaurant flow (which re-checks KYC + card on file). For
// cancel-pending the restaurant never unpublished, so resume is purely a
// billing state change.

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


async function dispatchOwnerNotification(
  restaurantId: string,
  type: "subscription_resumed",
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
          console.warn("[resume-subscription] notification rejected", e);
        });
    }
  } catch (notifErr) {
    console.warn("[resume-subscription] notification import failed", notifErr);
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
        "resume-subscription",
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
      .select("id, name, stripe_customer_id, subscription_paused_at, subscription_cancel_at_period_end")
      .eq("id", restaurantId)
      .maybeSingle();
    if (!rest) return jsonRes({ error: "Restaurant not found" }, 404);
    const row = rest as {
      id: string;
      name: string | null;
      stripe_customer_id: string | null;
      subscription_paused_at: string | null;
      subscription_cancel_at_period_end: boolean | null;
    };
    if (!row.stripe_customer_id) {
      return jsonRes({ error: "Restaurant has no Stripe customer." }, 400);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe not configured on server" }, 500);
    const stripe = await getStripeClient(stripeKey);

    const subs = await stripe.subscriptions.list({
      customer: row.stripe_customer_id,
      status: "all",
      limit: 5,
    });
    const sub = subs.data.find((s) =>
      ["trialing", "active", "past_due"].includes(s.status ?? ""),
    );
    if (!sub) {
      return jsonRes({
        error: "No subscription found to resume. If your plan is fully cancelled, use Restart instead.",
      }, 404);
    }

    let action: "uncancel" | "unpause" | "noop" = "noop";

    // Priority: unpause first (active "no service" state), then uncancel
    // (still-active-but-scheduled state). If both happen to be set we
    // resolve both in one call.
    const updateParams: Record<string, unknown> = {};
    if (sub.pause_collection) {
      // Stripe accepts pause_collection: '' to clear it (per SDK docs).
      // deno-lint-ignore no-explicit-any
      (updateParams as any).pause_collection = "";
      action = "unpause";
    }
    if (sub.cancel_at_period_end) {
      updateParams.cancel_at_period_end = false;
      action = action === "unpause" ? action : "uncancel";
    }

    if (Object.keys(updateParams).length === 0) {
      return jsonRes({
        ok: true,
        already_active: true,
        action: "noop",
      });
    }

    await stripe.subscriptions.update(sub.id, updateParams);

    // Mirror state to DB. Note: we don't re-publish the restaurant on
    // unpause — that's a separate user action (or auto via publish-restaurant
    // gate which re-checks KYC + payment method).
    const dbPatch: Record<string, unknown> = {};
    if (action === "unpause" || sub.pause_collection) {
      dbPatch.subscription_paused_at = null;
    }
    if (action === "uncancel" || sub.cancel_at_period_end) {
      dbPatch.subscription_cancel_at_period_end = false;
    }
    if (Object.keys(dbPatch).length > 0) {
      const { error: updateErr } = await supabaseAdmin
        .from("restaurants")
        .update(dbPatch)
        .eq("id", restaurantId);
      if (updateErr) {
        console.error("[resume-subscription] DB mirror failed", updateErr);
      }
    }

    await dispatchOwnerNotification(restaurantId, "subscription_resumed", {
      restaurantName: row.name ?? "your restaurant",
    });

    return jsonRes({
      ok: true,
      action,
      subscription_id: sub.id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[resume-subscription] unhandled error:", msg);
    return jsonRes({ error: msg }, 500);
  }
});
