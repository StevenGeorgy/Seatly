import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import {
  Armchair,
  Ban,
  CalendarClock,
  Link2,
  MapPin,
  Pencil,
  UserRound,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SectionRow, TableRow } from "@/hooks/useFloorPlan";
import { cn } from "@/lib/utils";
import { getStatusColor } from "@/lib/canvas-colors";

import { tableFloorPlanTitle } from "./table-title";

const STATUS_LABEL_KEYS: Record<string, string> = {
  empty: "dashboard.floorPlan.statusEmpty",
  reserved: "dashboard.floorPlan.statusReserved",
  occupied: "dashboard.floorPlan.statusOccupied",
  cleaning: "dashboard.floorPlan.statusCleaning",
  blocked: "dashboard.floorPlan.statusBlocked",
};

const EM_DASH = "—";

export type LiveServiceTablePanelProps = {
  table: TableRow;
  sections: SectionRow[];
  /** From layout zones — null if table center is outside all zones */
  zoneLabel: string | null;
  onUpdateStatus: (tableId: string, status: string, seatedCount?: number) => void;
  onCombine: () => void;
  onEditTable?: () => void;
  canEdit: boolean;
  /** Live = in-service; edit = floor plan edit session (draft updates) */
  variant?: "live" | "edit";
};

const outlineAction =
  "h-10 w-full gap-2 border-gold/35 bg-bg-elevated/55 text-text-primary shadow-sm shadow-black/30 transition-all hover:border-gold/55 hover:bg-gold/[0.07] hover:shadow-gold/5";
const primaryAction =
  "h-11 w-full gap-2 bg-gold text-bg-base shadow-md shadow-gold/25 transition-all hover:bg-gold/90";

function DetailRow({
  icon: Icon,
  label,
  value,
  valueClassName,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2 text-text-muted">
        <Icon className="size-3.5 shrink-0 text-gold/65" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <div className={cn("max-w-[60%] text-right text-sm font-medium text-text-primary", valueClassName)}>
        {value}
      </div>
    </div>
  );
}

/**
 * Table control board — right rail and mobile sheet. Distinct layout from floor overview.
 */
