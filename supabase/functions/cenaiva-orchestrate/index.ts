import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import OpenAI from "npm:openai@4";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { jsonRes } from "../_shared/json-response.ts";
import { decodeJwtPayload } from "../_shared/jwt.ts";
import { getAvailability } from "../_shared/availability.ts";
import { completeBooking, patchPostBooking } from "../_shared/booking.ts";
import { localDayOfWeek } from "../_shared/time.ts";
import { buildDeterministicFollowUp, type FollowUpAction, type VisibleRestaurant } from "./followup.ts";

const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });
const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const LATENCY_DEBUG = Deno.env.get("CENAIVA_LATENCY_DEBUG") === "1";
const OPENAI_PREWARM = Deno.env.get("CENAIVA_OPENAI_PREWARM") === "1";

// Optional pre-warm. Disabled by default because module-init network work can
// compete with the first live request in cold starts.
if (OPENAI_PREWARM) {
  (async () => {
    try { await openai.models.list(); } catch { /* noop */ }
  })();
}

function createLatencyTimer(label: string) {
  const start = performance.now();
  let last = start;
  const marks: string[] = [];
  const mark = (name: string) => {
    if (!LATENCY_DEBUG) return;
    const now = performance.now();
    marks.push(`${name}=+${Math.round(now - last)}ms/${Math.round(now - start)}ms`);
    last = now;
  };
  return {
    mark,
    async time<T>(name: string, fn: () => PromiseLike<T>): Promise<T> {
      const value = await fn();
      mark(name);
      return value;
    },
    done(extra: Record<string, unknown> = {}) {
      if (!LATENCY_DEBUG) return;
      console.log(JSON.stringify({
        kind: "latency",
        label,
        total_ms: Math.round(performance.now() - start),
        marks,
        ...extra,
      }));
    },
  };
}

function deferTask(label: string, task: Promise<unknown>) {
  const guarded = task.catch((err) => {
    const e = err as { message?: string };
    console.error(`cenaiva-orchestrate ${label} failed:`, e?.message ?? String(err));
  });
  const runtime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(guarded);
}

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
        "Search and RECOMMEND dine-in restaurants. Use this whenever the user asks for ideas, recommendations, suggestions, or filters — not just exact name lookups. Default to nearby results when the user's location is available and they have NOT asked for a different city. Do NOT default city to the user's detected city name — leave city blank unless the user names one. Combine multiple filters when the user gives multiple signals (e.g. 'cheap Italian near me with a deal' → cuisine_type=Italian, price_range_max=2, near_user=true, sort_by=distance, with_active_promotion=true). Always populate the most specific filters you can derive from the user's words; do NOT fall back to a single broad query string when structured filters fit.",
      parameters: {
        type: "object",
        properties: {
          cuisine_type: { type: "string", description: "e.g. Italian, Japanese, Egyptian" },
          city: { type: "string", description: "Only when the user explicitly names a city." },
          query: { type: "string", description: "Free-text name search ONLY (a restaurant name or vibe word). Do not put cuisines, cities, or 'near me' here." },
          price_range_max: {
            type: "integer",
            minimum: 1,
            maximum: 4,
            description: "Cap on price tier (1=$, 2=$$, 3=$$$, 4=$$$$). Use for budget signals: 'cheap'/'affordable'/'budget' → 2; 'mid-range' → 3; 'fancy'/'upscale'/'splurge' → omit (or set 4 only if user says 'expensive is fine'). 'under $X' for X≤25 → 1; ≤50 → 2; ≤100 → 3.",
          },
          price_range_min: {
            type: "integer",
            minimum: 1,
            maximum: 4,
            description: "Floor on price tier. Use only for explicit upscale signals: 'fancy'/'fine dining'/'upscale'/'high-end' → 3; 'super fancy'/'Michelin'/'splurge' → 4.",
          },
          min_rating: {
            type: "number",
            minimum: 0,
            maximum: 5,
            description: "Minimum avg_rating. Use 4 for 'top rated'/'best'/'highly rated'/'great spots'; 4.5 for 'the absolute best'.",
          },
          near_user: {
            type: "boolean",
            description: "True when the user says 'near me'/'closest'/'nearby'/'around here'/'walking distance'. Requires the user to have shared location (don't worry — server skips silently if missing).",
          },
          sort_by: {
            type: "string",
            enum: ["rating", "distance", "price_asc", "price_desc"],
            description: "rating=top-rated request; distance=proximity request (pair with near_user); price_asc=cheapest first; price_desc=fanciest first.",
          },
          with_active_promotion: {
            type: "boolean",
            description: "True when the user mentions deals/discounts/promos/specials/'on sale'/'happy hour offers'.",
          },
          event_keyword: {
            type: "string",
            description: "Set when the user asks for restaurants showing/hosting a specific event or theme: 'World Cup', 'UFC', 'live music', 'jazz night', 'trivia', 'DJ', 'Super Bowl', 'F1', 'NBA finals', 'karaoke'. Pass the topic as plain text.",
          },
          occasion: {
            type: "string",
            description: "Optional vibe hint: 'date', 'anniversary', 'birthday', 'business', 'family', 'group'. The server uses this to bias rating/price/seating filters when the user didn't spell them out.",
          },
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
        "Create a confirmed dine-in reservation. This is the only tool that writes a reservation. Call it only after live availability has been checked, the slot has been selected, and the user has explicitly confirmed the exact restaurant/date/time/party-size summary.",
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

function numberTokenToInt(token: string): number | null {
  if (/^\d+$/.test(token)) {
    const n = parseInt(token, 10);
    return n >= 1 && n <= 20 ? n : null;
  }
  return NUMBER_WORDS[token] ?? null;
}

function hasUncertainPartySize(raw: string): boolean {
  const t = normalizeSpokenDigits(stripFiller(raw));
  return /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:or|to|-)\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/.test(t);
}

function parsePartySizeRange(raw: string): { min: number; max: number } | null {
  const t = normalizeSpokenDigits(stripFiller(raw));
  const m = t.match(
    /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:or|to|-)\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/,
  );
  if (!m) return null;
  const a = numberTokenToInt(m[1]);
  const b = numberTokenToInt(m[2]);
  if (a == null || b == null) return null;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

function parsePartySize(raw: string): number | null {
  const t = normalizeSpokenDigits(stripFiller(raw));
  if (hasUncertainPartySize(raw)) return null;
  const adultsKids = t.match(
    /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+adults?\b[\s\S]{0,30}\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:kids?|children)\b/,
  );
  if (adultsKids) {
    const adults = numberTokenToInt(adultsKids[1]);
    const kids = numberTokenToInt(adultsKids[2]);
    if (adults != null && kids != null) return adults + kids;
  }
  const kidsAdults = t.match(
    /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:kids?|children)\b[\s\S]{0,30}\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+adults?\b/,
  );
  if (kidsAdults) {
    const kids = numberTokenToInt(kidsAdults[1]);
    const adults = numberTokenToInt(kidsAdults[2]);
    if (adults != null && kids != null) return adults + kids;
  }
  // "just me" / "solo" / "for one"
  if (/\b(just\s+me|solo|alone|by\s+myself)\b/.test(t)) return 1;
  if (/\b(me\s+and\s+my\s+(wife|husband|partner|boyfriend|girlfriend|girl|friend|kid|date))\b/.test(t)) return 2;
  // "party of N" / "table for N" / "N people" / "N of us"
  const numMatch = t.match(
    /\b(?:party of|table for|for|just|group of|we are|we're|make it)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|couple|duo|pair)\b/,
  );
  if (numMatch) {
    const n = numberTokenToInt(numMatch[1]);
    if (n != null) return n;
  }
  // "N people" / "N guests"
  const peopleMatch = t.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(people|guests|adults|pax|persons?|of us)\b/);
  if (peopleMatch) {
    const n = numberTokenToInt(peopleMatch[1]);
    if (n != null) return n;
  }
  // Bare "two" / "3" when the assistant just asked party size — last resort.
  const bare = t.trim().match(/^(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/);
  if (bare) {
    const n = numberTokenToInt(bare[1]);
    if (n != null) return n;
  }
  return null;
}

function formatISODateInTimeZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addDaysToISODate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

function formatPromptNow(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute} ${byType.dayPeriod} (${timezone})`;
}

function parseDateInTimeZone(raw: string, timezone: string): string | null {
  const t = stripFiller(raw);
  const todayIso = formatISODateInTimeZone(new Date(), timezone);
  if (/\b(today|tonight|this\s+evening)\b/.test(t)) return todayIso;
  if (/\btomorrow\b/.test(t)) {
    return addDaysToISODate(todayIso, 1);
  }
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const todayDow = localDayOfWeek(todayIso, timezone);
  for (let i = 0; i < 7; i++) {
    const re = new RegExp(`\\b(?:this|next|on)?\\s*${weekdays[i]}\\b`);
    if (re.test(t)) {
      const diff = (i - todayDow + 7) % 7 || 7;
      return addDaysToISODate(todayIso, diff);
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
  const t = raw
    .toLowerCase()
    .replace(
      /\b(uh+|um+|er+|ah+|hmm+|mm+|like|so|well|please|pls|thanks|thank you|thx|actually|maybe|i think|i guess|let'?s say|i'?d say|let me see|sorry|okay|ok|yeah|yep|yes|sure|alright)\b/g,
      " ",
    )
    .replace(/[,.!?;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
    let h = parseInt(colon[1], 10);
    const min = parseInt(colon[2], 10);
    if (h >= 1 && h <= 10) h += 12;
    if (h >= 0 && h <= 23 && min >= 0 && min < 60) {
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }
  }
  // "nine pm" / "seven thirty" / "noon" / "midnight"
  const word =
    t.match(
      /\b(?:at|around|maybe|like|about|how about)\s+(twelve|one|two|three|four|five|six|seven|eight|nine|ten|eleven|noon|midnight)\b\s*(thirty|fifteen|forty.?five|am|pm)?\s*(am|pm)?/,
    ) ??
    t.trim().match(
      /^(twelve|one|two|three|four|five|six|seven|eight|nine|ten|eleven|noon|midnight)\b\s*(thirty|fifteen|forty.?five|am|pm)?\s*(am|pm)?$/,
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
  const dateAdjacentBare = t.match(
    /\b(?:today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+(\d{1,2})\b(?!\s*(?:people|guests|of|year|years))/,
  );
  if (dateAdjacentBare) {
    let h = parseInt(dateAdjacentBare[1], 10);
    if (h >= 1 && h <= 11) h += 12;
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:00`;
  }
  return null;
}

