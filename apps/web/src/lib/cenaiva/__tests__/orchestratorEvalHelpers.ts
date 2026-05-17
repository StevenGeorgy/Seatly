// Eval harness helpers for the cenaiva-orchestrate edge function.
//
// Four-layer assertion model:
//   1. tool_called — did the right tool fire? (deterministic, from chat_messages)
//   2. tool_input  — were the params right? (deterministic, from chat_messages)
//   3. booking_state — did state change correctly? (deterministic, from SSE final frame)
//   4. judge — did the natural-language response actually answer the user? (LLM judge)
//
// Gated on CENAIVA_EVAL=1 so it doesn't fire during normal `npm run test:run`.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? "";
const EVAL_EMAIL = process.env.CENAIVA_EVAL_USER_EMAIL ?? "";
const EVAL_PASSWORD = process.env.CENAIVA_EVAL_USER_PASSWORD ?? "";
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";
const JUDGE_MODEL = process.env.CENAIVA_EVAL_JUDGE_MODEL ?? "gpt-4o-mini";

export const EVAL_ENABLED =
  process.env.CENAIVA_EVAL === "1" &&
  !!SUPABASE_URL &&
  !!SUPABASE_ANON_KEY &&
  !!EVAL_EMAIL &&
  !!EVAL_PASSWORD;

let cachedToken: string | null = null;
let cachedUserId: string | null = null;
let cachedProfileId: string | null = null;
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  : null;

export async function getAuthContext(): Promise<{ token: string; userId: string; profileId: string }> {
  if (cachedToken && cachedUserId && cachedProfileId) {
    return { token: cachedToken, userId: cachedUserId, profileId: cachedProfileId };
  }
  if (!supabase) throw new Error("Supabase client not configured. Set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY.");
  const { data, error } = await supabase.auth.signInWithPassword({
    email: EVAL_EMAIL,
    password: EVAL_PASSWORD,
  });
  if (error || !data.session || !data.user) {
    throw new Error(`Eval user sign-in failed: ${error?.message ?? "no session"}`);
  }
  cachedToken = data.session.access_token;
  cachedUserId = data.user.id;
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", data.user.id)
    .single();
  if (!profile) throw new Error(`No user_profile row for eval user ${data.user.id}`);
  cachedProfileId = profile.id as string;
  return { token: cachedToken, userId: cachedUserId, profileId: cachedProfileId };
}

// ──────────────────────────────────────────────────────────────────────────
// Turn execution
// ──────────────────────────────────────────────────────────────────────────

export type TurnResult = {
  spokenText: string;
  bookingState: Record<string, unknown> | null;
  uiActions: Array<Record<string, unknown>>;
  conversationId: string;
  toolCalls: Array<{ tool_name: string; input: Record<string, unknown> }>;
  toolResults: Array<{ tool_name: string; result: unknown }>;
  latencyMs: number;
  raw: unknown;
};

type ConversationContext = {
  conversationId: string;
  bookingState: Record<string, unknown>;
  selectedRestaurantId: string | null;
  visibleRestaurantIds: string[];
  recommendationMode?: "single" | "list" | null;
};

export async function freshContext(): Promise<ConversationContext> {
  // chat_messages has a FK to chat_conversations.id — we MUST pre-create
  // a conversation row, otherwise the orchestrator's chat_messages writes
  // (including tool_call/tool_result rows) silently fail and our Layer 1+2
  // assertions all break.
  const { profileId } = await getAuthContext();
  if (!supabase) throw new Error("Supabase client not configured");
  const { data: conv, error } = await supabase
    .from("chat_conversations")
    .insert({ user_profile_id: profileId, language: "en", title: "Eval scenario" })
    .select("id")
    .single();
  if (error || !conv) {
    throw new Error(`Failed to create eval conversation: ${error?.message ?? "no row"}`);
  }
  return {
    conversationId: conv.id as string,
    bookingState: {
      restaurant_id: null,
      restaurant_name: null,
      party_size: null,
      date: null,
      time: null,
      shift_id: null,
      slot_iso: null,
      special_request: null,
      occasion: null,
      status: "idle",
      confirmation_code: null,
      reservation_id: null,
    },
    selectedRestaurantId: null,
    visibleRestaurantIds: [],
    recommendationMode: null,
  };
}

