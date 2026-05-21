import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { jsonRes } from "../_shared/json-response.ts";
import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";

// Deepgram's /v1/auth/grant endpoint mints short-lived tokens (30s TTL) that
// are safe to hand to the browser — unlike the long-lived project API key,
// which must never leave the edge. The browser uses the token in the
// `Sec-WebSocket-Protocol: token, <jwt>` header to authenticate against the
// streaming Listen endpoint.
const DEEPGRAM_TOKEN_ENDPOINT = "https://api.deepgram.com/v1/auth/grant";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(req) });
  }

  const apiKey = Deno.env.get("DEEPGRAM_API_KEY");
  if (!apiKey) {
    return jsonRes({ error: "Deepgram not configured" }, 503, req);
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!bearerToken) {
      console.warn("[deepgram-live-token] missing bearer token");
      return jsonRes({ error: "auth_required" }, 401, req);
    }
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(bearerToken);
    if (authError || !user) {
      console.warn("[deepgram-live-token] invalid token:", authError?.message);
      return jsonRes({ error: "invalid_token" }, 401, req);
    }

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .single();
    if (profileErr || !profile) {
      console.warn("[deepgram-live-token] profile lookup failed for sub:", user.id, profileErr?.message);
      return jsonRes({ error: "Unauthorized", reason: "profile_lookup" }, 401, req);
    }

    // Per-user rate limit. Bumped to 120/min (2026-05-16). Tokens are
    // TTL-cached client-side (~30s), but mic-cycle testing + multi-tab use +
    // dev-server hot-reload can briefly blow the 60/min limit. 120 gives
    // headroom without enabling real abuse.
    try {
      await enforceRateLimit(
        supabaseAdmin,
        "deepgram_live_token",
        rateLimitIdentifier(req, profile.id),
        { limit: 120, windowSeconds: 60 },
      );
    } catch (e) {
      if (e instanceof RateLimitError) {
        return jsonRes({ error: e.message, unavailable_reason: "rate_limited" }, 429, req);
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
      return jsonRes({ error: "Failed to mint Deepgram token" }, 502, req);
    }

    const dgJson = await dgRes.json() as { access_token?: string; expires_in?: number };
    if (!dgJson.access_token) {
      return jsonRes({ error: "Malformed Deepgram response" }, 502, req);
    }

    return jsonRes({
      access_token: dgJson.access_token,
      expires_in: dgJson.expires_in ?? 30,
    }, 200, req);
  } catch (err) {
    console.error("[deepgram-live-token] error:", err);
    return jsonRes({ error: String(err) }, 500, req);
  }
});
