import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { Bell, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/useUser";
import { resolveDashboardPageLabelKey } from "@/lib/auth/dashboard-access";

export function DashboardTopBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { profile, signOut } = useUser();
  const titleKey = resolveDashboardPageLabelKey(pathname);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-card/60 px-4 backdrop-blur-xl sm:px-6">
      <h2 className="min-w-0 truncate text-base font-semibold text-foreground">
        {t(titleKey)}
      </h2>
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden max-w-[10rem] truncate text-sm text-muted-foreground sm:inline">
          {profile?.full_name ?? profile?.email ?? ""}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
        >
          <Bell className="size-4" />
        </Button>
        <div className="h-4 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void signOut()}
          className="text-muted-foreground hover:text-destructive"
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
