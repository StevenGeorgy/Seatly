import { Download, Mail, Phone, Tag, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  usePromotionRedemptions,
  type EventAttendeeRow,
} from "@/hooks/useEventAttendees";
import type { PromotionRow } from "@/hooks/usePromotions";
import { getPromotionLabel } from "@/hooks/usePromotions";
import { formatCompactTimeLabelInTz } from "@/lib/utils/time";

type PromotionRedemptionsDialogProps = {
  promotion: PromotionRow | null;
  open: boolean;
  timezone: string | null;
  onOpenChange: (open: boolean) => void;
  onExport?: (promotion: PromotionRow) => void;
};

function formatLongDate(date: Date, timezone: string | null): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone ?? undefined,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function defaultHandler(label: string): () => void {
  return () => {
    if (typeof window !== "undefined") {
      window.alert(`${label} — coming soon`);
    }
  };
}

export function PromotionRedemptionsDialog({
  promotion,
  open,
  timezone,
  onOpenChange,
  onExport,
}: PromotionRedemptionsDialogProps) {
  const { redemptions, loading } = usePromotionRedemptions(
    promotion?.id ?? null,
  );
  const totalCovers = redemptions.reduce(
    (sum: number, row: EventAttendeeRow) => sum + row.party_size,
    0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border bg-bg-elevated/40 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-2">
              <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-gold">
                <Tag className="size-3.5" />
                Promo redemptions
              </div>
              <DialogTitle className="font-serif text-2xl text-white">
                {promotion?.title ?? "Promotion"}
              </DialogTitle>
              {promotion ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 bg-amber-500/10 text-amber-300"
                  >
                    {getPromotionLabel(promotion)}
                  </Badge>
                  {promotion.promo_code ? (
                    <Badge variant="outline" className="font-mono text-text-secondary">
                      Code · {promotion.promo_code}
                    </Badge>
                  ) : null}
                  {promotion.max_uses != null ? (
                    <Badge variant="secondary" className="bg-gold/15 text-gold">
                      {promotion.current_uses} / {promotion.max_uses} used
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="bg-gold/15 text-gold">
                      {promotion.current_uses} uses
                    </Badge>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 text-xs text-text-muted">
              <Users className="size-3.5" />
              {redemptions.length}{" "}
              {redemptions.length === 1 ? "reservation" : "reservations"} ·{" "}
              {totalCovers} {totalCovers === 1 ? "cover" : "covers"}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={() =>
                  promotion
                    ? (onExport ?? defaultHandler("Export list"))(promotion)
                    : null
                }
              >
                <Download className="size-3.5" />
                Export list
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto">
          {loading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : redemptions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
              <div className="flex size-12 items-center justify-center rounded-full border border-border bg-bg-elevated text-gold">
                <Tag className="size-5" />
              </div>
              <div>
                <p className="font-serif text-xl text-white">No redemptions yet</p>
                <p className="mt-1 max-w-md text-xs text-text-muted">
                  Reservations that apply this promotion will appear here.
                </p>
              </div>
            </div>
          ) : (
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-border bg-bg-elevated/20 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                  <th className="px-5 py-3 font-medium">Guest</th>
                  <th className="px-5 py-3 font-medium">Party</th>
                  <th className="px-5 py-3 font-medium">When</th>
                  <th className="px-5 py-3 font-medium">Table</th>
                  <th className="px-5 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {redemptions.map((row: EventAttendeeRow) => (
                  <tr key={row.id} className="text-sm">
                    <td className="px-5 py-4">
                      <p className="font-medium text-white">{row.full_name}</p>
                      <div className="mt-1 flex flex-col gap-0.5 text-[11px] text-text-muted">
                        {row.phone ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Phone className="size-3" />
                            {row.phone}
                          </span>
                        ) : null}
                        {row.email ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Mail className="size-3" />
                            {row.email}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-text-secondary">{row.party_size}</td>
                    <td className="px-5 py-4 font-mono text-gold">
                      <div className="flex flex-col">
                        <span>
                          {formatCompactTimeLabelInTz(new Date(row.reserved_at), timezone)}
                        </span>
                        <span className="font-sans text-[11px] text-text-muted">
                          {formatLongDate(new Date(row.reserved_at), timezone)}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-text-secondary">{row.table_label}</td>
                    <td className="px-5 py-4">
                      <div className="flex flex-col gap-1">
                        {row.occasion ? (
                          <Badge
                            variant="outline"
                            className="w-fit border-gold/30 bg-gold/10 text-gold"
                          >
                            {row.occasion}
                          </Badge>
                        ) : null}
                        <span className="text-xs text-text-muted">
                          {row.special_request || "—"}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
