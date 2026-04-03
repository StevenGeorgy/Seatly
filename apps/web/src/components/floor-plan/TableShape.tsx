import { useState } from "react";
import type Konva from "konva";
import { Circle, Group, Rect, Text } from "react-konva";

import type { TableRow } from "@/hooks/useFloorPlan";
import { CANVAS_COLORS, getStatusColor } from "@/lib/canvas-colors";

import { ChairIndicator } from "./ChairIndicator";

// ─── Sizing helpers ──────────────────────────────────────────────────────────

export type TableShapeSize = { width: number; height: number; radius: number };

export function getTableSize(table: TableRow): TableShapeSize {
  const cap = Math.max(1, table.capacity ?? 2);
  if (table.shape === "circle") {
    const r = 28 + cap * 3;
    return { width: r * 2, height: r * 2, radius: r };
  }
  if (table.shape === "square") {
    const s = 48 + cap * 5;
    return { width: s, height: s, radius: 0 };
  }
  // rectangle
  return { width: 64 + cap * 14, height: 44, radius: 0 };
}

export type TableShapeTransform = {
  scaleX: number;
  scaleY: number;
  rotation?: number;
};

/** Axis-aligned bounds in canvas/world space (center = table position). */
export function getTableWorldBounds(
  table: TableRow,
  transform?: { scaleX?: number; scaleY?: number } | null,
): { left: number; top: number; right: number; bottom: number } {
  const size = getTableSize(table);
  const sx = transform?.scaleX ?? 1;
  const sy = transform?.scaleY ?? 1;
  const cx = table.position_x ?? 0;
  const cy = table.position_y ?? 0;
  if (table.shape === "circle") {
    const r = size.radius * Math.max(sx, sy);
    return { left: cx - r, top: cy - r, right: cx + r, bottom: cy + r };
  }
  const hw = (size.width * sx) / 2;
  const hh = (size.height * sy) / 2;
  return { left: cx - hw, top: cy - hh, right: cx + hw, bottom: cy + hh };
}

export function worldRectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

// ─── Chair placement ─────────────────────────────────────────────────────────

type ChairPos = { x: number; y: number; angle: number };

function circleChairs(radius: number, capacity: number): ChairPos[] {
  const count = Math.max(2, Math.min(capacity, 12));
  const offset = radius + 14;
  return Array.from({ length: count }, (_, i) => {
    const theta = (Math.PI * 2 * i) / count - Math.PI / 2;
    return {
      x: Math.cos(theta) * offset,
      y: Math.sin(theta) * offset,
      angle: (theta * 180) / Math.PI + 90,
    };
  });
}

function rectChairs(width: number, height: number, capacity: number): ChairPos[] {
  const chairs: ChairPos[] = [];
  const cap = Math.max(1, capacity);
  const topCount = Math.floor(cap / 2);
  const bottomCount = cap - topCount;
  const hw = width / 2;
  const hh = height / 2;
  const gap = 14;

  for (let i = 0; i < topCount; i++) {
    const x = -hw + ((i + 1) * width) / (topCount + 1);
    chairs.push({ x, y: -hh - gap, angle: 180 });
  }
  for (let i = 0; i < bottomCount; i++) {
    const x = -hw + ((i + 1) * width) / (bottomCount + 1);
    chairs.push({ x, y: hh + gap, angle: 0 });
  }
  if (cap >= 4) {
    chairs.push({ x: -hw - gap, y: 0, angle: 90 });
    chairs.push({ x: hw + gap, y: 0, angle: 270 });
  }
  return chairs;
}

// ─── Component ───────────────────────────────────────────────────────────────

type TableShapeProps = {
  table: TableRow;
  x: number;
  y: number;
  isSelected: boolean;
  isEditing: boolean;
  /** Persisted scale from floor plan layout (owners resize via Transformer). */
  tableTransform?: TableShapeTransform | null;
  /** Ref to the inner scaled group — Transformer attaches here. */
  innerGroupRef?: React.Ref<Konva.Group>;
  opacity?: number;
  draggable?: boolean;
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onMouseEnter: (screenX: number, screenY: number) => void;
  onMouseLeave: () => void;
  onDragEnd?: (x: number, y: number) => void;
};

