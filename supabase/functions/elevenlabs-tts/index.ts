import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { jsonRes } from "../_shared/json-response.ts";
import { decodeJwtPayload } from "../_shared/jwt.ts";
import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
const DEFAULT_VOICE_ID = Deno.env.get("ELEVENLABS_VOICE_ID") ?? "EXAVITQu4vr4xnSDxMaL";

// Reuse same pronunciation map as useCenaivaSpeech.ts
function applyPronunciation(text: string): string {
  return text
    .replace(/\bCenaiva\b/gi, "sin eye vuh")
    .replace(/\bCENAIVA\b/g, "sin eye vuh");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) {
    return jsonRes({ error: "ElevenLabs not configured" }, 503);
  }

  try {
    // Auth — require valid JWT so this endpoint isn't open to the world
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const payload = decodeJwtPayload(token);
    if (!payload?.sub) return jsonRes({ error: "Unauthorized" }, 401);

    // Lightweight user check + capture profile.id for the rate-limit bucket.
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", payload.sub as string)
      .single();
    if (profileErr || !profile) return jsonRes({ error: "Unauthorized" }, 401);

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
        return jsonRes({ error: e.message, unavailable_reason: "rate_limited" }, 429);
      }
      throw e;
    }

    const body = await req.json() as { text?: string; voice_id?: string };
    const rawText = (body.text ?? "").trim();
    if (!rawText) return jsonRes({ error: "text is required" }, 400);

    const text = applyPronunciation(rawText);
    const voiceId = body.voice_id ?? DEFAULT_VOICE_ID;

    // Call ElevenLabs with one automatic retry on transient failures. Without
    // this, any 5xx / network blip drops us to Web Speech for that single turn,
    // which is the main cause of the "voice randomly changes every few turns"
    // inconsistency reported by users. Stability bumped to 0.5 for more
    // consistent prosody across turns.
    const callEleven = () =>
      fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}/stream`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: { stability: 0.5, similarity_boost: 0.8, speed: 1.1 },
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
      return jsonRes({ error: `ElevenLabs error: ${errText}` }, elRes.status);
    }

    // Stream the MP3 directly back to the client
    return new Response(elRes.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return jsonRes({ error: String(err) }, 500);
  }
});
