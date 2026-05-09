import type {
  AssistantMemory,
  AssistantResponseType,
  DiscoverySortMode,
  UIActionType,
} from "@cenaiva/assistant";

export type CenaivaRecommendationMode = "single" | "list";

const BOOKING_WORDS =
  /\b(book|reserve|reservation|table|slot|availability|available|confirm|pre-?order|preorder|order|checkout|pay|payment)\b/i;

const PLURAL_DISCOVERY_WORDS = /\b(restaurants|places|spots|options|recommendations)\b/i;
const EXPLICIT_SINGLE_WORDS = /\b(one|single|just one|only one|a restaurant|a place|a spot)\b/i;

const SINGLE_RECOMMENDATION_PATTERNS = [
  /\bclosest\s+(restaurant|place|spot)\b/i,
  /\bnearest\s+(restaurant|place|spot)\b/i,
  /\bbest\s+(restaurant|place|spot)\b/i,
  /\btop\s+(restaurant|place|spot|recommendation)\b/i,
  /\bpick\s+(a|one|the best)?\s*(restaurant|place|spot)?\b/i,
  /\brecommend\s+(a|one|the best)?\s*(restaurant|place|spot)\b/i,
  /\bwhere should i\s+(eat|go)\b/i,
  /\bwhat should i\s+(eat|try)\b/i,
];

const RESTAURANT_ARRAY_ACTIONS = new Set(["show_restaurant_cards", "update_map_markers"]);
const RESTAURANT_ID_ACTIONS = new Set(["highlight_restaurant", "open_restaurant_preview"]);
const BOOKING_FLOW_ACTIONS = new Set([
  "start_booking",
  "set_booking_field",
  "load_availability",
  "select_time_slot",
  "confirm_booking",
  "show_confirmation",
  "show_post_booking_questions",
  "offer_preorder",
  "show_menu",
  "add_menu_item",
  "remove_menu_item",
  "clear_cart",
  "set_tip_choice",
  "set_tip",
  "set_payment_split",
  "navigate_to_checkout",
  "show_payment_success",
]);

function normalizeTranscript(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      ),
    ),
  );
}

function actionRestaurantIds(action: UIActionType): string[] {
  if (RESTAURANT_ARRAY_ACTIONS.has(action.type)) {
    return Array.isArray((action as { restaurant_ids?: unknown }).restaurant_ids)
      ? ((action as { restaurant_ids: string[] }).restaurant_ids)
      : [];
  }
  if (
    RESTAURANT_ID_ACTIONS.has(action.type) ||
    action.type === "start_booking" ||
    action.type === "show_menu"
  ) {
    const id = (action as { restaurant_id?: unknown }).restaurant_id;
    return typeof id === "string" ? [id] : [];
  }
  return [];
}

export function getCenaivaRecommendationMode(
  transcript: string,
): CenaivaRecommendationMode | null {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return null;
  if (BOOKING_WORDS.test(normalized)) return null;

  const explicitSingle = EXPLICIT_SINGLE_WORDS.test(normalized);
  const asksForPluralList = PLURAL_DISCOVERY_WORDS.test(normalized) && !explicitSingle;
  if (asksForPluralList && !/\b(closest|nearest|best|top)\s+restaurant\b/i.test(normalized)) {
    return "list";
  }

  return SINGLE_RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    explicitSingle
    ? "single"
    : null;
}

export function isSingleRestaurantRecommendationIntent(transcript: string): boolean {
  return getCenaivaRecommendationMode(transcript) === "single";
}

function chooseSingleRestaurantId(response: AssistantResponseType): string | null {
  return getResponseRestaurantIds(response)[0] ?? null;
}

function getResponseRestaurantIds(response: AssistantResponseType): string[] {
  const actionIds = (response.ui_actions ?? []).flatMap(actionRestaurantIds);
  return unique([
    response.map?.highlighted_restaurant_id,
    ...(response.map?.marker_restaurant_ids ?? []),
    ...actionIds,
  ]);
}

function capRestaurantAction(
  action: UIActionType,
  restaurantId: string,
): UIActionType | null {
  if (BOOKING_FLOW_ACTIONS.has(action.type)) return null;

  if (RESTAURANT_ARRAY_ACTIONS.has(action.type)) {
    return { ...action, restaurant_ids: [restaurantId] } as UIActionType;
  }

  if (RESTAURANT_ID_ACTIONS.has(action.type)) {
    return { ...action, restaurant_id: restaurantId } as UIActionType;
  }

  return action;
}

