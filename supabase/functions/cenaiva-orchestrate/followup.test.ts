import {
  buildDeterministicFollowUp,
  type DeterministicFollowUp,
  type FollowUpContext,
} from "./followup.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${label}\nexpected: ${expectedJson}\nactual:   ${actualJson}`);
}

function makeContext(overrides: Partial<FollowUpContext> = {}): FollowUpContext {
  return {
    transcript: "",
    selected_restaurant_id: null,
    booking_state: {},
    derivedActions: [],
    lastSearchIds: [],
    lastAvailabilitySlots: [],
    preFilled: {},
    lastTextReply: "",
    visibleRestaurants: [],
    lastSearchRestaurants: [],
    ...overrides,
  };
}

function pick(result: DeterministicFollowUp) {
  return {
    spoken_text: result.spoken_text,
    intent: result.intent,
    step: result.step,
    next_expected_input: result.next_expected_input,
    ui_actions: result.ui_actions,
    booking: result.booking,
    map: result.map,
    filters: result.filters,
    promoted_selected_restaurant_id: result.promoted_selected_restaurant_id,
  };
}

Deno.test("first cuisine search with multiple matches recommends visible options", () => {
  const result = buildDeterministicFollowUp(makeContext({
    transcript: "Find me Italian restaurants",
    lastSearchIds: ["r1", "r2"],
    lastSearchRestaurants: [
      { id: "r1", name: "Osteria Giulia", cuisine_type: "Italian" },
      { id: "r2", name: "Bar Vendetta", cuisine_type: "Italian" },
    ],
  }));

  assertEquals(
    pick(result),
    {
      spoken_text: "Osteria Giulia or Bar Vendetta look good. Which one sounds best?",
      intent: "discover_restaurants",
      step: "choose_restaurant",
      next_expected_input: "restaurant",
      ui_actions: [{ type: "highlight_restaurant", restaurant_id: "r1" }],
      booking: null,
      map: { visible: true, marker_restaurant_ids: ["r1", "r2"], highlighted_restaurant_id: "r1" },
      filters: null,
      promoted_selected_restaurant_id: null,
    },
    "multi-search follow-up",
  );
});

Deno.test("first cuisine search with one match asks the user to confirm the restaurant", () => {
  const result = buildDeterministicFollowUp(makeContext({
    transcript: "Find me Italian",
    lastSearchIds: ["r1"],
    lastSearchRestaurants: [
      { id: "r1", name: "Osteria Giulia", cuisine_type: "Italian" },
    ],
  }));

  assertEquals(
    pick(result),
    {
      spoken_text: "I found Osteria Giulia. Want that one?",
      intent: "discover_restaurants",
      step: "choose_restaurant",
      next_expected_input: "confirmation",
      ui_actions: [],
      booking: null,
      map: { visible: true, marker_restaurant_ids: ["r1"] },
      filters: null,
      promoted_selected_restaurant_id: null,
    },
    "single-search follow-up",
  );
});

Deno.test("cuisine refinement on visible candidates with multiple matches names the narrowed options", () => {
  const result = buildDeterministicFollowUp(makeContext({
    transcript: "Only Japanese",
    visibleRestaurants: [
      { id: "a", name: "Roma", cuisine_type: "Italian" },
      { id: "b", name: "Sora", cuisine_type: "Japanese" },
      { id: "c", name: "Kumo", cuisine_type: "Japanese" },
    ],
  }));

  assertEquals(
    pick(result),
    {
      spoken_text: "Sora or Kumo look good. Which one sounds best?",
      intent: "refine_search",
      step: "choose_restaurant",
      next_expected_input: "restaurant",
      ui_actions: [
        { type: "set_filters" },
        { type: "update_map_markers", restaurant_ids: ["b", "c"] },
        { type: "show_restaurant_cards", restaurant_ids: ["b", "c"] },
        { type: "highlight_restaurant", restaurant_id: "b" },
      ],
      booking: null,
      map: { visible: true, marker_restaurant_ids: ["b", "c"], highlighted_restaurant_id: "b" },
      filters: { cuisine: ["Japanese"] },
      promoted_selected_restaurant_id: null,
    },
    "multi-result refinement follow-up",
  );
});

Deno.test("date-spot recommendation names the best bottom-row suggestions", () => {
  const result = buildDeterministicFollowUp(makeContext({
    transcript: "Show me a good date spot",
    lastSearchIds: ["r1", "r2", "r3"],
    lastSearchRestaurants: [
      { id: "r1", name: "Le Select", cuisine_type: "French" },
      { id: "r2", name: "Bar Isabel", cuisine_type: "Spanish" },
      { id: "r3", name: "Osteria Giulia", cuisine_type: "Italian" },
    ],
  }));

  assertEquals(
    pick(result),
    {
      spoken_text: "For a date spot, Le Select, Bar Isabel, or Osteria Giulia stand out. Which one sounds best?",
      intent: "discover_restaurants",
      step: "choose_restaurant",
      next_expected_input: "restaurant",
      ui_actions: [{ type: "highlight_restaurant", restaurant_id: "r1" }],
      booking: null,
      map: { visible: true, marker_restaurant_ids: ["r1", "r2", "r3"], highlighted_restaurant_id: "r1" },
      filters: null,
      promoted_selected_restaurant_id: null,
    },
    "date recommendation follow-up",
  );
});

