// Starter eval scenarios — 25 conversations covering the 17 /goal capabilities
// plus edge cases (pivot, off-topic, ambiguity, out-of-pocket).
//
// Add more scenarios over time. Each becomes an automated test.
//
// Test fixture restaurants used:
//   - Jacobs & Co. Steakhouse: a1000007-1111-1111-1111-000000000007 (Toronto)
//   - Mark Testing:             aaa5e3d3-d8f2-4bae-8615-dc4e6ea83d2c (Guelph)

export type AssertSpec = {
  /** Which tool must have been called this turn. */
  tool_called?: string;
  /** Which tool must NOT have been called this turn. */
  no_tool_called?: string;
  /** Tool input must contain these keys/values (supports regex). */
  tool_input_contains?: { tool: string; expect: Record<string, unknown> };
  /** Booking state field must match (supports regex). */
  booking_field?: { field: string; equals: unknown };
  /** Spoken text must be <= N words. */
  max_words?: number;
  /** Layer 4: pass spoken text to LLM judge with this criteria string. */
  judge?: string;
};

export type EvalTurn = {
  user: string;
  expect: AssertSpec;
  /** Phase 4: Deepgram-style runner-up transcripts for this turn. */
  transcript_alternatives?: string[];
  /** Phase 3/4: override visible_restaurant_ids for this turn. */
  visible_restaurant_ids?: string[];
  /** Phase 5: override user_location for this turn (e.g. simulate Toronto). */
  user_location?: { lat: number; lng: number } | null;
};

export type EvalScenario = {
  id: string;
  capability: string;
  description: string;
  turns: EvalTurn[];
};

const JACOBS_ID = "a1000007-1111-1111-1111-000000000007";
const MARK_TESTING_ID = "aaa5e3d3-d8f2-4bae-8615-dc4e6ea83d2c";
const BATON_ROUGE_ID = "a1000003-1111-1111-1111-000000000003"; // Bâton Rouge Eaton Centre — Toronto
const HARBOUR_SIXTY_ID = "a1000001-1111-1111-1111-000000000001"; // Harbour Sixty Steakhouse — Toronto
const STK_TORONTO_ID = "a1000005-1111-1111-1111-000000000005"; // STK Toronto

// Approximate Toronto user location (used to prove "no silent city swap"
// when the user explicitly names a different city — Vancouver). Coords
// don't have to be precise; the orchestrator only uses them for distance-
// based ranking, and Phase 5 short-circuits to honest-empty before that.
const TORONTO_LATLNG = { lat: 43.6532, lng: -79.3832 };