function hasAmbiguousBareTwelve(raw: string): boolean {
  const t = stripFiller(raw);
  return /\b(?:at|around|for|book|today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+12\b(?!\s*(?:am|pm|a\.m\.|p\.m\.|:))/i.test(t);
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

function formatBookingDateForSpeech(dateStr: string): string {
  const [year, month, day] = dateStr.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return dateStr;
  const localNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(localNoon);
}

function buildBookingConfirmationPrompt(opts: {
  restaurantName: string | null;
  partySize: number;
  date: string;
  time: string;
}): string {
  const restaurant = opts.restaurantName || "this restaurant";
  const dateLabel = formatBookingDateForSpeech(opts.date);
  return `Just confirming: table for ${opts.partySize} at ${restaurant}, ${dateLabel} at ${opts.time}. Should I book it?`;
}

function scrubGenericLookupPrompt(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const asksToLookupSomething =
    /\b(?:want|would|should|shall|can)\b[\s\S]{0,50}\b(?:search|look)\b[\s\S]{0,40}\b(?:something|anything|else|up)\b/i.test(trimmed) ||
    /\b(?:search|look)\b[\s\S]{0,20}\b(?:something|anything)\b[\s\S]{0,10}\bup\b/i.test(trimmed);
  if (!asksToLookupSomething) return trimmed;
  return "What kind of restaurant are you looking for?";
}

function safeStreamingSpeechChunk(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Final responses are scrubbed later, but streamed TTS is spoken
  // immediately. Suppress this generic prompt before it reaches the client.
  return scrubGenericLookupPrompt(trimmed) === trimmed ? trimmed : null;
}

// ── Nominatim city lookup ─────────────────────────────────────────────────────

const CITY_CACHE_TTL_MS = 10 * 60 * 1000;
const CITY_LOOKUP_TIMEOUT_MS = 350;
const cityCache = new Map<string, { city: string; expiresAt: number }>();

async function resolveCity(lat: number, lng: number): Promise<string> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const now = Date.now();
  const cached = cityCache.get(key);
  if (cached && cached.expiresAt > now) return cached.city;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CITY_LOOKUP_TIMEOUT_MS);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=10`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Seatly/1.0 (seatly.app)" },
      signal: controller.signal,
    });
    if (!res.ok) return "";
    const data = await res.json() as { address?: Record<string, string> };
    const a = data.address ?? {};
    const city = a.city ?? a.town ?? a.municipality ?? a.village ?? a.suburb ?? "";
    cityCache.set(key, { city, expiresAt: now + CITY_CACHE_TTL_MS });
    return city;
  } catch {
    return cached?.city ?? "";
  } finally {
    clearTimeout(timeout);
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
User's detected city: ${opts.userCity || "unknown"}.
Has saved card on file: ${opts.hasSavedCard}.

GEOGRAPHY — restaurants exist in many cities nationwide.
- If the user has shared location and has NOT named a different city, default discovery/recommendation searches to nearby restaurants.
- Do NOT inject the detected city name into the city filter unless the user explicitly names that city.
- Pass city to search_restaurants ONLY when the user explicitly names one ("in Montreal", "Toronto restaurants", "places in Calgary", "my parents' town — Edmonton").
- Treat phrases like "out of town", "in another city", "somewhere else" as signals to ask which city they want — then re-run search_restaurants with that city.
- If the user names a city different from their detected city, ALWAYS re-run search_restaurants with the named city — do not refuse or say "I only show local results".

BOOKING STATE (authoritative — trust these values exactly):
${bookingChecklist}
⚠️ FIELD GUARD: Any field above marked "(SET)" is LOCKED. Do NOT ask for it again. You may repeat SET fields only in the mandatory final booking confirmation summary.
If restaurant_id + party_size + date are all SET → call check_availability immediately with zero extra questions.
Current cart (${cart.length} items): ${cartSummary}.

PERSPECTIVE — You are the ASSISTANT. You are NEVER the guest.
- NEVER use first-person singular for ordering, eating, or booking. Forbidden phrasings: "I'd like...", "I'll have...", "I want...", "Let's get...", "I'm craving...", "for me".
- ALWAYS speak to the user in second person: "You've added X", "Your table is booked", "Would you like to pre-order?".
- The ONLY valid first-person uses are assistant actions ("Checking availability now.") or clarifications ("Didn't catch that — one more time?").
- Don't parrot the user's phrasing back as your own intent. If they say "I want sushi", you respond "Looking for sushi now." — not "I want sushi too."

Cenaiva handles DINE-IN RESERVATIONS AND PRE-ORDER PAYMENT ONLY.
Natural phrases like "I want food from X", "I feel like X", "I'm craving Italian", "let's grab dinner at X" are DINE-IN intents — treat them as restaurant discovery/booking and proceed normally.

INTENT CLASSIFICATION — classify every user turn mentally before acting:
- reservation_create: user wants to book, reserve, get a table, or "get a spot".
- reservation_modify / reservation_cancel: user wants to change, move, add guests, add a note, or cancel an existing booking. Do not claim the change is done until the restaurant system confirms it.
- restaurant_search / dinner_plan: user asks what is good, open, nearby, romantic, cheap, family-friendly, quiet, business-appropriate, after a movie/game, or suitable for an occasion. Show options first unless they clearly ask to book.
- menu_question: user asks about dishes, ingredients, alcohol, kids meals, preorderability, spice, allergens, or substitutions. Use confirmed data only; if missing, say you do not have it confirmed.
- preorder_food / payment_question / rewards_question: keep reservation confirmation separate from preorder/payment/rewards actions.
- directions / restaurant_contact: provide directions/contact help without modifying bookings.
- general_question / fallback_unknown: if unrelated to restaurants, reservations, dinner planning, menus, directions, rewards, or Cenaiva booking/payment flows, use the scoped fallback.

MESSY SPEECH — users will be rushed, emotional, vague, broken-English, or mis-transcribed. Extract intent generously, ask the minimum missing question, and never overload them with every possible preference. "Book dinner" usually needs party size first. "Something nice" usually needs location or time only if not inferable.

RECOMMENDATIONS — search_restaurants is your recommendation engine. ALWAYS call it (with the right structured filters) when the user asks for ideas, suggestions, "what's good", "where should I eat", or any open-ended discovery request. NEVER reply "What would you like to do?" / "Got it!" without first running a search when the user has clearly expressed a preference, budget, occasion, location, event interest, or deal interest. Map intent → filters like this:
- BUDGET signals ("cheap", "affordable", "budget", "under $20", "not too expensive") → set price_range_max (1 or 2). "fancy"/"upscale"/"fine dining"/"splurge"/"high-end" → set price_range_min=3 (or sort_by=price_desc).
- PROXIMITY signals ("near me", "closest", "nearby", "around here", "walking distance") → near_user=true, sort_by="distance". If the user does NOT name another city, local discovery should still stay nearby by default.
- DIFFERENT-CITY signals ("in Calgary", "show me Montreal", "out of town") → set city to that city. Combine with other filters as needed.
- OCCASION signals ("date night", "anniversary", "romantic", "impress my date") → set occasion="date" plus min_rating=4 (and price_range_min=3 if they sound upscale). "birthday"/"family"/"group"/"business" → set occasion accordingly.
- TOP-RATED signals ("best", "top rated", "highly rated", "great spots", "favorites") → min_rating=4, sort_by="rating".
- EVENT signals ("World Cup", "UFC", "live music", "trivia night", "Super Bowl", "F1", "DJ", "karaoke", "showing the game") → event_keyword=<that topic>.
- DEAL/PROMO signals ("deals", "discounts", "promos", "specials", "happy hour", "BOGO", "any offers") → with_active_promotion=true.
COMBINE filters when the user gives multiple signals in one breath ("cheap sushi near me with a deal" = cuisine_type=Japanese + price_range_max=2 + near_user=true + with_active_promotion=true). After search returns, name 2-3 results in spoken_text and ask which one — do NOT go silent or fall back to "Got it!".

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
   4d. Once restaurant_id + party_size + date are SET, proceed silently to check_availability. Do NOT ask for budget/vibe/dietary/seating unless the user raised it or it is required to avoid a wrong booking.
   4e. Call check_availability only once restaurant_id, date, AND party_size are all SET. The server will match the user's stated time to the nearest slot. If the user did NOT include a time, ask "What time?" after availability comes back.
5. FINAL BOOKING CONFIRMATION IS MANDATORY. After a live slot is selected, emit select_time_slot + confirm_booking and ask the user to confirm the exact details before any reservation is created. Use a short exact summary: "Just confirming: table for 4 at La Piazza, Friday May 1 at 8:00 PM. Should I book it?" Do NOT call complete_booking in the same turn that selects the slot.
6. Call complete_booking ONLY when booking_state.status is "confirming", booking_state.slot_iso + booking_state.shift_id are SET, and the user's latest message is a clear confirmation ("yes", "confirm", "book it", "go ahead"). If they say no, cancel, or change anything, do NOT book — ask what to change or update the requested field and re-check availability.
7. ONLY AFTER complete_booking succeeds and you have emitted show_confirmation: emit offer_preorder and ask "Want to pre-order from the menu?" (≤ 10 words). Do NOT enter this step while booking_state.status is "idle", "collecting_minimum_fields", "loading_availability", "awaiting_time_selection", or "confirming".
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
- spoken_text ≤ 20 words, except final booking confirmation summaries may be up to 28 words. No filler ("Sure!", "Of course!", "Great choice!"). Direct.
- One question per turn.
- NEVER ask a generic search/look-up question about something, anything, or something else. If there is no context yet, ask "What kind of restaurant are you looking for?"
- NEVER end a turn silently after a tool runs. After search_restaurants returns results, your spoken_text MUST mention at least one (and preferably 2-3) restaurant names from the results, then ask which one — even if the user's last reply was short ("yeah", "show me deals"). Generic "what next?" fallback questions are BANNED whenever results are visible — describe what's on the map instead.
- When search_restaurants returns ZERO results, say so plainly and offer to relax one filter ("Nothing matches in your price range — want to widen the budget?"). Don't go silent and don't ask generic "what next?" questions.
- NEVER re-ask for a booking field that is already SET in the BOOKING STATE checklist — read the checklist first every turn. This includes party_size, date, AND time. If party_size + date + time are all SET, do NOT ask "what date and time?" again — proceed to check_availability.
- If the user's reply is unclear, garbled, or you can't extract the field you asked for (e.g. you asked "what date and time?" and the transcript is "uhh", "what", or unrelated words like "the menu please"), do NOT silently re-ask the same question. Say "Sorry, I didn't catch that — could you say it again?" (or a short variant) and set next_expected_input to the same field you were collecting. Re-asking the original question verbatim feels broken; explicitly acknowledging you missed it does not.
- NEVER speak as if YOU are the guest (see PERSPECTIVE above).
- CUSTOMER VOCABULARY: NEVER say the words "shift", "shifts", "lunch shift", "dinner shift", or any internal scheduling term in spoken_text. These are operational concepts the customer doesn't care about. Always use customer-friendly wording: "no availability", "no openings", "no tables at that time", "we don't have anything then". If a tool message contains the word "shift", paraphrase it before speaking — never echo it verbatim.
- NO-AVAILABILITY RE-PROMPT: When check_availability returns zero slots OR the user picks a time outside the available slots, offer a safer alternative: nearby time, different day, similar restaurant, waitlist/contact if available. If asking again, ask "What date and time would you like instead?" — not just "What time?".
- NEVER say "no reservations available" unless you've called check_availability and confirmed it returned no slots. If search_restaurants returns results, show them.
- NEVER call check_availability unless restaurant_id, date, AND party_size are all known.
- If you have enough info, act (emit actions) instead of asking.
- SAFETY / TRUST:
  - Never guarantee allergy safety, halal/kosher certification, wheelchair access, quietness, parking, or menu availability unless tool/database data explicitly confirms it. Prefer: "I don't have that confirmed, but I can add it as a note."
  - For allergies, serious dietary restrictions, accessibility, stroller/wheelchair space, birthdays, private rooms, and seating preferences, add or preserve the request in special_request/seating_preference. Say the restaurant should confirm serious allergy details directly.
  - For ambiguous dates ("next Friday", "Friday night"), ambiguous times ("12", "after work", "around 7-ish"), and same-name restaurants/locations, use exact date/time/location wording in the final confirmation.
  - Restaurant discovery, dinner planning, menu questions, directions, contact, rewards, and payment questions should NOT create a booking unless the user clearly asks to book and then confirms the final booking summary.
  - Never charge a saved card, take a deposit, or prepay a preorder without a separate explicit payment confirmation after the reservation is handled.
  - Do not support prank/fake/mass/duplicate bookings. If the user asks for abusive booking behavior, refuse briefly and offer one legitimate reservation.
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

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeCityName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function inferRecommendationOccasion(value: string): string | null {
  const normalized = normalizeSearchText(value);
  if (!normalized) return null;
  if (/\b(date|date night|romantic|anniversary|impress my date|good date spot|cute place)\b/i.test(normalized)) {
    return "date";
  }
  if (/\b(business|client dinner|work dinner|meeting)\b/i.test(normalized)) {
    return "business";
  }
  if (/\b(family|kids|child friendly)\b/i.test(normalized)) {
    return "family";
  }
  if (/\b(group|friends|crew|party of|big table)\b/i.test(normalized)) {
    return "group";
  }
  if (/\b(birthday|celebration)\b/i.test(normalized)) {
    return "birthday";
  }
  return null;
}

type SearchRestaurantRow = {
  id: string;
  name?: string;
  cuisine_type?: string | null;
  city?: string | null;
  address?: string | null;
  description?: string | null;
  lat?: number | null;
  lng?: number | null;
  price_range?: number | null;
  avg_rating?: number | null;
  distance_km?: number;
};

function scoreRecommendationFit(
  row: SearchRestaurantRow,
  occasion: string | null,
  vibeQuery: string,
): number {
  const normalizedDescription = normalizeSearchText(row.description ?? "");
  const normalizedName = normalizeSearchText(row.name ?? "");
  const normalizedCuisine = normalizeSearchText(row.cuisine_type ?? "");
  const normalizedQuery = normalizeSearchText(vibeQuery);

  let score = (row.avg_rating ?? 0) * 25;

  if (occasion === "date") {
    if ((row.price_range ?? 0) >= 3) score += 18;
    if ((row.price_range ?? 0) === 2) score += 10;
    if (/(french|italian|japanese|mediterranean|spanish|steakhouse|seafood|wine)/i.test(normalizedCuisine)) {
      score += 12;
    }
    if (/(romantic|cozy|intimate|candle|date|wine|cocktail|rooftop|tasting|fine dining|share plates)/i.test(normalizedDescription)) {
      score += 18;
    }
    if (/(family|kids|sports|loud|casual|fast)/i.test(normalizedDescription)) {
      score -= 8;
    }
  } else if (occasion === "business") {
    if ((row.price_range ?? 0) >= 3) score += 14;
    if (/(quiet|private|business|wine|steak|fine dining)/i.test(normalizedDescription)) score += 12;
  } else if (occasion === "family") {
    if ((row.price_range ?? 0) <= 2) score += 8;
    if (/(family|kids|shareable|casual|spacious)/i.test(normalizedDescription)) score += 12;
  } else if (occasion === "group") {
    if (/(group|large table|share plates|spacious|cocktails)/i.test(normalizedDescription)) score += 12;
  } else if (occasion === "birthday") {
    if (/(celebration|cocktail|dessert|tasting|rooftop)/i.test(normalizedDescription)) score += 12;
  }

  if (normalizedQuery) {
    const queryTokens = normalizedQuery.split(" ").filter((token) => token.length >= 3);
    for (const token of queryTokens) {
      if (normalizedName.includes(token)) score += 6;
      if (normalizedCuisine.includes(token)) score += 8;
      if (normalizedDescription.includes(token)) score += 10;
    }
  }

  return score;
}

type PendingAction = {
  type: "modify_reservation" | "cancel_reservation" | "late_note" | "save_preference";
  payload: Record<string, unknown>;
  confirmation_text: string;
};

type AssistantPayload = {
  conversation_id: string;
  spoken_text: string;
  intent: string;
  step: string;
  next_expected_input: string;
  ui_actions: FollowUpAction[];
  booking: Record<string, unknown> | null;
  map: Record<string, unknown> | null;
  filters: Record<string, unknown> | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isAffirmativeText(transcript: string): boolean {
  const isNegative =
    /\b(no|nope|nah|don'?t|do not|not yet|wait|hold on|cancel|stop|change|modify|different|late|preorder|menu|send|share|remember|weather)\b/i.test(
      transcript,
    );
  return !isNegative &&
    (
      /^\s*(yes|yeah|yep|yup|sure|ok|okay|alright|fine|please|yes please|yeah please|sounds good|go ahead|book it|do it|confirm|confirmed|let's do it)[\s.!,]*$/i.test(
        transcript,
      ) ||
      /\b(yes|confirm|confirmed|book it|go ahead|do it|lock it in|make the reservation)\b/i.test(transcript)
    );
}

function isNegativeText(transcript: string): boolean {
  return /\b(no|nope|nah|don'?t|do not|not yet|wait|hold on|cancel|stop|different)\b/i.test(transcript);
}

function isSafeBookingConfirmationText(transcript: string): boolean {
  return isAffirmativeText(transcript) &&
    !/\b(change|modify|cancel|late|running late|preorder|menu|pay|payment|deposit|send|share|remember|weather|different)\b/i.test(transcript);
}

function makeAssistantPayload(opts: {
  conversationId: string;
  spokenText: string;
  intent?: string;
  step?: string;
  nextExpectedInput?: string;
  uiActions?: FollowUpAction[];
  booking?: Record<string, unknown> | null;
  map?: Record<string, unknown> | null;
  filters?: Record<string, unknown> | null;
}): AssistantPayload {
  return {
    conversation_id: opts.conversationId,
    spoken_text: scrubGenericLookupPrompt(opts.spokenText),
    intent: opts.intent ?? "discover_restaurants",
    step: opts.step ?? "choose_restaurant",
    next_expected_input: opts.nextExpectedInput ?? "restaurant",
    ui_actions: opts.uiActions ?? [],
    booking: opts.booking ?? null,
    map: opts.map ?? null,
    filters: opts.filters ?? null,
  };
}

async function sendEarlyFinal(
  send: SseSend,
  conversationId: string,
  userContent: string,
  payload: AssistantPayload,
): Promise<void> {
  send({ type: "final", payload });
  deferTask("deterministic_persist", (async () => {
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId,
      role: "user",
      content: userContent,
      metadata: { kind: "orchestrator", deterministic: true },
    });
    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: payload.spoken_text,
      metadata: { kind: "orchestrator", deterministic: true, full_response: payload },
    });
  })());
}

function parsePendingAction(value: unknown): PendingAction | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const type = raw.type;
  if (
    type !== "modify_reservation" &&
    type !== "cancel_reservation" &&
    type !== "late_note" &&
    type !== "save_preference"
  ) return null;
  return {
    type,
    payload: raw.payload && typeof raw.payload === "object"
      ? raw.payload as Record<string, unknown>
      : {},
    confirmation_text: typeof raw.confirmation_text === "string" ? raw.confirmation_text : "",
  };
}

function bookingRestaurantId(bookingState: Record<string, unknown>, selectedRestaurantId: string | null): string | null {
  return (bookingState.restaurant_id as string | null | undefined) ?? selectedRestaurantId ?? null;
}

function restaurantLabel(row: SearchRestaurantRow): string {
  const bits = [row.name ?? "this restaurant"];
  if (row.city) bits.push(`in ${row.city}`);
  if (row.address) bits.push(`at ${row.address}`);
  return bits.join(" ");
}

function buildOptionsPrompt(rows: SearchRestaurantRow[], prefix = ""): string {
  const names = rows.slice(0, 3).map((row) => row.name).filter(Boolean) as string[];
  if (names.length === 0) return `${prefix}I don't see matching restaurants near you yet. Try a different cuisine or area.`;
  if (names.length === 1) return `${prefix}I found ${names[0]}. Want that one?`;
  if (names.length === 2) return `${prefix}${names[0]} or ${names[1]} look good. Which one sounds best?`;
  return `${prefix}${names[0]}, ${names[1]}, or ${names[2]} look good. Which one sounds best?`;
}

