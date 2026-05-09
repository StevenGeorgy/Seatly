import type { Restaurant as WebRestaurant } from "@/hooks/useRestaurant";

/**
 * Mobile-shaped restaurant subset consumed by the ported Cenaiva helpers
 * (`filterRestaurants`, `localBookingCollector`). Web's `Restaurant` type
 * uses snake_case + lacks `area`/`tags`; rather than edit the ported helpers
 * (which would diverge from mobile and complicate future cherry-picks),
 * we map at the call site.
 */
export type CollectorRestaurant = {
  id: string;
  name: string;
  cuisineType: string;
  city: string;
  area: string;
  description: string;
  tags: string[];
  hoursOfOperation: unknown;
  timezone: string;
};

export function toCollectorRestaurant(r: WebRestaurant): CollectorRestaurant {
  return {
    id: r.id,
    name: r.name,
    cuisineType: r.cuisine_type ?? "",
    city: r.city ?? "",
    // Web's Restaurant has no `area`/neighborhood; collector tolerates empty.
    area: "",
    description: r.description ?? "",
    // Web's Restaurant has no tags array; collector tolerates empty.
    tags: [],
    hoursOfOperation: r.hours_json,
    timezone: r.timezone,
  };
}
