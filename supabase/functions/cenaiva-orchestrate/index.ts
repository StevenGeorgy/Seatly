import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import OpenAI from "npm:openai@4";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { jsonRes } from "../_shared/json-response.ts";
import { decodeJwtPayload } from "../_shared/jwt.ts";
import { getAvailability } from "../_shared/availability.ts";
import { completeBooking, patchPostBooking } from "../_shared/booking.ts";
import { buildDeterministicFollowUp, type VisibleRestaurant } from "./followup.ts";

const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });
const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

// Pre-warm the OpenAI HTTP connection on module init so the first user turn
// after a cold function start doesn't pay the TLS handshake cost. Best-effort
// — failures are silent and never block the function.
(async () => {
  try { await openai.models.list(); } catch { /* noop */ }
})();

// ── SSE response helper ──────────────────────────────────────────────────────
// Streams a sequence of frames to the client as Server-Sent Events.
// Frame shapes used by this function:
//   { type: "speech_chunk", text }       — sentence to synthesize early
//   { type: "discard_pending_speech" }   — drop already-queued chunks
//   { type: "final", payload }           — full structured JSON response
//   { type: "error", message, status? }  — terminal error
type SseSend = (frame: Record<string, unknown>) => void;
function streamSse(handler: (send: SseSend) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send: SseSend = (frame) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        } catch { /* underlying stream gone */ }
      };
      try {
        await handler(send);
      } catch (err) {
        const e = err as { message?: string; stack?: string; status?: number; code?: string };
        console.error("cenaiva-orchestrate error:", e?.message, e?.stack);
        send({
          type: "error",
          message: e?.message ?? String(err),
          status: e?.status ?? 500,
          code: e?.code ?? null,
          kind: e?.status ? `upstream_${e.status}` : "unhandled",
        });
      } finally {
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      }
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
}

// Sentence-boundary chunker. Accumulates streamed LLM tokens and yields
// flushable chunks whenever the buffer ends in terminal punctuation followed
// by whitespace, OR the buffer crosses a soft length threshold (so very long
// sentences still flush in pieces). Returns an empty string when there's
// nothing to flush yet.
function takeSentenceChunk(buffer: string): { chunk: string; remainder: string } {
  if (!buffer) return { chunk: "", remainder: "" };
  // Match through the LAST terminal punctuation that has whitespace after it,
  // so we always flush full sentences when possible.
  const m = buffer.match(/^([\s\S]*?[.!?])(\s+)/);
  if (m) {
    return { chunk: m[1].trim(), remainder: buffer.slice(m[0].length) };
  }
  // Comma-bounded clause flush at >=60 chars — keeps very long replies moving
  // without waiting for the full sentence.
  if (buffer.length >= 60) {
    const c = buffer.match(/^([\s\S]*?,)(\s+)/);
    if (c && c[1].length >= 30) {
      return { chunk: c[1].trim(), remainder: buffer.slice(c[0].length) };
    }
  }
  // Hard length cap: 120 chars without punctuation → flush at the last space.
  if (buffer.length >= 120) {
    const lastSpace = buffer.lastIndexOf(" ", 120);
    if (lastSpace > 30) {
      return { chunk: buffer.slice(0, lastSpace).trim(), remainder: buffer.slice(lastSpace + 1) };
    }
  }
  return { chunk: "", remainder: buffer };
}

// ── UI action types list (kept in sync with @cenaiva/assistant schema) ────────

const UI_ACTION_TYPES = [
  "open_assistant","close_assistant","show_map","update_map_center",
  "update_map_markers","highlight_restaurant","show_restaurant_cards",
  "open_restaurant_preview","set_filters","clear_filters","start_booking",
  "set_booking_field","load_availability","select_time_slot","confirm_booking",
  "show_confirmation","show_post_booking_questions","show_exit_x",
  "toast","navigate","fallback_to_manual",
  // Pre-order actions
  "offer_preorder","show_menu","add_menu_item","remove_menu_item","clear_cart",
  "set_tip_choice","set_tip","set_payment_split","navigate_to_checkout","show_payment_success",
];

// ── Tools ─────────────────────────────────────────────────────────────────────

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_restaurants",
      description:
        "Search dine-in restaurants across ALL cities. Pass ONLY the parameters the user explicitly named. Do NOT default city to the user's detected city — leave city blank unless the user says a specific city like 'in Montreal' / 'Toronto restaurants' / 'near my parents in Calgary'. Pass cuisine_type when user names a cuisine. Pass query for a free-text name or vibe. Never pass 'near me' as query — that is NOT a city and not a name.",
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
      description: "Create a confirmed dine-in reservation. Call only after date_time, shift_id, and party_size are all known.",
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
  {
    type: "function",
    function: {
      name: "get_menu",
      description: "Fetch pre-orderable menu items for a restaurant, grouped by category.",
      parameters: {
        type: "object",
        properties: {
          restaurant_id: { type: "string" },
        },
        required: ["restaurant_id"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_preorder_order",
      description: "Create a pending pre-order linked to the reservation. Returns order_id and subtotal.",
      parameters: {
        type: "object",
        properties: {
          restaurant_id: { type: "string" },
          reservation_id: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                menu_item_id: { type: "string" },
                name: { type: "string" },
                quantity: { type: "number" },
                unit_price: { type: "number" },
              },
              required: ["menu_item_id","name","quantity","unit_price"],
              additionalProperties: false,
            },
          },
        },
        required: ["restaurant_id","reservation_id","items"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "charge_saved_card",
      description: "Charge the user's default saved card for a pre-order. Returns success + total charged.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string" },
          tip_percent: { type: "number", description: "0–100; use 0 if no tip" },
          tip_amount: { type: "number", description: "Dollar amount (alternative to tip_percent)" },
        },
        required: ["order_id"],
        additionalProperties: false,
      },
    },
  },
];

// ── Natural-language booking field parsers ───────────────────────────────────
// Last-resort safety net: if the user clearly said a party size or a date but
// the model forgot to emit set_booking_field, we inject it ourselves so the
// next turn sees the field as SET and stops re-asking.

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12,
  a: 1, solo: 1, myself: 1, single: 1,
  couple: 2, duo: 2, pair: 2,
};

