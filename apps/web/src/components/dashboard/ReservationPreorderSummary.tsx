// 2026-05-29: owner-side pre-order visibility in the reservation detail dialog.
//
// Renders the food a diner ordered ahead (order_items) plus a food subtotal,
// tax (if any), and the order's paid/refunded status. Mirrors the look of
// ReservationDepositBreakdown so the two sit consistently in the same dialog.
//
// Amounts here are DOLLARS (numeric from orders/order_items), unlike the
// deposit rows which are cents. order_items.name is denormalized, so no
// menu_items lookup is needed. We intentionally show the food subtotal
// (sum of line_total) rather than orders.total_amount — for combined
// pre-order+deposit bookings that total bundles the deposit too.

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type PreorderItem = {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  status: string | null;
};

type PreorderOrder = {
  id: string;
  status: string | null;
  tax_amount: number | null;
  order_items?: PreorderItem[] | null;
};

interface ReservationPreorderSummaryProps {
  orders: PreorderOrder[] | null | undefined;
  className?: string;
}

function fmt(dollars: number): string {
  return `$${(dollars ?? 0).toFixed(2)}`;
}

function statusBadge(status: string | null) {
  const lower = (status ?? "").toLowerCase();
  if (lower === "paid" || lower === "charged") {
    return (
      <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
        Paid
      </Badge>
    );
  }
  if (lower === "pending") {
    return (
      <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100">
        Pending
      </Badge>
    );
  }
  if (lower === "refunded") {
    return (
      <Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-100">
        Refunded
      </Badge>
    );
  }
  if (lower === "failed") {
    return (
      <Badge variant="secondary" className="bg-rose-100 text-rose-700 hover:bg-rose-100">
        Failed
      </Badge>
    );
  }
  return status ? <Badge variant="outline">{status}</Badge> : null;
}

export function ReservationPreorderSummary({
  orders,
  className,
}: ReservationPreorderSummaryProps) {
  // Only orders that actually have food lines; skip $0/0-item deposit-only
  // placeholder orders.
  const withItems = (orders ?? []).filter(
    (o) => (o.order_items?.length ?? 0) > 0,
  );
  if (withItems.length === 0) return null;

  return (
    <div className={cn("space-y-3 text-sm", className)}>
      {withItems.map((o) => {
        const items = o.order_items ?? [];
        const subtotal = items.reduce((s, it) => s + (it.line_total ?? 0), 0);
        const tax = o.tax_amount ?? 0;
        return (
          <div key={o.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Items</span>
              {statusBadge(o.status)}
            </div>
            <ul className="space-y-1.5 rounded-md border bg-muted/30 p-2">
              {items.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {it.quantity} × {it.name}
                  </span>
                  <span className="tabular-nums shrink-0">{fmt(it.line_total)}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{fmt(subtotal)}</span>
            </div>
            {tax > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Tax</span>
                <span className="tabular-nums">{fmt(tax)}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
