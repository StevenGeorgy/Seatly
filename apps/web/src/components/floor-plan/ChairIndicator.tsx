import { Rect } from "react-konva";

/**
 * A single chair indicator rendered as a small rounded rectangle.
 * The `offsetX` / `offsetY` set the rotation pivot to the chair's centre,
 * so `rotation` spins it around its own midpoint to face the table.
 */
type ChairIndicatorProps = {
  /** Centre position of the chair */
  x: number;
  y: number;
  /** Degrees — 0 = pointing up, clockwise positive */
  angle: number;
  /** Status colour of the parent table */
  color: string;
};

export function ChairIndicator({ x, y, angle, color }: ChairIndicatorProps) {
  const w = 12;
  const h = 10;
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
      opacity={0.55}
      stroke="rgba(0,0,0,0.25)"
      strokeWidth={0.5}
      listening={false}
    />
  );
}
