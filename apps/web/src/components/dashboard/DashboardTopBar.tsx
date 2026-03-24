import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/useUser";
import { resolveDashboardPageLabelKey } from "@/lib/auth/dashboard-access";

export function DashboardTopBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { profile, signOut } = useUser();
  const titleKey = resolveDashboardPageLabelKey(pathname);

  return (
    <header className="border-border bg-background flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <Link
          to="/"
          className="text-primary shrink-0 text-sm font-semibold tracking-[0.2em]"
        >
          SEATLY
        </Link>
        <h2 className="text-foreground truncate text-lg font-semibold">{t(titleKey)}</h2>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-muted-foreground hidden max-w-[12rem] truncate text-sm sm:inline">
          {profile?.full_name ?? profile?.email ?? ""}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={() => void signOut()}>
          {t("dashboard.shell.signOut")}
        </Button>
      </div>
    </header>
  );
}
