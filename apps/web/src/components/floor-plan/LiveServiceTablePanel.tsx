import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Armchair, Ban, Minus, Pencil, Plus, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SectionRow, TableRow } from "@/hooks/useFloorPlan";
import { getStatusColor } from "@/lib/canvas-colors";
import { cn } from "@/lib/utils";

import { tableFloorPlanTitle } from "./table-title";

const STATUS_LABEL_KEYS: Record<string, string> = {
  empty: "dashboard.floorPlan.statusEmpty",
  reserved: "dashboard.floorPlan.statusReserved",
  occupied: "dashboard.floorPlan.statusOccupied",
  cleaning: "dashboard.floorPlan.statusCleaning",
  blocked: "dashboard.floorPlan.statusBlocked",
};

export type LiveServiceTablePanelProps = {
  table: TableRow;
  sections: SectionRow[];
  zoneLabel: string | null;
  onUpdateStatus: (tableId: string, status: string, seatedCount?: number) => void;
  onCombine: () => void;
  onEditTable?: () => void;
  onClose?: () => void;
  canEdit: boolean;
  variant?: "live" | "edit";
};

export function LiveServiceTablePanel({
  table,
  sections,
  zoneLabel,
  onUpdateStatus,
  onEditTable,
  onClose,
  canEdit,
  variant = "live",
}: LiveServiceTablePanelProps) {
  const { t } = useTranslation();
  const [guestCount, setGuestCount] = useState(table.seated_count ?? table.capacity ?? 1);

  const statusColor = getStatusColor(table.status);
  const statusLabel = t(STATUS_LABEL_KEYS[table.status] ?? table.status);
  const tableTitle = table.table_number?.trim() || table.label?.trim() || tableFloorPlanTitle(t, table);
  const sectionName = sections.find((section) => section.id === table.section_id)?.name ?? table.section;
  const capacity = table.capacity ?? 1;
  const isEdit = variant === "edit";

  const updateGuestCount = (next: number) => {
    const clamped = Math.max(1, Math.min(20, next));
    setGuestCount(clamped);
    if (table.status === "occupied") {
      onUpdateStatus(table.id, "occupied", Math.min(capacity, clamped));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-base p-4">
      <section
        className="rounded-xl border border-border/70 bg-bg-surface p-5 shadow-xl shadow-black/25"
        style={{ borderTopColor: statusColor }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">
              {t("dashboard.floorPlan.tableNumber")}
            </p>
            <h2 className="mt-1 font-serif text-5xl leading-none text-white">{tableTitle}</h2>
          </div>
          <button
            type="button"
            className="text-lg leading-none text-text-muted transition-colors hover:text-white"
            onClick={onClose}
            aria-label={t("common.actions.close")}
          >
            ×
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
            {statusLabel}
          </span>
          <span>{t("dashboard.floorPlan.inspectorSeatCount", { count: capacity })}</span>
        </div>

        {(sectionName || zoneLabel) && (
          <p className="mt-3 text-xs text-text-muted">
            {[sectionName, zoneLabel].filter(Boolean).join(" · ")}
          </p>
        )}

        <div className="mt-6 border-t border-border/60 pt-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
            {t(isEdit ? "dashboard.floorPlan.seats" : "dashboard.floorPlan.inspectorQuickActions")}
          </p>

          {isEdit ? (
            <div className="mt-3 flex items-center gap-3">
              <span className="w-10 font-serif text-3xl text-white">{guestCount}</span>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="rounded-lg bg-bg-base"
                  onClick={() => updateGuestCount(guestCount - 1)}
                >
                  <Minus className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="rounded-lg bg-bg-base"
                  onClick={() => updateGuestCount(guestCount + 1)}
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 grid gap-2">
              {(table.status === "empty" || table.status === "reserved") && (
                <Button
                  className="h-10 justify-start gap-2"
                  onClick={() => onUpdateStatus(table.id, "occupied", capacity)}
                >
                  <Users className="size-4" />
                  {t("dashboard.floorPlan.actionMarkOccupied")}
                </Button>
              )}
              {table.status === "occupied" && (
                <Button
                  variant="outline"
                  className="h-10 justify-start gap-2 border-border/70 bg-bg-base"
                  onClick={() => onUpdateStatus(table.id, "cleaning", 0)}
                >
                  <Armchair className="size-4 text-gold" />
                  {t("dashboard.floorPlan.markCleaning")}
                </Button>
              )}
              {table.status === "cleaning" && (
                <Button
                  variant="outline"
                  className="h-10 justify-start gap-2 border-border/70 bg-bg-base"
                  onClick={() => onUpdateStatus(table.id, "empty", 0)}
                >
                  <Armchair className="size-4 text-gold" />
                  {t("dashboard.floorPlan.clearTable")}
                </Button>
              )}
              <Button
                variant="outline"
                className={cn("h-10 justify-start gap-2 border-border/70 bg-bg-base", table.status === "blocked" && "text-gold")}
                onClick={() =>
                  onUpdateStatus(table.id, table.status === "blocked" ? "empty" : "blocked", 0)
                }
              >
                <Ban className="size-4 text-text-muted" />
                {t(table.status === "blocked" ? "dashboard.floorPlan.actionMarkEmpty" : "dashboard.floorPlan.blockTable")}
              </Button>
              {canEdit && onEditTable && (
                <Button
                  variant="outline"
                  className="h-10 justify-start gap-2 border-border/70 bg-bg-base"
                  onClick={onEditTable}
                >
                  <Pencil className="size-4 text-gold" />
                  {t("dashboard.floorPlan.editLayout")}
                </Button>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
