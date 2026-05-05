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
  table_ids?: string[];
  duration_minutes?: number;
  floor_capacity?: number;
}

interface AvailabilityResult {
  slots: AvailabilitySlot[];
  floorCapacity: number | null;
  error: string | null;
}

export async function fetchAvailabilitySlots(
  restaurantId: string,
  date: string,
  partySize: number,
): Promise<AvailabilityResult> {
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

  const json = await res.json() as { slots?: AvailabilitySlot[]; floor_capacity?: number; error?: string };
  const nextFloorCapacity =
    typeof json.floor_capacity === "number"
      ? json.floor_capacity
      : json.slots?.find((slot) => typeof slot.floor_capacity === "number")?.floor_capacity ?? null;

  if (json.error) {
    return { slots: [], floorCapacity: nextFloorCapacity, error: json.error };
  }

  return { slots: json.slots ?? [], floorCapacity: nextFloorCapacity, error: null };
}

export function useAvailability() {
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [floorCapacity, setFloorCapacity] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSlots = useCallback(
    async (restaurantId: string, date: string, partySize: number): Promise<AvailabilityResult> => {
      setLoading(true);
      setError(null);
      setSlots([]);

      try {
        const result = await fetchAvailabilitySlots(restaurantId, date, partySize);
        setFloorCapacity(result.floorCapacity);
        if (result.error) {
          setError(result.error);
          return result;
        } else {
          setSlots(result.slots);
          return result;
        }
      } catch (err) {
        const message = String(err);
        setError(message);
        setFloorCapacity(null);
        return { slots: [], floorCapacity: null, error: message };
      } finally {
        setLoading(false);
      }

      return { slots: [], floorCapacity: null, error: null };
    },
    [],
  );

  const clearSlots = useCallback(() => {
    setSlots([]);
    setFloorCapacity(null);
    setError(null);
  }, []);

  return { slots, floorCapacity, loading, error, fetchSlots, clearSlots };
}
