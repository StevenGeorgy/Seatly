import { useState } from "react";
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
}: WallSegmentProps) {
  const handleDraggable = showHandles;

  /**
   * Live offset while the body Line is being dragged.
   * Circles follow so the whole wall moves together visually.
   */
  const [bodyOffset, setBodyOffset] = useState({ x: 0, y: 0 });

  /**
   * Live position of whichever endpoint is currently being dragged.
   * The Line renders to this position so the wall stretches in real time.
   */
  const [liveEndpoint, setLiveEndpoint] = useState<{
    which: "start" | "end";
    x: number;
    y: number;
  } | null>(null);

  // ── Computed render positions ──────────────────────────────────────────────
  //
  // LINE points: no bodyOffset here — when the Line node is being dragged,
  // Konva shifts the node's own x/y, which already offsets all its points.
  // Adding bodyOffset to the points would double the movement.
  // During endpoint drag: swap in the live position for the dragged end.
  const lineX1 = liveEndpoint?.which === "start" ? liveEndpoint.x : x1;
  const lineY1 = liveEndpoint?.which === "start" ? liveEndpoint.y : y1;
  const lineX2 = liveEndpoint?.which === "end"   ? liveEndpoint.x : x2;
  const lineY2 = liveEndpoint?.which === "end"   ? liveEndpoint.y : y2;

  // CIRCLE positions: add bodyOffset so handles follow the line body during drag.
  const cx1 = lineX1 + bodyOffset.x;
  const cy1 = lineY1 + bodyOffset.y;
  const cx2 = lineX2 + bodyOffset.x;
  const cy2 = lineY2 + bodyOffset.y;

  return (
    <Group>
      {/* Main wall line — draggable for body movement */}
      <Line
        points={[lineX1, lineY1, lineX2, lineY2]}
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
        onDragMove={(e) => {
          setBodyOffset({ x: e.target.x(), y: e.target.y() });
        }}
        onDragEnd={(e) => {
          const dx = e.target.x();
          const dy = e.target.y();
          // Reset Konva node position — world coords are tracked externally
          e.target.position({ x: 0, y: 0 });
          setBodyOffset({ x: 0, y: 0 });
          onDragEnd?.(id, dx, dy);
        }}
        hitStrokeWidth={12}
      />

      {/* Endpoint handles (edit mode only) */}
      {showHandles && (
        <>
          {/* Start endpoint */}
          <Circle
            x={cx1}
            y={cy1}
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
            onClick={(e) => {
              e.cancelBubble = true;
              onWallSelect?.(id);
            }}
            onTap={(e) => {
              e.cancelBubble = true;
              onWallSelect?.(id);
            }}
            onDragMove={(e) => {
              const nx = e.target.x();
              const ny = e.target.y();
              setLiveEndpoint({ which: "start", x: nx, y: ny });
              onEndpointDragMove?.(id, "start", nx, ny);
            }}
            onDragEnd={(e) => {
              const nx = e.target.x();
              const ny = e.target.y();
              // Reset so the Circle position is re-driven by props after commit
              e.target.position({ x: x1, y: y1 });
              setLiveEndpoint(null);
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
            x={cx2}
            y={cy2}
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
            onClick={(e) => {
              e.cancelBubble = true;
              onWallSelect?.(id);
            }}
            onTap={(e) => {
              e.cancelBubble = true;
              onWallSelect?.(id);
            }}
            onDragMove={(e) => {
              const nx = e.target.x();
              const ny = e.target.y();
              setLiveEndpoint({ which: "end", x: nx, y: ny });
              onEndpointDragMove?.(id, "end", nx, ny);
            }}
            onDragEnd={(e) => {
              const nx = e.target.x();
              const ny = e.target.y();
              // Reset so the Circle position is re-driven by props after commit
              e.target.position({ x: x2, y: y2 });
              setLiveEndpoint(null);
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
