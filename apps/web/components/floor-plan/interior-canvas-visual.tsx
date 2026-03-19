"use client";

import type { LucideIcon } from "lucide-react";
import { colours, spacing, borderRadius, shadows } from "@seatly/tokens";
import type { InteriorType } from "@/lib/floor-plan";

const iconPx = spacing.floorPlanInteriorIconSize;
const cushionBorder = `1px solid ${colours.floorPlanInteriorSofaCushionDivider}`;
const loungeCushionBorder = `1px solid ${colours.floorPlanInteriorLoungeCushionDivider}`;

export type InteriorCanvasVisualProps = {
  type: InteriorType;
  w: number;
  h: number;
  displayLabel: string;
  seatedLine: string | null;
  IconComponent: LucideIcon;
  isSmall: boolean;
  isSelected?: boolean;
};

export function InteriorCanvasVisual({
  type,
  w,
  h,
  displayLabel,
  seatedLine,
  IconComponent,
  isSmall,
  isSelected = false,
}: InteriorCanvasVisualProps) {
  const iconSize = isSmall ? 12 : parseInt(iconPx, 10);
  const labelClass = isSmall
    ? "text-[8px] font-medium uppercase tracking-wider"
    : "text-[10px] font-medium uppercase tracking-wider";
  const isCompact = w < 84 || h < 52;

  if (type === "pillar") {
    const hasLabelSpace = h >= 56;
    const diameter = Math.max(16, Math.min(w, hasLabelSpace ? h - 16 : h) - 2);
    return (
      <div className="flex h-full w-full flex-col items-center justify-center">
        <div
          className="relative shrink-0 rounded-full"
          style={{
            width: diameter,
            height: diameter,
            backgroundColor: colours.floorPlanInteriorPillarBg,
            border: `${spacing.floorPlanInteriorPillarCrossThickness} solid ${colours.floorPlanInteriorPillarBorder}`,
          }}
        >
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{
              width: Math.round(diameter * 0.45),
              height: spacing.floorPlanInteriorPillarCrossThickness,
              backgroundColor: colours.floorPlanInteriorPillarCross,
            }}
          />
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{
              height: Math.round(diameter * 0.45),
              width: spacing.floorPlanInteriorPillarCrossThickness,
              backgroundColor: colours.floorPlanInteriorPillarCross,
            }}
          />
        </div>
        {hasLabelSpace && (
          <span className={`mt-px max-w-full shrink-0 truncate px-xs text-center text-text-muted-on-dark ${labelClass}`}>
            {displayLabel}
          </span>
        )}
      </div>
    );
  }

  if (type === "sofa") {
    return (
      <div
        className="flex h-full w-full min-h-0 flex-col overflow-hidden border"
        style={{
          backgroundColor: colours.floorPlanInteriorSofaBg,
          borderColor: colours.floorPlanInteriorSofaBorder,
          borderRadius: borderRadius.floorPlanSofaBackRadius,
        }}
      >
        <div className="flex min-h-0 flex-1 flex-row">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="min-h-0 flex-1"
              style={i < 2 ? { borderRight: cushionBorder } : undefined}
            />
          ))}
        </div>
        <div className="flex shrink-0 items-center justify-center pt-xs">
          <IconComponent className="text-gold/70" size={iconSize} strokeWidth={1.5} />
        </div>
        <span className={`w-full shrink-0 truncate px-xs pb-xs text-center text-text-muted-on-dark ${labelClass}`}>
          {displayLabel}
        </span>
        {seatedLine && (
          <span className={`w-full shrink-0 truncate px-xs pb-xs text-center font-medium text-gold/90 ${isSmall ? "text-[7px]" : "text-[9px]"}`}>
            {seatedLine}
          </span>
        )}
      </div>
    );
  }

  if (type === "lounge") {
    return (
      <div
        className="flex h-full w-full min-h-0 flex-col overflow-hidden rounded-lg border"
        style={{
          backgroundColor: colours.floorPlanInteriorLoungeBg,
          borderColor: colours.floorPlanInteriorLoungeBorder,
        }}
      >
        <div className="flex min-h-0 flex-1 flex-row">
          <div className="min-h-0 flex-1" style={{ borderRight: loungeCushionBorder }} />
          <div className="min-h-0 flex-1" />
        </div>
        <div className="flex shrink-0 items-center justify-center pt-xs">
          <IconComponent className="text-gold/70" size={iconSize} strokeWidth={1.5} />
        </div>
        <span className={`w-full shrink-0 truncate px-xs pb-xs text-center text-text-muted-on-dark ${labelClass}`}>
          {displayLabel}
        </span>
        {seatedLine && (
          <span className={`w-full shrink-0 truncate px-xs pb-xs text-center font-medium text-gold/90 ${isSmall ? "text-[7px]" : "text-[9px]"}`}>
            {seatedLine}
          </span>
        )}
      </div>
    );
  }

  if (type === "booth") {
    return (
      <div
        className="flex h-full w-full min-h-0 flex-col overflow-hidden rounded-lg border"
        style={{
          backgroundColor: colours.floorPlanInteriorBoothBg,
          borderColor: colours.floorPlanInteriorBoothBorder,
          borderLeftWidth: spacing.floorPlanBoothLeftBorderWidth,
          borderLeftStyle: "solid",
          borderLeftColor: colours.floorPlanInteriorBoothAccent,
        }}
      >
        <div
          className={`flex min-h-0 flex-1 flex-col items-center justify-center ${
            isCompact ? "gap-px px-xs py-px" : "gap-xs p-xs"
          }`}
        >
          {!isCompact && <IconComponent className="text-gold/70" size={iconSize} strokeWidth={1.5} />}
          <span
            className={`max-w-full truncate text-center text-text-muted-on-dark ${
              isCompact ? "text-[8px] font-medium uppercase tracking-wide" : labelClass
            }`}
          >
            {displayLabel}
          </span>
          {!isCompact && seatedLine && (
            <span className={`max-w-full truncate text-center font-medium text-gold/90 ${isSmall ? "text-[7px]" : "text-[9px]"}`}>
              {seatedLine}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (type === "bar") {
    return (
      <div
        className="flex h-full w-full min-h-0 flex-col overflow-hidden rounded-lg border"
        style={{
          backgroundColor: colours.floorPlanInteriorBarBg,
          borderColor: colours.floorPlanInteriorBarBorder,
          backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 5px, ${colours.floorPlanInteriorBarPattern} 5px, ${colours.floorPlanInteriorBarPattern} 6px)`,
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-xs p-xs">
          <IconComponent className="text-gold/70" size={iconSize} strokeWidth={1.5} />
          <span className={`max-w-full truncate text-center text-text-muted-on-dark ${labelClass}`}>{displayLabel}</span>
        </div>
      </div>
    );
  }

  if (type === "counter") {
    return (
      <div
        className="flex h-full w-full min-h-0 flex-col overflow-hidden rounded-lg border"
        style={{
          backgroundColor: colours.floorPlanInteriorCounterBg,
          borderColor: isSelected ? colours.gold : colours.floorPlanInteriorCounterBorder,
          boxShadow: isSelected ? `inset 0 0 0 1px ${colours.gold}` : undefined,
        }}
      >
        {isCompact ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-xs py-px">
            <span className="max-w-full truncate text-center text-[8px] font-semibold uppercase tracking-wide text-text-on-dark">
              {displayLabel}
            </span>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 flex-col items-center gap-xs pt-xs">
              <IconComponent className="text-gold/70" size={iconSize} strokeWidth={1.5} />
            </div>
            <div className="flex min-h-0 flex-1 flex-col justify-center gap-1 px-sm py-xs">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-px w-full shrink-0" style={{ backgroundColor: colours.floorPlanInteriorCounterLine }} />
              ))}
            </div>
            <span className={`max-w-full shrink-0 truncate px-xs pb-xs text-center text-text-on-dark ${labelClass}`}>
              {displayLabel}
            </span>
          </>
        )}
      </div>
    );
  }

  if (type === "stage") {
    return (
      <div
        className="flex h-full w-full min-h-0 flex-col items-center justify-center gap-sm overflow-hidden rounded-lg border p-sm"
        style={{
          backgroundColor: colours.floorPlanInteriorStageBg,
          borderColor: colours.floorPlanInteriorStageBorder,
          boxShadow: shadows.floorPlanStageElevated,
        }}
      >
        <IconComponent className="text-gold/80" size={iconSize} strokeWidth={1.5} />
        <span className="text-center text-xs font-bold uppercase tracking-widest text-text-on-dark">STAGE</span>
        <span className={`max-w-full truncate text-center text-text-muted-on-dark ${labelClass}`}>{displayLabel}</span>
      </div>
    );
  }

  return null;
}
