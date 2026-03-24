import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MarketingShellProps = {
  children: ReactNode;
};

const navLinkClass =
  "text-muted-foreground hover:text-foreground rounded-md px-2 py-1.5 text-sm font-medium transition-colors";
const navLinkActive = "text-foreground bg-muted/60";

function MarketingNavLinks() {
  const { t } = useTranslation();

  return (
    <>
      <NavLink
        to="/features"
        className={({ isActive }) => cn(navLinkClass, isActive && navLinkActive)}
      >
        {t("routes.features.title")}
      </NavLink>
      <NavLink
        to="/pricing"
        className={({ isActive }) => cn(navLinkClass, isActive && navLinkActive)}
      >
        {t("routes.pricing.title")}
      </NavLink>
      <NavLink
        to="/about"
        className={({ isActive }) => cn(navLinkClass, isActive && navLinkActive)}
      >
        {t("routes.about.title")}
      </NavLink>
    </>
  );
}

function MarketingAuthButtons({ className }: { className?: string }) {
  const { t } = useTranslation();

  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      <Button variant="outline" size="default" className="min-h-10 sm:min-h-8" asChild>
        <Link to="/login">{t("routes.auth.login.title")}</Link>
      </Button>
      <Button size="default" className="min-h-10 sm:min-h-8" asChild>
        <Link to="/register">{t("routes.auth.register.title")}</Link>
      </Button>
    </div>
  );
}

export function MarketingShell({ children }: MarketingShellProps) {
  const { t } = useTranslation();

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <header className="border-border bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-50 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 sm:h-14 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:py-0 lg:px-6">
          <div className="flex items-center justify-between gap-3">
            <Link
              to="/"
              className="text-primary shrink-0 text-lg font-semibold tracking-tight"
              aria-label={t("marketing.nav.homeAria")}
            >
              {t("routes.home.title")}
            </Link>
            <MarketingAuthButtons className="sm:hidden" />
          </div>
          <nav
            className="border-border flex flex-wrap items-center gap-1 border-t pt-3 sm:flex-1 sm:justify-center sm:border-t-0 sm:pt-0"
            aria-label={t("marketing.nav.ariaLabel")}
          >
            <MarketingNavLinks />
          </nav>
          <MarketingAuthButtons className="hidden sm:flex" />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
