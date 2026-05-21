// @ts-nocheck
// heartbeat-reservation-hold — periodic ping from the checkout page so
// the hold doesn't expire while the user is mid-flow. Anon-callable.
//
// extend_reservation_hold returns the new expires_at timestamptz, OR
// NULL when the hold is not active (already expired, cancelled, or
// converted). NULL → 410 Gone so the client knows to stop pinging.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  enforceRateLimit,
  rateLimitIdentifier,
  RateLimitError,
} from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { HeartbeatReservationHoldSchema } from "../_shared/validation/reservation-hold.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  hold_id?: unknown;
  extend_seconds?: unknown;
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

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
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
    const parsed = await parseJsonBody(req, HeartbeatReservationHoldSchema, {
      jsonRes: (b, s) => jsonResponse(b as Record<string, unknown>, s),
    });
    if ("response" in parsed) return parsed.response;
    const holdId = parsed.data.hold_id;

    const extendSeconds = Math.max(
      1,
      Math.floor(parsed.data.extend_seconds ?? 120),
    );

    // Resolve auth purely for rate-limit bucketing. Anon-callable: a
    // missing or invalid token just leaves userProfileId null (per-IP
    // bucket). Valid tokens are cryptographically verified via
    // supabaseAdmin.auth.getUser — never trust the unverified JWT
    // payload, which an attacker can forge.
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
        "heartbeat-reservation-hold:min",
        rateLimitIdentifier(req, userProfileId),
        { limit: 30, windowSeconds: 60 },
      );
    } catch (err) {
      if (err instanceof RateLimitError) {
        return jsonResponse({ error: err.message, unavailable_reason: "rate_limited" }, 429);
      }
      throw err;
    }

    const { data, error } = await supabaseAdmin.rpc("extend_reservation_hold", {
      p_hold_id: holdId,
      p_extend_seconds: extendSeconds,
    });

    if (error) {
      return jsonResponse({ error: `extend_reservation_hold: ${error.message}` }, 400);
    }

    // RPC returns NULL when the hold is not active. Map to 410 Gone so
    // the client stops the heartbeat interval and surfaces an "expired"
    // UI.
    if (data === null || data === undefined) {
      return jsonResponse({ error: "hold_not_active" }, 410);
    }

    return jsonResponse({ expires_at: data });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
