import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  const { t } = useTranslation();

  return (
    <MarketingShell>
      <section className="mx-auto flex max-w-3xl flex-col items-center px-6 py-20 text-center sm:py-28">
        <h1 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
          {t("marketing.home.headline")}
        </h1>
        <p className="text-muted-foreground mt-4 max-w-xl text-base sm:text-lg">
          {t("marketing.home.subhead")}
        </p>
        <div className="mt-10 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
          <Button size="lg" className="w-full sm:w-auto" asChild>
            <Link to="/register">{t("marketing.home.ctaSignUp")}</Link>
          </Button>
          <Button size="lg" variant="outline" className="w-full sm:w-auto" asChild>
            <Link to="/login">{t("marketing.home.ctaLogIn")}</Link>
          </Button>
        </div>
        <p className="text-muted-foreground mt-8 text-sm">{t("routes.placeholder.subtitle")}</p>
      </section>
    </MarketingShell>
  );
}
