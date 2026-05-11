# Step 2 source handoff — mobile helpers + tests for the web port

> Companion to [`jolly-prancing-clover.md`](./jolly-prancing-clover.md) and [`step2-handoff-options.md`](./step2-handoff-options.md).
> Status: Steps 0a, 1, 3, 4, 5, 6, 7, 10 shipped. Step 2 has 2 of 5 helpers ported (`confirmationIntent`, `simplePromptIntent`).
> This file contains verbatim source for the 3 remaining helpers and the 3 paired test files, captured from `/Users/savyoyaqoop/mobile-seatly-v2-15/`.
>
> **Note on file count.** The brief mentioned "4 test files." There are 3 paired tests for the 3 helpers in this doc. The plausible 4th candidates — `simplePromptIntent.test.ts` (for the already-ported `simplePromptIntent`) and `confirmationIntent.test.ts` (for the already-ported `confirmationIntent`) — were not included; say the word and I'll append them. `promptMatrix.test.ts` is *not* a Step 2 test (it depends on `lib/cenaiva/qa/*` modules outside Step 2 scope).

---

## How to use this doc

For each of the 6 files below: copy the fenced TS block into the corresponding location in the web repo. Apply the per-file adaptation notes (typically nothing; the only real adaptation is one import line in `filterRestaurants.ts` and its test).

| Source path (this repo) | Destination path (web repo, suggested) | Adaptation |
|---|---|---|
| `lib/cenaiva/recommendationIntent.ts` | `apps/web/src/lib/cenaiva/recommendationIntent.ts` | none — verbatim |
| `lib/cenaiva/filterRestaurants.ts` | `apps/web/src/lib/cenaiva/filterRestaurants.ts` | swap `Restaurant` import to web's path; verify 7 field accesses |
| `lib/cenaiva/localBookingCollector.ts` | `apps/web/src/lib/cenaiva/localBookingCollector.ts` | none — verbatim (relies on already-ported `simplePromptIntent`) |
| `__tests__/cenaiva/recommendationIntent.test.ts` | `apps/web/src/lib/cenaiva/__tests__/recommendationIntent.test.ts` | none |
| `__tests__/cenaiva/filterRestaurants.test.ts` | `apps/web/src/lib/cenaiva/__tests__/filterRestaurants.test.ts` | swap `Restaurant` import; prune the `baseRestaurant` fixture to satisfy web's `Restaurant` shape |
| `__tests__/cenaiva/localBookingCollector.test.ts` | `apps/web/src/lib/cenaiva/__tests__/localBookingCollector.test.ts` | none |

After paste: `npm run typecheck && npm run test --workspace=apps/web`. All three test suites are pure `describe/it/expect` (no `jest.fn`, no timer mocks) and run unchanged in Vitest.

---

## File 1 — `lib/cenaiva/recommendationIntent.ts`

**Adaptation:** none. Sole import is `@cenaiva/assistant` types, which web has from Step 1.

```ts
import type {
  AssistantMemory,
  AssistantResponseType,
  DiscoverySortMode,
  UIActionType,
} from '@cenaiva/assistant';

export type CenaivaRecommendationMode = 'single' | 'list';

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

const RESTAURANT_ARRAY_ACTIONS = new Set(['show_restaurant_cards', 'update_map_markers']);
const RESTAURANT_ID_ACTIONS = new Set(['highlight_restaurant', 'open_restaurant_preview']);
const BOOKING_FLOW_ACTIONS = new Set([
  'start_booking',
  'set_booking_field',
  'load_availability',
  'select_time_slot',
  'confirm_booking',
  'show_confirmation',
  'show_post_booking_questions',
  'offer_preorder',
  'show_menu',
  'add_menu_item',
  'remove_menu_item',
  'clear_cart',
  'set_tip_choice',
  'set_tip',
  'set_payment_split',
  'navigate_to_checkout',
  'show_payment_success',
]);

function normalizeTranscript(value: string) {
  return value.toLowerCase().replace(/[^\w\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0)));
}

function actionRestaurantIds(action: UIActionType): string[] {
  if (RESTAURANT_ARRAY_ACTIONS.has(action.type)) {
    return Array.isArray((action as { restaurant_ids?: unknown }).restaurant_ids)
      ? ((action as { restaurant_ids: string[] }).restaurant_ids)
      : [];
  }
  if (RESTAURANT_ID_ACTIONS.has(action.type) || action.type === 'start_booking' || action.type === 'show_menu') {
    const id = (action as { restaurant_id?: unknown }).restaurant_id;
    return typeof id === 'string' ? [id] : [];
  }
  return [];
}

export function getCenaivaRecommendationMode(transcript: string): CenaivaRecommendationMode | null {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return null;
  if (BOOKING_WORDS.test(normalized)) return null;

  const explicitSingle = EXPLICIT_SINGLE_WORDS.test(normalized);
  const asksForPluralList = PLURAL_DISCOVERY_WORDS.test(normalized) && !explicitSingle;
  if (asksForPluralList && !/\b(closest|nearest|best|top)\s+restaurant\b/i.test(normalized)) {
    return 'list';
  }

  return SINGLE_RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(normalized)) || explicitSingle
    ? 'single'
    : null;
}

export function isSingleRestaurantRecommendationIntent(transcript: string) {
  return getCenaivaRecommendationMode(transcript) === 'single';
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

function capRestaurantAction(action: UIActionType, restaurantId: string): UIActionType | null {
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

  const withoutQuestion = trimmed.replace(/\s*(which one|which sounds|what sounds).+$/i, '').trim();
  const dateSpotMatch = withoutQuestion.match(/^for\s+.+?,\s*([^,]+?)(?:,|\s+or\s+|\s+and\s+|$)/i);
  const firstCandidate = (dateSpotMatch?.[1] ?? withoutQuestion.split(/,\s+|\s+or\s+|\s+and\s+/i)[0] ?? '')
    .replace(/^(i found|i recommend|try|consider)\s+/i, '')
    .replace(/\blook(?:s)? good\b.*$/i, '')
    .replace(/[.!?,\s]+$/g, '')
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
      ui_actions: (response.ui_actions ?? []).filter((action) => !BOOKING_FLOW_ACTIONS.has(action.type)),
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

function isMoreRestaurantsIntent(transcript: string) {
  const normalized = normalizeTranscript(transcript);
  return /\b(other|more|another|else|alternatives?|options?)\b/.test(normalized) &&
    /\b(restaurants?|places?|spots?|options?|recommendations?)\b/.test(normalized);
}

function inferSortMode(transcript: string): DiscoverySortMode | null {
  const normalized = normalizeTranscript(transcript);
  if (/\b(closest|nearest|nearby|near me)\b/.test(normalized)) return 'distance';
  if (/\b(best|top|highest rated|rating)\b/.test(normalized)) return 'rating';
  if (/\b(cheap|affordable|budget|least expensive)\b/.test(normalized)) return 'price_asc';
  if (/\b(expensive|fancy|premium|high end)\b/.test(normalized)) return 'price_desc';
  return null;
}

function buildMapForIds(response: AssistantResponseType, restaurantIds: string[]): AssistantResponseType['map'] {
  return {
    ...(response.map ?? {}),
    visible: true,
    marker_restaurant_ids: restaurantIds,
    highlighted_restaurant_id: restaurantIds[0] ?? response.map?.highlighted_restaurant_id ?? null,
  };
}

function updateRestaurantActions(action: UIActionType, restaurantIds: string[]): UIActionType | null {
  if (RESTAURANT_ARRAY_ACTIONS.has(action.type)) {
    return { ...action, restaurant_ids: restaurantIds } as UIActionType;
  }
  if (RESTAURANT_ID_ACTIONS.has(action.type)) {
    const restaurantId = restaurantIds[0];
    return restaurantId ? ({ ...action, restaurant_id: restaurantId } as UIActionType) : null;
  }
  return action;
}

function mergeDiscoveryMemory(
  current: AssistantMemory | null | undefined,
  discovery: NonNullable<AssistantMemory['discovery']>,
): AssistantMemory {
  return {
    discovery,
    booking_process: current?.booking_process ?? null,
  };
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
        recommendation_mode: 'list',
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
    opts?.recommendationMode === 'single' && responseIds.length
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
      cuisine: response.filters?.cuisine ?? previousDiscovery?.cuisine ?? null,
      cuisine_group: previousDiscovery?.cuisine_group ?? null,
      city: response.filters?.city ?? previousDiscovery?.city ?? null,
      query: response.filters?.query ?? previousDiscovery?.query ?? null,
      sort_by: inferSortMode(transcript) ?? previousDiscovery?.sort_by ?? null,
      full_restaurant_ids: fullIds,
      displayed_restaurant_ids: displayedIds,
      exhausted_restaurant_ids: opts?.recommendationMode === 'single' ? displayedIds : [],
    }),
  };
}
```

---

## File 2 — `lib/cenaiva/filterRestaurants.ts`

**Adaptation:** swap line 2's `Restaurant` import to web's path. Verify the seven field accesses (`id, name, cuisineType, description, city, area, tags`) against web's `Restaurant` shape — if web uses different casing (e.g. `cuisine_type`) or makes any of these optional, adapt the accesses accordingly. Cuisine-group constants stay as-is.

