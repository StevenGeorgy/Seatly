import { useCallback, useEffect, useMemo, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * Live income rows derived from actual payments — not from the manually-
 * entered `expenses` table. Two sources:
 *
 *   1. `orders` rows with `paid_at IS NOT NULL` (POS, dine-in,
 *      pre-orders, delivery, etc.). `is_preorder=true` becomes
 *      `source: "order_preorder"`; everything else falls into a
 *      generic `order_*` bucket keyed off `order_type`.
 *   2. `reservation_deposit_payments` rows with `status='charged'`,
 *      scoped to the current restaurant via a follow-up query on
 *      `reservations.restaurant_id` since the payment table itself has
 *      no `restaurant_id` column.
 *
 * The Income & Expenses page merges these alongside manually-logged
 * income/expenses so the totals reflect what actually landed, not just
 * what the owner remembered to log. They're rendered read-only (no
 * edit/delete) because the source of truth lives in payment tables.
 */

export type AutoIncomeSource =
  | "order_preorder"
  | "order_dinein"
  | "order"
  | "deposit";

export type AutoIncomeCategory =
  | "preorders"
  | "sales"
  | "delivery"
  | "deposits"
  | "other";

export type AutoIncomeRow = {
  /** Synthetic key for React/CSV — never use this as a real foreign key. */
  id: string;
  paidAt: string;
  source: AutoIncomeSource;
  category: AutoIncomeCategory;
  amount: number;
  currency: string;
  payerName: string | null;
  reference: string | null;
  reservationId: string | null;
  orderId: string | null;
  depositPaymentId: string | null;
  paymentMethod: string | null;
  stripePaymentIntentId: string | null;
};

type OrderRow = {
  id: string;
  reservation_id: string | null;
  paid_at: string | null;
  created_at: string | null;
  order_type: string | null;
  is_preorder: boolean | null;
  payment_method: string | null;
  total_amount: number | string | null;
  confirmation_code: string | null;
  stripe_payment_intent_id: string | null;
};

type DepositRow = {
  id: string;
  reservation_id: string | null;
  payer_full_name: string | null;
  payer_email: string | null;
  amount_cents: number | null;
  status: string | null;
  stripe_payment_intent_id: string | null;
  paid_at: string | null;
};

function startOfDayIso(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const trimmed = dateStr.length === 10 ? `${dateStr}T00:00:00.000Z` : dateStr;
  return trimmed;
}

function endOfDayIso(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const trimmed = dateStr.length === 10 ? `${dateStr}T23:59:59.999Z` : dateStr;
  return trimmed;
}

function categoryForOrder(orderType: string | null, isPreorder: boolean | null): AutoIncomeCategory {
  if (isPreorder) return "preorders";
  if (!orderType) return "sales";
  const normalized = orderType.toLowerCase();
  if (normalized === "delivery") return "delivery";
  return "sales";
}

function sourceForOrder(orderType: string | null, isPreorder: boolean | null): AutoIncomeSource {
  if (isPreorder) return "order_preorder";
  if (!orderType) return "order";
  const normalized = orderType.toLowerCase();
  if (normalized === "pos" || normalized === "dine_in" || normalized === "dinein") return "order_dinein";
  return "order";
}

export type UseAutoIncomeFilters = {
  /** YYYY-MM-DD. Inclusive lower bound on `paid_at`. */
  dateFrom?: string;
  /** YYYY-MM-DD. Inclusive upper bound on `paid_at`. */
  dateTo?: string;
};

