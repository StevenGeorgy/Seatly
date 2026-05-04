export const RESTAURANT_DIETARY_TAGS = [
  "halal",
  "kosher",
  "vegan",
  "vegetarian",
  "gluten_free",
  "dairy_free",
  "nut_free",
] as const;

export type RestaurantDietaryTag = (typeof RESTAURANT_DIETARY_TAGS)[number];

const RESTAURANT_DIETARY_TAG_SET = new Set<string>(RESTAURANT_DIETARY_TAGS);

export function isRestaurantDietaryTag(value: string): value is RestaurantDietaryTag {
  return RESTAURANT_DIETARY_TAG_SET.has(value);
}

export function normalizeRestaurantDietaryTags(value: unknown): RestaurantDietaryTag[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is RestaurantDietaryTag => (
    typeof item === "string" && isRestaurantDietaryTag(item)
  ));
}