// Strip filler / politeness words so voice replies like "uh, two please" or
// "let's say four thanks" reduce to "two" / "four" — which the bare-number
// regex below can match. Without this, common spoken phrasings fall through
// to the LLM safety-net and (when the LLM also misses the extraction) the
// orchestrator re-asks the same question.
function stripFiller(raw: string): string {
  return raw
    .toLowerCase()
    .replace(
      /\b(uh+|um+|er+|ah+|hmm+|mm+|like|so|well|please|pls|thanks|thank you|thx|actually|maybe|i think|i guess|let'?s say|i'?d say|let me see|sorry|okay|ok|yeah|yep|yes|sure|alright)\b/g,
      " ",
    )
    .replace(/[,.!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Web Speech API regularly mishears spoken digits as homophones — most
// commonly "four" → "for" / "fore", "two" → "to" / "too", "eight" → "ate",
// "one" → "won". When followed by a counting noun ("guests", "people",
// "of us", "adults"), normalize the homophone back to the digit word so
// parsePartySize can extract it. Without this, replies like "for guests
// please" parse to null and the orchestrator loops "How many guests?".
function normalizeSpokenDigits(t: string): string {
  const COUNT_NOUN = "(?:guests?|people|persons?|adults?|pax|of\\s+us)";
  return t
    .replace(new RegExp(`\\b(?:fore?|four)\\s+${COUNT_NOUN}\\b`, "g"), (m) => m.replace(/^\S+/, "four"))
    .replace(new RegExp(`\\b(?:too?|two)\\s+${COUNT_NOUN}\\b`, "g"), (m) => m.replace(/^\S+/, "two"))
    .replace(new RegExp(`\\b(?:ate|eight)\\s+${COUNT_NOUN}\\b`, "g"), (m) => m.replace(/^\S+/, "eight"))
    .replace(new RegExp(`\\b(?:won|one)\\s+${COUNT_NOUN}\\b`, "g"), (m) => m.replace(/^\S+/, "one"))
    .replace(new RegExp(`\\b(?:sicks?|six)\\s+${COUNT_NOUN}\\b`, "g"), (m) => m.replace(/^\S+/, "six"));
}

function parsePartySize(raw: string): number | null {
  const t = normalizeSpokenDigits(stripFiller(raw));
  // "just me" / "solo" / "for one"
  if (/\b(just\s+me|solo|alone|by\s+myself)\b/.test(t)) return 1;
  if (/\b(me\s+and\s+my\s+(wife|husband|partner|boyfriend|girlfriend|friend|kid|date))\b/.test(t)) return 2;
  // "party of N" / "table for N" / "N people" / "N of us"
  const numMatch = t.match(
    /\b(?:party of|table for|for|just|group of|we are|we're|make it)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|couple|duo|pair)\b/,
  );
  if (numMatch) {
    const token = numMatch[1];
    if (/^\d+$/.test(token)) {
      const n = parseInt(token, 10);
      if (n >= 1 && n <= 20) return n;
    }
    const w = NUMBER_WORDS[token];
    if (w) return w;
  }
  // "N people" / "N guests"
  const peopleMatch = t.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(people|guests|adults|pax|persons?|of us)\b/);
  if (peopleMatch) {
    const token = peopleMatch[1];
    if (/^\d+$/.test(token)) {
      const n = parseInt(token, 10);
      if (n >= 1 && n <= 20) return n;
    }
    const w = NUMBER_WORDS[token];
    if (w) return w;
  }
  // Bare "two" / "3" when the assistant just asked party size — last resort.
  const bare = t.trim().match(/^(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/);
  if (bare) {
    const token = bare[1];
    if (/^\d+$/.test(token)) {
      const n = parseInt(token, 10);
      if (n >= 1 && n <= 20) return n;
    }
    const w = NUMBER_WORDS[token];
    if (w) return w;
  }
  return null;
}

function parseDate(raw: string): string | null {
  const t = stripFiller(raw);
  const now = new Date();
  const toISO = (d: Date) => d.toISOString().slice(0, 10);
  if (/\b(today|tonight|this\s+evening)\b/.test(t)) return toISO(now);
  if (/\btomorrow\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return toISO(d);
  }
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  for (let i = 0; i < 7; i++) {
    const re = new RegExp(`\\b(?:this|next|on)?\\s*${weekdays[i]}\\b`);
    if (re.test(t)) {
      const d = new Date(now);
      const diff = (i - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return toISO(d);
    }
  }
  // YYYY-MM-DD literal
  const iso = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  return null;
}

// Parse a free-text time ("9pm", "9 pm", "nine pm", "21:00", "7:30") to a
// 24-hour "HH:MM" string. Returns null when the transcript clearly isn't a
// time. Used to auto-promote a voice reply ("9pm") to a select_time_slot
// emission so the LLM can't get wedged re-asking "what time?" after slots
// have been shown.
const TIME_WORDS: Record<string, number> = {
  twelve: 12, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  noon: 12, midnight: 0,
};

function parseTime(raw: string): string | null {
  const t = stripFiller(raw);
  // "9pm" / "9 pm" / "9:30 pm" / "9:30pm"
  const ampm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const min = ampm[2] ? parseInt(ampm[2], 10) : 0;
    const period = ampm[3].replace(/\./g, "");
    if (period === "pm" && h < 12) h += 12;
    if (period === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23 && min >= 0 && min < 60) {
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
  }
  // "21:00" or "9:30" (24-hour)
  const colon = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (colon) {
    const h = parseInt(colon[1], 10);
    const min = parseInt(colon[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min < 60) {
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
  }
  // "nine pm" / "seven thirty" / "noon" / "midnight"
  const word = t.match(
    /\b(twelve|one|two|three|four|five|six|seven|eight|nine|ten|eleven|noon|midnight)\b\s*(thirty|fifteen|forty.?five|am|pm)?\s*(am|pm)?/,
  );
  if (word) {
    const h0 = TIME_WORDS[word[1]];
    if (h0 != null) {
      let h = h0;
      let min = 0;
      const mid = word[2];
      let period: string | null = word[3] ?? null;
      if (mid === "thirty") min = 30;
      else if (mid === "fifteen") min = 15;
      else if (mid && /forty/.test(mid)) min = 45;
      else if (mid === "am" || mid === "pm") period = mid;
      if (period === "pm" && h < 12) h += 12;
      if (period === "am" && h === 12) h = 0;
      // If no period specified and hour 1–10, assume PM (dinner context).
      if (!period && h >= 1 && h <= 10) h += 12;
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
  }
  // Bare digit + period split: "9 pm" already covered. "9" alone is too
  // ambiguous — only match when paired with a context word.
  const bare = t.match(
    /\b(?:at|around|maybe|like|how about|book)\s+(\d{1,2})\b(?!\s*(?:people|guests|of|year|years))/,
  );
  if (bare) {
    let h = parseInt(bare[1], 10);
    if (h >= 1 && h <= 11) h += 12; // dinner default
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:00`;
  }
  return null;
}

// Convert a slot's display_time ("9:00 PM") back to minutes-from-midnight
// for nearest-slot matching against a parsed user time.
function displayTimeToMinutes(display: string): number | null {
  const m = display.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const period = m[3].toUpperCase();
  if (period === "PM" && h < 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function findNearestSlot(
  slots: Array<{ shift_id: string; date_time: string; display_time: string }>,
  targetHHMM: string,
): { shift_id: string; date_time: string; display_time: string } | null {
  if (!slots.length) return null;
  const [th, tm] = targetHHMM.split(":").map(Number);
  const target = th * 60 + tm;
  let best: typeof slots[number] | null = null;
  let bestDiff = Infinity;
  for (const slot of slots) {
    const sm = displayTimeToMinutes(slot.display_time);
    if (sm == null) continue;
    const diff = Math.abs(sm - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = slot;
    }
  }
  // Reject matches more than 45 minutes off — beyond that the user clearly
  // meant a time we don't offer (and we should not silently substitute).
  if (bestDiff > 45) return null;
  return best;
}

// ── Nominatim city lookup ─────────────────────────────────────────────────────

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
  firstName: string;
  userName: string;
  userCity: string;
  now: string;
  bookingState: Record<string, unknown>;
  currentScreen: string;
  hasSavedCard: boolean;
}) {
  const cart = (opts.bookingState.cart as Array<{ menu_item_id: string; name: string; qty: number; unit_price: number }>) ?? [];
  const cartSummary = cart.length
    ? cart.map((i) => `${i.qty}× ${i.name} @$${i.unit_price}`).join(", ")
    : "empty";

  // Present booking state as an explicit SET/MISSING checklist so the model
  // can't "forget" that a field has already been collected and re-ask for it.
  const bs = opts.bookingState as Record<string, unknown>;
  const fmtField = (label: string, value: unknown) =>
    value == null || value === ""
      ? `  - ${label}: MISSING — ask the user for this.`
      : `  - ${label}: ${JSON.stringify(value)} (SET — DO NOT ask again).`;
  const bookingChecklist = [
    fmtField("restaurant_id", bs.restaurant_id),
    fmtField("party_size", bs.party_size),
    fmtField("date", bs.date),
    fmtField("time", bs.time),
    fmtField("shift_id", bs.shift_id),
    fmtField("slot_iso", bs.slot_iso),
    `  - status: ${JSON.stringify(bs.status ?? "idle")}`,
    `  - reservation_id: ${JSON.stringify(bs.reservation_id ?? null)}`,
    `  - confirmation_code: ${JSON.stringify(bs.confirmation_code ?? null)}`,
  ].join("\n");

  return `You are Cenaiva, a voice-first dine-in table reservation assistant.
Today: ${opts.now}. User: ${opts.userName} (first name: ${opts.firstName}). Screen: ${opts.currentScreen}.
User's detected city (MAP ANCHOR ONLY — not a search filter): ${opts.userCity || "unknown"}.
Has saved card on file: ${opts.hasSavedCard}.

GEOGRAPHY — restaurants exist in many cities nationwide.
- The user's detected city is ONLY for centering the map on startup. It is NOT a search filter.
- Default search is nationwide (pass no city to search_restaurants).
- Pass city to search_restaurants ONLY when the user explicitly names one ("in Montreal", "Toronto restaurants", "places in Calgary", "my parents' town — Edmonton").
- Treat phrases like "out of town", "in another city", "somewhere else" as signals to ask which city they want — then re-run search_restaurants with that city.
- If the user names a city different from their detected city, ALWAYS re-run search_restaurants with the named city — do not refuse or say "I only show local results".

BOOKING STATE (authoritative — trust these values exactly):
${bookingChecklist}
⚠️ FIELD GUARD: Any field above marked "(SET)" is LOCKED. Do NOT ask for it, repeat it, or confirm it in spoken_text.
If restaurant_id + party_size + date are all SET → call check_availability immediately with zero extra questions.
Current cart (${cart.length} items): ${cartSummary}.

PERSPECTIVE — You are the ASSISTANT. You are NEVER the guest.
- NEVER use first-person singular for ordering, eating, or booking. Forbidden phrasings: "I'd like...", "I'll have...", "I want...", "Let's get...", "I'm craving...", "for me".
- ALWAYS speak to the user in second person: "You've added X", "Your table is booked", "Would you like to pre-order?".
- The ONLY valid first-person uses are assistant actions ("Checking availability now.") or clarifications ("Didn't catch that — one more time?").
- Don't parrot the user's phrasing back as your own intent. If they say "I want sushi", you respond "Looking for sushi now." — not "I want sushi too."

Cenaiva handles DINE-IN RESERVATIONS AND PRE-ORDER PAYMENT ONLY.
Natural phrases like "I want food from X", "I feel like X", "I'm craving Italian", "let's grab dinner at X" are DINE-IN intents — treat them as restaurant discovery/booking and proceed normally.

FLOW — follow exactly in this order:
1. The client already greeted the user. The first user message is a cuisine or preference signal — NOT a greeting. Treat it as step 1.
   If booking_state.status is "idle" or missing AND no search_restaurants call has happened in this conversation yet, call search_restaurants ONCE. Emit update_map_markers + show_restaurant_cards and ask which restaurant they'd like.
2. If search_restaurants has ALREADY been called in this conversation, DO NOT call it again UNLESS the user changes the search geography or cuisine meaningfully. Re-run search_restaurants when the user:
   - names a new city ("actually in Montreal", "show me Calgary"),
   - says "out of town" / "somewhere else" / "a different city" (ask which city first, then re-search),
   - asks for a cuisine not in the current visible set ("any Korean places?" when the visible candidates are all Italian).
   Otherwise, if the user just refines an already-visible set ("only Italian", "cheaper ones"), emit set_filters + update_map_markers using the Visible restaurant IDs — do NOT re-run search_restaurants.
3. When the user names a specific restaurant OR the user message contains "Selected restaurant ID: <uuid>", that restaurant is CONFIRMED. Immediately emit highlight_restaurant + start_booking with that ID and move to step 4 — do NOT ask "which one?" again.
   3a. FUZZY NAME MATCHING: the user is talking to a speech recognizer, so their pronunciation of a restaurant name will be approximate ("steven gorgey" / "steve georgy" / "georges inc" / "gorgi inc"). When "Visible restaurant candidates" are listed in the user message, score the user's reply against each candidate name (phonetic + token overlap). If ONE candidate clearly wins, treat it as CONFIRMED and emit highlight_restaurant + start_booking on it — do not ask again. If TWO candidates are close, emit highlight_restaurant on your best guess and say "Did you mean <name>?" — then next_expected_input='confirmation'.
   3b. NEVER ask the same disambiguation question more than twice in a row. If you've already asked "which restaurant?" twice, the next turn MUST commit to a best-guess confirmation ("Did you mean X?") — not another "which one?".
   3c. SINGLE-RESULT AUTO-CONFIRM: when search_restaurants returns exactly ONE match the assistant is fully confident — DO NOT ask "Do you want to book at X?" or any confirmation variant. Treat the result as CONFIRMED, emit highlight_restaurant + start_booking with its id, and go directly to step 4 (ask party_size first). Confirmation prompts only belong in cases of genuine ambiguity (two close STT-fuzzy candidates) — see 3a. DO NOT call get_menu, emit show_menu, or emit offer_preorder — those belong to step 6, AFTER the reservation is confirmed.
4. Collect booking fields in TWO QUESTIONS in this exact order. Ask ONLY for fields marked MISSING in the BOOKING STATE checklist above — never re-ask a field that is already SET.
   4a. **Question 1 — party_size only** (when party_size MISSING): ask "How many guests?" (≤ 4 words). Do NOT also ask date/time in this turn — that comes next.
   4b. **Question 2 — date AND time together** (when party_size SET but date OR time MISSING): ask "What date and time?" (≤ 6 words). The user will answer with both ("tomorrow at 7pm", "Friday 8 PM", "tonight at 9"). Parse BOTH from the single reply and emit set_booking_field for each.
   4c. Parse natural-language answers from voice users into structured values and emit set_booking_field immediately:
       - party_size: "two" / "for 2" / "party of three" / "me and my wife" → 2/3/2. "a couple" → 2. "solo" / "just me" → 1.
       - date: "tonight" / "today" → today's YYYY-MM-DD. "tomorrow" → today+1. "Friday" / "next Saturday" → the next occurrence of that weekday in YYYY-MM-DD.
       - time: "7pm" → "19:00". "seven thirty" → "19:30". "noon" → "12:00".
   4d. NEVER ask "Would you like to book?" / "Should I book it?" / "Ready to book?" or any variant. Once restaurant_id + party_size + date are SET, the user's intent to book is already confirmed — proceed silently to check_availability.
   4e. Call check_availability only once restaurant_id, date, AND party_size are all SET. The server will auto-match the user's stated time to the nearest slot and complete the booking — you do NOT need to enumerate slots or re-ask "what time?" once the user has already given a time in their date+time reply. If the user did NOT include a time (only said a date), then after slots come back ask "What time?" — but normally the date+time arrives together so no extra question is needed.
5. Call complete_booking → emit show_confirmation + show_exit_x.
6. ONLY AFTER you have emitted show_confirmation in a PRIOR turn AND booking_state.status is one of {"confirmed","offering_preorder","browsing_menu","post_booking"}: emit offer_preorder and ask "Want to pre-order from the menu?" (≤ 10 words). Do NOT enter step 6 while booking_state.status is "idle" or "collecting_minimum_fields" — those are still steps 1-4.
   a. If no: emit show_post_booking_questions. DONE.
   b. If yes: call get_menu, emit show_menu. Use current cart (shown above) + add_menu_item actions.
      When user says "done" / "that's it" / "that's all":
      i.  Call create_preorder_order with ALL items from the current cart. Use reservation_id from booking_state.
      ii. Ask: "Tip now or after your meal?" (spoken only, no action yet).
      iii. When user answers:
          - "after" → emit set_tip_choice with choice="after", then show_payment_success with amount_charged=0. Spoken: "You're set — pay at the table." DONE.
          - "now" → emit set_tip_choice with choice="now". Ask: "How much? Percent or dollar amount."
      iv. When user gives tip: parse "twenty percent"→percent=20, "ten dollars"→amount=10. Emit set_tip.
      v.  Ask: "Single card or split?" When user answers, emit set_payment_split with choice.
          - "split" → emit navigate_to_checkout with order_id from create_preorder_order result, path="/{slug}?order_id={order_id}&step=checkout". DONE.
          - "single" AND hasSavedCard=true → call charge_saved_card with order_id and tip. Emit show_payment_success. DONE.
          - "single" AND hasSavedCard=false → emit navigate_to_checkout. DONE.

RULES:
- spoken_text ≤ 20 words. No filler ("Sure!", "Of course!", "Great choice!"). Direct.
- One question per turn.
- NEVER re-ask for a booking field that is already SET in the BOOKING STATE checklist — read the checklist first every turn.
- NEVER speak as if YOU are the guest (see PERSPECTIVE above).
- CUSTOMER VOCABULARY: NEVER say the words "shift", "shifts", "lunch shift", "dinner shift", or any internal scheduling term in spoken_text. These are operational concepts the customer doesn't care about. Always use customer-friendly wording: "no availability", "no openings", "no tables at that time", "we don't have anything then". If a tool message contains the word "shift", paraphrase it before speaking — never echo it verbatim.
- NO-AVAILABILITY RE-PROMPT: When check_availability returns zero slots OR the user picks a time outside the available slots, ask "What date and time would you like instead?" (re-prompt for BOTH) — not just "What time?". The user may want a different day entirely.
- NEVER say "no reservations available" unless you've called check_availability and confirmed it returned no slots. If search_restaurants returns results, show them.
- NEVER call check_availability unless restaurant_id, date, AND party_size are all known.
- If you have enough info, act (emit actions) instead of asking.
- Never ask post-booking questions (occasion, dietary) BEFORE show_confirmation.
- Parse tip freely from natural speech. When unsure, default to 20% and confirm.
- Always echo the conversation_id in every response.
- All UI actions must use types from this list: ${UI_ACTION_TYPES.join(", ")}.`;
}

// ── Fuzzy match helpers (for STT-garbled restaurant names) ───────────────────
// Chrome Web Speech API routinely mangles proper nouns (e.g. "Georgy" → "Jury",
// "Sienna's" → "scenes"). When the user is choosing among visible candidates
// we score each name against the transcript and auto-select if one clearly
// wins. Without this the LLM regex-matches exact names and asks "which
// restaurant?" forever.

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function scoreNameMatch(name: string, transcript: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const n = normalize(name);
  const t = normalize(transcript);
  if (!n || !t) return 0;
  // Whole-name substring match — strongest signal.
  if (t.includes(n)) return 100;
  const stop = new Set([
    "the", "a", "an", "and",
    "restaurant", "restaurants", "cafe", "bar", "grill", "kitchen", "bistro",
  ]);
  const nameTokens = n.split(" ").filter((w) => w.length >= 2 && !stop.has(w));
  const transcriptTokens = Array.from(
    new Set(t.split(" ").filter((w) => w.length >= 2)),
  );
  let score = 0;
  for (const tok of nameTokens) {
    if (transcriptTokens.includes(tok)) {
      score += 10;
      continue;
    }
    // Near-match within edit distance 2 (handles STT substitutions of 1-2 chars)
    for (const trans of transcriptTokens) {
      if (Math.abs(trans.length - tok.length) > 2) continue;
      const maxLen = Math.max(trans.length, tok.length);
      const allowed = maxLen <= 4 ? 1 : 2;
      if (levenshtein(trans, tok) <= allowed) {
        score += 5;
        break;
      }
    }
  }
  return score;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  return streamSse(async (send) => {
    // Auth — surfaced as in-band SSE error frames so the single response
    // type is always text/event-stream. Client orchestrator hook reads
    // the error frame and converts it back to the same error states the
    // legacy JSON path used (not_authenticated, http_401, etc.).
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const payload = decodeJwtPayload(token);
    if (!payload?.sub) {
      send({ type: "error", message: "Unauthorized", status: 401 });
      return;
    }

    const { data: userProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("id, full_name, email")
      .eq("auth_user_id", payload.sub as string)
      .single();
    if (!userProfile) {
      send({ type: "error", message: "User profile not found", status: 401 });
      return;
    }

    const userProfileId: string = userProfile.id;
    const userName: string = userProfile.full_name ?? "there";
    const firstName = userName.split(" ")[0];

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
      has_saved_card?: boolean;
      guest_id?: string | null;
      reservation_id?: string | null;
    };

    const {
      transcript = "",
      screen = "discover",
      booking_state = {},
      visible_restaurant_ids = [],
      selected_restaurant_id: bodySelectedRestaurantId = null,
      user_location = null,
      conversation_id: incomingConvId,
      has_saved_card = false,
    } = body;

    // Mutable selection — the server may promote a voice "yes" into an
    // explicit selection when the map is already narrowed to one restaurant.
    let selected_restaurant_id: string | null = bodySelectedRestaurantId;

    // When the user confirms a single-result search with "yes" / "yeah" / etc.,
    // treat it as explicit selection of that one restaurant so the LLM doesn't
    // have to infer it (and, crucially, doesn't mistake the "yes" for yes-to-
    // preorder and jump straight to the menu).
    const currentStatus = (booking_state.status as string | null | undefined) ?? "idle";
    const isAffirmative =
      /^\s*(yes|yeah|yep|yup|sure|ok|okay|alright|fine|please|yes please|yeah please|sounds good|go ahead|book it|do it|confirm|let's do it)[\s.!,]*$/i.test(
        transcript,
      );
    if (
      !selected_restaurant_id &&
      isAffirmative &&
      visible_restaurant_ids.length === 1 &&
      (currentStatus === "idle" || currentStatus === "collecting_minimum_fields")
    ) {
      selected_restaurant_id = visible_restaurant_ids[0];
    }

    // Resolve city
    const userCity = user_location
      ? await resolveCity(user_location.lat, user_location.lng)
      : "";

    // Pre-fill booking_state from the current transcript so the system prompt
    // sees party_size/date as SET. Without this the model was ignoring its own
    // set_booking_field action across turns and re-asking the same questions.
    const preFilled: { party_size?: number; date?: string } = {};
    if (transcript) {
      if (booking_state.party_size == null) {
        const n = parsePartySize(transcript);
        if (n != null) {
          booking_state.party_size = n;
          preFilled.party_size = n;
        }
      }
      if (booking_state.date == null) {
        const d = parseDate(transcript);
        if (d) {
          booking_state.date = d;
          preFilled.date = d;
        }
      }
    }

    // Conversation persistence
    let conversationId = incomingConvId;
    if (!conversationId) {
      const { data: conv } = await supabaseAdmin
        .from("chat_conversations")
        .insert({ user_profile_id: userProfileId, language: "en", title: "Voice booking" })
        .select("id")
        .single();
      conversationId = conv?.id ?? crypto.randomUUID();
    }

    // Load last 12 messages. 40 was paying ~30% extra LLM input tokens + DB
    // load every turn for context the booking flow doesn't need — the system
    // prompt + booking-state checklist already encode the state machine, and
    // the regex parsers below catch the few facts (party_size, date) that
    // need to survive longer than the window. Drop to 12 for tighter pacing;
    // raise to 16 if a regression appears in QA.
    const { data: history } = await supabaseAdmin
      .from("chat_messages")
      .select("role, content, metadata")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(12);

    // Promote a "yes" to an explicit selection when the previous assistant
    // turn already proposed a specific restaurant via highlight_restaurant
    // (i.e. the LLM said "Did you mean Georgy Inc?"). Without this, an
    // affirmative reply with 2+ visible restaurants would slip past the
    // single-result promotion above, the LLM would see no selection set, and
    // it would re-ask the same disambiguation question — which is exactly
    // the loop the user reported.
    if (
      !selected_restaurant_id &&
      isAffirmative &&
      (currentStatus === "idle" || currentStatus === "collecting_minimum_fields")
    ) {
      const lastAssistant = (history ?? []).find((m) => m.role === "assistant");
      const fullResp = (lastAssistant?.metadata as { full_response?: { ui_actions?: Array<Record<string, unknown>> } } | null)?.full_response;
      const lastHighlight = fullResp?.ui_actions?.find((a) => a?.type === "highlight_restaurant");
      const proposedId = lastHighlight && typeof lastHighlight.restaurant_id === "string"
        ? lastHighlight.restaurant_id
        : null;
      if (proposedId) {
        selected_restaurant_id = proposedId;
      }
    }

    const rawMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    for (const msg of (history ?? []).reverse()) {
      if (msg.role === "user") {
        rawMessages.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        rawMessages.push({ role: "assistant", content: msg.content });
      } else if (msg.role === "tool_call") {
        const meta = msg.metadata as Record<string, unknown>;
        rawMessages.push({
          role: "assistant",
          content: null,
          tool_calls: [{
            id: meta.tool_use_id as string,
            type: "function",
            function: { name: meta.tool_name as string, arguments: JSON.stringify(meta.input) },
          }],
        });
      } else if (msg.role === "tool_result") {
        const meta = msg.metadata as Record<string, unknown>;
        rawMessages.push({
          role: "tool",
          tool_call_id: meta.tool_use_id as string,
          content: msg.content,
        });
      }
    }

    // Also scan every prior user transcript in this conversation — the user
    // may have said "for 4 tomorrow" 5 turns ago and the model still hasn't
    // emitted set_booking_field. Don't let that field stay MISSING any longer.
    if (booking_state.party_size == null || booking_state.date == null) {
      for (const msg of (history ?? [])) {
        if (msg.role !== "user" || !msg.content) continue;
        if (booking_state.party_size == null) {
          const n = parsePartySize(msg.content);
          if (n != null) {
            booking_state.party_size = n;
            preFilled.party_size = n;
          }
        }
        if (booking_state.date == null) {
          const d = parseDate(msg.content);
          if (d) {
            booking_state.date = d;
            preFilled.date = d;
          }
        }
        if (booking_state.party_size != null && booking_state.date != null) break;
      }
    }

    // Sanitize the reconstructed history for OpenAI:
    // 1. Tool messages MUST directly follow the assistant message that
    //    emitted their tool_call. If ordering is wrong (same-timestamp
    //    inserts) we fix it by indexing calls → results first.
    // 2. Drop orphan tool messages AND tool_calls whose results are missing.
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    // Build a map of tool_call_id → tool message so we can re-attach them in
    // the correct position even if they appeared early in the history.
    const toolResultById = new Map<string, OpenAI.Chat.ChatCompletionMessageParam>();
    for (const m of rawMessages) {
      if (m.role === "tool") {
        const id = (m as { tool_call_id?: string }).tool_call_id;
        if (id) toolResultById.set(id, m);
      }
    }

    for (const m of rawMessages) {
      if (m.role === "assistant" && "tool_calls" in m && m.tool_calls?.length) {
        // Keep only tool_calls that have a corresponding tool_result.
        const resolved = m.tool_calls.filter((tc) => toolResultById.has(tc.id));
        if (resolved.length) {
          messages.push({ ...m, tool_calls: resolved });
          // Immediately follow with the matching tool result messages so the
          // assistant ↔ tool pairing is airtight, regardless of original order.
          for (const tc of resolved) {
            const res = toolResultById.get(tc.id);
            if (res) messages.push(res);
          }
        } else if (m.content) {
          messages.push({ role: "assistant", content: m.content as string });
        }
        // Drop fully-orphaned tool_calls (no text, no resolved results).
        continue;
      }
      if (m.role === "tool") {
        // Already emitted right after its parent assistant above — skip here.
        continue;
      }
      messages.push(m);
    }

    // Count how many turns in a row we've already asked the user to pick a
    // restaurant. Computed BEFORE fuzzy match so we can relax scoring on
    // the re-ask — when the user answered a "which restaurant?" prompt,
    // they clearly meant SOMETHING from the visible list. Don't throw
    // their reply away over a margin-of-victory check.
    const recentAssistant = (history ?? [])
      .filter((m) => m.role === "assistant")
      .slice(0, 2)
      .map((m) => (m.content ?? "").toLowerCase());
    const priorWhichAsks = recentAssistant.filter((c) =>
      /which restaurant|which one\b|pick one|what restaurant|which.*place/.test(c)
    ).length;

    // Fetch names for the visible restaurants so the LLM has something to
    // fuzzy-match spoken transcripts against. Without names, STT jitter on a
    // proper noun (e.g. "Steven Georgy" → "steven gorgey") leaves the model
    // with no way to connect the user's reply to a candidate and it loops
    // "which restaurant?" forever.
    let visibleRestaurantsLine = "";
    let visibleRestaurantRows: VisibleRestaurant[] = [];
    let sttFuzzyMatchLine = "";
    if (visible_restaurant_ids.length) {
      const { data: visRows } = await supabaseAdmin
        .from("restaurants")
        .select("id, name, cuisine_type")
        .in("id", visible_restaurant_ids.slice(0, 8));
      if (visRows?.length) {
        const rows = visRows as Array<{ id: string; name: string; cuisine_type: string | null }>;
        visibleRestaurantRows = rows;
        visibleRestaurantsLine =
          "Visible restaurant candidates (match user's spoken reply against these names — spelling/pronunciation will be approximate):\n" +
          rows
            .map((r) => `  - "${r.name}"${r.cuisine_type ? ` (${r.cuisine_type})` : ""} → id=${r.id}`)
            .join("\n");

        // Server-side fuzzy match: if the transcript is clearly talking about
        // one specific visible restaurant, auto-promote it to the explicit
        // selection so the LLM can't get wedged on "which restaurant?" when
        // STT garbles the proper noun. This is the single biggest cause of
        // the 3x "which restaurant" voice loop — the LLM regex-matches exact
        // names, but Chrome STT routinely mangles them (e.g. "Georgy" →
        // "Jury", "Sienna's" → "scenes"). Edit-distance lets us recover.
        if (
          !selected_restaurant_id &&
          transcript &&
          (currentStatus === "idle" || currentStatus === "collecting_minimum_fields")
        ) {
          const scored = rows
            .map((r) => ({ id: r.id, name: r.name, score: scoreNameMatch(r.name, transcript) }))
            .filter((s) => s.score > 0)
            .sort((a, b) => b.score - a.score);
          const best = scored[0];
          const next = scored[1];
          // When we've ALREADY asked "which one?" in a prior turn, relax
          // thresholds: the user's reply is almost certainly a selection
          // attempt. Only one visible candidate + any positive score wins.
          const minScore = priorWhichAsks >= 1 ? 5 : 10;
          const minGap = priorWhichAsks >= 1 ? 3 : 8;
          const onlyOneCandidate = rows.length === 1;
          if (
            best &&
            (
              (onlyOneCandidate && best.score > 0) ||
              (best.score >= minScore && (!next || best.score >= next.score + minGap))
            )
          ) {
            selected_restaurant_id = best.id;
            sttFuzzyMatchLine = `⚠️ STT FUZZY MATCH: transcript "${transcript}" resolved to restaurant "${best.name}" (id=${best.id}). Treat this as the user's confirmed selection — emit start_booking + highlight_restaurant and move on.`;
          }
        }
      } else {
        visibleRestaurantsLine = `Visible restaurant IDs: ${visible_restaurant_ids.slice(0, 8).join(", ")}`;
      }
    }

    // Anti-loop guard: fire after just ONE prior "which restaurant?" ask.
    // Waiting for a second ask let the orchestrator re-run search_restaurants
    // and unfilter the map before the guard kicked in. Scoped to the
    // restaurant-picking phase so pre-order prompts don't trip it.
    const repeatedWhichAsk =
      !selected_restaurant_id &&
      (currentStatus === "idle" || currentStatus === "collecting_minimum_fields") &&
      priorWhichAsks >= 1;

    const userContent = [
      transcript ? `User said: "${transcript}"` : "User opened the assistant.",
      selected_restaurant_id
        ? `⚠️ User has explicitly selected restaurant ID: ${selected_restaurant_id}. This selection is CONFIRMED — emit start_booking + highlight_restaurant and move to party_size. Do NOT ask which restaurant again.`
        : "",
      visibleRestaurantsLine,
      sttFuzzyMatchLine,
      repeatedWhichAsk && !selected_restaurant_id
        ? "⚠️ You have already asked 'which restaurant?' at least twice. Do NOT ask it again. Take the closest-sounding candidate from the list above and emit highlight_restaurant on its id + spoken_text 'Did you mean <name>?' Set next_expected_input='confirmation'."
        : "",
    ].filter(Boolean).join("\n");

    messages.push({ role: "user", content: userContent });

    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId,
      role: "user",
      content: userContent,
      metadata: { kind: "orchestrator" },
    });

    const systemPrompt = buildSystemPrompt({
      firstName,
      userName,
      userCity,
      now: new Date().toISOString(),
      bookingState: booking_state,
      currentScreen: screen,
      hasSavedCard: has_saved_card,
    });

    // ── Tool-use loop ─────────────────────────────────────────────────────────
    // The model calls tools to gather data and perform actions. During the
    // loop we record every tool execution into `derivedActions` / booking+map
    // deltas so the final JSON-turn response is reinforced server-side even
    // if the model drops an action from its output.
    // Cap at 3 to bound worst-case latency. In practice the model converges
    // in 1-2 iterations; 5 was just a fudge factor that occasionally cost
    // the user an extra ~2s per turn.
    const MAX_ITER = 3;
    let iterations = 0;
    let lastReservationId: string | null = (booking_state.reservation_id as string) ?? null;
    let lastGuestId: string | null = null;
    let lastSearchIds: string[] = [];
    // When search_restaurants returns exactly one match, capture its name so we
    // can prompt "Do you want to book a table at X?" instead of asking which
    // one they want — there's nothing to disambiguate.
    let lastSearchSingleName: string | null = null;
    let lastOrderId: string | null = (booking_state.order_id as string) ?? null;
    let lastTextReply = "";

    // Derived UI actions + deltas accumulated during tool execution.
    const derivedActions: Array<Record<string, unknown>> = [];
    const bookingDelta: Record<string, unknown> = {};
    const mapDelta: Record<string, unknown> = {};
    const toolsExecuted: string[] = [];
    let lastCheckoutPath: string | null = null;
    // Most recent check_availability result — used post-loop to map a voice
    // time reply ("9pm") to a real slot when the LLM forgets to emit
    // select_time_slot (Bug #1).
    let lastAvailabilitySlots: Array<{ shift_id: string; date_time: string; display_time: string }> = [];

    const alreadySearched = (history ?? []).some(
      (m) => m.role === "tool_call" &&
        ((m.metadata as Record<string, unknown>)?.tool_name as string | undefined) === "search_restaurants"
    );

    while (iterations < MAX_ITER) {
      iterations++;

      // Only force search_restaurants on the very first message of a fresh conversation
      // that has no prior search. Once any turn has searched, the model decides on its own.
      const isFirstTurnNoRestaurant =
        iterations === 1 &&
        !selected_restaurant_id &&
        !booking_state.restaurant_id &&
        (!booking_state.status || booking_state.status === "idle") &&
        (history?.length ?? 0) === 0 &&
        !alreadySearched;

      // Streaming tool-loop call. Text deltas are flushed as `speech_chunk`
      // SSE frames at sentence boundaries so the client can begin TTS
      // playback while the LLM is still generating — the single biggest
      // perceived-latency win on conversational turns. Tool-call deltas
      // are accumulated and reconstructed back into a non-streaming
      // `choice` shape for the existing tool-execution branches below.
      const llmStream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 600,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools: TOOLS,
        tool_choice: isFirstTurnNoRestaurant ? "required" : "auto",
        stream: true,
      });

      let accContent = "";
      let accFinishReason: string | null = null;
      const toolCallAcc = new Map<number, {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>();
      let speechBuffer = "";
      let iterationHasToolCalls = false;
      let chunksEmittedThisIter = 0;

      for await (const chunk of llmStream) {
        const ch = chunk.choices?.[0];
        if (!ch) continue;
        if (ch.finish_reason) accFinishReason = ch.finish_reason;
        const delta = ch.delta ?? {};

        if (delta.tool_calls?.length) {
          if (!iterationHasToolCalls) {
            iterationHasToolCalls = true;
            // Model started streaming text and then pivoted to a tool call.
            // Discard the in-flight audio so we don't speak text that's
            // about to be superseded by tool output.
            if (chunksEmittedThisIter > 0) {
              send({ type: "discard_pending_speech" });
              chunksEmittedThisIter = 0;
            }
            speechBuffer = "";
          }
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const cur = toolCallAcc.get(idx) ?? {
              id: tc.id ?? "",
              type: "function" as const,
              function: { name: "", arguments: "" },
            };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.function.name += tc.function.name;
            if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
            toolCallAcc.set(idx, cur);
          }
          continue;
        }

        if (typeof delta.content === "string" && delta.content.length) {
          accContent += delta.content;
          if (!iterationHasToolCalls) {
            speechBuffer += delta.content;
            // Flush every complete sentence chunk available in the buffer.
            while (true) {
              const flushed = takeSentenceChunk(speechBuffer);
              if (!flushed.chunk) break;
              speechBuffer = flushed.remainder;
              send({ type: "speech_chunk", text: flushed.chunk });
              chunksEmittedThisIter++;
            }
          }
        }
      }

      // Flush any residual buffered text as a final speech chunk for this
      // iteration. Skipped when tool_calls were emitted (audio was discarded).
      if (!iterationHasToolCalls && speechBuffer.trim().length) {
        send({ type: "speech_chunk", text: speechBuffer.trim() });
        chunksEmittedThisIter++;
        speechBuffer = "";
      }

      const reconstructedToolCalls = Array.from(toolCallAcc.values()).filter(
        (tc) => tc.id && tc.function.name,
      );
      const choice = {
        finish_reason:
          accFinishReason ??
          (reconstructedToolCalls.length ? "tool_calls" : "stop"),
        message: {
          role: "assistant" as const,
          content: accContent || null,
          ...(reconstructedToolCalls.length
            ? { tool_calls: reconstructedToolCalls }
            : {}),
        },
      } as unknown as {
        finish_reason: string | null;
        message: OpenAI.Chat.ChatCompletionMessage;
      };

      // Capture any plain text on this turn — the model sometimes returns
      // both text AND tool_calls. The last non-empty text is our spoken_text.
      if (choice.message.content && typeof choice.message.content === "string") {
        lastTextReply = choice.message.content;
      }

      if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
        messages.push(choice.message as OpenAI.Chat.ChatCompletionMessageParam);

        let didSearch = false;

        for (const tc of choice.message.tool_calls) {
          const toolName = tc.function.name;
          // Model occasionally emits empty / malformed JSON for args. Don't
          // let that crash the whole handler — log and continue with {} args,
          // then the tool's own "required field missing" branch will reject
          // cleanly and the model will retry.
          // deno-lint-ignore no-explicit-any
          let toolInput: any = {};
          try {
            toolInput = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          } catch (parseErr) {
            console.warn(`Bad tool args for ${toolName}:`, tc.function.arguments, parseErr);
            toolInput = {};
          }
          let toolResult = "";
          toolsExecuted.push(toolName);

          // ── search_restaurants ────────────────────────────────────────────
          if (toolName === "search_restaurants") {
            // Guard: block redundant searches once candidates are already on
            // the map. The LLM occasionally re-calls this with the user's
            // spoken restaurant name as `query`, which runs a broad OR across
            // name/cuisine/city and wipes out the existing filter (observed:
            // user said "Egyptian" → filter narrowed → user answered with a
            // name → LLM re-searched → map unfiltered → "which one?" re-ask).
            // Only allow re-search when the user explicitly named a new city
            // or asked for somewhere else.
            const isPicking =
              currentStatus === "idle" || currentStatus === "collecting_minimum_fields";
            const userChangedGeography = /\b(in|near)\s+[a-z]+|different city|another city|out of town|somewhere else|elsewhere/i.test(
              transcript,
            );
            const alreadyCalledThisTurn =
              toolsExecuted.filter((t) => t === "search_restaurants").length > 1;
            const shouldBlock =
              !selected_restaurant_id &&
              isPicking &&
              visible_restaurant_ids.length > 0 &&
              (alreadySearched || alreadyCalledThisTurn) &&
              !userChangedGeography;

            if (shouldBlock) {
              toolResult = JSON.stringify({
                error:
                  "DO NOT re-run search_restaurants. Candidates are already visible. Match the user's spoken reply against the Visible restaurant candidates list and emit highlight_restaurant + start_booking on the closest match. If no match is remotely plausible, say 'Did you mean <closest name>?' instead.",
              });
              didSearch = true;
            } else {
              let query = supabaseAdmin
                .from("restaurants")
                .select("id, name, cuisine_type, city, description, address, lat, lng, slug")
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
              if (!error && data) {
                lastSearchIds = (data as Array<{ id: string }>).map((r) => r.id);
                lastSearchSingleName =
                  data.length === 1
                    ? ((data[0] as { name?: string }).name ?? null)
                    : null;
                derivedActions.push({ type: "update_map_markers", restaurant_ids: lastSearchIds });
                derivedActions.push({ type: "show_restaurant_cards", restaurant_ids: lastSearchIds });
                mapDelta.visible = true;
                mapDelta.marker_restaurant_ids = lastSearchIds;

                // Single-result auto-confirm: when search returns exactly one
                // match, the assistant is fully confident — skip the "Do you
                // want to book at X?" confirmation step and treat the result
                // as the user's selection. The forced-override below will
                // then ask "How many guests?" directly.
                if (lastSearchIds.length === 1 && !selected_restaurant_id) {
                  selected_restaurant_id = lastSearchIds[0];
                  derivedActions.push({ type: "highlight_restaurant", restaurant_id: lastSearchIds[0] });
                  derivedActions.push({ type: "start_booking", restaurant_id: lastSearchIds[0] });
                }
              }
              toolResult = error ? JSON.stringify({ error: error.message }) : JSON.stringify(data ?? []);
              didSearch = true; // break after — don't eagerly chain check_availability without date/party_size
            }
          }

          // ── check_availability ────────────────────────────────────────────
          else if (toolName === "check_availability") {
            // Authoritative guard: the LLM cannot fabricate a party_size or
            // date that wasn't actually collected from the user. We cross-check
            // the tool args against the client-sent booking_state and reject
            // if either is only present in the LLM's call. Without this the
            // model happily defaults to party_size=2 and current date, which
            // surfaces as "Georgy Inc is available. Choose a time..." without
            // ever asking "how many guests?".
            const bsPartySize = booking_state.party_size as number | null | undefined;
            const bsDate = booking_state.date as string | null | undefined;
            const missingFields: string[] = [];
            if (!toolInput.restaurant_id) missingFields.push("restaurant_id");
            if (!toolInput.date || !bsDate) missingFields.push("date");
            if (toolInput.party_size == null || bsPartySize == null) {
              missingFields.push("party_size");
            }
            if (missingFields.length) {
              toolResult = JSON.stringify({
                error: `Cannot check availability yet: the user has NOT provided ${missingFields.join(", ")}. Do NOT guess or default — ask them in plain language. For party_size say "How many guests?".`,
              });
            } else {
              const result = await getAvailability(
                toolInput.restaurant_id,
                toolInput.date,
                toolInput.party_size,
              );
              toolResult = JSON.stringify(result);
              if (Array.isArray(result.slots) && result.slots.length) {
                lastAvailabilitySlots = result.slots.map((s) => ({
                  shift_id: s.shift_id,
                  date_time: s.date_time,
                  display_time: s.display_time,
                }));
              }
              derivedActions.push({ type: "load_availability" });
            }
          }

          // ── complete_booking ──────────────────────────────────────────────
          else if (toolName === "complete_booking") {
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
            if (result.guest_id) lastGuestId = result.guest_id;
            toolResult = JSON.stringify(result);
            if (result.reservation_id && result.confirmation_code) {
              derivedActions.push({ type: "show_confirmation", confirmation_code: result.confirmation_code });
              derivedActions.push({ type: "show_exit_x" });
              bookingDelta.reservation_id = result.reservation_id;
              bookingDelta.confirmation_code = result.confirmation_code;
            }
          }

          // ── patch_post_booking ────────────────────────────────────────────
          else if (toolName === "patch_post_booking") {
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

          // ── get_menu ──────────────────────────────────────────────────────
          else if (toolName === "get_menu") {
            // Guard: never fetch/show the menu until the reservation is actually
            // confirmed. The model occasionally tries to jump straight from a
            // "yes" (restaurant confirmation) into step 6 (menu), which dumps
            // the user into the menu before we've even collected party/date.
            const menuAllowed =
              currentStatus === "confirmed" ||
              currentStatus === "offering_preorder" ||
              currentStatus === "browsing_menu" ||
              currentStatus === "post_booking";
            if (!menuAllowed) {
              toolResult = JSON.stringify({
                error: "Cannot show the menu yet: reservation is not confirmed. Finish collecting party_size + date, call check_availability, complete_booking, and emit show_confirmation FIRST.",
              });
              // Fall through to the normal tool_result persistence below so the
              // conversation stays well-formed for OpenAI.
            } else {
            const { data: menuItems, error } = await supabaseAdmin
              .from("menu_items")
              .select("id, name, description, price, category, category_id, dietary_flags, allergens, is_preorderable, is_available")
              .eq("restaurant_id", toolInput.restaurant_id)
              .eq("is_active", true)
              .eq("is_preorderable", true)
              .eq("is_available", true)
              .order("sort_order");

            if (error) {
              toolResult = JSON.stringify({ error: error.message });
            } else {
              // Compact output — omit null fields to save tokens
              const compactItems = (menuItems ?? []).map((i: Record<string, unknown>) => ({
                id: i.id,
                name: i.name,
                price: i.price,
                category: i.category,
                ...(i.dietary_flags ? { dietary_flags: i.dietary_flags } : {}),
              }));
              toolResult = JSON.stringify({ items: compactItems });
              if (toolInput.restaurant_id) {
                derivedActions.push({ type: "show_menu", restaurant_id: toolInput.restaurant_id });
              }
            }
            } // end menuAllowed
          }

          // ── create_preorder_order ─────────────────────────────────────────
          else if (toolName === "create_preorder_order") {
            const { restaurant_id, reservation_id } = toolInput;
            // The client cart in booking_state is the authoritative source of
            // truth for menu_item_id + unit_price — the LLM's `items` arg often
            // omits the menu_item_id (the cart summary in the system prompt
            // doesn't surface UUIDs) which silently blanks out order_items.
            // Prefer booking_state.cart; fall back to the LLM arg only if the
            // cart is missing (manual text-only flow).
            const stateCart = (booking_state.cart as Array<{
              menu_item_id?: string;
              name?: string;
              qty?: number;
              quantity?: number;
              unit_price?: number;
            }> | undefined) ?? [];
            const llmItems = (toolInput.items as Array<Record<string, unknown>> | undefined) ?? [];
            const rawItems = stateCart.length ? stateCart : llmItems;
            // Normalise: accept both `qty` and `quantity`, require a valid
            // menu_item_id UUID — drop any row that can't be inserted cleanly.
            const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const items = rawItems
              .map((raw) => {
                const menu_item_id = String(raw.menu_item_id ?? "");
                const name = String(raw.name ?? "").trim();
                const quantity = Number(
                  (raw as { quantity?: number; qty?: number }).quantity ??
                    (raw as { qty?: number }).qty ??
                    0,
                );
                const unit_price = Number((raw as { unit_price?: number }).unit_price ?? 0);
                return { menu_item_id, name, quantity, unit_price };
              })
              .filter(
                (i) =>
                  UUID_RE.test(i.menu_item_id) &&
                  i.name.length > 0 &&
                  Number.isFinite(i.quantity) &&
                  i.quantity > 0 &&
                  Number.isFinite(i.unit_price) &&
                  i.unit_price >= 0,
              );
            if (!items.length) {
              toolResult = JSON.stringify({
                error:
                  "No valid items provided. Cart is empty or every item was missing a menu_item_id / quantity / unit_price.",
              });
            } else {
              // Ensure guest row exists (upsert based on user_profile_id + restaurant)
              const { data: existingGuest } = await supabaseAdmin
                .from("guests")
                .select("id")
                .eq("user_profile_id", userProfileId)
                .eq("restaurant_id", restaurant_id)
                .maybeSingle();

              let guestId: string;
              if (existingGuest) {
                guestId = existingGuest.id;
              } else {
                const { data: newGuest, error: guestErr } = await supabaseAdmin
                  .from("guests")
                  .insert({ user_profile_id: userProfileId, restaurant_id, full_name: userName })
                  .select("id")
                  .single();
                if (guestErr || !newGuest) {
                  toolResult = JSON.stringify({ error: `Guest creation failed: ${guestErr?.message}` });
                  messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
                  continue;
                }
                guestId = newGuest.id;
              }
              lastGuestId = guestId;

              // Fetch restaurant for tax rate + slug
              const { data: rest } = await supabaseAdmin
                .from("restaurants")
                .select("tax_rate, currency, slug")
                .eq("id", restaurant_id)
                .single();
              const taxRate = rest?.tax_rate ?? 0.13;
              const subtotal = items.reduce((sum: number, i: { unit_price: number; quantity: number }) => sum + i.unit_price * i.quantity, 0);
              const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
              const total = Math.round((subtotal + taxAmount) * 100) / 100;

              const confirmationCode = `PRE-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

              const { data: order, error: orderErr } = await supabaseAdmin
                .from("orders")
                .insert({
                  restaurant_id,
                  guest_id: guestId,
                  reservation_id: reservation_id || lastReservationId,
                  order_type: "dine_in",
                  is_preorder: true,
                  status: "pending",
                  subtotal: Math.round(subtotal * 100) / 100,
                  tax_amount: taxAmount,
                  total_amount: total,
                  confirmation_code: confirmationCode,
                  source: "cenaiva",
                })
                .select("id")
                .single();

              if (orderErr || !order) {
                toolResult = JSON.stringify({ error: `Order creation failed: ${orderErr?.message}` });
              } else {
                const orderItems = items.map((item) => ({
                  order_id: order.id,
                  menu_item_id: item.menu_item_id,
                  name: item.name,
                  quantity: item.quantity,
                  unit_price: item.unit_price,
                  line_total: Math.round(item.unit_price * item.quantity * 100) / 100,
                  status: "pending",
                }));
                // Surface + rollback on failure — without this the parent
                // order row is left as a phantom "empty" order and the
                // checkout page renders a blank Order Summary.
                const { error: itemsErr } = await supabaseAdmin
                  .from("order_items")
                  .insert(orderItems);
                if (itemsErr) {
                  console.error("order_items insert failed:", itemsErr, orderItems);
                  await supabaseAdmin.from("orders").delete().eq("id", order.id);
                  toolResult = JSON.stringify({
                    error: `Order items insert failed: ${itemsErr.message}`,
                  });
                  messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
                  continue;
                }

                const checkoutPath = rest?.slug
                  ? `/${rest.slug}?order_id=${order.id}&step=checkout`
                  : null;

                lastOrderId = order.id;
                lastCheckoutPath = checkoutPath;
                bookingDelta.order_id = order.id;

                toolResult = JSON.stringify({
                  success: true,
                  order_id: order.id,
                  subtotal: Math.round(subtotal * 100) / 100,
                  tax: taxAmount,
                  total,
                  currency: rest?.currency || "CAD",
                  checkout_path: checkoutPath,
                });
              }
            }
          }

          // ── charge_saved_card ─────────────────────────────────────────────
          else if (toolName === "charge_saved_card") {
            const { order_id, tip_percent, tip_amount: tipAmountInput } = toolInput;
            if (!order_id) {
              toolResult = JSON.stringify({ success: false, error: "order_id required." });
            } else {
              const { data: order } = await supabaseAdmin
                .from("orders")
                .select("id, restaurant_id, subtotal, tax_amount, discount_amount, paid_at, guest_id")
                .eq("id", order_id)
                .single();

              if (!order) {
                toolResult = JSON.stringify({ success: false, error: "Order not found." });
              } else if (order.paid_at) {
                toolResult = JSON.stringify({ success: false, error: "Order already paid." });
              } else {
                const { data: savedCard } = await supabaseAdmin
                  .from("saved_cards")
                  .select("id, brand, last4, stripe_payment_method_id")
                  .eq("user_profile_id", userProfileId)
                  .order("is_default", { ascending: false })
                  .limit(1)
                  .maybeSingle();

                if (!savedCard) {
                  toolResult = JSON.stringify({ success: false, error: "No saved card found." });
                } else {
                  const subtotal = Number(order.subtotal || 0);
                  const tax = Number(order.tax_amount || 0);
                  const discount = Number(order.discount_amount || 0);
                  const tipAmt = tip_percent != null
                    ? Math.round(subtotal * (Number(tip_percent) / 100) * 100) / 100
                    : Math.round(Number(tipAmountInput || 0) * 100) / 100;
                  const total = Math.round((subtotal + tax - discount + tipAmt) * 100) / 100;
                  const paidAt = new Date().toISOString();

                  if (stripeSecretKey) {
                    const { default: Stripe } = await import("npm:stripe@17");
                    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-11-20.acacia" });

                    const { data: profile } = await supabaseAdmin
                      .from("user_profiles")
                      .select("stripe_customer_id")
                      .eq("id", userProfileId)
                      .single();

                    if (!profile?.stripe_customer_id || !savedCard.stripe_payment_method_id) {
                      toolResult = JSON.stringify({ success: false, error: "Stripe not configured. Use checkout page." });
                    } else {
                      const { data: rest } = await supabaseAdmin
                        .from("restaurants")
                        .select("currency")
                        .eq("id", order.restaurant_id)
                        .single();
                      const currency = (rest?.currency || "CAD").toLowerCase();

                      try {
                        const paymentIntent = await stripe.paymentIntents.create({
                          amount: Math.round(total * 100),
                          currency,
                          customer: profile.stripe_customer_id,
                          payment_method: savedCard.stripe_payment_method_id,
                          off_session: true,
                          confirm: true,
                          metadata: { order_id, user_profile_id: userProfileId },
                        });

                        await supabaseAdmin.from("orders").update({
                          tip_amount: tipAmt, total_amount: total,
                          payment_method: "stripe", status: "paid",
                          paid_at: paidAt, billed_at: paidAt,
                          stripe_payment_intent_id: paymentIntent.id,
                        }).eq("id", order_id);

                        await supabaseAdmin.from("payments").insert({
                          order_id, restaurant_id: order.restaurant_id,
                          user_profile_id: userProfileId,
                          stripe_payment_intent_id: paymentIntent.id,
                          amount: total, currency, status: "succeeded", payment_type: "stripe",
                        });

                        toolResult = JSON.stringify({
                          success: true, total_charged: total, tip_amount: tipAmt,
                          currency: rest?.currency || "CAD", paid_at: paidAt,
                          card_brand: savedCard.brand, card_last4: savedCard.last4, mode: "live",
                        });
                        derivedActions.push({ type: "show_payment_success", amount_charged: total });
                      } catch (stripeErr: unknown) {
                        const msg = (stripeErr as { code?: string; message?: string });
                        toolResult = JSON.stringify({
                          success: false,
                          error: msg?.code === "authentication_required"
                            ? "Card requires verification. Use checkout page."
                            : (msg?.message || "Card declined."),
                        });
                      }
                    }
                  } else {
                    // Test mode
                    const testId = `test_pi_${Math.random().toString(36).slice(2, 12)}`;
                    await supabaseAdmin.from("orders").update({
                      tip_amount: tipAmt, total_amount: total,
                      payment_method: "card_test", status: "paid",
                      paid_at: paidAt, billed_at: paidAt,
                      stripe_payment_intent_id: testId,
                    }).eq("id", order_id);

                    await supabaseAdmin.from("payments").insert({
                      order_id, restaurant_id: order.restaurant_id,
                      user_profile_id: userProfileId,
                      stripe_payment_intent_id: testId,
                      amount: total, currency: "cad", status: "succeeded", payment_type: "test",
                    });

                    toolResult = JSON.stringify({
                      success: true, total_charged: total, tip_amount: tipAmt,
                      currency: "CAD", paid_at: paidAt,
                      card_brand: savedCard.brand, card_last4: savedCard.last4, mode: "test",
                    });
                    derivedActions.push({ type: "show_payment_success", amount_charged: total });
                  }
                }
              }
            }
          }

          // Persist tool call + result. Split into two sequential inserts so
          // the DB assigns DISTINCT created_at values — a single batched
          // insert gives both rows the same timestamp, and when we later
          // reload history the `tool` message can land BEFORE its
          // parent `tool_call`, which OpenAI rejects with a 400.
          await supabaseAdmin.from("chat_messages").insert({
            conversation_id: conversationId,
            role: "tool_call",
            content: JSON.stringify(toolInput),
            metadata: { kind: "orchestrator", tool_use_id: tc.id, tool_name: toolName, input: toolInput },
          });
          await supabaseAdmin.from("chat_messages").insert({
            conversation_id: conversationId,
            role: "tool_result",
            content: toolResult,
            metadata: { kind: "orchestrator", tool_use_id: tc.id },
          });

          messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
        }
        // After search_restaurants, go straight to the final JSON turn.
        // Prevents the model from eagerly calling check_availability without date/party_size.
        if (didSearch) break;
      } else {
        break;
      }
    }

    // ── Recover slots from history if not fetched this turn ──────────────────
    // The user's "9pm" reply often arrives on the turn AFTER check_availability.
    // Scan the most recent tool result for a slots array so we can still
    // match the time even when no fresh tool call ran this turn.
    if (lastAvailabilitySlots.length === 0) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role !== "tool" || typeof m.content !== "string") continue;
        try {
          const parsedTool = JSON.parse(m.content);
          if (Array.isArray(parsedTool?.slots) && parsedTool.slots.length) {
            lastAvailabilitySlots = parsedTool.slots
              .filter(
                (s: unknown): s is { shift_id: string; date_time: string; display_time: string } =>
                  !!s &&
                  typeof (s as Record<string, unknown>).shift_id === "string" &&
                  typeof (s as Record<string, unknown>).date_time === "string" &&
                  typeof (s as Record<string, unknown>).display_time === "string",
              )
              .map((s: { shift_id: string; date_time: string; display_time: string }) => ({
                shift_id: s.shift_id,
                date_time: s.date_time,
                display_time: s.display_time,
              }));
            if (lastAvailabilitySlots.length) break;
          }
        } catch {
          // Non-JSON tool result — skip.
        }
      }
    }

    // ── Auto-match a voice time + auto-complete the booking (Bug #1) ─────────
    // When the user replies with a time after slots have been shown, the LLM
    // sometimes regresses to "store is open X to Y. What time?" instead of
    // matching the time to a slot. Server-side: parse the time, match it to
    // the nearest slot, and run completeBooking directly so the user lands on
    // the confirmation card without an extra round-trip.
    let autoBookedSlot: { shift_id: string; date_time: string; display_time: string } | null = null;
    let autoBookingResult:
      | { reservation_id: string; confirmation_code: string; restaurant_id: string; party_size: number; date: string }
      | null = null;
    {
      const bsRestaurantId = (booking_state.restaurant_id as string | null | undefined) ?? selected_restaurant_id;
      const bsPartySize = booking_state.party_size as number | null | undefined;
      const bsDate = booking_state.date as string | null | undefined;
      const bsShiftId = booking_state.shift_id as string | null | undefined;
      const bsReservationId = booking_state.reservation_id as string | null | undefined;
      const allFieldsReady =
        !!bsRestaurantId &&
        !!bsPartySize &&
        !!bsDate &&
        !bsShiftId &&
        !bsReservationId &&
        !lastReservationId &&
        lastAvailabilitySlots.length > 0;

      if (allFieldsReady && transcript) {
        const parsedTimeHHMM = parseTime(transcript);
        if (parsedTimeHHMM) {
          const nearest = findNearestSlot(lastAvailabilitySlots, parsedTimeHHMM);
          if (nearest) {
            autoBookedSlot = nearest;
            const result = await completeBooking({
              user_profile_id: userProfileId,
              restaurant_id: bsRestaurantId!,
              order_type: "dine_in",
              date_time: nearest.date_time,
              shift_id: nearest.shift_id,
              party_size: bsPartySize!,
            });
            if (result.success && result.reservation_id && result.confirmation_code) {
              lastReservationId = result.reservation_id;
              if (result.guest_id) lastGuestId = result.guest_id;
              autoBookingResult = {
                reservation_id: result.reservation_id,
                confirmation_code: result.confirmation_code,
                restaurant_id: bsRestaurantId!,
                party_size: bsPartySize!,
                date: bsDate!,
              };
              // Push the same actions a normal complete_booking flow would —
              // shift_id / slot_iso / time / status flow through bookingDelta
              // below, so we only need the confirmation + exit actions here.
              derivedActions.push({
                type: "show_confirmation",
                confirmation_code: result.confirmation_code,
              });
              derivedActions.push({ type: "show_exit_x" });
              bookingDelta.reservation_id = result.reservation_id;
              bookingDelta.confirmation_code = result.confirmation_code;
              bookingDelta.shift_id = nearest.shift_id;
              bookingDelta.slot_iso = nearest.date_time;
              bookingDelta.time = nearest.display_time;
              // Move the booking past the time-selection gate so the
              // menuPhaseAllowed guard doesn't strip our show_confirmation.
              bookingDelta.status = "offering_preorder";
            }
          }
        }
      }
    }

    // ── Deterministic JSON shaper ────────────────────────────────────────────
    // We previously made a SECOND OpenAI call here just to wrap the tool-loop
    // output in the structured JSON contract — that added ~1-2s every
    // tool-driven turn. The tool-loop call already produced spoken_text in
    // `lastTextReply`, the tools we ran are tracked in `toolsExecuted` /
    // `derivedActions` / `bookingDelta`, and the post-processing chain
    // immediately below (auto-book hard-override, prefilled-field emitter,
    // anti-repetition rewriter, transcript parsers, derived-action merge,
    // menu-phase guard) already does the work of turning all that into the
    // shape the client expects. So the second LLM round-trip was always
    // redundant. The shaper just provides the skeleton; everything else
    // fills it in below, exactly as it did before.
    const followUp = buildDeterministicFollowUp({
      transcript,
      selected_restaurant_id,
      booking_state: {
        restaurant_id: booking_state.restaurant_id as string | null | undefined,
        party_size: booking_state.party_size as number | null | undefined,
        date: booking_state.date as string | null | undefined,
        time: booking_state.time as string | null | undefined,
        reservation_id: booking_state.reservation_id as string | null | undefined,
        status: booking_state.status as string | null | undefined,
      },
      derivedActions,
      lastSearchIds,
      lastAvailabilitySlots,
      preFilled,
      lastTextReply,
      visibleRestaurants: visibleRestaurantRows,
    });
    if (followUp.promoted_selected_restaurant_id) {
      selected_restaurant_id = followUp.promoted_selected_restaurant_id;
    }

    const parsed: Record<string, unknown> = {
      conversation_id: conversationId,
      spoken_text: followUp.spoken_text,
      intent: followUp.intent,
      step: followUp.step,
      ui_actions: [...followUp.ui_actions],
      booking: followUp.booking,
      map: followUp.map,
      filters: followUp.filters,
      next_expected_input: followUp.next_expected_input,
    };

    // Hard-override spoken_text when we auto-booked from a voice time reply.
    // The LLM regressed and re-asked for the time; we already created the
    // reservation, so speak the confirmation instead and prompt the preorder.
    if (autoBookingResult && autoBookedSlot) {
      parsed.spoken_text = `You're booked for ${autoBookedSlot.display_time}. Want to pre-order from the menu?`;
      parsed.next_expected_input = "confirmation";
    }

    // Hard-override spoken_text when a restaurant was just selected but we
    // still need party_size or date. The model often says "Booking X in Y."
    // instead of asking — which gives the user no prompt to continue.
    //
    // CRITICAL: also consider the LLM's *own* output for this turn — both
    // `parsed.booking` and any `set_booking_field` ui_actions. Without this,
    // when the user says something the regex parsers don't catch (e.g. "uh,
    // two please", "let's say four", "around 7", "the 30th") but the LLM
    // does extract correctly, we'd see booking_state.party_size still null
    // and incorrectly force-rewrite the LLM's reply back to "How many guests?",
    // re-asking the question the user just answered.
    const llmBooking = (parsed.booking as Record<string, unknown> | null) ?? null;
    const llmSetField = (field: string): unknown => {
      const a = (parsed.ui_actions as Array<Record<string, unknown>> | undefined)?.find(
        (x) => x?.type === "set_booking_field" && x.field === field,
      );
      return a?.value;
    };
    const bsPartyAfter =
      (booking_state.party_size as number | null | undefined) ??
      (llmBooking?.party_size as number | null | undefined) ??
      (llmSetField("party_size") as number | null | undefined) ??
      null;
    const bsDateAfter =
      (booking_state.date as string | null | undefined) ??
      (llmBooking?.date as string | null | undefined) ??
      (llmSetField("date") as string | null | undefined) ??
      null;
    const bsTimeAfter =
      (booking_state.time as string | null | undefined) ??
      (llmBooking?.time as string | null | undefined) ??
      (llmSetField("time") as string | null | undefined) ??
      null;
    const bsRestaurantAfter =
      (booking_state.restaurant_id as string | null | undefined) ??
      (llmBooking?.restaurant_id as string | null | undefined) ??
      (llmSetField("restaurant_id") as string | null | undefined) ??
      null;
    const hasRestaurant = !!(selected_restaurant_id || bsRestaurantAfter);

    if (selected_restaurant_id && bsPartyAfter == null) {
      // Question 1 — party size only. (Single-result searches are auto-
      // promoted to selected_restaurant_id at search time, so this branch
      // also handles "user searched and one result came back" — no extra
      // confirmation step.)
      parsed.spoken_text = "How many guests?";
    } else if (selected_restaurant_id && (!bsDateAfter || !bsTimeAfter)) {
      // Question 2 — date AND time together.
      parsed.spoken_text = "What date and time?";
    }

    // Anti-repetition net: on ANY turn (not just the one where the user
    // selected a restaurant), if the model's spoken_text asks for a field
    // that's already SET, rewrite it to prompt for the next MISSING field.
    // Without this the model occasionally regresses a turn or two later
    // ("how many guests?" after party_size was already set) because a tool
    // result pushed the SET/MISSING checklist out of its attention window.
    if (hasRestaurant && typeof parsed.spoken_text === "string") {
      const spoken = parsed.spoken_text as string;
      // Broad patterns — the LLM uses varied phrasings for the same question.
      const asksParty = /how many|party size|guests|people|for how many|group size|your party|how large|how big|persons?\b/i.test(spoken);
      const asksDate = /what date|which date|which day|when would|what day|when are you|what evening|what night|when.*(?:come|visit|book|dine|dinner|lunch|eat)|when.*thinking|what.*date/i.test(spoken);
      const asksTime = /what time|which time|when.*like to eat|what hour|when.*arrive/i.test(spoken);
      const asksWhichRestaurant = /which restaurant|which one\b|pick one|choose.{0,20}restaurant|what restaurant|which.*place/i.test(spoken);

      const repeatsParty = asksParty && bsPartyAfter != null;
      const repeatsDate = asksDate && !!bsDateAfter;
      const repeatsTime = asksTime && !!bsTimeAfter;
      const repeatsRestaurant = asksWhichRestaurant && !!bsRestaurantAfter;

      if (repeatsParty || repeatsDate || repeatsTime || repeatsRestaurant) {
        if (bsPartyAfter == null) {
          // Question 1 — party size first.
          parsed.spoken_text = "How many guests?";
        } else if (!bsDateAfter || !bsTimeAfter) {
          // Question 2 — date AND time together (single combined prompt).
          parsed.spoken_text = "What date and time?";
        } else {
          // All minimum fields are set — advance to slot selection.
          parsed.spoken_text = "Checking availability.";
        }
      }
    }

    parsed.conversation_id = conversationId;
    // Ensure ui_actions is always a clean array — model occasionally returns null or nulls inside.
    if (!Array.isArray(parsed.ui_actions)) parsed.ui_actions = [];
    parsed.ui_actions = (parsed.ui_actions as Array<unknown>).filter(
      (a): a is Record<string, unknown> => a != null && typeof (a as Record<string, unknown>).type === "string",
    );

    // ── Merge server-derived actions (from tool execution) ───────────────────
    // Prepend actions the server observed from tool calls. If the model
    // already emitted the same action type, we skip the duplicate to keep
    // the client reducer idempotent.
    const responseActions = parsed.ui_actions as Array<Record<string, unknown>>;
    const hasActionWith = (type: string, matchKey?: string, matchVal?: unknown) =>
      responseActions.some((a) =>
        a.type === type && (matchKey == null || a[matchKey] === matchVal),
      );
    for (const d of derivedActions) {
      const type = d.type as string;
      // Match on the distinguishing field for ids, so we don't collapse two
      // different set_booking_field actions into one.
      if (type === "set_booking_field") {
        if (hasActionWith("set_booking_field", "field", d.field)) continue;
      } else if (type === "highlight_restaurant" || type === "start_booking" || type === "show_menu") {
        if (hasActionWith(type, "restaurant_id", d.restaurant_id)) continue;
      } else if (hasActionWith(type)) {
        continue;
      }
      responseActions.unshift(d);
    }

    // Guard: strip show_menu / offer_preorder actions when the booking isn't
    // actually confirmed yet. This prevents the "user says yes to single
    // restaurant → menu appears + orchestrator asks for party size" bug.
    //
    // CRITICAL: the previous implementation trusted `mergedStatus` — which
    // is derived from the LLM's OWN `booking.status` output. When the model
    // hallucinated `booking.status: "offering_preorder"` after a "yes" to a
    // single-result restaurant (before party_size/date had been collected),
    // the guard was fooled into letting `offer_preorder` through and the
    // client jumped straight to the preorder UI without a reservation.
    // A real reservation_id is the single source of truth — require it.
    const responseReservationId =
      ((parsed.booking as Record<string, unknown> | null)?.reservation_id as string | null | undefined) ?? null;
    const hasRealReservation =
      !!lastReservationId ||
      !!responseReservationId ||
      !!(booking_state.reservation_id as string | null | undefined);
    const mergedStatus =
      (bookingDelta.status as string | undefined) ??
      ((parsed.booking as Record<string, unknown> | null)?.status as string | undefined) ??
      currentStatus;
    const menuPhaseAllowed =
      hasRealReservation && (
        mergedStatus === "confirmed" ||
        mergedStatus === "offering_preorder" ||
        mergedStatus === "browsing_menu" ||
        mergedStatus === "post_booking" ||
        mergedStatus === "collecting_payment" ||
        mergedStatus === "paid"
      );
    if (!menuPhaseAllowed) {
      parsed.ui_actions = (parsed.ui_actions as Array<Record<string, unknown>>).filter(
        (a) => a.type !== "show_menu" && a.type !== "offer_preorder" && a.type !== "show_confirmation",
      );
      // Also scrub any LLM-fabricated booking.status that tries to jump into
      // a preorder/post-booking phase without a real reservation — the
      // client uses status to drive UI transitions, so leaking this through
      // lights up the preorder sheet prematurely.
      const preorderStatuses = new Set([
        "confirmed",
        "offering_preorder",
        "browsing_menu",
        "reviewing_cart",
        "choosing_tip_timing",
        "choosing_tip_amount",
        "choosing_payment_split",
        "charging",
        "paid",
        "post_booking",
      ]);
      const bk = parsed.booking as Record<string, unknown> | null;
      if (bk && typeof bk.status === "string" && preorderStatuses.has(bk.status)) {
        delete bk.status;
        parsed.booking = bk;
      }
    }

    // Merge server booking delta (tool execution) into parsed.booking.
    if (Object.keys(bookingDelta).length > 0) {
      parsed.booking = { ...((parsed.booking as Record<string, unknown>) ?? {}), ...bookingDelta };
    }
    // Merge server map delta.
    if (Object.keys(mapDelta).length > 0) {
      parsed.map = { ...((parsed.map as Record<string, unknown>) ?? {}), ...mapDelta };
    }

    // ── Companion set_booking_field(time) for select_time_slot (Bug #2) ──────
    // The select_time_slot action only carries shift_id + slot_iso; without a
    // matching set_booking_field for `time` the confirmation card has no time
    // to render. When we have access to lastAvailabilitySlots, look up the
    // display_time for the chosen slot_iso and emit the field update.
    {
      const stsAction = (parsed.ui_actions as Array<Record<string, unknown>>).find(
        (a) => a.type === "select_time_slot",
      );
      if (stsAction && lastAvailabilitySlots.length) {
        const slotIso = stsAction.slot_iso as string | undefined;
        const match = slotIso
          ? lastAvailabilitySlots.find((s) => s.date_time === slotIso)
          : undefined;
        if (match) {
          const alreadyHasTimeField = (parsed.ui_actions as Array<Record<string, unknown>>).some(
            (a) => a.type === "set_booking_field" && a.field === "time",
          );
          if (!alreadyHasTimeField) {
            (parsed.ui_actions as Array<Record<string, unknown>>).push({
              type: "set_booking_field",
              field: "time",
              value: match.display_time,
            });
          }
          parsed.booking = {
            ...((parsed.booking as Record<string, unknown>) ?? {}),
            time: match.display_time,
          };
        }
      }
    }

    // ── Safety-net: transcript parsers (party_size / date) ────────────────────
    const responseBooking = (parsed.booking as Record<string, unknown> | null) ?? null;
    const currentPartySize =
      (responseBooking?.party_size as number | null | undefined) ??
      (booking_state.party_size as number | null | undefined) ??
      null;
    const currentDate =
      (responseBooking?.date as string | null | undefined) ??
      (booking_state.date as string | null | undefined) ??
      null;

    const alreadySetsField = (field: string) =>
      responseActions.some(
        (a) => a.type === "set_booking_field" && a.field === field,
      );

    // Emit set_booking_field for anything we pre-filled at the top of the
    // handler (from transcript / history). This guarantees the client state
    // syncs so the NEXT request sees the field as SET.
    if (preFilled.party_size != null && !alreadySetsField("party_size")) {
      responseActions.push({ type: "set_booking_field", field: "party_size", value: preFilled.party_size });
      parsed.booking = { ...((parsed.booking as Record<string, unknown>) ?? {}), party_size: preFilled.party_size };
    }
    if (preFilled.date && !alreadySetsField("date")) {
      responseActions.push({ type: "set_booking_field", field: "date", value: preFilled.date });
      parsed.booking = { ...((parsed.booking as Record<string, unknown>) ?? {}), date: preFilled.date };
    }

    if (transcript) {
      if (currentPartySize == null && !alreadySetsField("party_size")) {
        const parsedSize = parsePartySize(transcript);
        if (parsedSize != null) {
          responseActions.push({ type: "set_booking_field", field: "party_size", value: parsedSize });
          parsed.booking = { ...((parsed.booking as Record<string, unknown>) ?? {}), party_size: parsedSize };
        }
      }
      if (currentDate == null && !alreadySetsField("date")) {
        const parsedDate = parseDate(transcript);
        if (parsedDate) {
          responseActions.push({ type: "set_booking_field", field: "date", value: parsedDate });
          parsed.booking = { ...((parsed.booking as Record<string, unknown>) ?? {}), date: parsedDate };
        }
      }
    }

    // ── Guarantee map filtering on a fresh search ─────────────────────────────
    if (lastSearchIds.length > 0) {
      const hasMarkerAction = responseActions.some(
        (a) => a.type === "update_map_markers" || a.type === "show_restaurant_cards",
      );
      if (!hasMarkerAction) {
        responseActions.unshift({ type: "update_map_markers", restaurant_ids: lastSearchIds });
        responseActions.unshift({ type: "show_restaurant_cards", restaurant_ids: lastSearchIds });
      }
      const mapPatch = ((parsed.map as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
      mapPatch.visible = true;
      if (!mapPatch.marker_restaurant_ids) {
        mapPatch.marker_restaurant_ids = lastSearchIds;
      }
      parsed.map = mapPatch;
    }

    // Scrub null/undefined fields from parsed.booking. The client merges this
    // patch into existing state, and a literal `null` would overwrite a
    // previously-collected value (e.g. party_size) with null — causing the
    // orchestrator to re-ask the same question on the next turn.
    if (parsed.booking && typeof parsed.booking === "object") {
      const bk = parsed.booking as Record<string, unknown>;
      for (const k of Object.keys(bk)) {
        if (bk[k] == null) delete bk[k];
      }
      parsed.booking = bk;
    }

    // Prevent unused-var warnings for state we track for downstream observability.
    void lastOrderId;
    void lastCheckoutPath;
    void lastGuestId;
    void lastReservationId;
    void lastTextReply;
    void toolsExecuted;

    // Final safety net: the deterministic follow-up builder should already
    // supply a schema-valid prompt, but keep one last guard so the user never
    // gets dead silence if a later rewrite clears spoken_text unexpectedly.
    if (!parsed.spoken_text || !(parsed.spoken_text as string).trim()) {
      parsed.spoken_text = "Got it. What would you like to do next?";
    }

    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: (parsed.spoken_text as string) ?? "",
      metadata: { kind: "orchestrator", full_response: parsed },
    });

    send({ type: "final", payload: parsed });
  });
});