```ts
import type { FiltersDelta } from '@cenaiva/assistant';
import type { Restaurant } from '@/lib/mock/restaurants';   // ← swap to web's Restaurant type

function normalize(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function includesNormalized(source: string, target: string): boolean {
  return Boolean(source && target && source.includes(target));
}

const CUISINE_GROUPS: Record<string, string[]> = {
  european: [
    'european',
    'modern european',
    'italian',
    'french',
    'spanish',
    'mediterranean',
    'greek',
    'portuguese',
    'bistro',
    'tapas',
  ],
  asian: [
    'asian',
    'chinese',
    'japanese',
    'korean',
    'thai',
    'vietnamese',
    'filipino',
    'malaysian',
    'indonesian',
    'sushi',
    'ramen',
    'dim sum',
  ],
  latin: [
    'latin',
    'mexican',
    'peruvian',
    'brazilian',
    'argentinian',
    'colombian',
    'cuban',
    'venezuelan',
  ],
  'middle eastern': [
    'middle eastern',
    'mediterranean',
    'lebanese',
    'turkish',
    'persian',
    'egyptian',
    'moroccan',
    'halal',
  ],
};

function expandCuisineTerms(cuisines: string[] | undefined): string[] {
  const expanded = new Set<string>();
  for (const cuisine of cuisines ?? []) {
    const normalized = normalize(cuisine);
    if (!normalized) continue;
    expanded.add(normalized);
    for (const [group, terms] of Object.entries(CUISINE_GROUPS)) {
      if (normalized === group) {
        expanded.add(group);
        terms.map(normalize).filter(Boolean).forEach((term) => expanded.add(term));
      }
    }
  }
  return [...expanded];
}

function restaurantSearchText(restaurant: Restaurant): string {
  return normalize([
    restaurant.name,
    restaurant.cuisineType,
    restaurant.city,
    restaurant.area,
    restaurant.description,
    ...(restaurant.tags ?? []),
  ].join(' '));
}

function matchesCuisine(restaurant: Restaurant, cuisines: string[] | undefined): boolean {
  const cleaned = expandCuisineTerms(cuisines);
  if (!cleaned.length) return true;
  const cuisineText = normalize([
    restaurant.cuisineType,
    restaurant.name,
    ...(restaurant.tags ?? []),
  ].join(' '));
  return cleaned.some((cuisine) => includesNormalized(cuisineText, cuisine));
}

export function filterCenaivaRestaurants(
  restaurants: Restaurant[],
  markerRestaurantIds: string[],
  filters: FiltersDelta | null | undefined,
): Restaurant[] {
  const markerIds = Array.isArray(markerRestaurantIds) ? markerRestaurantIds : [];
  const restaurantsById = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));
  if (markerIds.length) {
    return markerIds
      .map((restaurantId) => restaurantsById.get(restaurantId))
      .filter((restaurant): restaurant is Restaurant => Boolean(restaurant));
  }

  let next = restaurants;

  next = next.filter((restaurant) => matchesCuisine(restaurant, filters?.cuisine));

  const city = normalize(filters?.city);
  if (city) {
    next = next.filter((restaurant) => includesNormalized(normalize(restaurant.city), city));
  }

  const query = normalize(filters?.query);
  if (query) {
    next = next.filter((restaurant) => includesNormalized(restaurantSearchText(restaurant), query));
  }

  return next;
}
```

---

## File 3 — `lib/cenaiva/localBookingCollector.ts`

**Adaptation:** none. Imports are `@cenaiva/assistant` types + the already-ported `simplePromptIntent`. The helper has zero restaurant-catalog dependency — it operates over `BookingState` and parsed transcript fragments only.

