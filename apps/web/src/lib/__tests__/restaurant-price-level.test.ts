import { describe, expect, it } from "vitest";

import {
  deriveRestaurantPriceLevel,
  deriveRestaurantPriceLevelFromMenu,
  type RestaurantPriceMenuItem,
} from "@/lib/restaurant-price-level";

const main = (price: number): RestaurantPriceMenuItem => ({
  name: "main",
  category: "Mains",
  price,
  is_active: true,
  is_available: true,
});

const other = (category: string, price: number): RestaurantPriceMenuItem => ({
  name: category,
  category,
  price,
  is_active: true,
  is_available: true,
});

describe("deriveRestaurantPriceLevel", () => {
  it("uses the Mains/Entrées median when those items exist", () => {
    // Mains median = 30 (< 55) -> level 2. The cheap side must NOT pull it down.
    const items = [main(25), main(30), main(35), other("Sides", 5)];
    expect(deriveRestaurantPriceLevel(items)).toBe(2);
  });

  it("prefers the owner-set price tier over the all-items median when there is no Mains category", () => {
    // Steakhouse-style menu (no "Mains" category). All-items median is ~18 (=> $),
    // but the owner explicitly set tier 3 -> the meter must show $$$, not $.
    const items = [other("Beef", 18), other("Beef", 20), other("Apps", 12)];
    expect(deriveRestaurantPriceLevel(items, 3)).toBe(3); // owner tier wins over the low median
    // Mains still win over the owner tier when present:
    expect(deriveRestaurantPriceLevel([main(60), main(62)], 1)).toBe(3);
    // Owner tier applies even with no priced items at all:
    expect(deriveRestaurantPriceLevel([], 2)).toBe(2);
  });

  it("falls back to the all-items median only when there is no Mains category AND no owner tier", () => {
    const cheap = [other("Beef", 18), other("Beef", 20), other("Apps", 12)]; // median 18 -> $
    const mid = [other("Steaks", 44), other("Steaks", 46), other("Apps", 15)]; // median 44 -> $$
    const pricey = [other("Steaks", 60), other("Steaks", 62), other("Steaks", 58)]; // median 60 -> $$$
    expect(deriveRestaurantPriceLevel(cheap)).toBe(1);
    expect(deriveRestaurantPriceLevel(mid)).toBe(2);
    expect(deriveRestaurantPriceLevel(pricey)).toBe(3);
  });

  it("returns null only when there are no active, available, priced items", () => {
    expect(deriveRestaurantPriceLevel([])).toBeNull();
    expect(
      deriveRestaurantPriceLevel([
        { name: "x", category: "Steaks", price: 50, is_available: false },
        { name: "y", category: "Steaks", price: 0, is_active: true, is_available: true },
      ]),
    ).toBeNull();
  });

  it("deriveRestaurantPriceLevelFromMenu behaves identically", () => {
    const items = [other("Steaks", 60), other("Steaks", 62), other("Steaks", 58)];
    expect(deriveRestaurantPriceLevelFromMenu(items)).toBe(3);
    expect(deriveRestaurantPriceLevelFromMenu([])).toBeNull();
  });
});
