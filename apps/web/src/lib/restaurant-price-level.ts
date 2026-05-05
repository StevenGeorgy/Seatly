export type RestaurantPriceLevel = 1 | 2 | 3;

export type RestaurantPriceMenuItem = {
  name?: string | null;
  category?: string | null;
  price?: number | string | null;
  is_active?: boolean | null;
  is_available?: boolean | null;
};

export const DEFAULT_RESTAURANT_PRICE_LEVEL: RestaurantPriceLevel = 2;

export const RESTAURANT_PRICE_LABELS: Record<RestaurantPriceLevel, string> = {
  1: "$",
  2: "$$",
  3: "$$$",
};

const PRICE_LEVEL_CATEGORY_NAMES = new Set(["main", "mains", "entree", "entrees"]);

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase();
}

function numericPrice(value: number | string | null | undefined): number | null {
  const price = typeof value === "number" ? value : Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function normalizeRestaurantPriceLevel(value: number | null | undefined): RestaurantPriceLevel | null {
  if (value == null) return null;
  const level = Math.round(value);
  if (!Number.isFinite(level) || level <= 0) return null;
  if (level <= 1) return 1;
  if (level >= 3) return 3;
  return 2;
}

export function restaurantPriceLevelFromLabel(label: string | null | undefined): RestaurantPriceLevel | null {
  const length = label?.trim().length ?? 0;
  return normalizeRestaurantPriceLevel(length);
}

export function restaurantPriceLabelFromLevel(level: RestaurantPriceLevel | null | undefined): string {
  return RESTAURANT_PRICE_LABELS[level ?? DEFAULT_RESTAURANT_PRICE_LEVEL];
}

export function restaurantPriceLabelFromRange(value: number | null | undefined): string {
  return restaurantPriceLabelFromLevel(normalizeRestaurantPriceLevel(value));
}

export function restaurantPriceLevelFromAverage(averageMainPrice: number): RestaurantPriceLevel {
  if (averageMainPrice < 22) return 1;
  if (averageMainPrice < 55) return 2;
  return 3;
}

export function isMainEntreeMenuItem(item: RestaurantPriceMenuItem): boolean {
  if (item.is_active === false || item.is_available === false) return false;
  if (numericPrice(item.price) == null) return false;

  return PRICE_LEVEL_CATEGORY_NAMES.has(normalizeText(item.category));
}

export function averageMainEntreePrice(items: RestaurantPriceMenuItem[]): number | null {
  const mainPrices = items
    .filter(isMainEntreeMenuItem)
    .map((item) => numericPrice(item.price))
    .filter((price): price is number => price != null);

  if (mainPrices.length === 0) return null;
  return mainPrices.reduce((sum, price) => sum + price, 0) / mainPrices.length;
}

export function deriveRestaurantPriceLevel(
  items: RestaurantPriceMenuItem[],
  fallbackRange?: number | null,
): RestaurantPriceLevel {
  const average = averageMainEntreePrice(items);
  if (average != null) return restaurantPriceLevelFromAverage(average);
  return normalizeRestaurantPriceLevel(fallbackRange) ?? DEFAULT_RESTAURANT_PRICE_LEVEL;
}

export function deriveRestaurantPriceLevelFromMenu(
  items: RestaurantPriceMenuItem[],
): RestaurantPriceLevel | null {
  const average = averageMainEntreePrice(items);
  return average != null ? restaurantPriceLevelFromAverage(average) : null;
}