export function LiveServiceTablePanel({
  table,
  sections,
  zoneLabel,
  onUpdateStatus,
  onCombine,
  onEditTable,
  canEdit,
  variant = "live",
}: LiveServiceTablePanelProps) {
  const { t } = useTranslation();
  const [guestCount, setGuestCount] = useState<number | null>(null);

  const sectionName =
    sections.find((s) => s.id === table.section_id)?.name ?? table.section ?? EM_DASH;
  const statusColor = getStatusColor(table.status);
  const effectiveGuestCount = guestCount ?? table.capacity ?? 1;
  const statusLabel = t(STATUS_LABEL_KEYS[table.status] ?? table.status);

  const displayParty =
    table.status === "occupied"
      ? table.seated_count ?? 0
      : table.status === "reserved"
        ? table.capacity
        : effectiveGuestCount;

  const notesText = table.notes?.trim() ? table.notes : t("dashboard.floorPlan.inspectorNotesEmpty");

  const turnLine =
    table.status === "occupied"
      ? t("dashboard.floorPlan.inspectorTurnOccupied", { duration: EM_DASH })
      : t("dashboard.floorPlan.inspectorTurnAvailable");

  const zoneDisplay = zoneLabel ?? t("dashboard.floorPlan.inspectorZoneUnplaced");
  const eyebrow =
    variant === "edit"
      ? t("dashboard.floorPlan.tableControlEyebrowEdit")
      : t("dashboard.floorPlan.tableControlEyebrow");

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg-surface">
      {/* TOP — distinct control header */}
      <header className="shrink-0 border-b border-gold/25 bg-gradient-to-b from-gold/[0.07] via-bg-elevated/50 to-bg-surface px-5 pb-5 pt-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold/85">{eyebrow}</p>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight text-text-primary">
              {tableFloorPlanTitle(t, table)}
            </h2>
            {table.label?.trim() ? (
              <p className="mt-1 truncate text-sm text-text-secondary">{table.label.trim()}</p>
            ) : null}
            <p className="mt-2 text-lg font-semibold text-gold/90">
              {t("dashboard.floorPlan.inspectorSeatCount", { count: table.capacity })}
            </p>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 gap-2 self-start border-gold/40 bg-gold/12 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-gold-light sm:self-end"
          >
            <span
              className="size-2.5 rounded-full ring-2 ring-gold/45"
              style={{ backgroundColor: statusColor }}
              aria-hidden
            />
            {statusLabel}
          </Badge>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* DETAIL — single session card */}
        <Card size="sm" className="border-border/80 bg-bg-elevated/40 shadow-inner shadow-black/25">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              {t("dashboard.floorPlan.inspectorSessionDetailTitle")}
            </CardTitle>
            <CardDescription className="text-[11px] text-text-muted">
              {t("dashboard.floorPlan.inspectorSessionDetailSubtitle")}
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border/60 pt-0">
            <DetailRow
              icon={CalendarClock}
              label={t("dashboard.floorPlan.inspectorReservationTime")}
              value={EM_DASH}
              valueClassName="tabular-nums"
            />
            <DetailRow icon={UserRound} label={t("dashboard.floorPlan.guestName")} value={EM_DASH} />
            <DetailRow
              icon={Users}
              label={t("dashboard.floorPlan.inspectorPartySizeLabel")}
              value={displayParty}
              valueClassName="tabular-nums"
            />
            <DetailRow icon={MapPin} label={t("dashboard.floorPlan.section")} value={sectionName} />
            <DetailRow icon={Armchair} label={t("dashboard.floorPlan.inspectorZoneLabel")} value={zoneDisplay} />
            <DetailRow icon={UserRound} label={t("dashboard.floorPlan.serverAssigned")} value={EM_DASH} />
            <div className="py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                {t("dashboard.floorPlan.notes")}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{notesText}</p>
            </div>
            <div className="py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                {t("dashboard.floorPlan.inspectorTurnTitle")}
              </p>
              <p className="mt-1.5 text-sm font-medium text-text-primary">{turnLine}</p>
            </div>
          </CardContent>
        </Card>

        {/* ACTIONS */}
        <div>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
            {t("dashboard.floorPlan.inspectorQuickActions")}
          </p>
          <div className="flex flex-col gap-2.5">
            {table.status === "empty" && (
              <>
                <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-bg-elevated/30 px-3 py-2">
                  <span className="text-xs font-medium text-text-muted">
                    {t("dashboard.floorPlan.guestsLabel")}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      className="flex size-8 items-center justify-center rounded-md border border-border bg-bg-base text-sm font-medium text-text-primary transition-colors hover:bg-bg-elevated"
                      onClick={() => setGuestCount(Math.max(1, effectiveGuestCount - 1))}
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-sm font-semibold tabular-nums text-text-primary">
                      {effectiveGuestCount}
                    </span>
                    <button
                      type="button"
                      className="flex size-8 items-center justify-center rounded-md border border-border bg-bg-base text-sm font-medium text-text-primary transition-colors hover:bg-bg-elevated"
                      onClick={() =>
                        setGuestCount(Math.min(table.capacity, effectiveGuestCount + 1))
                      }
                    >
                      +
                    </button>
                  </div>
                  <span className="text-xs text-text-muted">/ {table.capacity}</span>
                </div>
                <Button
                  className={primaryAction}
                  onClick={() => {
                    onUpdateStatus(table.id, "occupied", effectiveGuestCount);
                    setGuestCount(null);
                  }}
                >
                  <Users className="size-4" aria-hidden />
                  {t("dashboard.floorPlan.seatGuest")}
                </Button>
              </>
            )}

            {(table.status === "empty" || table.status === "reserved") && (
              <Button
                variant="outline"
                className={outlineAction}
                onClick={() =>
                  onUpdateStatus(
                    table.id,
                    "occupied",
                    table.status === "reserved" ? table.capacity : effectiveGuestCount,
                  )
                }
              >
                <Armchair className="size-4 text-gold" aria-hidden />
                {t("dashboard.floorPlan.actionMarkOccupied")}
              </Button>
            )}

            {table.status === "occupied" && (
              <>
                <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-bg-elevated/30 px-3 py-2">
                  <span className="text-xs font-medium text-text-muted">
                    {t("dashboard.floorPlan.seatedLabel")}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      className="flex size-8 items-center justify-center rounded-md border border-border bg-bg-base text-sm font-medium text-text-primary transition-colors hover:bg-bg-elevated"
                      onClick={() => {
                        const newCount = Math.max(1, (table.seated_count ?? table.capacity) - 1);
                        onUpdateStatus(table.id, "occupied", newCount);
                      }}
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-sm font-semibold tabular-nums text-text-primary">
                      {table.seated_count ?? table.capacity}
                    </span>
                    <button
                      type="button"
                      className="flex size-8 items-center justify-center rounded-md border border-border bg-bg-base text-sm font-medium text-text-primary transition-colors hover:bg-bg-elevated"
                      onClick={() => {
                        const newCount = Math.min(
                          table.capacity,
                          (table.seated_count ?? 0) + 1,
                        );
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
                  className={outlineAction}
                  onClick={() => onUpdateStatus(table.id, "cleaning", 0)}
                >
                  {t("dashboard.floorPlan.markCleaning")}
                </Button>
              </>
            )}

            {table.status === "cleaning" && (
              <Button
                variant="outline"
                className={outlineAction}
                onClick={() => onUpdateStatus(table.id, "empty", 0)}
              >
                {t("dashboard.floorPlan.clearTable")}
              </Button>
            )}

            {table.status === "blocked" ? (
              <Button
                variant="outline"
                className={outlineAction}
                onClick={() => onUpdateStatus(table.id, "empty", 0)}
              >
                {t("dashboard.floorPlan.unblockTable")}
              </Button>
            ) : table.status === "empty" ? (
              <Button variant="outline" className={outlineAction} onClick={() => onUpdateStatus(table.id, "blocked", 0)}>
                <Ban className="size-3.5" aria-hidden />
                {t("dashboard.floorPlan.blockTable")}
              </Button>
            ) : table.status === "cleaning" ? (
              <Button variant="outline" className={outlineAction} onClick={() => onUpdateStatus(table.id, "blocked", 0)}>
                <Ban className="size-3.5" aria-hidden />
                {t("dashboard.floorPlan.blockTable")}
              </Button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className={cn(outlineAction, "w-auto")}
                  onClick={() => onUpdateStatus(table.id, "empty", 0)}
                >
                  {t("dashboard.floorPlan.actionMarkEmpty")}
                </Button>
                <Button
                  variant="outline"
                  className={cn(outlineAction, "w-auto")}
                  onClick={() => onUpdateStatus(table.id, "blocked", 0)}
                >
                  <Ban className="size-3.5" aria-hidden />
                  {t("dashboard.floorPlan.blockTable")}
                </Button>
              </div>
            )}

            <Button variant="outline" className={outlineAction} onClick={onCombine}>
              <Link2 className="size-4 text-gold" aria-hidden />
              {t("dashboard.floorPlan.actionCombineTable")}
            </Button>

            {canEdit && onEditTable ? (
              <Button variant="outline" className={outlineAction} onClick={onEditTable}>
                <Pencil className="size-4 text-gold/90" aria-hidden />
                {t("dashboard.floorPlan.actionEditTable")}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
