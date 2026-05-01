import { memo, useState } from "react";
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
  dragging?: boolean;
  onClick: (tableId: string, e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onMouseEnter: (tableId: string, screenX: number, screenY: number) => void;
  onMouseLeave: () => void;
  onDragStart?: (tableId: string) => void;
  onDragEnd?: (tableId: string, x: number, y: number) => void;
};

function TableShapeInner({
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
  dragging = false,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onDragStart,
  onDragEnd,
}: TableShapeProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);

  const color = getStatusColor(table.status);
  const size = getTableSize(table);
  const sx = tableTransform?.scaleX ?? 1;
  const sy = tableTransform?.scaleY ?? 1;
  const titleText = table.table_number?.trim() || table.label?.trim() || tableFloorPlanTitle(t, table);

  const chairs =
    table.shape === "circle"
      ? circleChairs(size.radius, table.capacity)
      : rectChairs(size.width, size.height, table.capacity);

  // Determine how many chairs are "filled" (occupied) vs empty
  const seatedCount = table.seated_count ?? 0;
  const isOccupied = table.status === "occupied";

  function handleMouseEnter(e: { evt: MouseEvent }) {
    setHovered(true);
    onMouseEnter(table.id, e.evt.clientX, e.evt.clientY);
  }

  function handleMouseLeave() {
    setHovered(false);
    onMouseLeave();
  }

  const borderWidth = hovered || isSelected ? 2.2 : 1.25;
  const borderColor = isSelected ? CANVAS_COLORS.gold : color;
  const fillColor = CANVAS_COLORS.bgElevated;
  const fillOpacity = 1;
  const tintOpacity = 0.18;
  const shadowBlur = hovered || isSelected ? 18 : 8;
  const shadowOpacity = isSelected ? 0.36 : isEditing ? 0.22 : 0.2;
  const hoverLift = hovered && !dragging ? 1.028 : dragging ? 1.012 : 1;
  const statusGlow = 0.1;

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
      opacity={dragging ? opacity * 0.9 : opacity}
      draggable={draggable}
      dragBoundFunc={dragBoundFunc}
      onClick={(ev) => {
        ev.cancelBubble = true;
        onClick(table.id, ev);
      }}
      onTap={(ev) => {
        ev.cancelBubble = true;
        onClick(table.id, ev as Konva.KonvaEventObject<MouseEvent | TouchEvent>);
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onDragStart={() => {
        onDragStart?.(table.id);
      }}
      onDragEnd={(e) => {
        const pos = e.target;
        onDragEnd?.(table.id, pos.x(), pos.y());
      }}
    >
      <Group
        ref={innerGroupRef}
        scaleX={sx}
        scaleY={sy}
        rotation={tableTransform?.rotation ?? 0}
      >
        <Group scaleX={hoverLift} scaleY={hoverLift}>
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
            <Circle
              radius={size.radius + 5}
              fill={color}
              opacity={statusGlow}
              listening={false}
            />
            {/* Base fill */}
            <Circle
              radius={size.radius}
              fill={fillColor}
              opacity={fillOpacity}
              shadowColor={isSelected && isEditing ? CANVAS_COLORS.gold : CANVAS_COLORS.shadow}
              shadowBlur={shadowBlur}
              shadowOpacity={shadowOpacity}
              shadowOffset={{ x: 0, y: 2 }}
            />
            {/* Status tint */}
            <Circle radius={size.radius} fill={color} opacity={tintOpacity} listening={false} />
            {/* Border */}
            <Circle
              radius={size.radius}
              stroke={borderColor}
              strokeWidth={borderWidth}
              fill="transparent"
              listening={false}
            />
            {/* Selection indicator */}
            {isSelected && (
              <Circle
                radius={size.radius + 7}
                stroke={CANVAS_COLORS.gold}
                strokeWidth={2}
                fill="transparent"
                listening={false}
              />
            )}
          </>
        ) : (
          <>
            <Rect
              x={-size.width / 2 - 5}
              y={-size.height / 2 - 5}
              width={size.width + 10}
              height={size.height + 10}
              cornerRadius={9}
              fill={color}
              opacity={statusGlow}
              listening={false}
            />
            {/* Base fill */}
            <Rect
              x={-size.width / 2}
              y={-size.height / 2}
              width={size.width}
              height={size.height}
              cornerRadius={6}
              fill={fillColor}
              opacity={fillOpacity}
              shadowColor={isSelected && isEditing ? CANVAS_COLORS.gold : CANVAS_COLORS.shadow}
              shadowBlur={shadowBlur}
              shadowOpacity={shadowOpacity}
              shadowOffset={{ x: 0, y: 2 }}
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
              listening={false}
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
              listening={false}
            />
            {/* Selection indicator */}
            {isSelected && (
              <Rect
                x={-size.width / 2 - 7}
                y={-size.height / 2 - 7}
                width={size.width + 14}
                height={size.height + 14}
                cornerRadius={9}
                stroke={CANVAS_COLORS.gold}
                strokeWidth={2}
                fill="transparent"
                listening={false}
              />
            )}
          </>
        )}

        {/* Table number */}
        <Text
          text={titleText}
          x={-72}
          y={-12}
          width={144}
          align="center"
          fontSize={22}
          fontStyle="bold"
          letterSpacing={0.1}
          fontFamily="Georgia, ui-serif, serif"
          fill={CANVAS_COLORS.textPrimary}
          listening={false}
        />
        </Group>
      </Group>
    </Group>
  );
}

export const TableShape = memo(TableShapeInner);
