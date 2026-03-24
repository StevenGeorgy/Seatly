import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { MOCK_EVENTS } from "@/lib/mock-data";
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
  created_at: string | null;
};

export function useEvents() {
  const { selectedRestaurantId } = useRestaurantScope();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
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
      const rows = (data ?? []) as EventRow[];
      setEvents(rows.length > 0 ? rows : MOCK_EVENTS);
    }
    setLoading(false);
  }, [selectedRestaurantId]);

  useEffect(() => { void fetchEvents(); }, [fetchEvents]);

  return { events, loading, error, refetch: fetchEvents };
}
