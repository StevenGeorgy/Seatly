import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useUser } from "@/hooks/useUser";

// One "entry" represents a single visit's review + snap (paired) from the
// diner's POV. Either half can be missing — a mobile user might post a snap
// without a review, and a web user might write a review without a photo.
// Matches the mobile My Reviews screen pattern (HAB_REVIEW_SNAP_TRANSFER §7).
export type MyReviewSnapEntry = {
  key: string; // stable React key
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string | null;
  createdAt: string; // most recent of (review, photo)
  review: {
    id: string;
    rating: number;
    review_text: string | null;
    reservation_id: string | null;
  } | null;
  photo: {
    id: string;
    image_url: string;
    storage_path: string | null;
    caption: string | null;
    booking_id: string | null;
  } | null;
};

const EMPTY: MyReviewSnapEntry[] = [];
const PAIR_WINDOW_MS = 5 * 60 * 1000;

type RawReviewRow = {
  id: string;
  rating: number;
  review_text: string | null;
  created_at: string;
  reservation_id: string | null;
  restaurant_id: string;
  restaurant: { id: string; name: string; slug: string } | null;
};

type RawPhotoRow = {
  id: string;
  image_url: string;
  caption: string | null;
  created_at: string;
  booking_id: string | null;
  restaurant_id: string;
  restaurant: { id: string; name: string; slug: string } | null;
};

// Parse the storage path from a public image URL. We don't strictly need this
// for display, but the delete flow needs it to remove the JPEG from the
// `visit-photos` bucket. The URL shape (per HAB §3) is:
//   https://<project>.supabase.co/storage/v1/object/public/visit-photos/<user_id>/<photo_id>.jpg
function storagePathFromUrl(url: string): string | null {
  const idx = url.indexOf("/visit-photos/");
  if (idx === -1) return null;
  return url.slice(idx + "/visit-photos/".length);
}

