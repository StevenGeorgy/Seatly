import { Circle, Group, Rect, Text } from "react-konva";

import type { DecorationItem as DecorationModel } from "@/hooks/useFloorPlan";
import { CANVAS_COLORS } from "@/lib/canvas-colors";

type DecorationItemProps = {
  item: DecorationModel;
  selected?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  onDragEnd?: (id: string, x: number, y: number) => void;
};

export function DecorationItem({
  item,
  selected = false,
  draggable = false,
  onClick,
  onDragEnd,
}: DecorationItemProps) {
  const hw = item.width / 2;
  const hh = item.height / 2;

  return (
    <Group
      x={item.x}
      y={item.y}
      rotation={item.rotation}
      draggable={draggable}
      onClick={onClick}
      onTap={onClick}
      onDragEnd={(e) => onDragEnd?.(item.id, e.target.x(), e.target.y())}
    >
      {/* Base rectangle */}
      <Rect
        x={-hw}
        y={-hh}
        width={item.width}
        height={item.height}
        cornerRadius={8}
        fill={CANVAS_COLORS.bgElevated}
        stroke={selected ? CANVAS_COLORS.gold : CANVAS_COLORS.border}
        strokeWidth={selected ? 2 : 1}
      />

      {/* Type-specific decoration */}
      {(item.type === "sofa" || item.type === "host_stand") && (
        <Rect
          x={-hw + 6}
          y={-hh + 6}
          width={item.width - 12}
          height={item.height - 12}
          cornerRadius={5}
          fill={CANVAS_COLORS.bgSurface}
          opacity={0.7}
        />
      )}
      {item.type === "planter" && (
        <>
          <Circle radius={Math.min(hw, hh) * 0.55} fill={CANVAS_COLORS.success} opacity={0.55} />
          <Circle radius={Math.min(hw, hh) * 0.3} fill={CANVAS_COLORS.success} opacity={0.4} />
        </>
      )}
      {item.type === "divider" && (
        <Rect
          x={-hw + 4}
          y={-3}
          width={item.width - 8}
          height={6}
          cornerRadius={3}
          fill={CANVAS_COLORS.border}
        />
      )}
      {item.type === "service_station" && (
        <>
          <Rect x={-hw + 4} y={-hh + 4} width={10} height={10} cornerRadius={2} fill={CANVAS_COLORS.info} opacity={0.6} />
          <Rect x={hw - 14} y={-hh + 4} width={10} height={10} cornerRadius={2} fill={CANVAS_COLORS.gold} opacity={0.6} />
        </>
      )}

      {/* Label */}
      <Text
        text={(item.label ?? item.type).toUpperCase()}
        x={-hw}
        y={-8}
        width={item.width}
        align="center"
        fontSize={9}
        fontStyle="600"
        fill={CANVAS_COLORS.textSecondary}
        letterSpacing={1}
        listening={false}
      />
    </Group>
  );
}
