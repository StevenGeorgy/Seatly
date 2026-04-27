import { useState, useCallback } from "react";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

export interface AvailabilitySlot {
  shift_id: string;
  shift_name: string;
  date_time: string;
  display_time: string;
}

interface AvailabilityResult {
  slots: AvailabilitySlot[];
  error: string | null;
}

export function useAvailability() {
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSlots = useCallback(
    async (restaurantId: string, date: string, partySize: number): Promise<AvailabilityResult> => {
      setLoading(true);
      setError(null);
      setSlots([]);

      try {
        const url = `${getSupabaseProjectUrl()}/functions/v1/get-availability?restaurant_id=${restaurantId}&date=${date}&party_size=${partySize}`;

        let token: string | null = null;
        if (isSupabaseConfigured()) {
          const client = getSupabaseBrowserClient();
          const { data } = await client.auth.getSession();
          token = data.session?.access_token ?? null;
        }

        const res = await fetch(url, {
          headers: {
            apikey: getSupabaseAnonKey(),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

        const json = await res.json() as { slots?: AvailabilitySlot[]; error?: string };
        if (json.error) {
          setError(json.error);
          return { slots: [], error: json.error };
        } else {
          const slots = json.slots ?? [];
          setSlots(slots);
          return { slots, error: null };
        }
      } catch (err) {
        const message = String(err);
        setError(message);
        return { slots: [], error: message };
      } finally {
        setLoading(false);
      }

      return { slots: [], error: null };
    },
    [],
  );

  const clearSlots = useCallback(() => {
    setSlots([]);
    setError(null);
  }, []);

  return { slots, loading, error, fetchSlots, clearSlots };
}
