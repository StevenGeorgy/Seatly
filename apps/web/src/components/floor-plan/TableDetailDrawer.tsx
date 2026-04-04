import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { SectionRow, TableRow } from "@/hooks/useFloorPlan";
import { getStatusColor } from "@/lib/canvas-colors";

import { tableFloorPlanTitle } from "./table-title";

type TableDetailDrawerProps = {
  table: TableRow | null;
  sections: SectionRow[];
  onClose: () => void;
  onUpdateStatus: (tableId: string, status: string, seatedCount?: number) => void;
};

const STATUS_LABEL_KEYS: Record<string, string> = {
  empty: "dashboard.floorPlan.statusEmpty",
  reserved: "dashboard.floorPlan.statusReserved",
  occupied: "dashboard.floorPlan.statusOccupied",
  cleaning: "dashboard.floorPlan.statusCleaning",
  blocked: "dashboard.floorPlan.statusBlocked",
};

export function TableDetailDrawer({
  table,
  sections,
  onClose,
  onUpdateStatus,
}: TableDetailDrawerProps) {
  const { t } = useTranslation();
  const [guestCount, setGuestCount] = useState<number | null>(null);

  const sectionName = table
    ? (sections.find((s) => s.id === table.section_id)?.name ?? table.section ?? "–")
    : "–";

  const statusColor = table ? getStatusColor(table.status) : "#fff";

  // Reset guest count when table changes
  const effectiveGuestCount = guestCount ?? table?.capacity ?? 1;

  return (
    <Sheet open={!!table} onOpenChange={(open) => { if (!open) { setGuestCount(null); onClose(); } }}>
      <SheetContent side="right" className="flex w-80 flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-base font-semibold">
            {table ? tableFloorPlanTitle(t, table) : t("dashboard.floorPlan.tableTitleFormat", {
              number: t("dashboard.floorPlan.tableIdPlaceholder"),
            })}
          </SheetTitle>
        </SheetHeader>

        {table && (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            {/* Status chip */}
            <div className="flex items-center gap-2">
              <span
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: statusColor }}
              />
              <span className="text-sm font-medium capitalize text-text-primary">
                {t(STATUS_LABEL_KEYS[table.status] ?? table.status)}
              </span>
            </div>

            {/* Details grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  {t("dashboard.floorPlan.section")}
                </p>
                <p className="mt-0.5 text-text-primary">{sectionName}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  {t("dashboard.floorPlan.capacity")}
                </p>
                <p className="mt-0.5 text-text-primary">{table.capacity}</p>
              </div>
              {table.status === "occupied" && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    Seated
                  </p>
                  <p className="mt-0.5 text-text-primary">
                    {table.seated_count ?? 0} / {table.capacity}
                  </p>
                </div>
              )}
              {table.label && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    {t("dashboard.floorPlan.tableLabel")}
                  </p>
                  <p className="mt-0.5 text-text-primary">{table.label}</p>
                </div>
              )}
              {table.min_party && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    {t("dashboard.floorPlan.minParty")}
                  </p>
                  <p className="mt-0.5 text-text-primary">{table.min_party}</p>
                </div>
              )}
            </div>

            {/* Notes */}
            {table.notes && (
              <div className="rounded-lg border border-border bg-bg-elevated px-3 py-2.5">
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">
                  {t("dashboard.floorPlan.notes")}
                </p>
                <p className="text-sm text-text-secondary">{table.notes}</p>
              </div>
            )}

            {/* Action buttons */}
            <div className="mt-auto flex flex-col gap-2 pt-2">
              {table.status === "empty" && (
                <>
                  {/* Guest count selector */}
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-text-muted">Guests:</label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="flex size-7 items-center justify-center rounded-md border border-border bg-bg-elevated text-sm font-medium text-text-primary hover:bg-bg-surface"
                        onClick={() => setGuestCount(Math.max(1, effectiveGuestCount - 1))}
                      >
                        −
                      </button>
                      <span className="w-8 text-center text-sm font-semibold text-text-primary">
                        {effectiveGuestCount}
                      </span>
                      <button
                        type="button"
                        className="flex size-7 items-center justify-center rounded-md border border-border bg-bg-elevated text-sm font-medium text-text-primary hover:bg-bg-surface"
                        onClick={() => setGuestCount(Math.min(table.capacity, effectiveGuestCount + 1))}
                      >
                        +
                      </button>
                    </div>
                    <span className="text-xs text-text-muted">/ {table.capacity}</span>
                  </div>
                  <Button
                    className="w-full justify-start gap-2"
                    onClick={() => {
                      onUpdateStatus(table.id, "occupied", effectiveGuestCount);
                      setGuestCount(null);
                    }}
                  >
                    {t("dashboard.floorPlan.seatGuest")}
                  </Button>
                </>
              )}
              {table.status === "occupied" && (
                <>
                  {/* Adjust seated count */}
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-text-muted">Seated:</label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="flex size-7 items-center justify-center rounded-md border border-border bg-bg-elevated text-sm font-medium text-text-primary hover:bg-bg-surface"
                        onClick={() => {
                          const newCount = Math.max(1, (table.seated_count ?? table.capacity) - 1);
                          onUpdateStatus(table.id, "occupied", newCount);
                        }}
                      >
                        −
                      </button>
                      <span className="w-8 text-center text-sm font-semibold text-text-primary">
                        {table.seated_count ?? table.capacity}
                      </span>
                      <button
                        type="button"
                        className="flex size-7 items-center justify-center rounded-md border border-border bg-bg-elevated text-sm font-medium text-text-primary hover:bg-bg-surface"
                        onClick={() => {
                          const newCount = Math.min(table.capacity, (table.seated_count ?? 0) + 1);
                          onUpdateStatus(table.id, "occupied", newCount);
                        }}
                      >
                        +
                      </button>
                    </div>
                    <span className="text-xs text-text-muted">/ {table.capacity}</span>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2"
                    onClick={() => onUpdateStatus(table.id, "cleaning", 0)}
                  >
                    {t("dashboard.floorPlan.markCleaning")}
                  </Button>
                </>
              )}
              {table.status === "cleaning" && (
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={() => onUpdateStatus(table.id, "empty", 0)}
                >
                  {t("dashboard.floorPlan.clearTable")}
                </Button>
              )}
              {table.status === "blocked" ? (
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={() => onUpdateStatus(table.id, "empty", 0)}
                >
                  {t("dashboard.floorPlan.unblockTable")}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-2 text-text-muted hover:text-text-primary"
                  onClick={() => onUpdateStatus(table.id, "blocked", 0)}
                >
                  {t("dashboard.floorPlan.blockTable")}
                </Button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
