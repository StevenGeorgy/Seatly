import { useState, useCallback } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL || "";

export interface AvailabilitySlot {
  shift_id: string;
  shift_name: string;
  date_time: string;
  display_time: string;
}

export function useAvailability() {
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSlots = useCallback(
    async (restaurantId: string, date: string, partySize: number) => {
      setLoading(true);
      setError(null);
      setSlots([]);

      try {
        const url = `${SUPABASE_URL}/functions/v1/get-availability?restaurant_id=${restaurantId}&date=${date}&party_size=${partySize}`;

        let token: string | null = null;
        if (isSupabaseConfigured()) {
          const client = getSupabaseBrowserClient();
          const { data } = await client.auth.getSession();
          token = data.session?.access_token ?? null;
        }

        const res = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        const json = await res.json() as { slots?: AvailabilitySlot[]; error?: string };
        if (json.error) {
          setError(json.error);
        } else {
          setSlots(json.slots ?? []);
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const clearSlots = useCallback(() => {
    setSlots([]);
    setError(null);
  }, []);

  return { slots, loading, error, fetchSlots, clearSlots };
}
