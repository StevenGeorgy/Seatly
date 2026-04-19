import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import OpenAI from "npm:openai@4";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { jsonRes } from "../_shared/json-response.ts";
import { decodeJwtPayload } from "../_shared/jwt.ts";
import { getAvailability } from "../_shared/availability.ts";
import { completeBooking, patchPostBooking } from "../_shared/booking.ts";

const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });

// ── JSON schema for structured output ────────────────────────────────────────
// OpenAI strict JSON schema — must match @cenaiva/assistant AssistantResponse.
// We define it inline to avoid bundling the zod package in Deno.

const UI_ACTION_TYPES = [
  "open_assistant","close_assistant","show_map","update_map_center",
  "update_map_markers","highlight_restaurant","show_restaurant_cards",
  "open_restaurant_preview","set_filters","clear_filters","start_booking",
  "set_booking_field","load_availability","select_time_slot","confirm_booking",
  "show_confirmation","show_post_booking_questions","show_exit_x",
  "toast","navigate","fallback_to_manual",
];

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    conversation_id: { type: "string" },
    spoken_text: { type: "string" },
    intent: {
      type: "string",
      enum: [
        "discover_restaurants","book_restaurant","refine_search","select_restaurant",
        "choose_party_size","choose_date","choose_time","confirm_booking",
        "ask_post_booking_details","answer_restaurant_question","fallback_handoff",
      ],
    },
    step: {
      type: "string",
      enum: [
        "greeting","choose_cuisine","choose_location","choose_restaurant",
        "choose_party","choose_date","choose_time","confirm","post_booking","done",
      ],
    },
    ui_actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: UI_ACTION_TYPES },
          // Flexible extra fields — OpenAI strict mode requires additionalProperties:false
          // so we use a union via oneOf approach; instead we use a permissive approach:
          restaurant_id: { type: "string" },
          restaurant_ids: { type: "array", items: { type: "string" } },
          lat: { type: "number" },
          lng: { type: "number" },
          zoom: { type: "number" },
          slot_iso: { type: "string" },
          shift_id: { type: "string" },
          field: { type: "string" },
          value: {},
          message: { type: "string" },
          tone: { type: "string", enum: ["info","success","error"] },
          path: { type: "string" },
          confirmation_code: { type: "string" },
        },
        required: ["type"],
        additionalProperties: false,
      },
    },
    booking: {
      anyOf: [
        {
          type: "object",
          properties: {
            restaurant_id: { type: ["string","null"] },
            restaurant_name: { type: ["string","null"] },
            party_size: { type: ["number","null"] },
            date: { type: ["string","null"] },
            time: { type: ["string","null"] },
            shift_id: { type: ["string","null"] },
            slot_iso: { type: ["string","null"] },
            special_request: { type: ["string","null"] },
            occasion: { type: ["string","null"] },
            status: {
              type: "string",
              enum: [
                "idle","collecting_minimum_fields","loading_availability",
                "awaiting_time_selection","confirming","confirmed","post_booking",
              ],
            },
            confirmation_code: { type: ["string","null"] },
            reservation_id: { type: ["string","null"] },
          },
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    map: {
      anyOf: [
        {
          type: "object",
          properties: {
            visible: { type: "boolean" },
            center: {
              anyOf: [
                {
                  type: "object",
                  properties: { lat: { type: "number" }, lng: { type: "number" } },
                  required: ["lat","lng"],
                  additionalProperties: false,
                },
                { type: "null" },
              ],
            },
            zoom: { type: "number" },
            marker_restaurant_ids: { type: "array", items: { type: "string" } },
            highlighted_restaurant_id: { type: ["string","null"] },
          },
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    filters: {
      anyOf: [
        {
          type: "object",
          properties: {
            cuisine: { type: "array", items: { type: "string" } },
            city: { type: "string" },
            query: { type: "string" },
          },
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    next_expected_input: {
      type: "string",
      enum: [
        "cuisine","location","restaurant","party_size","date","time",
        "confirmation","post_booking_answer","none",
      ],
    },
  },
  required: [
    "conversation_id","spoken_text","intent","step",
    "ui_actions","booking","map","filters","next_expected_input",
  ],
  additionalProperties: false,
};

// ── Tools available to the orchestrator ──────────────────────────────────────

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_restaurants",
      description:
        "Search restaurants on Cenaiva. Call with no params to show all. Add cuisine_type/city/query only when the user specifies. Never pass 'near me' as query — use city from context.",
      parameters: {
        type: "object",
        properties: {
          cuisine_type: { type: "string", description: "e.g. Italian, Japanese" },
          city: { type: "string" },
          query: { type: "string", description: "Free-text name search" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Get available time slots for a restaurant on a given date for a party size.",
      parameters: {
        type: "object",
        properties: {
          restaurant_id: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
          party_size: { type: "number" },
        },
        required: ["restaurant_id","date","party_size"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_booking",
      description:
        "Create a confirmed dine-in reservation. Call only after date_time, shift_id, and party_size are all known.",
      parameters: {
        type: "object",
        properties: {
          restaurant_id: { type: "string" },
          shift_id: { type: "string" },
          party_size: { type: "number" },
          date_time: { type: "string", description: "UTC ISO from check_availability slot" },
          special_request: { type: "string" },
          occasion: { type: "string" },
          seating_preference: { type: "string" },
        },
        required: ["restaurant_id","shift_id","party_size","date_time"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "patch_post_booking",
      description: "Update post-booking details (special_request, occasion, seating_preference) after confirmation.",
      parameters: {
        type: "object",
        properties: {
          reservation_id: { type: "string" },
          guest_id: { type: "string" },
          special_request: { type: "string" },
          occasion: { type: "string" },
          seating_preference: { type: "string" },
        },
        required: ["reservation_id","guest_id"],
        additionalProperties: false,
      },
    },
  },
];

// ── Nominatim city lookup (same pattern as cenaiva-chat) ─────────────────────

async function resolveCity(lat: number, lng: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10`;
    const res = await fetch(url, { headers: { "User-Agent": "Seatly/1.0 (seatly.app)" } });
    if (!res.ok) return "";
    const data = await res.json() as { address?: Record<string, string> };
    const a = data.address ?? {};
    return a.city ?? a.town ?? a.municipality ?? a.village ?? a.suburb ?? "";
  } catch {
    return "";
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(opts: {
  userName: string;
  userCity: string;
  now: string;
  bookingState: Record<string, unknown>;
  currentScreen: string;
}) {
  return `You are Cenaiva, a voice-first dining and reservation assistant embedded in the Cenaiva app.
Today: ${opts.now}. User city: ${opts.userCity || "unknown"}. Screen: ${opts.currentScreen}.
User name: ${opts.userName}.

Current booking state: ${JSON.stringify(opts.bookingState)}.

RULES — follow exactly:
1. spoken_text max 20 words. Direct. No filler. No "Sure!" or "Of course!".
2. Never ask two questions in one turn.
3. If you have enough information to act, emit ui_actions instead of asking.
4. Booking priority: cuisine → location → restaurant → party_size → date → time → confirm.
5. Never ask special_request/occasion/dietary BEFORE confirm step.
6. After confirm, emit show_confirmation + show_exit_x + show_post_booking_questions.
7. Always include a conversation_id in every response (echo the one provided, or generate a uuid if none).
8. Use search_restaurants then emit update_map_markers + show_restaurant_cards ui_actions.
9. Use check_availability then offer slots; user pick triggers select_time_slot + set_booking_field.
10. Use complete_booking only when restaurant_id, shift_id, party_size, and date_time are all confirmed.
11. spoken_text must be natural short speech — the user hears it via text-to-speech.
12. You ONLY help with restaurant discovery and dining reservations. Politely decline anything else.`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const payload = decodeJwtPayload(token);
    if (!payload?.sub) return jsonRes({ error: "Unauthorized" }, 401);

    const { data: userProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("id, full_name, email")
      .eq("auth_user_id", payload.sub as string)
      .single();
    if (!userProfile) return jsonRes({ error: "User profile not found" }, 401);

    const userProfileId: string = userProfile.id;

    // Parse body
    const body = await req.json() as {
      transcript?: string;
      screen?: string;
      booking_state?: Record<string, unknown>;
      map_state?: Record<string, unknown>;
      filters?: Record<string, unknown>;
      visible_restaurant_ids?: string[];
      selected_restaurant_id?: string | null;
      user_location?: { lat: number; lng: number } | null;
      conversation_id?: string;
    };

    const {
      transcript = "",
      screen = "discover",
      booking_state = {},
      map_state = {},
      visible_restaurant_ids = [],
      selected_restaurant_id = null,
      user_location = null,
      conversation_id: incomingConvId,
    } = body;

    // Resolve city from geolocation
    const userCity = user_location
      ? await resolveCity(user_location.lat, user_location.lng)
      : "";

    // Conversation persistence — reuse chat_conversations + chat_messages tables
    // with metadata.kind = "orchestrator" to separate from legacy typed chat.
    let conversationId = incomingConvId;
    if (!conversationId) {
      const { data: conv } = await supabaseAdmin
        .from("chat_conversations")
        .insert({ user_profile_id: userProfileId, language: "en", title: "Voice booking" })
        .select("id")
        .single();
      conversationId = conv?.id ?? crypto.randomUUID();
    }

    // Load last 10 messages for context
    const { data: history } = await supabaseAdmin
      .from("chat_messages")
      .select("role, content, metadata")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(10);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    // Build messages from history (oldest first)
    for (const msg of (history ?? []).reverse()) {
      if (msg.role === "user") {
        messages.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        messages.push({ role: "assistant", content: msg.content });
      } else if (msg.role === "tool_call") {
        const meta = msg.metadata as any;
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [{
            id: meta.tool_use_id,
            type: "function",
            function: { name: meta.tool_name, arguments: JSON.stringify(meta.input) },
          }],
        });
      } else if (msg.role === "tool_result") {
        const meta = msg.metadata as any;
        messages.push({
          role: "tool",
          tool_call_id: meta.tool_use_id,
          content: msg.content,
        });
      }
    }

    // Append current user turn with rich context
    const userContent = [
      transcript ? `User said: "${transcript}"` : "User opened the assistant.",
      selected_restaurant_id ? `Selected restaurant ID: ${selected_restaurant_id}` : "",
      visible_restaurant_ids.length
        ? `Visible restaurant IDs on map: ${visible_restaurant_ids.slice(0, 8).join(", ")}`
        : "",
    ].filter(Boolean).join("\n");

    messages.push({ role: "user", content: userContent });

    // Persist user message
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId,
      role: "user",
      content: userContent,
      metadata: { kind: "orchestrator" },
    });

    // Build system prompt
    const now = new Date().toISOString();
    const systemPrompt = buildSystemPrompt({
      userName: userProfile.full_name ?? "there",
      userCity,
      now,
      bookingState: booking_state,
      currentScreen: screen,
    });

    // ── Tool-use loop ─────────────────────────────────────────────────────────
    const MAX_ITER = 4; // tighter budget for the orchestrator
    let iterations = 0;
    let finalResponse: string | null = null;
    let lastGuestId: string | null = null;
    let lastReservationId: string | null = null;

    while (iterations < MAX_ITER) {
      iterations++;

      const completion = await openai.chat.completions.create({
        model: "gpt-5.4-mini",
        max_tokens: 600,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools: TOOLS,
        tool_choice: "auto",
        // JSON schema response format is applied ONLY when there are no tool calls pending.
        // We switch to it on the final turn via a second call below.
      });

      const choice = completion.choices[0];

      if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
        messages.push(choice.message as OpenAI.Chat.ChatCompletionMessageParam);

        for (const tc of choice.message.tool_calls) {
          const toolName = tc.function.name;
          const toolInput = JSON.parse(tc.function.arguments);

          let toolResult = "";

          if (toolName === "search_restaurants") {
            let query = supabaseAdmin
              .from("restaurants")
              .select("id, name, cuisine_type, city, description, address, lat, lng")
              .eq("is_active", true)
              .limit(8);
            if (toolInput.cuisine_type) query = query.ilike("cuisine_type", `%${toolInput.cuisine_type}%`);
            if (toolInput.city) query = query.ilike("city", `%${toolInput.city}%`);
            if (toolInput.query) {
              const words = toolInput.query.trim().split(/\s+/).filter((w: string) => w.length > 1);
              if (words.length) {
                const conditions = words
                  .map((w: string) => `name.ilike.%${w}%,cuisine_type.ilike.%${w}%,city.ilike.%${w}%`)
                  .join(",");
                query = query.or(conditions);
              }
            }
            const { data, error } = await query;
            toolResult = error
              ? JSON.stringify({ error: error.message })
              : JSON.stringify(data ?? []);
          } else if (toolName === "check_availability") {
            const result = await getAvailability(
              toolInput.restaurant_id,
              toolInput.date,
              toolInput.party_size,
            );
            toolResult = JSON.stringify(result);
          } else if (toolName === "complete_booking") {
            const result = await completeBooking({
              user_profile_id: userProfileId,
              restaurant_id: toolInput.restaurant_id,
              order_type: "dine_in",
              date_time: toolInput.date_time,
              shift_id: toolInput.shift_id,
              party_size: toolInput.party_size,
              special_request: toolInput.special_request,
              occasion: toolInput.occasion,
              seating_preference: toolInput.seating_preference,
            });
            if (result.reservation_id) lastReservationId = result.reservation_id;
            toolResult = JSON.stringify(result);
          } else if (toolName === "patch_post_booking") {
            await patchPostBooking(
              toolInput.reservation_id,
              toolInput.guest_id,
              {
                special_request: toolInput.special_request,
                occasion: toolInput.occasion,
                seating_preference: toolInput.seating_preference,
              },
            );
            toolResult = JSON.stringify({ success: true });
          }

          // Persist tool call + result
          await supabaseAdmin.from("chat_messages").insert([
            {
              conversation_id: conversationId,
              role: "tool_call",
              content: toolInput,
              metadata: { kind: "orchestrator", tool_use_id: tc.id, tool_name: toolName, input: toolInput },
            },
            {
              conversation_id: conversationId,
              role: "tool_result",
              content: toolResult,
              metadata: { kind: "orchestrator", tool_use_id: tc.id },
            },
          ]);

          messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
        }
      } else {
        // No more tool calls — get the final structured JSON response
        break;
      }
    }

    // ── Final structured JSON turn ────────────────────────────────────────────
    const jsonCompletion = await openai.chat.completions.create({
      model: "gpt-5.4-mini",
      max_tokens: 400,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
        {
          role: "user",
          content: `Now respond with ONLY the JSON object described in the schema. conversation_id must be "${conversationId}".`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "AssistantResponse",
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    });

    const rawJson = jsonCompletion.choices[0].message.content ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      parsed = {
        conversation_id: conversationId,
        spoken_text: "Something went wrong. Please try again.",
        intent: "fallback_handoff",
        step: "greeting",
        ui_actions: [{ type: "fallback_to_manual" }],
        booking: null,
        map: null,
        filters: null,
        next_expected_input: "none",
      };
    }

    // Always enforce conversation_id
    parsed.conversation_id = conversationId;

    // Persist assistant response
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: parsed.spoken_text ?? "",
      metadata: { kind: "orchestrator", full_response: parsed },
    });

    return jsonRes(parsed);
  } catch (err) {
    console.error("cenaiva-orchestrate error:", err);
    return jsonRes({ error: String(err) }, 500);
  }
});
