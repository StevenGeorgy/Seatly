export type RestaurantPriceLevel = 1 | 2 | 3;

export type RestaurantPriceMenuItem = {
  name?: string | null;
  category?: string | null;
  price?: number | string | null;
  is_active?: boolean | null;
  is_available?: boolean | null;
};

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
  return level == null ? "" : RESTAURANT_PRICE_LABELS[level];
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
  return medianMainEntreePrice(items);
}

function isPricedActiveItem(item: RestaurantPriceMenuItem): boolean {
  if (item.is_active === false || item.is_available === false) return false;
  return numericPrice(item.price) != null;
}

function medianOfPrices(prices: number[]): number | null {
  if (prices.length === 0) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function medianMainEntreePrice(items: RestaurantPriceMenuItem[]): number | null {
  const mainPrices = items
    .filter(isMainEntreeMenuItem)
    .map((item) => numericPrice(item.price))
    .filter((price): price is number => price != null);
  return medianOfPrices(mainPrices);
}

// Fallback signal for the meter: the median of EVERY active, available, priced
// item (any category). Used when a restaurant's menu has no "Mains/Entrées"
// category so the meter still reflects roughly what diners pay.
export function medianAllPricedItemsPrice(items: RestaurantPriceMenuItem[]): number | null {
  const prices = items
    .filter(isPricedActiveItem)
    .map((item) => numericPrice(item.price))
    .filter((price): price is number => price != null);
  return medianOfPrices(prices);
}

// Customer-facing price meter, derived from menu data. Resolution order:
//   1. Median price of "Mains/Entrées" items — the most accurate signal (what
//      diners actually pay), so it always wins when those items exist.
//   2. The owner-set price tier (`fallbackRange`, the `restaurants.price_range`
//      column) — the owner's explicit signal, used when the menu has no
//      "Mains/Entrées" category. Preferred over a whole-menu median because the
//      latter skews low (it includes cheap apps/sides/desserts).
//   3. Median of ALL active, available, priced items — a last-resort estimate so
//      a restaurant with a menu but no owner tier still shows something.
//   4. null — no menu at all; the component renders the empty 3-slot placeholder.
function priceLevelFromMenuItems(
  items: RestaurantPriceMenuItem[],
  fallbackRange?: number | null,
): RestaurantPriceLevel | null {
  const mains = medianMainEntreePrice(items);
  if (mains != null) return restaurantPriceLevelFromAverage(mains);
  const ownerLevel = normalizeRestaurantPriceLevel(fallbackRange ?? null);
  if (ownerLevel != null) return ownerLevel;
  const all = medianAllPricedItemsPrice(items);
  if (all != null) return restaurantPriceLevelFromAverage(all);
  return null;
}

export function deriveRestaurantPriceLevel(
  items: RestaurantPriceMenuItem[],
  fallbackRange?: number | null,
): RestaurantPriceLevel | null {
  return priceLevelFromMenuItems(items, fallbackRange);
}

export function deriveRestaurantPriceLevelFromMenu(
  items: RestaurantPriceMenuItem[],
  fallbackRange?: number | null,
): RestaurantPriceLevel | null {
  return priceLevelFromMenuItems(items, fallbackRange);
}
