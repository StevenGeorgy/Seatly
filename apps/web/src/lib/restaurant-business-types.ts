export const RESTAURANT_BUSINESS_TYPE_OPTIONS = [
  "Bar",
  "Bistro",
  "Brasserie",
  "Buffet",
  "Cafe",
  "Casual dining",
  "Cocktail bar",
  "Coffee shop",
  "Counter service",
  "Dessert shop",
  "Diner",
  "Fast casual",
  "Fine dining",
  "Food hall",
  "Food truck",
  "Gastropub",
  "Hotel restaurant",
  "Lounge",
  "Nightclub",
  "Pop-up",
  "Pub",
  "Quick service",
  "Restaurant",
  "Rooftop",
  "Supper club",
  "Takeout",
  "Tasting room",
  "Wine bar",
  "Other",
] as const;

export type RestaurantBusinessType = typeof RESTAURANT_BUSINESS_TYPE_OPTIONS[number];

const BUSINESS_TYPE_ALIASES: Record<string, RestaurantBusinessType> = {
  "bar and grill": "Casual dining",
  "cafe": "Cafe",
  "coffee": "Coffee shop",
  "coffee bar": "Coffee shop",
  "fast food": "Quick service",
  "full service": "Restaurant",
  "ghost kitchen": "Takeout",
  "qsr": "Quick service",
  "quick-service": "Quick service",
  "quick service restaurant": "Quick service",
  "wine": "Wine bar",
};

function normalizeBusinessTypeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

const BUSINESS_TYPE_BY_KEY = new Map(
  RESTAURANT_BUSINESS_TYPE_OPTIONS.map((businessType) => [
    normalizeBusinessTypeKey(businessType),
    businessType,
  ]),
);

export function normalizeRestaurantBusinessType(value: string | null | undefined): RestaurantBusinessType | "" {
  const key = normalizeBusinessTypeKey(value ?? "");
  if (!key) return "";
  return BUSINESS_TYPE_BY_KEY.get(key) ?? BUSINESS_TYPE_ALIASES[key] ?? "";
}
