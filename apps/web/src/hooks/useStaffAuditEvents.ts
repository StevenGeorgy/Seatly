import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type StaffAuditEventRow = {
  id: string;
  restaurant_id: string;
  actor_profile_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_json: Record<string, unknown>;
  after_json: Record<string, unknown>;
  created_at: string;
  actor_profile?: {
    full_name: string | null;
    email: string | null;
  } | null;
};

export function useStaffAuditEvents(limit = 50) {
  const { selectedRestaurantId } = useRestaurantScope();
  const [events, setEvents] = useState<StaffAuditEventRow[]>([]);
  const [loading, setLoading] = useState(false);
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
    const { data, error: queryError } = await client
      .from("staff_audit_events")
      .select("id, restaurant_id, actor_profile_id, actor_role, action, entity_type, entity_id, before_json, after_json, created_at, actor_profile:user_profiles!staff_audit_events_actor_profile_id_fkey(full_name, email)")
      .eq("restaurant_id", selectedRestaurantId)
      .in("action", [
        "reservation.create",
        "reservation.host_create",
        "reservation.floor_create",
        "reservation.floor_walkin",
        "reservation.seat",
        "reservation.cancelled",
        "reservation.cancel",
        "reservation.no_show",
        "reservation.completed",
        "table.status",
      ])
      .order("created_at", { ascending: false })
      .limit(limit);

    if (queryError) {
      setError(new Error(queryError.message));
      setEvents([]);
    } else {
      setEvents((data ?? []) as unknown as StaffAuditEventRow[]);
    }
    setLoading(false);
  }, [limit, selectedRestaurantId]);

  useEffect(() => {
    void Promise.resolve().then(fetchEvents);
  }, [fetchEvents]);

  return { events, loading, error, refetch: fetchEvents };
}
