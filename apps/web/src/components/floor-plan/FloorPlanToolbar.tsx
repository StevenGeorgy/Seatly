import {
  Circle,
  LayoutGrid,
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
  shortcut?: string;
};

const TABLE_TOOLS: ToolItem[] = [
  { tool: "add-rect-table",    icon: <RectangleHorizontal className="size-5" />, labelKey: "dashboard.floorPlan.toolRect",   shortcut: "1" },
  { tool: "add-circle-table",  icon: <Circle className="size-5" />,              labelKey: "dashboard.floorPlan.toolCircle", shortcut: "2" },
  { tool: "add-square-table",  icon: <Square className="size-5" />,              labelKey: "dashboard.floorPlan.toolSquare", shortcut: "3" },
];

const OBJECT_TOOLS: ToolItem[] = [
  { tool: "add-zone",          icon: <LayoutGrid className="size-5" />,          labelKey: "dashboard.floorPlan.toolAddZone" },
  { tool: "add-wall",          icon: <Minus className="size-5" />,               labelKey: "dashboard.floorPlan.toolWall" },
  { tool: "add-section-label", icon: <Type className="size-5" />,                labelKey: "dashboard.floorPlan.toolSectionLabel" },
];

const ACTION_TOOLS: ToolItem[] = [
  { tool: "select", icon: <MousePointer2 className="size-5" />, labelKey: "dashboard.floorPlan.toolSelect", shortcut: "Esc" },
  { tool: "delete", icon: <Trash2 className="size-5" />,        labelKey: "dashboard.floorPlan.toolDelete", shortcut: "Del" },
];

type FloorPlanToolbarProps = {
  activeTool: ToolMode;
  onToolChange: (tool: ToolMode) => void;
};

function ShortcutBadge({ label }: { label: string }) {
  return (
    <kbd className="ml-auto shrink-0 rounded border border-border/60 bg-bg-base/60 px-1 py-0.5 font-mono text-[9px] font-medium leading-none text-text-muted">
      {label}
    </kbd>
  );
}

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
    <div className="flex flex-col gap-0.5 py-1">
      <p className="mb-0.5 px-2 text-[9px] font-semibold uppercase tracking-widest text-text-muted/60">
        {title}
      </p>
      {items.map(({ tool, icon, labelKey, shortcut }) => {
        const isActive = activeTool === tool;
        return (
          <button
            key={tool}
            type="button"
            onClick={() => onToolChange(tool)}
            title={shortcut ? `${t(labelKey)} (${shortcut})` : t(labelKey)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium transition-all duration-150",
              isActive
                ? "bg-gold/15 text-gold ring-1 ring-inset ring-gold/25"
                : "text-text-secondary hover:bg-bg-elevated hover:text-text-primary",
            )}
            aria-label={t(labelKey)}
          >
            <span className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
              isActive ? "bg-gold/20 text-gold" : "bg-bg-elevated/80 text-text-muted",
            )}>
              {icon}
            </span>
            <span className="truncate">{t(labelKey)}</span>
            {shortcut && <ShortcutBadge label={shortcut} />}
          </button>
        );
      })}
    </div>
  );
}

export function FloorPlanToolbar({ activeTool, onToolChange }: FloorPlanToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex w-full shrink-0 flex-col gap-0 rounded-xl border border-border/50 bg-bg-base/50 shadow-lg shadow-black/30">
      <ToolSection
        title={t("dashboard.floorPlan.toolbarTables")}
        items={TABLE_TOOLS}
        activeTool={activeTool}
        onToolChange={onToolChange}
      />
      <div className="mx-3 h-px bg-border/40" />
      <ToolSection
        title={t("dashboard.floorPlan.toolbarObjects")}
        items={OBJECT_TOOLS}
        activeTool={activeTool}
        onToolChange={onToolChange}
      />
      <div className="mx-3 h-px bg-border/40" />
      <ToolSection
        title={t("dashboard.floorPlan.toolbarActions")}
        items={ACTION_TOOLS}
        activeTool={activeTool}
        onToolChange={onToolChange}
      />

      {/* Shortcut hint strip */}
      <div className="mx-3 mt-1 mb-2 flex flex-wrap gap-x-2 gap-y-1 rounded-md border border-border/30 bg-bg-base/30 px-2 py-1.5">
        {[
          { key: "⌘D", label: "duplicate" },
          { key: "G", label: "grid" },
          { key: "S", label: "snap" },
        ].map(({ key, label }) => (
          <span key={key} className="flex items-center gap-1 text-[9px] text-text-muted/60">
            <kbd className="rounded border border-border/50 bg-bg-elevated/60 px-1 py-px font-mono font-semibold text-text-muted/80">{key}</kbd>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
