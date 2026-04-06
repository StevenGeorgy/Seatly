import { Layers } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

type FloorPlanNoSectionStateProps = {
  canEdit: boolean;
  onAddFloor: () => void;
};

export function FloorPlanNoSectionState({ canEdit, onAddFloor }: FloorPlanNoSectionStateProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-bg-elevated">
        <Layers className="size-8 text-text-muted" />
      </div>
      <div className="max-w-xs">
        <p className="text-base font-semibold text-text-primary">
          {t("dashboard.floorPlan.noFloorYet")}
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          {t("dashboard.floorPlan.noFloorDesc")}
        </p>
      </div>
      {canEdit && (
        <Button onClick={onAddFloor} className="mt-2 gap-2">
          {t("dashboard.floorPlan.addFirstFloor")}
        </Button>
      )}
    </div>
  );
}
