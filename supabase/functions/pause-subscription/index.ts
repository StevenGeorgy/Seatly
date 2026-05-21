// pause-subscription: pauses billing via Stripe `pause_collection` + hides
// the restaurant from Discover. Existing reservations stay valid (diners
// still show up). Resume via resume-subscription at any time.
//
// Note: Stripe's pause_collection does NOT extend the trial clock. If the
// owner is currently trialing, their trial keeps counting down — they
// should cancel instead if they want to pause the trial.

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
  type: "subscription_paused",
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
          console.warn("[pause-subscription] notification rejected", e);
        });
    }
  } catch (notifErr) {
    console.warn("[pause-subscription] notification import failed", notifErr);
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
        "pause-subscription",
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
      .select("id, name, stripe_customer_id, subscription_paused_at")
      .eq("id", restaurantId)
      .maybeSingle();
    if (!rest) return jsonRes({ error: "Restaurant not found" }, 404);
    const row = rest as {
      id: string;
      name: string | null;
      stripe_customer_id: string | null;
      subscription_paused_at: string | null;
    };
    if (row.subscription_paused_at) {
      return jsonRes({
        ok: true,
        already_paused: true,
        paused_at: row.subscription_paused_at,
      });
    }
    if (!row.stripe_customer_id) {
      return jsonRes({ error: "Restaurant has no Stripe customer; nothing to pause." }, 400);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return jsonRes({ error: "Stripe not configured on server" }, 500);
    const stripe = await getStripeClient(stripeKey);

    const subs = await stripe.subscriptions.list({
      customer: row.stripe_customer_id,
      status: "all",
      limit: 5,
    });
    const active = subs.data.find((s) =>
      ["trialing", "active", "past_due"].includes(s.status ?? ""),
    );
    if (!active) {
      return jsonRes({ error: "No active subscription found for this restaurant." }, 404);
    }

    await stripe.subscriptions.update(active.id, {
      // 'void' means: don't charge during pause; don't generate invoices.
      // (Alternatives: 'keep_as_draft' or 'mark_uncollectible'.)
      pause_collection: { behavior: "void" },
    });

    const pausedAt = new Date().toISOString();

    // Unpublish the restaurant + mirror state.
    const { error: updateErr } = await supabaseAdmin
      .from("restaurants")
      .update({
        subscription_paused_at: pausedAt,
        is_published: false,
        paused_reason: "owner_unpublished",
      })
      .eq("id", restaurantId);
    if (updateErr) {
      console.error("[pause-subscription] DB mirror failed", updateErr);
    }

    await dispatchOwnerNotification(restaurantId, "subscription_paused", {
      restaurantName: row.name ?? "your restaurant",
    });

    return jsonRes({
      ok: true,
      subscription_id: active.id,
      paused_at: pausedAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pause-subscription] unhandled error:", msg);
    return jsonRes({ error: msg }, 500);
  }
});
