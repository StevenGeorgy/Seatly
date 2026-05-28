// 2026-05-28 (PR-K): owner-side split-tender visibility.
//
// Renders the per-payer deposit breakdown for a reservation. Mounted in
// the dashboard reservation detail dialog. Solo bookings render a
// single line; split-tender renders a compact list with per-card status.

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type DepositRow = {
  id: string;
  amount_cents: number;
  status: string;
  payer_full_name: string | null;
  payer_email: string | null;
  stripe_payment_intent_id: string | null;
  paid_at: string | null;
};

interface ReservationDepositBreakdownProps {
  rows: DepositRow[] | null | undefined;
  className?: string;
}

function fmtAmount(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function statusBadge(status: string) {
  const lower = status.toLowerCase();
  if (lower === "charged" || lower === "paid") {
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
  return <Badge variant="outline">{status}</Badge>;
}

export function ReservationDepositBreakdown({
  rows,
  className,
}: ReservationDepositBreakdownProps) {
  const list = (rows ?? []).filter((r) => (r.amount_cents ?? 0) >= 0);
  if (list.length === 0) return null;

  const totalCents = list.reduce((s, r) => s + (r.amount_cents ?? 0), 0);
  const paidCents = list
    .filter((r) => r.status === "charged")
    .reduce((s, r) => s + (r.amount_cents ?? 0), 0);
  const paidCount = list.filter((r) => r.status === "charged").length;

  if (list.length === 1) {
    const r = list[0];
    return (
      <div className={cn("flex items-center justify-between text-sm", className)}>
        <div className="text-muted-foreground">Deposit</div>
        <div className="flex items-center gap-2">
          <span>{fmtAmount(r.amount_cents)}</span>
          {statusBadge(r.status)}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2 text-sm", className)}>
      <div className="flex items-center justify-between">
        <div className="text-muted-foreground">
          Split deposit — {paidCount}/{list.length} cards paid
        </div>
        <div className="font-medium">
          {fmtAmount(paidCents)} / {fmtAmount(totalCents)}
        </div>
      </div>
      <ul className="space-y-1.5 rounded-md border bg-muted/30 p-2">
        {list.map((r, i) => (
          <li key={r.id} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-muted-foreground w-6 shrink-0">#{i + 1}</span>
              <span className="truncate">
                {(r.payer_full_name ?? "").trim() ||
                  (r.payer_email ?? "").trim() ||
                  "Co-payer"}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="tabular-nums">{fmtAmount(r.amount_cents)}</span>
              {statusBadge(r.status)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
