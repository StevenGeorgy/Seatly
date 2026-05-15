import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { assertImageSizeOk } from "@/lib/images/assertImageSize";

export type EventRow = {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  price_per_person: number | null;
  capacity: number | null;
  tickets_sold: number;
  is_active: boolean;
  is_recurring: boolean;
  cover_image_url: string | null;
  media_url: string | null;
  media_type: "image" | "pdf" | null;
  media_name: string | null;
  min_age: number | null;
  dress_code: string | null;
  is_private: boolean;
  theme: string | null;
  fixed_arrival_time: boolean;
  created_at: string | null;
};

export type EventWithRestaurant = EventRow & {
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

export type CreateEventPayload = {
  name: string;
  description?: string | null;
  date: string;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  price_per_person?: number | null;
  capacity?: number | null;
  theme?: string | null;
  cover_image_url?: string | null;
  media_url?: string | null;
  media_type?: "image" | "pdf" | null;
  media_name?: string | null;
  is_active?: boolean;
  is_private?: boolean;
  fixed_arrival_time?: boolean;
};

export type EventMediaUpload = {
  url: string;
  type: "image" | "pdf";
  name: string;
};

type EventMediaKind = EventMediaUpload["type"];

const SUPPORTED_EVENT_MEDIA_TYPES: Array<{
  kind: EventMediaKind;
  mime: string;
  extensions: string[];
}> = [
  { kind: "image", mime: "image/jpeg", extensions: ["jpg", "jpeg"] },
  { kind: "image", mime: "image/png", extensions: ["png"] },
  { kind: "image", mime: "image/webp", extensions: ["webp"] },
  { kind: "image", mime: "image/gif", extensions: ["gif"] },
  { kind: "image", mime: "image/avif", extensions: ["avif"] },
  { kind: "image", mime: "image/heic", extensions: ["heic"] },
  { kind: "image", mime: "image/heif", extensions: ["heif"] },
  { kind: "pdf", mime: "application/pdf", extensions: ["pdf"] },
];

export const EVENT_MEDIA_ACCEPT = SUPPORTED_EVENT_MEDIA_TYPES
  .flatMap((type) => [type.mime, ...type.extensions.map((extension) => `.${extension}`)])
  .join(",");

export const EVENT_MEDIA_SUPPORT_MESSAGE = "Upload a JPG, PNG, WebP, GIF, AVIF, HEIC, HEIF, or PDF file.";

export function resolveEventMedia(file: File): { kind: EventMediaKind; mime: string } | null {
  const mime = file.type.toLowerCase();
  const byMime = SUPPORTED_EVENT_MEDIA_TYPES.find((type) => type.mime === mime);
  if (byMime) return { kind: byMime.kind, mime: byMime.mime };

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension) return null;

  const byExtension = SUPPORTED_EVENT_MEDIA_TYPES.find((type) => type.extensions.includes(extension));
  return byExtension ? { kind: byExtension.kind, mime: byExtension.mime } : null;
}

async function fetchAllActiveEvents(): Promise<EventWithRestaurant[]> {
  if (!isSupabaseConfigured()) return [];
  const today = new Date().toISOString().slice(0, 10);
  const client = getSupabaseBrowserClient();
  const { data } = await client
    .from("events")
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
    .or(`end_date.gte.${today},and(end_date.is.null,date.gte.${today})`)
    .order("date", { ascending: true });

  return (data ?? []) as unknown as EventWithRestaurant[];
}

const EMPTY_PUBLIC_EVENTS: EventWithRestaurant[] = [];

export function useAllActiveEvents(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const query = useQuery({
    queryKey: ["all-active-events"],
    queryFn: fetchAllActiveEvents,
    enabled,
  });
  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);
  return {
    events: query.data ?? EMPTY_PUBLIC_EVENTS,
    loading: enabled ? query.isPending : false,
    refetch,
  };
}

const EMPTY_STAFF_EVENTS: EventRow[] = [];

async function fetchEventsByRestaurant(restaurantId: string): Promise<EventRow[]> {
  if (!isSupabaseConfigured()) return [];
  const client = getSupabaseBrowserClient();
  const { data, error: qErr } = await client
    .from("events")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .order("date", { ascending: true });
  if (qErr) throw new Error(qErr.message);
  return (data ?? []) as EventRow[];
}

export function useEvents() {
  const { selectedRestaurantId } = useRestaurantScope();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const query = useQuery({
    queryKey: ["events-by-restaurant", selectedRestaurantId ?? null],
    queryFn: () => fetchEventsByRestaurant(selectedRestaurantId as string),
    enabled: Boolean(selectedRestaurantId),
  });

  const events = query.data ?? EMPTY_STAFF_EVENTS;
  const loading = selectedRestaurantId ? query.isPending : false;
  const error = (query.error as Error | null) ?? null;

  const fetchEvents = useCallback(async () => {
    await query.refetch();
  }, [query]);

  const invalidate = useCallback(() => {
    return queryClient.invalidateQueries({ queryKey: ["events-by-restaurant", selectedRestaurantId ?? null] });
  }, [queryClient, selectedRestaurantId]);

  const createEvent = useCallback(async (payload: CreateEventPayload): Promise<string | null> => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) return "No restaurant selected.";
    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client
      .from("events")
      .insert({
        ...payload,
        restaurant_id: selectedRestaurantId,
        is_active: payload.is_active ?? true,
        tickets_sold: 0,
        is_recurring: false,
        is_private: payload.is_private ?? false,
      });
    setSaving(false);
    if (error) return error.message;
    await invalidate();
    return null;
  }, [selectedRestaurantId, invalidate]);

  const updateEvent = useCallback(async (id: string, payload: Partial<CreateEventPayload>): Promise<string | null> => {
    if (!isSupabaseConfigured()) return "Supabase not configured.";
    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client.from("events").update(payload).eq("id", id);
    setSaving(false);
    if (error) return error.message;
    await invalidate();
    return null;
  }, [invalidate]);

  const uploadEventMedia = useCallback(async (file: File): Promise<EventMediaUpload | string> => {
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

  const deleteEvent = useCallback(async (id: string) => {
    if (!isSupabaseConfigured()) return false;
    const client = getSupabaseBrowserClient();
    const { error } = await client.from("events").delete().eq("id", id);
    if (error) return false;
    await invalidate();
    return true;
  }, [invalidate]);

  return { events, loading, saving, error, refetch: fetchEvents, createEvent, updateEvent, deleteEvent, uploadEventMedia };
}

export async function fetchEventById(id: string): Promise<EventWithRestaurant | null> {
  if (!isSupabaseConfigured()) return null;

  const client = getSupabaseBrowserClient();
  const { data } = await client
    .from("events")
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

  return (data as unknown as EventWithRestaurant | null) ?? null;
}
