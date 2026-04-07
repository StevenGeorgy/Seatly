import type { FloorPlanRow, SectionRow, TableRow } from "@/lib/floor-plan-db-types";
import { promiseWithTimeout } from "@/lib/promise-timeout";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

const FLOOR_PLAN_FETCH_TIMEOUT_MS = 45_000;

export type FloorPlanBundle = {
  tables: TableRow[];
  floorPlans: FloorPlanRow[];
  sections: SectionRow[];
  /** Set when any of the three PostgREST responses returned an error (data may still be partial). */
  error: Error | null;
};

/**
 * Single parallel load of tables + floor_plans + restaurant_sections for one restaurant.
 * Used by {@link useFloorPlan} and dashboard prefetch so navigation can reuse warm data.
 */
export async function fetchFloorPlanBundle(restaurantId: string): Promise<FloorPlanBundle> {
  if (!isSupabaseConfigured()) {
    return {
      tables: [],
      floorPlans: [],
      sections: [],
      error: new Error("Supabase is not configured"),
    };
  }

  const client = getSupabaseBrowserClient();
  const [tablesRes, plansRes, sectionsRes] = await promiseWithTimeout(
    Promise.all([
      client.from("tables").select("*").eq("restaurant_id", restaurantId).eq("is_active", true),
      client.from("floor_plans").select("*").eq("restaurant_id", restaurantId).eq("is_active", true),
      client.from("restaurant_sections").select("*").eq("restaurant_id", restaurantId).eq("is_active", true).order("sort_order"),
    ]),
    FLOOR_PLAN_FETCH_TIMEOUT_MS,
    "Floor plan load",
  );

  const err =
    tablesRes.error || plansRes.error || sectionsRes.error
      ? new Error(
          tablesRes.error?.message ?? plansRes.error?.message ?? sectionsRes.error?.message ?? "Unknown error",
        )
      : null;

  return {
    tables: (tablesRes.data ?? []) as TableRow[],
    floorPlans: (plansRes.data ?? []) as FloorPlanRow[],
    sections: (sectionsRes.data ?? []) as SectionRow[],
    error: err,
  };
}