```ts
import type {
  AssistantResponseType,
  BookingState,
  UIActionType,
} from '@cenaiva/assistant';
import { isCenaivaProcessPrompt } from '@/lib/cenaiva/simplePromptIntent';

type AvailabilityMode =
  | 'exact'
  | 'any_day_at_time'
  | 'weekday_any_time'
  | 'date_any_time'
  | 'first_available';

export type CenaivaAvailabilityRequest = {
  restaurant_id: string;
  restaurant_name?: string | null;
  party_size: number;
  mode: AvailabilityMode;
  purpose?: 'booking' | 'hours';
  date?: string | null;
  time?: string | null;
  weekday?: number | null;
  timezone?: string | null;
  search_days?: number;
  nearest_count?: number;
  split_at?: string;
};

export type CenaivaAvailabilityOption = {
  shift_id: string;
  shift_name?: string;
  date_time: string;
  display_time: string;
  date: string;
  diff_minutes?: number;
  hours_window?: string | null;
};

export type CenaivaAvailabilityResponse = {
  status: 'available' | 'unavailable' | 'options' | 'needs_more_info';
  requested?: {
    date?: string | null;
    time?: string | null;
    weekday?: number | null;
  };
  selected_slot?: CenaivaAvailabilityOption | null;
  alternatives?: CenaivaAvailabilityOption[];
  hours_window?: string | null;
  unavailable_reason?:
    | 'closed'
    | 'no_shifts'
    | 'party_size_out_of_range'
    | 'insufficient_capacity'
    | 'fully_booked'
    | 'no_future_slots'
    | 'no_slots'
    | string
    | null;
  message?: string;
};

export type LocalBookingDecision =
  | { kind: 'pass' }
  | {
      kind: 'local_response';
      response: AssistantResponseType;
      clearPendingOptions?: boolean;
    }
  | {
      kind: 'check_availability';
      request: CenaivaAvailabilityRequest;
      filler: string;
      responseBeforeCheck: AssistantResponseType;
    };

type LocalBookingContext = {
  transcript: string;
  booking: BookingState;
  conversationId: string | null;
  selectedRestaurantId?: string | null;
  selectedRestaurantName?: string | null;
  timezone?: string | null;
  pendingOptions?: CenaivaAvailabilityOption[];
  lastAssistantPrompt?: string | null;
};

type AmbiguousBareTime = {
  hour: number;
  minute: number;
  label: string;
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  one: 1,
  won: 1,
  two: 2,
  too: 2,
  to: 2,
  couple: 2,
  pair: 2,
  three: 3,
  four: 4,
  for: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  ate: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const TIME_WORDS: Record<string, number> = {
  midnight: 0,
  noon: 12,
  twelve: 12,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
};

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const PREORDER_PAYMENT_OR_POLICY_PATTERN =
  /\b(menu|pre[- ]?order|order food|checkout|pay|payment|card|deposit|refund|fee|tax|tip|directions?|address|phone|contact|hours?|parking|dress code|bring (?:a )?(?:dog|pet)|kids allowed|allow kids|wheelchair|accessible|accessibility|halal|gluten[- ]free|allerg(?:y|ies)|birthday cake|split bills?|no[- ]shows?|cancel reservation|change the booking later|modify reservation)\b/i;

const DISCOVERY_PATTERN =
  /\b(find|show|search|recommend|suggest|pick|choose|closest|nearest|near me|nearby|near|around me|restaurants?|places?|spots?|cuisine|italian|french|european|europeean|europian|japanese|sushi|thai|spanish|greek|mediterranean|steakhouse|egyptian|asian|halal|vegan|burgers?|mocktails?|cocktails?|vegetarian|seafood|steak|healthy|spicy|dessert|downtown|something nice|surprise me|you choose|cheaper|fancier|closer|different restaurant|switch to)\b/i;

const BACKEND_STATUSES = new Set<BookingState['status']>([
  'confirmed',
  'post_booking',
  'offering_preorder',
  'browsing_menu',
  'reviewing_cart',
  'choosing_tip_timing',
  'choosing_tip_amount',
  'choosing_payment_split',
  'collecting_payment',
  'charging',
  'paid',
]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTimeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[-,.!?;]/g, ' ')
    .replace(/\b(uh+|um+|er+|ah+|hmm+|please|pls|thanks|thank you|actually|maybe|i think|okay|ok|yeah|yep|yes|sure|alright)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function numberTokenToInt(token: string | undefined): number | null {
  if (!token) return null;
  if (/^\d+$/.test(token)) {
    const n = parseInt(token, 10);
    return n >= 1 && n <= 9999 ? n : null;
  }
  return NUMBER_WORDS[token] ?? null;
}

export function parseLocalPartySize(raw: string): number | null {
  const t = normalize(raw);
  if (/\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:or|to|-)\s*(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/.test(t)) {
    return null;
  }
  const adultsKids = t.match(
    /\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)\s+adults?\b[\s\S]{0,30}\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:kids?|children)\b/,
  );
  if (adultsKids) {
    const adults = numberTokenToInt(adultsKids[1]);
    const kids = numberTokenToInt(adultsKids[2]);
    if (adults != null && kids != null) return adults + kids;
  }
  const kidsAdults = t.match(
    /\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:kids?|children)\b[\s\S]{0,30}\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)\s+adults?\b/,
  );
  if (kidsAdults) {
    const kids = numberTokenToInt(kidsAdults[1]);
    const adults = numberTokenToInt(kidsAdults[2]);
    if (adults != null && kids != null) return adults + kids;
  }
  if (/\b(just me|solo|alone|by myself)\b/.test(t)) return 1;
  if (/\b(me plus one|me and (?:my )?(?:wife|husband|partner|boyfriend|girlfriend|date|friend))\b/.test(t)) {
    return 2;
  }
  if (/\b(double date)\b/.test(t)) return 4;

  const explicit = t.match(
    /\b(?:party of|table for|for|group of|we are|we're|make it|book for|reservation for)\s+(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|couple|pair)\b/,
  );
  if (explicit) {
    const n = numberTokenToInt(explicit[1]);
    if (n != null) return n;
  }

  const people = t.match(
    /\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:people|guests|guest|adults|pax|persons?|of us)\b/,
  );
  if (people) {
    const n = numberTokenToInt(people[1]);
    if (n != null) return n;
  }

  const bare = t.match(/^(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/);
  if (bare) return numberTokenToInt(bare[1]);
  return null;
}

function formatISODateInTimeZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addDaysToISODate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

function localDayOfWeek(dateStr: string, timezone: string): number {
  const localDow = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
  }).format(new Date(`${dateStr}T12:00:00Z`)).toLowerCase();
  return WEEKDAYS.indexOf(localDow);
}

export function parseLocalDate(raw: string, timezone = 'America/Toronto'): string | null {
  const t = normalize(raw);
  const todayIso = formatISODateInTimeZone(new Date(), timezone);
  if (/\b(today|tonight|this evening)\b/.test(t)) return todayIso;
  if (/\btomorrow\b/.test(t)) return addDaysToISODate(todayIso, 1);

  const iso = t.match(/\b(\d{4})\s+(\d{2})\s+(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const monthDay = t.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/,
  );
  if (monthDay) {
    const month = MONTHS[monthDay[1]];
    const day = parseInt(monthDay[2], 10);
    if (month && day >= 1 && day <= 31) {
      const currentYear = parseInt(todayIso.slice(0, 4), 10);
      let candidate = `${currentYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (candidate < todayIso) {
        candidate = `${currentYear + 1}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
      return candidate;
    }
  }

  const todayDow = localDayOfWeek(todayIso, timezone);
  for (let i = 0; i < WEEKDAYS.length; i += 1) {
    const re = new RegExp(`\\b(?:this|next|on)?\\s*${WEEKDAYS[i]}\\b`);
    if (!re.test(t)) continue;
    const diff = (i - todayDow + 7) % 7 || 7;
    return addDaysToISODate(todayIso, diff);
  }

  return null;
}

export function parseLocalWeekday(raw: string): number | null {
  const t = normalize(raw);
  for (let i = 0; i < WEEKDAYS.length; i += 1) {
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(t)) return i;
  }
  if (/\bnext weekend\b/.test(t)) return 6;
  return null;
}

function ambiguousTime(hour: number, minute: number): AmbiguousBareTime | null {
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 1 || hour > 12 || minute < 0 || minute >= 60) return null;
  const label = minute === 0 ? String(hour) : `${hour}:${String(minute).padStart(2, '0')}`;
  return { hour, minute, label };
}

function hhmmFromPeriod(time: AmbiguousBareTime, period: 'am' | 'pm'): string {
  let hour = time.hour;
  if (period === 'pm' && hour < 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

function ambiguousTimePrompt(time: AmbiguousBareTime): string {
  return `Did you mean ${time.label} AM or ${time.label} PM?`;
}

function detectAmbiguousBareTime(
  raw: string,
  opts: { allowBareTime?: boolean } = {},
): AmbiguousBareTime | null {
  const t = normalizeTimeText(raw);
  if (!t) return null;

  if (/\b(am|pm|a m|p m)\b/.test(t)) return null;

  const colon = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (colon) {
    return ambiguousTime(parseInt(colon[1], 10), parseInt(colon[2], 10));
  }

  const word =
    t.match(
      /\b(?:at|around|about|after|before|by|maybe|like|how about|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+(twelve|one|two|three|four|five|six|seven|eight|nine|ten|eleven)\s*(thirty|fifteen|forty five)?\b(?!\s+(?:people|guests|guest|of us|adults|kids|children))/,
    ) ??
    (opts.allowBareTime
      ? t.match(/^(twelve|one|two|three|four|five|six|seven|eight|nine|ten|eleven)\s*(thirty|fifteen|forty five)?$/)
      : null);
  if (word) {
    const hour = TIME_WORDS[word[1]];
    if (hour != null) {
      const modifier = word[2];
      const minute = modifier === 'thirty' ? 30 : modifier === 'fifteen' ? 15 : modifier === 'forty five' ? 45 : 0;
      return ambiguousTime(hour, minute);
    }
  }

  const contextualBare = t.match(
    /\b(?:at|around|about|for|after|before|by|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+(\d{1,2})(?:\s*ish)?\b(?!\s*(?:people|guests|of us))/,
  );
  if (contextualBare) {
    return ambiguousTime(parseInt(contextualBare[1], 10), 0);
  }

  if (opts.allowBareTime) {
    const bare = t.match(/^(\d{1,2})(?:\s*ish)?$/);
    if (bare) return ambiguousTime(parseInt(bare[1], 10), 0);
  }

  return null;
}

function resolvePendingTimeClarification(raw: string, lastAssistantPrompt?: string | null): string | null {
  if (!lastAssistantPrompt) return null;
  const promptMatch = lastAssistantPrompt.match(/did you mean\s+(\d{1,2})(?::(\d{2}))?\s+am\s+or\s+\d{1,2}(?::\d{2})?\s+pm/i);
  if (!promptMatch) return null;
  const pending = ambiguousTime(
    parseInt(promptMatch[1], 10),
    promptMatch[2] ? parseInt(promptMatch[2], 10) : 0,
  );
  if (!pending) return null;

  const t = normalizeTimeText(raw);
  if (/\b(am|a m|morning|breakfast)\b/.test(t)) return hhmmFromPeriod(pending, 'am');
  if (/\b(pm|p m|afternoon|evening|night|tonight|dinner)\b/.test(t)) return hhmmFromPeriod(pending, 'pm');
  return null;
}

function isPartySizeReplyPrompt(lastAssistantPrompt?: string | null): boolean {
  if (!lastAssistantPrompt) return false;
  return /\b(how many guests|how many people|party size|guest count|smaller party size|smaller group|how many seats)\b/i
    .test(lastAssistantPrompt);
}

function hasExplicitPartySizeCue(raw: string): boolean {
  const t = normalize(raw);
  return /\b(?:party of|table for|group of|we are|we're|make it|book for|reservation for)\s+(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|couple|pair)\b/.test(t) ||
    /\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:people|guests|guest|adults|pax|persons?|of us)\b/.test(t) ||
    /\b(just me|solo|alone|by myself|me plus one|double date)\b/.test(t);
}

export function parseLocalTime(raw: string, opts: { allowBareTime?: boolean } = {}): string | null {
  const t = normalizeTimeText(raw);

  const ampm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m)\b/);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const min = ampm[2] ? parseInt(ampm[2], 10) : 0;
    const period = ampm[3].replace(/\s/g, '');
    if (period === 'pm' && h < 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && min >= 0 && min < 60) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }

  const colon = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (colon) {
    const h = parseInt(colon[1], 10);
    const min = parseInt(colon[2], 10);
    if (h >= 0 && h <= 23 && min >= 0 && min < 60 && !ambiguousTime(h, min)) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }

  const word =
    t.match(
      /\b(?:at|around|about|after|before|by|maybe|like|how about)\s+(midnight|noon|twelve|one|two|three|four|five|six|seven|eight|nine|ten|eleven)\s*(thirty|fifteen|forty five|am|pm)?\s*(am|pm)?\b(?!\s+(?:people|guests|guest|of us|adults|kids|children))/,
    ) ??
    (opts.allowBareTime
      ? t.match(
        /^(midnight|noon|twelve|one|two|three|four|five|six|seven|eight|nine|ten|eleven)\s*(thirty|fifteen|forty five|am|pm)?\s*(am|pm)?$/,
      )
      : null);
  if (word) {
    const base = TIME_WORDS[word[1]];
    if (base != null) {
      let h = base;
      let min = 0;
      const modifier = word[2];
      let period = word[3] ?? null;
      if (modifier === 'thirty') min = 30;
      else if (modifier === 'fifteen') min = 15;
      else if (modifier === 'forty five') min = 45;
      else if (modifier === 'am' || modifier === 'pm') period = modifier;
      if (period === 'pm' && h < 12) h += 12;
      if (period === 'am' && h === 12) h = 0;
      if (!period && (word[1] === 'noon' || word[1] === 'midnight')) {
        return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      }
      if (!period) return null;
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }

  const contextualBare = t.match(
    /\b(?:at|around|about|for|after|before|by|tonight|tomorrow|friday|saturday|sunday|monday|tuesday|wednesday|thursday)\s+(\d{1,2})(?:\s*ish)?\b(?!\s*(?:people|guests|of us))/,
  );
  if (contextualBare) {
    const h = parseInt(contextualBare[1], 10);
    if (ambiguousTime(h, 0)) return null;
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:00`;
  }

  if (opts.allowBareTime) {
    const bare = t.match(/^(\d{1,2})(?:\s*ish)?$/);
    if (bare) {
      const h = parseInt(bare[1], 10);
      if (ambiguousTime(h, 0)) return null;
      if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:00`;
    }
  }

  return null;
}

function parseSpecialRequest(raw: string): string | null {
  const t = normalize(raw);
  const requests: string[] = [];
  if (/\boutdoor|patio\b/.test(t)) requests.push('outdoor seating if available');
  if (/\bindoor|inside\b/.test(t)) requests.push('indoor seating');
  if (/\bbooth\b/.test(t)) requests.push('booth if available');
  if (/\bquiet|private|calm\b/.test(t)) requests.push('quieter seating if available');
  if (/\bhigh chair\b/.test(t)) requests.push('high chair if available');
  if (/\bwindow\b/.test(t)) requests.push('window table if available');
  return requests.length ? requests.join(', ') : null;
}

function isAffirmative(raw: string): boolean {
  const t = normalize(raw);
  return /^(yes|yeah|yep|yup|sure|ok|okay|alright|sounds good|go ahead|book it|confirm|confirmed|do it|lock it in|please do)$/.test(t) ||
    /\b(yes|confirm|book it|go ahead|lock it in|make the reservation)\b/.test(t);
}

function wantsBackendDiscovery(raw: string, hasRestaurant: boolean): boolean {
  const t = normalize(raw);
  if (!DISCOVERY_PATTERN.test(t)) return false;
  if (!hasRestaurant) return true;
  return /\b(different|switch|instead|closer|cheaper|fancier|another|new restaurant|new place)\b/.test(t);
}

function shouldUseBackendProcess(raw: string): boolean {
  return PREORDER_PAYMENT_OR_POLICY_PATTERN.test(raw);
}

function isRestaurantHoursQuestion(raw: string): boolean {
  const t = normalize(raw);
  return /\b(hours?|store hours|business hours|open|opens|opened|closed|close|closes|closing)\b/.test(t) &&
    /\b(when|what|what time|how late|are they|is it|is the restaurant|open|closed|hours?|closes?|closing)\b/.test(t);
}

function hasNamedBookingRequest(raw: string): boolean {
  const t = normalize(raw);
  return /\b(book|reserve)\s+(?!it\b|anything\b|a table\b|table\b|me\b|somewhere\b|something\b|the usual\b)(?:[a-z0-9']{3,}|[a-z0-9']{1,2}\s+[a-z0-9']{3,})/.test(t);
}

function isVagueBookingStart(raw: string): boolean {
  const t = normalize(raw);
  return /^(dinner|lunch|breakfast|brunch|table|reservation|book it|just book it|i need food|food|tonight maybe|for us|whatever works|make it good)$/.test(t) ||
    /\b(just get me a table|book anything available|fastest option|skip the questions)\b/.test(t);
}

function choosePendingOption(
  raw: string,
  pendingOptions: CenaivaAvailabilityOption[] | undefined,
): CenaivaAvailabilityOption | null {
  if (!pendingOptions?.length) return null;
  const t = normalize(raw);
  const ordinal =
    /\b(second|2|two)\b/.test(t) ? 1 :
      /\b(first|1|one)\b/.test(t) ? 0 :
        /\b(third|3|three)\b/.test(t) ? 2 :
          null;
  if (ordinal != null && pendingOptions[ordinal]) return pendingOptions[ordinal];

  const parsedDate = parseLocalDate(raw);
  const parsedTime = parseLocalTime(raw, { allowBareTime: true });
  if (!parsedDate && !parsedTime) return null;
  return pendingOptions.find((option) => {
    const sameDate = !parsedDate || option.date === parsedDate;
    const sameTime = !parsedTime || displayTimeToHHMM(option.display_time) === parsedTime;
    return sameDate && sameTime;
  }) ?? null;
}

function displayTimeToHHMM(display: string): string | null {
  const m = display.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const period = m[3].toUpperCase();
  if (period === 'PM' && h < 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function makeResponse(opts: {
  conversationId: string | null;
  spokenText: string;
  intent: AssistantResponseType['intent'];
  step: AssistantResponseType['step'];
  nextExpectedInput: AssistantResponseType['next_expected_input'];
  uiActions?: UIActionType[];
  booking?: AssistantResponseType['booking'];
}): AssistantResponseType {
  return {
    conversation_id: opts.conversationId ?? '',
    spoken_text: opts.spokenText,
    intent: opts.intent,
    step: opts.step,
    next_expected_input: opts.nextExpectedInput,
    ui_actions: opts.uiActions ?? [],
    booking: opts.booking ?? null,
    map: null,
    filters: null,
    assistant_memory: null,
  };
}

function questionForMissing(booking: BookingState): {
  text: string;
  intent: AssistantResponseType['intent'];
  step: AssistantResponseType['step'];
  next: AssistantResponseType['next_expected_input'];
} {
  if (!booking.restaurant_id) {
    return {
      text: 'What restaurant or area should I book?',
      intent: 'select_restaurant',
      step: 'choose_restaurant',
      next: 'restaurant',
    };
  }
  if (booking.party_size == null) {
    return {
      text: 'How many guests?',
      intent: 'choose_party_size',
      step: 'choose_party',
      next: 'party_size',
    };
  }
  if (!booking.date && !booking.time) {
    return {
      text: 'What date and time should I book?',
      intent: 'choose_date',
      step: 'choose_date',
      next: 'date',
    };
  }
  if (!booking.date) {
    return {
      text: 'What date should I book?',
      intent: 'choose_date',
      step: 'choose_date',
      next: 'date',
    };
  }
  return {
    text: 'What time should I book?',
    intent: 'choose_time',
    step: 'choose_time',
    next: 'time',
  };
}

function buildSetFieldActions(patch: Partial<BookingState>): UIActionType[] {
  const actions: UIActionType[] = [];
  if (patch.party_size != null) {
    actions.push({ type: 'set_booking_field', field: 'party_size', value: patch.party_size });
  }
  if (patch.date) actions.push({ type: 'set_booking_field', field: 'date', value: patch.date });
  if (patch.time) actions.push({ type: 'set_booking_field', field: 'time', value: patch.time });
  if (patch.special_request) {
    actions.push({ type: 'set_booking_field', field: 'special_request', value: patch.special_request });
  }
  return actions;
}

function withPatch(booking: BookingState, patch: Partial<BookingState>): BookingState {
  return { ...booking, ...patch };
}

function buildAvailabilityIntent(
  raw: string,
  date: string | null,
  time: string | null,
  timezone: string,
): Pick<CenaivaAvailabilityRequest, 'mode' | 'date' | 'time' | 'weekday' | 'split_at'> | null {
  const t = normalize(raw);
  const weekday = parseLocalWeekday(raw);
  const wantsAnyDay = /\b(any day|any date|whenever|whatever day|whichever day|any night)\b/.test(t);
  const wantsAnyTime = /\b(any time|anytime|whatever time|whenever|earliest available|latest available)\b/.test(t);
  const wantsFirstAvailable = /\b(as soon as possible|earliest available|fastest option|first available)\b/.test(t);

  if (wantsAnyDay && time) {
    return { mode: 'any_day_at_time', date: null, time, weekday: null, split_at: '14:30' };
  }
  if (weekday != null && wantsAnyTime) {
    return { mode: 'weekday_any_time', date: null, time: null, weekday, split_at: '14:30' };
  }
  if (date && wantsAnyTime) {
    return { mode: 'date_any_time', date, time: null, weekday: null, split_at: '14:30' };
  }
  if (wantsFirstAvailable) {
    return { mode: 'first_available', date: null, time: null, weekday: null, split_at: '14:30' };
  }
  if (date && time) {
    return { mode: 'exact', date, time, weekday: null, split_at: '14:30' };
  }
  if (!date && weekday != null && wantsAnyTime) {
    return { mode: 'weekday_any_time', date: null, time: null, weekday, split_at: '14:30' };
  }
  if (!date && /\bnext weekend\b/.test(t) && wantsAnyTime) {
    return { mode: 'weekday_any_time', date: null, time: null, weekday: 6, split_at: '14:30' };
  }

  // Keep timezone in the signature so call sites are explicit about relative dates.
  void timezone;
  return null;
}

function buildSelectionResponse(
  option: CenaivaAvailabilityOption,
  ctx: LocalBookingContext,
): AssistantResponseType {
  const restaurantId = ctx.booking.restaurant_id ?? ctx.selectedRestaurantId ?? null;
  const restaurantName = ctx.booking.restaurant_name ?? ctx.selectedRestaurantName ?? null;
  const hoursSentence = formatHoursSentence(option.hours_window, option.date);
  const spokenText = `Great, ${formatDateForSpeech(option.date)} at ${option.display_time} is available.${hoursSentence ? ` ${hoursSentence}` : ''} Should I book it?`;
  return makeResponse({
    conversationId: ctx.conversationId,
    spokenText,
    intent: 'confirm_booking',
    step: 'confirm',
    nextExpectedInput: 'confirmation',
    uiActions: [
      { type: 'set_booking_field', field: 'date', value: option.date },
      { type: 'set_booking_field', field: 'time', value: option.display_time },
      { type: 'select_time_slot', slot_iso: option.date_time, shift_id: option.shift_id },
      { type: 'confirm_booking' },
    ],
    booking: {
      restaurant_id: restaurantId,
      restaurant_name: restaurantName,
      date: option.date,
      time: option.display_time,
      slot_iso: option.date_time,
      shift_id: option.shift_id,
      status: 'confirming',
    },
  });
}

export function planLocalBookingTurn(ctx: LocalBookingContext): LocalBookingDecision {
  const transcript = ctx.transcript.trim();
  if (!transcript) return { kind: 'pass' };
  const booking = ctx.booking;
  const restaurantId = booking.restaurant_id ?? ctx.selectedRestaurantId ?? null;
  const restaurantName = booking.restaurant_name ?? ctx.selectedRestaurantName ?? null;
  const hasRestaurant = Boolean(restaurantId);
  const timezone = ctx.timezone || 'America/Toronto';

  if (BACKEND_STATUSES.has(booking.status)) return { kind: 'pass' };
  if (booking.status === 'confirming' && isAffirmative(transcript)) return { kind: 'pass' };

  const pendingChoice = choosePendingOption(transcript, ctx.pendingOptions);
  if (pendingChoice) {
    return {
      kind: 'local_response',
      response: buildSelectionResponse(pendingChoice, ctx),
      clearPendingOptions: true,
    };
  }

  const patch: Partial<BookingState> = {};
  if (restaurantId) patch.restaurant_id = restaurantId;
  if (restaurantName) patch.restaurant_name = restaurantName;

  const parsedPartySize = parseLocalPartySize(transcript);
  const acceptingPartySizeReply =
    booking.party_size == null ||
    isPartySizeReplyPrompt(ctx.lastAssistantPrompt) ||
    hasExplicitPartySizeCue(transcript);
  const partySize = acceptingPartySizeReply ? parsedPartySize : null;
  if (partySize != null) patch.party_size = partySize;

  const nextPartySize = patch.party_size ?? booking.party_size;
  const parsedDate = parseLocalDate(transcript, timezone);
  const expectingPartySizeReply = partySize != null || isPartySizeReplyPrompt(ctx.lastAssistantPrompt);
  const explicitParsedTime = parseLocalTime(transcript, {
    allowBareTime: booking.party_size != null && !expectingPartySizeReply,
  });
  const parsedTime = explicitParsedTime ?? resolvePendingTimeClarification(transcript, ctx.lastAssistantPrompt);
  const ambiguousBareTime = parsedTime
    ? null
    : detectAmbiguousBareTime(transcript, { allowBareTime: booking.party_size != null && !expectingPartySizeReply });
  if (parsedDate) patch.date = parsedDate;
  if (parsedTime) patch.time = parsedTime;

  const specialRequest = parseSpecialRequest(transcript);
  if (specialRequest) patch.special_request = specialRequest;

  const hasAmbiguousTimeDetail =
    ambiguousBareTime != null &&
    (hasRestaurant || booking.status !== 'idle');
  const hasLocalBookingDetail =
    partySize != null ||
    parsedDate != null ||
    parsedTime != null ||
    specialRequest != null ||
    hasAmbiguousTimeDetail;

  if (!isCenaivaProcessPrompt(transcript) && !hasLocalBookingDetail) return { kind: 'pass' };
  const wantsHours = isRestaurantHoursQuestion(transcript);
  const explicitlyAsksAvailability = /\b(available|availability|openings?)\b/i.test(transcript);
  if (wantsHours && restaurantId && !parsedTime && !explicitlyAsksAvailability) {
    const hoursDate = parsedDate ?? booking.date ?? formatISODateInTimeZone(new Date(), timezone);
    const responseBeforeCheck = makeResponse({
      conversationId: ctx.conversationId,
      spokenText: 'One moment please.',
      intent: 'choose_time',
      step: 'choose_time',
      nextExpectedInput: 'none',
      uiActions: buildSetFieldActions({ ...patch, date: hoursDate }),
      booking: {
        ...patch,
        date: hoursDate,
        status: 'loading_availability',
      },
    });

    return {
      kind: 'check_availability',
      filler: responseBeforeCheck.spoken_text,
      responseBeforeCheck,
      request: {
        restaurant_id: restaurantId,
        restaurant_name: restaurantName,
        party_size: nextPartySize ?? 1,
        mode: 'date_any_time',
        purpose: 'hours',
        date: hoursDate,
        time: null,
        weekday: null,
        timezone,
        search_days: 1,
        nearest_count: 2,
        split_at: '14:30',
      },
    };
  }
  if (shouldUseBackendProcess(transcript)) return { kind: 'pass' };
  if (!hasRestaurant && hasNamedBookingRequest(transcript)) return { kind: 'pass' };
  if (wantsBackendDiscovery(transcript, hasRestaurant)) return { kind: 'pass' };

  const nextBooking = withPatch(booking, patch);

  if (ambiguousBareTime && hasAmbiguousTimeDetail) {
    return {
      kind: 'local_response',
      clearPendingOptions: true,
      response: makeResponse({
        conversationId: ctx.conversationId,
        spokenText: ambiguousTimePrompt(ambiguousBareTime),
        intent: 'choose_time',
        step: 'choose_time',
        nextExpectedInput: 'time',
        uiActions: buildSetFieldActions(patch),
        booking: {
          ...patch,
          status: 'collecting_minimum_fields',
        },
      }),
    };
  }

  const availabilityIntent = buildAvailabilityIntent(
    transcript,
    nextBooking.date,
    nextBooking.time,
    timezone,
  );

  const hasCollectedAnything =
    Object.keys(patch).some((key) => !['restaurant_id', 'restaurant_name'].includes(key)) ||
    isVagueBookingStart(transcript);

  if (!hasCollectedAnything && !availabilityIntent) return { kind: 'pass' };

  if (!restaurantId || nextPartySize == null || (!availabilityIntent && (!nextBooking.date || !nextBooking.time))) {
    const missing = questionForMissing(nextBooking);
    return {
      kind: 'local_response',
      clearPendingOptions: true,
      response: makeResponse({
        conversationId: ctx.conversationId,
        spokenText: missing.text,
        intent: missing.intent,
        step: missing.step,
        nextExpectedInput: missing.next,
        uiActions: buildSetFieldActions(patch),
        booking: {
          ...patch,
          status: 'collecting_minimum_fields',
        },
      }),
    };
  }

  const intent = availabilityIntent ?? {
    mode: 'exact' as const,
    date: nextBooking.date,
    time: nextBooking.time,
    weekday: null,
    split_at: '14:30',
  };

  const responseBeforeCheck = makeResponse({
    conversationId: ctx.conversationId,
    spokenText: 'One moment please.',
    intent: 'choose_time',
    step: 'choose_time',
    nextExpectedInput: 'none',
    uiActions: buildSetFieldActions(patch),
    booking: {
      ...patch,
      status: 'loading_availability',
    },
  });

  return {
    kind: 'check_availability',
    filler: responseBeforeCheck.spoken_text,
    responseBeforeCheck,
    request: {
      restaurant_id: restaurantId,
      restaurant_name: restaurantName,
      party_size: nextPartySize,
      mode: intent.mode,
      date: intent.date ?? null,
      time: intent.time ?? null,
      weekday: intent.weekday ?? null,
      timezone,
      search_days: 21,
      nearest_count: 2,
      split_at: intent.split_at ?? '14:30',
    },
  };
}

function formatOption(option: CenaivaAvailabilityOption): string {
  return `${formatDateForSpeech(option.date)} at ${option.display_time}`;
}

function formatOptionList(options: CenaivaAvailabilityOption[]): string {
  const labels = options.slice(0, 2).map(formatOption);
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels[0]} or ${labels[1]}`;
}

function isFullCapacityResult(result: CenaivaAvailabilityResponse): boolean {
  return result.unavailable_reason === 'fully_booked' ||
    /\b(fully booked|full capacity|at capacity)\b/i.test(result.message ?? '');
}

function isPartySizeOutOfRangeResult(result: CenaivaAvailabilityResponse): boolean {
  return result.unavailable_reason === 'party_size_out_of_range' ||
    /\b(party size|guests?|people)\b[\s\S]{0,60}\b(outside|exceeds|too large|capacity|range)\b/i.test(result.message ?? '');
}

function isInsufficientCapacityResult(result: CenaivaAvailabilityResponse): boolean {
  return result.unavailable_reason === 'insufficient_capacity' ||
    /\b(not enough seats|insufficient capacity|not enough capacity)\b/i.test(result.message ?? '');
}

function fullCapacityText(dateStr: string | null | undefined): string {
  return dateStr
    ? `${formatDateForSpeech(dateStr)} is fully booked.`
    : 'The restaurant is fully booked.';
}

function partySizeOutOfRangeText(restaurantName: string | null | undefined, partySize: number): string {
  const restaurant = restaurantName || 'this restaurant';
  return `${restaurant} cannot book ${partySize} guests. What smaller party size should I check?`;
}

function insufficientCapacityText(
  restaurantName: string | null | undefined,
  partySize: number,
  time: string | null | undefined,
): string {
  const restaurant = restaurantName || 'The restaurant';
  const displayTime = time ? ` at ${formatHHMMForSpeech(time)}` : '';
  return `${restaurant} does not have enough seats available${displayTime} for ${partySize} guests.`;
}

function formatHoursSentence(hoursWindow: string | null | undefined, dateStr: string | null | undefined): string {
  const displayHours = formatHoursWindowForSpeech(hoursWindow);
  if (!displayHours) return '';
  return `They're open ${displayHours}${dateStr ? ` on ${formatDateForSpeech(dateStr)}` : ''}.`;
}

function formatHoursWindowForSpeech(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.split(/\s+(?:to|-)\s+/i);
  if (parts.length !== 2) return value;
  const formatted = parts.map(formatClockForSpeech);
  return formatted[0] && formatted[1] ? `${formatted[0]} to ${formatted[1]}` : value;
}

function formatClockForSpeech(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const period = match[3]?.toUpperCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  if (period) {
    if (hour < 1 || hour > 12) return null;
    if (period === 'PM' && hour < 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    return null;
  }
  const displayPeriod = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${displayPeriod}`;
}

function bestHoursInfo(
  result: CenaivaAvailabilityResponse,
  selected: CenaivaAvailabilityOption | null,
  alternatives: CenaivaAvailabilityOption[],
  requestedDate?: string | null,
): { window: string; date: string | null } | null {
  if (selected?.hours_window) return { window: selected.hours_window, date: selected.date };
  if (result.hours_window) return { window: result.hours_window, date: requestedDate ?? null };
  const option = alternatives.find((item) => item.hours_window);
  return option?.hours_window ? { window: option.hours_window, date: option.date } : null;
}

function formatHoursAvailabilityResponse(args: {
  conversationId: string | null;
  request: CenaivaAvailabilityRequest;
  result: CenaivaAvailabilityResponse;
  selected: CenaivaAvailabilityOption | null;
  alternatives: CenaivaAvailabilityOption[];
}): AssistantResponseType {
  const { conversationId, request, result, selected, alternatives } = args;
  const date = request.date ?? selected?.date ?? alternatives[0]?.date ?? null;
  const restaurant = request.restaurant_name || 'The restaurant';
  const hours = bestHoursInfo(result, selected, alternatives, date);
  const optionText = alternatives.length
    ? `I see availability around ${formatOptionList(alternatives)}.`
    : selected
      ? `I see ${selected.display_time} available.`
        : result.message
          ? result.message
          : 'I do not see bookable times for that date.';
  const displayHours = formatHoursWindowForSpeech(hours?.window);
  const spokenText = displayHours
    ? `${restaurant} is open ${displayHours}${hours?.date ? ` on ${formatDateForSpeech(hours.date)}` : ''}. ${optionText}`
    : `${restaurant} appears closed${date ? ` on ${formatDateForSpeech(date)}` : ''}. ${optionText}`;

  return makeResponse({
    conversationId,
    spokenText,
    intent: 'choose_time',
    step: 'choose_time',
    nextExpectedInput: 'time',
    uiActions: [{ type: 'load_availability' }],
    booking: {
      restaurant_id: request.restaurant_id,
      restaurant_name: request.restaurant_name ?? null,
      date: request.date ?? null,
      status: 'collecting_minimum_fields',
    },
  });
}

function formatDateForSpeech(dateStr: string): string {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  const localNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
  }).format(localNoon);
}

export function buildLocalAvailabilityResponse(args: {
  conversationId: string | null;
  request: CenaivaAvailabilityRequest;
  result: CenaivaAvailabilityResponse;
}): { response: AssistantResponseType; pendingOptions: CenaivaAvailabilityOption[] } {
  const { conversationId, request, result } = args;
  const selected = result.selected_slot ?? null;
  const alternatives = result.alternatives ?? [];
  if (request.purpose === 'hours') {
    return {
      pendingOptions: [],
      response: formatHoursAvailabilityResponse({
        conversationId,
        request,
        result,
        selected,
        alternatives,
      }),
    };
  }

  if (result.status === 'available' && selected) {
    const ctx: LocalBookingContext = {
      transcript: '',
      booking: {
        restaurant_id: request.restaurant_id,
        restaurant_name: request.restaurant_name ?? null,
        party_size: request.party_size,
        date: selected.date,
        time: selected.display_time,
        shift_id: selected.shift_id,
        slot_iso: selected.date_time,
        special_request: null,
        occasion: null,
        status: 'loading_availability',
        confirmation_code: null,
        reservation_id: null,
        want_preorder: null,
        order_id: null,
        payment_status: 'idle',
        tip_choice: null,
        tip_amount: null,
        tip_percent: null,
        payment_split: null,
        pending_action: null,
        cart_subtotal: 0,
        cart: [],
        has_saved_card: false,
      },
      conversationId,
    };
    return { response: buildSelectionResponse(selected, ctx), pendingOptions: [] };
  }

  if (alternatives.length) {
    const requestedTime = request.time ? formatHHMMForSpeech(request.time) : null;
    const unavailablePrefix =
      isFullCapacityResult(result)
        ? `${fullCapacityText(request.date ?? alternatives[0]?.date)} `
        : isInsufficientCapacityResult(result)
        ? `${insufficientCapacityText(request.restaurant_name, request.party_size, request.time)} `
        : isPartySizeOutOfRangeResult(result)
        ? `${partySizeOutOfRangeText(request.restaurant_name, request.party_size)} `
        : request.mode === 'exact' && request.date && requestedTime
        ? `${formatDateForSpeech(request.date)} at ${requestedTime} is not available. `
        : '';
    const hours = bestHoursInfo(result, selected, alternatives, request.date);
    const hoursSentence = formatHoursSentence(hours?.window, hours?.date);
    return {
      pendingOptions: alternatives,
      response: makeResponse({
        conversationId,
        spokenText: `${unavailablePrefix}${hoursSentence ? `${hoursSentence} ` : ''}I found ${formatOptionList(alternatives)}. Which should I use?`,
        intent: 'choose_time',
        step: 'choose_time',
        nextExpectedInput: 'time',
        uiActions: [{ type: 'load_availability' }],
        booking: {
          restaurant_id: request.restaurant_id,
          restaurant_name: request.restaurant_name ?? null,
          party_size: request.party_size,
          date: request.date ?? null,
          time: request.time ?? null,
          status: 'awaiting_time_selection',
        },
      }),
    };
  }

  return {
    pendingOptions: [],
    response: makeResponse({
      conversationId,
      spokenText: (() => {
        const hours = bestHoursInfo(result, selected, alternatives, request.date);
        const hoursSentence = formatHoursSentence(hours?.window, hours?.date);
        const fallback = isFullCapacityResult(result)
          ? fullCapacityText(request.date)
          : isInsufficientCapacityResult(result)
          ? insufficientCapacityText(request.restaurant_name, request.party_size, request.time)
          : isPartySizeOutOfRangeResult(result)
          ? partySizeOutOfRangeText(request.restaurant_name, request.party_size)
          : result.message || 'I could not find availability for that.';
        if (isPartySizeOutOfRangeResult(result)) {
          return `${hoursSentence ? `${hoursSentence} ` : ''}${fallback}`;
        }
        return `${hoursSentence ? `${hoursSentence} ` : ''}${fallback} What date and time should I try instead?`;
      })(),
      intent: isPartySizeOutOfRangeResult(result) ? 'choose_party_size' : 'choose_time',
      step: isPartySizeOutOfRangeResult(result) ? 'choose_party' : 'choose_time',
      nextExpectedInput: isPartySizeOutOfRangeResult(result) ? 'party_size' : 'time',
      booking: {
        restaurant_id: request.restaurant_id,
        restaurant_name: request.restaurant_name ?? null,
        party_size: request.party_size,
        status: 'collecting_minimum_fields',
      },
    }),
  };
}

function formatHHMMForSpeech(time: string): string {
  const [hourRaw, minuteRaw] = time.split(':');
  const hour = parseInt(hourRaw, 10);
  const minute = parseInt(minuteRaw ?? '0', 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;
  const date = new Date(Date.UTC(2026, 0, 1, hour, minute));
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  }).format(date);
}
```

---

## File 4 — `__tests__/cenaiva/recommendationIntent.test.ts`

**Adaptation:** none. Vitest accepts `describe/it/expect` unchanged.

```ts
import type { AssistantResponseType } from '@cenaiva/assistant';
import {
  applyClientDiscoveryMemory,
  capSingleRecommendationSpokenText,
  getCenaivaRecommendationMode,
  isSingleRestaurantRecommendationIntent,
  normalizeSingleRestaurantRecommendationResponse,
} from '@/lib/cenaiva/recommendationIntent';

function response(patch: Partial<AssistantResponseType>): AssistantResponseType {
  return {
    conversation_id: 'conv-1',
    spoken_text: 'I would try La Piazza because it is closest to you.',
    intent: 'discover_restaurants' as AssistantResponseType['intent'],
    step: 'recommend_options' as AssistantResponseType['step'],
    next_expected_input: 'none' as AssistantResponseType['next_expected_input'],
    ui_actions: [],
    booking: null,
    map: null,
    filters: null,
    ...patch,
  };
}

describe('recommendation intent', () => {
  it('detects one-restaurant recommendation requests', () => {
    expect(getCenaivaRecommendationMode("what's the closest restaurant to me")).toBe('single');
    expect(getCenaivaRecommendationMode('I want the nearest spot')).toBe('single');
    expect(getCenaivaRecommendationMode('pick one place for dinner')).toBe('single');
    expect(isSingleRestaurantRecommendationIntent('where should I eat?')).toBe(true);
  });

  it('does not convert booking or plural discovery prompts to single recommendations', () => {
    expect(getCenaivaRecommendationMode('book the closest restaurant for two')).toBeNull();
    expect(getCenaivaRecommendationMode('show me restaurants near me')).toBe('list');
    expect(getCenaivaRecommendationMode('what other restaurants are there')).toBe('list');
    expect(isSingleRestaurantRecommendationIntent('show me the closest restaurants')).toBe(false);
  });

  it('caps restaurant cards, map markers, and list-style speech to one result', () => {
    const normalized = normalizeSingleRestaurantRecommendationResponse(
      response({
        spoken_text: 'Pai Northern Thai Kitchen, Minami Vancouver, or Le Fantôme look good. Which one sounds best?',
        ui_actions: [
          { type: 'show_map' },
          { type: 'show_restaurant_cards', restaurant_ids: ['r1', 'r2', 'r3'] },
          { type: 'update_map_markers', restaurant_ids: ['r1', 'r2', 'r3'] },
          { type: 'start_booking', restaurant_id: 'r1' },
        ],
        booking: { restaurant_id: 'r1', status: 'collecting_minimum_fields' },
        map: {
          visible: true,
          marker_restaurant_ids: ['r1', 'r2', 'r3'],
          highlighted_restaurant_id: null,
        },
      }),
      "what's the closest restaurant to me",
    );

    expect(normalized.spoken_text).toBe("I'd go with Pai Northern Thai Kitchen.");
    expect(normalized.booking).toBeNull();
    expect(normalized.map?.marker_restaurant_ids).toEqual(['r1']);
    expect(normalized.map?.highlighted_restaurant_id).toBe('r1');
    expect(normalized.ui_actions).toEqual([
      { type: 'show_map' },
      { type: 'show_restaurant_cards', restaurant_ids: ['r1'] },
      { type: 'update_map_markers', restaurant_ids: ['r1'] },
    ]);
  });

  it('leaves already single spoken recommendations alone', () => {
    expect(capSingleRecommendationSpokenText('I would try La Piazza because it is closest to you.')).toBe(
      'I would try La Piazza because it is closest to you.',
    );
  });

  it('keeps the full ranked list behind a capped single recommendation', () => {
    const raw = response({
      map: {
        visible: true,
        marker_restaurant_ids: ['r1', 'r2', 'r3'],
        highlighted_restaurant_id: null,
      },
    });
    const normalized = normalizeSingleRestaurantRecommendationResponse(
      raw,
      "what's the closest restaurant to me",
    );
    const next = applyClientDiscoveryMemory(normalized, "what's the closest restaurant to me", {
      rawResponse: raw,
      recommendationMode: 'single',
    });

    expect(next.map?.marker_restaurant_ids).toEqual(['r1']);
    expect(next.assistant_memory?.discovery).toMatchObject({
      recommendation_mode: 'single',
      sort_by: 'distance',
      full_restaurant_ids: ['r1', 'r2', 'r3'],
      displayed_restaurant_ids: ['r1'],
      exhausted_restaurant_ids: ['r1'],
    });
  });

  it('uses discovery memory for other-restaurant follow-ups without repeating shown cards', () => {
    const next = applyClientDiscoveryMemory(
      response({
        map: {
          visible: true,
          marker_restaurant_ids: ['r1', 'r2', 'r3'],
          highlighted_restaurant_id: null,
        },
        ui_actions: [{ type: 'show_restaurant_cards', restaurant_ids: ['r1', 'r2', 'r3'] }],
      }),
      'what other restaurants are there',
      {
        recommendationMode: 'list',
        previousMemory: {
          booking_process: null,
          discovery: {
            transcript: "what's the closest restaurant to me",
            recommendation_mode: 'single',
            cuisine: null,
            cuisine_group: null,
            city: null,
            query: null,
            sort_by: 'distance',
            full_restaurant_ids: ['r1', 'old-fallback'],
            displayed_restaurant_ids: ['r1'],
            exhausted_restaurant_ids: ['r1'],
          },
        },
      },
    );

    expect(next.map?.marker_restaurant_ids).toEqual(['r2', 'r3']);
    expect(next.ui_actions).toEqual([{ type: 'show_restaurant_cards', restaurant_ids: ['r2', 'r3'] }]);
    expect(next.assistant_memory?.discovery?.displayed_restaurant_ids).toEqual(['r2', 'r3']);
    expect(next.assistant_memory?.discovery?.exhausted_restaurant_ids).toEqual(['r1', 'r2', 'r3']);
  });
});
```

---

## File 5 — `__tests__/cenaiva/filterRestaurants.test.ts`

**Adaptation:** swap line 2's `Restaurant` import. The inline `baseRestaurant` fixture has 24 fields shaped to mobile's `Restaurant` (mock catalog) — prune or rename fields to satisfy web's `Restaurant` shape. TypeScript will flag any field that doesn't compile.

```ts
import { filterCenaivaRestaurants } from '@/lib/cenaiva/filterRestaurants';
import type { Restaurant } from '@/lib/mock/restaurants';   // ← swap to web's Restaurant type

const baseRestaurant: Restaurant = {
  id: 'base',
  name: 'Base',
  slug: 'base',
  cuisineType: 'Modern Canadian',
  description: '',
  address: '',
  city: 'Toronto',
  province: 'ON',
  area: 'Downtown',
  lat: 0,
  lng: 0,
  phone: '',
  coverPhotoUrl: '',
  logoUrl: '',
  avgRating: 4.5,
  totalReviews: 0,
  priceRange: 2,
  distanceKm: 0,
  availability: 'Available Tonight',
  ambiance: '',
  tags: [],
  featuredIn: [],
  isActive: true,
  hoursJson: {},
  taxRate: 0.13,
  currency: 'CAD',
};

function restaurant(patch: Partial<Restaurant>): Restaurant {
  return { ...baseRestaurant, ...patch };
}

describe('filterCenaivaRestaurants', () => {
  const restaurants = [
    restaurant({ id: 'italian-1', name: 'La Piazza', cuisineType: 'Italian Fine Dining' }),
    restaurant({ id: 'thai-1', name: 'Pai', cuisineType: 'Thai', tags: ['spicy noodles'] }),
    restaurant({ id: 'french-1', name: 'La Maison', cuisineType: 'French Bistro', city: 'Montreal' }),
    restaurant({ id: 'greek-1', name: 'Agora', cuisineType: 'Greek Mediterranean' }),
  ];

  it('filters the assistant rail by cuisine even when marker ids are omitted', () => {
    const next = filterCenaivaRestaurants(restaurants, [], { cuisine: ['Italian'] });
    expect(next.map((item) => item.id)).toEqual(['italian-1']);
  });

  it('trusts assistant marker order instead of re-filtering named suggestions', () => {
    const next = filterCenaivaRestaurants(restaurants, ['italian-1', 'thai-1'], { cuisine: ['Thai'] });
    expect(next.map((item) => item.id)).toEqual(['italian-1', 'thai-1']);
  });

  it('preserves the assistant suggestion order when marker ids are present', () => {
    const next = filterCenaivaRestaurants(restaurants, ['french-1', 'italian-1'], {});
    expect(next.map((item) => item.id)).toEqual(['french-1', 'italian-1']);
  });

  it('filters by query and city for assistant discovery refinements', () => {
    const next = filterCenaivaRestaurants(restaurants, [], { city: 'montreal', query: 'bistro' });
    expect(next.map((item) => item.id)).toEqual(['french-1']);
  });

  it('expands European cuisine when there is no assistant marker set', () => {
    const next = filterCenaivaRestaurants(
      restaurants,
      [],
      { cuisine: ['European'] },
    );
    expect(next.map((item) => item.id)).toEqual(['italian-1', 'french-1', 'greek-1']);
  });
});
```

---

## File 6 — `__tests__/cenaiva/localBookingCollector.test.ts`

**Adaptation:** none. `BookingState` comes from the shared `@cenaiva/assistant` package; the inline `booking()` factory is the entire fixture surface and ports verbatim.

```ts
import {
  buildLocalAvailabilityResponse,
  parseLocalDate,
  parseLocalPartySize,
  parseLocalTime,
  planLocalBookingTurn,
  type CenaivaAvailabilityResponse,
} from '@/lib/cenaiva/localBookingCollector';
import type { BookingState } from '@cenaiva/assistant';

function booking(patch: Partial<BookingState> = {}): BookingState {
  return {
    restaurant_id: null,
    restaurant_name: null,
    party_size: null,
    date: null,
    time: null,
    shift_id: null,
    slot_iso: null,
    special_request: null,
    occasion: null,
    status: 'idle',
    confirmation_code: null,
    reservation_id: null,
    want_preorder: null,
    order_id: null,
    payment_status: 'idle',
    tip_choice: null,
    tip_amount: null,
    tip_percent: null,
    payment_split: null,
    pending_action: null,
    cart_subtotal: 0,
    cart: [],
    has_saved_card: false,
    ...patch,
  };
}

describe('local Hey Cenaiva booking collector', () => {
  it('parses party, date, and time without turning party size into a time', () => {
    expect(parseLocalPartySize('two people')).toBe(2);
    expect(parseLocalTime('two people', { allowBareTime: true })).toBeNull();
    expect(parseLocalTime('two', { allowBareTime: false })).toBeNull();
    expect(parseLocalTime('around 7')).toBeNull();
    expect(parseLocalTime('around 7-ish')).toBeNull();
    expect(parseLocalTime('around 7 pm')).toBe('19:00');
    expect(parseLocalDate('May 10', 'America/Toronto')).toMatch(/^\d{4}-05-10$/);
  });

  it('asks for AM or PM instead of assuming a bare spoken time', () => {
    const decision = planLocalBookingTurn({
      transcript: 'tomorrow at 7',
      booking: booking({
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        party_size: 2,
        status: 'collecting_minimum_fields',
      }),
      conversationId: null,
      timezone: 'America/Toronto',
    });

    expect(decision.kind).toBe('local_response');
    if (decision.kind !== 'local_response') return;
    expect(decision.response.spoken_text).toBe('Did you mean 7 AM or 7 PM?');
    expect(decision.response.booking?.date).toBeTruthy();
    expect(decision.response.booking?.time).toBeUndefined();

    const halfPast = planLocalBookingTurn({
      transcript: 'tomorrow at 7:30',
      booking: booking({
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        party_size: 2,
        status: 'collecting_minimum_fields',
      }),
      conversationId: null,
      timezone: 'America/Toronto',
    });

    expect(halfPast.kind).toBe('local_response');
    if (halfPast.kind !== 'local_response') return;
    expect(halfPast.response.spoken_text).toBe('Did you mean 7:30 AM or 7:30 PM?');
    expect(halfPast.response.booking?.time).toBeUndefined();
  });

  it('resolves a follow-up AM or PM answer after time clarification', () => {
    const decision = planLocalBookingTurn({
      transcript: 'PM',
      booking: booking({
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        party_size: 2,
        date: '2026-05-07',
        status: 'collecting_minimum_fields',
      }),
      conversationId: null,
      timezone: 'America/Toronto',
      lastAssistantPrompt: 'Did you mean 7 AM or 7 PM?',
    });

    expect(decision.kind).toBe('check_availability');
    if (decision.kind !== 'check_availability') return;
    expect(decision.request.time).toBe('19:00');
  });

  it('lets an explicit corrected time override the prior AM or PM clarification', () => {
    const decision = planLocalBookingTurn({
      transcript: 'actually 8 PM',
      booking: booking({
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        party_size: 2,
        date: '2026-05-07',
        status: 'collecting_minimum_fields',
      }),
      conversationId: null,
      timezone: 'America/Toronto',
      lastAssistantPrompt: 'Did you mean 7 AM or 7 PM?',
    });

    expect(decision.kind).toBe('check_availability');
    if (decision.kind !== 'check_availability') return;
    expect(decision.request.time).toBe('20:00');
  });

  it('passes named restaurant requests to the backend so restaurant matching is preserved', () => {
    const decision = planLocalBookingTurn({
      transcript: 'Book La Maison for two tomorrow at 7:30',
      booking: booking(),
      conversationId: null,
      timezone: 'America/Toronto',
    });

    expect(decision.kind).toBe('pass');
  });

  it('keeps off-topic prompts out of local booking collection', () => {
    const decision = planLocalBookingTurn({
      transcript: 'Am I gay?',
      booking: booking(),
      conversationId: null,
      timezone: 'America/Toronto',
    });

    expect(decision.kind).toBe('pass');
  });

  it('collects party size locally after a restaurant is selected', () => {
    const decision = planLocalBookingTurn({
      transcript: 'two',
      booking: booking({
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        status: 'collecting_minimum_fields',
      }),
      conversationId: null,
      timezone: 'America/Toronto',
    });

    expect(decision.kind).toBe('local_response');
    if (decision.kind !== 'local_response') return;
    expect(decision.response.booking?.party_size).toBe(2);
    expect(decision.response.booking?.time).toBeUndefined();
    expect(decision.response.spoken_text).toBe('What date and time should I book?');
  });

  it('treats large numeric guest replies as party size, not a small prompt', () => {
    expect(parseLocalPartySize('67')).toBe(67);
    expect(parseLocalPartySize('67 guests')).toBe(67);
    expect(parseLocalPartySize('party of 120')).toBe(120);

    const decision = planLocalBookingTurn({
      transcript: '67',
      booking: booking({
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        status: 'collecting_minimum_fields',
      }),
      conversationId: null,
      timezone: 'America/Toronto',
      lastAssistantPrompt: 'How many guests?',
    });

    expect(decision.kind).toBe('local_response');
    if (decision.kind !== 'local_response') return;
    expect(decision.response.booking?.party_size).toBe(67);
    expect(decision.response.spoken_text).toBe('What date and time should I book?');
  });

  it('checks availability after a large numeric guest reply when date and time are already known', () => {
    const decision = planLocalBookingTurn({
      transcript: '67',
      booking: booking({
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        date: '2026-01-26',
        time: '19:00',
        status: 'collecting_minimum_fields',
      }),
      conversationId: null,
      timezone: 'America/Toronto',
      lastAssistantPrompt: 'How many guests?',
    });

    expect(decision.kind).toBe('check_availability');
    if (decision.kind !== 'check_availability') return;
    expect(decision.request.party_size).toBe(67);
    expect(decision.request.mode).toBe('exact');
  });

  it('lets a smaller guest-count correction replace a too-large party size', () => {
    const decision = planLocalBookingTurn({
      transcript: '4',
      booking: booking({
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        party_size: 67,
        date: '2026-01-26',
        time: '19:00',
        status: 'collecting_minimum_fields',
      }),
      conversationId: null,
      timezone: 'America/Toronto',
      lastAssistantPrompt: 'Echoria cannot book 67 guests. What smaller party size should I check?',
    });

    expect(decision.kind).toBe('check_availability');
    if (decision.kind !== 'check_availability') return;
    expect(decision.request.party_size).toBe(4);
    expect(decision.request.date).toBe('2026-01-26');
    expect(decision.request.time).toBe('19:00');
    expect(decision.responseBeforeCheck.booking?.party_size).toBe(4);
  });

  it('checks availability only after restaurant, party size, date, and time are known', () => {
    const decision = planLocalBookingTurn({
      transcript: 'tomorrow at 7 pm',
      booking: booking({
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        party_size: 2,
        status: 'collecting_minimum_fields',
      }),
      conversationId: null,
      timezone: 'America/Toronto',
    });

    expect(decision.kind).toBe('check_availability');
    if (decision.kind !== 'check_availability') return;
    expect(decision.request.mode).toBe('exact');
    expect(decision.request.time).toBe('19:00');
    expect(decision.filler).toBe('One moment please.');
  });

  it('supports flexible availability wording', () => {
    const anyDay = planLocalBookingTurn({
      transcript: 'any day at 2 pm',
      booking: booking({
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        party_size: 2,
      }),
      conversationId: null,
      timezone: 'America/Toronto',
    });
    expect(anyDay.kind).toBe('check_availability');
    if (anyDay.kind === 'check_availability') {
      expect(anyDay.request.mode).toBe('any_day_at_time');
      expect(anyDay.request.time).toBe('14:00');
    }

    const friday = planLocalBookingTurn({
      transcript: 'any time Friday',
      booking: booking({
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        party_size: 2,
      }),
      conversationId: null,
      timezone: 'America/Toronto',
    });
    expect(friday.kind).toBe('check_availability');
    if (friday.kind === 'check_availability') {
      expect(friday.request.mode).toBe('weekday_any_time');
      expect(friday.request.split_at).toBe('14:30');
    }
  });

  it('turns available slots into mandatory confirmation, not a completed booking', () => {
    const result: CenaivaAvailabilityResponse = {
      status: 'available',
      selected_slot: {
        shift_id: 'shift-1',
        shift_name: 'Dinner',
        date: '2026-01-26',
        date_time: '2026-01-26T19:00:00.000Z',
        display_time: '2:00 PM',
        hours_window: '11:00 AM to 10:00 PM',
      },
      alternatives: [],
      hours_window: '11:00 AM to 10:00 PM',
    };

    const { response, pendingOptions } = buildLocalAvailabilityResponse({
      conversationId: null,
      request: {
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        party_size: 2,
        mode: 'exact',
        date: '2026-01-26',
        time: '14:00',
      },
      result,
    });

    expect(pendingOptions).toEqual([]);
    expect(response.booking?.status).toBe('confirming');
    expect(response.ui_actions.map((action) => action.type)).toEqual([
      'set_booking_field',
      'set_booking_field',
      'select_time_slot',
      'confirm_booking',
    ]);
    expect(response.spoken_text).toContain("They're open 11:00 AM to 10:00 PM on January 26.");
    expect(response.spoken_text).toMatch(/Should I book it\?$/);
  });

  it('checks selected restaurant hours without requiring a party size first', () => {
    const decision = planLocalBookingTurn({
      transcript: 'what are their hours tomorrow',
      booking: booking({
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        time: '7:00 PM',
        status: 'collecting_minimum_fields',
      }),
      conversationId: null,
      timezone: 'America/Toronto',
    });

    expect(decision.kind).toBe('check_availability');
    if (decision.kind !== 'check_availability') return;
    expect(decision.request.purpose).toBe('hours');
    expect(decision.request.mode).toBe('date_any_time');
    expect(decision.request.party_size).toBe(1);
    expect(decision.request.date).toBeTruthy();
  });

  it('turns an hours availability result into hours plus live openings', () => {
    const result: CenaivaAvailabilityResponse = {
      status: 'options',
      hours_window: '17:00 to 23:00',
      alternatives: [
        {
          shift_id: 'shift-1',
          date: '2026-01-26',
          date_time: '2026-01-26T18:30:00.000Z',
          display_time: '1:30 PM',
          hours_window: '17:00 to 23:00',
        },
        {
          shift_id: 'shift-1',
          date: '2026-01-26',
          date_time: '2026-01-26T19:00:00.000Z',
          display_time: '2:00 PM',
          hours_window: '17:00 to 23:00',
        },
      ],
    };

    const { response, pendingOptions } = buildLocalAvailabilityResponse({
      conversationId: null,
      request: {
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        party_size: 1,
        mode: 'date_any_time',
        purpose: 'hours',
        date: '2026-01-26',
      },
      result,
    });

    expect(pendingOptions).toEqual([]);
    expect(response.spoken_text).toBe(
      'Echoria is open 5:00 PM to 11:00 PM on January 26. I see availability around January 26 at 1:30 PM or January 26 at 2:00 PM.',
    );
  });

  it('tells the user when the restaurant is fully booked at capacity', () => {
    const result: CenaivaAvailabilityResponse = {
      status: 'unavailable',
      unavailable_reason: 'fully_booked',
      hours_window: '17:00 to 23:00',
      alternatives: [],
      message: 'The restaurant is fully booked for that date.',
    };

    const { response, pendingOptions } = buildLocalAvailabilityResponse({
      conversationId: null,
      request: {
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        party_size: 2,
        mode: 'exact',
        date: '2026-01-26',
        time: '19:00',
      },
      result,
    });

    expect(pendingOptions).toEqual([]);
    expect(response.spoken_text).toBe(
      "They're open 5:00 PM to 11:00 PM on January 26. January 26 is fully booked. What date and time should I try instead?",
    );
  });

  it('tells the user when the guest count is too large for the restaurant', () => {
    const result: CenaivaAvailabilityResponse = {
      status: 'unavailable',
      unavailable_reason: 'party_size_out_of_range',
      hours_window: '17:00 to 23:00',
      alternatives: [],
      message: "That party size is outside the restaurant's bookable range.",
    };

    const { response, pendingOptions } = buildLocalAvailabilityResponse({
      conversationId: null,
      request: {
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        party_size: 67,
        mode: 'exact',
        date: '2026-01-26',
        time: '19:00',
      },
      result,
    });

    expect(pendingOptions).toEqual([]);
    expect(response.next_expected_input).toBe('party_size');
    expect(response.spoken_text).toBe(
      "They're open 5:00 PM to 11:00 PM on January 26. Echoria cannot book 67 guests. What smaller party size should I check?",
    );
  });

  it('explains when a requested time lacks enough seats but nearby times exist', () => {
    const result: CenaivaAvailabilityResponse = {
      status: 'unavailable',
      unavailable_reason: 'insufficient_capacity',
      hours_window: '11:00 AM to 10:00 PM',
      alternatives: [
        {
          shift_id: 'shift-1',
          date: '2026-01-26',
          date_time: '2026-01-26T19:30:00.000Z',
          display_time: '7:30 PM',
          hours_window: '11:00 AM to 10:00 PM',
        },
        {
          shift_id: 'shift-1',
          date: '2026-01-26',
          date_time: '2026-01-26T18:30:00.000Z',
          display_time: '6:30 PM',
          hours_window: '11:00 AM to 10:00 PM',
        },
      ],
      message: 'There are not enough seats available at that time.',
    };

    const { response, pendingOptions } = buildLocalAvailabilityResponse({
      conversationId: null,
      request: {
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        party_size: 47,
        mode: 'exact',
        date: '2026-01-26',
        time: '19:00',
      },
      result,
    });

    expect(pendingOptions).toHaveLength(2);
    expect(response.spoken_text).toBe(
      "Echoria does not have enough seats available at 7:00 PM for 47 guests. They're open 11:00 AM to 10:00 PM on January 26. I found January 26 at 7:30 PM or January 26 at 6:30 PM. Which should I use?",
    );
  });

  it('keeps unavailable alternatives pending for first or second selection', () => {
    const result: CenaivaAvailabilityResponse = {
      status: 'unavailable',
      alternatives: [
        {
          shift_id: 'shift-1',
          date: '2026-01-26',
          date_time: '2026-01-26T18:30:00.000Z',
          display_time: '1:30 PM',
        },
        {
          shift_id: 'shift-1',
          date: '2026-01-27',
          date_time: '2026-01-27T19:00:00.000Z',
          display_time: '2:00 PM',
        },
      ],
    };

    const { response, pendingOptions } = buildLocalAvailabilityResponse({
      conversationId: null,
      request: {
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        party_size: 2,
        mode: 'exact',
        date: '2026-01-26',
        time: '14:00',
      },
      result,
    });

    expect(response.spoken_text).toContain('not available');
    expect(pendingOptions).toHaveLength(2);

    const selection = planLocalBookingTurn({
      transcript: 'second one',
      booking: booking({
        restaurant_id: 'rest-1',
        restaurant_name: 'Echoria',
        party_size: 2,
      }),
      conversationId: null,
      pendingOptions,
    });
    expect(selection.kind).toBe('local_response');
    if (selection.kind === 'local_response') {
      expect(selection.response.booking?.slot_iso).toBe('2026-01-27T19:00:00.000Z');
      expect(selection.response.booking?.status).toBe('confirming');
    }
  });
});
```

---

## After paste — wire-up checklist (Step 8 preview)

Once all six files compile and `npm run test --workspace=apps/web` is green, the remaining Step 2 → Step 8 wire-up work is:

1. In `apps/web/src/cenaiva/AssistantProvider.tsx` (or wherever `sendTranscript` lives), import `getCenaivaRecommendationMode` and pass its result as the `recommendation_mode` field on the orchestrator request body (per plan doc §5 row 4 / Step 8).
2. Same file, import `applyClientDiscoveryMemory` and call it on the orchestrator response **before** APPLY_RESPONSE.
3. Add Stage 1 of the four-stage pipeline: call `planLocalBookingTurn(...)` at the top of `sendTranscript` with the current `bookingState`, and branch on `decision.kind`:
   - `local_response` → speak `decision.response.spoken_text`, dispatch APPLY_RESPONSE, optionally clear pending options, schedule relisten if appropriate. Stop.
   - `check_availability` → speak `decision.filler`, POST `decision.request` to `cenaiva-availability`, then call `buildLocalAvailabilityResponse(...)` on the result and APPLY_RESPONSE. Stop.
   - `pass` → continue to Stage 3 (small-prompt) / Stage 4 (orchestrator) per plan doc §3.1.
4. `filterCenaivaRestaurants` is consumed by web's discovery rendering surface (the rail / map) — wire it where the FiltersDelta arrives, same as mobile.

That's all of Step 2 done, end-to-end.
