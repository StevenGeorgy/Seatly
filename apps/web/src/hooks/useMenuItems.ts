import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { MOCK_CATEGORIES, MOCK_MENU_ITEMS } from "@/lib/mock-data";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type MenuCategoryRow = {
  id: string;
  restaurant_id: string;
  name: string;
  name_fr: string | null;
  description: string | null;
  sort_order: number;
  available_from: string | null;
  available_to: string | null;
  is_active: boolean;
};

export type MenuItemRow = {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  category: string | null;
  name: string;
  name_fr: string | null;
  description: string | null;
  description_fr: string | null;
  price: number;
  cost_price: number | null;
  photo_url: string | null;
  allergens: string[] | null;
  dietary_flags: string[] | null;
  calories: number | null;
  is_available: boolean;
  is_preorderable: boolean;
  is_featured: boolean;
  is_active: boolean;
  preparation_time_minutes: number | null;
  spice_level: string | null;
  loyalty_points_value: number | null;
  sort_order: number;
};

export function useMenuCategories() {
  const { selectedRestaurantId } = useRestaurantScope();
  const [categories, setCategories] = useState<MenuCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setCategories([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const client = getSupabaseBrowserClient();
    const { data } = await client
      .from("menu_categories")
      .select("*")
      .eq("restaurant_id", selectedRestaurantId)
      .eq("is_active", true)
      .order("sort_order");
    const rows = (data ?? []) as MenuCategoryRow[];
    setCategories(rows.length > 0 ? rows : MOCK_CATEGORIES);
    setLoading(false);
  }, [selectedRestaurantId]);

  useEffect(() => { void fetch(); }, [fetch]);
  return { categories, loading, refetch: fetch };
}

export function useMenuItems(categoryId?: string) {
  const { selectedRestaurantId } = useRestaurantScope();
  const [items, setItems] = useState<MenuItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const client = getSupabaseBrowserClient();
    let query = client
      .from("menu_items")
      .select("*")
      .eq("restaurant_id", selectedRestaurantId)
      .eq("is_active", true)
      .order("sort_order");

    if (categoryId) {
      query = query.eq("category_id", categoryId);
    }

    const { data } = await query;
    let rows = (data ?? []) as MenuItemRow[];
    if (rows.length === 0) {
      rows = categoryId ? MOCK_MENU_ITEMS.filter((m) => m.category_id === categoryId) : MOCK_MENU_ITEMS;
    }
    setItems(rows);
    setLoading(false);
  }, [selectedRestaurantId, categoryId]);

  useEffect(() => { void fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}
