export type RestaurantPriceTier = 1 | 2 | 3;

export type RestaurantMenuPriceItem = {
  price?: number | string | null;
  category?: string | null;
  is_active?: boolean | null;
  is_available?: boolean | null;
};

const DEFAULT_PRICE_TIER: RestaurantPriceTier = 2;
const LOW_PRICE_MAX = 22;
const HIGH_PRICE_MIN = 55;
const PRICE_LEVEL_CATEGORY_NAMES = new Set(["main", "mains", "entree", "entrees"]);

function parsePrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\$+$/.test(trimmed)) return trimmed.length;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeExplicitRestaurantPriceRange(value: unknown): RestaurantPriceTier | null {
  const parsed = parsePrice(value);
  if (parsed == null || parsed < 1) return null;
  const rounded = Math.round(parsed);
  if (rounded >= 3) return 3;
  if (rounded >= 2) return 2;
  return 1;
}

export function normalizeRestaurantPriceRange(
  value: unknown,
  fallback: RestaurantPriceTier = DEFAULT_PRICE_TIER,
): RestaurantPriceTier {
  return normalizeExplicitRestaurantPriceRange(value) ?? fallback;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase();
}

export function isRestaurantPriceMenuCategory(category: string | null | undefined): boolean {
  return PRICE_LEVEL_CATEGORY_NAMES.has(normalizeText(category));
}

export function restaurantPriceRangeFromAverageDishPrice(averagePrice: number): RestaurantPriceTier {
  if (!Number.isFinite(averagePrice)) return DEFAULT_PRICE_TIER;
  if (averagePrice < LOW_PRICE_MAX) return 1;
  if (averagePrice < HIGH_PRICE_MIN) return 2;
  return 3;
}

export function medianMainEntreePrice(items: RestaurantMenuPriceItem[]): number | null {
  const prices = items.flatMap((item) => {
    if (item.is_active === false || item.is_available === false) return [];
    if (!isRestaurantPriceMenuCategory(item.category)) return [];
    const price = parsePrice(item.price);
    return price == null || price <= 0 ? [] : [price];
  }).sort((a, b) => a - b);

  if (!prices.length) return null;
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 === 0
    ? (prices[mid - 1] + prices[mid]) / 2
    : prices[mid];
}

export function averageRestaurantMenuDishPrice(items: RestaurantMenuPriceItem[]): number | null {
  return medianMainEntreePrice(items);
}

export function deriveRestaurantPriceRangeFromMenuItems(
  items: RestaurantMenuPriceItem[],
  fallbackRange?: unknown,
  defaultTier: RestaurantPriceTier = DEFAULT_PRICE_TIER,
): RestaurantPriceTier {
  const explicit = normalizeExplicitRestaurantPriceRange(fallbackRange);
  if (explicit != null) return explicit;
  const median = medianMainEntreePrice(items);
  return median == null ? defaultTier : restaurantPriceRangeFromAverageDishPrice(median);
}

export function deriveRestaurantPriceRangeFromMenuOnly(
  items: RestaurantMenuPriceItem[],
): RestaurantPriceTier | null {
  const median = medianMainEntreePrice(items);
  return median == null ? null : restaurantPriceRangeFromAverageDishPrice(median);
}
