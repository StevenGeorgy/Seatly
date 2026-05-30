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
//      cancel-reservation edge fn (all cancels fully refund). Reservations in
//      'seated'/'arriving' are left for the restaurant to close out; the RPC
//      scrubs their diner PII and the user_profiles cascade nulls their link.
//   6. delete_diner_account(profile_id) RPC — ONE atomic transaction that
//      scrubs all denormalized diner PII (reservations/holds/deposits/guests),
//      de-identifies legally-retained consent + payment records, hard-deletes
//      legacy AI/loyalty rows, then deletes the user_profiles row (cascading
//      chat/notifications/reviews/cards). A partial failure rolls back — no
//      half-deleted account.
//   7. Delete auth.users via admin API (cascades auth.* + auth-keyed children).
//   8. Best-effort delete the diner's storage objects (avatar, visit photos,
//      receipts, data exports).
//   9. Best-effort delete the Stripe Customer LAST (detaches its cards). Done
//      after the DB is the source of truth so a DB failure can't orphan Stripe.
//   10. Return refund summary so the client can surface a friendly toast.

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
// Buckets that store objects under a `${authUserId}/…` prefix. Cleaned best-effort.
const DINER_OBJECT_BUCKETS = ["visit-photos", "receipts", "user-data-exports"];

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

// Best-effort removal of every storage object under `${authUserId}/` in a bucket.
async function purgeUserObjects(bucket: string, authUserId: string): Promise<void> {
  try {
    const { data: objects, error } = await supabaseAdmin.storage
      .from(bucket)
      .list(authUserId, { limit: 1000 });
    if (error || !objects || objects.length === 0) return;
    const paths = objects
      .filter((o) => o.name && o.id !== null) // skip pseudo-folder entries
      .map((o) => `${authUserId}/${o.name}`);
    if (paths.length > 0) {
      await supabaseAdmin.storage.from(bucket).remove(paths);
    }
  } catch (err) {
    console.warn(`[delete-account] storage purge failed for ${bucket}:`, err);
  }
}

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

    // 5. Auto-cancel upcoming reservations via cancel-reservation edge fn
    // (refunds). Done BEFORE any deletion so a refund failure aborts cleanly
    // with nothing erased. Seated/arriving meals are left for the restaurant;
    // the RPC scrubs their PII and the cascade nulls the link.
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
      let cancelParsed: CancelReservationResult = {};
      try {
        cancelParsed = (await res.json()) as CancelReservationResult;
      } catch {
        cancelParsed = {};
      }
      if (!res.ok || cancelParsed.error) {
        // Abort — don't half-delete. Surface what we got so the diner can retry.
        return json({
          error: `Couldn't cancel reservation ${row.id}: ${cancelParsed.error ?? `HTTP ${res.status}`}. No data has been deleted yet — please try again.`,
        }, 502);
      }
      cancelledIds.push(row.id);
      if (typeof cancelParsed.refund_total_cents === "number") {
        totalRefundCents += cancelParsed.refund_total_cents;
      } else if (Array.isArray(cancelParsed.refunds)) {
        for (const r of cancelParsed.refunds) {
          if (typeof r?.amount_cents === "number") totalRefundCents += r.amount_cents;
        }
      }
    }

    // 6. Atomic erasure: scrub all PII, de-identify retained records, delete the
    // profile row. One transaction — a failure rolls back, so this can never
    // leave a half-deleted account, and it no longer throws on the FK blockers
    // (consent log / payments / waitlist / ai_conversations) that used to make
    // deletion fail for every diner.
    const { error: rpcError } = await supabaseAdmin.rpc("delete_diner_account", {
      p_user_profile_id: profileRow.id,
    });
    if (rpcError) {
      return json({
        error: `Couldn't delete your account data: ${rpcError.message}. Nothing was deleted (the operation rolled back); any cancelled reservations are still cancelled. Please try again or contact help@cenaiva.com.`,
        cancelled_reservation_ids: cancelledIds,
        refund_total_cents: totalRefundCents,
      }, 500);
    }

    // 7. Delete auth.users via admin API (cascades auth.* + auth-keyed children
    // like visit_photos rows, refund_requests). The profile + PII are already
    // gone at this point, so a failure here only leaves a dangling auth row.
    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (authDeleteError) {
      console.error(`[delete-account] auth delete failed for ${user.id}:`, authDeleteError);
      return json({
        error: `Your personal data was deleted, but we couldn't fully close the login. Please contact help@cenaiva.com to finish the cleanup.`,
        cancelled_reservation_ids: cancelledIds,
        refund_total_cents: totalRefundCents,
      }, 500);
    }

    // 8. Best-effort storage cleanup: avatar + visit photos + receipts + exports.
    const avatarPath = pathFromPublicUrl(profileRow.avatar_url);
    if (avatarPath) {
      try {
        await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([avatarPath]);
      } catch (err) {
        console.warn(`[delete-account] failed to remove avatar object:`, err);
      }
    }
    for (const bucket of DINER_OBJECT_BUCKETS) {
      await purgeUserObjects(bucket, user.id);
    }

    // 9. Delete the Stripe Customer LAST (this also detaches its saved cards).
    if (profileRow.stripe_customer_id) {
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
      if (stripeKey) {
        try {
          const stripe = await getStripeClient(stripeKey);
          await stripe.customers.del(profileRow.stripe_customer_id);
        } catch (err) {
          console.warn(`[delete-account] failed to delete Stripe customer ${profileRow.stripe_customer_id}:`, err);
        }
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
