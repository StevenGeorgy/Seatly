import { useTranslation } from "react-i18next";

export function RouteFallback() {
  const { t } = useTranslation();

  return (
    <div className="bg-background text-muted-foreground flex min-h-screen items-center justify-center text-sm">
      {t("routes.loading")}
    </div>
  );
}
