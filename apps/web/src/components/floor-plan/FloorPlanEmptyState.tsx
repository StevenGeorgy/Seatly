import { LayoutDashboard } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

type FloorPlanEmptyStateProps = {
  canEdit: boolean;
  onEnterEdit: () => void;
};

export function FloorPlanEmptyState({ canEdit, onEnterEdit }: FloorPlanEmptyStateProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-bg-elevated">
        <LayoutDashboard className="size-8 text-text-muted" />
      </div>
      <div className="max-w-xs">
        <p className="text-base font-semibold text-text-primary">
          {t("dashboard.floorPlan.noTablesYet")}
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          {t("dashboard.floorPlan.noTablesDesc")}
        </p>
      </div>
      {canEdit && (
        <Button onClick={onEnterEdit} className="mt-2 gap-2">
          {t("dashboard.floorPlan.addFirstTable")}
        </Button>
      )}
    </div>
  );
}
