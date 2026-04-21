import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import OpenAI from "npm:openai@4";
import { corsHeaders } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { jsonRes } from "../_shared/json-response.ts";
import { decodeJwtPayload } from "../_shared/jwt.ts";
import { getAvailability } from "../_shared/availability.ts";
import { completeBooking, patchPostBooking } from "../_shared/booking.ts";

const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });
const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

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

function parsePartySize(raw: string): number | null {
  const t = raw.toLowerCase();
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
  const t = raw.toLowerCase();
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

BOOKING STATE (authoritative — trust these values exactly, never re-ask a SET field):
${bookingChecklist}
Current cart (${cart.length} items): ${cartSummary}.

PERSPECTIVE — You are the ASSISTANT. You are NEVER the guest.
- NEVER use first-person singular for ordering, eating, or booking. Forbidden phrasings: "I'd like...", "I'll have...", "I want...", "Let's get...", "I'm craving...", "for me".
- ALWAYS speak to the user in second person: "You've added X", "Your table is booked", "Would you like to pre-order?".
- The ONLY valid first-person uses are assistant actions ("Checking availability now.") or clarifications ("Didn't catch that — one more time?").
- Don't parrot the user's phrasing back as your own intent. If they say "I want sushi", you respond "Looking for sushi now." — not "I want sushi too."

Cenaiva handles DINE-IN RESERVATIONS AND PRE-ORDER PAYMENT ONLY.
Natural phrases like "I want food from X", "I feel like X", "I'm craving Italian", "let's grab dinner at X" are DINE-IN intents — treat them as restaurant discovery/booking and proceed normally. Do NOT say "I only handle dine-in bookings" for any of these.
Only deflect with "I only handle dine-in table bookings." when the user EXPLICITLY uses the words "pickup", "delivery", "takeout", "to-go", "drive-thru", or clearly asks for the food to be brought/delivered somewhere else.

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
4. Collect party_size and date via set_booking_field. Ask ONLY for fields marked MISSING in the BOOKING STATE checklist above — never re-ask a field that is already SET.
   4a. Parse natural-language answers from voice users into structured values and emit set_booking_field immediately:
       - party_size: "two" / "for 2" / "party of three" / "me and my wife" → 2/3/2. "a couple" → 2. "solo" / "just me" → 1.
       - date: "tonight" / "today" → today's YYYY-MM-DD. "tomorrow" → today+1. "Friday" / "next Saturday" → the next occurrence of that weekday in YYYY-MM-DD.
       - time: "7pm" → "19:00". "seven thirty" → "19:30". "noon" → "12:00".
   4b. If the BOOKING STATE checklist shows party_size SET and date SET, DO NOT ask for them again — call check_availability straight away.
   Call check_availability only once all three of restaurant_id, date, and party_size are SET. User picks slot → select_time_slot.
5. Call complete_booking → emit show_confirmation + show_exit_x.
6. Then emit offer_preorder and ask: "Want to pre-order from the menu?" (≤ 10 words).
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
          - "split" → emit navigate_to_checkout with order_id from create_preorder_order result, path="/r/{slug}?order_id={order_id}&step=checkout". DONE.
          - "single" AND hasSavedCard=true → call charge_saved_card with order_id and tip. Emit show_payment_success. DONE.
          - "single" AND hasSavedCard=false → emit navigate_to_checkout. DONE.

RULES:
- spoken_text ≤ 20 words. No filler ("Sure!", "Of course!", "Great choice!"). Direct.
- One question per turn.
- NEVER re-ask for a booking field that is already SET in the BOOKING STATE checklist — read the checklist first every turn.
- NEVER speak as if YOU are the guest (see PERSPECTIVE above).
- NEVER say "no reservations available" unless you've called check_availability and confirmed it returned no slots. If search_restaurants returns results, show them.
- NEVER call check_availability unless restaurant_id, date, AND party_size are all known.
- If you have enough info, act (emit actions) instead of asking.
- Never ask post-booking questions (occasion, dietary) BEFORE show_confirmation.
- Parse tip freely from natural speech. When unsure, default to 20% and confirm.
- Always echo the conversation_id in every response.
- All UI actions must use types from this list: ${UI_ACTION_TYPES.join(", ")}.`;
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
      selected_restaurant_id = null,
      user_location = null,
      conversation_id: incomingConvId,
      has_saved_card = false,
    } = body;

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

    // Load last 40 messages. 10 was too small — a single restaurant-picking
    // flow with 2-3 tool calls per turn would push the party_size/date answer
    // out of the window within a few turns, making the model re-ask for it.
    const { data: history } = await supabaseAdmin
      .from("chat_messages")
      .select("role, content, metadata")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(40);

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

    // Fetch names for the visible restaurants so the LLM has something to
    // fuzzy-match spoken transcripts against. Without names, STT jitter on a
    // proper noun (e.g. "Steven Georgy" → "steven gorgey") leaves the model
    // with no way to connect the user's reply to a candidate and it loops
    // "which restaurant?" forever.
    let visibleRestaurantsLine = "";
    if (visible_restaurant_ids.length) {
      const { data: visRows } = await supabaseAdmin
        .from("restaurants")
        .select("id, name, cuisine_type")
        .in("id", visible_restaurant_ids.slice(0, 8));
      if (visRows?.length) {
        visibleRestaurantsLine =
          "Visible restaurant candidates (match user's spoken reply against these names — spelling/pronunciation will be approximate):\n" +
          (visRows as Array<{ id: string; name: string; cuisine_type: string | null }>)
            .map((r) => `  - "${r.name}"${r.cuisine_type ? ` (${r.cuisine_type})` : ""} → id=${r.id}`)
            .join("\n");
      } else {
        visibleRestaurantsLine = `Visible restaurant IDs: ${visible_restaurant_ids.slice(0, 8).join(", ")}`;
      }
    }

    // Count how many turns in a row we've already asked the user to pick a
    // restaurant. If the last 2 assistant messages both asked "which one?",
    // the next turn MUST commit to a best-guess confirmation instead of
    // asking yet again.
    const recentAssistant = (history ?? [])
      .filter((m) => m.role === "assistant")
      .slice(0, 2)
      .map((m) => (m.content ?? "").toLowerCase());
    const repeatedWhichAsk = recentAssistant.filter((c) =>
      /which|would you like|pick one|choose/.test(c)
    ).length >= 2;

    const userContent = [
      transcript ? `User said: "${transcript}"` : "User opened the assistant.",
      selected_restaurant_id
        ? `⚠️ User has explicitly selected restaurant ID: ${selected_restaurant_id}. This selection is CONFIRMED — emit start_booking + highlight_restaurant and move to party_size. Do NOT ask which restaurant again.`
        : "",
      visibleRestaurantsLine,
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
    const MAX_ITER = 5;
    let iterations = 0;
    let lastReservationId: string | null = (booking_state.reservation_id as string) ?? null;
    let lastGuestId: string | null = null;
    let lastSearchIds: string[] = [];
    let lastOrderId: string | null = (booking_state.order_id as string) ?? null;
    let lastTextReply = "";

    // Derived UI actions + deltas accumulated during tool execution.
    const derivedActions: Array<Record<string, unknown>> = [];
    const bookingDelta: Record<string, unknown> = {};
    const mapDelta: Record<string, unknown> = {};
    const toolsExecuted: string[] = [];
    let lastCheckoutPath: string | null = null;

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

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 600,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        tools: TOOLS,
        tool_choice: isFirstTurnNoRestaurant ? "required" : "auto",
      });

      const choice = completion.choices[0];

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
              derivedActions.push({ type: "update_map_markers", restaurant_ids: lastSearchIds });
              derivedActions.push({ type: "show_restaurant_cards", restaurant_ids: lastSearchIds });
              mapDelta.visible = true;
              mapDelta.marker_restaurant_ids = lastSearchIds;
            }
            toolResult = error ? JSON.stringify({ error: error.message }) : JSON.stringify(data ?? []);
            didSearch = true; // break after — don't eagerly chain check_availability without date/party_size
          }

          // ── check_availability ────────────────────────────────────────────
          else if (toolName === "check_availability") {
            // Require all three fields — missing any means the model is guessing
            if (!toolInput.restaurant_id || !toolInput.date || toolInput.party_size == null) {
              toolResult = JSON.stringify({
                error: "Cannot check availability: restaurant_id, date (YYYY-MM-DD), and party_size are all required. Ask the user for any that are missing.",
              });
            } else {
              const result = await getAvailability(
                toolInput.restaurant_id,
                toolInput.date,
                toolInput.party_size,
              );
              toolResult = JSON.stringify(result);
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
          }

          // ── create_preorder_order ─────────────────────────────────────────
          else if (toolName === "create_preorder_order") {
            const { restaurant_id, reservation_id, items } = toolInput;
            if (!items?.length) {
              toolResult = JSON.stringify({ error: "No items provided." });
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
                const orderItems = items.map((item: { menu_item_id: string; name: string; quantity: number; unit_price: number }) => ({
                  order_id: order.id,
                  menu_item_id: item.menu_item_id,
                  name: item.name,
                  quantity: item.quantity,
                  unit_price: item.unit_price,
                  line_total: Math.round(item.unit_price * item.quantity * 100) / 100,
                  status: "pending",
                }));
                await supabaseAdmin.from("order_items").insert(orderItems);

                const checkoutPath = rest?.slug
                  ? `/r/${rest.slug}?order_id=${order.id}&step=checkout`
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

    // ── Final structured JSON turn ────────────────────────────────────────────
    // Ask the model to produce the full structured response. This is the core
    // JSON contract the web app consumes. Server-derived actions (from tool
    // execution above) and transcript parsers below are layered on top as
    // belt-and-suspenders so the UI always advances even when the model drops
    // an action.
    const jsonCompletion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 500,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
        {
          role: "user",
          content: (() => {
            const base = `Now respond with ONLY a valid JSON object. Required fields: conversation_id (must be "${conversationId}"), spoken_text (≤20 words), intent, step, ui_actions (array — never null), booking (object or null), map (object or null), filters (object or null), next_expected_input. Use only ui_action types from the approved list.`;
            const restaurantHint = selected_restaurant_id && !booking_state.party_size && !booking_state.date
              ? ` IMPORTANT: user selected restaurant ID "${selected_restaurant_id}". You MUST emit start_booking (restaurant_id="${selected_restaurant_id}") and highlight_restaurant actions. spoken_text must ask for party size and date — do NOT mention availability.`
              : "";
            const searchHint = lastSearchIds.length > 0
              ? ` IMPORTANT: search_restaurants just returned results. spoken_text must ask which restaurant the user wants — do NOT mention availability or reservations.`
              : "";
            return base + restaurantHint + searchHint;
          })(),
        },
      ],
      response_format: { type: "json_object" },
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

    // Hard-override spoken_text when a restaurant was just selected but we
    // still need party_size or date. The model often says "Booking X in Y."
    // instead of asking — which gives the user no prompt to continue.
    const bsPartyAfter = (booking_state.party_size as number | null | undefined) ?? null;
    const bsDateAfter = (booking_state.date as string | null | undefined) ?? null;
    if (selected_restaurant_id && bsPartyAfter == null && !bsDateAfter) {
      parsed.spoken_text = "How many guests, and what date?";
    } else if (selected_restaurant_id && bsPartyAfter == null) {
      parsed.spoken_text = "How many guests?";
    } else if (selected_restaurant_id && !bsDateAfter) {
      parsed.spoken_text = "What date?";
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

    // Merge server booking delta (tool execution) into parsed.booking.
    if (Object.keys(bookingDelta).length > 0) {
      parsed.booking = { ...((parsed.booking as Record<string, unknown>) ?? {}), ...bookingDelta };
    }
    // Merge server map delta.
    if (Object.keys(mapDelta).length > 0) {
      parsed.map = { ...((parsed.map as Record<string, unknown>) ?? {}), ...mapDelta };
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

    // Prevent unused-var warnings for state we track for downstream observability.
    void lastOrderId;
    void lastCheckoutPath;
    void lastGuestId;
    void lastReservationId;
    void lastTextReply;
    void toolsExecuted;

    await supabaseAdmin.from("chat_messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: (parsed.spoken_text as string) ?? "",
      metadata: { kind: "orchestrator", full_response: parsed },
    });

    return jsonRes(parsed);
  } catch (err) {
    const e = err as { message?: string; stack?: string; status?: number; code?: string };
    console.error("cenaiva-orchestrate error:", e?.message, e?.stack);
    return jsonRes(
      {
        error: e?.message ?? String(err),
        code: e?.code ?? null,
        kind: e?.status ? `upstream_${e.status}` : "unhandled",
      },
      500,
    );
  }
});
