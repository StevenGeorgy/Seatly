import {
  Redo2,
  Undo2,
} from "lucide-react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { FloorPlanMode } from "./types";

type FloorPlanCommandBarProps = {
  mode: FloorPlanMode;
  canEdit: boolean;
  needsFloorFirst: boolean;
  /** Section / floor selector row */
  sectionTabsSlot: React.ReactNode;
  addFloorSlot?: React.ReactNode;
  statusLegendSlot?: React.ReactNode;
  serviceSummary: React.ReactNode;
  /** Edit mode */
  undoDisabled: boolean;
  redoDisabled: boolean;
  onUndo: () => void;
  onRedo: () => void;
  saveIndicatorSlot: React.ReactNode;
  onEnterEdit: () => void;
  onExitEdit: () => void;
};

export function FloorPlanCommandBar({
  mode,
  canEdit,
  needsFloorFirst,
  sectionTabsSlot,
  addFloorSlot,
  statusLegendSlot,
  serviceSummary,
  undoDisabled,
  redoDisabled,
  onUndo,
  onRedo,
  saveIndicatorSlot,
  onEnterEdit,
  onExitEdit,
}: FloorPlanCommandBarProps) {
  const { t } = useTranslation();
  const isEdit = mode === "edit";

  function handleEditClick() {
    if (!canEdit || needsFloorFirst) return;
    if (!isEdit) onEnterEdit();
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-bg-base/95 backdrop-blur-md">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4 px-6 py-5">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-muted">
            {t("dashboard.floorPlan.serviceEyebrow")}
          </p>
          <h1 className="mt-1 font-serif text-3xl leading-none text-white md:text-4xl">
            {format(new Date(), "EEEE, MMMM d")}
          </h1>
          <p className="mt-3 font-serif text-sm italic text-text-secondary">
            {serviceSummary}
          </p>
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {isEdit ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-lg border-border/70 bg-bg-base px-3 text-xs text-text-secondary"
                disabled={undoDisabled}
                onClick={onUndo}
                aria-label={t("dashboard.floorPlan.undo")}
              >
                <Undo2 className="size-3.5" />
                {t("dashboard.floorPlan.undo")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-lg border-border/70 bg-bg-base px-3 text-xs text-text-secondary"
                disabled={redoDisabled}
                onClick={onRedo}
                aria-label={t("dashboard.floorPlan.redo")}
              >
                <Redo2 className="size-3.5" />
                {t("dashboard.floorPlan.redo")}
              </Button>
              {saveIndicatorSlot}
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-lg px-4 text-xs font-semibold shadow-sm shadow-gold/10"
                onClick={() => void onExitEdit()}
              >
                {t("dashboard.floorPlan.doneButton")}
              </Button>
            </>
          ) : (
            canEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(
                  "h-9 rounded-lg border-border/70 bg-bg-base px-4 text-xs text-text-secondary hover:text-white",
                  needsFloorFirst && "cursor-not-allowed opacity-40",
                )}
                disabled={needsFloorFirst}
                onClick={handleEditClick}
              >
                {t("dashboard.floorPlan.editLayout")}
              </Button>
            )
          )}
        </div>
      </div>
      <div className="flex min-h-12 min-w-0 flex-wrap items-center justify-between gap-3 border-t border-border/50 px-6 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="min-w-0">{sectionTabsSlot}</div>
          {addFloorSlot}
        </div>
        {statusLegendSlot}
      </div>
    </header>
  );
}
