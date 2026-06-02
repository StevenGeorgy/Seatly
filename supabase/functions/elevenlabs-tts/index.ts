import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { jsonRes } from "../_shared/json-response.ts";
import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { ElevenLabsTtsSchema } from "../_shared/validation/chat.ts";
import {
  ELEVENLABS_BASE,
  DEFAULT_VOICE_ID as SHARED_DEFAULT_VOICE_ID,
  ELEVENLABS_MODEL,
  DEFAULT_VOICE_SETTINGS,
  DEFAULT_OUTPUT_FORMAT,
} from "../_shared/elevenlabs.ts";

// Consume the SHARED config so this fn can't drift from `cenaiva-small-prompt`
// or the web IDB cache key (`flash25-mp3-44100-128-v1`). Previously this fn
// hardcoded `eleven_turbo_v2_5` with no `output_format`, which fed a variable
// codec into the client's single reused <audio> element → stalls + the
// "voice randomly changes" reports. Env overrides mirror the sibling fn.
const DEFAULT_VOICE_ID = Deno.env.get("ELEVENLABS_VOICE_ID") ?? SHARED_DEFAULT_VOICE_ID;
const TTS_OUTPUT_FORMAT = Deno.env.get("ELEVENLABS_OUTPUT_FORMAT") ?? DEFAULT_OUTPUT_FORMAT;

// Reuse same pronunciation map as useCenaivaSpeech.ts
function applyPronunciation(text: string): string {
  return text
    .replace(/\bCenaiva\b/gi, "sin eye vuh")
    .replace(/\bCENAIVA\b/g, "sin eye vuh");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(req) });
  }

  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) {
    return jsonRes({ error: "ElevenLabs not configured" }, 503, req);
  }

  try {
    // Auth — cryptographically verify the JWT via supabase-js auth.getUser().
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!bearerToken) return jsonRes({ error: "auth_required" }, 401, req);
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(bearerToken);
    if (authError || !user) return jsonRes({ error: "invalid_token" }, 401, req);

    // Lightweight user check + capture profile.id for the rate-limit bucket.
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .single();
    if (profileErr || !profile) return jsonRes({ error: "Unauthorized" }, 401, req);

    // Per-user rate limit. Bumped to 240/min (2026-05-16) because primeCache
    // alone fires ~18 sequential requests per session open to warm IDB. With
    // multi-tab use + real-time TTS chunks (speakQueued), the prior 60/min
    // limit blew up routinely and silently broke voice for the rest of the
    // minute. 240/min handles cache warm + active conversation + safety
    // margin. Real abuse hits this; normal use never comes close.
    try {
      await enforceRateLimit(
        supabaseAdmin,
        "elevenlabs_tts",
        rateLimitIdentifier(req, profile.id),
        { limit: 240, windowSeconds: 60 },
      );
    } catch (e) {
      if (e instanceof RateLimitError) {
        return jsonRes({ error: e.message, unavailable_reason: "rate_limited" }, 429, req);
      }
      throw e;
    }

    const parsed = await parseJsonBody(req, ElevenLabsTtsSchema, {
      jsonRes: (b, s, r) => jsonRes(b, s, r ?? req),
    });
    if ("response" in parsed) return parsed.response;
    const rawText = parsed.data.text.trim();
    if (!rawText) return jsonRes({ error: "text is required" }, 400, req);

    const text = applyPronunciation(rawText);
    const voiceId = parsed.data.voice_id ?? DEFAULT_VOICE_ID;

    // Call ElevenLabs with one automatic retry on transient failures. Without
    // this, any 5xx / network blip drops us to Web Speech for that single turn,
    // which is the main cause of the "voice randomly changes every few turns"
    // inconsistency reported by users. Stability bumped to 0.5 for more
    // consistent prosody across turns.
    const callEleven = () =>
      fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}/stream?output_format=${TTS_OUTPUT_FORMAT}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODEL,
          voice_settings: DEFAULT_VOICE_SETTINGS,
        }),
      });

    let elRes: Response;
    try {
      elRes = await callEleven();
      if (!elRes.ok && elRes.status >= 500) {
        elRes = await callEleven();
      }
    } catch {
      elRes = await callEleven();
    }

    if (!elRes.ok) {
      const errText = await elRes.text();
      return jsonRes({ error: `ElevenLabs error: ${errText}` }, elRes.status, req);
    }

    // Stream the MP3 directly back to the client
    return new Response(elRes.body, {
      status: 200,
      headers: {
        ...buildCorsHeaders(req),
        "Content-Type": "audio/mpeg",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return jsonRes({ error: String(err) }, 500, req);
  }
});
