// delete-account: diner-initiated permanent account deletion.
//
// Auth: Bearer JWT, verified internally (verify_jwt = false in config.toml).
// Payload: { email_confirmation: string } — must match the auth user's email
// exactly (case-insensitive). This is the type-to-confirm safety net.
//
// Order of operations:
//   1. Decode JWT → resolve auth.users + user_profiles.
//   2. Validate email_confirmation matches.
//   3. Rate-limit: 3/hour per user.
//   4. Block if user is a restaurant owner — they must wind those down first
//      via /dashboard/settings (Danger zone) where the delete-restaurant flow
//      lives. Auto-deleting a business is a footgun we won't ship.
//   5. Auto-cancel every upcoming reservation by invoking the existing
//      cancel-reservation edge fn (all cancels fully refund). Reservations
//      currently in 'seated' or 'arriving' status are NOT auto-cancelled —
//      the diner is mid-meal or on the way, so the restaurant handles the
//      close-out normally. Those rows get their user_profile_id nulled so
//      they survive the user_profiles cascade.
//   6. Detach + delete Stripe payment methods.
//   7. Delete the Stripe Customer itself.
//   8. Delete loyalty_waitlist row (no FK cascade from user_profiles).
//   9. Delete user_profiles row (cascades through FK chains).
//   10. Delete auth.users via admin API.
//   11. Best-effort delete the avatar storage object.
//   12. Return refund summary so the client can surface a friendly toast.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { DeleteAccountSchema } from "../_shared/validation/account.ts";
import { getStripeClient } from "../_shared/stripe-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ReservationRow = {
  id: string;
  reserved_at: string;
};

type SavedCardRow = {
  id: string;
  stripe_payment_method_id: string | null;
};