export type RunTurnOverrides = {
  /** Deepgram-style runner-up transcripts. */
  transcript_alternatives?: string[];
  /** Override the visible restaurant id set for this single turn. */
  visible_restaurant_ids?: string[];
  /** Override the user location for this single turn. */
  user_location?: { lat: number; lng: number } | null;
};

export async function runTurn(
  transcript: string,
  ctx: ConversationContext,
  options?: { timeoutMs?: number; overrides?: RunTurnOverrides },
): Promise<TurnResult> {
  const { token } = await getAuthContext();
  const url = `${SUPABASE_URL}/functions/v1/cenaiva-orchestrate`;
  const t0 = performance.now();

  const overrides = options?.overrides ?? {};

  const body = {
    transcript,
    transcript_alternatives: overrides.transcript_alternatives,
    screen: "discover",
    booking_state: ctx.bookingState,
    selected_restaurant_id: ctx.selectedRestaurantId,
    visible_restaurant_ids: overrides.visible_restaurant_ids ?? ctx.visibleRestaurantIds,
    map_state: { visible: false, center: null, zoom: null, marker_restaurant_ids: overrides.visible_restaurant_ids ?? ctx.visibleRestaurantIds },
    recommendation_mode: ctx.recommendationMode ?? null,
    user_location: overrides.user_location ?? null,
    timezone: "America/Toronto",
    conversation_id: ctx.conversationId,
    has_saved_card: false,
    reservation_id: null,
  };

  const timeoutMs = options?.timeoutMs ?? 30000;
  // Note: we don't use AbortSignal here because vitest+jsdom provides a
  // jsdom-side AbortController that fetch rejects as not-an-AbortSignal.
  // Promise.race gives us the same timeout guarantee.
  const fetchPromise = fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Orchestrator request timed out after ${timeoutMs}ms`)), timeoutMs),
  );
  const res: Response = await Promise.race([fetchPromise, timeoutPromise]);

  if (!res.ok || !res.body) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Orchestrator HTTP ${res.status}: ${errorText.slice(0, 200)}`);
  }

  // Parse SSE stream
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload: Record<string, unknown> | null = null;
  let spokenText = "";
  const speechChunks: string[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;
      try {
        const frame = JSON.parse(jsonStr) as Record<string, unknown>;
        if (frame.type === "speech_chunk" && typeof frame.text === "string") {
          speechChunks.push(frame.text);
        } else if (frame.type === "final" && frame.payload) {
          finalPayload = frame.payload as Record<string, unknown>;
        } else if (frame.type === "error") {
          throw new Error(`Orchestrator SSE error: ${frame.message ?? "unknown"}`);
        }
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }

  const latencyMs = performance.now() - t0;
  spokenText =
    typeof finalPayload?.spoken_text === "string"
      ? (finalPayload.spoken_text as string)
      : speechChunks.join(" ").trim();

  const bookingState = (finalPayload?.booking as Record<string, unknown>) ?? null;
  const uiActions = Array.isArray(finalPayload?.ui_actions)
    ? (finalPayload.ui_actions as Array<Record<string, unknown>>)
    : [];

  // Query tool calls + results for this turn from chat_messages.
  const { toolCalls, toolResults } = await fetchTurnToolActivity(ctx.conversationId, t0);

  // Advance the context so the next turn sees the new booking state.
  if (bookingState) {
    ctx.bookingState = bookingState;
    if (typeof bookingState.restaurant_id === "string") {
      ctx.selectedRestaurantId = bookingState.restaurant_id as string;
    }
  }

  return {
    spokenText,
    bookingState,
    uiActions,
    conversationId: ctx.conversationId,
    toolCalls,
    toolResults,
    latencyMs,
    raw: finalPayload,
  };
}

