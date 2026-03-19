"use client";

import { RotateCw } from "lucide-react";
import type { MouseEvent } from "react";
import { colours, spacing } from "@seatly/tokens";

const size = spacing.floorPlanRotationHandleSize;
const iconSize = parseInt(spacing.floorPlanRotationHandleIconSize, 10);
const defaultOrbitRadius = parseInt(spacing.floorPlanRotationStemHeight, 10) || 24;

export type FloorPlanRotationHandleProps = {
  /** Called on click (after stopping propagation). */
  onRotateClick?: () => void;
  /** Optional mouse-down hook for press/hold rotation controls. */
  onRotateMouseDown?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Accessible name for the rotate control. */
  ariaLabel?: string;
  /** Optional current element rotation so handle follows orientation. */
  rotationDeg?: number;
  /** Distance from element center for orbiting behavior. */
  orbitRadius?: number;
};

export function FloorPlanRotationHandle({
  onRotateClick,
  onRotateMouseDown,
  ariaLabel = "Rotate 45°",
  rotationDeg = 0,
  orbitRadius = defaultOrbitRadius,
}: FloorPlanRotationHandleProps) {
  const theta = ((rotationDeg - 90) * Math.PI) / 180;
  const orbitX = Math.cos(theta) * orbitRadius;
  const orbitY = Math.sin(theta) * orbitRadius;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="absolute z-[35] flex cursor-grab items-center justify-center rounded-full border shadow-md transition-colors hover:bg-gold/10"
      style={{
        left: `calc(50% + ${orbitX}px)`,
        top: `calc(50% + ${orbitY}px)`,
        width: size,
        height: size,
        backgroundColor: colours.floorPlanRotationHandleBg,
        borderColor: colours.floorPlanRotationHandleBorder,
        transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)`,
        transformOrigin: "center center",
      }}
      onMouseDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onRotateMouseDown?.(e);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onRotateClick?.();
      }}
    >
      <RotateCw className="text-gold" style={{ width: iconSize, height: iconSize }} strokeWidth={2} />
    </button>
  );
}
