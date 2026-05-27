import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type ReservationOrderItem = {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
  /**
   * Source menu item id. Nullable for legacy rows or one-off custom items.
   * Needed by the Edit-pre-order modal so we can re-hydrate the cart
   * against the current live menu instead of the snapshot.
   */
  menu_item_id: string | null;
};

export type ReservationOrder = {
  id: string;
  status: string;
  total_amount: number | null;
  stripe_payment_intent_id: string | null;
  is_preorder: boolean | null;
  // 2026-05-28: card brand + last4 snapshot stamped by stripe-webhook on
  // payment_intent.succeeded. NULL on historical rows that pre-date the
  // column.
  card_brand: string | null;
  card_last4: string | null;
  order_items: ReservationOrderItem[];
};

export type ReservationDepositPayment = {
  id: string;
  amount_cents: number;
  status: string;
  payer_full_name: string | null;
  payer_email: string | null;
  paid_at: string | null;
  // 2026-05-28: per-payer card snapshot — surfaces in the split-tender
  // breakdown ("Sara · Visa ending 4242"). NULL on historical rows.
  card_brand: string | null;
  card_last4: string | null;
};

// 2026-05-28: enriched reservation fields needed for the
// "Payment & contact details" section. Pulled in the same hook so the
// detail page only mounts one hook for everything payment-adjacent.
export type ReservationContactSnapshot = {
  guest_email: string | null;
  guest_phone: string | null;
  applied_promo_code: string | null;
  reserved_at: string | null;
  party_size: number | null;
  deposit_amount_cents: number | null;
  deposit_status: string | null;
};

export type ReservationRestaurantSnapshot = {
  tax_rate: number | null;
  province: string | null;
  // DB column name is `cancellation_hours`. The current policy is "any
  // cancel before the reservation gets a full refund" but we still
  // surface the configured window as the cutoff for full refund.
  // Defaults to 24h when NULL.
  cancellation_hours: number | null;
};

export type ReservationPayments = {
  orders: ReservationOrder[];
  deposits: ReservationDepositPayment[];
  totalPaidCents: number;
  totalRefundedCents: number;
  // Snapshot of fields used by the contact/cancellation card. NULL when
  // the reservation row isn't readable (shouldn't happen for the
  // logged-in caller, but kept defensive).
  reservation: ReservationContactSnapshot | null;
  restaurant: ReservationRestaurantSnapshot | null;
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

    // 2026-05-28: alongside orders + deposits, fetch the reservation row
    // fields used by the "Payment & contact details" card. RLS already
    // restricts visibility to the diner who owns the row.
    const [ordersRes, depositsRes, reservationRes] = await Promise.all([
      client
        .from("orders")
        .select(
          "id, status, total_amount, stripe_payment_intent_id, is_preorder, card_brand, card_last4, order_items(id, name, quantity, unit_price, menu_item_id)",
        )
        .eq("reservation_id", reservationId),
      client
        .from("reservation_deposit_payments")
        .select(
          "id, amount_cents, status, payer_full_name, payer_email, paid_at, card_brand, card_last4",
        )
        .eq("reservation_id", reservationId),
      client
        .from("reservations")
        .select(
          "guest_email, guest_phone, applied_promo_code, reserved_at, party_size, deposit_amount_cents, deposit_status, restaurant:restaurants(tax_rate, province, cancellation_hours)",
        )
        .eq("id", reservationId)
        .maybeSingle(),
    ]);

    const orders: ReservationOrder[] = ((ordersRes.data as OrderRowRaw[] | null) ?? []).map(
      (row) => ({
        ...row,
        order_items: row.order_items ?? [],
      }),
    );
    const deposits = (depositsRes.data as ReservationDepositPayment[] | null) ?? [];

    type ReservationRowRaw = {
      guest_email: string | null;
      guest_phone: string | null;
      applied_promo_code: string | null;
      reserved_at: string | null;
      party_size: number | null;
      deposit_amount_cents: number | null;
      deposit_status: string | null;
      restaurant:
        | ReservationRestaurantSnapshot
        | ReservationRestaurantSnapshot[]
        | null;
    };
    const rRow = (reservationRes.data as ReservationRowRaw | null) ?? null;
    const reservationSnapshot: ReservationContactSnapshot | null = rRow
      ? {
          guest_email: rRow.guest_email,
          guest_phone: rRow.guest_phone,
          applied_promo_code: rRow.applied_promo_code,
          reserved_at: rRow.reserved_at,
          party_size: rRow.party_size,
          deposit_amount_cents: rRow.deposit_amount_cents,
          deposit_status: rRow.deposit_status,
        }
      : null;
    const restaurantSnapshot: ReservationRestaurantSnapshot | null = (() => {
      if (!rRow) return null;
      const r = Array.isArray(rRow.restaurant) ? rRow.restaurant[0] ?? null : rRow.restaurant;
      if (!r) return null;
      return {
        tax_rate: r.tax_rate ?? null,
        province: r.province ?? null,
        cancellation_hours: r.cancellation_hours ?? null,
      };
    })();

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
      reservation: reservationSnapshot,
      restaurant: restaurantSnapshot,
    });
    setLoading(false);
  }, [reservationId]);

  useEffect(() => {
    void fetchPayments();
  }, [fetchPayments]);

  return { data, loading, refresh: fetchPayments };
}
