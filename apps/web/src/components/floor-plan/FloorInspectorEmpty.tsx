import { useTranslation } from "react-i18next";
import { LayoutGrid, Map, Sparkles } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { SectionRow } from "@/hooks/useFloorPlan";
import { getStatusColor } from "@/lib/canvas-colors";
import { cn } from "@/lib/utils";

import { StatusLegend } from "./StatusLegend";
import type { FloorPlanMode } from "./types";

const STATUS_KEYS = [
  { id: "empty", labelKey: "dashboard.floorPlan.statusEmpty" },
  { id: "reserved", labelKey: "dashboard.floorPlan.statusReserved" },
  { id: "occupied", labelKey: "dashboard.floorPlan.statusOccupied" },
  { id: "cleaning", labelKey: "dashboard.floorPlan.statusCleaning" },
  { id: "blocked", labelKey: "dashboard.floorPlan.statusBlocked" },
] as const;

type StatusCounts = {
  empty: number;
  reserved: number;
  occupied: number;
  cleaning: number;
  blocked: number;
};

const ZERO_COUNTS: StatusCounts = {
  empty: 0,
  reserved: 0,
  occupied: 0,
  cleaning: 0,
  blocked: 0,
};

type FloorInspectorEmptyProps = {
  mode: FloorPlanMode;
  sections: SectionRow[];
  selectedSectionId: string;
  showGrid: boolean;
  snapEnabled: boolean;
  tableCount: number;
  zoneCount: number;
  statusCounts: StatusCounts;
};

/**
 * Right column when no table is selected — operational floor overview.
 */
export function FloorInspectorEmpty({
  mode,
  sections,
  selectedSectionId,
  showGrid,
  snapEnabled,
  tableCount,
  zoneCount,
  statusCounts,
}: FloorInspectorEmptyProps) {
  const { t } = useTranslation();
  const active = sections.filter((s) => s.is_active);
  const current = active.find((s) => s.id === selectedSectionId);
  const counts = { ...ZERO_COUNTS, ...statusCounts };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-surface">
      <header className="shrink-0 border-b border-gold/15 bg-gradient-to-b from-bg-elevated/80 to-bg-surface px-4 pb-4 pt-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-gold/25 bg-gold/[0.06]">
            <Sparkles className="size-5 text-gold" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold/80">
              {t("dashboard.floorPlan.inspectorFloorBoardTitle")}
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-text-primary">
              {current?.name ?? t("dashboard.floorPlan.fieldEmDash")}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              {t("dashboard.floorPlan.inspectorFloorSnapshotIntro")}
            </p>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <Card
          size="sm"
          className="border-border/80 bg-bg-elevated/35 shadow-inner shadow-black/15"
        >
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Map className="size-4 text-gold/80" aria-hidden />
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {t("dashboard.floorPlan.inspectorFloorTitle")}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 pt-0">
            <div className="rounded-lg border border-border/70 bg-bg-base/50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {t("dashboard.floorPlan.inspectorTablesTotalLabel")}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
                {tableCount}
              </p>
            </div>
            <div className="rounded-lg border border-border/70 bg-bg-base/50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {t("dashboard.floorPlan.inspectorZonesCountLabel")}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
                {zoneCount}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card size="sm" className="border-border/80 bg-bg-elevated/30">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <LayoutGrid className="size-4 text-gold/80" aria-hidden />
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {t("dashboard.floorPlan.inspectorStatusSummaryTitle")}
              </CardTitle>
            </div>
            <CardDescription className="text-[11px] text-text-muted">
              {t("dashboard.floorPlan.legendTitle")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {STATUS_KEYS.map(({ id, labelKey }) => {
              const n = counts[id as keyof StatusCounts];
              const color = getStatusColor(id);
              return (
                <div
                  key={id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-bg-base/40 px-2.5 py-1.5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full ring-1 ring-border/60"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    />
                    <span className="truncate text-xs font-medium text-text-secondary">
                      {t(labelKey)}
                    </span>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">
                    {n}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            {t("dashboard.floorPlan.viewOptions")}
          </p>
          <div className="space-y-1.5 rounded-lg border border-border/60 bg-bg-elevated/30 px-3 py-2.5 text-xs text-text-secondary">
            <div className="flex justify-between gap-2">
              <span>{t("dashboard.floorPlan.toggleGrid")}</span>
              <span className="font-medium tabular-nums text-gold/90">
                {showGrid ? t("dashboard.floorPlan.stateOn") : t("dashboard.floorPlan.stateOff")}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span>{t("dashboard.floorPlan.toggleSnap")}</span>
              <span className="font-medium tabular-nums text-gold/90">
                {snapEnabled ? t("dashboard.floorPlan.stateOn") : t("dashboard.floorPlan.stateOff")}
              </span>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            {t("dashboard.floorPlan.legendTitle")}
          </p>
          <StatusLegend />
        </div>

        <Separator className="bg-border/50" />

        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            {t("dashboard.floorPlan.sectionsTitle")}
          </p>
          <ul className="space-y-1.5 text-xs text-text-secondary">
            {active.map((s) => (
              <li
                key={s.id}
                className={cn(
                  "rounded-md px-2 py-1",
                  s.id === selectedSectionId
                    ? "border border-gold/25 bg-gold/[0.06] font-medium text-gold/90"
                    : "text-text-muted",
                )}
              >
                {s.name}
              </li>
            ))}
          </ul>
        </div>

        <p
          className={cn(
            "text-xs leading-relaxed text-text-muted",
            mode === "edit" && "rounded-lg border border-border/40 bg-bg-elevated/25 px-3 py-2.5",
          )}
        >
          {mode === "edit"
            ? t("dashboard.floorPlan.inspectorHintEdit")
            : t("dashboard.floorPlan.inspectorHintLive")}
        </p>
        {mode === "edit" && (
          <p className="text-[11px] leading-snug text-text-muted/90">
            {t("dashboard.floorPlan.marqueeSelectHint")}
          </p>
        )}

        <div className="mt-auto rounded-lg border border-dashed border-gold/20 bg-gold/[0.03] px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gold/80">
            {t("dashboard.floorPlan.floorSettingsTitle")}
          </p>
          <p className="mt-1 text-xs text-text-muted">{t("dashboard.floorPlan.floorSettingsHint")}</p>
        </div>

        <p className="text-[11px] leading-snug text-text-muted/90">
          {t("dashboard.floorPlan.inspectorFloorOpsHint")}
        </p>
      </div>
    </div>
  );
}