function formatTimeForSpeech(hhmm: string): string {
  const [hRaw, mRaw] = hhmm.split(":").map(Number);
  if (!Number.isFinite(hRaw) || !Number.isFinite(mRaw)) return hhmm;
  const period = hRaw >= 12 ? "PM" : "AM";
  const hour12 = hRaw % 12 || 12;
  return `${hour12}:${String(mRaw).padStart(2, "0")} ${period}`;
}

function directBookingIntent(transcript: string): boolean {
  return /\b(book|reserve|get me a table|get me a spot|make a reservation)\b/i.test(transcript);
}

function discoveryIntent(transcript: string): boolean {
  return /\b(find|show|where|what'?s good|best|recommend|plan|somewhere|restaurant|dinner|eat|cheap|deals|romantic|business|family|date|anniversary|open|near me)\b/i.test(transcript);
}

function offTopicIntent(transcript: string): boolean {
  return /\b(weather|forecast|sports score|news|stock price|bitcoin|homework|essay|code|programming)\b/i.test(transcript) &&
    !/\b(restaurant|reservation|book|dinner|eat|menu|food)\b/i.test(transcript);
}

function menuQuestionIntent(transcript: string): boolean {
  return /\b(menu|have|serve|preorder|kids meals?|vegan|gluten[- ]free|steak|pasta|pizza|spicy|alcohol|tiramisu|no onions|onions)\b/i.test(transcript) &&
    /\b(does|do|can|what|which|is|are)\b/i.test(transcript);
}

function allergyIntent(transcript: string): boolean {
  return /\b(allerg(?:y|ic)|nut allergy|shellfish|serious allergy|no pork|halal|kosher|dairy[- ]free|gluten[- ]free|vegan)\b/i.test(transcript);
}

function accessibilityIntent(transcript: string): boolean {
  return /\b(wheelchair|accessible|accessibility|without stairs|no stairs|sensory|accessible parking|washrooms?)\b/i.test(transcript) ||
    (/\b(quiet|not too loud|low lighting)\b/i.test(transcript) && /\b(sensory|sensitivity|accessible|accessibility)\b/i.test(transcript));
}

function privateOrLargePartyIntent(transcript: string, partySize: number | null): boolean {
  return /\b(private room|manager approval|restaurant approval|deposit|large party|large group)\b/i.test(transcript) ||
    (partySize != null && partySize >= 8);
}

function requestedHotelLocation(transcript: string): boolean {
  return /\bhotel\b/i.test(transcript) && /\bnear|walking distance|around\b/i.test(transcript);
}

function extractCuisineHint(transcript: string): string | null {
  const normalized = normalizeSearchText(transcript);
  const cuisines = [
    "italian", "japanese", "sushi", "thai", "french", "egyptian", "mediterranean",
    "steakhouse", "spanish", "canadian", "american", "indian", "halal",
  ];
  return cuisines.find((cuisine) => normalized.includes(cuisine)) ?? null;
}

const ACTIVE_RESTAURANTS_CACHE_TTL_MS = 2 * 60 * 1000;
let activeRestaurantsCache: { rows: SearchRestaurantRow[]; expiresAt: number } | null = null;
let activeRestaurantsInFlight: Promise<SearchRestaurantRow[]> | null = null;

async function fetchActiveRestaurants(): Promise<SearchRestaurantRow[]> {
  const now = Date.now();
  if (activeRestaurantsCache && activeRestaurantsCache.expiresAt > now) {
    return activeRestaurantsCache.rows;
  }
  if (activeRestaurantsInFlight) return activeRestaurantsInFlight;
  activeRestaurantsInFlight = (async () => {
    const { data, error } = await supabaseAdmin
      .from("restaurants")
      .select("id, name, cuisine_type, city, address, description, lat, lng, price_range, avg_rating")
      .eq("is_active", true)
      .limit(120);
    if (error) {
      if (activeRestaurantsCache) return activeRestaurantsCache.rows;
      return [];
    }
    const rows = (data ?? []) as SearchRestaurantRow[];
    activeRestaurantsCache = { rows, expiresAt: Date.now() + ACTIVE_RESTAURANTS_CACHE_TTL_MS };
    return rows;
  })().finally(() => {
    activeRestaurantsInFlight = null;
  });
  return activeRestaurantsInFlight;
}

function restaurantNameMatchesTranscript(row: SearchRestaurantRow, normalizedTranscript: string): boolean {
  const name = normalizeSearchText(row.name ?? "");
  if (!name || name.length < 3) return false;
  if (normalizedTranscript.includes(name)) return true;
  const tokens = name.split(" ").filter((token) => token.length > 2 && token !== "the");
  return tokens.length >= 2 && tokens.every((token) => normalizedTranscript.includes(token));
}

function findNamedRestaurants(transcript: string, rows: SearchRestaurantRow[]): SearchRestaurantRow[] {
  const normalizedTranscript = normalizeSearchText(transcript);
  if (!normalizedTranscript) return [];
  const matches = rows
    .filter((row) => restaurantNameMatchesTranscript(row, normalizedTranscript))
    .sort((a, b) => normalizeSearchText(b.name ?? "").length - normalizeSearchText(a.name ?? "").length);
  const deduped = new Map<string, SearchRestaurantRow>();
  for (const row of matches) {
    const key = [
      normalizeSearchText(row.name ?? ""),
      normalizeSearchText(row.city ?? ""),
      normalizeSearchText(row.address ?? ""),
    ].join("|");
    if (!deduped.has(key)) deduped.set(key, row);
  }
  return [...deduped.values()];
}

function topRecommendationRows(
  rows: SearchRestaurantRow[],
  transcript: string,
  userCity: string,
): SearchRestaurantRow[] {
  const cuisine = extractCuisineHint(transcript);
  const normalizedCuisine = cuisine ? normalizeSearchText(cuisine) : "";
  const normalizedCity = normalizeCityName(userCity);
  const priceSensitive = /\b(cheap|affordable|not too expensive|under|budget|deals?|student)\b/i.test(transcript);
  const cityFiltered = normalizedCity
    ? rows.filter((row) => !row.city || normalizeCityName(row.city) === normalizedCity)
    : rows;
  let filtered = cityFiltered;
  if (normalizedCuisine && normalizedCuisine !== "halal") {
    filtered = filtered.filter((row) =>
      normalizeSearchText(row.cuisine_type ?? "").includes(normalizedCuisine) ||
      normalizeSearchText(row.description ?? "").includes(normalizedCuisine) ||
      normalizeSearchText(row.name ?? "").includes(normalizedCuisine)
    );
  }
  if (priceSensitive) {
    filtered = filtered.filter((row) => (row.price_range ?? 2) <= 3);
  }
  if (!filtered.length) {
    filtered = priceSensitive ? cityFiltered.filter((row) => (row.price_range ?? 2) <= 3) : cityFiltered;
  }
  if (!filtered.length) filtered = rows;
  if (filtered.length < 3) {
    const seen = new Set(filtered.map((row) => row.id));
    const supplements = cityFiltered.filter((row) => !seen.has(row.id));
    filtered = [...filtered, ...supplements];
  }
  const occasion = inferRecommendationOccasion(transcript);
  return [...filtered]
    .sort((a, b) =>
      scoreRecommendationFit(b, occasion, transcript) - scoreRecommendationFit(a, occasion, transcript) ||
      (b.avg_rating ?? 0) - (a.avg_rating ?? 0)
    )
    .slice(0, 8);
}

async function duplicateReservationForSlot(
  userProfileId: string,
  restaurantId: string,
  slotIso: string,
): Promise<{ id: string; confirmation_code?: string | null } | null> {
  const { data: guests } = await supabaseAdmin
    .from("guests")
    .select("id")
    .eq("user_profile_id", userProfileId)
    .eq("restaurant_id", restaurantId);
  const guestIds = (guests ?? []).map((guest) => guest.id as string).filter(Boolean);
  if (!guestIds.length) return null;
  const { data } = await supabaseAdmin
    .from("reservations")
    .select("id, confirmation_code")
    .eq("restaurant_id", restaurantId)
    .in("guest_id", guestIds)
    .eq("reserved_at", slotIso)
    .in("status", ["confirmed", "pending"])
    .limit(1)
    .maybeSingle();
  return data as { id: string; confirmation_code?: string | null } | null;
}

async function confirmPendingAction(
  opts: {
    conversationId: string;
    transcript: string;
    userProfileId: string;
    bookingState: Record<string, unknown>;
  },
): Promise<AssistantPayload | null> {
  const pending = parsePendingAction(opts.bookingState.pending_action);
  if (!pending) return null;
  if (isNegativeText(opts.transcript)) {
    return makeAssistantPayload({
      conversationId: opts.conversationId,
      spokenText: "No problem. I won't make that change.",
      intent: pending.type === "cancel_reservation" ? "reservation_cancel" : "reservation_modify",
      step: "done",
      nextExpectedInput: "none",
      booking: { pending_action: null },
    });
  }
  if (!isAffirmativeText(opts.transcript)) return null;

  if (pending.type === "save_preference") {
    const dietary = typeof pending.payload.dietary === "string" ? pending.payload.dietary : null;
    if (dietary) {
      const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("dietary_restrictions")
        .eq("id", opts.userProfileId)
        .single();
      const current = Array.isArray(profile?.dietary_restrictions) ? profile.dietary_restrictions as string[] : [];
      await supabaseAdmin
        .from("user_profiles")
        .update({ dietary_restrictions: Array.from(new Set([...current, dietary])) })
        .eq("id", opts.userProfileId);
    }
    return makeAssistantPayload({
      conversationId: opts.conversationId,
      spokenText: "Saved. I'll use that preference for future recommendations.",
      intent: "general_question",
      step: "done",
      nextExpectedInput: "none",
      booking: { pending_action: null },
    });
  }

  const reservationId = String(pending.payload.reservation_id ?? opts.bookingState.reservation_id ?? "");
  if (!UUID_RE.test(reservationId)) {
    return makeAssistantPayload({
      conversationId: opts.conversationId,
      spokenText: "I can't update that reservation from here yet. Please open the reservation details.",
      intent: pending.type === "cancel_reservation" ? "reservation_cancel" : "reservation_modify",
      step: "done",
      nextExpectedInput: "none",
      booking: { pending_action: null },
    });
  }

  if (pending.type === "cancel_reservation") {
    await supabaseAdmin.from("reservations").update({ status: "cancelled" }).eq("id", reservationId);
    return makeAssistantPayload({
      conversationId: opts.conversationId,
      spokenText: "Cancelled. Your reservation has been marked cancelled.",
      intent: "reservation_cancel",
      step: "done",
      nextExpectedInput: "none",
      booking: { pending_action: null, status: "confirmed" },
    });
  }

  if (pending.type === "modify_reservation") {
    const patch: Record<string, unknown> = {};
    if (typeof pending.payload.slot_iso === "string") patch.reserved_at = pending.payload.slot_iso;
    if (typeof pending.payload.shift_id === "string") patch.shift_id = pending.payload.shift_id;
    if (typeof pending.payload.party_size === "number") patch.party_size = pending.payload.party_size;
    if (typeof pending.payload.special_request === "string") patch.special_request = pending.payload.special_request;
    if (Object.keys(patch).length) {
      await supabaseAdmin.from("reservations").update(patch).eq("id", reservationId);
    }
    return makeAssistantPayload({
      conversationId: opts.conversationId,
      spokenText: "Updated. Your reservation change is confirmed.",
      intent: "reservation_modify",
      step: "done",
      nextExpectedInput: "none",
      booking: {
        pending_action: null,
        ...(typeof pending.payload.party_size === "number" ? { party_size: pending.payload.party_size } : {}),
        ...(typeof pending.payload.date === "string" ? { date: pending.payload.date } : {}),
        ...(typeof pending.payload.time === "string" ? { time: pending.payload.time } : {}),
        ...(typeof pending.payload.slot_iso === "string" ? { slot_iso: pending.payload.slot_iso } : {}),
        ...(typeof pending.payload.shift_id === "string" ? { shift_id: pending.payload.shift_id } : {}),
      },
    });
  }

  if (pending.type === "late_note") {
    const note = typeof pending.payload.note === "string" ? pending.payload.note : "Guest is running late.";
    await supabaseAdmin.from("reservations").update({ special_request: note }).eq("id", reservationId);
    return makeAssistantPayload({
      conversationId: opts.conversationId,
      spokenText: "I added the late-arrival note. I still recommend calling the restaurant.",
      intent: "reservation_modify",
      step: "done",
      nextExpectedInput: "none",
      booking: { pending_action: null, special_request: note },
    });
  }

  return null;
}

async function buildPreflightResponse(opts: {
  conversationId: string;
  transcript: string;
  bookingState: Record<string, unknown>;
  selectedRestaurantId: string | null;
  userProfileId: string;
  getUserCity: () => Promise<string>;
  timezone: string;
}): Promise<AssistantPayload | null> {
  const { conversationId, transcript, bookingState, selectedRestaurantId } = opts;
  const normalized = normalizeSearchText(transcript);
  if (!normalized) return null;

  const pendingResponse = await confirmPendingAction({
    conversationId,
    transcript,
    userProfileId: opts.userProfileId,
    bookingState,
  });
  if (pendingResponse) return pendingResponse;

  if (offTopicIntent(transcript)) {
    return makeAssistantPayload({
      conversationId,
      spokenText: "I can mainly help with restaurants, reservations, dinner planning, menus, and bookings.",
      intent: "general_question",
      step: "done",
      nextExpectedInput: "none",
    });
  }

  const abusiveBookingIntent =
    /\b(fake name|fake booking|10 tables|ten tables|spam|prank)\b/i.test(transcript) ||
    /\b(?:two|multiple)\s+(?:reservations?|bookings?|tables?)\b/i.test(transcript) ||
    /\bdifferent\s+(?:places|restaurants)\b[\s\S]{0,80}\b(?:choose|pick|decide)\s+later\b/i.test(transcript);
  if (abusiveBookingIntent) {
    return makeAssistantPayload({
      conversationId,
      spokenText: "I can't make duplicate or fake reservations. I can help with one real booking.",
      intent: "fallback_unknown",
      step: "done",
      nextExpectedInput: "none",
    });
  }

  if (/\b(send|share|text|email)\b/i.test(transcript) && /\b(friend|girlfriend|boyfriend|someone|confirmation)\b/i.test(transcript)) {
    return makeAssistantPayload({
      conversationId,
      spokenText: "I can't send it from here yet. I can show the confirmation details for you to share.",
      intent: "general_question",
      step: "done",
      nextExpectedInput: "none",
    });
  }

  if (/\bremember|save\b/i.test(transcript) && /\bpreference|future|usually|halal|kosher|vegan|gluten|quiet|seating\b/i.test(transcript)) {
    const dietary = /\bhalal\b/i.test(transcript) ? "halal" : null;
    return makeAssistantPayload({
      conversationId,
      spokenText: dietary
        ? "I can save halal as a preference. Should I remember that?"
        : "I can save that as a preference. Should I remember it?",
      intent: "general_question",
      step: "confirm",
      nextExpectedInput: "confirmation",
      booking: {
        pending_action: {
          type: "save_preference",
          payload: dietary ? { dietary } : { preference: transcript },
          confirmation_text: "Save this preference?",
        },
      },
    });
  }

  const currentRestaurantId = bookingRestaurantId(bookingState, selectedRestaurantId);
  const currentRestaurantName = typeof bookingState.restaurant_name === "string"
    ? bookingState.restaurant_name
    : "the restaurant";
  const currentStatus = typeof bookingState.status === "string" ? bookingState.status : "idle";
  const rawReservationId = typeof bookingState.reservation_id === "string" ? bookingState.reservation_id : null;
  const reservationId = rawReservationId && UUID_RE.test(rawReservationId) ? rawReservationId : null;
  const explicitPartySize = parsePartySize(transcript);
  const explicitDate = parseDateInTimeZone(transcript, opts.timezone);
  const explicitTime = parseTime(transcript);
  const partySize =
    (bookingState.party_size as number | null | undefined) ??
    explicitPartySize;
  const date = (bookingState.date as string | null | undefined) ?? explicitDate;
  const time = (bookingState.time as string | null | undefined) ?? explicitTime;

  if (currentStatus === "confirming" && currentRestaurantId && !reservationId && isSafeBookingConfirmationText(transcript)) {
    const shiftId = typeof bookingState.shift_id === "string" ? bookingState.shift_id : null;
    const slotIso = typeof bookingState.slot_iso === "string" ? bookingState.slot_iso : null;
    if (!partySize || !date || !shiftId || !slotIso) {
      return makeAssistantPayload({
        conversationId,
        spokenText: "I need the reservation details again. What date and time?",
        intent: "reservation_create",
        step: "choose_date",
        nextExpectedInput: "date",
        booking: { status: "collecting_minimum_fields" },
      });
    }

    const live = await getAvailability(currentRestaurantId, date, partySize);
    const liveSlot = (live.slots ?? []).find((slot) =>
      slot.date_time === slotIso && slot.shift_id === shiftId
    );
    if (!liveSlot) {
      return makeAssistantPayload({
        conversationId,
        spokenText: "That time is no longer available. What time should I check?",
        intent: "reservation_create",
        step: "choose_time",
        nextExpectedInput: "time",
        uiActions: [{ type: "load_availability" }],
        booking: { status: "loading_availability" },
      });
    }

    const duplicate = await duplicateReservationForSlot(opts.userProfileId, currentRestaurantId, liveSlot.date_time);
    if (duplicate) {
      return makeAssistantPayload({
        conversationId,
        spokenText: `You already have ${currentRestaurantName} booked at ${liveSlot.display_time}.`,
        intent: "confirm_booking",
        step: "confirm",
        nextExpectedInput: "preorder_choice",
        uiActions: duplicate.confirmation_code
          ? [
            { type: "show_confirmation", confirmation_code: duplicate.confirmation_code },
            { type: "show_exit_x" },
          ]
          : [{ type: "show_exit_x" }],
        booking: {
          restaurant_id: currentRestaurantId,
          party_size: partySize,
          date,
          time: liveSlot.display_time,
          shift_id: liveSlot.shift_id,
          slot_iso: liveSlot.date_time,
          reservation_id: duplicate.id,
          confirmation_code: duplicate.confirmation_code ?? null,
          status: "offering_preorder",
        },
      });
    }

    const result = await completeBooking({
      user_profile_id: opts.userProfileId,
      restaurant_id: currentRestaurantId,
      order_type: "dine_in",
      date_time: liveSlot.date_time,
      shift_id: liveSlot.shift_id,
      party_size: partySize,
      special_request: bookingState.special_request as string | null | undefined,
      occasion: bookingState.occasion as string | null | undefined,
    });
    if (!result.success || !result.reservation_id || !result.confirmation_code) {
      return makeAssistantPayload({
        conversationId,
        spokenText: "I couldn't confirm that booking. Want another time?",
        intent: "confirm_booking",
        step: "confirm",
        nextExpectedInput: "confirmation",
        booking: { status: "confirming" },
      });
    }

    return makeAssistantPayload({
      conversationId,
      spokenText: `You're booked for ${liveSlot.display_time}. Want to pre-order from the menu?`,
      intent: "confirm_booking",
      step: "confirm",
      nextExpectedInput: "preorder_choice",
      uiActions: [
        { type: "show_confirmation", confirmation_code: result.confirmation_code },
        { type: "show_exit_x" },
      ],
      booking: {
        restaurant_id: currentRestaurantId,
        party_size: partySize,
        date,
        time: liveSlot.display_time,
        shift_id: liveSlot.shift_id,
        slot_iso: liveSlot.date_time,
        reservation_id: result.reservation_id,
        confirmation_code: result.confirmation_code,
        status: "offering_preorder",
      },
    });
  }

  const wantsPreConfirmationChange =
    currentStatus === "confirming" &&
    currentRestaurantId &&
    !reservationId &&
    !isSafeBookingConfirmationText(transcript) &&
    (
      explicitPartySize != null ||
      explicitDate != null ||
      explicitTime != null ||
      isNegativeText(transcript) ||
      /\b(change|edit|update|switch|different|another|wrong|details|make it)\b/i.test(transcript)
    );

  if (wantsPreConfirmationChange) {
    if (explicitPartySize == null && !explicitDate && !explicitTime) {
      return makeAssistantPayload({
        conversationId,
        spokenText: "What would you like to change?",
        intent: "reservation_modify",
        step: "choose_date",
        nextExpectedInput: "date",
        booking: { status: "confirming" },
      });
    }

    const nextPartySize = explicitPartySize ?? partySize;
    const nextDate = explicitDate ?? date;
    const nextTime = explicitTime ?? time;
    if (!nextPartySize) {
      return makeAssistantPayload({
        conversationId,
        spokenText: "How many guests?",
        intent: "reservation_create",
        step: "choose_party",
        nextExpectedInput: "party_size",
        booking: { status: "collecting_minimum_fields" },
      });
    }
    if (!nextDate) {
      return makeAssistantPayload({
        conversationId,
        spokenText: "What date?",
        intent: "reservation_create",
        step: "choose_date",
        nextExpectedInput: "date",
        booking: { status: "collecting_minimum_fields", party_size: nextPartySize },
      });
    }
    if (!nextTime) {
      return makeAssistantPayload({
        conversationId,
        spokenText: "What time?",
        intent: "reservation_create",
        step: "choose_time",
        nextExpectedInput: "time",
        booking: { status: "collecting_minimum_fields", party_size: nextPartySize, date: nextDate },
      });
    }

    const availability = await getAvailability(currentRestaurantId, nextDate, nextPartySize);
    const nearest = findNearestSlot(availability.slots ?? [], nextTime);
    if (!nearest) {
      const offered = (availability.slots ?? []).slice(0, 2).map((slot) => slot.display_time);
      return makeAssistantPayload({
        conversationId,
        spokenText: offered.length
          ? `No tables at ${formatTimeForSpeech(nextTime)}. They have ${offered.join(" or ")}.`
          : `No tables at ${formatTimeForSpeech(nextTime)}. What time should I check?`,
        intent: "reservation_create",
        step: "choose_time",
        nextExpectedInput: "time",
        uiActions: [{ type: "load_availability" }],
        booking: {
          status: "loading_availability",
          party_size: nextPartySize,
          date: nextDate,
          time: nextTime,
        },
      });
    }

    return makeAssistantPayload({
      conversationId,
      spokenText: buildBookingConfirmationPrompt({
        restaurantName: currentRestaurantName,
        partySize: nextPartySize,
        date: nextDate,
        time: nearest.display_time,
      }),
      intent: "confirm_booking",
      step: "confirm",
      nextExpectedInput: "confirmation",
      uiActions: [
        { type: "load_availability" },
        { type: "select_time_slot", slot_iso: nearest.date_time, shift_id: nearest.shift_id },
        ...(explicitPartySize != null ? [{ type: "set_booking_field", field: "party_size", value: nextPartySize }] : []),
        ...(explicitDate ? [{ type: "set_booking_field", field: "date", value: nextDate }] : []),
        { type: "set_booking_field", field: "time", value: nearest.display_time },
        { type: "confirm_booking" },
      ],
      booking: {
        status: "confirming",
        party_size: nextPartySize,
        date: nextDate,
        time: nearest.display_time,
        shift_id: nearest.shift_id,
        slot_iso: nearest.date_time,
      },
    });
  }

  if (/\b(running late|i'?m late|i am late|stuck in traffic|hold my table|\d+\s*minutes late|minutes late)\b/i.test(transcript)) {
    return makeAssistantPayload({
      conversationId,
      spokenText: "I can't notify them from here yet. Call the restaurant too, since tables may be released.",
      intent: "reservation_modify",
      step: "done",
      nextExpectedInput: "none",
      booking: reservationId ? {
        pending_action: {
          type: "late_note",
          payload: { reservation_id: reservationId, note: transcript },
          confirmation_text: "Add a late-arrival note?",
        },
      } : null,
    });
  }

  if (/\bcancel\b/i.test(transcript) && /\b(booking|reservation|table|it)\b/i.test(transcript)) {
    const summary = reservationId
      ? `Just confirming: cancel your reservation at ${currentRestaurantName}?`
      : "I can help cancel, but I need the reservation details first.";
    return makeAssistantPayload({
      conversationId,
      spokenText: summary,
      intent: "reservation_cancel",
      step: reservationId ? "confirm" : "done",
      nextExpectedInput: reservationId ? "confirmation" : "none",
      booking: reservationId ? {
        pending_action: {
          type: "cancel_reservation",
          payload: { reservation_id: reservationId },
          confirmation_text: summary,
        },
      } : null,
    });
  }

  if (/\b(change|move|switch|update|make it|add)\b/i.test(transcript) &&
    /\b(time|tomorrow|today|friday|saturday|sunday|monday|tuesday|wednesday|thursday|\d{1,2}:?\d{0,2}|people|guests?|outdoor|patio|note|birthday)\b/i.test(transcript) &&
    (reservationId || currentRestaurantId)
  ) {
    const newDate = parseDateInTimeZone(transcript, opts.timezone) ?? date;
    const newTime = parseTime(transcript) ?? time;
    const newParty = parsePartySize(transcript) ?? partySize;
    if (currentRestaurantId && newDate && newTime && newParty != null) {
      const availability = await getAvailability(currentRestaurantId, newDate, newParty);
      const slot = findNearestSlot(availability.slots ?? [], newTime);
      if (slot) {
        const requestedLabel = formatTimeForSpeech(newTime);
        const requestedMinutes = displayTimeToMinutes(requestedLabel);
        const slotMinutes = displayTimeToMinutes(slot.display_time);
        const differsFromRequested =
          slot.display_time !== requestedLabel ||
          (requestedMinutes != null && slotMinutes != null && Math.abs(requestedMinutes - slotMinutes) > 15);
        const prompt = differsFromRequested
          ? `${requestedLabel} isn't available. They have ${slot.display_time}. Want that update?`
          : `They have ${slot.display_time} available for ${newParty}. Want me to update it?`;
        return makeAssistantPayload({
          conversationId,
          spokenText: prompt,
          intent: "reservation_modify",
          step: "confirm",
          nextExpectedInput: "confirmation",
          booking: {
            pending_action: {
              type: "modify_reservation",
              payload: {
                reservation_id: reservationId,
                restaurant_id: currentRestaurantId,
                party_size: newParty,
                date: newDate,
                time: slot.display_time,
                shift_id: slot.shift_id,
                slot_iso: slot.date_time,
              },
              confirmation_text: prompt,
            },
          },
        });
      }
    }
    return makeAssistantPayload({
      conversationId,
      spokenText: "I need to check that change before updating it. What date and time should I check?",
      intent: "reservation_modify",
      step: "choose_date",
      nextExpectedInput: "date",
    });
  }

  const restaurants = await fetchActiveRestaurants();
  const namedRestaurants = findNamedRestaurants(transcript, restaurants);
  const rawNamedMatchCount = restaurants.filter((row) =>
    restaurantNameMatchesTranscript(row, normalized)
  ).length;
  const selectedRestaurant = currentRestaurantId
    ? restaurants.find((row) => row.id === currentRestaurantId) ?? null
    : null;
  const looksLikeRestaurantSelection =
    namedRestaurants.length > 0 &&
    !menuQuestionIntent(transcript) &&
    (
      directBookingIntent(transcript) ||
      bookingState.party_size != null ||
      typeof bookingState.date === "string" ||
      typeof bookingState.time === "string" ||
      currentRestaurantId != null ||
      currentStatus === "collecting_minimum_fields" ||
      currentStatus === "loading_availability" ||
      currentStatus === "awaiting_time_selection"
    );

  if (menuQuestionIntent(transcript)) {
    if (/\bpre[- ]?order|pay|payment|deposit|apple pay|points|rewards?\b/i.test(transcript)) {
      return makeAssistantPayload({
        conversationId,
        spokenText: "Preorder and payment are separate from booking. I can show the menu after the reservation is confirmed.",
        intent: "preorder_food",
        step: "done",
        nextExpectedInput: "none",
      });
    }
    const named = namedRestaurants[0] ?? selectedRestaurant;
    if (!named) {
      return makeAssistantPayload({
        conversationId,
        spokenText: "Which restaurant should I check the menu for?",
        intent: "menu_question",
        step: "choose_restaurant",
        nextExpectedInput: "restaurant",
      });
    }
    const keyword = /\b(steak|pasta|pizza|tiramisu|alcohol|kids meals?|vegan|gluten[- ]free|spicy|onions?)\b/i.exec(transcript)?.[1] ?? "";
    const { data: items } = await supabaseAdmin
      .from("menu_items")
      .select("name, description, dietary_flags, allergens, is_available")
      .eq("restaurant_id", named.id)
      .eq("is_active", true)
      .limit(80);
    const match = keyword
      ? (items ?? []).find((item) =>
        normalizeSearchText(String(item.name ?? "")).includes(normalizeSearchText(keyword)) ||
        normalizeSearchText(String(item.description ?? "")).includes(normalizeSearchText(keyword)) ||
        JSON.stringify(item.dietary_flags ?? []).toLowerCase().includes(keyword.toLowerCase())
      )
      : null;
    return makeAssistantPayload({
      conversationId,
      spokenText: match
        ? `${named.name} lists ${match.name}. I don't guarantee allergens, so confirm serious restrictions with the restaurant.`
        : `I don't see that confirmed on ${named.name}'s menu. I can add it as a note or show similar restaurants.`,
      intent: "menu_question",
      step: "done",
      nextExpectedInput: "none",
    });
  }

  if (hasUncertainPartySize(transcript)) {
    const range = parsePartySizeRange(transcript);
    return makeAssistantPayload({
      conversationId,
      spokenText: range ? `I can book for ${range.max} to be safe. Should I use ${range.max}?` : "What party size should I use?",
      intent: "reservation_create",
      step: "confirm",
      nextExpectedInput: "confirmation",
      booking: range ? {
        pending_action: {
          type: "modify_reservation",
          payload: { party_size: range.max },
          confirmation_text: `Use ${range.max} guests?`,
        },
      } : null,
    });
  }

  if (allergyIntent(transcript)) {
    const rows = topRecommendationRows(restaurants, transcript, await opts.getUserCity());
    const warning = /\ballerg/i.test(transcript)
      ? "For serious allergies, confirm with the restaurant; I can add a reservation note. "
      : "I don't have certification confirmed, but I can use it as a preference. ";
    return makeAssistantPayload({
      conversationId,
      spokenText: `${warning}${buildOptionsPrompt(rows).replace(/^I found /, "I found ")}`,
      intent: "restaurant_search",
      step: rows.length ? "choose_restaurant" : "choose_cuisine",
      nextExpectedInput: rows.length ? "restaurant" : "cuisine",
      uiActions: rows.length ? [
        { type: "show_restaurant_cards", restaurant_ids: rows.map((row) => row.id) },
        { type: "update_map_markers", restaurant_ids: rows.map((row) => row.id) },
        { type: "highlight_restaurant", restaurant_id: rows[0].id },
      ] : [],
      booking: { special_request: transcript },
      map: rows.length ? {
        visible: true,
        marker_restaurant_ids: rows.map((row) => row.id),
        highlighted_restaurant_id: rows[0].id,
      } : null,
    });
  }

  if (accessibilityIntent(transcript)) {
    if (directBookingIntent(transcript) || /\btable\b/i.test(transcript)) {
      return makeAssistantPayload({
        conversationId,
        spokenText: "I can't verify accessibility here, but I can add it as a note. How many guests?",
        intent: "reservation_create",
        step: "choose_party",
        nextExpectedInput: "party_size",
        booking: { special_request: transcript },
      });
    }
    const rows = topRecommendationRows(restaurants, transcript, await opts.getUserCity());
    return makeAssistantPayload({
      conversationId,
      spokenText: `I can't verify accessibility here, but I can add a note. ${buildOptionsPrompt(rows)}`,
      intent: "restaurant_search",
      step: rows.length ? "choose_restaurant" : "choose_cuisine",
      nextExpectedInput: rows.length ? "restaurant" : "cuisine",
      uiActions: rows.length ? [
        { type: "show_restaurant_cards", restaurant_ids: rows.map((row) => row.id) },
        { type: "update_map_markers", restaurant_ids: rows.map((row) => row.id) },
        { type: "highlight_restaurant", restaurant_id: rows[0].id },
      ] : [],
      booking: { special_request: transcript },
      map: rows.length ? {
        visible: true,
        marker_restaurant_ids: rows.map((row) => row.id),
        highlighted_restaurant_id: rows[0].id,
      } : null,
    });
  }

  if (requestedHotelLocation(transcript)) {
    return makeAssistantPayload({
      conversationId,
      spokenText: "What hotel or address should I search near?",
      intent: "restaurant_search",
      step: "choose_location",
      nextExpectedInput: "location",
    });
  }

  if (/\boffice\b/i.test(transcript) && /\bnear|around|close|by\b/i.test(transcript)) {
    return makeAssistantPayload({
      conversationId,
      spokenText: "What office address should I search near?",
      intent: "reservation_create",
      step: "choose_location",
      nextExpectedInput: "location",
      booking: {
        ...(partySize != null ? { party_size: partySize } : {}),
        ...(date ? { date } : {}),
        ...(time ? { time } : {}),
        ...(/\bcompany name\b/i.test(transcript) ? { special_request: "Book under company name." } : {}),
      },
    });
  }

  if (
    directBookingIntent(transcript) &&
    !namedRestaurants.length &&
    /\b(italian|french|thai|japanese|sushi|steakhouse|mediterranean|nice|romantic|business|family|cheap|quiet|place|somewhere|restaurant)\b/i.test(transcript)
  ) {
    const rows = topRecommendationRows(restaurants, transcript, await opts.getUserCity());
    if (rows.length) {
      const bookingPatch = {
        status: "collecting_minimum_fields",
        ...(partySize != null ? { party_size: partySize } : {}),
        ...(date ? { date } : {}),
        ...(time ? { time } : {}),
      };
      return makeAssistantPayload({
        conversationId,
        spokenText: buildOptionsPrompt(rows),
        intent: "restaurant_search",
        step: "choose_restaurant",
        nextExpectedInput: "restaurant",
        uiActions: [
          { type: "show_restaurant_cards", restaurant_ids: rows.map((row) => row.id) },
          { type: "update_map_markers", restaurant_ids: rows.map((row) => row.id) },
          { type: "highlight_restaurant", restaurant_id: rows[0].id },
          ...(partySize != null ? [{ type: "set_booking_field", field: "party_size", value: partySize }] : []),
          ...(date ? [{ type: "set_booking_field", field: "date", value: date }] : []),
          ...(time ? [{ type: "set_booking_field", field: "time", value: time }] : []),
        ],
        booking: bookingPatch,
        map: {
          visible: true,
          marker_restaurant_ids: rows.map((row) => row.id),
          highlighted_restaurant_id: rows[0].id,
        },
      });
    }
  }

  if (
    directBookingIntent(transcript) &&
    !namedRestaurants.length &&
    !/\b(cuisine|italian|french|thai|japanese|sushi|steakhouse|restaurant like|somewhere|something nice|nice place)\b/i.test(transcript)
  ) {
    return makeAssistantPayload({
      conversationId,
      spokenText: partySize == null ? "How many guests?" : "Which restaurant or area should I check?",
      intent: "reservation_create",
      step: partySize == null ? "choose_party" : "choose_location",
      nextExpectedInput: partySize == null ? "party_size" : "location",
      booking: {
        ...(partySize != null ? { party_size: partySize } : {}),
        ...(date ? { date } : {}),
        ...(time ? { time } : {}),
      },
    });
  }

  if (namedRestaurants.length > 1 && looksLikeRestaurantSelection) {
    const labels = namedRestaurants.slice(0, 3).map(restaurantLabel);
    return makeAssistantPayload({
      conversationId,
      spokenText: `I found a few: ${labels.join("; ")}. Which location did you mean?`,
      intent: "select_restaurant",
      step: "choose_restaurant",
      nextExpectedInput: "restaurant",
      uiActions: [
        { type: "show_restaurant_cards", restaurant_ids: namedRestaurants.map((row) => row.id) },
        { type: "update_map_markers", restaurant_ids: namedRestaurants.map((row) => row.id) },
        { type: "highlight_restaurant", restaurant_id: namedRestaurants[0].id },
      ],
      map: {
        visible: true,
        marker_restaurant_ids: namedRestaurants.map((row) => row.id),
        highlighted_restaurant_id: namedRestaurants[0].id,
      },
      booking: {
        ...(partySize != null ? { party_size: partySize } : {}),
        ...(date ? { date } : {}),
        ...(time ? { time } : {}),
      },
    });
  }

  if (namedRestaurants.length === 1 && rawNamedMatchCount > 1 && looksLikeRestaurantSelection) {
    const restaurant = namedRestaurants[0];
    return makeAssistantPayload({
      conversationId,
      spokenText: `I found ${restaurantLabel(restaurant)}. Is that the location you mean?`,
      intent: "select_restaurant",
      step: "choose_restaurant",
      nextExpectedInput: "confirmation",
      uiActions: [
        { type: "show_restaurant_cards", restaurant_ids: [restaurant.id] },
        { type: "update_map_markers", restaurant_ids: [restaurant.id] },
        { type: "highlight_restaurant", restaurant_id: restaurant.id },
      ],
      map: {
        visible: true,
        marker_restaurant_ids: [restaurant.id],
        highlighted_restaurant_id: restaurant.id,
      },
      booking: {
        ...(partySize != null ? { party_size: partySize } : {}),
        ...(date ? { date } : {}),
        ...(time ? { time } : {}),
      },
    });
  }

  if (namedRestaurants.length === 1 && looksLikeRestaurantSelection) {
    const restaurant = namedRestaurants[0];
    const bookingPatch: Record<string, unknown> = {
      restaurant_id: restaurant.id,
      restaurant_name: restaurant.name,
      status: "collecting_minimum_fields",
      ...(partySize != null ? { party_size: partySize } : {}),
      ...(date ? { date } : {}),
      ...(time ? { time } : {}),
    };
    const baseActions: FollowUpAction[] = [
      { type: "highlight_restaurant", restaurant_id: restaurant.id },
      { type: "start_booking", restaurant_id: restaurant.id },
      ...(partySize != null ? [{ type: "set_booking_field", field: "party_size", value: partySize }] : []),
      ...(date ? [{ type: "set_booking_field", field: "date", value: date }] : []),
      ...(time ? [{ type: "set_booking_field", field: "time", value: time }] : []),
    ];

    if (privateOrLargePartyIntent(transcript, partySize)) {
      return makeAssistantPayload({
        conversationId,
        spokenText: `Large or private-room bookings may need restaurant approval. I can add that request for ${restaurant.name}.`,
        intent: "reservation_create",
        step: "confirm",
        nextExpectedInput: "confirmation",
        uiActions: baseActions,
        booking: {
          ...bookingPatch,
          special_request: transcript,
          pending_action: {
            type: "modify_reservation",
            payload: { restaurant_id: restaurant.id, special_request: transcript },
            confirmation_text: "Add private-room or large-party request?",
          },
        },
      });
    }

    if (partySize == null && hasAmbiguousBareTwelve(transcript) && date) {
      return makeAssistantPayload({
        conversationId,
        spokenText: `How many guests, and is 12 noon or midnight on ${formatBookingDateForSpeech(date)}?`,
        intent: "reservation_create",
        step: "choose_party",
        nextExpectedInput: "party_size",
        uiActions: baseActions,
        booking: bookingPatch,
      });
    }
    if (partySize == null) {
      return makeAssistantPayload({
        conversationId,
        spokenText: "How many guests?",
        intent: "reservation_create",
        step: "choose_party",
        nextExpectedInput: "party_size",
        uiActions: baseActions,
        booking: bookingPatch,
      });
    }
    if (!date) {
      return makeAssistantPayload({
        conversationId,
        spokenText: "What date and time?",
        intent: "reservation_create",
        step: "choose_date",
        nextExpectedInput: "date",
        uiActions: baseActions,
        booking: bookingPatch,
      });
    }
    if (hasAmbiguousBareTwelve(transcript)) {
      return makeAssistantPayload({
        conversationId,
        spokenText: `Do you mean ${formatBookingDateForSpeech(date)} at noon or midnight?`,
        intent: "reservation_create",
        step: "choose_time",
        nextExpectedInput: "time",
        uiActions: baseActions,
        booking: bookingPatch,
      });
    }
    if (!time) {
      return makeAssistantPayload({
        conversationId,
        spokenText: "What time?",
        intent: "reservation_create",
        step: "choose_time",
        nextExpectedInput: "time",
        uiActions: baseActions,
        booking: bookingPatch,
      });
    }

    const availability = await getAvailability(restaurant.id, date, partySize);
    const nearest = findNearestSlot(availability.slots ?? [], time);
    if (!nearest) {
      const offered = (availability.slots ?? []).slice(0, 2).map((slot) => slot.display_time);
      return makeAssistantPayload({
        conversationId,
        spokenText: offered.length
          ? `${restaurant.name} has no tables at ${formatTimeForSpeech(time)} for ${partySize}. They have ${offered.join(" or ")}.`
          : `${restaurant.name} has no tables at ${formatTimeForSpeech(time)} for ${partySize}. What date and time would you like instead?`,
        intent: "reservation_create",
        step: "choose_time",
        nextExpectedInput: "time",
        uiActions: [...baseActions, { type: "load_availability" }],
        booking: bookingPatch,
      });
    }

    const duplicate = await duplicateReservationForSlot(opts.userProfileId, restaurant.id, nearest.date_time);
    if (duplicate) {
      return makeAssistantPayload({
        conversationId,
        spokenText: `You already have ${restaurant.name} booked at ${nearest.display_time}. Keep that one or choose another time?`,
        intent: "confirm_booking",
        step: "confirm",
        nextExpectedInput: "confirmation",
        booking: {
          ...bookingPatch,
          reservation_id: duplicate.id,
          confirmation_code: duplicate.confirmation_code ?? null,
        },
      });
    }

    return makeAssistantPayload({
      conversationId,
      spokenText: buildBookingConfirmationPrompt({
        restaurantName: restaurant.name ?? null,
        partySize,
        date,
        time: nearest.display_time,
      }),
      intent: "confirm_booking",
      step: "confirm",
      nextExpectedInput: "confirmation",
      uiActions: [
        ...baseActions,
        { type: "load_availability" },
        { type: "select_time_slot", slot_iso: nearest.date_time, shift_id: nearest.shift_id },
        { type: "set_booking_field", field: "time", value: nearest.display_time },
        { type: "confirm_booking" },
      ],
      booking: {
        ...bookingPatch,
        time: nearest.display_time,
        shift_id: nearest.shift_id,
        slot_iso: nearest.date_time,
        status: "confirming",
      },
    });
  }

  if (directBookingIntent(transcript) && partySize != null && date && time && !currentRestaurantId) {
    return makeAssistantPayload({
      conversationId,
      spokenText: "Which restaurant or area should I check?",
      intent: "reservation_create",
      step: "choose_location",
      nextExpectedInput: "location",
      booking: { party_size: partySize, date, time },
    });
  }

  if (discoveryIntent(transcript) && !directBookingIntent(transcript) && !namedRestaurants.length) {
    const rows = topRecommendationRows(restaurants, transcript, await opts.getUserCity());
    if (!rows.length) return null;
    const prefix = extractCuisineHint(transcript) === "sushi" && !rows.some((row) => /sushi/i.test(`${row.name} ${row.cuisine_type}`))
      ? "I don't see sushi near you yet. "
      : "";
    return makeAssistantPayload({
      conversationId,
      spokenText: buildOptionsPrompt(rows, prefix),
      intent: "restaurant_search",
      step: "choose_restaurant",
      nextExpectedInput: rows.length === 1 ? "confirmation" : "restaurant",
      uiActions: [
        { type: "show_restaurant_cards", restaurant_ids: rows.map((row) => row.id) },
        { type: "update_map_markers", restaurant_ids: rows.map((row) => row.id) },
        { type: "highlight_restaurant", restaurant_id: rows[0].id },
      ],
      map: {
        visible: true,
        marker_restaurant_ids: rows.map((row) => row.id),
        highlighted_restaurant_id: rows[0].id,
      },
    });
  }

  return null;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  return streamSse(async (send) => {
    const latency = createLatencyTimer("cenaiva-orchestrate");
    // Auth — surfaced as in-band SSE error frames so the single response
    // type is always text/event-stream. Client orchestrator hook reads
    // the error frame and converts it back to the same error states the
    // legacy JSON path used (not_authenticated, http_401, etc.).
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const payload = decodeJwtPayload(token);
    if (!payload?.sub) {
      send({ type: "error", message: "Unauthorized", status: 401 });
      latency.done({ path: "unauthorized" });
      return;
    }

    const { data: userProfile } = await latency.time("profile", () =>
      supabaseAdmin
        .from("user_profiles")
        .select("id, full_name, email")
        .eq("auth_user_id", payload.sub as string)
        .single()
    );
    if (!userProfile) {
      send({ type: "error", message: "User profile not found", status: 401 });
      latency.done({ path: "missing_profile" });
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
      timezone?: string;
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
      timezone: requestTimeZone,
      conversation_id: incomingConvId,
      has_saved_card = false,
    } = body;
    const effectiveTimeZone =
      typeof requestTimeZone === "string" && requestTimeZone.trim()
        ? requestTimeZone.trim()
        : "America/Toronto";

    // Mutable selection — the server may promote a voice "yes" into an
    // explicit selection when the map is already narrowed to one restaurant.
    let selected_restaurant_id: string | null = bodySelectedRestaurantId;

    // When the user confirms a single-result search with "yes" / "yeah" / etc.,
    // treat it as explicit selection of that one restaurant so the LLM doesn't
    // have to infer it (and, crucially, doesn't mistake the "yes" for yes-to-
    // preorder and jump straight to the menu).
    const currentStatus = (booking_state.status as string | null | undefined) ?? "idle";
    // Snapshot before transcript/history prefill mutates booking_state below.
    // The retry guard later needs to know what was missing at request start.
    const hadPartyAtRequestStart =
      (booking_state.party_size as number | null | undefined) != null;
    const hadDateAtRequestStart =
      typeof booking_state.date === "string" && booking_state.date.trim().length > 0;
    const hadTimeAtRequestStart =
      typeof booking_state.time === "string" && booking_state.time.trim().length > 0;
    const isNegativeConfirmation = isNegativeText(transcript);
    const isAffirmative = isSafeBookingConfirmationText(transcript);
    if (
      !selected_restaurant_id &&
      isAffirmative &&
      visible_restaurant_ids.length === 1 &&
      (currentStatus === "idle" || currentStatus === "collecting_minimum_fields")
    ) {
      selected_restaurant_id = visible_restaurant_ids[0];
    }

    // Pre-fill booking_state from the current transcript so the system prompt
    // sees party_size/date as SET. Without this the model was ignoring its own
    // set_booking_field action across turns and re-asking the same questions.
    const preFilled: { party_size?: number; date?: string; time?: string } = {};
    if (transcript) {
      if (booking_state.party_size == null) {
        const n = parsePartySize(transcript);
        if (n != null) {
          booking_state.party_size = n;
          preFilled.party_size = n;
        }
      }
      if (booking_state.date == null) {
        const d = parseDateInTimeZone(transcript, effectiveTimeZone);
        if (d) {
          booking_state.date = d;
          preFilled.date = d;
        }
      }
      // Pre-fill time the same way: when the user answers a date+time prompt
      // ("tomorrow at 7pm"), the LLM was occasionally emitting set_booking_field
      // for date but dropping the time, so the next turn saw time=MISSING and
      // re-asked. Mirror the parsePartySize/parseDate pattern so time survives.
      if (booking_state.time == null) {
        const t = parseTime(transcript);
        if (t) {
          booking_state.time = t;
          preFilled.time = t;
        }
      }
    }

    // Conversation persistence
    let conversationId = incomingConvId;
    if (!conversationId) {
      const { data: conv } = await latency.time("conversation_create", () =>
        supabaseAdmin
          .from("chat_conversations")
          .insert({ user_profile_id: userProfileId, language: "en", title: "Voice booking" })
          .select("id")
          .single()
      );
      conversationId = conv?.id ?? crypto.randomUUID();
    }

    const activeConversationId = conversationId!;
    let userCityCache: string | null = null;
    const getUserCity = async () => {
      if (userCityCache != null) return userCityCache;
      userCityCache = user_location
        ? await latency.time("resolve_city", () => resolveCity(user_location.lat, user_location.lng))
        : "";
      return userCityCache;
    };

    type HistoryRow = { role: string; content: string; metadata: unknown };
    let history: HistoryRow[] = [];
    let historyLoaded = false;
    const loadHistory = async () => {
      if (historyLoaded) return history;
      // Load last 12 messages. 40 was paying ~30% extra LLM input tokens + DB
      // load every turn for context the booking flow doesn't need — the system
      // prompt + booking-state checklist already encode the state machine.
      const { data } = await latency.time("history", () =>
        supabaseAdmin
          .from("chat_messages")
          .select("role, content, metadata")
          .eq("conversation_id", activeConversationId)
          .order("created_at", { ascending: false })
          .limit(12)
      );
      history = (data ?? []) as HistoryRow[];
      historyLoaded = true;
      return history;
    };

    const userContentForPersistence = transcript
      ? `User said: "${transcript}"`
      : "User opened the assistant.";
    const hasPendingAction = parsePendingAction(booking_state.pending_action) != null;
    const needsHistoryBeforePreflight =
      !hasPendingAction &&
      !selected_restaurant_id &&
      isAffirmative &&
      (currentStatus === "idle" || currentStatus === "collecting_minimum_fields");
    let triedPreflightBeforeHistory = false;

    if (!needsHistoryBeforePreflight) {
      triedPreflightBeforeHistory = true;
      const preflightResponse = await latency.time("preflight", () => buildPreflightResponse({
        conversationId: activeConversationId,
        transcript,
        bookingState: booking_state,
        selectedRestaurantId: selected_restaurant_id,
        userProfileId,
        getUserCity,
        timezone: effectiveTimeZone,
      }));
      if (preflightResponse) {
        await sendEarlyFinal(
          send,
          activeConversationId,
          userContentForPersistence,
          preflightResponse,
        );
        latency.done({ path: "preflight" });
        return;
      }
    }

    history = await loadHistory();

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

    if (!triedPreflightBeforeHistory) {
      const preflightResponse = await latency.time("preflight", () => buildPreflightResponse({
        conversationId: activeConversationId,
        transcript,
        bookingState: booking_state,
        selectedRestaurantId: selected_restaurant_id,
        userProfileId,
        getUserCity,
        timezone: effectiveTimeZone,
      }));
      if (preflightResponse) {
        await sendEarlyFinal(
          send,
          activeConversationId,
          userContentForPersistence,
          preflightResponse,
        );
        latency.done({ path: "preflight_after_history" });
        return;
      }
    }

    const userCity = await getUserCity();

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
    // may have said "for 4 tomorrow at 5pm" 5 turns ago and the model still
    // hasn't emitted set_booking_field. Don't let those fields stay MISSING.
    if (booking_state.party_size == null || booking_state.date == null || booking_state.time == null) {
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
          const d = parseDateInTimeZone(msg.content, effectiveTimeZone);
          if (d) {
            booking_state.date = d;
            preFilled.date = d;
          }
        }
        if (booking_state.time == null) {
          const t = parseTime(msg.content);
          if (t) {
            booking_state.time = t;
            preFilled.time = t;
          }
        }
        if (booking_state.party_size != null && booking_state.date != null && booking_state.time != null) break;
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
    // Resolved restaurant name (from rail tap, fuzzy match, or single-result
    // search). Captured early so it can be merged into bookingDelta below — the
    // BookingSheet confirmation card has nothing to render without it.
    let resolvedRestaurantName: string | null = null;
    if (visible_restaurant_ids.length) {
      const cachedRows = activeRestaurantsCache?.rows.filter((row) =>
        visible_restaurant_ids.slice(0, 8).includes(row.id)
      );
      const visRows = cachedRows?.length
        ? cachedRows.map((row) => ({ id: row.id, name: row.name ?? "", cuisine_type: row.cuisine_type ?? null }))
        : (await latency.time("visible_restaurants", () =>
          supabaseAdmin
            .from("restaurants")
            .select("id, name, cuisine_type")
            .in("id", visible_restaurant_ids.slice(0, 8))
        )).data;
      if (visRows?.length) {
        const rowsById = new Map(
          (visRows as Array<{ id: string; name: string; cuisine_type: string | null }>)
            .map((row) => [row.id, row] as const),
        );
        const rows = visible_restaurant_ids
          .slice(0, 8)
          .map((id) => rowsById.get(id))
          .filter((row): row is { id: string; name: string; cuisine_type: string | null } => !!row);
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
            resolvedRestaurantName = best.name;
          }
        }
      } else {
        visibleRestaurantsLine = `Visible restaurant IDs: ${visible_restaurant_ids.slice(0, 8).join(", ")}`;
      }
    }

    // If the client supplied a selected_restaurant_id (e.g. user tapped a card
    // in RestaurantRail), or any of the branches above promoted one, look its
    // name up from the visible rows so the BookingSheet confirmation can
    // render the restaurant. Falls back to a DB lookup when the row isn't in
    // the visible set (rare — happens if the rail was scrolled off-screen).
    if (selected_restaurant_id && !resolvedRestaurantName) {
      const matched = visibleRestaurantRows.find((r) => r.id === selected_restaurant_id);
      if (matched?.name) {
        resolvedRestaurantName = matched.name;
      } else {
        const { data: rRow } = await supabaseAdmin
          .from("restaurants")
          .select("name")
          .eq("id", selected_restaurant_id)
          .maybeSingle();
        if (rRow && typeof (rRow as { name?: string }).name === "string") {
          resolvedRestaurantName = (rRow as { name: string }).name;
        }
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

    await latency.time("user_persist", () =>
      supabaseAdmin.from("chat_messages").insert({
        conversation_id: conversationId,
        role: "user",
        content: userContent,
        metadata: { kind: "orchestrator" },
      })
    );

    const systemPrompt = buildSystemPrompt({
      firstName,
      userName,
      userCity,
      now: formatPromptNow(effectiveTimeZone),
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
    let lastSearchRows: VisibleRestaurant[] = [];
    let lastOrderId: string | null = (booking_state.order_id as string) ?? null;
    let lastTextReply = "";

    // Derived UI actions + deltas accumulated during tool execution.
    const derivedActions: FollowUpAction[] = [];
    const bookingDelta: Record<string, unknown> = {};
    if (resolvedRestaurantName) {
      bookingDelta.restaurant_name = resolvedRestaurantName;
    }
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
      const llmStream = await latency.time("openai_stream_open", () =>
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          max_tokens: 600,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          tools: TOOLS,
          tool_choice: isFirstTurnNoRestaurant ? "required" : "auto",
          stream: true,
        })
      );

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
              const safeChunk = safeStreamingSpeechChunk(flushed.chunk);
              if (safeChunk) {
                send({ type: "speech_chunk", text: safeChunk });
                chunksEmittedThisIter++;
              }
            }
          }
        }
      }
      latency.mark("openai_stream_read");

      // Flush any residual buffered text as a final speech chunk for this
      // iteration. Skipped when tool_calls were emitted (audio was discarded).
      if (!iterationHasToolCalls && speechBuffer.trim().length) {
        const safeChunk = safeStreamingSpeechChunk(speechBuffer);
        if (safeChunk) {
          send({ type: "speech_chunk", text: safeChunk });
          chunksEmittedThisIter++;
        }
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
              // Pull a wider candidate set so distance/rating/price re-sorting
              // in JS still has enough rows to surface a useful top-8.
              let query = supabaseAdmin
                .from("restaurants")
                .select("id, name, cuisine_type, city, description, address, lat, lng, slug, price_range, avg_rating")
                .eq("is_active", true)
                .limit(60);
              if (toolInput.cuisine_type) query = query.ilike("cuisine_type", `%${toolInput.cuisine_type}%`);
              if (toolInput.city) query = query.ilike("city", `%${toolInput.city}%`);
              if (typeof toolInput.price_range_max === "number") {
                query = query.lte("price_range", toolInput.price_range_max);
              }
              if (typeof toolInput.price_range_min === "number") {
                query = query.gte("price_range", toolInput.price_range_min);
              }
              if (typeof toolInput.min_rating === "number") {
                query = query.gte("avg_rating", toolInput.min_rating);
              }
              if (toolInput.query) {
                const words = toolInput.query.trim().split(/\s+/).filter((w: string) => w.length > 1);
                if (words.length) {
                  const conditions = words
                    .map((w: string) => `name.ilike.%${w}%,cuisine_type.ilike.%${w}%,city.ilike.%${w}%`)
                    .join(",");
                  query = query.or(conditions);
                }
              }

              // Promotion / event prefilters: intersect against the
              // restaurant_ids that satisfy the recommendation signal.
              let promoRestaurantIds: Set<string> | null = null;
              if (toolInput.with_active_promotion) {
                const nowIso = new Date().toISOString();
                const { data: promoRows } = await supabaseAdmin
                  .from("promotions")
                  .select("restaurant_id, ends_at, is_active")
                  .eq("is_active", true);
                promoRestaurantIds = new Set(
                  (promoRows ?? [])
                    .filter((p) => !p.ends_at || (p.ends_at as string) > nowIso)
                    .map((p) => p.restaurant_id as string),
                );
                if (promoRestaurantIds.size) {
                  query = query.in("id", Array.from(promoRestaurantIds));
                }
              }

              let eventRestaurantIds: Set<string> | null = null;
              if (typeof toolInput.event_keyword === "string" && toolInput.event_keyword.trim()) {
                const kw = toolInput.event_keyword.trim();
                const { data: eventRows } = await supabaseAdmin
                  .from("events")
                  .select("restaurant_id, name, theme, date")
                  .or(`name.ilike.%${kw}%,theme.ilike.%${kw}%,description.ilike.%${kw}%`)
                  .gte("date", new Date().toISOString().slice(0, 10));
                eventRestaurantIds = new Set(
                  (eventRows ?? []).map((e) => e.restaurant_id as string).filter(Boolean),
                );
                if (eventRestaurantIds.size) {
                  query = query.in("id", Array.from(eventRestaurantIds));
                }
              }

              // If a promo/event filter was requested but matched zero
              // restaurants, short-circuit with an empty result so we don't
              // accidentally return the unfiltered set.
              const requestedButEmpty =
                (toolInput.with_active_promotion && promoRestaurantIds && promoRestaurantIds.size === 0) ||
                (toolInput.event_keyword && eventRestaurantIds && eventRestaurantIds.size === 0);

              const { data: rawData, error } = requestedButEmpty
                ? { data: [] as Array<Record<string, unknown>>, error: null }
                : await query;
              // deno-lint-ignore no-explicit-any
              let data: any = rawData;

              // Distance + sort post-processing.
              if (!error && data) {
                let rows = data as SearchRestaurantRow[];

                const loc = user_location;
                const requestedCity =
                  typeof toolInput.city === "string" && toolInput.city.trim()
                    ? toolInput.city.trim()
                    : "";
                const normalizedRequestedCity = requestedCity ? normalizeCityName(requestedCity) : "";
                const normalizedUserCity = userCity ? normalizeCityName(userCity) : "";
                const requestedDifferentCity =
                  !!normalizedRequestedCity &&
                  !!normalizedUserCity &&
                  normalizedRequestedCity !== normalizedUserCity;
                const wantsNear =
                  !!loc &&
                  !requestedDifferentCity &&
                  (
                    toolInput.near_user === true ||
                    !normalizedRequestedCity ||
                    normalizedRequestedCity === normalizedUserCity
                  );
                if (wantsNear && loc && typeof loc.lat === "number" && typeof loc.lng === "number") {
                  const userLat = loc.lat;
                  const userLng = loc.lng;
                  const toRad = (deg: number) => (deg * Math.PI) / 180;
                  const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
                    const R = 6371;
                    const dLat = toRad(lat2 - lat1);
                    const dLng = toRad(lng2 - lng1);
                    const a =
                      Math.sin(dLat / 2) ** 2 +
                      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
                    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                  };
                  rows = rows
                    .map((r) => {
                      if (typeof r.lat === "number" && typeof r.lng === "number") {
                        r.distance_km = haversineKm(userLat, userLng, r.lat, r.lng);
                      }
                      return r;
                    })
                    .filter((r) => r.distance_km == null || r.distance_km <= 50);
                }

                const sortBy = toolInput.sort_by as string | undefined;
                const effectiveOccasion =
                  typeof toolInput.occasion === "string" && toolInput.occasion.trim()
                    ? toolInput.occasion.trim().toLowerCase()
                    : inferRecommendationOccasion(
                      [transcript, typeof toolInput.query === "string" ? toolInput.query : ""].join(" "),
                    );
                const vibeQuery = [
                  typeof toolInput.query === "string" ? toolInput.query : "",
                  typeof toolInput.cuisine_type === "string" ? toolInput.cuisine_type : "",
                  transcript,
                ].join(" ");

                if (sortBy === "rating") {
                  rows.sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0));
                } else if (sortBy === "distance" || (wantsNear && !sortBy)) {
                  rows.sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
                } else if (sortBy === "price_asc") {
                  rows.sort((a, b) => (a.price_range ?? 99) - (b.price_range ?? 99));
                } else if (sortBy === "price_desc") {
                  rows.sort((a, b) => (b.price_range ?? 0) - (a.price_range ?? 0));
                } else if (effectiveOccasion) {
                  rows.sort((a, b) =>
                    scoreRecommendationFit(b, effectiveOccasion, vibeQuery) -
                      scoreRecommendationFit(a, effectiveOccasion, vibeQuery) ||
                    (b.avg_rating ?? 0) - (a.avg_rating ?? 0),
                  );
                }

                data = rows.slice(0, 8);
                lastSearchRows = (data as SearchRestaurantRow[]).map((row) => ({
                  id: row.id,
                  name: row.name ?? "",
                  cuisine_type: row.cuisine_type ?? null,
                }));
                lastSearchIds = (data as Array<{ id: string }>).map((r) => r.id);
                derivedActions.push({ type: "update_map_markers", restaurant_ids: lastSearchIds });
                derivedActions.push({ type: "show_restaurant_cards", restaurant_ids: lastSearchIds });
                mapDelta.visible = true;
                mapDelta.marker_restaurant_ids = lastSearchIds;

                // Do not auto-select a recommendation result. Even when a
                // search/refinement collapses to one candidate, the shell
                // should surface that restaurant and wait for the user to
                // explicitly choose it (tap, say the name, or confirm "yes")
                // before start_booking runs.
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
            const authoritativeRestaurantId =
              (booking_state.restaurant_id as string | null | undefined) ??
              selected_restaurant_id ??
              toolInput.restaurant_id;
            const authoritativeShiftId =
              (booking_state.shift_id as string | null | undefined) ??
              toolInput.shift_id;
            const authoritativeSlotIso =
              (booking_state.slot_iso as string | null | undefined) ??
              toolInput.date_time;
            const authoritativePartySize =
              (booking_state.party_size as number | null | undefined) ??
              toolInput.party_size;
            const authoritativeDate =
              (booking_state.date as string | null | undefined) ??
              toolInput.date;
            const canFinalizeBooking =
              currentStatus === "confirming" &&
              isAffirmative &&
              !!authoritativeRestaurantId &&
              !!authoritativeShiftId &&
              !!authoritativeSlotIso &&
              !!authoritativeDate &&
              authoritativePartySize != null;

            if (!canFinalizeBooking) {
              toolResult = JSON.stringify({
                error:
                  "Cannot create the reservation yet. A live slot must be selected, booking_state.status must be confirming, and the latest user message must clearly confirm the exact booking summary. Do not call complete_booking yet.",
              });
              messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
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
              continue;
            }
            const liveAvailability = await getAvailability(
              authoritativeRestaurantId,
              authoritativeDate,
              authoritativePartySize,
            );
            const matchedSlot = (liveAvailability.slots ?? []).find(
              (slot) => slot.date_time === authoritativeSlotIso,
            );
            if (!matchedSlot) {
              toolResult = JSON.stringify({
                error:
                  "That slot is no longer available. Re-check availability and ask the user to choose a different time before confirming.",
              });
              derivedActions.push({ type: "load_availability" });
              bookingDelta.status = "loading_availability";
              messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
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
              continue;
            }
            const duplicate = await duplicateReservationForSlot(
              userProfileId,
              authoritativeRestaurantId,
              authoritativeSlotIso,
            );
            if (duplicate) {
              toolResult = JSON.stringify({
                error:
                  "The user already has a reservation at this restaurant and time. Do not create a duplicate booking; ask whether to keep it or choose another time.",
                reservation_id: duplicate.id,
                confirmation_code: duplicate.confirmation_code ?? null,
              });
              bookingDelta.reservation_id = duplicate.id;
              bookingDelta.confirmation_code = duplicate.confirmation_code ?? null;
              messages.push({ role: "tool", tool_call_id: tc.id, content: toolResult });
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
              continue;
            }
            const result = await completeBooking({
              user_profile_id: userProfileId,
              restaurant_id: authoritativeRestaurantId,
              order_type: "dine_in",
              date_time: authoritativeSlotIso,
              shift_id: authoritativeShiftId,
              party_size: authoritativePartySize,
              special_request:
                toolInput.special_request ??
                (booking_state.special_request as string | null | undefined),
              occasion:
                toolInput.occasion ??
                (booking_state.occasion as string | null | undefined),
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
              if (typeof authoritativeShiftId === "string") bookingDelta.shift_id = authoritativeShiftId;
              if (typeof authoritativeSlotIso === "string") bookingDelta.slot_iso = authoritativeSlotIso;
              if (matchedSlot?.display_time) {
                bookingDelta.time = matchedSlot.display_time;
              } else if (typeof booking_state.time === "string" && booking_state.time.trim()) {
                bookingDelta.time = booking_state.time;
              } else if (preFilled.time) {
                bookingDelta.time = preFilled.time;
              }
              if (typeof booking_state.date === "string" && booking_state.date.trim()) {
                bookingDelta.date = booking_state.date;
              } else if (preFilled.date) {
                bookingDelta.date = preFilled.date;
              }
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
                    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-02-24.acacia" });

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

    // ── Final confirmation + slot matching safety nets ──────────────────────
    // A matched time should never write a reservation immediately. We select
    // the live slot and move into `confirming`; only a later explicit yes
    // creates the reservation.
    let autoSelectedSlot: { shift_id: string; date_time: string; display_time: string } | null = null;
    let finalizedBooking:
      | { reservation_id: string; confirmation_code: string; display_time: string | null }
      | null = null;
    {
      const bsRestaurantId = (booking_state.restaurant_id as string | null | undefined) ?? selected_restaurant_id;
      const bsPartySize = booking_state.party_size as number | null | undefined;
      const bsDate = booking_state.date as string | null | undefined;
      const bsShiftId = booking_state.shift_id as string | null | undefined;
      const bsSlotIso = booking_state.slot_iso as string | null | undefined;
      const bsReservationId = booking_state.reservation_id as string | null | undefined;
      const canFinalize =
        currentStatus === "confirming" &&
        isAffirmative &&
        !!bsRestaurantId &&
        !!bsPartySize &&
        !!bsDate &&
        !!bsShiftId &&
        !!bsSlotIso &&
        !bsReservationId &&
        !lastReservationId;

      if (canFinalize) {
        const live = await getAvailability(bsRestaurantId!, bsDate!, bsPartySize!);
        const liveSlot = (live.slots ?? []).find((slot) => slot.date_time === bsSlotIso);
        if (!liveSlot) {
          derivedActions.push({ type: "load_availability" });
          bookingDelta.status = "loading_availability";
          lastTextReply = "That time is no longer available. Checking again.";
        } else {
          const duplicate = await duplicateReservationForSlot(userProfileId, bsRestaurantId!, liveSlot.date_time);
          if (duplicate) {
            bookingDelta.reservation_id = duplicate.id;
            bookingDelta.confirmation_code = duplicate.confirmation_code ?? null;
            lastTextReply = "You already have that booking. Keep it or choose another time?";
          } else {
            const result = await completeBooking({
              user_profile_id: userProfileId,
              restaurant_id: bsRestaurantId!,
              order_type: "dine_in",
              date_time: liveSlot.date_time,
              shift_id: liveSlot.shift_id,
              party_size: bsPartySize!,
              special_request: booking_state.special_request as string | null | undefined,
              occasion: booking_state.occasion as string | null | undefined,
            });
            if (result.success && result.reservation_id && result.confirmation_code) {
              lastReservationId = result.reservation_id;
              if (result.guest_id) lastGuestId = result.guest_id;
              finalizedBooking = {
                reservation_id: result.reservation_id,
                confirmation_code: result.confirmation_code,
                display_time: liveSlot.display_time,
              };
              derivedActions.push({
                type: "show_confirmation",
                confirmation_code: result.confirmation_code,
              });
              derivedActions.push({ type: "show_exit_x" });
              bookingDelta.reservation_id = result.reservation_id;
              bookingDelta.confirmation_code = result.confirmation_code;
              bookingDelta.shift_id = liveSlot.shift_id;
              bookingDelta.slot_iso = liveSlot.date_time;
              bookingDelta.time = liveSlot.display_time;
              bookingDelta.date = bsDate;
              bookingDelta.status = "offering_preorder";
            } else if (result.error) {
              lastTextReply = "I couldn't confirm that booking. Want another time?";
            }
          }
        }
      }
    }

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
            autoSelectedSlot = nearest;
            derivedActions.push({
              type: "select_time_slot",
              slot_iso: nearest.date_time,
              shift_id: nearest.shift_id,
            });
            derivedActions.push({ type: "confirm_booking" });
            bookingDelta.shift_id = nearest.shift_id;
            bookingDelta.slot_iso = nearest.date_time;
            bookingDelta.time = nearest.display_time;
            bookingDelta.date = bsDate;
            bookingDelta.status = "confirming";
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
    // immediately below (confirmation hard-overrides, prefilled-field emitter,
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
      lastSearchRestaurants: lastSearchRows,
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

    // Hard-override spoken_text for the safety rails above. A matched voice
    // time asks for final confirmation; only a later clear yes books it.
    if (finalizedBooking) {
      parsed.spoken_text = `You're booked for ${finalizedBooking.display_time ?? "that time"}. Want to pre-order from the menu?`;
      parsed.intent = "confirm_booking";
      parsed.step = "confirm";
      parsed.next_expected_input = "preorder_choice";
    } else if (
      bookingDelta.reservation_id &&
      bookingDelta.confirmation_code &&
      currentStatus === "confirming" &&
      isAffirmative
    ) {
      const confirmedTime =
        (bookingDelta.time as string | null | undefined) ??
        (booking_state.time as string | null | undefined) ??
        "that time";
      parsed.spoken_text = `You're booked for ${confirmedTime}. Want to pre-order from the menu?`;
      parsed.intent = "confirm_booking";
      parsed.step = "confirm";
      parsed.next_expected_input = "preorder_choice";
      parsed.booking = {
        ...((parsed.booking as Record<string, unknown> | null) ?? {}),
        status: "offering_preorder",
        reservation_id: bookingDelta.reservation_id,
        confirmation_code: bookingDelta.confirmation_code,
      };
      derivedActions.push({
        type: "show_confirmation",
        confirmation_code: bookingDelta.confirmation_code as string,
      });
      derivedActions.push({ type: "show_exit_x" });
    } else if (autoSelectedSlot) {
      const partyForPrompt =
        (booking_state.party_size as number | null | undefined) ??
        (preFilled.party_size as number | undefined) ??
        1;
      const dateForPrompt =
        (booking_state.date as string | null | undefined) ??
        (preFilled.date as string | undefined) ??
        "";
      parsed.spoken_text = buildBookingConfirmationPrompt({
        restaurantName: resolvedRestaurantName,
        partySize: partyForPrompt,
        date: dateForPrompt,
        time: autoSelectedSlot.display_time,
      });
      parsed.intent = "confirm_booking";
      parsed.step = "confirm";
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
    const bsShiftAfter =
      (booking_state.shift_id as string | null | undefined) ??
      (llmBooking?.shift_id as string | null | undefined) ??
      null;
    const bsRestaurantAfter =
      (booking_state.restaurant_id as string | null | undefined) ??
      (llmBooking?.restaurant_id as string | null | undefined) ??
      (llmSetField("restaurant_id") as string | null | undefined) ??
      null;
    const reservationAfter =
      (booking_state.reservation_id as string | null | undefined) ??
      (llmBooking?.reservation_id as string | null | undefined) ??
      lastReservationId ??
      null;
    const hasRestaurant = !!(selected_restaurant_id || bsRestaurantAfter);
    const hadPartyBeforeTurn = hadPartyAtRequestStart;
    const hadDateBeforeTurn = hadDateAtRequestStart;
    const attemptedReplyThisTurn = typeof transcript === "string" && transcript.trim().length > 0;
    const capturedPartyThisTurn = !hadPartyAtRequestStart && bsPartyAfter != null;
    const capturedDateThisTurn = !hadDateAtRequestStart && !!bsDateAfter;
    const capturedTimeThisTurn = !hadTimeAtRequestStart && !!bsTimeAfter;
    const lastAssistantContent =
      ((history ?? []).find((m) => m.role === "assistant")?.content ?? "").toLowerCase();
    const lastAskedParty =
      /how many|party size|guests|people|for how many|group size|your party|how large|how big|persons?\b/i.test(lastAssistantContent);
    const lastAskedDateTime =
      /what date and time|date and time|what day and time|when and what time/i.test(lastAssistantContent);
    const lastAskedTime =
      /what time|which time|what hour|when would you like to come/i.test(lastAssistantContent);

    const partyRetryPrompt = "How many guests?";
    const dateTimeRetryPrompt = "What date and time?";
    const timeRetryPrompt = "What time?";
    const retryingRequestedField =
      (attemptedReplyThisTurn && lastAskedParty && !hadPartyAtRequestStart && !capturedPartyThisTurn) ||
      (
        attemptedReplyThisTurn &&
        lastAskedDateTime &&
        (!hadDateAtRequestStart || !hadTimeAtRequestStart) &&
        !capturedDateThisTurn &&
        !capturedTimeThisTurn
      ) ||
      (attemptedReplyThisTurn && lastAskedTime && !hadTimeAtRequestStart && !capturedTimeThisTurn);

    if (attemptedReplyThisTurn && lastAskedParty && !hadPartyAtRequestStart && !capturedPartyThisTurn) {
      parsed.spoken_text = partyRetryPrompt;
      parsed.intent = "select_restaurant";
      parsed.step = "choose_party";
      parsed.next_expected_input = "party_size";
    } else if (
      attemptedReplyThisTurn &&
      lastAskedDateTime &&
      (!hadDateAtRequestStart || !hadTimeAtRequestStart) &&
      !capturedDateThisTurn &&
      !capturedTimeThisTurn
    ) {
      parsed.spoken_text = dateTimeRetryPrompt;
      parsed.intent = "choose_date";
      parsed.step = "choose_date";
      parsed.next_expected_input = "date";
    } else if (attemptedReplyThisTurn && lastAskedTime && !hadTimeAtRequestStart && !capturedTimeThisTurn) {
      parsed.spoken_text = timeRetryPrompt;
      parsed.intent = "choose_time";
      parsed.step = "choose_time";
      parsed.next_expected_input = "time";
    } else if (selected_restaurant_id && bsPartyAfter == null) {
      // Question 1 — party size only. (Single-result searches are auto-
      // promoted to selected_restaurant_id at search time, so this branch
      // also handles "user searched and one result came back" — no extra
      // confirmation step.)
      parsed.spoken_text = hadPartyBeforeTurn ? partyRetryPrompt : "How many guests?";
    } else if (selected_restaurant_id && bsPartyAfter != null && !bsDateAfter) {
      // Question 2a — date AND time together when neither was captured yet.
      parsed.spoken_text = hadPartyBeforeTurn ? dateTimeRetryPrompt : "What date and time?";
    } else if (selected_restaurant_id && bsPartyAfter != null && bsDateAfter && !bsTimeAfter) {
      // Question 2b — date already captured, only the time is still missing.
      parsed.spoken_text = hadDateBeforeTurn ? timeRetryPrompt : "What time?";
    }

    // Anti-repetition net: on ANY turn (not just the one where the user
    // selected a restaurant), if the model's spoken_text asks for a field
    // that's already SET, rewrite it to prompt for the next MISSING field.
    // Without this the model occasionally regresses a turn or two later
    // ("how many guests?" after party_size was already set) because a tool
    // result pushed the SET/MISSING checklist out of its attention window.
    if (!retryingRequestedField && hasRestaurant && typeof parsed.spoken_text === "string") {
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
          parsed.spoken_text = hadPartyBeforeTurn ? partyRetryPrompt : "How many guests?";
        } else if (!bsDateAfter) {
          // Question 2a — collect date + time together until the date lands.
          parsed.spoken_text = hadPartyBeforeTurn ? dateTimeRetryPrompt : "What date and time?";
        } else if (!bsTimeAfter) {
          // Question 2b — once the date is known, only re-prompt for time.
          parsed.spoken_text = hadDateBeforeTurn ? timeRetryPrompt : "What time?";
        } else {
          const hasAvailabilityAction = derivedActions.some(
            (action) => action.type === "load_availability",
          );
          const shouldQueueAvailability =
            !!bsRestaurantAfter &&
            bsPartyAfter != null &&
            !!bsDateAfter &&
            !bsShiftAfter &&
            !reservationAfter;

          // Never strand the user on a bare "Checking availability."
          // prompt. If the booking has enough info to load slots and the
          // model forgot to emit the action, queue it deterministically so
          // the client can continue the flow.
          if (shouldQueueAvailability && !hasAvailabilityAction) {
            derivedActions.push({ type: "load_availability" });
          }
          if (shouldQueueAvailability || hasAvailabilityAction || lastAvailabilitySlots.length > 0) {
            parsed.spoken_text = "Checking availability.";
          }
        }
      }
    }

    parsed.conversation_id = conversationId;
    // Ensure ui_actions is always a clean array — model occasionally returns null or nulls inside.
    if (!Array.isArray(parsed.ui_actions)) parsed.ui_actions = [];
    parsed.ui_actions = (parsed.ui_actions as Array<unknown>).filter(
      (a): a is Record<string, unknown> => a != null && typeof (a as Record<string, unknown>).type === "string",
    );

    const spokenText = typeof parsed.spoken_text === "string" ? parsed.spoken_text : "";
    const impliesAvailabilityLookup = /checking availability|checking for availability|checking available times|looking for available times/i.test(spokenText);
    if (impliesAvailabilityLookup) {
      const hasAvailabilityAction = derivedActions.some((action) => action.type === "load_availability");
      const canLoadAvailability =
        !!bsRestaurantAfter &&
        bsPartyAfter != null &&
        !!bsDateAfter &&
        !bsShiftAfter &&
        !reservationAfter;
      if (canLoadAvailability && !hasAvailabilityAction) {
        derivedActions.push({ type: "load_availability" });
      }
    }

    // ── Merge server-derived actions (from tool execution) ───────────────────
    // Prepend actions the server observed from tool calls. If the model
    // already emitted the same action type, we skip the duplicate to keep
    // the client reducer idempotent.
    const responseActions = parsed.ui_actions as Array<Record<string, unknown>>;
    const hasActionWith = (type: string, matchKey?: string, matchVal?: unknown) =>
      responseActions.some((a) =>
        a.type === type && (matchKey == null || a[matchKey] === matchVal),
      );
    for (const d of [...derivedActions].reverse()) {
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
    const existingReservationId =
      (booking_state.reservation_id as string | null | undefined) ?? null;
    const hasRealReservation =
      !!lastReservationId ||
      (!!responseReservationId && UUID_RE.test(responseReservationId)) ||
      (!!existingReservationId && UUID_RE.test(existingReservationId));
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
        "collecting_payment",
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
    const currentTime =
      (responseBooking?.time as string | null | undefined) ??
      (booking_state.time as string | null | undefined) ??
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
    if (preFilled.time && currentTime == null && !alreadySetsField("time")) {
      responseActions.push({ type: "set_booking_field", field: "time", value: preFilled.time });
      parsed.booking = { ...((parsed.booking as Record<string, unknown>) ?? {}), time: preFilled.time };
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
        const parsedDate = parseDateInTimeZone(transcript, effectiveTimeZone);
        if (parsedDate) {
          responseActions.push({ type: "set_booking_field", field: "date", value: parsedDate });
          parsed.booking = { ...((parsed.booking as Record<string, unknown>) ?? {}), date: parsedDate };
        }
      }
      if (currentTime == null && !alreadySetsField("time")) {
        const parsedTime = parseTime(transcript);
        if (parsedTime) {
          responseActions.push({ type: "set_booking_field", field: "time", value: parsedTime });
          parsed.booking = { ...((parsed.booking as Record<string, unknown>) ?? {}), time: parsedTime };
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
      parsed.spoken_text = "What kind of restaurant are you looking for?";
    } else if (typeof parsed.spoken_text === "string") {
      parsed.spoken_text = scrubGenericLookupPrompt(parsed.spoken_text);
    }

    await latency.time("assistant_persist", () =>
      supabaseAdmin.from("chat_messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: (parsed.spoken_text as string) ?? "",
        metadata: { kind: "orchestrator", full_response: parsed },
      })
    );

    send({ type: "final", payload: parsed });
    latency.done({ path: "llm" });
  });
});
