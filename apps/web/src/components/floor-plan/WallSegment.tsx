import { Circle, Group, Line } from "react-konva";

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
  /** Show draggable endpoint handles (edit mode). */
  showHandles?: boolean;
  onDragEnd?: (id: string, dx: number, dy: number) => void;
  /** Select / delete-tool hit target (line body). */
  onWallSelect?: (id: string) => void;
  /** Called when an endpoint handle is dragged. endpoint: "start" | "end". */
  onEndpointDragMove?: (id: string, endpoint: "start" | "end", x: number, y: number) => void;
  onEndpointDragEnd?: (id: string, endpoint: "start" | "end", x: number, y: number) => void;
  /** When false, handles do not drag (extend-wall uses pointerdown to start a new segment). */
  endpointHandlesDraggable?: boolean;
  /** extend-wall: mousedown on a handle — start a new wall from this endpoint (world coords). */
  onEndpointPointerDown?: (
    id: string,
    endpoint: "start" | "end",
    worldX: number,
    worldY: number,
  ) => void;
};

const HANDLE_RADIUS = 6;
const HANDLE_HIT_RADIUS = 14;

export function WallSegment({
  id,
  x1,
  y1,
  x2,
  y2,
  selected = false,
  opacity = 1,
  draggable = false,
  showHandles = false,
  onDragEnd,
  onWallSelect,
  onEndpointDragMove,
  onEndpointDragEnd,
  endpointHandlesDraggable = true,
  onEndpointPointerDown,
}: WallSegmentProps) {
  const handleDraggable = showHandles && endpointHandlesDraggable;

  return (
    <Group>
      {/* Main wall line */}
      <Line
        points={[x1, y1, x2, y2]}
        stroke={selected ? CANVAS_COLORS.gold : CANVAS_COLORS.border}
        strokeWidth={selected ? 7 : 5}
        lineCap="round"
        lineJoin="round"
        opacity={opacity}
        draggable={draggable}
        onClick={(e) => {
          e.cancelBubble = true;
          onWallSelect?.(id);
        }}
        onTap={(e) => {
          e.cancelBubble = true;
          onWallSelect?.(id);
        }}
        onDragEnd={(e) => {
          const pos = e.target.position();
          e.target.position({ x: 0, y: 0 });
          onDragEnd?.(id, pos.x, pos.y);
        }}
        hitStrokeWidth={12}
      />

      {/* Endpoint handles (edit mode only) */}
      {showHandles && (
        <>
          {/* Start endpoint */}
          <Circle
            x={x1}
            y={y1}
            radius={HANDLE_RADIUS}
            fill={selected ? CANVAS_COLORS.gold : CANVAS_COLORS.bgElevated}
            stroke={selected ? CANVAS_COLORS.goldLight : CANVAS_COLORS.textMuted}
            strokeWidth={1.5}
            draggable={handleDraggable}
            hitFunc={(context, shape) => {
              context.beginPath();
              context.arc(0, 0, HANDLE_HIT_RADIUS, 0, Math.PI * 2, false);
              context.closePath();
              context.fillStrokeShape(shape);
            }}
            onMouseDown={(e) => {
              if (!onEndpointPointerDown) return;
              e.cancelBubble = true;
              e.evt.stopPropagation();
              onEndpointPointerDown(id, "start", x1, y1);
            }}
            onClick={(e) => {
              if (onEndpointPointerDown) return;
              e.cancelBubble = true;
              onWallSelect?.(id);
            }}
            onTap={(e) => {
              if (onEndpointPointerDown) return;
              e.cancelBubble = true;
              onWallSelect?.(id);
            }}
            onDragMove={(e) => {
              onEndpointDragMove?.(id, "start", e.target.x(), e.target.y());
            }}
            onDragEnd={(e) => {
              const nx = e.target.x();
              const ny = e.target.y();
              onEndpointDragEnd?.(id, "start", nx, ny);
            }}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "grab";
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "";
            }}
          />
          {/* End endpoint */}
          <Circle
            x={x2}
            y={y2}
            radius={HANDLE_RADIUS}
            fill={selected ? CANVAS_COLORS.gold : CANVAS_COLORS.bgElevated}
            stroke={selected ? CANVAS_COLORS.goldLight : CANVAS_COLORS.textMuted}
            strokeWidth={1.5}
            draggable={handleDraggable}
            hitFunc={(context, shape) => {
              context.beginPath();
              context.arc(0, 0, HANDLE_HIT_RADIUS, 0, Math.PI * 2, false);
              context.closePath();
              context.fillStrokeShape(shape);
            }}
            onMouseDown={(e) => {
              if (!onEndpointPointerDown) return;
              e.cancelBubble = true;
              e.evt.stopPropagation();
              onEndpointPointerDown(id, "end", x2, y2);
            }}
            onClick={(e) => {
              if (onEndpointPointerDown) return;
              e.cancelBubble = true;
              onWallSelect?.(id);
            }}
            onTap={(e) => {
              if (onEndpointPointerDown) return;
              e.cancelBubble = true;
              onWallSelect?.(id);
            }}
            onDragMove={(e) => {
              onEndpointDragMove?.(id, "end", e.target.x(), e.target.y());
            }}
            onDragEnd={(e) => {
              const nx = e.target.x();
              const ny = e.target.y();
              onEndpointDragEnd?.(id, "end", nx, ny);
            }}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "grab";
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "";
            }}
          />
        </>
      )}
    </Group>
  );
}
