import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useUser } from "@/hooks/useUser";

export type AvailabilityAlertRow = {
  id: string;
  user_id: string;
  restaurant_id: string | null;
  event_id: string | null;
  date: string | null;
  party_size: number;
  preferred_time: string | null;
  window_minutes: number;
  status: "active" | "fulfilled" | "cancelled" | "expired";
  created_at: string;
  expires_at: string | null;
  fulfilled_at: string | null;
  fulfilled_notification_id: string | null;
};

export type AvailabilityAlertWithJoins = AvailabilityAlertRow & {
  restaurant: { id: string; name: string; slug: string } | null;
  event: { id: string; name: string; date: string } | null;
};

const EMPTY: AvailabilityAlertWithJoins[] = [];

async function fetchAlerts(userId: string): Promise<AvailabilityAlertWithJoins[]> {
  if (!isSupabaseConfigured()) return [];
  const client = getSupabaseBrowserClient();
  const { data, error } = await client
    .from("availability_alerts")
    .select(
      "id, user_id, restaurant_id, event_id, date, party_size, preferred_time, window_minutes, status, created_at, expires_at, fulfilled_at, fulfilled_notification_id, restaurant:restaurants(id, name, slug), event:events(id, name, date)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  type Raw = Omit<AvailabilityAlertWithJoins, "restaurant" | "event"> & {
    restaurant: AvailabilityAlertWithJoins["restaurant"] | NonNullable<AvailabilityAlertWithJoins["restaurant"]>[];
    event: AvailabilityAlertWithJoins["event"] | NonNullable<AvailabilityAlertWithJoins["event"]>[];
  };
  return ((data ?? []) as Raw[]).map((row) => ({
    ...row,
    restaurant: Array.isArray(row.restaurant) ? row.restaurant[0] ?? null : row.restaurant,
    event: Array.isArray(row.event) ? row.event[0] ?? null : row.event,
  }));
}

export function useAvailabilityAlerts() {
  const { profile } = useUser();
  const queryClient = useQueryClient();
  const userId = profile?.id;

  const queryKey = ["availability_alerts", userId ?? null] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchAlerts(userId as string),
    enabled: Boolean(userId),
  });

  const alerts = query.data ?? EMPTY;
  const loading = userId ? query.isPending : false;
  const error = (query.error as Error | null) ?? null;

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  // Realtime: bell badge + "My alerts" tab update live when the match RPC
  // flips a row to fulfilled, or when the user cancels from another tab.
  useEffect(() => {
    if (!userId || !isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`availability_alerts:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "availability_alerts", filter: `user_id=eq.${userId}` },
        () => { void queryClient.invalidateQueries({ queryKey: ["availability_alerts", userId] }); },
      )
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [userId, queryClient]);

  const activeAlerts = alerts.filter((a) => a.status === "active");

  // Cancel an alert. Optimistically marks it cancelled in the cache so the
  // UI updates without waiting for the round-trip.
  const cancel = useCallback(async (id: string): Promise<boolean> => {
    if (!isSupabaseConfigured()) return false;
    const client = getSupabaseBrowserClient();
    const { data, error: rpcErr } = await client.rpc("cancel_availability_alert", { p_id: id });
    if (rpcErr) throw new Error(rpcErr.message);
    queryClient.setQueryData<AvailabilityAlertWithJoins[]>(["availability_alerts", userId ?? null], (prev) =>
      (prev ?? []).map((a) => (a.id === id ? { ...a, status: "cancelled" as const } : a)),
    );
    return Boolean(data);
  }, [queryClient, userId]);

  return { alerts, activeAlerts, loading, error, refetch, cancel };
}