Deno.test("cuisine refinement collapsing to one visible candidate asks for confirmation first", () => {
  const result = buildDeterministicFollowUp(makeContext({
    transcript: "Only Japanese",
    visibleRestaurants: [
      { id: "a", name: "Roma", cuisine_type: "Italian" },
      { id: "b", name: "Sora", cuisine_type: "Japanese" },
    ],
  }));

  assertEquals(
    pick(result),
    {
      spoken_text: "I found Sora. Want that one?",
      intent: "refine_search",
      step: "choose_restaurant",
      next_expected_input: "confirmation",
      ui_actions: [
        { type: "set_filters" },
        { type: "update_map_markers", restaurant_ids: ["b"] },
        { type: "show_restaurant_cards", restaurant_ids: ["b"] },
      ],
      booking: null,
      map: { visible: true, marker_restaurant_ids: ["b"] },
      filters: { cuisine: ["Japanese"] },
      promoted_selected_restaurant_id: null,
    },
    "single-result refinement follow-up",
  );
});

Deno.test("visible restaurant selection by exact name starts booking immediately", () => {
  const result = buildDeterministicFollowUp(makeContext({
    transcript: "Steven Georgy",
    visibleRestaurants: [
      { id: "a", name: "Georgy Inc", cuisine_type: "Egyptian" },
      { id: "b", name: "Steven Georgy", cuisine_type: "Egyptian" },
    ],
  }));

  assertEquals(
    pick(result),
    {
      spoken_text: "How many guests?",
      intent: "select_restaurant",
      step: "choose_party",
      next_expected_input: "party_size",
      ui_actions: [
        { type: "highlight_restaurant", restaurant_id: "b" },
        { type: "start_booking", restaurant_id: "b" },
      ],
      booking: { restaurant_id: "b", status: "collecting_minimum_fields" },
      map: null,
      filters: null,
      promoted_selected_restaurant_id: "b",
    },
    "visible name selection follow-up",
  );
});

Deno.test("visible restaurant selection keeps legal suffixes meaningful", () => {
  const result = buildDeterministicFollowUp(makeContext({
    transcript: "Georgy Inc",
    visibleRestaurants: [
      { id: "a", name: "Georgy Inc", cuisine_type: "Egyptian" },
      { id: "b", name: "Steven Georgy", cuisine_type: "Egyptian" },
    ],
  }));

  assertEquals(
    pick(result),
    {
      spoken_text: "How many guests?",
      intent: "select_restaurant",
      step: "choose_party",
      next_expected_input: "party_size",
      ui_actions: [
        { type: "highlight_restaurant", restaurant_id: "a" },
        { type: "start_booking", restaurant_id: "a" },
      ],
      booking: { restaurant_id: "a", status: "collecting_minimum_fields" },
      map: null,
      filters: null,
      promoted_selected_restaurant_id: "a",
    },
    "visible legal suffix selection follow-up",
  );
});

Deno.test("visible restaurant selection by ordinal starts booking immediately", () => {
  const result = buildDeterministicFollowUp(makeContext({
    transcript: "the first one",
    visibleRestaurants: [
      { id: "a", name: "Georgy Inc", cuisine_type: "Egyptian" },
      { id: "b", name: "Steven Georgy", cuisine_type: "Egyptian" },
    ],
  }));

  assertEquals(
    pick(result),
    {
      spoken_text: "How many guests?",
      intent: "select_restaurant",
      step: "choose_party",
      next_expected_input: "party_size",
      ui_actions: [
        { type: "highlight_restaurant", restaurant_id: "a" },
        { type: "start_booking", restaurant_id: "a" },
      ],
      booking: { restaurant_id: "a", status: "collecting_minimum_fields" },
      map: null,
      filters: null,
      promoted_selected_restaurant_id: "a",
    },
    "visible ordinal selection follow-up",
  );
});

Deno.test("ambiguous partial restaurant reply suggests one concrete candidate instead of looping the generic question", () => {
  const result = buildDeterministicFollowUp(makeContext({
    transcript: "Georgy",
    visibleRestaurants: [
      { id: "a", name: "Georgy Inc", cuisine_type: "Egyptian" },
      { id: "b", name: "Steven Georgy", cuisine_type: "Egyptian" },
    ],
  }));

  assertEquals(
    pick(result),
    {
      spoken_text: "Did you mean Georgy Inc?",
      intent: "refine_search",
      step: "choose_restaurant",
      next_expected_input: "confirmation",
      ui_actions: [
        { type: "highlight_restaurant", restaurant_id: "a" },
      ],
      booking: null,
      map: { visible: true, marker_restaurant_ids: ["a", "b"], highlighted_restaurant_id: "a" },
      filters: null,
      promoted_selected_restaurant_id: null,
    },
    "ambiguous restaurant suggestion follow-up",
  );
});