export const SCENARIOS: EvalScenario[] = [
  // ── BOOKING: skip-ahead ───────────────────────────────────────────────
  {
    id: "book-skip-ahead-jacobs-tomorrow-8pm-party-2",
    capability: "book",
    description: "All slots in one utterance — must extract all 3 + fire check_availability.",
    turns: [
      {
        user: "book jacobs for 2 tomorrow at 8pm",
        expect: {
          tool_called: "check_availability",
          tool_input_contains: {
            tool: "check_availability",
            expect: { restaurant_id: JACOBS_ID, party_size: 2 },
          },
          booking_field: { field: "party_size", equals: 2 },
          judge: "Did NOT re-ask the user for party size, date, or time (since all 3 were given). Responded about availability at 8pm.",
        },
      },
    ],
  },
  {
    id: "book-skip-ahead-mark-testing-friday-7pm-party-4",
    capability: "book",
    description: "Different restaurant + day-name resolution.",
    turns: [
      {
        user: "I want a table at Mark Testing for 4 people Friday at 7pm",
        expect: {
          tool_called: "check_availability",
          tool_input_contains: { tool: "check_availability", expect: { restaurant_id: MARK_TESTING_ID, party_size: 4 } },
          booking_field: { field: "party_size", equals: 4 },
        },
      },
    ],
  },
  {
    id: "book-slot-by-slot",
    capability: "book",
    description: "User provides slots one at a time — orchestrator should collect without re-asking what's already given.",
    turns: [
      {
        user: "I want to book a table at Jacobs",
        expect: {
          booking_field: { field: "restaurant_id", equals: JACOBS_ID },
          judge: "Asked for party size OR date/time. Did NOT ask for restaurant again. Did NOT call complete_booking.",
        },
      },
      {
        user: "for 2 people",
        expect: {
          booking_field: { field: "party_size", equals: 2 },
          judge: "Asked for date and/or time. Did NOT re-ask for party size or restaurant.",
        },
      },
    ],
  },

  // ── BOOKING: mid-flow pivot ───────────────────────────────────────────
  {
    id: "book-midflow-change-party-size",
    capability: "book",
    description: "User changes party mid-booking — should update without re-asking everything.",
    turns: [
      {
        user: "book Jacobs for 2 tomorrow at 7pm",
        expect: { tool_called: "check_availability" },
      },
      {
        user: "actually make it 4 people",
        expect: {
          booking_field: { field: "party_size", equals: 4 },
          judge: "Acknowledged the change to 4 people. Did NOT confirm a booking for 2.",
        },
      },
    ],
  },

  // ── BOOKING: never-mind / exit ────────────────────────────────────────
  {
    id: "book-never-mind",
    capability: "book",
    description: "User cancels the booking flow — should release gracefully, not call complete_booking.",
    turns: [
      {
        user: "book Jacobs for 2 tomorrow at 7pm",
        expect: { tool_called: "check_availability" },
      },
      {
        user: "never mind, forget it",
        expect: {
          no_tool_called: "complete_booking",
          judge: "Acknowledged the user backing out with a polite, brief reply. Did NOT confirm any reservation. Did NOT keep prompting for booking details.",
        },
      },
    ],
  },

  // ── RESTAURANT INFO Q&A (the new snapshot tool) ───────────────────────
  {
    id: "info-jacobs-hours",
    capability: "info",
    description: "Hours question — must call get_restaurant_snapshot.",
    turns: [
      {
        user: "what time does Jacobs and Co Steakhouse open?",
        expect: {
          tool_called: "get_restaurant_snapshot",
          judge: "Answered with an actual time (e.g. '5 PM'). Did NOT say 'I don't know' or invent times.",
        },
      },
    ],
  },
  {
    id: "info-jacobs-dietary",
    capability: "info",
    description: "Dietary options question.",
    turns: [
      {
        user: "do they have vegan options at Jacobs?",
        expect: {
          judge: "Either confirmed/denied vegan options from real data OR said 'I don't have that confirmed' — did NOT invent a fake answer.",
        },
      },
    ],
  },
  {
    id: "info-jacobs-address",
    capability: "info",
    description: "Address/directions question.",
    turns: [
      {
        user: "where is Jacobs located?",
        expect: {
          judge: "Gave an actual address or location (e.g. street, city). Did NOT say 'I don't know'.",
        },
      },
    ],
  },
  {
    id: "info-jacobs-phone",
    capability: "info",
    description: "Phone number question.",
    turns: [
      {
        user: "what's the phone number for Jacobs?",
        expect: {
          judge: "Either gave a phone number (numbers acceptable) OR said the number wasn't on file. Did NOT redirect to booking without addressing the question.",
        },
      },
    ],
  },
  {
    id: "info-mark-testing-deposit",
    capability: "info",
    description: "Deposit policy question — must read deposit_tiers OR give defensive hedge.",
    turns: [
      {
        user: "does Mark Testing take a deposit?",
        expect: {
          judge: "Either answered with deposit info OR gave a defensive hedge ('I don't have that detail/confirmed', offered phone, offered to book). Did NOT invent a fake deposit amount.",
        },
      },
    ],
  },

  // ── DISCOVERY / SEARCH ────────────────────────────────────────────────
  {
    id: "search-cuisine-steakhouse",
    capability: "search",
    description: "Cuisine/venue search — must call search_restaurants.",
    turns: [
      {
        user: "find me a steakhouse",
        expect: {
          tool_called: "search_restaurants",
          judge: "Named at least one specific steakhouse by name (e.g. Jacobs, Harbour Sixty, Keg, STK).",
        },
      },
    ],
  },
  {
    id: "search-city-guelph",
    capability: "search",
    description: "City-only search.",
    turns: [
      {
        user: "any restaurants in Guelph?",
        expect: {
          tool_called: "search_restaurants",
          tool_input_contains: { tool: "search_restaurants", expect: { city: /guelph/i } },
          judge: "Named at least one Guelph restaurant (Mark Testing should appear).",
        },
      },
    ],
  },
  {
    id: "search-occasion-date-night",
    capability: "search",
    description: "Occasion-based search.",
    turns: [
      {
        user: "somewhere romantic for a date night",
        expect: {
          tool_called: "search_restaurants",
          judge: "Named one or more upscale/romantic restaurants. Did NOT ask vague follow-ups before searching.",
        },
      },
    ],
  },
  {
    id: "search-near-me",
    capability: "search",
    description: "Proximity search — should not ask for city.",
    turns: [
      {
        user: "what's close by?",
        expect: {
          judge: "Did NOT ask 'what city are you in?' or 'what neighborhood?'. Either ran a search OR asked for a cuisine/vibe refinement (which is acceptable voice UX since 'close by' alone is too broad).",
        },
      },
    ],
  },

  // ── RESERVATIONS: list ────────────────────────────────────────────────
  {
    id: "list-reservations",
    capability: "list",
    description: "Listing reservations.",
    turns: [
      {
        user: "show me my upcoming reservations",
        expect: {
          tool_called: "list_my_reservations",
          tool_input_contains: { tool: "list_my_reservations", expect: { status_filter: "active" } },
        },
      },
    ],
  },

  // ── RESERVATIONS: cancel ──────────────────────────────────────────────
  {
    id: "cancel-no-active",
    capability: "cancel",
    description: "Cancel with no active reservations — must NOT call cancel_reservation.",
    turns: [
      {
        user: "cancel my reservation",
        expect: {
          no_tool_called: "cancel_reservation",
          judge: "Recognized there are no active reservations to cancel. Did NOT fake a cancellation. Offered a helpful next step.",
        },
      },
    ],
  },

  // ── OFF-TOPIC / OUT-OF-POCKET (the weird stuff) ───────────────────────
  {
    id: "offtopic-joke",
    capability: "off-topic",
    description: "Off-topic joke request.",
    turns: [
      {
        user: "tell me a joke",
        expect: {
          no_tool_called: "search_restaurants",
          judge: "Brief deflect with personality. Did NOT actually tell a long joke. Redirected to booking/reservations.",
        },
      },
    ],
  },
  {
    id: "offtopic-emotional-rant",
    capability: "off-topic",
    description: "User vents emotionally — should empathize briefly + offer redirection.",
    turns: [
      {
        user: "I've had the worst day ever, everything sucks",
        expect: {
          judge: "Brief empathetic acknowledgment (one short sentence). Then an open question that gently invites booking ('anywhere on your mind?', 'want to find somewhere nice?', or similar). Did NOT lecture or therapy-speak.",
          max_words: 30,
        },
      },
    ],
  },
  {
    id: "offtopic-flirty",
    capability: "off-topic",
    description: "User flirts with the assistant.",
    turns: [
      {
        user: "are you single?",
        expect: {
          judge: "Polite, brief deflect with personality. Redirected to reservations. Did NOT play along.",
          max_words: 30,
        },
      },
    ],
  },
  {
    id: "offtopic-philosophy",
    capability: "off-topic",
    description: "Random philosophical question.",
    turns: [
      {
        user: "what's the meaning of life?",
        expect: {
          no_tool_called: "search_restaurants",
          judge: "Short witty deflect. Redirected to dinner. Did NOT lecture about philosophy.",
          max_words: 25,
        },
      },
    ],
  },
  {
    id: "offtopic-profanity",
    capability: "off-topic",
    description: "User uses strong language — should not be offended, redirect.",
    turns: [
      {
        user: "this is fucking ridiculous, just find me a damn restaurant",
        expect: {
          tool_called: "search_restaurants",
          judge: "Did not lecture user on language. Did not refuse. Searched and named restaurants.",
        },
      },
    ],
  },
  {
    id: "offtopic-identity-question",
    capability: "off-topic",
    description: "User asks if assistant is AI.",
    turns: [
      {
        user: "are you a human or AI?",
        expect: {
          judge: "Acknowledged being AI honestly. Did NOT pretend to be human. Short, redirected to dinner.",
          max_words: 30,
        },
      },
    ],
  },

  // ── AMBIGUITY ─────────────────────────────────────────────────────────
  {
    id: "ambiguity-time-no-am-pm",
    capability: "ambiguity",
    description: "Bare hour without AM/PM.",
    turns: [
      {
        user: "book Jacobs for 2 tomorrow at 7",
        expect: {
          judge: "Asked whether 7 AM or 7 PM (or similar disambiguation). Did NOT assume and proceed to book.",
        },
      },
    ],
  },
  {
    id: "ambiguity-vague-time",
    capability: "ambiguity",
    description: "Vague time phrase ('sometime tonight').",
    turns: [
      {
        user: "I want to eat sometime tonight",
        expect: {
          no_tool_called: "complete_booking",
          judge: "Asked for a specific time OR offered to find what's open. Did NOT pick an arbitrary time silently.",
        },
      },
    ],
  },

  // ── HELP ──────────────────────────────────────────────────────────────
  {
    id: "help-what-can-you-do",
    capability: "help",
    description: "'What can you do?'",
    turns: [
      {
        user: "what can you help me with?",
        expect: {
          judge: "Briefly described capabilities (booking, finding, info). Did NOT recite a long bullet list. Offered to help with something specific.",
          max_words: 40,
        },
      },
    ],
  },

  // ── FUZZY MATCH: diacritic / partial / edit-distance / ampersand ──────
  {
    id: "fuzzy-diacritic-baton-rouge",
    capability: "fuzzy",
    description: "Diacritic-insensitive: 'Baton Rouge' resolves to Bâton Rouge Eaton Centre.",
    turns: [
      {
        user: "tell me about Baton Rouge restaurant",
        expect: {
          judge: "Mentioned the restaurant called Bâton Rouge (or Baton Rouge) by name — recognized it as a restaurant in the system. Did NOT say 'I don't see a restaurant called that' or surface an unrelated restaurant. (Note: 'Baton Rouge' here refers ONLY to the restaurant, NOT the city in Louisiana.)",
        },
      },
    ],
  },
  {
    id: "fuzzy-partial-jacobs",
    capability: "fuzzy",
    description: "Partial name: 'jacobs' resolves to Jacobs & Co. Steakhouse.",
    turns: [
      {
        user: "book jacobs for 2 tomorrow at 8pm",
        expect: {
          tool_called: "check_availability",
          tool_input_contains: { tool: "check_availability", expect: { restaurant_id: JACOBS_ID, party_size: 2 } },
        },
      },
    ],
  },
  {
    id: "fuzzy-edit-distance-georgie",
    capability: "fuzzy",
    description: "1-char edit: 'Georgie Inc' resolves to Georgy Inc.",
    turns: [
      {
        user: "tell me about Georgie inc",
        expect: {
          judge: "Recognized that the user's 'Georgie Inc' refers to the restaurant 'Georgy Inc' and surfaced THAT restaurant's information (Egyptian cuisine in Milton, etc). The 1-char spelling difference is a STT mishear that the assistant correctly fuzzy-matched — that is the desired behavior. Did NOT refuse or say 'I don't see Georgie Inc'.",
        },
      },
    ],
  },
  {
    id: "fuzzy-ampersand-handling",
    capability: "fuzzy",
    description: "Ampersand normalization: 'Jacobs and Co' resolves to Jacobs & Co.",
    turns: [
      {
        user: "what's on the menu at Jacobs and Co",
        expect: {
          judge: "Acknowledged Jacobs & Co by name (or pulled its menu/info). Did NOT ask 'which restaurant?' or surface an unrelated steakhouse.",
        },
      },
    ],
  },
  {
    id: "fuzzy-stt-mishear-harbour",
    capability: "fuzzy",
    description: "Spelling variant + number-word: 'Harbor 60' resolves to Harbour Sixty.",
    turns: [
      {
        user: "what time does Harbor 60 close",
        expect: {
          judge: "Acknowledged Harbour Sixty (or Harbour 60) by name. Did NOT surface a different restaurant such as Georgy Inc.",
        },
      },
    ],
  },
  {
    id: "fuzzy-suffix-strip",
    capability: "fuzzy",
    description: "Venue-type stop word: 'Jacobs steakhouse' resolves to Jacobs & Co.",
    turns: [
      {
        user: "book a table at Jacobs steakhouse",
        expect: {
          judge: "Recognized Jacobs (or Jacobs & Co Steakhouse) as the target restaurant — moved the booking flow forward instead of asking 'which Jacobs?' or surfacing an unrelated steakhouse.",
        },
      },
    ],
  },

  // ── GEOGRAPHIC HONESTY: city_explicit must never silent-swap ──────────
  {
    id: "geo-explicit-city-no-match-honest",
    capability: "geo",
    description: "User names a city with zero fixtures (Vancouver) and no userLocation. Must NOT silently surface a different city's restaurant.",
    turns: [
      {
        user: "any restaurants in Vancouver?",
        expect: {
          judge: "The ONLY requirement: did NOT name any specific restaurant (no mention of Mark Testing, Jacobs, Bâton Rouge, Harbour Sixty, STK, Georgy Inc, Onboarding Test Pizza, Qoop, or any other restaurant name). Saying 'I don't see restaurants in Vancouver' or 'no matches there' or 'nothing in Vancouver' all PASS. A brief honest empty is the correct behavior; lack of alternative suggestions is FINE and expected.",
        },
      },
    ],
  },
  {
    id: "geo-explicit-city-no-silent-swap",
    capability: "geo",
    description: "User in Toronto explicitly asks for Vancouver. Toronto restaurants exist nearby but must NOT be recommended.",
    turns: [
      {
        user: "restaurants in Vancouver",
        user_location: TORONTO_LATLNG,
        expect: {
          judge: "The ONLY requirement: did NOT name any specific Toronto-area restaurant (no Jacobs, Bâton Rouge, Harbour Sixty, STK Toronto, Onboarding Test Pizza, David Duncan House, Blue Blood, Ruth's Chris, or Keg Mansion) as a swap. Saying 'I don't see restaurants in Vancouver' is the correct honest-empty response — that passes. Mentioning Mark Testing (Guelph) or Georgy Inc (Milton) would also be a fail since they're not in Vancouver.",
        },
      },
    ],
  },
  {
    id: "geo-explicit-city-guelph",
    capability: "geo",
    description: "User explicitly asks Guelph (Mark Testing exists there) — must return Mark Testing, not silently swap.",
    turns: [
      {
        user: "any restaurants in Guelph?",
        expect: {
          tool_called: "search_restaurants",
          tool_input_contains: { tool: "search_restaurants", expect: { city: /guelph/i } },
          judge: "Named Mark Testing (the Guelph fixture). Did NOT surface a Toronto or Milton restaurant.",
        },
      },
    ],
  },
  {
    id: "geo-stk-toronto",
    capability: "geo",
    description: "STK is a Toronto fixture — naming STK without a city must resolve to STK Toronto.",
    turns: [
      {
        user: "tell me about STK",
        expect: {
          judge: "Acknowledged STK Toronto (or STK) by name. Did NOT ask 'which city?' nor surface an unrelated steakhouse.",
        },
      },
    ],
  },

  // ── VISIBLE-FIRST RESOLVER + STT ALTERNATIVES ─────────────────────────
  {
    id: "visible-first-wins-jacobs",
    capability: "visible",
    description: "User mumbles 'Jacob' while Jacobs is on screen — visible-first scorer auto-resolves.",
    turns: [
      {
        user: "let's do Jacobs",
        visible_restaurant_ids: [JACOBS_ID, MARK_TESTING_ID],
        expect: {
          judge: "Treated Jacobs & Co as the selected restaurant — either confirmed Jacobs and moved booking forward (asked for party/date/time) OR mentioned Jacobs by name as the chosen pick. Did NOT ask 'which restaurant?' or surface Mark Testing.",
        },
      },
    ],
  },
  {
    id: "stt-alt-recovery-jacobs",
    capability: "stt-alt",
    description: "Primary transcript is a mishear; alternative transcript carries the real name. Visible-first scorer must pick the alternative.",
    turns: [
      {
        user: "Jacobs and Co please",
        transcript_alternatives: ["Jackass and Co please", "Jackals please"],
        visible_restaurant_ids: [JACOBS_ID, MARK_TESTING_ID],
        expect: {
          booking_field: { field: "restaurant_id", equals: JACOBS_ID },
        },
      },
    ],
  },
  {
    id: "stt-alt-recovery-via-alternative",
    capability: "stt-alt",
    description: "Primary transcript misheard as a non-match; the alternative carries the real name. Visible-first resolver must pick the alternative.",
    turns: [
      {
        user: "Jackass and Co",
        transcript_alternatives: ["Jacobs and Co", "Jackals"],
        visible_restaurant_ids: [JACOBS_ID, MARK_TESTING_ID],
        expect: {
          booking_field: { field: "restaurant_id", equals: JACOBS_ID },
        },
      },
    ],
  },
  {
    id: "stt-alt-no-recovery-needed-baton-rouge",
    capability: "stt-alt",
    description: "Primary transcript resolves on its own (diacritic stripping); alternatives are noise. Should still resolve to Bâton Rouge.",
    turns: [
      {
        user: "Baton Rouge",
        transcript_alternatives: ["Bat in Rouge", "Baten Roo"],
        visible_restaurant_ids: [BATON_ROUGE_ID, JACOBS_ID],
        expect: {
          booking_field: { field: "restaurant_id", equals: BATON_ROUGE_ID },
        },
      },
    ],
  },

  // ── DISAMBIGUATION: ambiguous fuzzy match should ask ──────────────────
  {
    id: "disambiguation-georgy-vs-jacobs-visible",
    capability: "disambig",
    description: "Two visible candidates both share weak fuzzy signal — should NOT auto-resolve silently.",
    turns: [
      {
        user: "the steak place",
        visible_restaurant_ids: [JACOBS_ID, HARBOUR_SIXTY_ID, STK_TORONTO_ID],
        expect: {
          no_tool_called: "complete_booking",
          judge: "Did NOT pre-confirm a specific restaurant silently. Either asked which one OR listed the visible steak places by name.",
        },
      },
    ],
  },
];
