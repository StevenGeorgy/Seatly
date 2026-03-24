import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { MOCK_ANALYTICS } from "@/lib/mock-data";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type AnalyticsRow = {
  id: string;
  restaurant_id: string;
  date: string;
  total_covers: number;
  total_revenue: number;
  total_orders: number;
  avg_spend_per_cover: number | null;
  no_show_count: number;
  cancellation_count: number;
  walk_in_count: number;
  food_revenue: number | null;
  drinks_revenue: number | null;
  tip_total: number | null;
  discount_total: number | null;
  labour_cost: number | null;
  new_guests_count: number | null;
  returning_guests_count: number | null;
  loyalty_points_issued: number | null;
  loyalty_points_redeemed: number | null;
  avg_table_turn_minutes: number | null;
  top_dishes_json: unknown[] | null;
  computed_at: string | null;
};

export type AnalyticsDateRange = {
  from: string;
  to: string;
};

export function useAnalytics(range?: AnalyticsDateRange) {
  const { selectedRestaurantId } = useRestaurantScope();
  const [rows, setRows] = useState<AnalyticsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAnalytics = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    let query = client
      .from("restaurant_analytics")
      .select("*")
      .eq("restaurant_id", selectedRestaurantId)
      .order("date", { ascending: true });

    if (range?.from) query = query.gte("date", range.from);
    if (range?.to) query = query.lte("date", range.to);

    const { data, error: qErr } = await query;

    if (qErr) {
      setError(new Error(qErr.message));
      setRows([]);
    } else {
      const rawRows = (data ?? []) as AnalyticsRow[];
      setRows(rawRows.length > 0 ? rawRows : MOCK_ANALYTICS);
    }
    setLoading(false);
  }, [selectedRestaurantId, range?.from, range?.to]);

  useEffect(() => { void fetchAnalytics(); }, [fetchAnalytics]);

  const todayRow = rows.find((r) => r.date === new Date().toISOString().split("T")[0]) ?? null;

  const totals = rows.reduce(
    (acc, r) => ({
      covers: acc.covers + (r.total_covers ?? 0),
      revenue: acc.revenue + (r.total_revenue ?? 0),
      orders: acc.orders + (r.total_orders ?? 0),
      noShows: acc.noShows + (r.no_show_count ?? 0),
    }),
    { covers: 0, revenue: 0, orders: 0, noShows: 0 },
  );

  return { rows, todayRow, totals, loading, error, refetch: fetchAnalytics };
}
