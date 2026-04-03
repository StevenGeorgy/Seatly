import {
  Circle,
  Minus,
  MousePointer2,
  RectangleHorizontal,
  Square,
  Trash2,
  Type,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { ToolMode } from "./types";

type ToolButton = {
  tool: ToolMode;
  icon: React.ReactNode;
  labelKey: string;
};

const TOOLS: ToolButton[] = [
  { tool: "select", icon: <MousePointer2 className="size-4" />, labelKey: "dashboard.floorPlan.toolSelect" },
  { tool: "add-rect-table", icon: <RectangleHorizontal className="size-4" />, labelKey: "dashboard.floorPlan.toolRect" },
  { tool: "add-circle-table", icon: <Circle className="size-4" />, labelKey: "dashboard.floorPlan.toolCircle" },
  { tool: "add-square-table", icon: <Square className="size-4" />, labelKey: "dashboard.floorPlan.toolSquare" },
  { tool: "add-wall", icon: <Minus className="size-4" />, labelKey: "dashboard.floorPlan.toolWall" },
  { tool: "add-section-label", icon: <Type className="size-4" />, labelKey: "dashboard.floorPlan.toolSectionLabel" },
  { tool: "delete", icon: <Trash2 className="size-4" />, labelKey: "dashboard.floorPlan.toolDelete" },
];

type FloorPlanToolbarProps = {
  activeTool: ToolMode;
  onToolChange: (tool: ToolMode) => void;
};

export function FloorPlanToolbar({ activeTool, onToolChange }: FloorPlanToolbarProps) {
  const { t } = useTranslation();

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex w-16 shrink-0 flex-col items-center gap-1 rounded-xl border border-border bg-bg-surface py-3">
        {TOOLS.map(({ tool, icon, labelKey }) => {
          const isActive = activeTool === tool;
          return (
            <Tooltip key={tool}>
              <TooltipTrigger asChild>
                <Button
                  variant={isActive ? "default" : "ghost"}
                  size="icon"
                  className="size-10"
                  onClick={() => onToolChange(tool)}
                  aria-label={t(labelKey)}
                >
                  {icon}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t(labelKey)}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
