import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { MOCK_WAITLIST } from "@/lib/mock-data";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type WaitlistRow = {
  id: string;
  restaurant_id: string;
  guest_name: string | null;
  phone: string | null;
  user_profile_id: string | null;
  party_size: number;
  position: number;
  status: string;
  estimated_wait_minutes: number | null;
  contact_method: string | null;
  remote_join: boolean | null;
  notified_at: string | null;
  response: string | null;
  created_at: string | null;
};

export function useWaitlist() {
  const { selectedRestaurantId } = useRestaurantScope();
  const [entries, setEntries] = useState<WaitlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchWaitlist = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setEntries([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    const { data, error: qErr } = await client
      .from("waitlist")
      .select("*")
      .eq("restaurant_id", selectedRestaurantId)
      .eq("status", "waiting")
      .order("position", { ascending: true });

    if (qErr) {
      setError(new Error(qErr.message));
      setEntries([]);
    } else {
      const rows = (data ?? []) as WaitlistRow[];
      setEntries(rows.length > 0 ? rows : MOCK_WAITLIST);
    }
    setLoading(false);
  }, [selectedRestaurantId]);

  useEffect(() => { void fetchWaitlist(); }, [fetchWaitlist]);

  useEffect(() => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) return;

    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`waitlist:${selectedRestaurantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "waitlist", filter: `restaurant_id=eq.${selectedRestaurantId}` },
        () => { void fetchWaitlist(); },
      )
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [selectedRestaurantId, fetchWaitlist]);

  return { entries, loading, error, refetch: fetchWaitlist };
}
