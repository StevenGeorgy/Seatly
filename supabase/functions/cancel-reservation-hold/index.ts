// @ts-nocheck
// cancel-reservation-hold — explicit user-initiated cancel (back
// button, page close beacon, "give up my hold" click).
//
// Anon-callable. Fire-and-forget on the client side via
// navigator.sendBeacon, so the response may never be observed — we
// always return { ok: true, cancelled: <bool> } with status 200
// unless the request itself is malformed. Both underlying RPCs are
// idempotent (UPDATE … WHERE status IN ('active','converting')), so
// repeated calls are safe.
//
// Accepts either { hold_id } OR { client_token } OR both. If both
// are provided we prefer client_token: it routes through
// cancel_reservation_hold_by_token, which upserts a tombstone in
// hold_cancellation_intents AND flips any existing matching hold —
// this is race-safe against the create-then-immediately-cancel
// window where the browser never learned the hold_id.
//
// The `cancelled` boolean in the response reflects whether a row
// was actually flipped (true) or the call was a no-op (false) — for
// dev-console / log observability only; beacon callers can't react.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  enforceRateLimit,
  rateLimitIdentifier,
  RateLimitError,
} from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { CancelReservationHoldSchema } from "../_shared/validation/reservation-hold.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  hold_id?: unknown;
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

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST required" }, 405);

  try {
    const parsed = await parseJsonBody(req, CancelReservationHoldSchema, {
      jsonRes: (b, s) => jsonResponse(b as Record<string, unknown>, s),
    });
    if ("response" in parsed) return parsed.response;
    const holdId = parsed.data.hold_id ?? null;
    const clientToken = parsed.data.client_token ?? null;

    // Resolve auth purely for rate-limit bucketing. Anon-callable: a
    // missing or invalid token just leaves userProfileId null (per-IP
    // bucket). Valid tokens get a per-user bucket. We cryptographically
    // verify the token via supabaseAdmin.auth.getUser — never trust the
    // unverified JWT payload, which an attacker can forge.
    let userProfileId: string | null = null;
    const authorization = req.headers.get("authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
    if (token) {
      const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
      if (!authError && user) {
        const { data: profile } = await supabaseAdmin
          .from("user_profiles")
          .select("id")
          .eq("auth_user_id", user.id)
          .maybeSingle();
        userProfileId = profile?.id ?? null;
      }
    }

    try {
      await enforceRateLimit(
        supabaseAdmin,
        "cancel-reservation-hold:min",
        rateLimitIdentifier(req, userProfileId),
        { limit: 30, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) {
        return jsonResponse({ error: err.message, unavailable_reason: "rate_limited" }, 429);
      }
      throw err;
    }

    // Prefer client_token when both are provided — the tombstone path
    // is race-safe against the create-then-cancel window.
    let cancelled = false;
    if (clientToken) {
      const { data, error } = await supabaseAdmin.rpc(
        "cancel_reservation_hold_by_token",
        { p_client_token: clientToken },
      );
      if (error) {
        // Log but still return ok: true — beacon callers can't react,
        // and the cleanup cron will expire orphaned holds anyway.
        console.warn(
          "[cancel-reservation-hold] cancel_reservation_hold_by_token error:",
          error.message,
        );
      } else {
        cancelled = data === true;
      }
    } else if (holdId) {
      const { data, error } = await supabaseAdmin.rpc(
        "cancel_reservation_hold",
        { p_hold_id: holdId },
      );
      if (error) {
        console.warn(
          "[cancel-reservation-hold] cancel_reservation_hold error:",
          error.message,
        );
      } else {
        cancelled = data === true;
      }
    }

    return jsonResponse({ ok: true, cancelled });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
