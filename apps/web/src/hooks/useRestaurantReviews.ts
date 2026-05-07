import { useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type RestaurantReview = {
  id: string;
  rating: number;
  review_text: string | null;
  created_at: string;
};

export type RestaurantReviewSummary = {
  avgRating: number | null;
  totalReviews: number;
};

type RestaurantReviewRow = {
  id?: string | null;
  rating?: number | null;
  review_text?: string | null;
  created_at?: string | null;
};

type RestaurantReviewSummaryRow = {
  avg_rating?: number | string | null;
  total_reviews?: number | null;
};

const EMPTY_SUMMARY: RestaurantReviewSummary = {
  avgRating: null,
  totalReviews: 0,
};

export function useRestaurantReviews(restaurantId: string | null | undefined) {
  const [reviews, setReviews] = useState<RestaurantReview[]>([]);
  const [summary, setSummary] = useState<RestaurantReviewSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!restaurantId || !isSupabaseConfigured()) {
      void Promise.resolve().then(() => {
        setReviews([]);
        setSummary(EMPTY_SUMMARY);
        setLoading(false);
      });
      return;
    }

    let cancelled = false;

    void (async () => {
      setLoading(true);
      const client = getSupabaseBrowserClient();
      const [{ data: summaryRows }, { data: reviewRows }] = await Promise.all([
        client.rpc("restaurant_review_summaries", { p_restaurant_ids: [restaurantId] }),
        client.rpc("restaurant_public_reviews", { p_restaurant_id: restaurantId, p_limit: 12 }),
      ]);

      if (cancelled) return;

      const summaryRow = ((summaryRows ?? []) as RestaurantReviewSummaryRow[])[0];
      setSummary({
        avgRating: summaryRow?.avg_rating == null ? null : Number(summaryRow.avg_rating),
        totalReviews: summaryRow?.total_reviews ?? 0,
      });
      setReviews(
        ((reviewRows ?? []) as RestaurantReviewRow[])
          .map((row) => ({
            id: row.id ?? "",
            rating: row.rating ?? 0,
            review_text: row.review_text ?? null,
            created_at: row.created_at ?? "",
          }))
          .filter((row) => row.id && row.rating >= 1 && row.created_at),
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  return { reviews, summary, loading };
}
