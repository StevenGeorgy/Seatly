import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MarketingShellProps = {
  children: ReactNode;
};

const navLinkClass =
  "text-text-muted hover:text-white px-3 py-1.5 text-sm font-medium transition-colors duration-200 relative";
const navLinkActive = "text-white";

function MarketingNavLinks({ onClick }: { onClick?: () => void }) {
  const { t } = useTranslation();

  const links = [
    { to: "/", label: "Product" },
    { to: "/features", label: t("routes.features.title") },
    { to: "/pricing", label: t("routes.pricing.title") },
    { to: "/about", label: t("routes.about.title") },
  ];

  return (
    <>
      {links.map((link) => (
        <NavLink
          key={link.to + link.label}
          to={link.to}
          onClick={onClick}
          className={({ isActive }) =>
            cn(navLinkClass, isActive && navLinkActive)
          }
        >
          {({ isActive }) => (
            <>
              {link.label}
              {isActive && (
                <motion.div
                  layoutId="marketing-nav-indicator"
                  className="absolute inset-x-3 -bottom-[13px] h-px bg-gold"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
            </>
          )}
        </NavLink>
      ))}
    </>
  );
}

export function MarketingShell({ children }: MarketingShellProps) {
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center px-4 lg:px-6">
          {/* Left: Logo */}
          <Link
            to="/"
            className="shrink-0 text-sm font-bold tracking-[0.25em] text-gold"
            aria-label={t("marketing.nav.homeAria")}
          >
            SEATLY
          </Link>

          {/* Center: Nav (absolutely positioned for true centering) */}
          <nav
            className="hidden flex-1 items-center justify-center gap-1 sm:flex"
            aria-label={t("marketing.nav.ariaLabel")}
          >
            <MarketingNavLinks />
          </nav>

          {/* Right: Auth buttons */}
          <div className="hidden shrink-0 items-center gap-3 sm:flex">
            <Link
              to="/login"
              className="text-sm font-medium text-text-secondary transition-colors hover:text-white"
            >
              Login
            </Link>
            <Button size="sm" className="px-5 font-semibold" asChild>
              <Link to="/register">Get Started</Link>
            </Button>
          </div>

          {/* Mobile menu toggle */}
          <button
            type="button"
            className="ml-auto flex size-9 items-center justify-center rounded-lg text-text-muted transition-colors hover:text-white sm:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {/* Mobile dropdown */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="overflow-hidden border-t border-border/50 sm:hidden"
            >
              <div className="flex flex-col gap-1 px-4 py-3">
                <MarketingNavLinks onClick={() => setMobileOpen(false)} />
                <div className="my-2 h-px bg-border/50" />
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="flex-1" asChild>
                    <Link to="/login" onClick={() => setMobileOpen(false)}>
                      Login
                    </Link>
                  </Button>
                  <Button size="sm" className="flex-1" asChild>
                    <Link to="/register" onClick={() => setMobileOpen(false)}>
                      Get Started
                    </Link>
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-3 px-4 sm:flex-row sm:justify-between lg:px-6">
          <span className="text-xs font-bold tracking-[0.25em] text-gold/60">SEATLY</span>
          <span className="text-xs text-text-muted">
            &copy; {new Date().getFullYear()} Seatly. {t("marketing.footer.rights")}
          </span>
        </div>
      </footer>
    </div>
  );
}
