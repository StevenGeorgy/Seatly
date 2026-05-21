// export-my-data: ToS §19 data-rights endpoint. Returns a JSON blob
// summarizing everything Cenaiva stores about the calling diner.
//
// Auth: caller MUST present a valid Supabase session JWT in the
// Authorization header. We verify via auth.getUser (ES256-aware) and
// resolve the diner's user_profiles row. Anonymous calls are rejected
// 401; missing profile rows are rejected 403 (the on_auth_user_created
// trigger guarantees a row, so this should never happen in practice).
//
// Output: a single JSON document covering profile, reservations,
// deposit payments, orders, reviews, correction requests, and recent
// sign-in events. Large collections are capped at 1000 rows with a
// `truncated: true` flag so legitimate accounts don't OOM the function.
//
// Strips internal-only columns (Stripe customer IDs, push tokens) so
// the export is safe to hand to the user without leaking platform
// secrets.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { checkAuth } from "../_shared/auth.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";

const ROW_CAP = 1000;
const SIGN_IN_LOOKBACK_DAYS = 90;
const EXPORT_VERSION = "2026-05-21";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function jsonRes(body: unknown, status: number, req: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
  });
}

type ProfileRow = Record<string, unknown> & { id: string };

// Columns we deliberately omit from the diner-visible export. These are
// internal billing/push identifiers, not personal data the user would
// recognize or benefit from.
const PROFILE_PRIVATE_COLUMNS = new Set<string>([
  "stripe_customer_id",
  "stripe_payment_method_id",
  "expo_push_token",
]);

