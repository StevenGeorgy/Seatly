import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type ReservationOrderItem = {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
};

export type ReservationOrder = {
  id: string;
  status: string;
  total_amount: number | null;
  stripe_payment_intent_id: string | null;
  is_preorder: boolean | null;
  order_items: ReservationOrderItem[];
};

export type ReservationDepositPayment = {
  id: string;
  amount_cents: number;
  status: string;
  payer_full_name: string | null;
  paid_at: string | null;
};

export type ReservationPayments = {
  orders: ReservationOrder[];
  deposits: ReservationDepositPayment[];
  totalPaidCents: number;
  totalRefundedCents: number;
};

type OrderRowRaw = Omit<ReservationOrder, "order_items"> & {
  order_items: ReservationOrderItem[] | null;
};

export function useReservationPayments(reservationId: string | null) {
  const [data, setData] = useState<ReservationPayments | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPayments = useCallback(async () => {
    if (!reservationId || !isSupabaseConfigured()) {
      setData(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const client = getSupabaseBrowserClient();

    const [ordersRes, depositsRes] = await Promise.all([
      client
        .from("orders")
        .select(
          "id, status, total_amount, stripe_payment_intent_id, is_preorder, order_items(id, name, quantity, unit_price)",
        )
        .eq("reservation_id", reservationId),
      client
        .from("reservation_deposit_payments")
        .select("id, amount_cents, status, payer_full_name, paid_at")
        .eq("reservation_id", reservationId),
    ]);

    const orders: ReservationOrder[] = ((ordersRes.data as OrderRowRaw[] | null) ?? []).map(
      (row) => ({
        ...row,
        order_items: row.order_items ?? [],
      }),
    );
    const deposits = (depositsRes.data as ReservationDepositPayment[] | null) ?? [];

    const paidCents =
      orders
        .filter((o) => o.status === "paid")
        .reduce((s, o) => s + Math.round(Number(o.total_amount ?? 0) * 100), 0) +
      deposits
        .filter((d) => d.status === "charged")
        .reduce((s, d) => s + (d.amount_cents ?? 0), 0);
    const refundedCents =
      orders
        .filter((o) => o.status === "refunded")
        .reduce((s, o) => s + Math.round(Number(o.total_amount ?? 0) * 100), 0) +
      deposits
        .filter((d) => d.status === "refunded")
        .reduce((s, d) => s + (d.amount_cents ?? 0), 0);

    setData({
      orders,
      deposits,
      totalPaidCents: paidCents,
      totalRefundedCents: refundedCents,
    });
    setLoading(false);
  }, [reservationId]);

  useEffect(() => {
    void fetchPayments();
  }, [fetchPayments]);

  return { data, loading, refresh: fetchPayments };
}
