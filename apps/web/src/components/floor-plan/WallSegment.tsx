import { Line } from "react-konva";

import { CANVAS_COLORS } from "@/lib/canvas-colors";

type WallSegmentProps = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  selected?: boolean;
  opacity?: number;
  draggable?: boolean;
  onDragEnd?: (id: string, dx: number, dy: number) => void;
  onClick?: () => void;
};

export function WallSegment({
  id,
  x1,
  y1,
  x2,
  y2,
  selected = false,
  opacity = 1,
  draggable = false,
  onDragEnd,
  onClick,
}: WallSegmentProps) {
  return (
    <Line
      points={[x1, y1, x2, y2]}
      stroke={selected ? CANVAS_COLORS.gold : CANVAS_COLORS.border}
      strokeWidth={selected ? 7 : 5}
      lineCap="round"
      lineJoin="round"
      opacity={opacity}
      draggable={draggable}
      onClick={onClick}
      onTap={onClick}
      onDragEnd={(e) => {
        const pos = e.target.position();
        onDragEnd?.(id, pos.x, pos.y);
      }}
      hitStrokeWidth={12}
    />
  );
}
