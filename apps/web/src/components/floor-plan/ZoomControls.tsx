import { Minus, Plus, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

type ZoomControlsProps = {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
};

export function ZoomControls({ scale, onZoomIn, onZoomOut, onReset }: ZoomControlsProps) {
  const { t } = useTranslation();
  const pct = Math.round(scale * 100);

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-elevated/90 px-1.5 py-1 backdrop-blur-sm">
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
        size="icon-sm"
        onClick={onReset}
        aria-label={t("dashboard.floorPlan.resetZoom")}
      >
        <RotateCcw className="size-3" />
      </Button>
    </div>
  );
}
