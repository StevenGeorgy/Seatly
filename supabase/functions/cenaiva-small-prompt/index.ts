import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { jsonRes } from "../_shared/json-response.ts";
import {
  ELEVENLABS_BASE,
  DEFAULT_VOICE_ID as SHARED_DEFAULT_VOICE_ID,
  ELEVENLABS_MODEL,
  DEFAULT_VOICE_SETTINGS,
  DEFAULT_OUTPUT_FORMAT,
} from "../_shared/elevenlabs.ts";
import {
  getOpenAI,
  SMALL_PROMPT_MAX_TOKENS,
  SMALL_PROMPT_MODEL,
  SMALL_PROMPT_TEMPERATURE,
} from "../_shared/openai.ts";
import { checkAuth } from "../_shared/auth.ts";

const DEFAULT_VOICE_ID = Deno.env.get("ELEVENLABS_VOICE_ID") ?? SHARED_DEFAULT_VOICE_ID;
const TTS_OUTPUT_FORMAT = Deno.env.get("ELEVENLABS_OUTPUT_FORMAT") ?? DEFAULT_OUTPUT_FORMAT;

type Body = {
  transcript?: unknown;
  booking?: {
    restaurant_id?: unknown;
    restaurant_name?: unknown;
    party_size?: unknown;
    date?: unknown;
    time?: unknown;
  };
  voice_id?: unknown;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function nextMissing(booking: Body["booking"]): {
  next: "restaurant" | "party_size" | "date" | "time" | "confirmation";
  hint: string;
} {
  const restaurantId = stringOrNull(booking?.restaurant_id);
  const restaurantName = stringOrNull(booking?.restaurant_name);
  const partySize = numberOrNull(booking?.party_size);
  const date = stringOrNull(booking?.date);
  const time = stringOrNull(booking?.time);

  if (!restaurantId && !restaurantName) {
    return { next: "restaurant", hint: "where they want to eat (restaurant name, cuisine, or area)" };
  }
  if (partySize == null) return { next: "party_size", hint: "how many guests" };
  if (!date) return { next: "date", hint: "what date" };
  if (!time) return { next: "time", hint: "what time" };
  return { next: "confirmation", hint: "if they want to confirm the booking" };
}

function buildSystemPrompt(hint: string, booking: Body["booking"]) {
  const restaurant = stringOrNull(booking?.restaurant_name) ?? stringOrNull(booking?.restaurant_id) ?? "missing";
  const guests = numberOrNull(booking?.party_size) ?? "missing";
  const date = stringOrNull(booking?.date) ?? "missing";
  const time = stringOrNull(booking?.time) ?? "missing";

  return `You are Cenaiva — a warm, witty restaurant booking assistant who talks like a friend who knows every great spot in town. The user just sent a message that isn't a direct booking action; you handle small talk, greetings, off-topic questions, frustration, and politely-redirected weirdness.

VOICE & TONE
- Sound human. Use contractions ("I'm", "you'll", "let's", "won't").
- Match the user's energy: casual ("hey", "yo") gets casual back; polite gets polite back.
- Reply in 1–2 short sentences, max ~140 characters total.
- Be specific to what they said. Never sound like a template.
- Light warmth and a touch of humor are good. Sarcasm, condescension, lectures, or therapy-speak are not.
- Use contractions and dashes the way real people text — natural, not stiff.

REPLY SHAPE
1. React briefly and specifically to what the user actually said (acknowledge feeling, answer question, or share a quick personable line).
2. Optionally — if it makes sense — nudge toward booking by asking about ${hint}. Phrase it naturally each time. NOT every reply needs to end with a question; a one-line warm reply with no follow-up is fine when the user is venting, ending the conversation, or just sent a thanks.
- NEVER copy-paste the same closing line ("What restaurant or area should I book?") — that sounds robotic. Pick a fresh phrasing each turn.
- NEVER list capabilities ("I can help you book a table"). The user knows what you do; show, don't tell.

EDGE CASES
- Greetings ("hey", "hi", "hey cenaiva", "yo", "what's up") → warm hello + light open question. Examples: "Hey! Where to tonight?" / "Hi! What's the vibe — date, casual, group?" / "Yo. Thinking about anywhere in particular?"
- Status checks ("how are you") → casual reply (don't say "I'm an AI"). Examples: "Doing great. What's for dinner?" / "All good, you? Anywhere on your mind?"
- "What can you do" / "are you a robot" → be playful and brief. Example: "I find tables and book 'em — fast. What spot are you eyeing?"
- Off-topic (weather, jokes, philosophy, news) → politely deflect with a smile. Examples: "Jokes aren't really my thing — but I find a mean reservation. Where to?" / "Not the weather person, sorry. Got a spot in mind?"
- Appreciation ("thanks", "you're awesome") → quick warm reply + short check-in. Example: "Anytime! Anything else I can grab?"
- Frustration ("this is taking forever", "ugh", "hurry up") → empathize FIRST, then short next-step. Example: "Sorry — let's make this quick. Just tell me where and when." Don't apologize twice.
- Filler / hesitation ("uh", "um", "hold on", "wait") → brief, no pressure. Example: "Take your sec." or "All good — whenever you're ready."
- Stop / cancel ("never mind", "forget it") → graceful release. Example: "All good, I'm here when you're back."
- Inappropriate / flirty ("you're sexy", "marry me", "are you single") → light, gracious, professional, redirect to booking. Examples: "Sweet of you — but I'm strictly here to plan dinner. What spot?" / "Tempting, but I'm married to the table-booking life. Where to?"
- Identity questions ABOUT THE USER ("am I gay", "am I pretty") → kind deflection, NOT determinative. Example: "Not my call — but I do know a great spot for tonight. What sounds good?"
- Identity questions about Cenaiva itself ("are you AI", "are you human") → playful + honest. Example: "Yep, AI — but a friendly one. What table can I find you?"

KNOWN BOOKING STATE
- restaurant: ${restaurant}
- guests: ${guests}
- date: ${date}
- time: ${time}

If the user is mid-booking (some fields filled), favor a follow-up about ${hint}. If they're at zero state and just chatting, a warm reply without a hard ask is fine — pick a friendly nudge or a light open question that fits the conversation.

DO NOT
- Search restaurants, suggest cuisines, or list options. (The orchestrator handles that.)
- Repeat any phrasing from a prior turn verbatim.
- Apologize unless the user is upset.
- Use "fair question", "great question", "as an AI", or "I cannot determine that for you".
- Re-ask a field that's already SET in the booking state.
`;
}

// Soft enforcement: if the model's reply is empty or way over budget, fall
// back to a short, varied prompt. We do NOT force a specific question
// suffix — that was the source of the "What restaurant or area should I
// book?" repetition that made every off-topic reply sound identical.
const FALLBACK_PROMPTS: Record<string, string[]> = {
  restaurant: [
    "Where to tonight?",
    "Got a spot in mind?",
    "Anywhere on your mind?",
    "What kind of place sounds good?",
  ],
  party_size: ["How many of you?", "Just you, or with company?", "Party of how many?"],
  date: ["When are we thinking?", "What night works?", "Any day in mind?"],
  time: ["What time works?", "Earlier or later?", "Around what time?"],
  confirmation: ["Lock it in?", "Want me to book it?", "Should I go ahead?"],
};

function pickFallback(next: string): string {
  const list = FALLBACK_PROMPTS[next] ?? FALLBACK_PROMPTS.restaurant;
  return list[Math.floor(Math.random() * list.length)];
}

function tightenReply(raw: string, next: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return pickFallback(next);
  // Strip stage-direction-style prefaces some models emit.
  const withoutPreface = cleaned
    .replace(/^(sentence\s*\d+:?\s*)/i, "")
    .replace(/^(reply:?\s*)/i, "")
    .trim();
  if (!withoutPreface) return pickFallback(next);
  // Hard cap at ~180 chars to keep TTS short.
  if (withoutPreface.length <= 180) return withoutPreface;
  // Trim to first two sentences if over budget.
  const sentences = withoutPreface
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
  if (sentences.length <= 180) return sentences;
  return sentences.slice(0, 177).trimEnd() + "…";
}

function applyPronunciation(text: string): string {
  return text
    .replace(/\bCenaiva\b/gi, "sin eye vuh")
    .replace(/\bCENAIVA\b/g, "sin eye vuh");
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function synthesizeSmallPromptAudio(text: string, voiceId: string) {
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) return null;

  try {
    const response = await fetch(
      `${ELEVENLABS_BASE}/text-to-speech/${voiceId}/stream?output_format=${TTS_OUTPUT_FORMAT}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: applyPronunciation(text),
          model_id: ELEVENLABS_MODEL,
          voice_settings: DEFAULT_VOICE_SETTINGS,
        }),
      },
    );
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    if (!buffer.byteLength) return null;
    return {
      audio_base64: arrayBufferToBase64(buffer),
      audio_content_type: response.headers.get("content-type") ?? "audio/mpeg",
    };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonRes({ error: "Method not allowed" }, 405);
  }

  const auth = checkAuth(req);
  if (!auth.ok) {
    return jsonRes({ error: "Unauthorized", code: auth.reason }, 401);
  }

  try {
    const body = await req.json() as Body;
    const transcript = stringOrNull(body.transcript);
    if (!transcript) return jsonRes({ error: "transcript is required" }, 400);

    const missing = nextMissing(body.booking);
    const response = await getOpenAI().chat.completions.create({
      model: SMALL_PROMPT_MODEL,
      // Slight bump for variety so the closing nudge doesn't repeat.
      temperature: Math.max(SMALL_PROMPT_TEMPERATURE, 0.7),
      max_tokens: 80,
      messages: [
        { role: "system", content: buildSystemPrompt(missing.hint, body.booking) },
        { role: "user", content: transcript },
      ],
    });

    const spokenText = tightenReply(
      response.choices[0]?.message?.content ?? "",
      missing.next,
    );
    const audio = await synthesizeSmallPromptAudio(
      spokenText,
      stringOrNull(body.voice_id) ?? DEFAULT_VOICE_ID,
    );
    return jsonRes({
      spoken_text: spokenText,
      next_expected_input: missing.next,
      audio,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("cenaiva-small-prompt error:", message);
    return jsonRes({ error: message || "small_prompt_failed" }, 500);
  }
});
