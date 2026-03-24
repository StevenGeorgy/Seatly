import { useTranslation } from "react-i18next";

import { MarketingShell } from "@/components/marketing/MarketingShell";

export default function AboutPage() {
  const { t } = useTranslation();

  return (
    <MarketingShell>
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">{t("routes.about.title")}</h1>
        <p className="text-muted-foreground mt-3 text-sm">{t("routes.placeholder.subtitle")}</p>
      </div>
    </MarketingShell>
  );
}
