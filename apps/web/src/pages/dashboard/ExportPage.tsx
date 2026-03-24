import { useTranslation } from "react-i18next";
import { FileDown, Download } from "lucide-react";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export default function ExportPage() {
  const { t } = useTranslation();

  const inclusions = [
    { key: "reservationsData", label: t("dashboard.export.reservationsData") },
    { key: "ordersData", label: t("dashboard.export.ordersData") },
    { key: "expensesData", label: t("dashboard.export.expensesData") },
    { key: "payrollData", label: t("dashboard.export.payrollData") },
    { key: "analyticsData", label: t("dashboard.export.analyticsData") },
  ];

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader title={t("dashboard.export.title")} />

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title={t("dashboard.export.generate")}>
          <div className="flex flex-col gap-5">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                {t("dashboard.export.includes")}
              </p>
              <div className="flex flex-col gap-3">
                {inclusions.map((inc) => (
                  <div key={inc.key} className="flex items-center gap-3">
                    <Checkbox id={inc.key} defaultChecked />
                    <Label htmlFor={inc.key} className="text-sm text-text-secondary">
                      {inc.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
            <Button className="w-full gap-2">
              <Download className="size-4" />
              {t("dashboard.export.generate")}
            </Button>
          </div>
        </SectionCard>

        <SectionCard title={t("dashboard.export.previousExports")}>
          <EmptyState
            icon={<FileDown className="size-5" />}
            title={t("dashboard.export.noExports")}
            description={t("dashboard.export.noExportsDesc")}
          />
        </SectionCard>
      </div>
    </AnimatedPage>
  );
}
