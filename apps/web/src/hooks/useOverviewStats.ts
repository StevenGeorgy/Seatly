import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { toUserFacingError } from "@/lib/errors";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type OverviewStatsRange = {
  from: string;
  to: string;
};

export type OverviewOrderStats = {
  orderCount: number;
  preorderCount: number;
  activePreorderCount: number;
  paidPreorderCount: number;
  paidIncome: number;
};

type OverviewOrderSource = {
  id: string;
  status: string | null;
  total_amount: number | string | null;
  is_preorder: boolean | null;
  reservation_id: string | null;
  created_at: string | null;
  paid_at: string | null;
};

const EMPTY_STATS: OverviewOrderStats = {
  orderCount: 0,
  preorderCount: 0,
  activePreorderCount: 0,
  paidPreorderCount: 0,
  paidIncome: 0,
};

const ACTIVE_ORDER_STATUSES = new Set(["pending", "confirmed", "preparing", "ready", "served"]);

function isPreorder(order: OverviewOrderSource): boolean {
  return Boolean(order.is_preorder || order.reservation_id);
}

function sumPaidIncome(orders: OverviewOrderSource[]): number {
  return orders.reduce((sum, order) => sum + Number(order.total_amount ?? 0), 0);
}

export function useOverviewStats(range: OverviewStatsRange) {
  const { selectedRestaurantId } = useRestaurantScope();
  const [stats, setStats] = useState<OverviewOrderStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchStats = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setStats(EMPTY_STATS);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const client = getSupabaseBrowserClient();
    const [{ data: createdOrders, error: createdErr }, { data: paidOrders, error: paidErr }] = await Promise.all([
      client
        .from("orders")
        .select("id, status, total_amount, is_preorder, reservation_id, created_at, paid_at")
        .eq("restaurant_id", selectedRestaurantId)
        .gte("created_at", range.from)
        .lte("created_at", range.to),
      client
        .from("orders")
        .select("id, status, total_amount, is_preorder, reservation_id, created_at, paid_at")
        .eq("restaurant_id", selectedRestaurantId)
        .not("paid_at", "is", null)
        .gte("paid_at", range.from)
        .lte("paid_at", range.to),
    ]);

    const queryError = createdErr ?? paidErr;
    if (queryError) {
      const friendly = toUserFacingError(queryError, "Couldn't load overview stats.");
      setError(new Error(friendly.message));
      console.error("[useOverviewStats.fetch]", friendly.code, friendly.technical ?? queryError);
      setStats(EMPTY_STATS);
      setLoading(false);
      return;
    }

    const createdRows = (createdOrders ?? []) as OverviewOrderSource[];
    const paidRows = (paidOrders ?? []) as OverviewOrderSource[];
    const preorders = createdRows.filter(isPreorder);
    const paidPreorders = paidRows.filter(isPreorder);

    setStats({
      orderCount: createdRows.length,
      preorderCount: preorders.length,
      activePreorderCount: preorders.filter((order) => ACTIVE_ORDER_STATUSES.has(order.status ?? "")).length,
      paidPreorderCount: paidPreorders.length,
      paidIncome: sumPaidIncome(paidPreorders),
    });
    setLoading(false);
  }, [range.from, range.to, selectedRestaurantId]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) return;

    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`overview-orders:${selectedRestaurantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${selectedRestaurantId}` },
        () => {
          void fetchStats();
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [selectedRestaurantId, fetchStats]);

  return { stats, loading, error, refetch: fetchStats };
}
