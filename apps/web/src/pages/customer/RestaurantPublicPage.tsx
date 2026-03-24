import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

export default function RestaurantPublicPage() {
  const { t } = useTranslation();
  const { restaurantSlug } = useParams<{ restaurantSlug: string }>();

  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center gap-2 p-8">
      <h1 className="text-xl font-semibold">{t("routes.restaurant.title")}</h1>
      <p className="text-muted-foreground font-mono text-sm">{restaurantSlug ?? "—"}</p>
      <p className="text-muted-foreground text-sm">{t("routes.placeholder.subtitle")}</p>
    </main>
  );
}