export function capSingleRecommendationSpokenText(spokenText: string): string {
  const trimmed = spokenText.trim();
  if (!trimmed) return spokenText;
  const looksLikeChoicePrompt =
    /\bwhich one\b/i.test(trimmed) ||
    /\blook(?:s)? good\b/i.test(trimmed) ||
    /\boptions?\b/i.test(trimmed);
  const hasListSeparator = /,\s+|\s+or\s+|\s+and\s+/i.test(trimmed);
  if (!looksLikeChoicePrompt || !hasListSeparator) return spokenText;

  const withoutQuestion = trimmed
    .replace(/\s*(which one|which sounds|what sounds).+$/i, "")
    .trim();
  const dateSpotMatch = withoutQuestion.match(
    /^for\s+.+?,\s*([^,]+?)(?:,|\s+or\s+|\s+and\s+|$)/i,
  );
  const firstCandidate = (
    dateSpotMatch?.[1] ?? withoutQuestion.split(/,\s+|\s+or\s+|\s+and\s+/i)[0] ?? ""
  )
    .replace(/^(i found|i recommend|try|consider)\s+/i, "")
    .replace(/\blook(?:s)? good\b.*$/i, "")
    .replace(/[.!?,\s]+$/g, "")
    .trim();

  if (!firstCandidate || firstCandidate.split(/\s+/).length > 8) return spokenText;
  return `I'd go with ${firstCandidate}.`;
}

export function normalizeSingleRestaurantRecommendationResponse(
  response: AssistantResponseType,
  transcript: string,
): AssistantResponseType {
  if (!isSingleRestaurantRecommendationIntent(transcript)) return response;

  const restaurantId = chooseSingleRestaurantId(response);
  if (!restaurantId) {
    return {
      ...response,
      spoken_text: capSingleRecommendationSpokenText(response.spoken_text),
      booking: null,
      ui_actions: (response.ui_actions ?? []).filter(
        (action) => !BOOKING_FLOW_ACTIONS.has(action.type),
      ),
    };
  }

  const map = response.map
    ? {
        ...response.map,
        visible: response.map.visible ?? true,
        marker_restaurant_ids: [restaurantId],
        highlighted_restaurant_id: restaurantId,
      }
    : {
        visible: true,
        marker_restaurant_ids: [restaurantId],
        highlighted_restaurant_id: restaurantId,
      };

  return {
    ...response,
    spoken_text: capSingleRecommendationSpokenText(response.spoken_text),
    booking: null,
    map,
    ui_actions: (response.ui_actions ?? [])
      .map((action) => capRestaurantAction(action, restaurantId))
      .filter((action): action is UIActionType => Boolean(action)),
  };
}

function isMoreRestaurantsIntent(transcript: string): boolean {
  const normalized = normalizeTranscript(transcript);
  return (
    /\b(other|more|another|else|alternatives?|options?)\b/.test(normalized) &&
    /\b(restaurants?|places?|spots?|options?|recommendations?)\b/.test(normalized)
  );
}

function inferSortMode(transcript: string): DiscoverySortMode | null {
  const normalized = normalizeTranscript(transcript);
  if (/\b(closest|nearest|nearby|near me)\b/.test(normalized)) return "distance";
  if (/\b(best|top|highest rated|rating)\b/.test(normalized)) return "rating";
  if (/\b(cheap|affordable|budget|least expensive)\b/.test(normalized)) return "price_asc";
  if (/\b(expensive|fancy|premium|high end)\b/.test(normalized)) return "price_desc";
  return null;
}

function buildMapForIds(
  response: AssistantResponseType,
  restaurantIds: string[],
): AssistantResponseType["map"] {
  return {
    ...(response.map ?? {}),
    visible: true,
    marker_restaurant_ids: restaurantIds,
    highlighted_restaurant_id:
      restaurantIds[0] ?? response.map?.highlighted_restaurant_id ?? null,
  };
}

