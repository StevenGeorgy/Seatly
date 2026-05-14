import { useQuery } from "@tanstack/react-query";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

// Diner-facing review shape — includes reviewer display info so the Reviews
// tab can render attribution. user_profiles is RLS-locked (no public read
// policy), so we look up reviewer names via the SECURITY DEFINER RPC
// `get_public_profile_display_by_id` which exposes only full_name +
// avatar_url. See migration 20260514_public_profile_display.
export type RestaurantReview = {
  id: string;
  rating: number;
  review_text: string | null;
  created_at: string;
  reviewer_name: string | null;
  reviewer_avatar_url: string | null;
  user_id: string;
  reservation_id: string | null;
};

export type RestaurantReviewSummary = {
  avgRating: number | null;
  totalReviews: number;
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
  // visit_photos.user_id and restaurant_reviews.user_id both reference
  // auth.users(id), not user_profiles, so PostgREST can't auto-join. We
  // fetch the rows first, then look up user_profiles separately keyed by
  // auth_user_id and stitch them in JS.
  const [{ data: summaryRows }, { data: reviewRows, error: reviewsErr }] = await Promise.all([
    client.rpc("restaurant_review_summaries", { p_restaurant_ids: [restaurantId] }),
    client
      .from("restaurant_reviews")
      .select("id, rating, review_text, created_at, user_id, reservation_id")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (reviewsErr) throw new Error(reviewsErr.message);

  type RawReviewRow = {
    id: string;
    rating: number;
    review_text: string | null;
    created_at: string;
    user_id: string;
    reservation_id: string | null;
  };
  const rows = (reviewRows ?? []) as RawReviewRow[];

  // Stitch reviewer info — restaurant_reviews.user_id is user_profiles.id
  // (NOT auth_user_id). user_profiles RLS hides other diners' rows, so we
  // call the SECURITY DEFINER RPC which whitelists full_name + avatar_url.
  const profileIds = Array.from(new Set(rows.map((r) => r.user_id)));
  let profileById = new Map<string, { full_name: string | null; avatar_url: string | null }>();
  if (profileIds.length > 0) {
    const { data: profileRows } = await client.rpc(
      "get_public_profile_display_by_id",
      { p_profile_ids: profileIds },
    );
    profileById = new Map(
      (
        (profileRows ?? []) as Array<{
          id: string;
          full_name: string | null;
          avatar_url: string | null;
        }>
      ).map((row) => [row.id, { full_name: row.full_name, avatar_url: row.avatar_url }]),
    );
  }

  const summaryRow = ((summaryRows ?? []) as RestaurantReviewSummaryRow[])[0];
  return {
    summary: {
      avgRating: summaryRow?.avg_rating == null ? null : Number(summaryRow.avg_rating),
      totalReviews: summaryRow?.total_reviews ?? 0,
    },
    reviews: rows.map((row) => {
      const reviewer = profileById.get(row.user_id) ?? null;
      return {
        id: row.id,
        rating: row.rating,
        review_text: row.review_text,
        created_at: row.created_at,
        user_id: row.user_id,
        reservation_id: row.reservation_id,
        reviewer_name: reviewer?.full_name ?? null,
        reviewer_avatar_url: reviewer?.avatar_url ?? null,
      };
    }),
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
    refetch: query.refetch,
  };
}
