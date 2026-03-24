import { useTranslation } from "react-i18next";

type PlaceholderPageProps = {
  titleKey: string;
};

/** Temporary shell until each route is fully built (Bible §03). */
export function PlaceholderPage({ titleKey }: PlaceholderPageProps) {
  const { t } = useTranslation();

  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center gap-2 p-8">
      <h1 className="text-xl font-semibold">{t(titleKey)}</h1>
      <p className="text-muted-foreground text-sm">{t("routes.placeholder.subtitle")}</p>
    </main>
  );
}
