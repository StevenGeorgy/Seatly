import type { FloorPlanZone, TableRow } from "@/hooks/useFloorPlan";

/**
 * Room zone that contains the table center (smallest overlapping zone wins if multiple contain the point).
 */
export function getZoneLabelForTable(table: TableRow, zones: FloorPlanZone[]): string | null {
  const px = table.position_x ?? 0;
  const py = table.position_y ?? 0;
  const containing = zones.filter((z) => {
    const w = z.width;
    const h = z.height;
    if (w <= 0 || h <= 0) return false;
    return px >= z.x && px <= z.x + w && py >= z.y && py <= z.y + h;
  });
  if (containing.length === 0) return null;
  containing.sort((a, b) => a.width * a.height - b.width * b.height);
  const label = containing[0]?.label?.trim();
  return label && label.length > 0 ? label : null;
}
