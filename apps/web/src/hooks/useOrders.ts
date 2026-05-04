import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type OrderItemRow = {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  modifications: string | null;
  course: string | null;
  status: string;
  added_by: string | null;
  kitchen_started_at: string | null;
  kitchen_ready_at: string | null;
  menu_items?: { name: string; name_fr: string | null } | null;
};

export type OrderRow = {
  id: string;
  reservation_id: string | null;
  restaurant_id: string;
  guest_id: string | null;
  is_preorder: boolean;
  is_guest_checkout?: boolean;
  order_type: string | null;
  confirmation_code: string | null;
  notes: string | null;
  source: string | null;
  status: string;
  subtotal: number | null;
  tax_amount: number | null;
  tip_amount: number | null;
  total_amount: number | null;
  created_at: string | null;
  order_items: OrderItemRow[];
  reservations?: {
    table_id: string | null;
    reserved_at?: string | null;
    guest_full_name?: string | null;
    guest_email?: string | null;
    guest_phone?: string | null;
    tables?: { table_number: string | null; label?: string | null } | null;
  } | null;
  guests?: {
    full_name: string | null;
    phone: string | null;
    dietary_restrictions: string[] | null;
    allergies: string[] | null;
    seating_preference: string | null;
    noise_preference: string | null;
  } | null;
};

export type OrderFilters = {
  barOnly?: boolean;
  preordersOnly?: boolean;
};

export function useOrders(filters?: OrderFilters) {
  const { selectedRestaurantId } = useRestaurantScope();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchOrders = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setOrders([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    const { data, error: qErr } = await client
      .from("orders")
      .select("*, order_items(*, menu_items(name, name_fr)), reservations!orders_reservation_id_fkey(table_id, reserved_at, guest_full_name, guest_email, guest_phone, tables(table_number, label)), guests(full_name, phone, dietary_restrictions, allergies, seating_preference, noise_preference)")
      .eq("restaurant_id", selectedRestaurantId)
      .in("status", ["pending", "confirmed", "preparing", "ready", "served"])
      .order("created_at", { ascending: true });

    if (qErr) {
      setError(new Error(qErr.message));
      setOrders([]);
    } else {
      let rows = (data ?? []) as OrderRow[];
      if (filters?.preordersOnly) {
        rows = rows.filter((order) => order.is_preorder || order.reservation_id);
      }
      if (filters?.barOnly) {
        rows = rows.map((o) => ({
          ...o,
          order_items: o.order_items.filter((item) => item.course === "drink"),
        })).filter((o) => o.order_items.length > 0);
      }
      setOrders(rows);
    }
    setLoading(false);
  }, [selectedRestaurantId, filters?.barOnly, filters?.preordersOnly]);

  useEffect(() => { void fetchOrders(); }, [fetchOrders]);

  useEffect(() => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) return;

    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`orders:${selectedRestaurantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${selectedRestaurantId}` },
        () => { void fetchOrders(); },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_items" },
        () => { void fetchOrders(); },
      )
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [selectedRestaurantId, fetchOrders]);

  const updateOrderStatus = async (orderId: string, status: string) => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    const { error: itemUpdateError } = await client
      .from("order_items")
      .update({ status })
      .eq("order_id", orderId);
    if (itemUpdateError) throw new Error(itemUpdateError.message);

    const { error: updateError } = await client
      .from("orders")
      .update({ status })
      .eq("id", orderId);
    if (updateError) throw new Error(updateError.message);
    void fetchOrders();
  };

  return { orders, loading, error, refetch: fetchOrders, updateOrderStatus };
}
