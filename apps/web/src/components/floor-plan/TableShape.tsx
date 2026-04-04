import { useState } from "react";
import type Konva from "konva";
import { useTranslation } from "react-i18next";
import { Circle, Group, Rect, Text } from "react-konva";

import type { TableRow } from "@/hooks/useFloorPlan";
import { tableFloorPlanTitle } from "./table-title";
import { CANVAS_COLORS, getStatusColor } from "@/lib/canvas-colors";

import { ChairIndicator } from "./ChairIndicator";

// ─── Sizing helpers ──────────────────────────────────────────────────────────

export type TableShapeSize = { width: number; height: number; radius: number };

export function getTableSize(table: TableRow): TableShapeSize {
  const cap = Math.max(1, table.capacity ?? 2);
  if (table.shape === "circle") {
    const r = 26 + cap * 3;
    return { width: r * 2, height: r * 2, radius: r };
  }
  if (table.shape === "square") {
    const s = 44 + cap * 5;
    return { width: s, height: s, radius: 0 };
  }
  // rectangle
  return { width: 60 + cap * 14, height: 42, radius: 0 };
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
  const offset = radius + 10;
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
  const gap = 10;

  for (let i = 0; i < topCount; i++) {
    const x = -hw + ((i + 1) * width) / (topCount + 1);
    chairs.push({ x, y: -hh - gap, angle: 180 });
  }
  for (let i = 0; i < bottomCount; i++) {
    const x = -hw + ((i + 1) * width) / (bottomCount + 1);
    chairs.push({ x, y: hh + gap, angle: 0 });
  }
  return chairs;
}

// ─── Component ───────────────────────────────────────────────────────────────

/** Optional drag limits (world px, table center) so tables stay inside the floor plan bounds. */
export type TableDragBounds = { minX: number; maxX: number; minY: number; maxY: number };

type TableShapeProps = {
  table: TableRow;
  x: number;
  y: number;
  isSelected: boolean;
  isEditing: boolean;
  tableTransform?: TableShapeTransform | null;
  innerGroupRef?: React.Ref<Konva.Group>;
  opacity?: number;
  draggable?: boolean;
  /** When set with draggable, Konva keeps the table center inside these bounds while dragging. */
  dragBounds?: TableDragBounds | null;
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
  dragBounds = null,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onDragEnd,
}: TableShapeProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);

  const color = getStatusColor(table.status);
  const size = getTableSize(table);
  const sx = tableTransform?.scaleX ?? 1;
  const sy = tableTransform?.scaleY ?? 1;
  const titleText = tableFloorPlanTitle(t, table);
  const capText = `${table.capacity ?? 0}`;

  const chairs =
    table.shape === "circle"
      ? circleChairs(size.radius, table.capacity)
      : rectChairs(size.width, size.height, table.capacity);

  // Determine how many chairs are "filled" (occupied) vs empty
  const seatedCount = table.seated_count ?? 0;
  const isOccupied = table.status === "occupied";

  function handleMouseEnter(e: { evt: MouseEvent }) {
    setHovered(true);
    onMouseEnter(e.evt.clientX, e.evt.clientY);
  }

  function handleMouseLeave() {
    setHovered(false);
    onMouseLeave();
  }

  const borderWidth = hovered || isSelected ? 2.5 : 1.5;
  const borderColor = isSelected && isEditing ? CANVAS_COLORS.gold : color;
  const fillColor = CANVAS_COLORS.bgElevated;
  const fillOpacity = 1;
  const tintOpacity = 0.12;

  const dragBoundFunc =
    draggable && dragBounds
      ? (pos: { x: number; y: number }) => ({
          x: Math.max(dragBounds.minX, Math.min(dragBounds.maxX, pos.x)),
          y: Math.max(dragBounds.minY, Math.min(dragBounds.maxY, pos.y)),
        })
      : undefined;

  return (
    <Group
      x={x}
      y={y}
      opacity={opacity}
      draggable={draggable}
      dragBoundFunc={dragBoundFunc}
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
        {/* Chairs */}
        {chairs.map((c, i) => (
          <ChairIndicator
            key={`chair-${i}`}
            x={c.x}
            y={c.y}
            angle={c.angle}
            color={color}
            filled={isOccupied ? i < seatedCount : table.status === "empty" || table.status === "reserved"}
          />
        ))}

        {table.shape === "circle" ? (
          <>
            {/* Base fill */}
            <Circle radius={size.radius} fill={fillColor} opacity={fillOpacity} />
            {/* Status tint */}
            <Circle radius={size.radius} fill={color} opacity={tintOpacity} />
            {/* Border */}
            <Circle
              radius={size.radius}
              stroke={borderColor}
              strokeWidth={borderWidth}
              fill="transparent"
            />
            {/* Selection indicator */}
            {isSelected && isEditing && (
              <Circle
                radius={size.radius + 6}
                stroke={CANVAS_COLORS.gold}
                strokeWidth={1.5}
                dash={[5, 3]}
                fill="transparent"
              />
            )}
          </>
        ) : (
          <>
            {/* Base fill */}
            <Rect
              x={-size.width / 2}
              y={-size.height / 2}
              width={size.width}
              height={size.height}
              cornerRadius={6}
              fill={fillColor}
              opacity={fillOpacity}
            />
            {/* Status tint */}
            <Rect
              x={-size.width / 2}
              y={-size.height / 2}
              width={size.width}
              height={size.height}
              cornerRadius={6}
              fill={color}
              opacity={tintOpacity}
            />
            {/* Border */}
            <Rect
              x={-size.width / 2}
              y={-size.height / 2}
              width={size.width}
              height={size.height}
              cornerRadius={6}
              stroke={borderColor}
              strokeWidth={borderWidth}
              fill="transparent"
            />
            {/* Selection indicator */}
            {isSelected && isEditing && (
              <Rect
                x={-size.width / 2 - 6}
                y={-size.height / 2 - 6}
                width={size.width + 12}
                height={size.height + 12}
                cornerRadius={8}
                stroke={CANVAS_COLORS.gold}
                strokeWidth={1.5}
                dash={[5, 3]}
                fill="transparent"
              />
            )}
          </>
        )}

        {/* Table title: Table(x) */}
        <Text
          text={titleText}
          x={-70}
          y={-13}
          width={140}
          align="center"
          fontSize={12}
          fontStyle="bold"
          fontFamily="Inter, system-ui, sans-serif"
          fill={CANVAS_COLORS.textPrimary}
          listening={false}
        />
        {/* Capacity indicator */}
        <Text
          text={capText}
          x={-30}
          y={2}
          width={60}
          align="center"
          fontSize={10}
          fontFamily="Inter, system-ui, sans-serif"
          fill={CANVAS_COLORS.textMuted}
          listening={false}
        />
      </Group>
    </Group>
  );
}
