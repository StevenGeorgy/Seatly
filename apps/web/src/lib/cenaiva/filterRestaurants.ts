import type { FiltersDelta } from "@cenaiva/assistant";

import type { CollectorRestaurant as Restaurant } from "@/lib/cenaiva/restaurantAdapter";

function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function includesNormalized(source: string, target: string): boolean {
  return Boolean(source && target && source.includes(target));
}

const CUISINE_GROUPS: Record<string, string[]> = {
  european: [
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
  asian: [
    "asian",
    "chinese",
    "japanese",
    "korean",
    "thai",
    "vietnamese",
    "filipino",
    "malaysian",
    "indonesian",
    "sushi",
    "ramen",
    "dim sum",
  ],
  latin: [
    "latin",
    "mexican",
    "peruvian",
    "brazilian",
    "argentinian",
    "colombian",
    "cuban",
    "venezuelan",
  ],
  "middle eastern": [
    "middle eastern",
    "mediterranean",
    "lebanese",
    "turkish",
    "persian",
    "egyptian",
    "moroccan",
    "halal",
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
  return normalize(
    [
      restaurant.name,
      restaurant.cuisineType,
      restaurant.city,
      restaurant.area,
      restaurant.description,
      ...(restaurant.tags ?? []),
    ].join(" "),
  );
}

function matchesCuisine(
  restaurant: Restaurant,
  cuisines: string[] | undefined,
): boolean {
  const cleaned = expandCuisineTerms(cuisines);
  if (!cleaned.length) return true;
  const cuisineText = normalize(
    [restaurant.cuisineType, restaurant.name, ...(restaurant.tags ?? [])].join(" "),
  );
  return cleaned.some((cuisine) => includesNormalized(cuisineText, cuisine));
}

export function filterCenaivaRestaurants(
  restaurants: Restaurant[],
  markerRestaurantIds: string[],
  filters: FiltersDelta | null | undefined,
): Restaurant[] {
  const markerIds = Array.isArray(markerRestaurantIds) ? markerRestaurantIds : [];
  const restaurantsById = new Map(
    restaurants.map((restaurant) => [restaurant.id, restaurant]),
  );
  if (markerIds.length) {
    return markerIds
      .map((restaurantId) => restaurantsById.get(restaurantId))
      .filter((restaurant): restaurant is Restaurant => Boolean(restaurant));
  }

  let next = restaurants;

  next = next.filter((restaurant) => matchesCuisine(restaurant, filters?.cuisine));

  const city = normalize(filters?.city);
  if (city) {
    next = next.filter((restaurant) =>
      includesNormalized(normalize(restaurant.city), city),
    );
  }

  const query = normalize(filters?.query);
  if (query) {
    next = next.filter((restaurant) =>
      includesNormalized(restaurantSearchText(restaurant), query),
    );
  }

  return next;
}
