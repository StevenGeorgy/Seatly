import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useUser } from "@/hooks/useUser";

export type MyOrderItemRow = {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
};

export type MyOrderRow = {
  id: string;
  order_type: string | null;
  status: string;
  total_amount: number | null;
  created_at: string | null;
  confirmation_code: string | null;
  restaurant: { id: string; name: string; slug: string; currency: string } | null;
  order_items: MyOrderItemRow[];
};

export function useMyOrders() {
  const { profile } = useUser();
  const [orders, setOrders] = useState<MyOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetch = useCallback(async () => {
    if (!profile?.id || !isSupabaseConfigured()) {
      setOrders([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    const { data: guestRows, error: gErr } = await client
      .from("guests")
      .select("id")
      .eq("user_profile_id", profile.id);

    if (gErr) {
      setError(new Error(gErr.message));
      setLoading(false);
      return;
    }

    const guestIds = (guestRows ?? []).map((g) => g.id);
    if (guestIds.length === 0) {
      setOrders([]);
      setLoading(false);
      return;
    }

    const { data, error: oErr } = await client
      .from("orders")
      .select(
        "id, order_type, status, total_amount, created_at, confirmation_code, restaurant:restaurants(id, name, slug, currency), order_items(id, name, quantity, unit_price)",
      )
      .in("guest_id", guestIds)
      .order("created_at", { ascending: false });

    if (oErr) {
      setError(new Error(oErr.message));
      setLoading(false);
      return;
    }

    setOrders((data ?? []) as MyOrderRow[]);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  return { orders, loading, error, refresh: fetch };
}
