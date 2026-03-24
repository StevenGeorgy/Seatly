import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { MOCK_STAFF } from "@/lib/mock-data";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type StaffMemberRow = {
  id: string;
  user_id: string;
  restaurant_id: string;
  role: string;
  is_primary: boolean;
  hourly_rate: number | null;
  employment_type: string | null;
  created_at: string | null;
  user_profiles?: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
    avatar_url: string | null;
  } | null;
};

export function useStaffRoster() {
  const { selectedRestaurantId } = useRestaurantScope();
  const [members, setMembers] = useState<StaffMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchRoster = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setMembers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    const { data, error: qErr } = await client
      .from("user_restaurant_roles")
      .select("*, user_profiles(full_name, email, phone, avatar_url)")
      .eq("restaurant_id", selectedRestaurantId)
      .order("created_at");

    if (qErr) {
      setError(new Error(qErr.message));
      setMembers([]);
    } else {
      const rows = (data ?? []) as StaffMemberRow[];
      setMembers(rows.length > 0 ? rows : MOCK_STAFF);
    }
    setLoading(false);
  }, [selectedRestaurantId]);

  useEffect(() => { void fetchRoster(); }, [fetchRoster]);

  return { members, loading, error, refetch: fetchRoster };
}
