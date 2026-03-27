import { useCallback, useEffect, useMemo, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { UserRestaurantRole } from "@/types/auth";

export type StaffRestaurantRow = {
  id: string;
  name: string | null;
  slug: string;
  currency: string;
  timezone: string;
};

/**
 * Restaurants the user has a staff role for (Bible: multi-location switcher).
 */
export function useStaffRestaurants(restaurantRoles: UserRestaurantRole[]) {
  const idKey = useMemo(() => {
    const ids = [...new Set(restaurantRoles.map((r) => r.restaurant_id))];
    return ids.sort().join(",");
  }, [restaurantRoles]);

  const [restaurants, setRestaurants] = useState<StaffRestaurantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const ids = idKey ? idKey.split(",") : [];
    if (ids.length === 0) {
      setRestaurants([]);
      setError(null);
      setLoading(false);
      return;
    }

    if (!isSupabaseConfigured()) {
      setRestaurants([]);
      setError(new Error("Supabase env vars are not set."));
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      const client = getSupabaseBrowserClient();
      const { data, error: qErr } = await client
        .from("restaurants")
        .select("id, name, slug, currency, timezone")
        .in("id", ids);

      if (cancelled) return;

      if (qErr) {
        setError(new Error(qErr.message));
        setRestaurants([]);
        setLoading(false);
        return;
      }

      setRestaurants((data ?? []) as StaffRestaurantRow[]);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [idKey, reloadKey]);

  const refreshRestaurants = useCallback(() => {
    setReloadKey((prev) => prev + 1);
  }, []);

  return { restaurants, loading, error, refreshRestaurants };
}
