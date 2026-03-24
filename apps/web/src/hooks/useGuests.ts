import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { MOCK_GUESTS } from "@/lib/mock-data";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type GuestRow = {
  id: string;
  restaurant_id: string;
  user_profile_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  anniversary: string | null;
  tags: string[] | null;
  dietary_restrictions: string[] | null;
  allergies: string[] | null;
  seating_preference: string | null;
  favourite_dishes: string[] | null;
  internal_notes: string | null;
  total_visits: number;
  total_spend: number;
  average_spend_per_visit: number | null;
  no_show_count: number;
  cancellation_count: number;
  is_vip: boolean;
  is_blocked: boolean;
  loyalty_points_balance: number;
  loyalty_tier: string | null;
  last_visit_at: string | null;
  first_visit_at: string | null;
  created_at: string | null;
};

export type GuestFilters = {
  search?: string;
  isVip?: boolean;
  tag?: string;
};

export function useGuests(filters?: GuestFilters) {
  const { selectedRestaurantId } = useRestaurantScope();
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchGuests = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setGuests([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    let query = client
      .from("guests")
      .select("*")
      .eq("restaurant_id", selectedRestaurantId)
      .order("total_visits", { ascending: false })
      .limit(200);

    if (filters?.isVip) query = query.eq("is_vip", true);
    if (filters?.tag) query = query.contains("tags", [filters.tag]);

    const { data, error: qErr } = await query;

    if (qErr) {
      setError(new Error(qErr.message));
      setGuests([]);
    } else {
      let rows = (data ?? []) as GuestRow[];
      if (filters?.search) {
        const s = filters.search.toLowerCase();
        rows = rows.filter(
          (g) =>
            g.full_name?.toLowerCase().includes(s) ||
            g.email?.toLowerCase().includes(s) ||
            g.phone?.includes(s),
        );
      }
      setGuests(rows.length > 0 ? rows : MOCK_GUESTS);
    }
    setLoading(false);
  }, [selectedRestaurantId, filters?.search, filters?.isVip, filters?.tag]);

  useEffect(() => { void fetchGuests(); }, [fetchGuests]);

  return { guests, loading, error, refetch: fetchGuests };
}
