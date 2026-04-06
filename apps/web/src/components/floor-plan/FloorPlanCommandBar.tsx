import {
  Grid3X3,
  Magnet,
  Redo2,
  Undo2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type { FloorPlanMode } from "./types";

type FloorPlanCommandBarProps = {
  mode: FloorPlanMode;
  canEdit: boolean;
  needsFloorFirst: boolean;
  /** Section / floor selector row */
  sectionTabsSlot: React.ReactNode;
  addFloorSlot?: React.ReactNode;
  /** Edit mode */
  undoDisabled: boolean;
  redoDisabled: boolean;
  onUndo: () => void;
  onRedo: () => void;
  showGrid: boolean;
  onShowGridChange: (v: boolean) => void;
  snapEnabled: boolean;
  onSnapChange: (v: boolean) => void;
  zoomSlot: React.ReactNode;
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
  undoDisabled,
  redoDisabled,
  onUndo,
  onRedo,
  showGrid,
  onShowGridChange,
  snapEnabled,
  onSnapChange,
  zoomSlot,
  saveIndicatorSlot,
  onEnterEdit,
  onExitEdit,
}: FloorPlanCommandBarProps) {
  const { t } = useTranslation();
  const isEdit = mode === "edit";

  function handleLiveClick() {
    if (isEdit) void onExitEdit();
  }

  function handleEditClick() {
    if (!canEdit || needsFloorFirst) return;
    if (!isEdit) onEnterEdit();
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-bg-surface/95 backdrop-blur-md">
      <div className="flex min-h-[3.25rem] min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <div className="flex min-w-0 shrink-0 items-baseline gap-2">
          <h1 className="text-sm font-semibold tracking-tight text-text-primary">
            {t("dashboard.floorPlan.title")}
          </h1>
          {isEdit && (
            <span className="hidden rounded-md border border-gold/25 bg-gold/[0.08] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold sm:inline">
              {t("dashboard.floorPlan.editingMode")}
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-text-muted sm:inline">
            {t("dashboard.floorPlan.commandBarFloor")}
          </span>
          <div className="min-w-0 flex-1">{sectionTabsSlot}</div>
          {addFloorSlot}
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
          {/* Live | Edit */}
          <div
            className="flex shrink-0 rounded-lg border border-border/70 bg-bg-elevated/40 p-0.5 shadow-inner shadow-black/20"
            role="group"
            aria-label={t("dashboard.floorPlan.modeToggleAria")}
          >
            <button
              type="button"
              onClick={handleLiveClick}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200",
                !isEdit
                  ? "bg-gold/20 text-gold shadow-sm shadow-gold/10"
                  : "text-text-muted hover:text-text-secondary",
              )}
            >
              {t("dashboard.floorPlan.liveMode")}
            </button>
            <button
              type="button"
              disabled={!canEdit || needsFloorFirst}
              onClick={handleEditClick}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-200",
                isEdit
                  ? "bg-gold/20 text-gold shadow-sm shadow-gold/10"
                  : "text-text-muted hover:text-text-secondary",
                (!canEdit || needsFloorFirst) && "cursor-not-allowed opacity-40",
              )}
            >
              {t("dashboard.floorPlan.editMode")}
            </button>
          </div>

          {isEdit && (
            <>
              <div className="hidden h-6 w-px bg-border/80 sm:block" aria-hidden />
              <div className="flex items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="h-8 w-8 text-text-secondary hover:text-text-primary"
                  disabled={undoDisabled}
                  onClick={onUndo}
                  aria-label={t("dashboard.floorPlan.undo")}
                >
                  <Undo2 className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="h-8 w-8 text-text-secondary hover:text-text-primary"
                  disabled={redoDisabled}
                  onClick={onRedo}
                  aria-label={t("dashboard.floorPlan.redo")}
                >
                  <Redo2 className="size-4" />
                </Button>
              </div>
            </>
          )}

          <div className="hidden h-6 w-px bg-border/80 md:block" aria-hidden />

          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            {zoomSlot}

            <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-bg-elevated/30 px-2 py-1">
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-text-muted">
                <Grid3X3 className="size-3.5 shrink-0 text-gold/80" aria-hidden />
                <span className="hidden sm:inline">{t("dashboard.floorPlan.toggleGrid")}</span>
                <Switch
                  size="sm"
                  checked={showGrid}
                  onCheckedChange={onShowGridChange}
                  aria-label={t("dashboard.floorPlan.toggleGrid")}
                />
              </label>
              <span className="h-4 w-px bg-border/60" aria-hidden />
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-text-muted">
                <Magnet className="size-3.5 shrink-0 text-gold/80" aria-hidden />
                <span className="hidden sm:inline">{t("dashboard.floorPlan.toggleSnap")}</span>
                <Switch
                  size="sm"
                  checked={snapEnabled}
                  onCheckedChange={onSnapChange}
                  aria-label={t("dashboard.floorPlan.toggleSnap")}
                />
              </label>
            </div>
          </div>

          {isEdit && (
            <div className="flex items-center gap-2">
              {saveIndicatorSlot}
              <Button type="button" size="sm" className="font-semibold shadow-sm shadow-gold/10" onClick={() => void onExitEdit()}>
                {t("dashboard.floorPlan.doneButton")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
