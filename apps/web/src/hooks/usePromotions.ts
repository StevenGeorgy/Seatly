import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import {
  EVENT_MEDIA_SUPPORT_MESSAGE,
  resolveEventMedia,
  type EventMediaUpload,
} from "@/hooks/useEvents";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { assertImageSizeOk } from "@/lib/images/assertImageSize";

export type PromoType = "bogo" | "percentage" | "fixed" | "free_item";
export type AppliesTo = "all" | "dine_in";
export type BadgeColor = "amber" | "green" | "red" | "blue";
export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

export type PromotionRow = {
  id: string;
  restaurant_id: string;
  title: string;
  description: string | null;
  promo_type: PromoType;
  discount_value: number | null;
  discount_unit: "percent" | "dollar" | null;
  applies_to: AppliesTo;
  min_order_amount: number | null;
  starts_at: string;
  ends_at: string | null;
  start_time_of_day: string | null;
  end_time_of_day: string | null;
  is_active: boolean;
  promo_code: string | null;
  max_uses: number | null;
  current_uses: number;
  badge_color: BadgeColor;
  bogo_item_ids: string[];
  free_item_id: string | null;
  free_item_name: string | null;
  eligible_item_ids: string[];
  buy_quantity: number;
  get_quantity: number;
  cover_image_url: string | null;
  media_url: string | null;
  media_type: "image" | "pdf" | null;
  media_name: string | null;
  is_private: boolean;
  is_recurring: boolean;
  recurrence_frequency: RecurrenceFrequency | null;
  recurrence_interval: number;
  recurrence_days: number[];
  recurrence_end_at: string | null;
  created_at: string;
};

export type PromotionWithRestaurant = PromotionRow & {
  restaurants: {
    id: string;
    name: string;
    slug: string;
    cuisine_type: string | null;
    avg_rating: number | null;
    cover_photo_url: string | null;
    city: string | null;
    price_range: number | null;
    lat: number | null;
    lng: number | null;
  };
};

export type CreatePromotionPayload = Omit<
  PromotionRow,
  "id" | "created_at" | "current_uses" | "restaurant_id"
>;

/** Used in the customer-facing /deals page — fetches all active promotions across all restaurants */
export function useAllActivePromotions() {
  const [promotions, setPromotions] = useState<PromotionWithRestaurant[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    if (!isSupabaseConfigured()) {
      setPromotions([]);
      setLoading(false);
      return;
    }

    const client = getSupabaseBrowserClient();
    const { data } = await client
      .from("promotions")
      .select(`
        *,
        restaurants (
          id,
          name,
          slug,
          cuisine_type,
          avg_rating,
          cover_photo_url,
          city,
          price_range,
          lat,
          lng
        )
      `)
      .eq("is_active", true)
      .eq("is_private", false)
      .or(`and(is_recurring.eq.false,or(ends_at.is.null,ends_at.gt.${new Date().toISOString()})),and(is_recurring.eq.true,or(recurrence_end_at.is.null,recurrence_end_at.gt.${new Date().toISOString()}))`)
      .order("created_at", { ascending: false });

    setPromotions((data ?? []) as unknown as PromotionWithRestaurant[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(fetch);
  }, [fetch]);

  return { promotions, loading, refetch: fetch };
}

/** Used in the restaurant dashboard — fetches promotions for the selected restaurant */
export function usePromotions() {
  const { selectedRestaurantId } = useRestaurantScope();
  const [promotions, setPromotions] = useState<PromotionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetch = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setPromotions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const client = getSupabaseBrowserClient();
    const { data } = await client
      .from("promotions")
      .select("*")
      .eq("restaurant_id", selectedRestaurantId)
      .order("created_at", { ascending: false });

    setPromotions((data ?? []) as PromotionRow[]);
    setLoading(false);
  }, [selectedRestaurantId]);

  useEffect(() => {
    void Promise.resolve().then(fetch);
  }, [fetch]);

  /** Returns null on success, or an error string on failure. */
  const createPromotion = useCallback(async (payload: CreatePromotionPayload): Promise<string | null> => {
    if (!selectedRestaurantId) return "No restaurant selected.";
    if (!isSupabaseConfigured()) return "Supabase not configured.";
    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client
      .from("promotions")
      .insert({ ...payload, restaurant_id: selectedRestaurantId });
    setSaving(false);
    if (error) return error.message;
    await fetch();
    return null;
  }, [selectedRestaurantId, fetch]);

  /** Returns null on success, or an error string on failure. */
  const updatePromotion = useCallback(async (id: string, payload: Partial<CreatePromotionPayload>): Promise<string | null> => {
    if (!isSupabaseConfigured()) return "Supabase not configured.";
    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client
      .from("promotions")
      .update(payload)
      .eq("id", id);
    setSaving(false);
    if (error) return error.message;
    await fetch();
    return null;
  }, [fetch]);

  const uploadPromotionMedia = useCallback(async (file: File): Promise<EventMediaUpload | string> => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) return "No restaurant selected.";

    const media = resolveEventMedia(file);
    if (!media) return EVENT_MEDIA_SUPPORT_MESSAGE;
    if (!assertImageSizeOk(file)) return "Image too large.";

    const client = getSupabaseBrowserClient();
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    const path = `${selectedRestaurantId}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await client.storage
      .from("event-media")
      .upload(path, file, { cacheControl: "3600", contentType: media.mime, upsert: false });

    if (error) return error.message;

    const { data } = client.storage.from("event-media").getPublicUrl(path);
    return {
      url: data.publicUrl,
      type: media.kind,
      name: file.name,
    };
  }, [selectedRestaurantId]);

  const deletePromotion = useCallback(async (id: string) => {
    if (!isSupabaseConfigured()) return false;
    const client = getSupabaseBrowserClient();
    const { error } = await client
      .from("promotions")
      .delete()
      .eq("id", id);
    if (error) return false;
    await fetch();
    return true;
  }, [fetch]);

  return { promotions, loading, saving, refetch: fetch, createPromotion, updatePromotion, deletePromotion, uploadPromotionMedia };
}

export async function fetchPromotionById(id: string): Promise<PromotionWithRestaurant | null> {
  if (!isSupabaseConfigured()) return null;

  const client = getSupabaseBrowserClient();
  const { data } = await client
    .from("promotions")
    .select(`
      *,
      restaurants (
        id,
        name,
        slug,
        cuisine_type,
        avg_rating,
        cover_photo_url,
        city,
        price_range,
        lat,
        lng
      )
    `)
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  return (data as unknown as PromotionWithRestaurant | null) ?? null;
}

export function getPromotionLabel(promo: Pick<PromotionRow, "promo_type" | "discount_value" | "discount_unit">): string {
  switch (promo.promo_type) {
    case "bogo": return "BOGO";
    case "percentage": return promo.discount_value != null ? `${promo.discount_value}% OFF` : "% OFF";
    case "fixed": return promo.discount_value != null ? `$${promo.discount_value} OFF` : "$ OFF";
    case "free_item": return "FREE ITEM";
    default: return "DEAL";
  }
}

export function getPromoTypeBadgeClasses(color: BadgeColor): string {
  switch (color) {
    case "green": return "bg-green-500/20 text-green-400 border-green-500/40";
    case "red": return "bg-red-500/20 text-red-400 border-red-500/40";
    case "blue": return "bg-blue-500/20 text-blue-400 border-blue-500/40";
    default: return "bg-amber-500/20 text-amber-400 border-amber-500/40";
  }
}
