import { useTranslation } from "react-i18next";
import { Activity, Eye, Layers } from "lucide-react";

import type { SectionRow } from "@/hooks/useFloorPlan";
import { getStatusColor } from "@/lib/canvas-colors";
import { cn } from "@/lib/utils";

import type { FloorPlanMode } from "./types";

const STATUS_KEYS = [
  { id: "empty",    labelKey: "dashboard.floorPlan.statusEmpty" },
  { id: "reserved", labelKey: "dashboard.floorPlan.statusReserved" },
  { id: "occupied", labelKey: "dashboard.floorPlan.statusOccupied" },
  { id: "cleaning", labelKey: "dashboard.floorPlan.statusCleaning" },
  { id: "blocked",  labelKey: "dashboard.floorPlan.statusBlocked" },
] as const;

type StatusCounts = {
  empty: number;
  reserved: number;
  occupied: number;
  cleaning: number;
  blocked: number;
};

const ZERO_COUNTS: StatusCounts = {
  empty: 0, reserved: 0, occupied: 0, cleaning: 0, blocked: 0,
};

type FloorInspectorEmptyProps = {
  mode: FloorPlanMode;
  sections: SectionRow[];
  selectedSectionId: string;
  showGrid: boolean;
  snapEnabled: boolean;
  tableCount: number;
  totalSeats: number;
  zoneCount: number;
  statusCounts: StatusCounts;
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted/70">
      {children}
    </p>
  );
}

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
  totalSeats,
  zoneCount,
  statusCounts,
}: FloorInspectorEmptyProps) {
  const { t } = useTranslation();
  const active = sections.filter((s) => s.is_active);
  const current = active.find((s) => s.id === selectedSectionId);
  const counts = { ...ZERO_COUNTS, ...statusCounts };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-surface">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border/60 px-4 py-3.5">
        <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-gold/80">
          {t("dashboard.floorPlan.inspectorFloorBoardTitle")}
        </p>
        <h2 className="mt-0.5 text-[15px] font-semibold leading-tight tracking-tight text-text-primary">
          {current?.name ?? "—"}
        </h2>
        <p className="mt-0.5 text-[11px] text-text-muted">
          {mode === "live"
            ? t("dashboard.floorPlan.inspectorHintLive")
            : t("dashboard.floorPlan.inspectorHintEdit")}
        </p>
      </div>

      {/* ── Scrollable body ────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">

        {/* ── Overview stats ─────────────────────────────────── */}
        <section>
          <SectionLabel>Overview</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            {/* Tables */}
            <div className="rounded-lg border border-border/50 bg-bg-elevated/50 px-3 py-2.5">
              <p className="text-[10px] font-medium text-text-muted">Tables</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums leading-none text-text-primary">
                {tableCount}
              </p>
            </div>
            {/* Seats */}
            <div className="rounded-lg border border-border/50 bg-bg-elevated/50 px-3 py-2.5">
              <p className="text-[10px] font-medium text-text-muted">Seats</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums leading-none text-text-primary">
                {totalSeats}
              </p>
            </div>
            {/* Zones */}
            <div className="rounded-lg border border-border/50 bg-bg-elevated/50 px-3 py-2.5">
              <p className="text-[10px] font-medium text-text-muted">
                {t("dashboard.floorPlan.inspectorZonesCountLabel")}
              </p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums leading-none text-text-primary">
                {zoneCount}
              </p>
            </div>
          </div>
        </section>

        {/* ── Status breakdown ───────────────────────────────── */}
        <section>
          <SectionLabel>
            <span className="flex items-center gap-1.5">
              <Activity className="size-3" aria-hidden />
              {t("dashboard.floorPlan.inspectorStatusSummaryTitle")}
            </span>
          </SectionLabel>
          <div className="flex flex-col gap-1.5">
            {STATUS_KEYS.map(({ id, labelKey }) => {
              const n = counts[id as keyof StatusCounts];
              const color = getStatusColor(id);
              const pct = total > 0 ? Math.round((n / total) * 100) : 0;
              return (
                <div key={id} className="flex items-center gap-2.5">
                  {/* Status dot */}
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                  {/* Label */}
                  <span className="w-16 shrink-0 text-[12px] text-text-secondary">
                    {t(labelKey)}
                  </span>
                  {/* Bar track */}
                  <div className="flex-1 overflow-hidden rounded-full bg-bg-elevated/80 h-[5px]">
                    {pct > 0 && (
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.75 }}
                      />
                    )}
                  </div>
                  {/* Count */}
                  <span className="w-5 shrink-0 text-right text-[12px] font-semibold tabular-nums text-text-primary">
                    {n}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── View settings ──────────────────────────────────── */}
        <section>
          <SectionLabel>
            <span className="flex items-center gap-1.5">
              <Eye className="size-3" aria-hidden />
              {t("dashboard.floorPlan.viewOptions")}
            </span>
          </SectionLabel>
          <div className="flex items-center gap-2">
            <div className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium",
              showGrid
                ? "border-gold/30 bg-gold/[0.07] text-gold"
                : "border-border/40 bg-bg-elevated/30 text-text-muted",
            )}>
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  showGrid ? "bg-gold" : "bg-text-muted/40",
                )}
              />
              {t("dashboard.floorPlan.toggleGrid")}
            </div>
            <div className={cn(
              "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium",
              snapEnabled
                ? "border-gold/30 bg-gold/[0.07] text-gold"
                : "border-border/40 bg-bg-elevated/30 text-text-muted",
            )}>
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  snapEnabled ? "bg-gold" : "bg-text-muted/40",
                )}
              />
              {t("dashboard.floorPlan.toggleSnap")}
            </div>
          </div>
        </section>

        {/* ── Floors & sections ──────────────────────────────── */}
        {active.length > 0 && (
          <section>
            <SectionLabel>
              <span className="flex items-center gap-1.5">
                <Layers className="size-3" aria-hidden />
                {t("dashboard.floorPlan.sectionsTitle")}
              </span>
            </SectionLabel>
            <ul className="flex flex-col gap-1">
              {active.map((s) => (
                <li
                  key={s.id}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-[12px]",
                    s.id === selectedSectionId
                      ? "border-gold/25 bg-gold/[0.06] font-semibold text-gold"
                      : "border-border/35 bg-bg-elevated/20 text-text-muted",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full shrink-0",
                      s.id === selectedSectionId ? "bg-gold" : "bg-text-muted/30",
                    )}
                  />
                  {s.name}
                </li>
              ))}
            </ul>
          </section>
        )}

      </div>
    </div>
  );
}
