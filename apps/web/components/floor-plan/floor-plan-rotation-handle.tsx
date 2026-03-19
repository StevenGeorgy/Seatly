"use client";

import { RotateCw } from "lucide-react";
import { colours, spacing } from "@seatly/tokens";

const stemH = spacing.floorPlanRotationStemHeight;
const size = spacing.floorPlanRotationHandleSize;
const iconSize = parseInt(spacing.floorPlanRotationHandleIconSize, 10);

export type FloorPlanRotationHandleProps = {
  /** Called on click (after stopping propagation). */
  onRotateClick: () => void;
  /** Accessible name for the rotate control. */
  ariaLabel?: string;
};

export function FloorPlanRotationHandle({ onRotateClick, ariaLabel = "Rotate 45°" }: FloorPlanRotationHandleProps) {
  return (
    <>
      <div
        className="pointer-events-none absolute left-1/2 z-[35] w-px -translate-x-1/2"
        style={{
          bottom: "100%",
          height: stemH,
          backgroundColor: colours.floorPlanRotationStem,
        }}
      />
      <button
        type="button"
        aria-label={ariaLabel}
        className="absolute left-1/2 z-[35] flex -translate-x-1/2 cursor-grab items-center justify-center rounded-full border shadow-md transition-colors hover:bg-gold/10"
        style={{
          bottom: `calc(100% + ${stemH})`,
          width: size,
          height: size,
          backgroundColor: colours.floorPlanRotationHandleBg,
          borderColor: colours.floorPlanRotationHandleBorder,
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onRotateClick();
        }}
      >
        <RotateCw className="text-gold" style={{ width: iconSize, height: iconSize }} strokeWidth={2} />
      </button>
    </>
  );
}