function updateRestaurantActions(
  action: UIActionType,
  restaurantIds: string[],
): UIActionType | null {
  if (RESTAURANT_ARRAY_ACTIONS.has(action.type)) {
    return { ...action, restaurant_ids: restaurantIds } as UIActionType;
  }
  if (RESTAURANT_ID_ACTIONS.has(action.type)) {
    const restaurantId = restaurantIds[0];
    return restaurantId
      ? ({ ...action, restaurant_id: restaurantId } as UIActionType)
      : null;
  }
  return action;
}

function mergeDiscoveryMemory(
  current: AssistantMemory | null | undefined,
  discovery: NonNullable<AssistantMemory["discovery"]>,
): AssistantMemory {
  return {
    discovery,
    booking_process: current?.booking_process ?? null,
  };
}

// Mobile schema treats `filters.cuisine` as a single string; web schema
// (FiltersDelta in @cenaiva/assistant) types it as `string[]`. Pick the
// first cuisine to keep the discovery memory single-valued (matches mobile
// semantics for "the active cuisine filter").
function firstCuisine(value: string | string[] | null | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function applyClientDiscoveryMemory(
  response: AssistantResponseType,
  transcript: string,
  opts?: {
    rawResponse?: AssistantResponseType;
    previousMemory?: AssistantMemory | null;
    recommendationMode?: CenaivaRecommendationMode | null;
  },
): AssistantResponseType {
  const previousDiscovery = opts?.previousMemory?.discovery ?? null;
  const incomingMemory = response.assistant_memory ?? null;
  if (incomingMemory?.discovery && !isMoreRestaurantsIntent(transcript)) return response;

  const responseIds = getResponseRestaurantIds(response);
  const rawIds = getResponseRestaurantIds(opts?.rawResponse ?? response);
  const hasRestaurantResponse = responseIds.length > 0 || rawIds.length > 0;
  if (!hasRestaurantResponse && !previousDiscovery) return response;

  if (isMoreRestaurantsIntent(transcript) && previousDiscovery) {
    const currentIds = rawIds.length ? rawIds : responseIds;
    const sourceIds = currentIds.length ? currentIds : previousDiscovery.full_restaurant_ids;
    const exhausted = new Set([
      ...previousDiscovery.exhausted_restaurant_ids,
      ...previousDiscovery.displayed_restaurant_ids,
    ]);
    const nextIds = sourceIds.filter((restaurantId) => !exhausted.has(restaurantId));
    if (!nextIds.length) return response;

    const displayedIds = nextIds.slice(0, 8);
    return {
      ...response,
      map: buildMapForIds(response, displayedIds),
      ui_actions: (response.ui_actions ?? [])
        .map((action) => updateRestaurantActions(action, displayedIds))
        .filter((action): action is UIActionType => Boolean(action)),
      assistant_memory: mergeDiscoveryMemory(incomingMemory, {
        ...previousDiscovery,
        transcript,
        recommendation_mode: "list",
        displayed_restaurant_ids: displayedIds,
        exhausted_restaurant_ids: unique([
          ...previousDiscovery.exhausted_restaurant_ids,
          ...previousDiscovery.displayed_restaurant_ids,
          ...displayedIds,
        ]),
      }),
    };
  }

  const fullIds = rawIds.length ? rawIds : responseIds;
  const displayedIds =
    opts?.recommendationMode === "single" && responseIds.length
      ? responseIds.slice(0, 1)
      : responseIds.length
        ? responseIds
        : fullIds;
  if (!displayedIds.length) return response;

  return {
    ...response,
    assistant_memory: mergeDiscoveryMemory(incomingMemory, {
      transcript,
      recommendation_mode: opts?.recommendationMode ?? null,
      cuisine: firstCuisine(response.filters?.cuisine) ?? previousDiscovery?.cuisine ?? null,
      cuisine_group: previousDiscovery?.cuisine_group ?? null,
      city: response.filters?.city ?? previousDiscovery?.city ?? null,
      query: response.filters?.query ?? previousDiscovery?.query ?? null,
      sort_by: inferSortMode(transcript) ?? previousDiscovery?.sort_by ?? null,
      full_restaurant_ids: fullIds,
      displayed_restaurant_ids: displayedIds,
      exhausted_restaurant_ids:
        opts?.recommendationMode === "single" ? displayedIds : [],
    }),
  };
}
