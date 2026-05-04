import { useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type RestaurantPreviewStats = {
  bookedToday: number;
};

const EMPTY_STATS: RestaurantPreviewStats = {
  bookedToday: 0,
};

function todayRange(): { from: string; to: string } {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setHours(23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function useRestaurantPreviewStats(restaurantId: string | null | undefined) {
  const [stats, setStats] = useState<RestaurantPreviewStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!restaurantId || !isSupabaseConfigured()) {
      setStats(EMPTY_STATS);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const { from, to } = todayRange();

    void (async () => {
      setLoading(true);
      const client = getSupabaseBrowserClient();
      const { count } = await client
        .from("reservations")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId)
        .gte("reserved_at", from)
        .lte("reserved_at", to);

      if (cancelled) return;
      setStats({ bookedToday: count ?? 0 });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  return { stats, loading };
}
