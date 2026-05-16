// @ts-nocheck
// cancel-reservation-hold — explicit user-initiated cancel (back
// button, page close beacon, "give up my hold" click).
//
// Anon-callable. Fire-and-forget on the client side via
// navigator.sendBeacon, so the response may never be observed — we
// always return ok: true unless the request itself is malformed.
// cancel_reservation_hold is idempotent (UPDATE … WHERE status IN
// ('active','converting')), so repeated calls are safe.

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
    const payload = (await req.json().catch(() => ({}))) as Payload;
    const holdId = asUuid(payload.hold_id);
    if (!holdId) return jsonResponse({ error: "hold_id is required" }, 400);

    // Resolve auth purely for rate-limit bucketing.
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

    const { error } = await supabaseAdmin.rpc("cancel_reservation_hold", {
      p_hold_id: holdId,
    });

    if (error) {
      // Log but still return ok: true — beacon callers can't react,
      // and the cleanup cron will expire orphaned holds anyway.
      console.warn("[cancel-reservation-hold] rpc error:", error.message);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
