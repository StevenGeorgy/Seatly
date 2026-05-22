import { type ReactNode, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, Search } from "lucide-react";

import { CenaivaWordmark } from "@/components/brand/CenaivaWordmark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MarketingShellProps = {
  children: ReactNode;
};

const navLinkClass =
  "text-text-secondary hover:text-white px-4 py-2 text-base font-medium transition-colors duration-200 relative";
const navLinkActive = "text-white";

function navigateToAuth(path: "/login" | "/register") {
  window.location.assign(path);
}

function MarketingNavLinks({ onClick }: { onClick?: () => void }) {
  const links = [
    { to: "/hey-cenaiva", label: "Hey Cenaiva" },
    { to: "/loyalty", label: "Loyalty" },
    { to: "/restaurants", label: "For Restaurants" },
  ];

  return (
    <>
      {links.map((link) => (
        <NavLink
          key={link.to + link.label}
          to={link.to}
          onClick={onClick}
          end
          className={({ isActive }) =>
            cn(navLinkClass, isActive && navLinkActive)
          }
        >
          {link.label}
        </NavLink>
      ))}
    </>
  );
}

export function MarketingShell({ children }: MarketingShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="flex h-20 w-full items-center px-12 sm:px-16 md:px-20 lg:px-24 xl:px-32 2xl:px-40 md:h-24">
          <Link to="/" className="flex shrink-0 items-center" aria-label="Cenaiva home">
            <CenaivaWordmark className="h-[4.5rem] md:h-[5.5rem]" />
          </Link>

          <nav
            className="hidden flex-1 items-center justify-center gap-2 md:flex"
            aria-label="Primary"
          >
            <MarketingNavLinks />
          </nav>

          <div className="hidden shrink-0 items-center gap-4 md:flex">
            <Link
              to="/discover"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-surface/60 px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-white"
            >
              <Search className="size-4 text-gold" />
              Discover
            </Link>
            <button
              type="button"
              onClick={() => navigateToAuth("/login")}
              className="text-base font-medium text-text-secondary transition-colors hover:text-white"
            >
              Log in
            </button>
            <Button
              type="button"
              className="rounded-full px-6 text-base font-semibold"
              onClick={() => navigateToAuth("/register")}
            >
              Sign up
            </Button>
          </div>

          <button
            type="button"
            className="ml-auto flex size-9 items-center justify-center rounded-lg text-text-muted transition-colors hover:text-white md:hidden"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="overflow-hidden border-t border-border/50 md:hidden"
            >
              <div className="flex flex-col gap-1 px-12 py-3 sm:px-16 md:px-20 lg:px-24 xl:px-32 2xl:px-40">
                <MarketingNavLinks onClick={() => setMobileOpen(false)} />
                <Link
                  to="/discover"
                  className="px-3 py-1.5 text-sm text-text-secondary"
                  onClick={() => setMobileOpen(false)}
                >
                  Discover
                </Link>
                <div className="my-2 h-px bg-border/50" />
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="flex-1" asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setMobileOpen(false);
                        navigateToAuth("/login");
                      }}
                    >
                      Log in
                    </button>
                  </Button>
                  <Button size="sm" className="flex-1" asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setMobileOpen(false);
                        navigateToAuth("/register");
                      }}
                    >
                      Sign up
                    </button>
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="flex-1">{children}</main>

      <MarketingFooter />
    </div>
  );
}

function MarketingFooter() {
  const cols: Array<{ heading: string; links: Array<{ label: string; to: string }> }> = [
    {
      heading: "Diners",
      links: [
        { label: "Hey Cenaiva", to: "/#hey-cenaiva" },
        { label: "Discover", to: "/discover" },
        { label: "Loyalty", to: "/#loyalty" },
        { label: "Get the app", to: "/register" },
        { label: "Find my reservation", to: "/find-reservation" },
      ],
    },
    {
      heading: "Restaurants",
      links: [
        { label: "List your restaurant", to: "/setup" },
        { label: "Pricing", to: "/restaurants#pricing" },
        { label: "Customers", to: "/about" },
        { label: "Book a demo", to: "/book-a-demo" },
      ],
    },
    {
      heading: "Company",
      links: [
        { label: "About", to: "/about" },
        { label: "Careers", to: "/about" },
        { label: "Press", to: "/about" },
        { label: "Contact", to: "/about" },
      ],
    },
    {
      heading: "Legal",
      links: [
        { label: "Terms", to: "/terms" },
        { label: "Privacy", to: "/privacy" },
        { label: "Refund Policy", to: "/refund-policy" },
        { label: "Support", to: "/support" },
        { label: "Security", to: "/terms#account-security" },
        { label: "Accessibility", to: "/about" },
      ],
    },
  ];

  return (
    <footer className="border-t border-border/40 bg-background py-16">
      <div className="mx-auto grid w-full gap-10 px-12 sm:px-16 md:grid-cols-[1.4fr_repeat(4,1fr)] md:px-20 lg:px-24 xl:px-32 2xl:px-40">
        <div className="max-w-xs">
          <Link to="/" className="flex items-center" aria-label="Cenaiva home">
            <CenaivaWordmark className="ml-0 h-12 max-w-[min(100%,320px)] md:h-14 md:max-w-[min(100%,360px)]" />
          </Link>
          <p className="mt-4 text-sm leading-relaxed text-text-muted">
            The operating system for the modern dining room. Made in Toronto, on purpose.
          </p>
        </div>
        {cols.map((col) => (
          <div key={col.heading}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
              {col.heading}
            </p>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link
                    to={l.to}
                    className="text-sm text-text-secondary transition-colors hover:text-white"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-12 flex w-full flex-col items-start justify-between gap-2 border-t border-border/40 px-12 pt-6 text-xs text-text-muted sm:flex-row sm:items-center sm:px-16 md:px-20 lg:px-24 xl:px-32 2xl:px-40">
        <span>© {new Date().getFullYear()} Cenaiva Inc. ca-central-1.</span>
      </div>
    </footer>
  );
}
