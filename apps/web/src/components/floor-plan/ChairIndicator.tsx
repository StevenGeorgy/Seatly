import { Rect } from "react-konva";

import { CANVAS_COLORS } from "@/lib/canvas-colors";

type ChairIndicatorProps = {
  x: number;
  y: number;
  angle: number;
  color: string;
  /** Whether this seat is occupied. Unfilled seats render as a dim outline. */
  filled?: boolean;
};

export function ChairIndicator({ x, y, angle, color, filled = true }: ChairIndicatorProps) {
  const w = 10;
  const h = 6;

  if (filled) {
    return (
      <Rect
        x={x}
        y={y}
        offsetX={w / 2}
        offsetY={h / 2}
        width={w}
        height={h}
        cornerRadius={3}
        rotation={angle}
        fill={color}
        opacity={0.72}
        listening={false}
      />
    );
  }

  // Unfilled: outline-only with dimmed stroke
  return (
    <Rect
      x={x}
      y={y}
      offsetX={w / 2}
      offsetY={h / 2}
      width={w}
      height={h}
      cornerRadius={3}
      rotation={angle}
      fill={CANVAS_COLORS.bgSurface}
      stroke={color}
      strokeWidth={1.2}
      opacity={0.58}
      listening={false}
    />
  );
}
