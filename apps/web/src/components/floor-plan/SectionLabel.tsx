import { Text } from "react-konva";

import { CANVAS_COLORS } from "@/lib/canvas-colors";

type SectionLabelProps = {
  text: string;
  x: number;
  y: number;
};

export function SectionLabel({ text, x, y }: SectionLabelProps) {
  return (
    <Text
      text={text.toUpperCase()}
      x={x}
      y={y}
      fontSize={26}
      fontStyle="600"
      fill={CANVAS_COLORS.textMuted}
      opacity={0.4}
      letterSpacing={3}
      listening={false}
    />
  );
}
