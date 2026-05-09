import { describe, expect, it } from "vitest";

import { filterCenaivaRestaurants } from "@/lib/cenaiva/filterRestaurants";
import type { CollectorRestaurant as Restaurant } from "@/lib/cenaiva/restaurantAdapter";

const baseRestaurant: Restaurant = {
  id: "base",
  name: "Base",
  cuisineType: "Modern Canadian",
  description: "",
  city: "Toronto",
  area: "Downtown",
  tags: [],
  hoursOfOperation: {},
  timezone: "America/Toronto",
};

function restaurant(patch: Partial<Restaurant>): Restaurant {
  return { ...baseRestaurant, ...patch };
}

describe("filterCenaivaRestaurants", () => {
  const restaurants = [
    restaurant({ id: "italian-1", name: "La Piazza", cuisineType: "Italian Fine Dining" }),
    restaurant({ id: "thai-1", name: "Pai", cuisineType: "Thai", tags: ["spicy noodles"] }),
    restaurant({
      id: "french-1",
      name: "La Maison",
      cuisineType: "French Bistro",
      city: "Montreal",
    }),
    restaurant({ id: "greek-1", name: "Agora", cuisineType: "Greek Mediterranean" }),
  ];

  it("filters the assistant rail by cuisine even when marker ids are omitted", () => {
    const next = filterCenaivaRestaurants(restaurants, [], { cuisine: ["Italian"] });
    expect(next.map((item) => item.id)).toEqual(["italian-1"]);
  });

  it("trusts assistant marker order instead of re-filtering named suggestions", () => {
    const next = filterCenaivaRestaurants(restaurants, ["italian-1", "thai-1"], {
      cuisine: ["Thai"],
    });
    expect(next.map((item) => item.id)).toEqual(["italian-1", "thai-1"]);
  });

  it("preserves the assistant suggestion order when marker ids are present", () => {
    const next = filterCenaivaRestaurants(restaurants, ["french-1", "italian-1"], {});
    expect(next.map((item) => item.id)).toEqual(["french-1", "italian-1"]);
  });

  it("filters by query and city for assistant discovery refinements", () => {
    const next = filterCenaivaRestaurants(restaurants, [], {
      city: "montreal",
      query: "bistro",
    });
    expect(next.map((item) => item.id)).toEqual(["french-1"]);
  });

  it("expands European cuisine when there is no assistant marker set", () => {
    const next = filterCenaivaRestaurants(restaurants, [], { cuisine: ["European"] });
    expect(next.map((item) => item.id)).toEqual(["italian-1", "french-1", "greek-1"]);
  });
});
