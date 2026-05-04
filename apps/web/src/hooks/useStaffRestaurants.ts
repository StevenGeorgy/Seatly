import { useCallback, useEffect, useMemo, useState } from "react";

import { promiseWithTimeout } from "@/lib/promise-timeout";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

const STAFF_RESTAURANTS_FETCH_TIMEOUT_MS = 45_000;
import type { UserRestaurantRole } from "@/types/auth";

export type RestaurantTheme = {
  primaryColor: string;
  accentColor?: string;
  backgroundColor?: string;
};

export type RestaurantSettings = {
  theme?: RestaurantTheme;
  turnTimeMinutes?: number;
};

export type StaffRestaurantRow = {
  id: string;
  name: string | null;
  slug: string;
  logo_url: string | null;
  cover_photo_url: string | null;
  currency: string;
  timezone: string;
  hours_json: Record<string, unknown> | null;
  settings_json: RestaurantSettings | null;
  has_bar: boolean;
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
      try {
        const client = getSupabaseBrowserClient();
        const query = client
          .from("restaurants")
          .select("id, name, slug, logo_url, cover_photo_url, currency, timezone, hours_json, settings_json, has_bar")
          .in("id", ids);
        const { data, error: qErr } = await promiseWithTimeout(
          Promise.resolve(query) as Promise<{
            data: StaffRestaurantRow[] | null;
            error: { message: string } | null;
          }>,
          STAFF_RESTAURANTS_FETCH_TIMEOUT_MS,
          "Restaurants list",
        );

        if (cancelled) return;

        if (qErr) {
          setError(new Error(qErr.message));
          setRestaurants([]);
          setLoading(false);
          return;
        }

        setRestaurants((data ?? []) as StaffRestaurantRow[]);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setRestaurants([]);
        setLoading(false);
      }
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
