// merge-diner-accounts: Phase 5 of diner auth overhaul (2026-05-15).
//
// Triggered after the auth callback detects two `user_profiles` rows
// linked to different `auth.users` ids but sharing email OR phone.
// Merges them under the canonical (older) auth.users by re-pointing
// every diner-relevant FK reference, then hard-deletes the duplicate
// user_profiles + auth.users rows.
//
// Auth model: caller MUST be currently signed in as one of the two
// auth users (either the canonical or the duplicate). Verifies via
// JWT decode → must match canonical_auth_user_id or archived_auth_user_id.
// This prevents a stranger from triggering merges on other diners.
//
// The merge is **irreversible**. Front-end shows clear confirmation
// UX before calling this function. Forensic audit row is written to
// `account_merge_audit` so support can investigate "I lost a booking"
// reports.
//
// Body: { canonical_auth_user_id: string, archived_auth_user_id: string }
// Returns: { ok: true, audit_id: string, counts: {...} }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { MergeDinerAccountsSchema } from "../_shared/validation/account.ts";

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

const adminClient = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    try {
      await enforceRateLimit(
        adminClient,
        "merge-diner-accounts",
        rateLimitIdentifier(req),
        { limit: 5, windowSeconds: 300 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) return jsonRes({ error: err.message }, 429);
      throw err;
    }

    const authHeader = req.headers.get("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    if (!bearerToken) return jsonRes({ error: "Authentication required" }, 401);

    // Cryptographically verify the JWT — auth.getUser checks the
    // signature against Supabase's signing key. This is the trust
    // anchor for the entire merge: callerAuthUserId determines which
    // of the two accounts is allowed to be merged. NEVER read sub
    // from an unverified JWT payload here.
    const { data: { user }, error: authError } = await adminClient.auth.getUser(bearerToken);
    if (authError || !user) return jsonRes({ error: "Unauthorized" }, 401);
    const callerAuthUserId = user.id;

    const parsed = await parseJsonBody(req, MergeDinerAccountsSchema, {
      jsonRes: (b, s) => jsonRes(b, s),
    });
    if ("response" in parsed) return parsed.response;
    const canonicalAuthUserId = parsed.data.canonical_auth_user_id;
    const archivedAuthUserId = parsed.data.archived_auth_user_id;

    // SECURITY-CRITICAL: caller must be signed in as one of the two accounts.
    // The JWT was cryptographically verified above (auth.getUser) — never
    // trust the request body alone for which account-id can initiate a
    // merge. DO NOT relax this check.
    if (
      callerAuthUserId !== canonicalAuthUserId &&
      callerAuthUserId !== archivedAuthUserId
    ) {
      return jsonRes(
        { error: "You can only merge accounts you're signed into" },
        403,
      );
    }

    // Resolve both profiles.
    const { data: profilesRaw, error: profilesErr } = await adminClient
      .from("user_profiles")
      .select("id, auth_user_id, email, phone, stripe_customer_id, created_at")
      .in("auth_user_id", [canonicalAuthUserId, archivedAuthUserId]);
    if (profilesErr) return jsonRes({ error: profilesErr.message }, 400);
    const profiles = (profilesRaw ?? []) as Array<{
      id: string;
      auth_user_id: string;
      email: string | null;
      phone: string | null;
      stripe_customer_id: string | null;
      created_at: string;
    }>;
    const canonicalProfile = profiles.find((p) => p.auth_user_id === canonicalAuthUserId);
    const archivedProfile = profiles.find((p) => p.auth_user_id === archivedAuthUserId);
    if (!canonicalProfile || !archivedProfile) {
      return jsonRes({ error: "One of the user profiles was not found" }, 404);
    }

    // Defensive: require email or phone match between the two profiles.
    // Prevents anyone from being tricked into merging unrelated accounts
    // (in addition to the JWT check above).
    const emailMatch =
      canonicalProfile.email &&
      archivedProfile.email &&
      canonicalProfile.email.toLowerCase() === archivedProfile.email.toLowerCase();
    const phoneMatch =
      canonicalProfile.phone &&
      archivedProfile.phone &&
      canonicalProfile.phone === archivedProfile.phone;
    if (!emailMatch && !phoneMatch) {
      return jsonRes(
        { error: "These accounts don't share an email or phone — won't merge" },
        400,
      );
    }

    // Re-point diner-relevant FK rows. We use the service role to bypass
    // RLS (RLS would normally scope writes to the user's own rows; here we
    // need to move rows from the archived profile to the canonical, which
    // both belong to the same diner anyway).
    const counts = {
      reservations: 0,
      saved_cards: 0,
      guests: 0,
      deposits: 0,
      reviews: 0,
      alerts: 0,
      notifications: 0,
    };

    // Tables keyed by user_profiles.id via FK columns.
    const repointPairs: Array<{ table: string; column: string; key: keyof typeof counts | null }> = [
      { table: "reservations", column: "user_profile_id", key: "reservations" },
      { table: "saved_cards", column: "user_profile_id", key: "saved_cards" },
      { table: "guests", column: "user_profile_id", key: "guests" },
      { table: "reservation_deposit_payments", column: "payer_user_profile_id", key: "deposits" },
      { table: "restaurant_reviews", column: "user_id", key: "reviews" },
      { table: "availability_alerts", column: "user_id", key: "alerts" },
      { table: "notifications", column: "user_id", key: "notifications" },
      { table: "user_restaurant_roles", column: "user_id", key: null },
      { table: "chat_conversations", column: "user_profile_id", key: null },
      { table: "payments", column: "user_profile_id", key: null },
      { table: "waitlist", column: "user_profile_id", key: null },
    ];

    for (const { table, column, key } of repointPairs) {
      const { data, error } = await adminClient
        .from(table)
        // deno-lint-ignore no-explicit-any
        .update({ [column]: canonicalProfile.id } as any)
        .eq(column, archivedProfile.id)
        .select("id");
      if (error) {
        // Don't bail the whole merge on a single re-point failure — that
        // would leave the DB in a half-merged state. Log it; continue.
        console.warn(
          `[merge-diner-accounts] re-point ${table}.${column} failed:`,
          error.message,
        );
        continue;
      }
      if (key) counts[key] = (data ?? []).length;
    }

    // Insert the audit log BEFORE deleting the duplicate rows, so a
    // crash mid-delete still leaves a forensic record.
    const { data: auditRow, error: auditErr } = await adminClient
      .from("account_merge_audit")
      .insert({
        canonical_auth_user_id: canonicalAuthUserId,
        canonical_profile_id: canonicalProfile.id,
        archived_auth_user_id: archivedAuthUserId,
        archived_profile_id: archivedProfile.id,
        triggered_by_email: emailMatch ? canonicalProfile.email : null,
        triggered_by_phone: phoneMatch ? canonicalProfile.phone : null,
        merged_count_reservations: counts.reservations,
        merged_count_saved_cards: counts.saved_cards,
        merged_count_guests: counts.guests,
        merged_count_deposits: counts.deposits,
        merged_count_reviews: counts.reviews,
        merged_count_alerts: counts.alerts,
        merged_count_notifications: counts.notifications,
      })
      .select("id")
      .single();
    if (auditErr) {
      console.warn("[merge-diner-accounts] audit log insert failed:", auditErr.message);
    }

    // Hard delete the duplicate user_profile row.
    const { error: deleteProfileErr } = await adminClient
      .from("user_profiles")
      .delete()
      .eq("id", archivedProfile.id);
    if (deleteProfileErr) {
      return jsonRes(
        { error: `Profile cleanup failed: ${deleteProfileErr.message}` },
        500,
      );
    }

    // Hard delete the duplicate auth.users via Supabase Admin API. This
    // also revokes any active sessions for that user.
    const { error: deleteAuthErr } = await adminClient.auth.admin.deleteUser(
      archivedAuthUserId,
    );
    if (deleteAuthErr) {
      // Don't bail — the user_profile is already gone, and the duplicate
      // auth.users will just be orphaned (can't sign in to a profile that
      // doesn't exist). Worth a manual support cleanup eventually.
      console.warn(
        "[merge-diner-accounts] auth.users delete failed:",
        deleteAuthErr.message,
      );
    }

    return jsonRes({
      ok: true,
      audit_id: auditRow?.id ?? null,
      counts,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});
