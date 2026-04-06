import { useTranslation } from "react-i18next";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { SectionRow, TableRow } from "@/hooks/useFloorPlan";

import { LiveServiceTablePanel } from "./LiveServiceTablePanel";
import { tableFloorPlanTitle } from "./table-title";

type TableDetailDrawerProps = {
  table: TableRow | null;
  sections: SectionRow[];
  zoneLabel: string | null;
  onClose: () => void;
  onUpdateStatus: (tableId: string, status: string, seatedCount?: number) => void;
  onCombine: () => void;
  onEditTable?: () => void;
  canEdit: boolean;
};

/** Mobile / narrow: bottom sheet for live table actions. Desktop uses the right inspector. */
export function TableDetailDrawer({
  table,
  sections,
  zoneLabel,
  onClose,
  onUpdateStatus,
  onCombine,
  onEditTable,
  canEdit,
}: TableDetailDrawerProps) {
  const { t } = useTranslation();

  return (
    <Sheet
      open={!!table}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-[min(100vw-1rem,26rem)] flex-col gap-0 border-border/80 bg-bg-surface p-0 sm:max-w-none"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>
            {table
              ? tableFloorPlanTitle(t, table)
              : t("dashboard.floorPlan.tableTitleFormat", {
                  number: t("dashboard.floorPlan.tableIdPlaceholder"),
                })}
          </SheetTitle>
        </SheetHeader>

        {table ? (
          <LiveServiceTablePanel
            table={table}
            sections={sections}
            zoneLabel={zoneLabel}
            onUpdateStatus={onUpdateStatus}
            onCombine={onCombine}
            onEditTable={onEditTable}
            canEdit={canEdit}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
