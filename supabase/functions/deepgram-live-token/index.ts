import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { jsonRes } from "../_shared/json-response.ts";
import { decodeJwtPayload } from "../_shared/jwt.ts";
import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";

// Deepgram's /v1/auth/grant endpoint mints short-lived tokens (30s TTL) that
// are safe to hand to the browser — unlike the long-lived project API key,
// which must never leave the edge. The browser uses the token in the
// `Sec-WebSocket-Protocol: token, <jwt>` header to authenticate against the
// streaming Listen endpoint.
const DEEPGRAM_TOKEN_ENDPOINT = "https://api.deepgram.com/v1/auth/grant";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const apiKey = Deno.env.get("DEEPGRAM_API_KEY");
  if (!apiKey) {
    return jsonRes({ error: "Deepgram not configured" }, 503);
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const payload = decodeJwtPayload(token);
    if (!payload?.sub) {
      console.warn("[deepgram-live-token] JWT decode failed or missing sub");
      return jsonRes({ error: "Unauthorized", reason: "jwt_decode" }, 401);
    }

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", payload.sub as string)
      .single();
    if (profileErr || !profile) {
      console.warn("[deepgram-live-token] profile lookup failed for sub:", payload.sub, profileErr?.message);
      return jsonRes({ error: "Unauthorized", reason: "profile_lookup" }, 401);
    }

    // Per-user rate limit. Tokens are TTL-cached client-side (~30s), so real
    // usage is far below 60/min. 60 is a safety net for a stuck recognizer or
    // a client that loses its cache.
    try {
      await enforceRateLimit(
        supabaseAdmin,
        "deepgram_live_token",
        rateLimitIdentifier(req, profile.id),
        { limit: 60, windowSeconds: 60 },
      );
    } catch (e) {
      if (e instanceof RateLimitError) {
        return jsonRes({ error: e.message, unavailable_reason: "rate_limited" }, 429);
      }
      throw e;
    }

    const dgRes = await fetch(DEEPGRAM_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: 30 }),
    });

    if (!dgRes.ok) {
      const errText = await dgRes.text();
      console.error("[deepgram-live-token] grant failed:", dgRes.status, errText);
      return jsonRes({ error: "Failed to mint Deepgram token" }, 502);
    }

    const dgJson = await dgRes.json() as { access_token?: string; expires_in?: number };
    if (!dgJson.access_token) {
      return jsonRes({ error: "Malformed Deepgram response" }, 502);
    }

    return jsonRes({
      access_token: dgJson.access_token,
      expires_in: dgJson.expires_in ?? 30,
    });
  } catch (err) {
    console.error("[deepgram-live-token] error:", err);
    return jsonRes({ error: String(err) }, 500);
  }
});