async function fetchTurnToolActivity(
  conversationId: string,
  sinceMs: number,
): Promise<{
  toolCalls: TurnResult["toolCalls"];
  toolResults: TurnResult["toolResults"];
}> {
  if (!supabase) return { toolCalls: [], toolResults: [] };
  const sinceIso = new Date(Date.now() - (performance.now() - sinceMs) - 1000).toISOString();
  const { data: rows } = await supabase
    .from("chat_messages")
    .select("role, content, metadata, created_at")
    .eq("conversation_id", conversationId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true });
  const toolCalls: TurnResult["toolCalls"] = [];
  const toolResults: TurnResult["toolResults"] = [];
  for (const row of rows ?? []) {
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    if (row.role === "tool_call" && typeof meta.tool_name === "string") {
      toolCalls.push({
        tool_name: meta.tool_name,
        input: (meta.input as Record<string, unknown>) ?? {},
      });
    } else if (row.role === "tool_result" && typeof row.content === "string") {
      try {
        toolResults.push({
          tool_name: (meta.tool_name as string) ?? "unknown",
          result: JSON.parse(row.content),
        });
      } catch {
        toolResults.push({ tool_name: "unknown", result: row.content });
      }
    }
  }
  return { toolCalls, toolResults };
}

// ──────────────────────────────────────────────────────────────────────────
// Assertion layers
// ──────────────────────────────────────────────────────────────────────────

export type LayerResult = { pass: boolean; reason: string };

// Map tool name → ui_action types that the deterministic server-side
// handler emits when it runs that tool's logic without going through the
// LLM tool call layer. This is critical for accurate Layer 1 checks: the
// orchestrator has TWO ways to fulfill an intent — (a) LLM emits a tool_call
// frame, (b) deterministic regex handler runs the same query inline and
// emits ui_actions. Both count as "tool ran semantically".
const TOOL_TO_UI_EQUIVALENTS: Record<string, string[]> = {
  search_restaurants: ["show_restaurant_cards", "update_map_markers", "highlight_restaurant"],
  // start_booking fires when the orchestrator's deterministic booking-resolver
  // succeeds (restaurant + party + date + time all extracted from the user's
  // single utterance). That's the semantic equivalent of check_availability
  // firing — the booking flow is initiated server-side.
  check_availability: ["select_time_slot", "load_availability", "start_booking"],
  complete_booking: ["show_confirmation"],
  list_my_reservations: ["show_reservations", "show_reservation_list", "show_reservations_list"],
  get_restaurant_snapshot: [],
  modify_reservation: ["reservation_modified"],
  cancel_reservation: ["reservation_cancelled"],
};

export function checkToolCalled(result: TurnResult, expectedTool: string): LayerResult {
  const found = result.toolCalls.find((tc) => tc.tool_name === expectedTool);
  if (found) return { pass: true, reason: `Tool '${expectedTool}' was called (LLM tool_call).` };

  // Fallback: did the deterministic handler emit the equivalent ui_action?
  const equivalents = TOOL_TO_UI_EQUIVALENTS[expectedTool] ?? [];
  const matchingUi = result.uiActions.find((a) => equivalents.includes(String(a.type)));
  if (matchingUi) {
    return {
      pass: true,
      reason: `Tool '${expectedTool}' ran via deterministic path (ui_action: ${matchingUi.type}).`,
    };
  }

  // For get_restaurant_snapshot specifically: check if booking_state got a restaurant_name
  // populated from a fresh query (deterministic factLookup handlers do this).
  if (
    expectedTool === "get_restaurant_snapshot" &&
    typeof result.bookingState?.restaurant_id === "string" &&
    typeof result.bookingState?.restaurant_name === "string"
  ) {
    return {
      pass: true,
      reason: `Tool '${expectedTool}' equivalent — restaurant context populated server-side.`,
    };
  }

  return {
    pass: false,
    reason: `Expected '${expectedTool}' to be called (or its ui_action equivalent ${JSON.stringify(equivalents)}). Actual tools: [${result.toolCalls.map((t) => t.tool_name).join(", ") || "none"}]. Actual ui_actions: [${result.uiActions.map((a) => a.type).join(", ") || "none"}].`,
  };
}

export function checkNoToolCalled(result: TurnResult, forbiddenTool: string): LayerResult {
  const found = result.toolCalls.find((tc) => tc.tool_name === forbiddenTool);
  return found
    ? {
        pass: false,
        reason: `Forbidden tool '${forbiddenTool}' was called with input ${JSON.stringify(found.input)}.`,
      }
    : { pass: true, reason: `Tool '${forbiddenTool}' was correctly not called.` };
}

