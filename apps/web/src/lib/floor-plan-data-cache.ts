import { fetchFloorPlanBundle, type FloorPlanBundle } from "@/lib/floor-plan-bundle-fetch";
import { isSupabaseConfigured } from "@/lib/supabase/client";

const TTL_MS = 120_000;

type CacheEntry = { restaurantId: string; bundle: FloorPlanBundle; at: number };

let cache: CacheEntry | null = null;

export function readFloorPlanCache(restaurantId: string): FloorPlanBundle | null {
  if (!cache || cache.restaurantId !== restaurantId) return null;
  if (Date.now() - cache.at > TTL_MS) return null;
  return cache.bundle;
}

export function writeFloorPlanCache(restaurantId: string, bundle: FloorPlanBundle): void {
  cache = {
    restaurantId,
    at: Date.now(),
    bundle: {
      tables: bundle.tables,
      floorPlans: bundle.floorPlans,
      sections: bundle.sections,
      error: bundle.error,
    },
  };
}

export function clearFloorPlanCache(): void {
  cache = null;
}

/** Warm cache while the user is on another dashboard screen so Floor plan opens instantly. */
export async function prefetchFloorPlanData(restaurantId: string): Promise<void> {
  if (!restaurantId || !isSupabaseConfigured()) return;
  try {
    const bundle = await fetchFloorPlanBundle(restaurantId);
    if (!bundle.error) {
      writeFloorPlanCache(restaurantId, bundle);
    }
  } catch {
    // Prefetch is best-effort only.
  }
}
