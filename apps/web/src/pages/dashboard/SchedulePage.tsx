import { useTranslation } from "react-i18next";
import { CalendarCheck } from "lucide-react";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";

export default function SchedulePage() {
  const { t } = useTranslation();

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("routes.dashboard.schedule.title")}
        actions={
          <Button size="default" className="gap-2">
            {t("dashboard.staff.createShift")}
          </Button>
        }
      />
      <EmptyState
        icon={<CalendarCheck className="size-5" />}
        title="Schedule view"
        description="Weekly schedule calendar coming soon."
      />
    </AnimatedPage>
  );
}
