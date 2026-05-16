// @ts-nocheck
// create-reservation-hold — Step 1 mount. Anon-callable.
//
// Calls public.create_reservation_hold (advisory lock + diner-overlap
// pre-check + cover-cap re-check + table assignment) and returns the
// hold metadata. Mirrors the validation / rate-limit / error-mapping
// shape of create-public-booking. For logged-in diners (Authorization:
// Bearer <jwt>), the auth.sub is forwarded as p_user_profile_id; guests
// leave it null and identity is attached later via update-reservation-
// hold.
//
// Idempotency: a tiny in-memory Map keyed on
// `${ip}|${idempotency_key}` (5-min TTL) returns the previous response
// when the same key arrives twice. Edge-function instances are
// short-lived, so the worst case on a cold instance is a duplicate
// hold attempt — and create_reservation_hold's diner-overlap guard
// catches that as P0006 anyway.
//
// Error mapping (matches the RPC's RAISE EXCEPTION codes):
//   P0001 no_table              → 409 unavailable_reason: 'no_table'
//   P0002 over_cover_cap        → 409 unavailable_reason: 'over_cover_cap'
//   P0003 shift_not_found       → 404
//   P0006 / 23P01               → 409 unavailable_reason: 'diner_double_book'

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  enforceRateLimit,
  rateLimitIdentifier,
  RateLimitError,
} from "../_shared/rate-limit.ts";
import { decodeJwtPayload } from "../_shared/jwt.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  restaurant_id?: unknown;
  shift_id?: unknown;
  date_time?: unknown;
  party_size?: unknown;
  source?: unknown;
  idempotency_key?: unknown;
  event_id?: unknown;
  promotion_id?: unknown;
  applied_promo_code?: unknown;
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asUuid(value: unknown): string | null {
  const text = asText(value);
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Idempotency cache. Keyed on `${ip}|${idempotency_key}`, value is the
// full response body. 5-minute TTL — long enough to cover a refresh /
// network retry, short enough to not leak across diners.
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const idempotencyCache = new Map<string, { expiresAt: number; body: Record<string, unknown> }>();

function pruneIdempotencyCache(): void {
  const now = Date.now();
  for (const [key, entry] of idempotencyCache) {
    if (entry.expiresAt < now) idempotencyCache.delete(key);
  }
}

function idempotencyKeyFor(req: Request, key: string, restaurantId: string, dateTime: string, partySize: number): string {
  const ip = rateLimitIdentifier(req); // already ip:xxx or ip:unknown
  return `${ip}|${key}|${restaurantId}|${dateTime}|${partySize}`;
}

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST required" }, 405);

  try {
    const payload = (await req.json().catch(() => ({}))) as Payload;

    const restaurantId = asUuid(payload.restaurant_id);
    const shiftId = asUuid(payload.shift_id);
    const dateTime = asText(payload.date_time);
    const partySizeRaw = asNumber(payload.party_size, 0);
    const partySize = Math.max(1, Math.floor(partySizeRaw));
    const source = asText(payload.source) ?? "web";
    const idempotencyKey = asText(payload.idempotency_key);
    const eventId = asUuid(payload.event_id);
    const promotionId = asUuid(payload.promotion_id);
    const appliedPromoCode = asText(payload.applied_promo_code);

    if (!restaurantId || !shiftId || !dateTime || partySizeRaw < 1) {
      return jsonResponse(
        { error: "restaurant_id, shift_id, date_time, and party_size are required." },
        400,
      );
    }
    const reservedAt = new Date(dateTime);
    if (Number.isNaN(reservedAt.getTime())) {
      return jsonResponse({ error: "date_time must be a valid ISO timestamp." }, 400);
    }

    // Resolve logged-in diner. We can't call supabase.auth.getUser() here
    // because verify_jwt is off and not every JWT is HS256 — decode the
    // payload directly to read auth.sub, then look up the user_profiles
    // row that the on_auth_user_created trigger guaranteed exists.
    let userProfileId: string | null = null;
    const authorization = req.headers.get("authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
    if (token) {
      const decoded = decodeJwtPayload(token);
      const authUserId = typeof decoded?.sub === "string" ? decoded.sub : null;
      if (authUserId) {
        const { data: profile } = await supabaseAdmin
          .from("user_profiles")
          .select("id")
          .eq("auth_user_id", authUserId)
          .maybeSingle();
        userProfileId = profile?.id ?? null;
      }
    }

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "create-reservation-hold:min",
        rateLimitIdentifier(req, userProfileId),
        { limit: 30, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) {
        return jsonResponse({ error: err.message, unavailable_reason: "rate_limited" }, 429);
      }
      throw err;
    }

    // Idempotency replay.
    pruneIdempotencyCache();
    const cacheKey = idempotencyKey
      ? idempotencyKeyFor(req, idempotencyKey, restaurantId, reservedAt.toISOString(), partySize)
      : null;
    if (cacheKey) {
      const cached = idempotencyCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return jsonResponse(cached.body);
      }
    }

    const { data: rpcRows, error: rpcError } = await supabaseAdmin.rpc(
      "create_reservation_hold",
      {
        p_restaurant_id: restaurantId,
        p_shift_id: shiftId,
        p_reserved_at: reservedAt.toISOString(),
        p_party_size: partySize,
        p_source: source,
        p_user_profile_id: userProfileId,
        p_event_id: eventId,
        p_promotion_id: promotionId,
        p_applied_promo_code: appliedPromoCode,
      },
    );

    if (rpcError) {
      const code = (rpcError as { code?: string }).code;
      if (code === "P0001") {
        return jsonResponse(
          { error: "No tables available for that time.", unavailable_reason: "no_table" },
          409,
        );
      }
      if (code === "P0002") {
        return jsonResponse(
          {
            error: "This shift is at capacity for the selected time.",
            unavailable_reason: "over_cover_cap",
          },
          409,
        );
      }
      if (code === "P0003") {
        return jsonResponse({ error: "Shift not found for this restaurant." }, 404);
      }
      if (code === "P0006" || code === "23P01") {
        return jsonResponse(
          {
            error:
              "You already have a reservation or hold at this time. Cancel or modify it before holding another.",
            unavailable_reason: "diner_double_book",
          },
          409,
        );
      }
      return jsonResponse({ error: `create_reservation_hold: ${rpcError.message}` }, 400);
    }

    const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    if (!row?.hold_id) {
      return jsonResponse({ error: "create_reservation_hold returned no row" }, 500);
    }

    const body: Record<string, unknown> = {
      hold_id: row.hold_id,
      confirmation_code: row.confirmation_code,
      table_ids: Array.isArray(row.table_ids) ? row.table_ids : [],
      duration_minutes:
        typeof row.duration_minutes === "number"
          ? row.duration_minutes
          : Number(row.duration_minutes ?? 0),
      expires_at: row.expires_at,
      deposit_amount_cents:
        typeof row.deposit_amount_cents === "number"
          ? row.deposit_amount_cents
          : Number(row.deposit_amount_cents ?? 0),
      server_now: row.server_now,
    };

    if (cacheKey) {
      idempotencyCache.set(cacheKey, {
        expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
        body,
      });
    }

    return jsonResponse(body);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
