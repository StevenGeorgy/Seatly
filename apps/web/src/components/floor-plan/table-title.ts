import type { TFunction } from "i18next";

/** Floor plan UI title: `Table(x)` where x is `table_number` only. */
export function tableFloorPlanTitle(
  t: TFunction,
  table: { table_number: string | null },
): string {
  const idPart = table.table_number?.trim() || "";
  return t("dashboard.floorPlan.tableTitleFormat", {
    number: idPart || t("dashboard.floorPlan.tableIdPlaceholder"),
  });
}
