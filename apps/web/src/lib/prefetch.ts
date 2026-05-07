import { useCallback, useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { fetchRestaurantBySlugOrId } from "@/hooks/useRestaurant";
import { fetchPublicMenuCategories, fetchPublicMenuItems } from "@/hooks/useMenuItems";

const PREFETCH_STALE_MS = 30_000;
const HOVER_PREFETCH_DELAY_MS = 150;

type RestaurantPreviewKey = {
  restaurantId: string | null | undefined;
  slug: string | null | undefined;
};

export function prefetchRestaurantPreview(
  queryClient: QueryClient,
  { restaurantId, slug }: RestaurantPreviewKey,
): void {
  if (slug) {
    void queryClient.prefetchQuery({
      queryKey: ["restaurant", slug],
      queryFn: () => fetchRestaurantBySlugOrId(slug),
      staleTime: PREFETCH_STALE_MS,
    });
  }
  if (restaurantId) {
    void queryClient.prefetchQuery({
      queryKey: ["public-menu-categories", restaurantId],
      queryFn: () => fetchPublicMenuCategories(restaurantId),
      staleTime: PREFETCH_STALE_MS,
    });
    void queryClient.prefetchQuery({
      queryKey: ["public-menu-items", restaurantId],
      queryFn: () => fetchPublicMenuItems(restaurantId),
      staleTime: PREFETCH_STALE_MS,
    });
  }
}

export function useRestaurantPrefetch(restaurantId: string | null | undefined, slug: string | null | undefined) {
  const queryClient = useQueryClient();
  const hoverTimerRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const elementRef = useRef<HTMLElement | null>(null);

  const fire = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    prefetchRestaurantPreview(queryClient, { restaurantId, slug });
  }, [queryClient, restaurantId, slug]);

  const cancelHoverTimer = useCallback(() => {
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const onMouseEnter = useCallback(() => {
    if (firedRef.current) return;
    cancelHoverTimer();
    hoverTimerRef.current = window.setTimeout(fire, HOVER_PREFETCH_DELAY_MS);
  }, [cancelHoverTimer, fire]);

  const onMouseLeave = useCallback(() => {
    cancelHoverTimer();
  }, [cancelHoverTimer]);

  // IntersectionObserver: fire when 50% visible.
  const setRef = useCallback((node: HTMLElement | null) => {
    elementRef.current = node;
  }, []);

  useEffect(() => {
    const node = elementRef.current;
    if (!node || firedRef.current) return;
    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            fire();
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fire, restaurantId, slug]);

  useEffect(() => () => cancelHoverTimer(), [cancelHoverTimer]);

  return { onMouseEnter, onMouseLeave, setRef };
}