type CancelReservationResult = {
  ok?: boolean;
  refunds?: Array<{ amount_cents?: number }>;
  refund_total_cents?: number;
  error?: string;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const AVATAR_BUCKET = "user-avatars";

function pathFromPublicUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  try {
    return decodeURIComponent(url.slice(idx + marker.length));
  } catch {
    return null;
  }
}

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return json({ error: "Missing authorization token" }, 401);

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) return json({ error: "Invalid or expired session" }, 401);
    if (!user.email) return json({ error: "Account has no email on file." }, 400);

    const parsed = await parseJsonBody(req, DeleteAccountSchema, {
      jsonRes: (b, s) => json(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const confirm = parsed.data.email_confirmation.trim().toLowerCase();
    if (!confirm || confirm !== user.email.toLowerCase()) {
      return json({ error: "Email confirmation does not match." }, 400);
    }

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "delete-account",
        rateLimitIdentifier(req, user.id),
        { limit: 3, windowSeconds: 3600 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return json({ error: err.message }, 429);
      throw err;
    }

    // Resolve user_profiles.id + stripe_customer_id + avatar_url.
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .select("id, stripe_customer_id, avatar_url")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (profileError) return json({ error: profileError.message }, 500);
    if (!profile) return json({ error: "User profile not found." }, 404);

    const profileRow = profile as {
      id: string;
      stripe_customer_id: string | null;
      avatar_url: string | null;
    };

    // 4. Block if user is a restaurant owner.
    const { data: ownerRoles, error: rolesError } = await supabaseAdmin
      .from("user_restaurant_roles")
      .select("restaurant_id")
      .eq("user_id", profileRow.id)
      .eq("role", "owner")
      .limit(1);
    if (rolesError) return json({ error: rolesError.message }, 500);
    if (ownerRoles && ownerRoles.length > 0) {
      return json({
        error: "Delete your restaurants first.",
        blockers: { owns_restaurants: true },
      }, 409);
    }

    // 5. Auto-cancel upcoming reservations via cancel-reservation edge fn.
    // Skip 'seated' and 'arriving' — those reservations represent meals
    // in progress (or imminently so) and shouldn't be auto-cancelled
    // mid-bite. We null their user_profile_id below so they survive the
    // cascade and the restaurant can close them out manually.
    const nowIso = new Date().toISOString();
    const { data: upcomingRows, error: upcomingError } = await supabaseAdmin
      .from("reservations")
      .select("id, reserved_at")
      .eq("user_profile_id", profileRow.id)
      .in("status", ["confirmed", "pending_payment"])
      .gt("reserved_at", nowIso)
      .order("reserved_at", { ascending: true });
    if (upcomingError) return json({ error: upcomingError.message }, 500);

    const cancelledIds: string[] = [];
    let totalRefundCents = 0;
    const cancelUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/cancel-reservation`;
    for (const row of (upcomingRows ?? []) as ReservationRow[]) {
      const res = await fetch(cancelUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ reservation_id: row.id, actor: "diner" }),
      });
      let parsed: CancelReservationResult = {};
      try {
        parsed = (await res.json()) as CancelReservationResult;
      } catch {
        parsed = {};
      }
      if (!res.ok || parsed.error) {
        // Abort — don't half-delete. Surface what we got so the diner can retry.
        return json({
          error: `Couldn't cancel reservation ${row.id}: ${parsed.error ?? `HTTP ${res.status}`}. No data has been deleted yet — please try again.`,
        }, 502);
      }
      cancelledIds.push(row.id);
      if (typeof parsed.refund_total_cents === "number") {
        totalRefundCents += parsed.refund_total_cents;
      } else if (Array.isArray(parsed.refunds)) {
        for (const r of parsed.refunds) {
          if (typeof r?.amount_cents === "number") totalRefundCents += r.amount_cents;
        }
      }
    }

    // Stripe setup for steps 6 + 7. Best-effort across the board.
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    let stripe: import("npm:stripe@17").Stripe | null = null;
    if (stripeKey) {
      stripe = await getStripeClient(stripeKey);
    }

    // 6. Detach saved cards.
    const { data: savedCards } = await supabaseAdmin
      .from("saved_cards")
      .select("id, stripe_payment_method_id")
      .eq("user_id", profileRow.id);
    if (stripe && savedCards) {
      for (const card of savedCards as SavedCardRow[]) {
        if (!card.stripe_payment_method_id) continue;
        try {
          await stripe.paymentMethods.detach(card.stripe_payment_method_id);
        } catch (err) {
          console.warn(`[delete-account] failed to detach PM ${card.stripe_payment_method_id}:`, err);
        }
      }
    }

    // 7. Delete the Stripe Customer.
    if (stripe && profileRow.stripe_customer_id) {
      try {
        await stripe.customers.del(profileRow.stripe_customer_id);
      } catch (err) {
        console.warn(`[delete-account] failed to delete Stripe customer ${profileRow.stripe_customer_id}:`, err);
      }
    }

    // 8. Delete loyalty_waitlist row (no FK cascade).
    await supabaseAdmin
      .from("loyalty_waitlist")
      .delete()
      .eq("user_id", profileRow.id);

    // 8b. Detach in-progress reservations (seated / arriving) so they
    // survive the user_profiles cascade. The restaurant still needs to
    // close them out — we just remove the diner's identity from the row.
    await supabaseAdmin
      .from("reservations")
      .update({ user_profile_id: null })
      .eq("user_profile_id", profileRow.id)
      .in("status", ["seated", "arriving"]);

    // 9. Delete user_profiles row.
    const { error: profileDeleteError } = await supabaseAdmin
      .from("user_profiles")
      .delete()
      .eq("id", profileRow.id);
    if (profileDeleteError) {
      return json({
        error: `Couldn't delete profile row: ${profileDeleteError.message}. Cancelled reservations are still cancelled; nothing else has been deleted.`,
        cancelled_reservation_ids: cancelledIds,
        refund_total_cents: totalRefundCents,
      }, 500);
    }

    // 10. Delete auth.users via admin API.
    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (authDeleteError) {
      return json({
        error: `Couldn't delete auth user: ${authDeleteError.message}. The profile row is already gone — please contact support to finish the cleanup.`,
        cancelled_reservation_ids: cancelledIds,
        refund_total_cents: totalRefundCents,
      }, 500);
    }

    // 11. Best-effort avatar object cleanup.
    const avatarPath = pathFromPublicUrl(profileRow.avatar_url);
    if (avatarPath) {
      try {
        await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([avatarPath]);
      } catch (err) {
        console.warn(`[delete-account] failed to remove avatar object:`, err);
      }
    }

    return json({
      ok: true,
      cancelled_reservation_ids: cancelledIds,
      refund_total_cents: totalRefundCents,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
});
