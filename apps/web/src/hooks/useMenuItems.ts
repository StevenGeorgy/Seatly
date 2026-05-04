import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export function usePublicMenuCategories(restaurantId: string | null | undefined) {
  const [categories, setCategories] = useState<MenuCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!restaurantId || !isSupabaseConfigured()) {
        setCategories([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setCategories([]);
      const client = getSupabaseBrowserClient();
      const { data } = await client
        .from("menu_categories")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .order("sort_order");
      if (cancelled) return;
      setCategories((data ?? []) as MenuCategoryRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [restaurantId]);

  return { categories, loading };
}

export function usePublicMenuItems(restaurantId: string | null | undefined) {
  const [items, setItems] = useState<MenuItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!restaurantId || !isSupabaseConfigured()) {
        setItems([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setItems([]);
      const client = getSupabaseBrowserClient();
      const { data } = await client
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .eq("is_available", true)
        .order("sort_order");
      if (cancelled) return;
      setItems((data ?? []) as MenuItemRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [restaurantId]);

  return { items, loading };
}

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

export type CreateMenuCategoryPayload = {
  name: string;
  description: string | null;
  sort_order: number;
};

export type UpdateMenuCategoryPayload = {
  name: string;
  description: string | null;
  sort_order?: number;
};

export type SaveMenuItemPayload = {
  name: string;
  description: string | null;
  price: number;
  category_id: string | null;
  category: string | null;
  photo_url: string | null;
  dietary_flags: string[];
  allergens: string[];
  sort_order?: number;
};

export const PRICE_LEVEL_MENU_CATEGORY_NAMES = ["Mains", "Entrées"] as const;

const SUPPORTED_MENU_IMAGE_TYPES: Array<{ mime: string; extensions: string[] }> = [
  { mime: "image/jpeg", extensions: ["jpg", "jpeg"] },
  { mime: "image/png", extensions: ["png"] },
  { mime: "image/webp", extensions: ["webp"] },
  { mime: "image/gif", extensions: ["gif"] },
];

export const MENU_IMAGE_ACCEPT = SUPPORTED_MENU_IMAGE_TYPES
  .flatMap((type) => [type.mime, ...type.extensions.map((extension) => `.${extension}`)])
  .join(",");

export const MENU_IMAGE_SUPPORT_MESSAGE = "Upload a JPG, PNG, WebP, or GIF image.";

export function resolveMenuItemImage(file: File): { mime: string } | null {
  const mime = file.type.toLowerCase();
  const byMime = SUPPORTED_MENU_IMAGE_TYPES.find((type) => type.mime === mime);
  if (byMime) return { mime: byMime.mime };

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension) return null;

  const byExtension = SUPPORTED_MENU_IMAGE_TYPES.find((type) => type.extensions.includes(extension));
  return byExtension ? { mime: byExtension.mime } : null;
}

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
    const missingPriceCategories = PRICE_LEVEL_MENU_CATEGORY_NAMES.filter(
      (name) => !rows.some((category) => category.name.trim().toLowerCase() === name.toLowerCase()),
    );

    if (missingPriceCategories.length > 0) {
      const { data: inserted } = await client
        .from("menu_categories")
        .insert(missingPriceCategories.map((name, index) => ({
          restaurant_id: selectedRestaurantId,
          name,
          description: name === "Mains" ? "Main dishes used for price level" : "Entrées used for price level",
          sort_order: rows.length + index,
          is_active: true,
        })))
        .select("*");

      setCategories([...rows, ...((inserted ?? []) as MenuCategoryRow[])].sort((a, b) => a.sort_order - b.sort_order));
    } else {
      setCategories(rows);
    }
    setLoading(false);
  }, [selectedRestaurantId]);

  useEffect(() => {
    void Promise.resolve().then(() => fetch());
  }, [fetch]);

  const createCategory = useCallback(async (payload: CreateMenuCategoryPayload): Promise<MenuCategoryRow | null> => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      return {
        id: `local-cat-${Date.now()}`,
        restaurant_id: "demo-menu",
        name: payload.name,
        name_fr: null,
        description: payload.description,
        sort_order: payload.sort_order,
        available_from: null,
        available_to: null,
        is_active: true,
      };
    }

    const client = getSupabaseBrowserClient();
    const { data, error } = await client
      .from("menu_categories")
      .insert({
        restaurant_id: selectedRestaurantId,
        name: payload.name,
        description: payload.description,
        sort_order: payload.sort_order,
        is_active: true,
      })
      .select("*")
      .single();

    if (error) throw error;
    await fetch();
    return data as MenuCategoryRow;
  }, [fetch, selectedRestaurantId]);

  const updateCategory = useCallback(async (id: string, payload: UpdateMenuCategoryPayload): Promise<void> => {
    if (!selectedRestaurantId || !isSupabaseConfigured() || id.startsWith("demo-") || id.startsWith("local-")) {
      return;
    }

    const client = getSupabaseBrowserClient();
    const { error } = await client
      .from("menu_categories")
      .update({
        name: payload.name,
        description: payload.description,
        ...(payload.sort_order == null ? {} : { sort_order: payload.sort_order }),
      })
      .eq("id", id)
      .eq("restaurant_id", selectedRestaurantId);

    if (error) throw error;

    const { error: itemError } = await client
      .from("menu_items")
      .update({ category: payload.name })
      .eq("restaurant_id", selectedRestaurantId)
      .eq("category_id", id);

    if (itemError) throw itemError;
    await fetch();
  }, [fetch, selectedRestaurantId]);

  const deleteCategory = useCallback(async (id: string): Promise<void> => {
    if (!selectedRestaurantId || !isSupabaseConfigured() || id.startsWith("demo-") || id.startsWith("local-")) {
      return;
    }

    const client = getSupabaseBrowserClient();
    const { error } = await client
      .from("menu_categories")
      .update({ is_active: false })
      .eq("id", id)
      .eq("restaurant_id", selectedRestaurantId);

    if (error) throw error;
    await fetch();
  }, [fetch, selectedRestaurantId]);

  return { categories, loading, refetch: fetch, createCategory, updateCategory, deleteCategory };
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
    setItems((data ?? []) as MenuItemRow[]);
    setLoading(false);
  }, [selectedRestaurantId, categoryId]);

  useEffect(() => {
    void Promise.resolve().then(() => fetch());
  }, [fetch]);

  const createItem = useCallback(async (payload: SaveMenuItemPayload): Promise<MenuItemRow | null> => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      return {
        id: `local-item-${Date.now()}`,
        restaurant_id: "demo-menu",
        category_id: payload.category_id,
        category: payload.category,
        name: payload.name,
        name_fr: null,
        description: payload.description,
        description_fr: null,
        price: payload.price,
        cost_price: null,
        photo_url: payload.photo_url,
        allergens: payload.allergens,
        dietary_flags: payload.dietary_flags,
        calories: null,
        is_available: true,
        is_preorderable: false,
        is_featured: false,
        is_active: true,
        preparation_time_minutes: null,
        spice_level: payload.dietary_flags.includes("Spicy") ? "medium" : null,
        loyalty_points_value: null,
        sort_order: payload.sort_order ?? 0,
      };
    }

    const client = getSupabaseBrowserClient();
    const { data, error } = await client
      .from("menu_items")
      .insert({
        restaurant_id: selectedRestaurantId,
        name: payload.name,
        description: payload.description,
        price: payload.price,
        category_id: payload.category_id,
        category: payload.category,
        photo_url: payload.photo_url,
        dietary_flags: payload.dietary_flags,
        allergens: payload.allergens,
        is_featured: false,
        is_available: true,
        is_active: true,
        is_preorderable: false,
        sort_order: payload.sort_order ?? 0,
      })
      .select("*")
      .single();

    if (error) throw error;
    await fetch();
    return data as MenuItemRow;
  }, [fetch, selectedRestaurantId]);

  const updateItem = useCallback(async (id: string, payload: SaveMenuItemPayload): Promise<void> => {
    if (!selectedRestaurantId || !isSupabaseConfigured() || id.startsWith("demo-") || id.startsWith("local-")) {
      return;
    }

    const client = getSupabaseBrowserClient();
    const { error } = await client
      .from("menu_items")
      .update({
        name: payload.name,
        description: payload.description,
        price: payload.price,
        category_id: payload.category_id,
        category: payload.category,
        photo_url: payload.photo_url,
        dietary_flags: payload.dietary_flags,
        allergens: payload.allergens,
        is_featured: false,
      })
      .eq("id", id);

    if (error) throw error;
    await fetch();
  }, [fetch, selectedRestaurantId]);

  const setItemAvailability = useCallback(async (id: string, isAvailable: boolean): Promise<void> => {
    if (!selectedRestaurantId || !isSupabaseConfigured() || id.startsWith("demo-") || id.startsWith("local-")) {
      return;
    }

    const client = getSupabaseBrowserClient();
    const { error } = await client
      .from("menu_items")
      .update({ is_available: isAvailable })
      .eq("id", id);

    if (error) throw error;
    await fetch();
  }, [fetch, selectedRestaurantId]);

  const deleteItem = useCallback(async (id: string): Promise<void> => {
    if (!selectedRestaurantId || !isSupabaseConfigured() || id.startsWith("demo-") || id.startsWith("local-")) {
      return;
    }

    const client = getSupabaseBrowserClient();
    const { error } = await client
      .from("menu_items")
      .update({ is_active: false })
      .eq("id", id);

    if (error) throw error;
    await fetch();
  }, [fetch, selectedRestaurantId]);

  const uploadMenuItemImage = useCallback(async (file: File): Promise<string> => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      return "No restaurant selected.";
    }

    const image = resolveMenuItemImage(file);
    if (!image) return MENU_IMAGE_SUPPORT_MESSAGE;

    const client = getSupabaseBrowserClient();
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    const path = `${selectedRestaurantId}/menu-items/${crypto.randomUUID()}-${safeName}`;
    const { error } = await client.storage
      .from("event-media")
      .upload(path, file, { cacheControl: "3600", contentType: image.mime, upsert: false });

    if (error) return error.message;

    const { data } = client.storage.from("event-media").getPublicUrl(path);
    return data.publicUrl;
  }, [selectedRestaurantId]);

  return { items, loading, refetch: fetch, createItem, updateItem, setItemAvailability, deleteItem, uploadMenuItemImage };
}
