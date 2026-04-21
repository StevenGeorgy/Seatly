/**
 * Single source of truth for the Vapi assistant we expose to customers.
 *
 * The payload matches Vapi's `POST /assistant` body (see
 * https://docs.vapi.ai/api-reference/assistants/create-assistant). This file
 * is imported by:
 *   - `scripts/sync-vapi-assistant.ts` — creates or updates the assistant at
 *     deploy time and writes its id to `.env` as `VITE_VAPI_ASSISTANT_ID`.
 *   - Unit tests (future) that validate the shape against Vapi's schema.
 *
 * IMPORTANT: changing anything here requires re-running the sync script so the
 * Vapi control-plane reflects the update.
 */

export interface VapiAssistantConfigInput {
  supabaseUrl: string;
  supabaseAnonKey: string;
  elevenLabsVoiceId: string;
  elevenLabsModelId?: string;
}

export function buildCenaivaAssistantConfig(input: VapiAssistantConfigInput) {
  const {
    supabaseUrl,
    supabaseAnonKey,
    elevenLabsVoiceId,
    elevenLabsModelId = "eleven_turbo_v2_5",
  } = input;

  return {
    name: "Cenaiva",
    // Vapi will play this verbatim the moment the call connects — no LLM
    // round-trip. `{{firstName}}` is substituted from `assistantOverrides.variableValues`
    // on vapi.start().
    firstMessage: "Hey, {{firstName}}! How can I help?",
    firstMessageMode: "assistant-speaks-first",

    // Our Supabase edge function plays the role Vapi normally gives to
    // OpenAI — it exposes an OpenAI-compatible /chat/completions endpoint
    // that proxies to cenaiva-orchestrate and streams SSE chunks back.
    model: {
      provider: "custom-llm",
      url: `${supabaseUrl}/functions/v1/cenaiva-orchestrate-vapi`,
      model: "gpt-5.4-mini",
      // Bearer token Vapi attaches on every call to the custom-llm URL. We
      // use the anon key so the edge function sees a signed Supabase request;
      // the user's actual JWT flows through `assistantOverrides.variableValues.access_token`
      // so the proxy can forward it to cenaiva-orchestrate (which requires
      // auth to look up the user's profile).
      authorizationHeaders: {
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      messages: [
        {
          role: "system",
          content:
            "You are Cenaiva, a voice-first restaurant-booking assistant for Seatly. " +
            "Your replies come from a custom backend; never hallucinate restaurants, " +
            "times, or prices — always rely on tool output from the backend. Keep " +
            "every response under 20 spoken words. Never say 'Sure!', 'Great!', or " +
            "'Of course!'. Ask at most one question per turn.",
        },
      ],
    },

    voice: {
      provider: "11labs",
      voiceId: elevenLabsVoiceId,
      model: elevenLabsModelId,
      // 3 is the documented sweet spot for Turbo v2.5 — lowest first-byte
      // latency without audibly chopping long words.
      optimizeStreamingLatency: 3,
      stability: 0.5,
      similarityBoost: 0.8,
    },

    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: "en-CA",
      smartFormat: true,
    },

    // Launch polish
    backgroundSound: "off",
    backchannelingEnabled: true,          // "mhm" while user talks = feels human
    backgroundDenoisingEnabled: true,
    silenceTimeoutSeconds: 15,
    maxDurationSeconds: 600,
    // Let users barge in over the assistant; Vapi handles the duck internally.
    modelOutputInMessagesEnabled: true,

    // The React shell is the source of truth for UI — so we purposely DON'T
    // wire a tool-webhook server url here. All tool execution happens inside
    // cenaiva-orchestrate (proxied via cenaiva-orchestrate-vapi) and is
    // surfaced to the client through the synthetic `apply_ui_response` tool
    // call embedded in the assistant's reply.
  };
}

export const CENAIVA_ASSISTANT_NAME = "Cenaiva";
