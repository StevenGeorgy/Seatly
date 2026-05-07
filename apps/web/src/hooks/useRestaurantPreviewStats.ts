import { useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type RestaurantPreviewStats = {
  bookedToday: number;
  avgRating: number | null;
  totalReviews: number;
};

const EMPTY_STATS: RestaurantPreviewStats = {
  bookedToday: 0,
  avgRating: null,
  totalReviews: 0,
};

type ReviewSummaryRow = {
  restaurant_id?: string | null;
  avg_rating?: number | string | null;
  total_reviews?: number | null;
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
      void Promise.resolve().then(() => {
        setStats(EMPTY_STATS);
        setLoading(false);
      });
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
        .gte("created_at", from)
        .lte("created_at", to);

      const { data: reviewRows } = await client.rpc("restaurant_review_summaries", {
        p_restaurant_ids: [restaurantId],
      });
      const review = ((reviewRows ?? []) as ReviewSummaryRow[])[0];

      if (cancelled) return;
      setStats({
        bookedToday: count ?? 0,
        avgRating: review?.avg_rating == null ? null : Number(review.avg_rating),
        totalReviews: review?.total_reviews ?? 0,
      });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  return { stats, loading };
}

export function useRestaurantPreviewStatsByRestaurantIds(restaurantIds: string[]) {
  const [statsByRestaurantId, setStatsByRestaurantId] = useState<Record<string, RestaurantPreviewStats>>({});
  const [loading, setLoading] = useState(true);
  const restaurantKey = restaurantIds.filter(Boolean).sort().join("|");

  useEffect(() => {
    const ids = restaurantKey ? restaurantKey.split("|") : [];
    if (ids.length === 0 || !isSupabaseConfigured()) {
      void Promise.resolve().then(() => {
        setStatsByRestaurantId({});
        setLoading(false);
      });
      return;
    }

    let cancelled = false;
    const { from, to } = todayRange();

    void (async () => {
      setLoading(true);
      const client = getSupabaseBrowserClient();
      const { data } = await client
        .from("reservations")
        .select("restaurant_id")
        .in("restaurant_id", ids)
        .gte("created_at", from)
        .lte("created_at", to);

      const { data: reviewRows } = await client.rpc("restaurant_review_summaries", {
        p_restaurant_ids: ids,
      });

      if (cancelled) return;
      const nextStats = ids.reduce<Record<string, RestaurantPreviewStats>>((acc, id) => {
        acc[id] = { ...EMPTY_STATS };
        return acc;
      }, {});
      (data ?? []).forEach((row) => {
        const restaurantId = (row as { restaurant_id?: unknown }).restaurant_id;
        if (typeof restaurantId !== "string") return;
        nextStats[restaurantId] = {
          bookedToday: (nextStats[restaurantId]?.bookedToday ?? 0) + 1,
          avgRating: nextStats[restaurantId]?.avgRating ?? null,
          totalReviews: nextStats[restaurantId]?.totalReviews ?? 0,
        };
      });
      ((reviewRows ?? []) as ReviewSummaryRow[]).forEach((row) => {
        const restaurantId = row.restaurant_id;
        if (!restaurantId || !nextStats[restaurantId]) return;
        nextStats[restaurantId] = {
          ...nextStats[restaurantId],
          avgRating: row.avg_rating == null ? null : Number(row.avg_rating),
          totalReviews: row.total_reviews ?? 0,
        };
      });
      setStatsByRestaurantId(nextStats);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [restaurantKey]);

  return { statsByRestaurantId, loading };
}
