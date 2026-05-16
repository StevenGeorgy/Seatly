import { useCallback, useEffect, useMemo, useState } from "react";

import { toUserFacingError } from "@/lib/errors";
import { promiseWithTimeout } from "@/lib/promise-timeout";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { RestaurantDietaryTag } from "@/lib/restaurant-dietary-tags";

const STAFF_RESTAURANTS_FETCH_TIMEOUT_MS = 45_000;
import type { UserRestaurantRole } from "@/types/auth";

export type RestaurantTheme = {
  primaryColor: string;
  accentColor?: string;
  backgroundColor?: string;
};

export type RestaurantBusinessProfile = {
  legalName?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  facebookUrl?: string | null;
};

export type RestaurantDepositTier = {
  min_party_size: number;
  amount_per_person_cents: number;
};

export type RestaurantSettings = {
  theme?: RestaurantTheme;
  turnTimeMinutes?: number;
  dietaryTags?: RestaurantDietaryTag[];
  businessProfile?: RestaurantBusinessProfile;
};

export type StaffRestaurantRow = {
  id: string;
  name: string | null;
  slug: string;
  logo_url: string | null;
  cover_photo_url: string | null;
  email: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  business_type: string | null;
  currency: string;
  timezone: string;
  hours_json: Record<string, unknown> | null;
  settings_json: RestaurantSettings | null;
  has_bar: boolean;
  accepts_walkins: boolean | null;
  deposit_tiers: RestaurantDepositTier[] | null;
  is_published: boolean | null;
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
    let cancelled = false;
    void (async () => {
      const ids = idKey ? idKey.split(",") : [];
      if (ids.length === 0) {
        if (cancelled) return;
        setRestaurants([]);
        setError(null);
        setLoading(false);
        return;
      }

      if (!isSupabaseConfigured()) {
        if (cancelled) return;
        setRestaurants([]);
        setError(new Error("Supabase env vars are not set."));
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const client = getSupabaseBrowserClient();
        const query = client
          .from("restaurants")
          .select("id, name, slug, logo_url, cover_photo_url, email, city, province, country, lat, lng, business_type, currency, timezone, hours_json, settings_json, has_bar, accepts_walkins, deposit_tiers, is_published")
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
          const friendly = toUserFacingError(qErr, "Couldn't load your restaurants.");
          setError(new Error(friendly.message));
          console.error("[useStaffRestaurants.fetch]", friendly.code, friendly.technical ?? qErr);
          setRestaurants([]);
          setLoading(false);
          return;
        }

        setRestaurants((data ?? []) as StaffRestaurantRow[]);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        const friendly = toUserFacingError(e, "Couldn't load your restaurants.");
        setError(new Error(friendly.message));
        console.error("[useStaffRestaurants.catch]", friendly.code, friendly.technical ?? e);
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
