import { useQuery } from "@tanstack/react-query";

import { toUserFacingError } from "@/lib/errors";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

// Diner-facing snap shape — `visit_photos` row plus the poster's display info
// and any paired review. Per HAB_REVIEW_SNAP_TRANSFER.md §7 the pairing is
// best-effort, client-side: match on booking_id when both rows carry one,
// else fall back to nearest restaurant_review within ±5 minutes of the
// photo's created_at for the same (user_id, restaurant_id).
//
// IMPORTANT — two different identities:
//   visit_photos.user_id        = auth.users.id (no FK)
//   restaurant_reviews.user_id  = user_profiles.id (FK)
// Below we resolve photos.user_id → profile via auth_user_id, then translate
// to profile.id before comparing against review.user_id in the pairing pass.
export type RestaurantPhoto = {
  id: string;
  image_url: string;
  caption: string | null;
  rating: number | null;
  story_filter_id: string | null;
  created_at: string;
  user_id: string;
  booking_id: string | null;
  poster_name: string | null;
  poster_avatar_url: string | null;
  paired_review: {
    id: string;
    rating: number;
    review_text: string | null;
  } | null;
};

const EMPTY_PHOTOS: RestaurantPhoto[] = [];
const PAIR_WINDOW_MS = 5 * 60 * 1000;

type RawPhotoRow = {
  id: string;
  image_url: string;
  caption: string | null;
  rating: number | null;
  story_filter_id: string | null;
  created_at: string;
  user_id: string;
  booking_id: string | null;
};

type RawReviewRow = {
  id: string;
  rating: number;
  review_text: string | null;
  created_at: string;
  user_id: string;
  reservation_id: string | null;
};

type PosterProfile = {
  auth_user_id: string;
  full_name: string | null;
  avatar_url: string | null;
};

async function fetchRestaurantPhotos(restaurantId: string): Promise<RestaurantPhoto[]> {
  if (!isSupabaseConfigured()) return [];
  const client = getSupabaseBrowserClient();
  const [{ data: photoRows, error: photoErr }, { data: reviewRows, error: reviewsErr }] = await Promise.all([
    client
      .from("visit_photos")
      .select("id, image_url, caption, rating, story_filter_id, created_at, user_id, booking_id")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(60),
    client
      .from("restaurant_reviews")
      .select("id, rating, review_text, created_at, user_id, reservation_id")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (photoErr) {
    const friendly = toUserFacingError(photoErr, "Couldn't load restaurant photos.");
    console.error("[useRestaurantPhotos.photos]", friendly.code, friendly.technical ?? photoErr);
    throw new Error(friendly.message);
  }
  if (reviewsErr) {
    const friendly = toUserFacingError(reviewsErr, "Couldn't load restaurant reviews.");
    console.error("[useRestaurantPhotos.reviews]", friendly.code, friendly.technical ?? reviewsErr);
    throw new Error(friendly.message);
  }

  const photos = (photoRows ?? []) as RawPhotoRow[];
  const reviews = (reviewRows ?? []) as RawReviewRow[];

  // Stitch reviewer display info. Subtle schema quirk:
  //   visit_photos.user_id     = auth.users.id (no FK)
  //   restaurant_reviews.user_id = user_profiles.id (FK)
  // user_profiles is RLS-locked to "your own row + diners you manage", so
  // direct SELECT returns nothing for anon viewers or for diners viewing
  // *other* diners' snaps. The RPC `get_public_profile_display_by_auth_id`
  // is SECURITY DEFINER and exposes only (id, auth_user_id, full_name,
  // avatar_url) to anon + authenticated — see migration
  // 20260514_public_profile_display.
  const authUserIds = Array.from(new Set(photos.map((p) => p.user_id)));
  let profileByAuthId: Map<string, PosterProfile & { id: string }> = new Map();
  if (authUserIds.length > 0) {
    const { data: profileRows } = await client.rpc(
      "get_public_profile_display_by_auth_id",
      { p_auth_user_ids: authUserIds },
    );
    profileByAuthId = new Map(
      (
        (profileRows ?? []) as Array<{
          id: string;
          auth_user_id: string;
          full_name: string | null;
          avatar_url: string | null;
        }>
      ).map((row) => [row.auth_user_id, row]),
    );
  }

  return photos.map((photo) => {
    const poster = profileByAuthId.get(photo.user_id) ?? null;
    const photoTimeMs = new Date(photo.created_at).getTime();
    // Translate the photo's auth_user_id to a profile id so we can compare
    // against restaurant_reviews.user_id (which is profile id, not auth id).
    const posterProfileId = poster?.id ?? null;
    const candidates = posterProfileId
      ? reviews.filter((r) => r.user_id === posterProfileId)
      : [];
    // 1) Exact booking_id match.
    let pairedReview =
      photo.booking_id != null
        ? candidates.find((r) => r.reservation_id === photo.booking_id) ?? null
        : null;
    // 2) ±5 minute window fallback.
    if (!pairedReview) {
      let bestDist = PAIR_WINDOW_MS + 1;
      for (const r of candidates) {
        const dist = Math.abs(new Date(r.created_at).getTime() - photoTimeMs);
        if (dist <= PAIR_WINDOW_MS && dist < bestDist) {
          pairedReview = r;
          bestDist = dist;
        }
      }
    }
    return {
      id: photo.id,
      image_url: photo.image_url,
      caption: photo.caption,
      rating: photo.rating,
      story_filter_id: photo.story_filter_id,
      created_at: photo.created_at,
      user_id: photo.user_id,
      booking_id: photo.booking_id,
      poster_name: poster?.full_name ?? null,
      poster_avatar_url: poster?.avatar_url ?? null,
      paired_review: pairedReview
        ? {
            id: pairedReview.id,
            rating: pairedReview.rating,
            review_text: pairedReview.review_text,
          }
        : null,
    };
  });
}

export function useRestaurantPhotos(
  restaurantId: string | null | undefined,
  options: { enabled?: boolean } = {},
) {
  const enabled = (options.enabled ?? true) && Boolean(restaurantId);
  const query = useQuery({
    queryKey: ["restaurant-photos", restaurantId ?? null],
    queryFn: () => fetchRestaurantPhotos(restaurantId as string),
    enabled,
  });
  return {
    photos: query.data ?? EMPTY_PHOTOS,
    loading: enabled ? query.isPending : false,
    refetch: query.refetch,
  };
}
