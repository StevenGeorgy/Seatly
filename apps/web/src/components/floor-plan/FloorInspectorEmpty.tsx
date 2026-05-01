import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import type { SectionRow } from "@/hooks/useFloorPlan";

import type { FloorPlanMode } from "./types";

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
  tableCount: number;
  totalSeats: number;
  statusCounts: StatusCounts;
  editToolsSlot?: React.ReactNode;
};

export function FloorInspectorEmpty({
  mode,
  sections,
  selectedSectionId,
  tableCount,
  totalSeats,
  statusCounts,
  editToolsSlot,
}: FloorInspectorEmptyProps) {
  const { t } = useTranslation();
  const active = sections.filter((s) => s.is_active);
  const current = active.find((s) => s.id === selectedSectionId);
  const counts = { ...ZERO_COUNTS, ...statusCounts };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 bg-bg-base p-4">
      {mode === "edit" ? (
        <section className="rounded-xl border border-gold/35 bg-bg-surface p-5 shadow-xl shadow-black/25">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
            {t("dashboard.floorPlan.editingLayoutEyebrow")}
          </p>
          <h2 className="mt-2 font-serif text-xl leading-tight text-white">
            {t("dashboard.floorPlan.editingLayoutTitle")}
          </h2>
          <div className="mt-5">{editToolsSlot}</div>
          <p className="mt-5 text-xs leading-relaxed text-text-muted">
            {t("dashboard.floorPlan.editingLayoutTip")}
          </p>
        </section>
      ) : (
        <>
          <section className="rounded-xl border border-border/70 bg-bg-surface p-5 shadow-xl shadow-black/25">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
              {t("dashboard.floorPlan.thisEvening")}
            </p>
            <h2 className="mt-3 font-serif text-xl leading-snug text-white">
              {t("dashboard.floorPlan.serviceSummary", {
                seated: counts.occupied,
                total: tableCount,
                guests: totalSeats,
                reservations: counts.reserved,
              })}
            </h2>
            <p className="mt-4 text-xs leading-relaxed text-text-muted">
              {t("dashboard.floorPlan.thisEveningHint", {
                floor: current?.name ?? t("dashboard.floorPlan.title"),
              })}
            </p>
          </section>

          <section className="rounded-xl border border-border/70 bg-bg-surface p-4 shadow-xl shadow-black/20">
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
              {t("dashboard.floorPlan.findTable")}
            </p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
              <Input
                className="h-10 rounded-lg bg-bg-base pl-9 text-xs"
                placeholder={t("dashboard.floorPlan.findTablePlaceholder")}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