export function useAutoIncome(filters: UseAutoIncomeFilters): {
  rows: AutoIncomeRow[];
  loading: boolean;
  refetch: () => void;
} {
  const { selectedRestaurantId, selectedRestaurant } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const [rows, setRows] = useState<AutoIncomeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const dateFrom = filters.dateFrom;
  const dateTo = filters.dateTo;

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  const fromIso = useMemo(() => startOfDayIso(dateFrom), [dateFrom]);
  const toIso = useMemo(() => endOfDayIso(dateTo), [dateTo]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setRows([]);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    void (async () => {
      try {
        const client = getSupabaseBrowserClient();
        let oq = client
          .from("orders")
          .select("id, reservation_id, paid_at, created_at, order_type, is_preorder, payment_method, total_amount, confirmation_code, stripe_payment_intent_id")
          .eq("restaurant_id", selectedRestaurantId)
          .not("paid_at", "is", null)
          .order("paid_at", { ascending: false });
        if (fromIso) oq = oq.gte("paid_at", fromIso);
        if (toIso) oq = oq.lte("paid_at", toIso);
        const { data: orderRows } = await oq;

        let dq = client
          .from("reservation_deposit_payments")
          .select("id, reservation_id, payer_full_name, payer_email, amount_cents, status, stripe_payment_intent_id, paid_at")
          .eq("status", "charged")
          .not("paid_at", "is", null)
          .order("paid_at", { ascending: false });
        if (fromIso) dq = dq.gte("paid_at", fromIso);
        if (toIso) dq = dq.lte("paid_at", toIso);
        const { data: depositRows } = await dq;

        // `reservation_deposit_payments` has no `restaurant_id`. RLS
        // already scopes to rows the owner can see, but multi-restaurant
        // operators would otherwise see deposits from sibling rows.
        // Look up the matching `reservations` rows and filter client-
        // side to the active restaurant.
        const depositReservationIds = Array.from(
          new Set(
            ((depositRows ?? []) as DepositRow[])
              .map((r) => r.reservation_id)
              .filter((id): id is string => Boolean(id)),
          ),
        );
        let ownReservationIds = new Set<string>();
        if (depositReservationIds.length > 0) {
          const { data: scopedRes } = await client
            .from("reservations")
            .select("id")
            .eq("restaurant_id", selectedRestaurantId)
            .in("id", depositReservationIds);
          ownReservationIds = new Set(
            ((scopedRes ?? []) as Array<{ id: string }>).map((r) => r.id),
          );
        }

        const orderEntries: AutoIncomeRow[] = ((orderRows ?? []) as OrderRow[]).map((o) => ({
          id: `order:${o.id}`,
          paidAt: (o.paid_at ?? o.created_at ?? "").slice(0, 10),
          source: sourceForOrder(o.order_type, o.is_preorder),
          category: categoryForOrder(o.order_type, o.is_preorder),
          amount: typeof o.total_amount === "number" ? o.total_amount : Number(o.total_amount ?? 0),
          currency,
          payerName: null,
          reference: o.confirmation_code ?? o.id,
          reservationId: o.reservation_id ?? null,
          orderId: o.id,
          depositPaymentId: null,
          paymentMethod: o.payment_method ?? null,
          stripePaymentIntentId: o.stripe_payment_intent_id ?? null,
        }));

        const depositEntries: AutoIncomeRow[] = ((depositRows ?? []) as DepositRow[])
          .filter((d) => d.reservation_id && ownReservationIds.has(d.reservation_id))
          .map((d) => ({
            id: `deposit:${d.id}`,
            paidAt: (d.paid_at ?? "").slice(0, 10),
            source: "deposit" as const,
            category: "deposits" as const,
            amount: typeof d.amount_cents === "number" ? d.amount_cents / 100 : 0,
            currency,
            payerName: d.payer_full_name ?? d.payer_email ?? null,
            reference: d.stripe_payment_intent_id ?? d.id,
            reservationId: d.reservation_id ?? null,
            orderId: null,
            depositPaymentId: d.id,
            paymentMethod: "card",
            stripePaymentIntentId: d.stripe_payment_intent_id ?? null,
          }));

        if (cancelled) return;
        const merged = [...orderEntries, ...depositEntries].sort((a, b) =>
          (b.paidAt ?? "").localeCompare(a.paidAt ?? ""),
        );
        setRows(merged);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currency, fromIso, reloadKey, selectedRestaurantId, toIso]);

  return { rows, loading, refetch };
}
