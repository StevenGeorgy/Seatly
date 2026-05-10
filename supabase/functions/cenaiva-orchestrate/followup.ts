export type AssistantIntent =
  | "reservation_create"
  | "reservation_modify"
  | "reservation_cancel"
  | "restaurant_search"
  | "menu_question"
  | "dinner_plan"
  | "preorder_food"
  | "payment_question"
  | "rewards_question"
  | "directions"
  | "restaurant_contact"
  | "general_question"
  | "fallback_unknown"
  | "discover_restaurants"
  | "book_restaurant"
  | "refine_search"
  | "select_restaurant"
  | "choose_party_size"
  | "choose_date"
  | "choose_time"
  | "confirm_booking"
  | "offer_preorder"
  | "build_cart"
  | "collect_tip"
  | "choose_payment"
  | "ask_post_booking_details"
  | "answer_restaurant_question"
  | "fallback_handoff";

export type AssistantStep =
  | "greeting"
  | "choose_cuisine"
  | "choose_location"
  | "choose_restaurant"
  | "choose_party"
  | "choose_date"
  | "choose_time"
  | "confirm"
  | "offer_preorder"
  | "build_cart"
  | "review_cart"
  | "collect_tip"
  | "choose_payment"
  | "post_booking"
  | "done";

export type AssistantNextInput =
  | "cuisine"
  | "location"
  | "restaurant"
  | "party_size"
  | "date"
  | "time"
  | "confirmation"
  | "preorder_choice"
  | "menu_selection"
  | "tip_timing"
  | "tip_amount"
  | "payment_split"
  | "post_booking_answer"
  | "none";

export interface VisibleRestaurant {
  id: string;
  name: string;
  cuisine_type: string | null;
}

export interface FollowUpAction {
  type: string;
  [key: string]: unknown;
}

export type RecommendationMode = "single" | "list";

export interface FollowUpContext {
  transcript: string;
  recommendation_mode?: RecommendationMode | null;
  selected_restaurant_id: string | null;
  booking_state: {
    restaurant_id?: string | null;
    party_size?: number | null;
    date?: string | null;
    time?: string | null;
    reservation_id?: string | null;
    status?: string | null;
  };
  derivedActions: FollowUpAction[];
  lastSearchIds: string[];
  lastAvailabilitySlots: Array<{
    shift_id: string;
    date_time: string;
    display_time: string;
  }>;
  preFilled: {
    party_size?: number;
    date?: string;
  };
  lastTextReply: string;
  visibleRestaurants: VisibleRestaurant[];
  lastSearchRestaurants: VisibleRestaurant[];
}

export interface DeterministicFollowUp {
  promoted_selected_restaurant_id: string | null;
  spoken_text: string;
  intent: AssistantIntent;
  step: AssistantStep;
  next_expected_input: AssistantNextInput;
  ui_actions: FollowUpAction[];
  booking: Record<string, unknown> | null;
  map: Record<string, unknown> | null;
  filters: Record<string, unknown> | null;
}

