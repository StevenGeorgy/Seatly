import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
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
  noise_preference?: string | null;
  favourite_dishes: string[] | null;
  favourite_drinks?: string[] | null;
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
  email_opt_in?: boolean | null;
  sms_opt_in?: boolean | null;
  acquisition_source?: string | null;
  last_contacted_at?: string | null;
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
  const filterSearch = filters?.search ?? "";
  const filterIsVip = filters?.isVip ?? false;
  const filterTag = filters?.tag ?? "";
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

    const { data, error: qErr } = await client.rpc("crm_guest_rows", {
      p_restaurant_id: selectedRestaurantId,
    });

    if (qErr) {
      setError(new Error(qErr.message));
      setGuests([]);
    } else {
      let rows = (data ?? []) as GuestRow[];
      if (filterIsVip) {
        rows = rows.filter((guest) => guest.is_vip);
      }
      if (filterTag) {
        rows = rows.filter((guest) => guest.tags?.includes(filterTag));
      }
      if (filterSearch) {
        const s = filterSearch.toLowerCase();
        rows = rows.filter(
          (g) =>
            g.full_name?.toLowerCase().includes(s) ||
            g.email?.toLowerCase().includes(s) ||
            g.phone?.includes(s) ||
            g.tags?.some((tag) => tag.toLowerCase().includes(s)) ||
            g.allergies?.some((allergy) => allergy.toLowerCase().includes(s)) ||
            g.dietary_restrictions?.some((restriction) => restriction.toLowerCase().includes(s)),
        );
      }
      setGuests(rows);
    }
    setLoading(false);
  }, [selectedRestaurantId, filterSearch, filterIsVip, filterTag]);

  useEffect(() => {
    void Promise.resolve().then(fetchGuests);
  }, [fetchGuests]);

  return { guests, loading, error, refetch: fetchGuests };
}