// Two identities at play (see HAB doc note + actual schema):
//   visit_photos.user_id     = auth.users.id     → filter with authUserId
//   restaurant_reviews.user_id = user_profiles.id → filter with profileId
async function fetchMyReviewsAndSnaps(
  authUserId: string,
  profileId: string,
): Promise<MyReviewSnapEntry[]> {
  if (!isSupabaseConfigured()) return [];
  const client = getSupabaseBrowserClient();
  const [{ data: reviewRows, error: rErr }, { data: photoRows, error: pErr }] = await Promise.all([
    client
      .from("restaurant_reviews")
      .select(
        "id, rating, review_text, created_at, reservation_id, restaurant_id, restaurant:restaurants(id, name, slug)",
      )
      .eq("user_id", profileId)
      .order("created_at", { ascending: false })
      .limit(100),
    client
      .from("visit_photos")
      .select(
        "id, image_url, caption, created_at, booking_id, restaurant_id, restaurant:restaurants(id, name, slug)",
      )
      .eq("user_id", authUserId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (rErr) throw new Error(rErr.message);
  if (pErr) throw new Error(pErr.message);

  type WithJoin<T> = Omit<T, "restaurant"> & {
    restaurant:
      | { id: string; name: string; slug: string }
      | { id: string; name: string; slug: string }[]
      | null;
  };
  const reviews = ((reviewRows ?? []) as WithJoin<RawReviewRow>[]).map((r) => ({
    ...r,
    restaurant: Array.isArray(r.restaurant) ? r.restaurant[0] ?? null : r.restaurant,
  })) as RawReviewRow[];
  const photos = ((photoRows ?? []) as WithJoin<RawPhotoRow>[]).map((p) => ({
    ...p,
    restaurant: Array.isArray(p.restaurant) ? p.restaurant[0] ?? null : p.restaurant,
  })) as RawPhotoRow[];

  // Pair each photo with its closest review. Mark consumed reviews so we
  // don't double-count them in the "review-only" pass below.
  const consumedReviewIds = new Set<string>();
  const paired: MyReviewSnapEntry[] = [];
  for (const photo of photos) {
    const photoMs = new Date(photo.created_at).getTime();
    const candidates = reviews.filter(
      (r) => r.restaurant_id === photo.restaurant_id && !consumedReviewIds.has(r.id),
    );
    // 1) booking_id exact match
    let match: RawReviewRow | null =
      photo.booking_id != null
        ? candidates.find((r) => r.reservation_id === photo.booking_id) ?? null
        : null;
    // 2) ±5 minute window
    if (!match) {
      let best = PAIR_WINDOW_MS + 1;
      for (const r of candidates) {
        const dist = Math.abs(new Date(r.created_at).getTime() - photoMs);
        if (dist <= PAIR_WINDOW_MS && dist < best) {
          match = r;
          best = dist;
        }
      }
    }
    if (match) consumedReviewIds.add(match.id);
    const restaurant = photo.restaurant ?? match?.restaurant ?? null;
    if (!restaurant) continue;
    paired.push({
      key: `photo:${photo.id}`,
      restaurantId: photo.restaurant_id,
      restaurantName: restaurant.name,
      restaurantSlug: restaurant.slug,
      createdAt: photo.created_at,
      review: match
        ? {
            id: match.id,
            rating: match.rating,
            review_text: match.review_text,
            reservation_id: match.reservation_id,
          }
        : null,
      photo: {
        id: photo.id,
        image_url: photo.image_url,
        storage_path: storagePathFromUrl(photo.image_url),
        caption: photo.caption,
        booking_id: photo.booking_id,
      },
    });
  }

  // Reviews that weren't paired with a photo (web-only reviews, or mobile
  // reviews whose photo was deleted earlier).
  for (const review of reviews) {
    if (consumedReviewIds.has(review.id)) continue;
    if (!review.restaurant) continue;
    paired.push({
      key: `review:${review.id}`,
      restaurantId: review.restaurant_id,
      restaurantName: review.restaurant.name,
      restaurantSlug: review.restaurant.slug,
      createdAt: review.created_at,
      review: {
        id: review.id,
        rating: review.rating,
        review_text: review.review_text,
        reservation_id: review.reservation_id,
      },
      photo: null,
    });
  }

  paired.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return paired;
}

export function useMyReviewsAndSnaps() {
  const { profile } = useUser();
  const queryClient = useQueryClient();
  const authUserId = profile?.auth_user_id;
  const profileId = profile?.id;

  const queryKey = ["my-reviews-and-snaps", profileId ?? null, authUserId ?? null] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchMyReviewsAndSnaps(authUserId as string, profileId as string),
    enabled: Boolean(authUserId && profileId),
  });

  // All-or-nothing delete: removes the review row, the photo row, and the
  // storage object (when present). Matches mobile's deleteMyReview behavior
  // exactly (HAB_REVIEW_SNAP_TRANSFER §8) so the data stays consistent
  // regardless of which app a diner uses.
  const remove = useCallback(
    async (entry: MyReviewSnapEntry) => {
      if (!isSupabaseConfigured()) throw new Error("Not connected");
      const client = getSupabaseBrowserClient();
      // 1) Delete the photo row first (table) so RLS clears before we try to
      //    remove the storage object.
      if (entry.photo) {
        const { error } = await client
          .from("visit_photos")
          .delete()
          .eq("id", entry.photo.id);
        if (error) throw new Error(error.message);
      }
      // 2) Delete the review row.
      if (entry.review) {
        const { error } = await client
          .from("restaurant_reviews")
          .delete()
          .eq("id", entry.review.id);
        if (error) throw new Error(error.message);
      }
      // 3) Remove the storage object. Storage RLS lets the owner DELETE based
      //    on the {auth_user_id}/<file> path convention.
      if (entry.photo?.storage_path) {
        await client.storage.from("visit-photos").remove([entry.photo.storage_path]);
      }
      // 4) Refetch so the My Reviews list updates and any restaurant page
      //    the user navigates to next gets fresh data too.
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["restaurant-reviews"] });
      void queryClient.invalidateQueries({ queryKey: ["restaurant-photos"] });
    },
    [queryClient, queryKey],
  );

  return {
    entries: query.data ?? EMPTY,
    loading: authUserId ? query.isPending : false,
    error: (query.error as Error | null) ?? null,
    refetch: query.refetch,
    remove,
  };
}