interface VisibleRestaurantResolution {
  selected: VisibleRestaurant | null;
  suggested: VisibleRestaurant | null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasAction(actions: FollowUpAction[], type: string): boolean {
  return actions.some((action) => action.type === type);
}

function firstRestaurantId(actions: FollowUpAction[], type: string): string | null {
  const match = actions.find((action) => action.type === type && typeof action.restaurant_id === "string");
  return typeof match?.restaurant_id === "string" ? match.restaurant_id : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePhrase(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

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
  const n = normalizePhrase(name);
  const t = normalizePhrase(transcript);
  if (!n || !t) return 0;
  if (t.includes(n)) return 100;

  const stop = new Set([
    "the", "a", "an", "and",
    "restaurant", "restaurants", "cafe", "bar", "grill", "kitchen", "bistro",
  ]);
  const nameTokens = n.split(" ").filter((word) => word.length >= 2 && !stop.has(word));
  const transcriptTokens = Array.from(new Set(t.split(" ").filter((word) => word.length >= 2)));

  let score = 0;
  for (const token of nameTokens) {
    if (transcriptTokens.includes(token)) {
      score += 10;
      continue;
    }
    for (const transcriptToken of transcriptTokens) {
      if (Math.abs(transcriptToken.length - token.length) > 2) continue;
      const maxLen = Math.max(transcriptToken.length, token.length);
      const allowed = maxLen <= 4 ? 1 : 2;
      if (levenshtein(transcriptToken, token) <= allowed) {
        score += 5;
        break;
      }
    }
  }
  return score;
}

function resolveOrdinalSelection(transcript: string, visibleRestaurants: VisibleRestaurant[]): VisibleRestaurant | null {
  if (!transcript.trim() || visibleRestaurants.length === 0) return null;
  const normalized = normalizePhrase(transcript);
  if (!normalized) return null;

  const patterns: Array<{ index: number; test: RegExp }> = [
    { index: 0, test: /\b(first|1st|number one|no 1|option one|the one on the left|left one)\b/i },
    { index: 1, test: /\b(second|2nd|number two|no 2|option two|the one on the right|right one)\b/i },
    { index: 2, test: /\b(third|3rd|number three|no 3|option three)\b/i },
    { index: 3, test: /\b(fourth|4th|number four|no 4|option four)\b/i },
  ];

  for (const pattern of patterns) {
    if (pattern.index < visibleRestaurants.length && pattern.test.test(normalized)) {
      return visibleRestaurants[pattern.index];
    }
  }

  if (/\b(last|final)\b/i.test(normalized)) {
    return visibleRestaurants[visibleRestaurants.length - 1] ?? null;
  }

  return null;
}

function isAffirmativeSelection(transcript: string): boolean {
  return /^\s*(yes|yeah|yep|yup|sure|ok|okay|alright|sounds good|that one|this one|book it|go ahead|do it|let'?s do it|lets do it)[\s.!,]*$/i.test(
    transcript,
  );
}

function resolveVisibleRestaurantSelection(
  transcript: string,
  visibleRestaurants: VisibleRestaurant[],
): VisibleRestaurantResolution {
  if (!transcript.trim() || visibleRestaurants.length === 0) {
    return { selected: null, suggested: null };
  }

  if (visibleRestaurants.length === 1 && isAffirmativeSelection(transcript)) {
    return { selected: visibleRestaurants[0], suggested: visibleRestaurants[0] };
  }

  const ordinalMatch = resolveOrdinalSelection(transcript, visibleRestaurants);
  if (ordinalMatch) {
    return { selected: ordinalMatch, suggested: ordinalMatch };
  }

  const scored = visibleRestaurants
    .map((restaurant) => ({
      restaurant,
      score: scoreNameMatch(restaurant.name, transcript),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const next = scored[1];
  if (!best) return { selected: null, suggested: null };
  if (best.score >= 20) return { selected: best.restaurant, suggested: best.restaurant };
  if (!next && best.score >= 10) return { selected: best.restaurant, suggested: best.restaurant };
  if (next && best.score >= next.score + 8 && best.score >= 10) {
    return { selected: best.restaurant, suggested: best.restaurant };
  }
  if (best.score >= 5) {
    return { selected: null, suggested: best.restaurant };
  }
  return { selected: null, suggested: null };
}

function matchesCuisinePhrase(transcript: string, cuisine: string): boolean {
  const normalizedTranscript = normalizePhrase(transcript);
  const normalizedCuisine = normalizePhrase(cuisine);
  if (!normalizedTranscript || !normalizedCuisine) return false;

  const direct = new RegExp(`(?:^|\\s)${escapeRegex(normalizedCuisine)}(?:\\s|$)`, "i");
  if (!direct.test(normalizedTranscript)) return false;

  const tokens = normalizedTranscript.split(" ").filter(Boolean);
  if (tokens.length <= 6) return true;

  const refinement = new RegExp(
    `\\b(?:only|just|show|find|looking|want|need|prefer|any)\\b[\\s\\S]{0,24}\\b${escapeRegex(normalizedCuisine)}\\b`,
    "i",
  );
  return refinement.test(normalizedTranscript);
}

function cuisineGroupFromTranscript(transcript: string): { label: string; terms: string[] } | null {
  const normalized = normalizePhrase(transcript);
  if (/\b(european|europeean|europian|euro)\b/i.test(normalized)) {
    return {
      label: "European",
      terms: [
        "european",
        "modern european",
        "italian",
        "french",
        "spanish",
        "mediterranean",
        "greek",
        "portuguese",
        "bistro",
        "tapas",
      ],
    };
  }
  if (/\b(asian)\b/i.test(normalized)) {
    return {
      label: "Asian",
      terms: ["asian", "chinese", "japanese", "korean", "thai", "vietnamese", "sushi", "ramen"],
    };
  }
  return null;
}

function inferOccasionTone(transcript: string): "date" | "business" | "family" | "group" | "birthday" | null {
  const normalized = normalizePhrase(transcript);
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

function joinRecommendedNames(restaurants: VisibleRestaurant[]): string {
  const names = restaurants
    .map((restaurant) => restaurant.name.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (names.length === 0) return "a few spots";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} or ${names[1]}`;
  return `${names[0]}, ${names[1]}, or ${names[2]}`;
}

function pick<T>(opts: T[]): T {
  return opts[Math.floor(Math.random() * opts.length)];
}

function buildRecommendationPrompt(
  transcript: string,
  restaurants: VisibleRestaurant[],
): string {
  const listedNames = joinRecommendedNames(restaurants);
  switch (inferOccasionTone(transcript)) {
    case "date":
      return pick([
        `For date night, ${listedNames} both look great. Lean toward one?`,
        `${listedNames} would both work for a date. Which feels right?`,
      ]);
    case "business":
      return pick([
        `For a business dinner, ${listedNames} fit the bill. Which one?`,
        `${listedNames} both work for a work dinner. Pick one?`,
      ]);
    case "family":
      return pick([
        `${listedNames} are both family-friendly. Which one sounds good?`,
        `For the family, ${listedNames} both work. Pick one?`,
      ]);
    case "group":
      return pick([
        `For a group, ${listedNames} both work. Which one?`,
        `${listedNames} can both handle the crew. Lean either way?`,
      ]);
    case "birthday":
      return pick([
        `${listedNames} both make for a fun birthday. Which one?`,
        `For a birthday, ${listedNames} look right. Pick one?`,
      ]);
    default:
      return pick([
        `${listedNames} both look solid. Which one's calling you?`,
        `Got two for you — ${listedNames}. Which one?`,
        `${listedNames} are both good picks. Lean either way?`,
        `Two options: ${listedNames}. Which sounds better?`,
      ]);
  }
}

function buildSingleCandidatePrompt(restaurant: VisibleRestaurant): string {
  return pick([
    `Found ${restaurant.name} — that the one?`,
    `Got it: ${restaurant.name}. Want me to lock that in?`,
    `${restaurant.name} — sound right?`,
    `Looks like ${restaurant.name}. That's the spot?`,
  ]);
}

function buildSingleRecommendationPrompt(
  transcript: string,
  restaurant: VisibleRestaurant,
): string {
  const name = restaurant.name.trim() || "this restaurant";
  if (/\b(close|closest|near me|nearby|around here|walking distance)\b/i.test(transcript)) {
    return `${name} is the closest strong match.`;
  }
  if (/\b(cheap|affordable|budget|not too expensive|deal|deals|special|happy hour)\b/i.test(transcript)) {
    return `${name} is the strongest budget-friendly match.`;
  }
  switch (inferOccasionTone(transcript)) {
    case "date":
      return `For a date spot, ${name} is the best fit.`;
    case "business":
      return `For a business dinner, ${name} is the best fit.`;
    case "family":
      return `For a family meal, ${name} is the best fit.`;
    case "group":
      return `For a group, ${name} is the strongest fit.`;
    case "birthday":
      return `For a birthday meal, ${name} is the best fit.`;
    default:
      return `${name} is the best fit.`;
  }
}

function buildSingleRecommendationFollowUp(
  context: FollowUpContext,
  restaurant: VisibleRestaurant,
  intent: AssistantIntent,
): DeterministicFollowUp {
  return {
    promoted_selected_restaurant_id: null,
    spoken_text: buildSingleRecommendationPrompt(context.transcript, restaurant),
    intent,
    step: "choose_restaurant",
    next_expected_input: "restaurant",
    ui_actions: [
      { type: "show_restaurant_cards", restaurant_ids: [restaurant.id] },
      { type: "update_map_markers", restaurant_ids: [restaurant.id] },
      { type: "highlight_restaurant", restaurant_id: restaurant.id },
    ],
    booking: null,
    map: {
      visible: true,
      marker_restaurant_ids: [restaurant.id],
      highlighted_restaurant_id: restaurant.id,
    },
    filters: null,
  };
}

function detectCuisineRefinement(
  transcript: string,
  visibleRestaurants: VisibleRestaurant[],
): { cuisine: string; restaurant_ids: string[] } | null {
  if (!transcript.trim() || visibleRestaurants.length === 0) return null;

  const cuisineBuckets = new Map<string, { label: string; restaurant_ids: string[] }>();
  for (const restaurant of visibleRestaurants) {
    if (!restaurant.cuisine_type) continue;
    const key = normalizePhrase(restaurant.cuisine_type);
    if (!key) continue;
    const bucket = cuisineBuckets.get(key) ?? {
      label: restaurant.cuisine_type,
      restaurant_ids: [],
    };
    bucket.restaurant_ids.push(restaurant.id);
    cuisineBuckets.set(key, bucket);
  }

  const matches = Array.from(cuisineBuckets.values())
    .filter((bucket) => matchesCuisinePhrase(transcript, bucket.label))
    .sort((a, b) => b.label.length - a.label.length);

  if (!matches.length) {
    const group = cuisineGroupFromTranscript(transcript);
    if (!group) return null;
    const restaurantIds = visibleRestaurants
      .filter((restaurant) => {
        const cuisine = normalizePhrase(restaurant.cuisine_type ?? "");
        return group.terms.some((term) => cuisine.includes(normalizePhrase(term)));
      })
      .map((restaurant) => restaurant.id);
    if (restaurantIds.length === 0 || restaurantIds.length === visibleRestaurants.length) {
      return null;
    }
    return {
      cuisine: group.label,
      restaurant_ids: restaurantIds,
    };
  }
  const best = matches[0];
  if (best.restaurant_ids.length === 0 || best.restaurant_ids.length === visibleRestaurants.length) {
    return null;
  }

  return {
    cuisine: best.label,
    restaurant_ids: best.restaurant_ids,
  };
}

function defaultPhase(
  status: string | null,
): Pick<DeterministicFollowUp, "intent" | "step" | "next_expected_input"> {
  switch (status) {
    case "loading_availability":
    case "awaiting_time_selection":
      return { intent: "choose_time", step: "choose_time", next_expected_input: "time" };
    case "confirming":
    case "confirmed":
      return { intent: "confirm_booking", step: "confirm", next_expected_input: "confirmation" };
    case "offering_preorder":
      return { intent: "offer_preorder", step: "offer_preorder", next_expected_input: "preorder_choice" };
    case "browsing_menu":
      return { intent: "build_cart", step: "build_cart", next_expected_input: "menu_selection" };
    case "reviewing_cart":
      return { intent: "build_cart", step: "review_cart", next_expected_input: "tip_timing" };
    case "choosing_tip_timing":
      return { intent: "collect_tip", step: "collect_tip", next_expected_input: "tip_timing" };
    case "choosing_tip_amount":
      return { intent: "collect_tip", step: "collect_tip", next_expected_input: "tip_amount" };
    case "choosing_payment_split":
    case "collecting_payment":
    case "charging":
      return { intent: "choose_payment", step: "choose_payment", next_expected_input: "payment_split" };
    case "paid":
      return { intent: "choose_payment", step: "done", next_expected_input: "none" };
    case "post_booking":
      return { intent: "ask_post_booking_details", step: "post_booking", next_expected_input: "post_booking_answer" };
    case "collecting_minimum_fields":
      return { intent: "book_restaurant", step: "choose_party", next_expected_input: "party_size" };
    case "idle":
    default:
      return { intent: "discover_restaurants", step: "choose_cuisine", next_expected_input: "cuisine" };
  }
}

function directBookingIntent(transcript: string): boolean {
  return /\b(book|reserve|get me a table|get me a spot|make a reservation)\b/i.test(transcript);
}

export function buildDeterministicFollowUp(context: FollowUpContext): DeterministicFollowUp {
  const selectedFromAction = firstRestaurantId(context.derivedActions, "start_booking");
  const visibleResolution = resolveVisibleRestaurantSelection(context.transcript, context.visibleRestaurants);
  const visibleSelection = visibleResolution.selected;
  const suggestedVisibleRestaurant = visibleResolution.suggested;
  const effectiveSelectedRestaurantId =
    context.selected_restaurant_id ??
    stringOrNull(context.booking_state.restaurant_id) ??
    visibleSelection?.id ??
    selectedFromAction;
  const effectivePartySize =
    numberOrNull(context.booking_state.party_size) ??
    numberOrNull(context.preFilled.party_size) ??
    null;
  const effectiveDate =
    stringOrNull(context.booking_state.date) ??
    stringOrNull(context.preFilled.date) ??
    null;
  const effectiveTime = stringOrNull(context.booking_state.time);
  const reservationId = stringOrNull(context.booking_state.reservation_id);
  const status = stringOrNull(context.booking_state.status) ?? "idle";
  const hasAvailability = hasAction(context.derivedActions, "load_availability") || context.lastAvailabilitySlots.length > 0;
  const hasConfirmation = hasAction(context.derivedActions, "show_confirmation") || !!reservationId;
  const trimmedLastText = context.lastTextReply.trim();
  const recommendedRestaurants = context.lastSearchRestaurants.length > 0
    ? context.lastSearchRestaurants
    : context.visibleRestaurants;
  const wantsSingleRecommendation = context.recommendation_mode === "single";

  if (!context.selected_restaurant_id && !stringOrNull(context.booking_state.restaurant_id) && visibleSelection) {
    return {
      promoted_selected_restaurant_id: visibleSelection.id,
      spoken_text: "How many guests?",
      intent: "select_restaurant",
      step: "choose_party",
      next_expected_input: "party_size",
      ui_actions: [
        { type: "highlight_restaurant", restaurant_id: visibleSelection.id },
        { type: "start_booking", restaurant_id: visibleSelection.id },
      ],
      booking: {
        restaurant_id: visibleSelection.id,
        status: "collecting_minimum_fields",
      },
      map: null,
      filters: null,
    };
  }

  const singleSuggestedRestaurant =
    context.lastSearchRestaurants.length === 1
      ? context.lastSearchRestaurants[0]
      : context.visibleRestaurants.length === 1
        ? context.visibleRestaurants[0]
        : null;

  if (!effectiveSelectedRestaurantId && singleSuggestedRestaurant) {
    if (wantsSingleRecommendation) {
      return buildSingleRecommendationFollowUp(
        context,
        singleSuggestedRestaurant,
        context.visibleRestaurants.length > 0 ? "refine_search" : "discover_restaurants",
      );
    }
    // If the LLM already produced a substantive reply (mentions the
    // restaurant name AND something more — a city, hours, fact answer), keep
    // it. The deterministic single-candidate template overrides anything
    // longer than 80 chars unless the LLM gave us actual content. This is
    // what lets factual questions ("where is Mark Testing", "is X halal")
    // surface the row's actual data instead of being silenced by
    // "Mark Testing — sound right?".
    const llmReply = trimmedLastText;
    const llmMentionsRestaurant = llmReply
      ? llmReply.toLowerCase().includes(singleSuggestedRestaurant.name.toLowerCase().split(" ")[0] ?? "")
      : false;
    const llmHasSubstance = llmReply.length >= 30 && llmMentionsRestaurant;
    return {
      promoted_selected_restaurant_id: null,
      spoken_text: llmHasSubstance ? llmReply : buildSingleCandidatePrompt(singleSuggestedRestaurant),
      intent: context.visibleRestaurants.length > 0 ? "refine_search" : "discover_restaurants",
      step: "choose_restaurant",
      next_expected_input: "confirmation",
      ui_actions: [],
      booking: null,
      map: {
        visible: true,
        marker_restaurant_ids: context.lastSearchIds.length > 0
          ? context.lastSearchIds
          : [singleSuggestedRestaurant.id],
      },
      filters: null,
    };
  }

  if (!effectiveSelectedRestaurantId && context.lastSearchIds.length === 0) {
    const refinement = detectCuisineRefinement(context.transcript, context.visibleRestaurants);
    if (refinement) {
      const ui_actions: FollowUpAction[] = [
        { type: "set_filters" },
        { type: "update_map_markers", restaurant_ids: refinement.restaurant_ids },
        { type: "show_restaurant_cards", restaurant_ids: refinement.restaurant_ids },
      ];
      const map: Record<string, unknown> = {
        visible: true,
        marker_restaurant_ids: refinement.restaurant_ids,
      };
      const filters = {
        cuisine: [refinement.cuisine],
      };

      if (refinement.restaurant_ids.length === 1) {
        const restaurantId = refinement.restaurant_ids[0];
        const matchedRestaurant = context.visibleRestaurants.find((restaurant) => restaurant.id === restaurantId);
        if (wantsSingleRecommendation && matchedRestaurant) {
          return buildSingleRecommendationFollowUp(context, matchedRestaurant, "refine_search");
        }
        return {
          promoted_selected_restaurant_id: null,
          spoken_text: buildSingleCandidatePrompt(
            matchedRestaurant ?? { id: restaurantId, name: "that restaurant", cuisine_type: null },
          ),
          intent: "refine_search",
          step: "choose_restaurant",
          next_expected_input: "confirmation",
          ui_actions,
          booking: null,
          map,
          filters,
        };
      }

      const highlightedRestaurantId = refinement.restaurant_ids[0];
      if (wantsSingleRecommendation) {
        const matchedRestaurant = context.visibleRestaurants.find((restaurant) => restaurant.id === highlightedRestaurantId);
        if (matchedRestaurant) {
          return buildSingleRecommendationFollowUp(context, matchedRestaurant, "refine_search");
        }
      }
      ui_actions.push({ type: "highlight_restaurant", restaurant_id: highlightedRestaurantId });
      map.highlighted_restaurant_id = highlightedRestaurantId;

      return {
        promoted_selected_restaurant_id: null,
        spoken_text: buildRecommendationPrompt(context.transcript, context.visibleRestaurants.filter((restaurant) =>
          refinement.restaurant_ids.includes(restaurant.id)
        )),
        intent: "refine_search",
        step: "choose_restaurant",
        next_expected_input: "restaurant",
        ui_actions,
        booking: null,
        map,
        filters,
      };
    }
  }

  if (!effectiveSelectedRestaurantId && context.lastSearchIds.length > 1 && context.lastSearchRestaurants.length > 0) {
    const highlightedRestaurantId = context.lastSearchRestaurants[0]?.id ?? context.lastSearchIds[0];
    if (wantsSingleRecommendation && context.lastSearchRestaurants[0]) {
      return buildSingleRecommendationFollowUp(
        context,
        context.lastSearchRestaurants[0],
        context.visibleRestaurants.length > 0 ? "refine_search" : "discover_restaurants",
      );
    }
    return {
      promoted_selected_restaurant_id: null,
      spoken_text: buildRecommendationPrompt(context.transcript, context.lastSearchRestaurants),
      intent: context.visibleRestaurants.length > 0 ? "refine_search" : "discover_restaurants",
      step: "choose_restaurant",
      next_expected_input: "restaurant",
      ui_actions: [{ type: "highlight_restaurant", restaurant_id: highlightedRestaurantId }],
      booking: null,
      map: {
        visible: true,
        marker_restaurant_ids: context.lastSearchIds,
        highlighted_restaurant_id: highlightedRestaurantId,
      },
      filters: null,
    };
  }

  if (!effectiveSelectedRestaurantId && context.visibleRestaurants.length > 0) {
    const visibleIds = context.visibleRestaurants.map((restaurant) => restaurant.id);
    if (suggestedVisibleRestaurant) {
      const prompt = /^did you mean\b/i.test(trimmedLastText)
        ? trimmedLastText
        : `Did you mean ${suggestedVisibleRestaurant.name}?`;
      return {
        promoted_selected_restaurant_id: null,
        spoken_text: prompt,
        intent: "refine_search",
        step: "choose_restaurant",
        next_expected_input: "confirmation",
        ui_actions: [
          { type: "highlight_restaurant", restaurant_id: suggestedVisibleRestaurant.id },
        ],
        booking: null,
        map: {
          visible: true,
          marker_restaurant_ids: visibleIds,
          highlighted_restaurant_id: suggestedVisibleRestaurant.id,
        },
        filters: null,
      };
    }
    const highlightedRestaurantId = visibleIds[0];
    if (wantsSingleRecommendation && recommendedRestaurants[0]) {
      return buildSingleRecommendationFollowUp(context, recommendedRestaurants[0], "refine_search");
    }
    return {
      promoted_selected_restaurant_id: null,
      spoken_text: buildRecommendationPrompt(context.transcript, recommendedRestaurants),
      intent: "refine_search",
      step: "choose_restaurant",
      next_expected_input: "restaurant",
      ui_actions: [{ type: "highlight_restaurant", restaurant_id: highlightedRestaurantId }],
      booking: null,
      map: {
        visible: true,
        marker_restaurant_ids: visibleIds,
        highlighted_restaurant_id: highlightedRestaurantId,
      },
      filters: null,
    };
  }

  if (effectiveSelectedRestaurantId && effectivePartySize == null) {
    return {
      promoted_selected_restaurant_id: effectiveSelectedRestaurantId,
      spoken_text: "How many guests?",
      intent: "select_restaurant",
      step: "choose_party",
      next_expected_input: "party_size",
      ui_actions: [],
      booking: {
        restaurant_id: effectiveSelectedRestaurantId,
        status: "collecting_minimum_fields",
      },
      map: null,
      filters: null,
    };
  }

  if (effectiveSelectedRestaurantId && effectivePartySize != null && effectiveDate && !effectiveTime && hasAvailability) {
    return {
      promoted_selected_restaurant_id: effectiveSelectedRestaurantId,
      spoken_text: "What time?",
      intent: "choose_time",
      step: "choose_time",
      next_expected_input: "time",
      ui_actions: [],
      booking: {
        restaurant_id: effectiveSelectedRestaurantId,
        party_size: effectivePartySize,
        date: effectiveDate,
      },
      map: null,
      filters: null,
    };
  }

  if (effectiveSelectedRestaurantId && effectivePartySize != null && (!effectiveDate || !effectiveTime)) {
    return {
      promoted_selected_restaurant_id: effectiveSelectedRestaurantId,
      spoken_text: "What date and time?",
      intent: "choose_date",
      step: "choose_date",
      next_expected_input: "date",
      ui_actions: [],
      booking: {
        restaurant_id: effectiveSelectedRestaurantId,
        party_size: effectivePartySize,
        ...(effectiveDate ? { date: effectiveDate } : {}),
      },
      map: null,
      filters: null,
    };
  }

  if (!effectiveSelectedRestaurantId && context.lastSearchIds.length > 1) {
    const highlightedRestaurantId = recommendedRestaurants[0]?.id ?? context.lastSearchIds[0];
    if (wantsSingleRecommendation && recommendedRestaurants[0]) {
      return buildSingleRecommendationFollowUp(
        context,
        recommendedRestaurants[0],
        context.visibleRestaurants.length > 0 ? "refine_search" : "discover_restaurants",
      );
    }
    return {
      promoted_selected_restaurant_id: null,
      spoken_text: buildRecommendationPrompt(context.transcript, recommendedRestaurants),
      intent: context.visibleRestaurants.length > 0 ? "refine_search" : "discover_restaurants",
      step: "choose_restaurant",
      next_expected_input: "restaurant",
      ui_actions: [{ type: "highlight_restaurant", restaurant_id: highlightedRestaurantId }],
      booking: null,
      map: {
        visible: true,
        marker_restaurant_ids: context.lastSearchIds,
        highlighted_restaurant_id: highlightedRestaurantId,
      },
      filters: null,
    };
  }

  if (status === "confirming") {
    return {
      promoted_selected_restaurant_id: effectiveSelectedRestaurantId,
      spoken_text: trimmedLastText || "Please confirm the booking details.",
      intent: "confirm_booking",
      step: "confirm",
      next_expected_input: "confirmation",
      ui_actions: [],
      booking: {
        ...(effectiveSelectedRestaurantId ? { restaurant_id: effectiveSelectedRestaurantId } : {}),
        ...(effectivePartySize != null ? { party_size: effectivePartySize } : {}),
        ...(effectiveDate ? { date: effectiveDate } : {}),
        ...(effectiveTime ? { time: effectiveTime } : {}),
        status: "confirming",
      },
      map: null,
      filters: null,
    };
  }

  if (hasConfirmation) {
    return {
      promoted_selected_restaurant_id: effectiveSelectedRestaurantId,
      spoken_text: trimmedLastText || "Your table is booked.",
      intent: "confirm_booking",
      step: "confirm",
      next_expected_input: "preorder_choice",
      ui_actions: [],
      booking: reservationId ? { reservation_id: reservationId } : null,
      map: null,
      filters: null,
    };
  }

  const phase = defaultPhase(status);
  if (trimmedLastText) {
    return {
      promoted_selected_restaurant_id: effectiveSelectedRestaurantId,
      spoken_text: trimmedLastText,
      intent: phase.intent,
      step: phase.step,
      next_expected_input: phase.next_expected_input,
      ui_actions: [],
      booking: null,
      map: null,
      filters: null,
    };
  }

  // Last-resort spoken_text. The model produced no text and we couldn't pin
  // down a specific phase. Prefer naming what the user can SEE on the map;
  // otherwise ask for the restaurant preference directly.
  const fallbackSpoken = (() => {
    const visible = context.visibleRestaurants ?? [];
    if (visible.length > 0) {
      const names = visible.slice(0, 3).map((r) => r.name);
      if (names.length === 1) return pick([`Found ${names[0]} — want to book it?`, `Got ${names[0]}. Lock that in?`, `${names[0]} — sound good?`]);
      if (names.length === 2) return pick([`${names[0]} and ${names[1]} both look good — which one?`, `Two for you: ${names[0]} or ${names[1]}. Lean either way?`]);
      return pick([`${names[0]}, ${names[1]}, ${names[2]} — pick one?`, `Three options: ${names[0]}, ${names[1]}, ${names[2]}. Which sounds best?`]);
    }
    const searched = context.lastSearchRestaurants ?? [];
    if (searched.length > 0) {
      const names = searched.slice(0, 3).map((r) => r.name);
      if (names.length === 1) return pick([`Found ${names[0]} — that the one?`, `Got it: ${names[0]}. Want me to lock it in?`, `${names[0]} — sound right?`]);
      if (names.length === 2) return pick([`${names[0]} or ${names[1]} — both look solid. Which one?`, `Two for you: ${names[0]} or ${names[1]}. Lean either way?`]);
      return pick([`${names[0]}, ${names[1]}, ${names[2]} — pick one?`, `Three options: ${names[0]}, ${names[1]}, ${names[2]}. Which sounds better?`]);
    }
    if (directBookingIntent(context.transcript)) return pick(["Which restaurant?", "Got a spot in mind?", "Where should I book?"]);
    return pick([
      "Tell me a cuisine, vibe, or area and I'll narrow it down.",
      "Got a cuisine, vibe, or area in mind?",
      "What sounds good — cuisine, vibe, or area?",
    ]);
  })();

  return {
    promoted_selected_restaurant_id: effectiveSelectedRestaurantId,
    spoken_text: fallbackSpoken,
    intent: phase.intent,
    step: phase.step,
    next_expected_input: phase.next_expected_input,
    ui_actions: [],
    booking: null,
    map: null,
    filters: null,
  };
}
