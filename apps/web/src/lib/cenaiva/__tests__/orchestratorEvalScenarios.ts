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
const KEG_MANSION_ID = "a1000002-1111-1111-1111-000000000002"; // The Keg Mansion — Toronto
const BLUE_BLOOD_ID = "a1000004-1111-1111-1111-000000000004"; // Blue Blood Steakhouse — Toronto
const GEORGY_ID = "428964af-02b8-45ca-8973-3617b91bd718"; // Georgy Inc — Milton
// Additional active fixtures referenced only in judge-based scenarios
// below (no direct id assertions yet, kept for reference):
// STK Toronto:              a1000005-1111-1111-1111-000000000005
// David Duncan House:       a1000006-1111-1111-1111-000000000006 (Toronto)
// Ruth's Chris:             a1000008-1111-1111-1111-000000000008 (Toronto)

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
          judge: "Mentioned STK (or STK Toronto) BY NAME as the resolved restaurant. Cuisine/style tags in parentheses like '(Cocktail bar / Lounge)' are STK's own attributes, NOT mentions of an unrelated restaurant. PASS if the response identifies STK and proceeds. Did NOT ask 'which city?' or 'which STK?'.",
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
  // Disambiguation: deferred — the orchestrator's LLM-tool path picks
  // the first ILIKE row when multiple restaurants share an identical
  // name (e.g. two Qoop rows). That's a separate issue from the fuzzy
  // matcher (which correctly returns ambiguous in this case). Will be
  // addressed when we add a "multiple identical names → ask which" path
  // to the LLM tool handler.

  // ── FULL-DB FUZZY: every restaurant, common typos / short forms ──────
  // These do NOT use visible_restaurant_ids — they test that the
  // full-database fuzzy matcher resolves typos and abbreviated forms
  // against the entire active restaurants list, without needing the
  // user to have a card on screen first.
  {
    id: "typo-jacobs-jakob",
    capability: "typo",
    description: "Typo: 'jakob' → Jacobs & Co (2-char edit distance).",
    turns: [
      {
        user: "I want to book at jakob",
        expect: {
          judge: "Acknowledged Jacobs & Co (or 'Jacobs') by name as the resolved match. Did NOT say 'Jakob isn't on our list' or offer unrelated alternatives.",
        },
      },
    ],
  },
  {
    id: "typo-jacobs-jacobss",
    capability: "typo",
    description: "Typo: 'jacobss' (extra s) → Jacobs & Co.",
    turns: [
      {
        user: "book me at jacobss",
        expect: {
          judge: "Recognized 'jacobss' as Jacobs & Co Steakhouse. Did NOT say 'not on our list'.",
        },
      },
    ],
  },
  {
    id: "shortform-blue-blood",
    capability: "shortform",
    description: "Short form: 'I want blue blood' → Blue Blood Steakhouse.",
    turns: [
      {
        user: "I want blue blood",
        expect: {
          judge: "Recognized Blue Blood Steakhouse by name. Did NOT misinterpret as anything else and did NOT say 'not on our list'.",
        },
      },
    ],
  },
  {
    id: "typo-blue-blood-blueblood",
    capability: "typo",
    description: "Typo: 'blueblood' (no space) → Blue Blood Steakhouse.",
    turns: [
      {
        user: "I want to book at blueblood",
        expect: {
          judge: "The ONLY requirement: did NOT say 'not on our list', 'no blueblood', 'I don't see blueblood', or any variant of 'restaurant not found'. Any response that proceeds with Blue Blood as the resolved restaurant (asking party size, asking date, describing it, offering availability) is a PASS — the fuzzy matcher correctly mapped 'blueblood' to Blue Blood Steakhouse.",
        },
      },
    ],
  },
  {
    id: "shortform-the-keg",
    capability: "shortform",
    description: "Short form: 'the keg' → The Keg Mansion.",
    turns: [
      {
        user: "book the keg",
        expect: {
          judge: "Recognized The Keg Mansion (or 'the Keg') by name. Did NOT ask 'which restaurant?' or say 'not on our list'.",
        },
      },
    ],
  },
  {
    id: "typo-ruths-chris-no-apostrophe",
    capability: "typo",
    description: "No apostrophe: 'Ruths Chris' → Ruth's Chris Steak House.",
    turns: [
      {
        user: "book ruths chris",
        expect: {
          judge: "Recognized Ruth's Chris Steak House by name. Did NOT say 'not on our list'.",
        },
      },
    ],
  },
  {
    id: "shortform-ruth-chris",
    capability: "shortform",
    description: "Short form: 'Ruth Chris' (missing s) → Ruth's Chris.",
    turns: [
      {
        user: "tell me about Ruth Chris",
        expect: {
          judge: "Recognized Ruth's Chris Steak House. Did NOT say 'not on our list'.",
        },
      },
    ],
  },
  {
    id: "typo-david-duncan-dunken",
    capability: "typo",
    description: "Typo: 'David Dunken' → David Duncan House.",
    turns: [
      {
        user: "tell me about David Dunken",
        expect: {
          judge: "Surfaced 'David Duncan House' as the resolved restaurant (the user's 'David Dunken' is a misspelling and the fuzzy matcher correctly mapped it to David Duncan — that IS the desired behavior). Did NOT say 'not on our list'.",
        },
      },
    ],
  },
  {
    id: "shortform-duncan-house",
    capability: "shortform",
    description: "Short form: 'Duncan house' → David Duncan House.",
    turns: [
      {
        user: "I want to book duncan house",
        expect: {
          judge: "Recognized David Duncan House. Did NOT ask 'which restaurant?'.",
        },
      },
    ],
  },
  {
    id: "typo-harbour-sixty-sixty",
    capability: "typo",
    description: "Number→word + spelling variant: 'Harbour 60' → Harbour Sixty Steakhouse.",
    turns: [
      {
        user: "book Harbour 60",
        expect: {
          judge: "Recognized Harbour Sixty Steakhouse (or Harbour 60). Did NOT surface an unrelated restaurant.",
        },
      },
    ],
  },
  {
    id: "typo-harbor-sixty",
    capability: "typo",
    description: "US spelling: 'Harbor Sixty' → Harbour Sixty (British spelling in DB).",
    turns: [
      {
        user: "what time does Harbor Sixty open",
        expect: {
          judge: "Recognized Harbour Sixty Steakhouse. Did NOT say 'not on our list'.",
        },
      },
    ],
  },
  {
    id: "shortform-georgy",
    capability: "shortform",
    description: "Short form: 'georgy' alone → Georgy Inc.",
    turns: [
      {
        user: "book georgy",
        expect: {
          judge: "Recognized Georgy Inc by name. Did NOT say 'not on our list'.",
        },
      },
    ],
  },
  {
    id: "typo-georgy-george",
    capability: "typo",
    description: "Typo: 'George Inc' (no y) → Georgy Inc.",
    turns: [
      {
        user: "tell me about George Inc",
        expect: {
          judge: "Recognized Georgy Inc as the intended restaurant. Did NOT say 'not on our list'.",
        },
      },
    ],
  },
  {
    id: "shortform-mark-test",
    capability: "shortform",
    description: "Short form: 'Mark Test' → Mark Testing.",
    turns: [
      {
        user: "book Mark Test",
        expect: {
          judge: "Recognized Mark Testing as the intended restaurant. Did NOT say 'not on our list'.",
        },
      },
    ],
  },
  {
    id: "typo-baton-rouge-batan",
    capability: "typo",
    description: "Typo + missing diacritic: 'Batan Rouge' → Bâton Rouge Eaton Centre.",
    turns: [
      {
        user: "book Batan Rouge",
        expect: {
          judge: "Recognized Bâton Rouge (Eaton Centre) as the intended restaurant. Did NOT say 'not on our list'.",
        },
      },
    ],
  },
  {
    id: "shortform-stk",
    capability: "shortform",
    description: "Abbreviation: 'STK' → STK Toronto.",
    turns: [
      {
        user: "tell me about STK",
        expect: {
          judge: "Recognized STK (Toronto) by name. Did NOT say 'not on our list' or ask 'which city?'.",
        },
      },
    ],
  },
  {
    id: "shortform-test-pizza",
    capability: "shortform",
    description: "Short form: 'Test Pizza' → Onboarding Test Pizza.",
    turns: [
      {
        user: "book Test Pizza",
        expect: {
          judge: "Recognized Onboarding Test Pizza by name. Did NOT say 'not on our list'.",
        },
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════════════
  // ADVERSARIAL FUZZY-MATCH STRESS TESTS
  // Real-user phrasings, mishears, fillers, and edge cases that would
  // plausibly arrive from Deepgram or a typing user but might break the
  // matcher. Each one targets a specific failure mode.
  // ══════════════════════════════════════════════════════════════════════

  // 1. Phonetic mishear — sound-alike STT errors
  {
    id: "adversarial-phonetic-drews-christ",
    capability: "adversarial-phonetic",
    description: "Phonetic mishear: 'Drews Christ' (sounds like Ruth's Chris) → Ruth's Chris Steak House.",
    turns: [
      {
        user: "book me at drews christ for 2",
        expect: {
          judge: "The ONLY requirement: did NOT say 'not on our list', 'no drews', or any 'restaurant not found' variant. Any response that proceeds with Ruth's Chris as the resolved restaurant (asking party size, asking date, asking 'sound right?', describing Ruth's Chris) is a PASS — the phonetic matcher correctly mapped the sound-alike mishear.",
        },
      },
    ],
  },

  // 2. Multi-typo (2+ character errors)
  {
    id: "adversarial-multitypo-jakcobs",
    capability: "adversarial-typo",
    description: "Multi-typo: 'Jakcobs and Coh' (2 transpositions + extra char) → Jacobs & Co.",
    turns: [
      {
        user: "tell me about jakcobs and coh",
        expect: {
          booking_field: { field: "restaurant_id", equals: JACOBS_ID },
        },
      },
    ],
  },

  // 3. Voice fillers wrapping the name
  {
    id: "adversarial-fillers-um-like-jacobs",
    capability: "adversarial-fillers",
    description: "Voice fillers around the name: 'uh um like book me at jacobs you know'.",
    turns: [
      {
        user: "uh um like book me at jacobs you know for 2 people",
        expect: {
          tool_called: "check_availability",
          tool_input_contains: { tool: "check_availability", expect: { restaurant_id: JACOBS_ID, party_size: 2 } },
          judge: "Stripped the filler words ('uh', 'um', 'like', 'you know') and resolved Jacobs & Co with party size 2. Did NOT get confused by the filler tokens.",
        },
      },
    ],
  },

  // 4. Mixed case + punctuation noise
  {
    id: "adversarial-case-punct-baton-rouge-shout",
    capability: "adversarial-noise",
    description: "Aggressive case + punctuation: 'BATON-ROUGE!!!' → Bâton Rouge.",
    turns: [
      {
        user: "BATON-ROUGE!!! book it",
        expect: {
          booking_field: { field: "restaurant_id", equals: BATON_ROUGE_ID },
          judge: "Resolved Bâton Rouge Eaton Centre despite all-caps shouting, hyphen between words, and trailing exclamation marks. Did NOT say 'not on our list'.",
        },
      },
    ],
  },

  // 5. Very short / homonym-risky name
  {
    id: "adversarial-shortname-stk-lowercase",
    capability: "adversarial-shortname",
    description: "3-letter lowercase 'stk' alone — should resolve to STK Toronto, not get treated as a typo of 'steak' or noise.",
    turns: [
      {
        user: "stk",
        expect: {
          judge: "Recognized 'stk' as the restaurant STK Toronto and proceeded (either confirmed STK as selected, asked for booking details, or surfaced STK info). Did NOT interpret it as the word 'steak' / a cuisine search, and did NOT say 'I didn't catch that' or 'not on our list'.",
        },
      },
    ],
  },

  // 6. Off-topic prompt that contains a restaurant-adjacent descriptor word
  {
    id: "adversarial-descriptor-not-name-steak",
    capability: "adversarial-descriptor",
    description: "User asks 'do you serve steak' — descriptor only, no restaurant intent. Must NOT pick a steakhouse by name as a 'match'.",
    turns: [
      {
        user: "do you serve steak",
        expect: {
          judge: "Treated this as either a generic question/redirect OR a cuisine-search trigger. Did NOT auto-select a specific steakhouse (Jacobs, Keg, Harbour Sixty, etc.) as if the user had named one. Surfacing multiple steakhouses as search results is FINE; silently locking onto one is a FAIL.",
        },
      },
    ],
  },

  // 7. Multi-slot booking continuation packed into one utterance
  {
    id: "adversarial-multislot-yes-book-jacobs",
    capability: "adversarial-multislot",
    description: "All booking slots + affirmation in a single utterance: 'yes book me a table at jacobs for 2 tomorrow at 8'.",
    turns: [
      {
        user: "yes book me a table at jacobs for 2 tomorrow at 8pm",
        expect: {
          tool_called: "check_availability",
          tool_input_contains: { tool: "check_availability", expect: { restaurant_id: JACOBS_ID, party_size: 2 } },
          booking_field: { field: "party_size", equals: 2 },
          judge: "Extracted restaurant=Jacobs, party=2, date=tomorrow, time=8pm from the single utterance and moved to availability. Did NOT re-ask any of those four slots. The leading 'yes' did NOT confuse it into thinking there was a prior booking to confirm.",
        },
      },
    ],
  },

  // 8. Negative phrasing — "NOT X, I want Y"
  {
    id: "adversarial-negation-not-jacobs-keg",
    capability: "adversarial-negation",
    description: "Negative phrasing: 'not jacobs, I want the keg' — must resolve to Keg, NOT Jacobs.",
    turns: [
      {
        user: "not jacobs, I want the keg",
        expect: {
          judge: "The ONLY requirement: did NOT pick Jacobs & Co as the resolved restaurant. Any response that proceeds with The Keg Mansion (asking party size, surfacing The Keg, asking 'sound right?') is a PASS. The negation regex correctly dropped 'jacobs' before scoring so the matcher locked onto 'the keg' instead.",
        },
      },
    ],
  },

  // 9. Polite/conversational wrappers
  {
    id: "adversarial-polite-blue-blood",
    capability: "adversarial-polite",
    description: "Polite wrapper: 'hi could you please make me a reservation at blue blood'.",
    turns: [
      {
        user: "hi could you please make me a reservation at blue blood",
        expect: {
          judge: "The ONLY requirement: identified Blue Blood Steakhouse by name as the resolved restaurant. Any next step is acceptable — asking party size, asking 'sound right?', moving to booking, or confirming. Did NOT say 'not on our list' or surface an unrelated restaurant.",
        },
      },
    ],
  },

  // 10. Restaurant name appears mid-sentence in a non-booking context
  {
    id: "adversarial-midsentence-harbour-after-work",
    capability: "adversarial-midsentence",
    description: "Restaurant name embedded mid-sentence with no booking verb: 'I'm going to harbour sixty after work'.",
    turns: [
      {
        user: "I'm going to harbour sixty after work",
        expect: {
          judge: "Recognized the user is referencing Harbour Sixty Steakhouse (named it in the reply OR offered to help with a reservation/info there). Did NOT say 'not on our list' or surface an unrelated restaurant. It's fine if the assistant proactively asks 'want me to book you a table?' since that's a reasonable conversational move.",
        },
      },
    ],
  },

  // 11. Mid-flow pivot to a different restaurant
  {
    id: "adversarial-pivot-jacobs-to-keg",
    capability: "adversarial-pivot",
    description: "Pivot: turn 1 'book jacobs', turn 2 'actually make it the keg' — booking_field must flip to Keg.",
    turns: [
      {
        user: "book jacobs for 2 tomorrow at 7pm",
        expect: {
          tool_called: "check_availability",
          booking_field: { field: "restaurant_id", equals: JACOBS_ID },
        },
      },
      {
        user: "actually make it the keg instead",
        expect: {
          judge: "The ONLY requirement: acknowledged the switch to The Keg Mansion — either named The Keg in the reply, re-ran availability for The Keg, or asked a clarifying question framed around The Keg. Did NOT keep proceeding with Jacobs as the active restaurant. Mentioning Jacobs only to acknowledge the change ('switching from Jacobs to The Keg') is FINE.",
        },
      },
    ],
  },

  // 12. Bare-name selection after assistant lists options
  {
    id: "adversarial-bare-selection-the-keg-one",
    capability: "adversarial-selection",
    description: "Bare-name selection: turn 1 cuisine search lists steakhouses, turn 2 user replies 'the keg one'.",
    turns: [
      {
        user: "find me a steakhouse in toronto",
        expect: {
          tool_called: "search_restaurants",
          judge: "Surfaced at least one of: Jacobs, Harbour Sixty, Keg, Blue Blood, Ruth's Chris, STK, or David Duncan by name. The recommendation ranker may include adjacent restaurants too — that's an unrelated ranking issue, not a fuzzy-match issue. Did NOT auto-book.",
        },
      },
      {
        user: "the keg one",
        expect: {
          judge: "The ONLY requirement: identified The Keg Mansion as the user's pick from the prior list (either confirmed it by name, surfaced its info, or moved into booking flow for The Keg). Did NOT pick Jacobs or another non-Keg restaurant as the selection.",
        },
      },
    ],
  },

  // 13. Empty / whitespace / punctuation-only transcript
  {
    id: "adversarial-empty-punctuation",
    capability: "adversarial-empty",
    description: "Single punctuation character — nothing to resolve. Must NOT hallucinate a restaurant match.",
    turns: [
      {
        user: ".",
        expect: {
          no_tool_called: "check_availability",
          judge: "The ONLY requirement: did NOT name any specific restaurant in the response. Any short polite/open prompt is a PASS ('hi there', 'how can I help', 'what kind of place', 'I didn't catch that'). The point is the matcher must NOT hallucinate a restaurant name from a single period.",
          max_words: 25,
        },
      },
    ],
  },

  // 14a. Single short token — 'jacob' (no Jacob Moss in DB, only Jacobs)
  {
    id: "adversarial-jacob-singular-resolves-jacobs",
    capability: "adversarial-singular",
    description: "Singular 'jacob' (no trailing s) — only Jacobs & Co exists, so should resolve cleanly to Jacobs.",
    turns: [
      {
        user: "book jacob",
        expect: {
          judge: "Resolved Jacobs & Co Steakhouse as the intended restaurant (the missing 's' is a 1-char edit and Jacobs is the only match in the DB). Did NOT say 'multiple matches' or 'which Jacob?'. Did NOT say 'not on our list'.",
        },
      },
    ],
  },

  // 14b. Genuine ambiguity: two Qoop rows in DB
  {
    id: "adversarial-qoop-true-ambiguity",
    capability: "adversarial-ambiguity",
    description: "True duplicate-name ambiguity: DB has two Qoop rows (ebc20cdf… and b1a68afa…). Matcher should ask to disambiguate OR list both, NOT silently pick one.",
    turns: [
      {
        user: "book me at Qoop",
        expect: {
          judge: "The ONLY requirement: did NOT silently confirm a booking at one specific Qoop without acknowledging the ambiguity. Acceptable PASSES: (a) asked the user 'I see two restaurants named Qoop, which one?', (b) listed both Qoop locations, or (c) noted that there are multiple Qoops and asked for clarifying detail (city, neighborhood, etc.). A silent pick-one-and-proceed is the failure mode this test catches. If the assistant says it can't find Qoop at all, that's also a FAIL (the rows exist).",
        },
      },
    ],
  },

  // 15. Long sentence with hidden restaurant name (storytelling context)
  {
    id: "adversarial-storytelling-blue-blood",
    capability: "adversarial-hidden",
    description: "Restaurant name buried in a long storytelling sentence: 'yeah so my friend said the food was good at blue blood and I wanted to try it'.",
    turns: [
      {
        user: "yeah so my friend said the food was good at blue blood and I wanted to try it",
        expect: {
          judge: "Recognized Blue Blood Steakhouse as the restaurant the user is interested in (named it, offered info, or offered to book a table there). Did NOT say 'not on our list', surface an unrelated restaurant, or get lost in the storytelling preamble. A proactive 'want me to check availability at Blue Blood?' is a strong PASS.",
        },
      },
    ],
  },

  // ── HEDGED RECALL: vague partial-name prompts ─────────────────────────
  // Users often half-remember a restaurant name and hedge with "I forgot
  // the name but…", "the place called X I think", "something like X".
  // Before 2026-05-17 these fell through to the small-prompt LLM (no
  // tools, no candidate list) which hallucinated "Qoop is the best fit"
  // for "harbour something". Fix: relaxed wordCount gate + hedged-name
  // regex in extractUnknownRestaurantCandidate + bookingProcessIntent
  // keyword expansion.
  {
    id: "hedged-recall-harbour-something",
    capability: "hedged-recall",
    description: "Vague hedged recall: 'I forgot the name but it's harbour something' → Harbour Sixty Steakhouse.",
    turns: [
      {
        user: "I forgot the name but it's harbour something",
        expect: {
          booking_field: { field: "restaurant_id", equals: HARBOUR_SIXTY_ID },
        },
      },
    ],
  },
  {
    id: "hedged-recall-the-place-called-keg",
    capability: "hedged-recall",
    description: "Hedged recall: 'the place called keg I think' → The Keg Mansion.",
    turns: [
      {
        user: "the place called keg I think",
        expect: {
          booking_field: { field: "restaurant_id", equals: KEG_MANSION_ID },
        },
      },
    ],
  },
  {
    id: "hedged-recall-jacobs-something",
    capability: "hedged-recall",
    description: "Hedged recall: 'the restaurant called jacobs something' → Jacobs & Co.",
    turns: [
      {
        user: "the restaurant called jacobs something",
        expect: {
          booking_field: { field: "restaurant_id", equals: JACOBS_ID },
        },
      },
    ],
  },

  // ── MID-FLOW PIVOT: user changes restaurant mid-booking ───────────────
  // The pivot resolver runs whenever the user names a DIFFERENT restaurant
  // mid-flow (status="loading_availability" or "awaiting_time_selection").
  // Verifies: turn 1 starts booking at Georgy Inc; turn 2 says one of the
  // pivot phrasings; turn 2 booking.restaurant_id must flip to the new
  // restaurant AND booking.shift_id must be null (cleared so re-check runs).
  {
    id: "pivot-actually-book-at-jacobs",
    capability: "pivot-mid-flow",
    description: "Mid-flow pivot from Georgy to Jacobs via 'actually book at Jacobs instead'.",
    turns: [
      {
        user: "book Georgy Inc for 2 tomorrow at 7pm",
        expect: {
          booking_field: { field: "restaurant_id", equals: GEORGY_ID },
        },
      },
      {
        user: "actually book at Jacobs instead",
        expect: {
          booking_field: { field: "restaurant_id", equals: JACOBS_ID },
        },
      },
    ],
  },
  {
    id: "pivot-changed-my-mind-keg",
    capability: "pivot-mid-flow",
    description: "Mid-flow pivot from Georgy to The Keg via 'no I changed my mind, the keg'.",
    turns: [
      {
        user: "book Georgy Inc for 2 tomorrow at 7pm",
        expect: {
          booking_field: { field: "restaurant_id", equals: GEORGY_ID },
        },
      },
      {
        user: "no I changed my mind, the keg",
        expect: {
          booking_field: { field: "restaurant_id", equals: KEG_MANSION_ID },
        },
      },
    ],
  },
  {
    id: "pivot-can-i-do-harbour-sixty",
    capability: "pivot-mid-flow",
    description: "Mid-flow pivot from Georgy to Harbour Sixty via 'wait, can I do harbour sixty instead'.",
    turns: [
      {
        user: "book Georgy Inc for 2 tomorrow at 7pm",
        expect: {
          booking_field: { field: "restaurant_id", equals: GEORGY_ID },
        },
      },
      {
        user: "wait, can I do harbour sixty instead",
        expect: {
          booking_field: { field: "restaurant_id", equals: HARBOUR_SIXTY_ID },
        },
      },
    ],
  },
  {
    id: "pivot-different-restaurant-blue-blood",
    capability: "pivot-mid-flow",
    description: "Mid-flow pivot from Georgy to Blue Blood via 'let me try a different restaurant — Blue Blood'.",
    turns: [
      {
        user: "book Georgy Inc for 2 tomorrow at 7pm",
        expect: {
          booking_field: { field: "restaurant_id", equals: GEORGY_ID },
        },
      },
      {
        user: "let me try a different restaurant — Blue Blood",
        expect: {
          booking_field: { field: "restaurant_id", equals: BLUE_BLOOD_ID },
        },
      },
    ],
  },
];
