import { useTranslation } from "react-i18next";

import { isSupabaseConfigured } from "@/lib/supabase/client";

export function DevSupabaseBanner() {
  const { t } = useTranslation();

  if (!import.meta.env.DEV || isSupabaseConfigured()) {
    return null;
  }

  return (
    <div
      role="status"
      className="border-border bg-warning/15 text-warning border-b px-4 py-2 text-center text-xs"
    >
      {t("app.dev.missingSupabase")}
    </div>
  );
}
