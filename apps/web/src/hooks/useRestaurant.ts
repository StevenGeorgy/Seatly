import { useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { deriveRestaurantPriceLevel, type RestaurantPriceMenuItem } from "@/lib/restaurant-price-level";
import type { RestaurantSettings } from "@/hooks/useStaffRestaurants";

export type Restaurant = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  cover_photo_url: string | null;
  cuisine_type: string | null;
  description: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  hours_json: Record<string, unknown> | null;
  settings_json: RestaurantSettings | null;
  plan: string;
  is_active: boolean;
  timezone: string;
  currency: string;
  tax_rate: number;
  deposit_policy_json: Record<string, unknown> | null;
  loyalty_config_json: Record<string, unknown> | null;
  stripe_account_id: string | null;
  stripe_onboarding_complete: boolean | null;
  avg_rating: number | null;
  total_reviews: number | null;
  price_range: number | null;
  booking_advance_days: number;
  cancellation_hours: number;
  no_show_fee: number | null;
  accepts_walkins: boolean | null;
  business_type: string | null;
};

type RestaurantPriceItemRow = RestaurantPriceMenuItem & {
  restaurant_id: string;
  category_id: string | null;
};

type RestaurantPriceCategoryRow = {
  id: string;
  restaurant_id: string;
  name: string;
};

function itemsWithActiveCategoryNames(
  menuItems: RestaurantPriceItemRow[],
  categories: RestaurantPriceCategoryRow[],
): RestaurantPriceItemRow[] {
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  return menuItems.flatMap((item) => {
    const category = item.category_id ? categoriesById.get(item.category_id) : null;
    if (!category || category.restaurant_id !== item.restaurant_id) return [];
    return [{ ...item, category: category.name }];
  });
}

function applyDerivedPriceLevels(
  restaurants: Restaurant[],
  menuItems: RestaurantPriceItemRow[],
  categories: RestaurantPriceCategoryRow[],
): Restaurant[] {
  if (restaurants.length === 0) return restaurants;

  const categorizedItems = itemsWithActiveCategoryNames(menuItems, categories);
  const itemsByRestaurant = categorizedItems.reduce<Map<string, RestaurantPriceItemRow[]>>((map, item) => {
    const existing = map.get(item.restaurant_id) ?? [];
    existing.push(item);
    map.set(item.restaurant_id, existing);
    return map;
  }, new Map());

  return restaurants.map((restaurant) => ({
    ...restaurant,
    price_range: deriveRestaurantPriceLevel(
      itemsByRestaurant.get(restaurant.id) ?? [],
      restaurant.price_range,
    ),
  }));
}

export function usePublicRestaurants() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isSupabaseConfigured()) {
        if (cancelled) return;
        setRestaurants([]);
        setLoading(false);
        return;
      }

      const client = getSupabaseBrowserClient();
      const { data } = await client
        .from("restaurants")
        .select("*")
        .eq("is_active", true)
        .order("avg_rating", { ascending: false, nullsFirst: false });

      if (cancelled) return;
      const rows = (data ?? []) as Restaurant[];
      if (rows.length === 0) {
        setRestaurants([]);
        setLoading(false);
        return;
      }

      const { data: menuData } = await client
        .from("menu_items")
        .select("restaurant_id, category_id, name, category, price, is_active, is_available")
        .in("restaurant_id", rows.map((restaurant) => restaurant.id))
        .eq("is_active", true)
        .eq("is_available", true)
        .not("category_id", "is", null);

      const { data: categoryData } = await client
        .from("menu_categories")
        .select("id, restaurant_id, name")
        .in("restaurant_id", rows.map((restaurant) => restaurant.id))
        .eq("is_active", true);

      if (cancelled) return;
      setRestaurants(applyDerivedPriceLevels(
        rows,
        (menuData ?? []) as RestaurantPriceItemRow[],
        (categoryData ?? []) as RestaurantPriceCategoryRow[],
      ));
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, []);

  return { restaurants, loading };
}

export function useRestaurant(slugOrId?: string) {
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!slugOrId) {
        if (cancelled) return;
        setRestaurant(null);
        setLoading(false);
        return;
      }

      if (!isSupabaseConfigured()) {
        if (cancelled) return;
        setRestaurant(null);
        setError(new Error("Supabase env vars are not set."));
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      const client = getSupabaseBrowserClient();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);
      const column = isUuid ? "id" : "slug";
      const { data, error: qErr } = await client
        .from("restaurants")
        .select("*")
        .eq(column, slugOrId)
        .single();

      if (cancelled) return;
      if (qErr || !data) {
        setRestaurant(null);
        setError(new Error(qErr?.message ?? "Not found"));
      } else {
        const row = data as Restaurant;
        const { data: menuData } = await client
          .from("menu_items")
          .select("restaurant_id, category_id, name, category, price, is_active, is_available")
          .eq("restaurant_id", row.id)
          .eq("is_active", true)
          .eq("is_available", true)
          .not("category_id", "is", null);

        const { data: categoryData } = await client
          .from("menu_categories")
          .select("id, restaurant_id, name")
          .eq("restaurant_id", row.id)
          .eq("is_active", true);

        if (cancelled) return;
        setRestaurant(applyDerivedPriceLevels(
          [row],
          (menuData ?? []) as RestaurantPriceItemRow[],
          (categoryData ?? []) as RestaurantPriceCategoryRow[],
        )[0]);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [slugOrId]);

  return { restaurant, loading, error };
}
