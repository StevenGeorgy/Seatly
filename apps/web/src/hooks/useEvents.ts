import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type EventRow = {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  price_per_person: number | null;
  capacity: number | null;
  tickets_sold: number;
  is_recurring: boolean;
  cover_image_url: string | null;
  min_age: number | null;
  dress_code: string | null;
  is_private: boolean;
  theme: string | null;
  created_at: string | null;
};

export type CreateEventPayload = {
  name: string;
  description?: string | null;
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  price_per_person?: number | null;
  capacity?: number | null;
  theme?: string | null;
  cover_image_url?: string | null;
};

export function useEvents() {
  const { selectedRestaurantId } = useRestaurantScope();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchEvents = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setEvents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    const { data, error: qErr } = await client
      .from("events")
      .select("*")
      .eq("restaurant_id", selectedRestaurantId)
      .order("date", { ascending: true });

    if (qErr) {
      setError(new Error(qErr.message));
      setEvents([]);
    } else {
      setEvents((data ?? []) as EventRow[]);
    }
    setLoading(false);
  }, [selectedRestaurantId]);

  useEffect(() => { void fetchEvents(); }, [fetchEvents]);

  const createEvent = useCallback(async (payload: CreateEventPayload): Promise<string | null> => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) return "No restaurant selected.";
    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client
      .from("events")
      .insert({ ...payload, restaurant_id: selectedRestaurantId, is_active: true, tickets_sold: 0, is_recurring: false, is_private: false });
    setSaving(false);
    if (error) return error.message;
    await fetchEvents();
    return null;
  }, [selectedRestaurantId, fetchEvents]);

  const updateEvent = useCallback(async (id: string, payload: Partial<CreateEventPayload>): Promise<string | null> => {
    if (!isSupabaseConfigured()) return "Supabase not configured.";
    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client.from("events").update(payload).eq("id", id);
    setSaving(false);
    if (error) return error.message;
    await fetchEvents();
    return null;
  }, [fetchEvents]);

  const deleteEvent = useCallback(async (id: string) => {
    if (!isSupabaseConfigured()) return false;
    const client = getSupabaseBrowserClient();
    const { error } = await client.from("events").delete().eq("id", id);
    if (error) return false;
    await fetchEvents();
    return true;
  }, [fetchEvents]);

  return { events, loading, saving, error, refetch: fetchEvents, createEvent, updateEvent, deleteEvent };
}
