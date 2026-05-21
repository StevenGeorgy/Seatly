// delete-restaurant: 2026-05-20 lifecycle rewrite. The previous version
// hard-deleted the restaurants row + payments rows (violating CRA 7-year
// retention) and did nothing to the Stripe subscription (owner kept getting
// billed forever).
//
// New behavior: soft-delete + cancel-at-period-end + 30-day grace window.
//   - Stripe sub flipped to cancel_at_period_end=true (owner still billed
//     for the in-progress month, no further charges).
//   - restaurants row: deleted_at=NOW(), scheduled_purge_at=NOW()+30d,
//     is_published=false, paused_reason='pending_deletion'.
//   - Existing reservations + payments + orders ALL untouched (diners can
//     still honor or cancel their bookings; CRA-required rows stay intact).
//   - Hard-purge (anonymization) is done later by the
//     purge-deleted-restaurants cron once scheduled_purge_at passes.
//
// Auth: caller must be the restaurant owner. The confirmation flow requires
// the owner to type the restaurant name.
//
// Payload: { restaurant_id, confirmationName }
//
// Returns: { ok: true, scheduled_purge_at, restored_within_days: 30 }
//          { error, ... }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { DeleteRestaurantSchema } from "../_shared/validation/restaurant-ops.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!bearerToken) return json({ error: "Authentication required" }, 401);

    const {
      data: { user },
      error: userError,
    } = await adminClient.auth.getUser(bearerToken);
    if (userError || !user) return json({ error: "Invalid or expired session" }, 401);

    const parsed = await parseJsonBody(req, DeleteRestaurantSchema, {
      jsonRes: (b, s) => json(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const restaurantId = parsed.data.restaurant_id ?? parsed.data.restaurantId!;
    const confirmationName = parsed.data.confirmationName;

    const { data: profile, error: profileError } = await adminClient
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (profileError || !profile) return json({ error: "User profile not found" }, 403);

    const { data: restaurant, error: restaurantError } = await adminClient
      .from("restaurants")
      .select("id, name, stripe_customer_id, subscription_status, deleted_at")
      .eq("id", restaurantId)
      .maybeSingle();
    if (restaurantError) return json({ error: restaurantError.message }, 400);
    if (!restaurant) return json({ error: "Restaurant not found" }, 404);

    const row = restaurant as {
      id: string;
      name: string | null;
      stripe_customer_id: string | null;
      subscription_status: string | null;
      deleted_at: string | null;
    };

    // Phase C4 (2026-05-20): ownership check BEFORE the name-confirmation
    // check. Without this ordering an authenticated diner could iterate
    // restaurant_id values and learn which name went with each (the name-
    // mismatch error reveals existence). UUIDs are unguessable so the
    // realistic attack surface is small, but defense-in-depth: the trust
    // boundary should be "you own this restaurant" before "what's its name".
    const { data: ownerRows, error: roleError } = await adminClient
      .from("user_restaurant_roles")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", profile.id)
      .eq("role", "owner");
    if (roleError || !ownerRows || ownerRows.length === 0) {
      return json({ error: "Only restaurant owners can delete a restaurant" }, 403);
    }

    if ((row.name ?? "").trim() !== confirmationName) {
      return json({ error: "Restaurant name confirmation does not match" }, 400);
    }

    if (row.deleted_at) {
      // Idempotent: already scheduled for deletion.
      const { data: existing } = await adminClient
        .from("restaurants")
        .select("scheduled_purge_at")
        .eq("id", restaurantId)
        .maybeSingle();
      return json({
        ok: true,
        already_scheduled: true,
        scheduled_purge_at: (existing as { scheduled_purge_at: string | null } | null)
          ?.scheduled_purge_at ?? null,
        restored_within_days: 30,
      });
    }

    // Flip the Stripe sub to cancel at period end. Owner is billed for the
    // current period (no proration), then nothing further. Catch + log:
    // partial state is OK; the webhook reconciles, and the next cron sweep
    // also re-checks. We never want a half-success to leave the DB in an
    // inconsistent state, so the DB UPDATE is independent of this call.
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (stripeKey && row.stripe_customer_id) {
      const SALVAGEABLE = new Set(["trialing", "active", "past_due"]);
      if (SALVAGEABLE.has(row.subscription_status ?? "")) {
        try {
          const stripe = await getStripeClient(stripeKey);
          const subs = await stripe.subscriptions.list({
            customer: row.stripe_customer_id,
            status: "all",
            limit: 5,
          });
          const active = subs.data.find(
            (s) =>
              s.status === "trialing" || s.status === "active" || s.status === "past_due",
          );
          if (active) {
            await stripe.subscriptions.update(active.id, {
              cancel_at_period_end: true,
            });
          }
        } catch (stripeErr) {
          console.error(
            "[delete-restaurant] Stripe cancel-at-period-end failed (continuing)",
            stripeErr instanceof Error ? stripeErr.message : String(stripeErr),
          );
        }
      }
    }

    // Soft-delete on the restaurants row. Reservations, payments, orders,
    // booking-fee rows, consent log, and Stripe records remain untouched.
    const now = new Date();
    const purgeAt = new Date(now.getTime() + 30 * 86_400_000).toISOString();
    const nowIso = now.toISOString();

    const { error: updateErr } = await adminClient
      .from("restaurants")
      .update({
        deleted_at: nowIso,
        scheduled_purge_at: purgeAt,
        is_published: false,
        paused_reason: "pending_deletion",
      })
      .eq("id", restaurantId);
    if (updateErr) return json({ error: updateErr.message }, 400);

    // Fire-and-forget owner notification. Helper may not exist yet.
    try {
      const mod = await import("../_shared/owner-notifications.ts").catch(() => null);
      if (mod && typeof (mod as { sendOwnerNotification?: unknown }).sendOwnerNotification === "function") {
        void (mod as {
          sendOwnerNotification: (opts: Record<string, unknown>) => Promise<unknown>;
        }).sendOwnerNotification({
          supabase: adminClient,
          restaurant_id: restaurantId,
          type: "restaurant_deletion_scheduled",
          context: {
            scheduled_purge_at: purgeAt,
            restaurant_name: row.name,
            restored_within_days: 30,
          },
        }).catch((e: unknown) => {
          console.warn(
            "[delete-restaurant] sendOwnerNotification rejected",
            e instanceof Error ? e.message : String(e),
          );
        });
      }
    } catch (notifErr) {
      console.warn(
        "[delete-restaurant] notification import/dispatch failed",
        notifErr instanceof Error ? notifErr.message : String(notifErr),
      );
    }

    return json({
      ok: true,
      scheduled_purge_at: purgeAt,
      restored_within_days: 30,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});