Deno.test("visible restaurants with no resolved selection still names the visible options", () => {
  const result = buildDeterministicFollowUp(makeContext({
    transcript: "that place",
    visibleRestaurants: [
      { id: "a", name: "Georgy Inc", cuisine_type: "Egyptian" },
      { id: "b", name: "Steven Georgy", cuisine_type: "Egyptian" },
    ],
  }));

  assertEquals(
    pick(result),
    {
      spoken_text: "Georgy Inc or Steven Georgy look good. Which one sounds best?",
      intent: "refine_search",
      step: "choose_restaurant",
      next_expected_input: "restaurant",
      ui_actions: [{ type: "highlight_restaurant", restaurant_id: "a" }],
      booking: null,
      map: { visible: true, marker_restaurant_ids: ["a", "b"], highlighted_restaurant_id: "a" },
      filters: null,
      promoted_selected_restaurant_id: null,
    },
    "visible candidates fallback follow-up",
  );
});

Deno.test("selected restaurant with missing party size asks the first booking question", () => {
  const result = buildDeterministicFollowUp(makeContext({
    selected_restaurant_id: "r1",
    booking_state: {},
  }));

  assertEquals(
    pick(result),
    {
      spoken_text: "How many guests?",
      intent: "select_restaurant",
      step: "choose_party",
      next_expected_input: "party_size",
      ui_actions: [],
      booking: { restaurant_id: "r1", status: "collecting_minimum_fields" },
      map: null,
      filters: null,
      promoted_selected_restaurant_id: "r1",
    },
    "selected restaurant follow-up",
  );
});

Deno.test("party size present with missing date/time asks the second booking question", () => {
  const result = buildDeterministicFollowUp(makeContext({
    selected_restaurant_id: "r1",
    booking_state: { party_size: 2 },
  }));

  assertEquals(
    pick(result),
    {
      spoken_text: "What date and time?",
      intent: "choose_date",
      step: "choose_date",
      next_expected_input: "date",
      ui_actions: [],
      booking: { restaurant_id: "r1", party_size: 2 },
      map: null,
      filters: null,
      promoted_selected_restaurant_id: "r1",
    },
    "date/time follow-up",
  );
});

Deno.test("availability loaded with missing time asks for a time", () => {
  const result = buildDeterministicFollowUp(makeContext({
    selected_restaurant_id: "r1",
    booking_state: { party_size: 2, date: "2026-04-26" },
    derivedActions: [{ type: "load_availability" }],
    lastAvailabilitySlots: [{ shift_id: "s1", date_time: "2026-04-26T19:00:00Z", display_time: "7:00 PM" }],
  }));

  assertEquals(
    pick(result),
    {
      spoken_text: "What time?",
      intent: "choose_time",
      step: "choose_time",
      next_expected_input: "time",
      ui_actions: [],
      booking: { restaurant_id: "r1", party_size: 2, date: "2026-04-26" },
      map: null,
      filters: null,
      promoted_selected_restaurant_id: "r1",
    },
    "time follow-up",
  );
});

Deno.test("confirming booking waits for explicit user confirmation", () => {
  const result = buildDeterministicFollowUp(makeContext({
    selected_restaurant_id: "r1",
    booking_state: {
      restaurant_id: "r1",
      party_size: 4,
      date: "2026-05-01",
      time: "8:00 PM",
      status: "confirming",
    },
    lastTextReply: "Just confirming: table for 4 at La Piazza, Fri, May 1 at 8:00 PM. Should I book it?",
  }));

  assertEquals(
    pick(result),
    {
      spoken_text: "Just confirming: table for 4 at La Piazza, Fri, May 1 at 8:00 PM. Should I book it?",
      intent: "confirm_booking",
      step: "confirm",
      next_expected_input: "confirmation",
      ui_actions: [],
      booking: {
        restaurant_id: "r1",
        party_size: 4,
        date: "2026-05-01",
        time: "8:00 PM",
        status: "confirming",
      },
      map: null,
      filters: null,
      promoted_selected_restaurant_id: "r1",
    },
    "confirming follow-up",
  );
});

Deno.test("true dead-end case falls back to the generic prompt with schema-valid enums", () => {
  const result = buildDeterministicFollowUp(makeContext());

  assertEquals(
    pick(result),
    {
      spoken_text: "What kind of restaurant are you looking for?",
      intent: "discover_restaurants",
      step: "choose_cuisine",
      next_expected_input: "cuisine",
      ui_actions: [],
      booking: null,
      map: null,
      filters: null,
      promoted_selected_restaurant_id: null,
    },
    "generic fallback",
  );
});
