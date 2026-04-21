/**
 * cenaiva-orchestrate-vapi — thin proxy between Vapi's custom-llm provider and
 * our existing `cenaiva-orchestrate` brain.
 *
 * Vapi's `model.provider="custom-llm"` config calls this endpoint on every turn
 * expecting an OpenAI-compatible `/chat/completions` response (SSE of
 * `chat.completion.chunk` frames when `stream:true`). Rather than duplicate the
 * 1,300-line orchestrator, this function:
 *
 *   1. Parses Vapi's chat-completion request (messages, metadata, tools).
 *   2. Extracts the newest user transcript + a context snapshot that the
 *      frontend stamps into each call via `vapi.send({ metadata: {...} })`
 *      (booking_state, visible_restaurant_ids, selected_restaurant_id,
 *      user_location, conversation_id, has_saved_card, …).
 *   3. Forwards to `cenaiva-orchestrate` using the caller's bearer token.
 *   4. Emits a filler delta ("One sec…") before the upstream call resolves so
 *      ElevenLabs has audio to play during any long-running tool loop — this
 *      is the single biggest perceived-latency win from the reference video.
 *   5. Streams the resulting `spoken_text` back as OpenAI content deltas, and
 *      packs the `ui_actions`/`booking`/`map`/`filters` payload into a trailing
 *      synthetic `tool_calls` chunk. `@vapi-ai/web` surfaces that as a
 *      `function-call` message which the React shell dispatches to the store.
 *
 * The existing `cenaiva-orchestrate` function stays intact and continues to
 * serve the legacy (non-Vapi) path and the keyboard/text sendTranscript flow.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { jsonRes } from "../_shared/json-response.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ORCHESTRATOR_URL = `${SUPABASE_URL}/functions/v1/cenaiva-orchestrate`;

// Tool whose result is always "slow enough" that we should emit a filler line
// up front. Matches the pattern the YouTube reference uses with Vapi's "Say"
// block immediately before a gather/API-request block.
const SLOW_TOOL_FILLERS: Record<string, string> = {
  search_restaurants: "Let me see what's nearby.",
  check_availability: "Checking availability now.",
  complete_booking: "Booking that for you.",
  create_preorder_order: "Putting that order together.",
  charge_saved_card: "Charging your card now.",
};

interface VapiChatRequest {
  model?: string;
  stream?: boolean;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_call_id?: string;
    // Vapi forwards metadata via a custom field on call-start + per-message
    metadata?: Record<string, unknown>;
  }>;
  // Vapi top-level custom object (when config includes `metadata`)
  metadata?: Record<string, unknown>;
  // Extended Vapi body: the `call` object includes `assistantOverrides.variableValues`
  call?: {
    assistantOverrides?: { variableValues?: Record<string, unknown> };
    metadata?: Record<string, unknown>;
  };
}

interface OrchestratorResponse {
  conversation_id?: string;
  spoken_text?: string;
  intent?: string;
  step?: string;
  ui_actions?: unknown[];
  booking?: Record<string, unknown> | null;
  map?: Record<string, unknown> | null;
  filters?: Record<string, unknown> | null;
  next_expected_input?: string;
}

function extractContext(body: VapiChatRequest): Record<string, unknown> {
  // Vapi funnels custom values down several paths depending on how the
  // assistant was configured. Merge the common ones so the client can use
  // whichever is most ergonomic.
  const fromCall = body.call?.assistantOverrides?.variableValues ?? {};
  const fromCallMeta = body.call?.metadata ?? {};
  const fromTop = body.metadata ?? {};
  const lastMsgMeta =
    body.messages?.length
      ? (body.messages[body.messages.length - 1].metadata ?? {})
      : {};
  return { ...fromCall, ...fromCallMeta, ...fromTop, ...lastMsgMeta };
}

function lastUserTranscript(messages: VapiChatRequest["messages"]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string") {
      return m.content.trim();
    }
  }
  return "";
}

function guessFiller(transcript: string): string | null {
  const t = transcript.toLowerCase();
  if (/book|reserv|table|seat|party|tonight|tomorrow|\b\d{1,2}\s*(pm|am)\b/.test(t)) {
    return SLOW_TOOL_FILLERS.check_availability;
  }
  if (/find|restaurant|italian|japanese|sushi|pizza|near|in\s+\w+/.test(t)) {
    return SLOW_TOOL_FILLERS.search_restaurants;
  }
  if (/preorder|order|menu|appetizer|drink/.test(t)) {
    return SLOW_TOOL_FILLERS.create_preorder_order;
  }
  if (/pay|charge|card/.test(t)) {
    return SLOW_TOOL_FILLERS.charge_saved_card;
  }
  return null;
}

// Tokenize into small chunks so Vapi can start TTS before the whole string is
// in hand. We stream word-by-word; ElevenLabs' streaming buffer stitches it.
function chunkText(text: string): string[] {
  const words = text.split(/(\s+)/);
  // Group into 3–4 word pieces — fewer HTTP frames, still streamy.
  const out: string[] = [];
  let buf = "";
  let count = 0;
  for (const w of words) {
    buf += w;
    if (w.trim()) count++;
    if (count >= 3) {
      out.push(buf);
      buf = "";
      count = 0;
    }
  }
  if (buf) out.push(buf);
  return out;
}

function sseFrame(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

function makeChunk(
  id: string,
  created: number,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null = null,
) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonRes({ error: "Method not allowed" }, 405);
  }

  let body: VapiChatRequest;
  try {
    body = (await req.json()) as VapiChatRequest;
  } catch {
    return jsonRes({ error: "Invalid JSON body" }, 400);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return jsonRes({ error: "Unauthorized" }, 401);

  const transcript = lastUserTranscript(body.messages ?? []);
  const ctx = extractContext(body);
  const model = body.model ?? "gpt-5.4-mini";
  const streamRequested = body.stream !== false;

  const orchestratorBody = {
    transcript,
    screen: (ctx.screen as string) ?? "discover",
    booking_state: (ctx.booking_state as Record<string, unknown>) ?? {},
    visible_restaurant_ids: (ctx.visible_restaurant_ids as string[]) ?? [],
    selected_restaurant_id: (ctx.selected_restaurant_id as string | null) ?? null,
    user_location: (ctx.user_location as { lat: number; lng: number } | null) ?? null,
    conversation_id: ctx.conversation_id as string | undefined,
    has_saved_card: Boolean(ctx.has_saved_card),
    guest_id: (ctx.guest_id as string | null) ?? null,
    reservation_id: (ctx.reservation_id as string | null) ?? null,
  };

  // Non-streaming path — Vapi also supports this; emit a single JSON envelope.
  if (!streamRequested) {
    const upstream = await fetch(ORCHESTRATOR_URL, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orchestratorBody),
    });
    const data = (await upstream.json()) as OrchestratorResponse;
    const spoken = data.spoken_text ?? "";
    const actionsEnvelope = JSON.stringify({
      ui_actions: data.ui_actions ?? [],
      booking: data.booking ?? null,
      map: data.map ?? null,
      filters: data.filters ?? null,
      next_expected_input: data.next_expected_input ?? null,
      conversation_id: data.conversation_id ?? null,
    });
    return new Response(
      JSON.stringify({
        id: `cenaiva-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: spoken,
            tool_calls: [{
              id: `call_${Date.now()}`,
              type: "function",
              function: { name: "apply_ui_response", arguments: actionsEnvelope },
            }],
          },
          finish_reason: "tool_calls",
        }],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Streaming path (default). Emit filler immediately, then pipe orchestrator
  // result once it lands. We intentionally fire-and-await the upstream fetch
  // in parallel with the filler so ElevenLabs has something to speak while
  // the orchestrator's tool loop runs.
  const chunkId = `cenaiva-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  const upstreamPromise = fetch(ORCHESTRATOR_URL, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(orchestratorBody),
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Opening role chunk (OpenAI convention).
      controller.enqueue(
        sseFrame(makeChunk(chunkId, created, model, { role: "assistant" })),
      );

      // Filler — played by ElevenLabs while the upstream orchestrator runs.
      const filler = guessFiller(transcript);
      if (filler) {
        controller.enqueue(
          sseFrame(makeChunk(chunkId, created, model, { content: filler + " " })),
        );
      }

      let upstream: Response;
      try {
        upstream = await upstreamPromise;
      } catch (err) {
        controller.enqueue(
          sseFrame(makeChunk(chunkId, created, model, {
            content: "Sorry — connection hiccup. Try once more.",
          }, "stop")),
        );
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
        console.error("[cenaiva-orchestrate-vapi] upstream error", err);
        return;
      }

      if (!upstream.ok) {
        const errText = await upstream.text().catch(() => "");
        console.error("[cenaiva-orchestrate-vapi] upstream non-2xx", upstream.status, errText);
        controller.enqueue(
          sseFrame(makeChunk(chunkId, created, model, {
            content: "Something went wrong. Please try again.",
          }, "stop")),
        );
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
        return;
      }

      const data = (await upstream.json()) as OrchestratorResponse;
      let spoken = (data.spoken_text ?? "").trim();

      // If we already spoke a filler, avoid double-speaking it by trimming a
      // leading duplicate (rare, but Vapi concatenates deltas verbatim).
      if (filler && spoken.toLowerCase().startsWith(filler.toLowerCase())) {
        spoken = spoken.slice(filler.length).trim();
      }

      for (const piece of chunkText(spoken)) {
        controller.enqueue(
          sseFrame(makeChunk(chunkId, created, model, { content: piece })),
        );
      }

      // Trailing tool-call frame carrying the UI envelope. `@vapi-ai/web`
      // exposes this as a `function-call` message that the React shell
      // dispatches via APPLY_RESPONSE.
      const actionsEnvelope = JSON.stringify({
        ui_actions: data.ui_actions ?? [],
        booking: data.booking ?? null,
        map: data.map ?? null,
        filters: data.filters ?? null,
        next_expected_input: data.next_expected_input ?? null,
        conversation_id: data.conversation_id ?? null,
      });
      controller.enqueue(sseFrame(makeChunk(chunkId, created, model, {
        tool_calls: [{
          index: 0,
          id: `call_${crypto.randomUUID()}`,
          type: "function",
          function: { name: "apply_ui_response", arguments: actionsEnvelope },
        }],
      })));

      controller.enqueue(
        sseFrame(makeChunk(chunkId, created, model, {}, "tool_calls")),
      );
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
});
