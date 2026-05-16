import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { toUserFacingError } from "@/lib/errors";
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

export type AnalyticsDishPerformance = {
  name: string;
  revenue: number;
  quantity: number;
};

export type AnalyticsReservationPoint = {
  reserved_at: string;
  status: string;
};

type AnalyticsOrderItemSource = {
  name: string | null;
  quantity: number | null;
  line_total: number | null;
  menu_items?: { name: string | null; name_fr: string | null } | Array<{ name: string | null; name_fr: string | null }> | null;
};

type AnalyticsOrderSource = {
  order_items?: AnalyticsOrderItemSource[] | null;
};

function rangeStart(range?: AnalyticsDateRange): string | null {
  return range?.from ? `${range.from}T00:00:00` : null;
}

function rangeEnd(range?: AnalyticsDateRange): string | null {
  return range?.to ? `${range.to}T23:59:59` : null;
}

function relatedMenuItemName(item: AnalyticsOrderItemSource): string | null {
  if (Array.isArray(item.menu_items)) return item.menu_items[0]?.name ?? null;
  return item.menu_items?.name ?? null;
}

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
      const friendly = toUserFacingError(qErr, "Couldn't load analytics.");
      setError(new Error(friendly.message));
      console.error("[useAnalytics.rows]", friendly.code, friendly.technical ?? qErr);
      setRows([]);
    } else {
      setRows((data ?? []) as AnalyticsRow[]);
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

export function useAnalyticsDishPerformance(range?: AnalyticsDateRange) {
  const { selectedRestaurantId } = useRestaurantScope();
  const [dishes, setDishes] = useState<AnalyticsDishPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchDishes = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setDishes([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();
    let query = client
      .from("orders")
      .select("order_items(name, quantity, line_total, menu_items(name, name_fr))")
      .eq("restaurant_id", selectedRestaurantId)
      .not("paid_at", "is", null);

    const start = rangeStart(range);
    const end = rangeEnd(range);
    if (start) query = query.gte("paid_at", start);
    if (end) query = query.lte("paid_at", end);

    const { data, error: qErr } = await query;
    if (qErr) {
      const friendly = toUserFacingError(qErr, "Couldn't load dish performance.");
      setError(new Error(friendly.message));
      console.error("[useAnalytics.dishes]", friendly.code, friendly.technical ?? qErr);
      setDishes([]);
    } else {
      const totals = new Map<string, AnalyticsDishPerformance>();
      ((data ?? []) as unknown as AnalyticsOrderSource[]).forEach((order) => {
        order.order_items?.forEach((item) => {
          const name = relatedMenuItemName(item) ?? item.name ?? "Unnamed item";
          const existing = totals.get(name) ?? { name, revenue: 0, quantity: 0 };
          totals.set(name, {
            name,
            revenue: existing.revenue + Number(item.line_total ?? 0),
            quantity: existing.quantity + Number(item.quantity ?? 0),
          });
        });
      });
      setDishes(Array.from(totals.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5));
    }
    setLoading(false);
  }, [range?.from, range?.to, selectedRestaurantId]);

  useEffect(() => { void fetchDishes(); }, [fetchDishes]);

  return { dishes, loading, error, refetch: fetchDishes };
}

export function useAnalyticsReservations(range?: AnalyticsDateRange) {
  const { selectedRestaurantId } = useRestaurantScope();
  const [reservations, setReservations] = useState<AnalyticsReservationPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchReservations = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setReservations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();
    let query = client
      .from("reservations")
      .select("reserved_at, status")
      .eq("restaurant_id", selectedRestaurantId)
      .in("status", ["confirmed", "seated", "completed"])
      .order("reserved_at", { ascending: true });

    const start = rangeStart(range);
    const end = rangeEnd(range);
    if (start) query = query.gte("reserved_at", start);
    if (end) query = query.lte("reserved_at", end);

    const { data, error: qErr } = await query;
    if (qErr) {
      const friendly = toUserFacingError(qErr, "Couldn't load reservation analytics.");
      setError(new Error(friendly.message));
      console.error("[useAnalytics.reservations]", friendly.code, friendly.technical ?? qErr);
      setReservations([]);
    } else {
      setReservations((data ?? []) as AnalyticsReservationPoint[]);
    }
    setLoading(false);
  }, [range?.from, range?.to, selectedRestaurantId]);

  useEffect(() => { void fetchReservations(); }, [fetchReservations]);

  return { reservations, loading, error, refetch: fetchReservations };
}
