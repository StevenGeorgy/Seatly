import { useQuery } from "@tanstack/react-query";

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

type ReviewsBundle = {
  reviews: RestaurantReview[];
  summary: RestaurantReviewSummary;
};

async function fetchRestaurantReviews(restaurantId: string): Promise<ReviewsBundle> {
  if (!isSupabaseConfigured()) {
    return { reviews: [], summary: EMPTY_SUMMARY };
  }
  const client = getSupabaseBrowserClient();
  const [{ data: summaryRows }, { data: reviewRows }] = await Promise.all([
    client.rpc("restaurant_review_summaries", { p_restaurant_ids: [restaurantId] }),
    client.rpc("restaurant_public_reviews", { p_restaurant_id: restaurantId, p_limit: 12 }),
  ]);

  const summaryRow = ((summaryRows ?? []) as RestaurantReviewSummaryRow[])[0];
  return {
    summary: {
      avgRating: summaryRow?.avg_rating == null ? null : Number(summaryRow.avg_rating),
      totalReviews: summaryRow?.total_reviews ?? 0,
    },
    reviews: ((reviewRows ?? []) as RestaurantReviewRow[])
      .map((row) => ({
        id: row.id ?? "",
        rating: row.rating ?? 0,
        review_text: row.review_text ?? null,
        created_at: row.created_at ?? "",
      }))
      .filter((row) => row.id && row.rating >= 1 && row.created_at),
  };
}

const EMPTY_REVIEWS: RestaurantReview[] = [];

export function useRestaurantReviews(
  restaurantId: string | null | undefined,
  options: { enabled?: boolean } = {},
) {
  const enabled = (options.enabled ?? true) && Boolean(restaurantId);
  const query = useQuery({
    queryKey: ["restaurant-reviews", restaurantId ?? null],
    queryFn: () => fetchRestaurantReviews(restaurantId as string),
    enabled,
  });
  return {
    reviews: query.data?.reviews ?? EMPTY_REVIEWS,
    summary: query.data?.summary ?? EMPTY_SUMMARY,
    loading: enabled ? query.isPending : false,
  };
}
