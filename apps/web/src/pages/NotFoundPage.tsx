import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-xl font-semibold">{t("routes.notFound.title")}</h1>
      <p className="text-muted-foreground text-sm">{t("routes.notFound.hint")}</p>
      <Button asChild>
        <Link to="/">{t("routes.notFound.backHome")}</Link>
      </Button>
    </main>
  );
}