export function TableShape({
  table,
  x,
  y,
  isSelected,
  isEditing,
  tableTransform,
  innerGroupRef,
  opacity = 1,
  draggable = false,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onDragEnd,
}: TableShapeProps) {
  const [hovered, setHovered] = useState(false);

  const color = getStatusColor(table.status);
  const size = getTableSize(table);
  const sx = tableTransform?.scaleX ?? 1;
  const sy = tableTransform?.scaleY ?? 1;
  const label = table.table_number ?? table.label ?? "–";
  const capText = `×${table.capacity ?? 0}`;

  const chairs =
    table.shape === "circle"
      ? circleChairs(size.radius, table.capacity)
      : rectChairs(size.width, size.height, table.capacity);

  function handleMouseEnter(e: { evt: MouseEvent }) {
    setHovered(true);
    onMouseEnter(e.evt.clientX, e.evt.clientY);
  }

  function handleMouseLeave() {
    setHovered(false);
    onMouseLeave();
  }

  return (
    <Group
      x={x}
      y={y}
      opacity={opacity}
      draggable={draggable}
      onClick={(ev) => onClick(ev)}
      onTap={(ev) => onClick(ev)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onDragEnd={(e) => {
        const pos = e.target;
        onDragEnd?.(pos.x(), pos.y());
      }}
    >
      <Group ref={innerGroupRef} scaleX={sx} scaleY={sy} rotation={tableTransform?.rotation ?? 0}>
        {chairs.map((c, i) => (
          <ChairIndicator key={`chair-${i}`} x={c.x} y={c.y} angle={c.angle} color={color} />
        ))}

        {table.shape === "circle" ? (
          <>
            <Circle radius={size.radius} fill={CANVAS_COLORS.bgElevated} />
            <Circle radius={size.radius - 2} fill={color} opacity={0.18} />
            <Circle radius={size.radius * 0.55} fill={CANVAS_COLORS.bgSurface} opacity={0.4} />
            <Circle
              radius={size.radius}
              stroke={color}
              strokeWidth={hovered ? 3 : 2}
              fill="transparent"
            />
            {isSelected && isEditing && (
              <Circle
                radius={size.radius + 7}
                stroke={CANVAS_COLORS.gold}
                strokeWidth={2}
                dash={[6, 4]}
                fill="transparent"
              />
            )}
          </>
        ) : (
          <>
            <Rect
              x={-size.width / 2}
              y={-size.height / 2}
              width={size.width}
              height={size.height}
              cornerRadius={8}
              fill={CANVAS_COLORS.bgElevated}
            />
            <Rect
              x={-size.width / 2 + 3}
              y={-size.height / 2 + 3}
              width={size.width - 6}
              height={size.height - 6}
              cornerRadius={6}
              fill={color}
              opacity={0.18}
            />
            <Rect
              x={-size.width / 2 + 8}
              y={-size.height / 2 + 8}
              width={size.width - 16}
              height={size.height - 16}
              cornerRadius={4}
              fill={CANVAS_COLORS.bgSurface}
              opacity={0.35}
            />
            <Rect
              x={-size.width / 2}
              y={-size.height / 2}
              width={size.width}
              height={size.height}
              cornerRadius={8}
              stroke={color}
              strokeWidth={hovered ? 3 : 2}
              fill="transparent"
            />
            {isSelected && isEditing && (
              <Rect
                x={-size.width / 2 - 7}
                y={-size.height / 2 - 7}
                width={size.width + 14}
                height={size.height + 14}
                cornerRadius={10}
                stroke={CANVAS_COLORS.gold}
                strokeWidth={2}
                dash={[6, 4]}
                fill="transparent"
              />
            )}
          </>
        )}

        <Text
          text={label}
          x={-36}
          y={-12}
          width={72}
          align="center"
          fontSize={13}
          fontStyle="bold"
          fill={CANVAS_COLORS.textPrimary}
          listening={false}
        />
        <Text
          text={capText}
          x={-24}
          y={3}
          width={48}
          align="center"
          fontSize={10}
          fill={CANVAS_COLORS.textSecondary}
          listening={false}
        />
      </Group>
    </Group>
  );
}