function sanitizeProfile(row: ProfileRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (PROFILE_PRIVATE_COLUMNS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

type CollectionResult<T> = {
  rows: T[];
  truncated: boolean;
};

async function collectReservations(userProfileId: string): Promise<CollectionResult<unknown>> {
  const select =
    "id, restaurant_id, reserved_at, party_size, status, confirmation_code, " +
    "deposit_amount, deposit_amount_cents, deposit_status, special_request, " +
    "dietary_notes, occasion, created_at, cancelled_at, cancellation_reason, " +
    "completed_at, checked_in_at, seated_at, source, " +
    "restaurants!inner(name, slug)";
  const { data, error } = await supabaseAdmin
    .from("reservations")
    .select(select)
    .eq("user_profile_id", userProfileId)
    .order("reserved_at", { ascending: false })
    .limit(ROW_CAP + 1);
  if (error) throw error;
  const rows = (data ?? []) as unknown[];
  const truncated = rows.length > ROW_CAP;
  return { rows: truncated ? rows.slice(0, ROW_CAP) : rows, truncated };
}

async function collectDepositPayments(
  userProfileId: string,
  reservationIds: string[],
): Promise<CollectionResult<unknown>> {
  // Rows where this diner is the named payer, OR rows attached to one
  // of their reservations (covers the host-pays-for-table case as well
  // as the multi-payer split-tender flow).
  const select =
    "id, reservation_id, payer_email, payer_full_name, amount_cents, status, " +
    "stripe_payment_intent_id, paid_at, created_at, updated_at";
  const filter = reservationIds.length > 0
    ? `payer_user_profile_id.eq.${userProfileId},reservation_id.in.(${reservationIds.join(",")})`
    : `payer_user_profile_id.eq.${userProfileId}`;
  const { data, error } = await supabaseAdmin
    .from("reservation_deposit_payments")
    .select(select)
    .or(filter)
    .order("created_at", { ascending: false })
    .limit(ROW_CAP + 1);
  if (error) throw error;
  const rows = (data ?? []) as unknown[];
  const truncated = rows.length > ROW_CAP;
  return { rows: truncated ? rows.slice(0, ROW_CAP) : rows, truncated };
}

async function collectOrders(userProfileId: string): Promise<CollectionResult<unknown>> {
  const select =
    "id, restaurant_id, reservation_id, is_preorder, status, subtotal, tax_amount, " +
    "tip_amount, total_amount, payment_method, order_type, confirmation_code, " +
    "notes, created_at, paid_at, billed_at";
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(select)
    .eq("guest_id", userProfileId)
    .order("created_at", { ascending: false })
    .limit(ROW_CAP + 1);
  if (error) throw error;
  const rows = (data ?? []) as unknown[];
  const truncated = rows.length > ROW_CAP;
  return { rows: truncated ? rows.slice(0, ROW_CAP) : rows, truncated };
}

async function collectReviews(
  userProfileId: string,
  authUserId: string,
): Promise<CollectionResult<unknown>> {
  // Reviews historically used `user_id` (auth.users) for the author;
  // newer rows mirror via `guest_id` (user_profiles). Match either.
  const select =
    "id, restaurant_id, reservation_id, rating, review_text, created_at, updated_at";
  const { data, error } = await supabaseAdmin
    .from("restaurant_reviews")
    .select(select)
    .or(`user_id.eq.${authUserId},guest_id.eq.${userProfileId}`)
    .order("created_at", { ascending: false })
    .limit(ROW_CAP + 1);
  if (error) throw error;
  const rows = (data ?? []) as unknown[];
  const truncated = rows.length > ROW_CAP;
  return { rows: truncated ? rows.slice(0, ROW_CAP) : rows, truncated };
}

async function collectCorrectionRequests(
  userProfileId: string,
): Promise<CollectionResult<unknown>> {
  const select =
    "id, field, current_value, proposed_value, rationale, status, " +
    "reviewed_at, review_notes, created_at";
  const { data, error } = await supabaseAdmin
    .from("data_correction_requests")
    .select(select)
    .eq("user_profile_id", userProfileId)
    .order("created_at", { ascending: false })
    .limit(ROW_CAP + 1);
  if (error) throw error;
  const rows = (data ?? []) as unknown[];
  const truncated = rows.length > ROW_CAP;
  return { rows: truncated ? rows.slice(0, ROW_CAP) : rows, truncated };
}

async function collectSignInEvents(authUserId: string): Promise<CollectionResult<unknown>> {
  const sinceIso = new Date(
    Date.now() - SIGN_IN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const select =
    "id, device_fingerprint, platform, app_version, user_agent, " +
    "occurred_at, is_new_device, alert_dispatched_at";
  const { data, error } = await supabaseAdmin
    .from("auth_sign_in_events")
    .select(select)
    .eq("user_id", authUserId)
    .gte("occurred_at", sinceIso)
    .order("occurred_at", { ascending: false })
    .limit(ROW_CAP + 1);
  if (error) throw error;
  const rows = (data ?? []) as unknown[];
  const truncated = rows.length > ROW_CAP;
  return { rows: truncated ? rows.slice(0, ROW_CAP) : rows, truncated };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonRes({ error: "POST only" }, 405, req);
  }

  try {
    const auth = await checkAuth(req, supabaseAdmin);
    if (!auth.ok) {
      const status = auth.reason === "missing_token" ? 401 : 401;
      return jsonRes({ error: "unauthorized", reason: auth.reason }, status, req);
    }

    // We accept (and ignore) an empty / `{}` body. Some clients refuse
    // to omit a JSON body on POST so we don't enforce strict emptiness.
    try {
      if (req.headers.get("content-length") && Number(req.headers.get("content-length")) > 0) {
        await req.json().catch(() => null);
      }
    } catch {
      // Swallow — body is optional.
    }

    const { data: profileRow, error: profileErr } = await supabaseAdmin
      .from("user_profiles")
      .select("*")
      .eq("auth_user_id", auth.authUserId)
      .maybeSingle();
    if (profileErr) throw profileErr;
    if (!profileRow || typeof profileRow !== "object" || !("id" in profileRow)) {
      return jsonRes({ error: "no_profile" }, 403, req);
    }
    const profile = profileRow as ProfileRow;

    const reservations = await collectReservations(profile.id);
    const reservationIds = reservations.rows
      .map((r) => (r as { id?: unknown }).id)
      .filter((v): v is string => typeof v === "string");
    const depositPayments = await collectDepositPayments(profile.id, reservationIds);
    const orders = await collectOrders(profile.id);
    const reviews = await collectReviews(profile.id, auth.authUserId);
    const correctionRequests = await collectCorrectionRequests(profile.id);
    const signInEvents = await collectSignInEvents(auth.authUserId);

    const body = {
      export_version: EXPORT_VERSION,
      exported_at: new Date().toISOString(),
      user_profile_id: profile.id,
      profile: sanitizeProfile(profile),
      reservations: reservations.rows,
      reservations_truncated: reservations.truncated,
      deposit_payments: depositPayments.rows,
      deposit_payments_truncated: depositPayments.truncated,
      orders: orders.rows,
      orders_truncated: orders.truncated,
      reviews: reviews.rows,
      reviews_truncated: reviews.truncated,
      correction_requests: correctionRequests.rows,
      correction_requests_truncated: correctionRequests.truncated,
      recent_sign_in_events: signInEvents.rows,
      recent_sign_in_events_truncated: signInEvents.truncated,
      notes: {
        recent_sign_in_window_days: SIGN_IN_LOOKBACK_DAYS,
        row_cap_per_collection: ROW_CAP,
      },
    };

    return jsonRes(body, 200, req);
  } catch (err) {
    console.error("[export-my-data] fatal", err);
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500, req);
  }
});
