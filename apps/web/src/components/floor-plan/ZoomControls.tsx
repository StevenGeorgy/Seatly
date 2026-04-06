import { Minus, Plus, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

type ZoomControlsProps = {
  scale: number;
  /** Last "full view" scale — zoom label is (scale / baseline) × 100 so 100% matches the fitted view. */
  baselineScale?: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
};

export function ZoomControls({
  scale,
  baselineScale,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps) {
  const { t } = useTranslation();
  const base = baselineScale != null && baselineScale > 1e-6 ? baselineScale : 1;
  const pct = Math.max(1, Math.min(999, Math.round((scale / base) * 100)));

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-surface px-1.5 py-1 shadow-sm shadow-black/30">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onZoomOut}
        aria-label={t("dashboard.floorPlan.zoomOut")}
      >
        <Minus className="size-3.5" />
      </Button>
      <span className="min-w-[40px] text-center text-xs font-medium tabular-nums text-text-secondary">
        {pct}%
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onZoomIn}
        aria-label={t("dashboard.floorPlan.zoomIn")}
      >
        <Plus className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1 px-2"
        onClick={onReset}
        aria-label={t("dashboard.floorPlan.fullView")}
        title={t("dashboard.floorPlan.fullViewHint")}
      >
        <RotateCcw className="size-3.5 shrink-0" />
        <span className="hidden text-xs font-medium text-text-secondary sm:inline">
          {t("dashboard.floorPlan.fullView")}
        </span>
      </Button>
    </div>
  );
}
