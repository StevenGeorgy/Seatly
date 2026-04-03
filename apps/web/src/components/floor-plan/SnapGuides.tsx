import { Line } from "react-konva";

import { CANVAS_COLORS } from "@/lib/canvas-colors";
import type { SnapLine } from "./types";

type SnapGuidesProps = {
  guides: SnapLine[];
};

export function SnapGuides({ guides }: SnapGuidesProps) {
  return (
    <>
      {guides.map((g) => (
        <Line
          key={g.id}
          points={g.points}
          stroke={CANVAS_COLORS.gold}
          strokeWidth={1}
          dash={[4, 4]}
          opacity={0.7}
          listening={false}
        />
      ))}
    </>
  );
}
