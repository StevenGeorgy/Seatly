import type Konva from "konva";
import { Group, Rect, Text } from "react-konva";

import type { FloorPlanZone } from "@/hooks/useFloorPlan";
import { CANVAS_COLORS } from "@/lib/canvas-colors";

type FloorPlanZoneShapeProps = {
  zone: FloorPlanZone;
  isSelected: boolean;
  isEditing: boolean;
  worldW: number;
  worldH: number;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
  innerRef?: React.Ref<Konva.Group>;
};

const CORNER_R = 12;

/**
 * Room zone: flat floor colour (matches editor canvas) + gold frame + label.
 */
export function FloorPlanZoneShape({
  zone,
  isSelected,
  isEditing,
  worldW,
  worldH,
  onSelect,
  onDragEnd,
  innerRef,
}: FloorPlanZoneShapeProps) {
  const w = zone.width;
  const h = zone.height;
  const r = CORNER_R;

  const dragBoundFunc =
    isEditing
      ? (pos: { x: number; y: number }) => ({
          x: Math.max(0, Math.min(worldW - w, pos.x)),
          y: Math.max(0, Math.min(worldH - h, pos.y)),
        })
      : undefined;

  const strokeOuter = isSelected
    ? CANVAS_COLORS.zonePanelStrokeSelected
    : CANVAS_COLORS.zonePanelStroke;
  const strokeW = isSelected ? 5.5 : 5;

  return (
    <Group
      ref={innerRef}
      x={zone.x}
      y={zone.y}
      draggable={isEditing}
      dragBoundFunc={dragBoundFunc}
      onMouseDown={(e) => {
        e.cancelBubble = true;
      }}
      onTouchStart={(e) => {
        e.cancelBubble = true;
      }}
      onClick={(e) => {
        e.cancelBubble = true;
        onSelect();
      }}
      onTap={(e) => {
        e.cancelBubble = true;
        onSelect();
      }}
      onDragEnd={(e) => {
        const n = e.target;
        onDragEnd(n.x(), n.y());
      }}
    >
      {/* Subtle warm tint so the zone reads as a distinct floor area */}
      <Rect
        x={0}
        y={0}
        width={w}
        height={h}
        cornerRadius={r}
        fill="rgba(201, 168, 76, 0.045)"
        listening={false}
      />
      <Rect
        x={0}
        y={0}
        width={w}
        height={h}
        cornerRadius={r}
        fill="transparent"
        stroke={strokeOuter}
        strokeWidth={strokeW}
        listening
      />

      <Text
        x={16}
        y={14}
        width={Math.max(56, w - 32)}
        text={zone.label.toUpperCase()}
        fontSize={18}
        fontStyle="bold"
        letterSpacing={3}
        lineHeight={1.2}
        fontFamily="Inter, system-ui, sans-serif"
        fill={CANVAS_COLORS.zoneLabel}
        shadowColor={CANVAS_COLORS.zoneLabelShadow}
        shadowBlur={4}
        shadowOpacity={1}
        shadowOffset={{ x: 0, y: 1 }}
        listening={false}
      />
    </Group>
  );
}
