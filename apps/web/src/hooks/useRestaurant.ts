import { useQuery } from "@tanstack/react-query";

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
  deposit_tiers: Array<{ min_party_size: number; amount_per_person_cents: number }> | null;
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

type RestaurantReviewSummaryRow = {
  restaurant_id?: string | null;
  avg_rating?: number | string | null;
  total_reviews?: number | null;
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

function applyReviewSummaries(
  restaurants: Restaurant[],
  reviewRows: RestaurantReviewSummaryRow[] | null | undefined,
): Restaurant[] {
  const summaries = new Map(
    (reviewRows ?? [])
      .filter((row) => row.restaurant_id)
      .map((row) => [
        row.restaurant_id as string,
        {
          avg_rating: row.avg_rating == null ? null : Number(row.avg_rating),
          total_reviews: row.total_reviews ?? 0,
        },
      ]),
  );

  return restaurants.map((restaurant) => {
    const summary = summaries.get(restaurant.id);
    return {
      ...restaurant,
      avg_rating: summary?.avg_rating ?? null,
      total_reviews: summary?.total_reviews ?? 0,
    };
  });
}

async function fetchPublicRestaurants(): Promise<Restaurant[]> {
  if (!isSupabaseConfigured()) return [];

  const client = getSupabaseBrowserClient();
  const { data } = await client
    .from("restaurants")
    .select("*")
    .eq("is_active", true)
    .order("avg_rating", { ascending: false, nullsFirst: false });

  const rows = (data ?? []) as Restaurant[];
  if (rows.length === 0) return [];

  const ids = rows.map((restaurant) => restaurant.id);

  const [{ data: menuData }, { data: categoryData }, { data: reviewSummaryData }] = await Promise.all([
    client
      .from("menu_items")
      .select("restaurant_id, category_id, name, category, price, is_active, is_available")
      .in("restaurant_id", ids)
      .eq("is_active", true)
      .eq("is_available", true)
      .not("category_id", "is", null),
    client
      .from("menu_categories")
      .select("id, restaurant_id, name")
      .in("restaurant_id", ids)
      .eq("is_active", true),
    client.rpc("restaurant_review_summaries", { p_restaurant_ids: ids }),
  ]);

  const withPrices = applyDerivedPriceLevels(
    applyReviewSummaries(rows, reviewSummaryData as RestaurantReviewSummaryRow[] | null),
    (menuData ?? []) as RestaurantPriceItemRow[],
    (categoryData ?? []) as RestaurantPriceCategoryRow[],
  );
  return [...withPrices].sort((a, b) => (b.avg_rating ?? -1) - (a.avg_rating ?? -1));
}

export async function fetchRestaurantBySlugOrId(slugOrId: string): Promise<Restaurant> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase env vars are not set.");
  }

  const client = getSupabaseBrowserClient();
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);
  const column = isUuid ? "id" : "slug";
  const { data, error: qErr } = await client
    .from("restaurants")
    .select("*")
    .eq(column, slugOrId)
    .single();

  if (qErr || !data) {
    throw new Error(qErr?.message ?? "Not found");
  }

  const row = data as Restaurant;
  const [{ data: menuData }, { data: categoryData }, { data: reviewSummaryData }] = await Promise.all([
    client
      .from("menu_items")
      .select("restaurant_id, category_id, name, category, price, is_active, is_available")
      .eq("restaurant_id", row.id)
      .eq("is_active", true)
      .eq("is_available", true)
      .not("category_id", "is", null),
    client
      .from("menu_categories")
      .select("id, restaurant_id, name")
      .eq("restaurant_id", row.id)
      .eq("is_active", true),
    client.rpc("restaurant_review_summaries", { p_restaurant_ids: [row.id] }),
  ]);

  return applyDerivedPriceLevels(
    applyReviewSummaries([row], reviewSummaryData as RestaurantReviewSummaryRow[] | null),
    (menuData ?? []) as RestaurantPriceItemRow[],
    (categoryData ?? []) as RestaurantPriceCategoryRow[],
  )[0];
}

const EMPTY_RESTAURANTS: Restaurant[] = [];

export function usePublicRestaurants() {
  const query = useQuery({
    queryKey: ["public-restaurants"],
    queryFn: fetchPublicRestaurants,
  });

  return {
    restaurants: query.data ?? EMPTY_RESTAURANTS,
    loading: query.isPending,
  };
}

export function useRestaurant(slugOrId?: string) {
  const query = useQuery({
    queryKey: ["restaurant", slugOrId],
    queryFn: () => fetchRestaurantBySlugOrId(slugOrId as string),
    enabled: Boolean(slugOrId),
  });

  return {
    restaurant: query.data ?? null,
    loading: slugOrId ? query.isPending : false,
    error: (query.error as Error | null) ?? null,
  };
}