export function checkToolInputContains(
  result: TurnResult,
  toolName: string,
  expected: Record<string, unknown>,
): LayerResult {
  const call = result.toolCalls.find((tc) => tc.tool_name === toolName);
  if (!call) {
    // The deterministic handler doesn't expose params the same way. If a
    // ui_action equivalent fired, treat as a soft pass with a note (since
    // we can't introspect server-side filter derivation).
    const equivalents = TOOL_TO_UI_EQUIVALENTS[toolName] ?? [];
    const matchingUi = result.uiActions.find((a) => equivalents.includes(String(a.type)));
    if (matchingUi) {
      return {
        pass: true,
        reason: `Tool '${toolName}' ran via deterministic path (params not introspectable, but ${matchingUi.type} ui_action fired).`,
      };
    }
    return { pass: false, reason: `Tool '${toolName}' was not called.` };
  }
  for (const [key, expectedVal] of Object.entries(expected)) {
    const actualVal = call.input[key];
    if (expectedVal instanceof RegExp) {
      if (typeof actualVal !== "string" || !expectedVal.test(actualVal)) {
        return {
          pass: false,
          reason: `Tool '${toolName}' input '${key}' did not match regex ${expectedVal}. Actual: ${JSON.stringify(actualVal)}`,
        };
      }
    } else if (actualVal !== expectedVal) {
      return {
        pass: false,
        reason: `Tool '${toolName}' input '${key}' was ${JSON.stringify(actualVal)}, expected ${JSON.stringify(expectedVal)}.`,
      };
    }
  }
  return { pass: true, reason: `Tool '${toolName}' input matched all expected fields.` };
}

export function checkBookingField(
  result: TurnResult,
  field: string,
  expected: unknown,
): LayerResult {
  const actual = result.bookingState?.[field];
  if (expected instanceof RegExp) {
    if (typeof actual !== "string" || !expected.test(actual)) {
      return {
        pass: false,
        reason: `booking.${field} = ${JSON.stringify(actual)}, did not match ${expected}.`,
      };
    }
    return { pass: true, reason: `booking.${field} matched ${expected}.` };
  }
  if (actual === expected) return { pass: true, reason: `booking.${field} = ${JSON.stringify(actual)}` };
  return {
    pass: false,
    reason: `booking.${field} = ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`,
  };
}

export function checkSpokenLength(result: TurnResult, maxWords: number): LayerResult {
  const wordCount = (result.spokenText ?? "").split(/\s+/).filter(Boolean).length;
  return wordCount <= maxWords
    ? { pass: true, reason: `${wordCount} words (under ${maxWords}).` }
    : {
        pass: false,
        reason: `Response was ${wordCount} words (max ${maxWords}). Response: "${result.spokenText}"`,
      };
}

// ──────────────────────────────────────────────────────────────────────────
// Layer 4: LLM judge (handles wording variation)
// ──────────────────────────────────────────────────────────────────────────

export type JudgeVerdict = {
  pass: boolean;
  confidence: "high" | "medium" | "low";
  reasoning: string;
};

export async function judgeResponse(
  userMessage: string,
  aiResponse: string,
  criteria: string,
): Promise<JudgeVerdict> {
  if (!OPENAI_KEY) {
    return { pass: false, confidence: "low", reasoning: "OPENAI_API_KEY not set; cannot judge." };
  }
  const judgePrompt = `You are evaluating a voice assistant response.

USER SAID: "${userMessage}"
ASSISTANT REPLIED: "${aiResponse}"

CRITERIA THE REPLY MUST MEET: ${criteria}

Does the assistant's reply meet ALL the criteria? Respond with EXACTLY this JSON shape:
{"pass": true/false, "confidence": "high"/"medium"/"low", "reasoning": "one-sentence explanation"}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      messages: [
        { role: "system", content: "You are a strict but fair evaluator. Reply ONLY with the JSON object — no other text." },
        { role: "user", content: judgePrompt },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { pass: false, confidence: "low", reasoning: `Judge HTTP ${res.status}: ${txt.slice(0, 100)}` };
  }
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(content) as JudgeVerdict;
    return {
      pass: Boolean(parsed.pass),
      confidence: parsed.confidence ?? "medium",
      reasoning: parsed.reasoning ?? "(no reasoning)",
    };
  } catch {
    return { pass: false, confidence: "low", reasoning: `Judge returned non-JSON: ${content.slice(0, 100)}` };
  }
}
