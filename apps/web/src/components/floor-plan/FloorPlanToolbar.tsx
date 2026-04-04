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

import { cn } from "@/lib/utils";

import type { ToolMode } from "./types";

type ToolItem = {
  tool: ToolMode;
  icon: React.ReactNode;
  labelKey: string;
};

const TABLE_TOOLS: ToolItem[] = [
  { tool: "add-rect-table", icon: <RectangleHorizontal className="size-5" />, labelKey: "dashboard.floorPlan.toolRect" },
  { tool: "add-circle-table", icon: <Circle className="size-5" />, labelKey: "dashboard.floorPlan.toolCircle" },
  { tool: "add-square-table", icon: <Square className="size-5" />, labelKey: "dashboard.floorPlan.toolSquare" },
];

const OBJECT_TOOLS: ToolItem[] = [
  { tool: "add-wall", icon: <Minus className="size-5" />, labelKey: "dashboard.floorPlan.toolWall" },
  { tool: "add-section-label", icon: <Type className="size-5" />, labelKey: "dashboard.floorPlan.toolSectionLabel" },
];

const ACTION_TOOLS: ToolItem[] = [
  { tool: "select", icon: <MousePointer2 className="size-5" />, labelKey: "dashboard.floorPlan.toolSelect" },
  { tool: "delete", icon: <Trash2 className="size-5" />, labelKey: "dashboard.floorPlan.toolDelete" },
];

type FloorPlanToolbarProps = {
  activeTool: ToolMode;
  onToolChange: (tool: ToolMode) => void;
};

function ToolSection({
  title,
  items,
  activeTool,
  onToolChange,
}: {
  title: string;
  items: ToolItem[];
  activeTool: ToolMode;
  onToolChange: (tool: ToolMode) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1">
      <p className="px-2 text-[10px] font-semibold uppercase tracking-widest text-text-muted">
        {title}
      </p>
      {items.map(({ tool, icon, labelKey }) => {
        const isActive = activeTool === tool;
        return (
          <button
            key={tool}
            type="button"
            onClick={() => onToolChange(tool)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-all duration-150",
              isActive
                ? "bg-gold/15 text-gold ring-1 ring-gold/30"
                : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary",
            )}
            aria-label={t(labelKey)}
          >
            <span className={cn(
              "flex size-8 items-center justify-center rounded-md transition-colors",
              isActive ? "bg-gold/20 text-gold" : "bg-bg-elevated text-text-muted",
            )}>
              {icon}
            </span>
            <span>{t(labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function FloorPlanToolbar({ activeTool, onToolChange }: FloorPlanToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex w-52 shrink-0 flex-col gap-4 py-1">
      <ToolSection
        title={t("dashboard.floorPlan.toolbarTables", "Tables")}
        items={TABLE_TOOLS}
        activeTool={activeTool}
        onToolChange={onToolChange}
      />
      <div className="mx-2 h-px bg-border/60" />
      <ToolSection
        title={t("dashboard.floorPlan.toolbarObjects", "Objects")}
        items={OBJECT_TOOLS}
        activeTool={activeTool}
        onToolChange={onToolChange}
      />
      <div className="mx-2 h-px bg-border/60" />
      <ToolSection
        title={t("dashboard.floorPlan.toolbarActions", "Actions")}
        items={ACTION_TOOLS}
        activeTool={activeTool}
        onToolChange={onToolChange}
      />
    </div>
  );
}
