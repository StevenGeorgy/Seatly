import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MarketingShellProps = {
  children: ReactNode;
};

const navLinkClass =
  "text-text-secondary hover:text-white px-3 py-1.5 text-sm font-medium transition-colors duration-200 relative";
const navLinkActive = "text-white";

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

function LangToggle() {
  const { i18n } = useTranslation();
  const lang = (i18n.language || "en").startsWith("fr") ? "fr" : "en";

  return (
    <div className="hidden items-center gap-1 rounded-full border border-border bg-bg-surface/60 px-1 py-1 text-xs font-medium md:flex">
      {(["en", "fr"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => void i18n.changeLanguage(code)}
          className={cn(
            "rounded-full px-2.5 py-0.5 uppercase tracking-wider transition-colors",
            lang === code
              ? "bg-gold/15 text-gold"
              : "text-text-muted hover:text-white",
          )}
          aria-pressed={lang === code}
        >
          {code}
        </button>
      ))}
    </div>
  );
}

export function MarketingShell({ children }: MarketingShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-[1320px] items-center px-6 sm:px-8 lg:px-10 xl:px-12">
          <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="Cenaiva home">
            <span className="flex size-7 items-center justify-center rounded-md bg-gold/15 text-gold">
              <span className="block size-2.5 rounded-sm bg-gold" />
            </span>
            <span className="font-serif text-xl font-semibold tracking-tight text-white">
              Cenaiva
            </span>
          </Link>

          <nav
            className="hidden flex-1 items-center justify-center gap-2 md:flex"
            aria-label="Primary"
          >
            <MarketingNavLinks />
          </nav>

          <div className="hidden shrink-0 items-center gap-3 md:flex">
            <Link
              to="/discover"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-surface/60 px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-white"
            >
              <Search className="size-3.5 text-gold" />
              Discover
            </Link>
            <LangToggle />
            <Link
              to="/login"
              className="text-sm font-medium text-text-secondary transition-colors hover:text-white"
            >
              Log in
            </Link>
            <Button size="sm" className="rounded-full px-5 font-semibold" asChild>
              <Link to="/register">Sign up</Link>
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
              <div className="flex flex-col gap-1 px-5 py-3">
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
                    <Link to="/login" onClick={() => setMobileOpen(false)}>
                      Log in
                    </Link>
                  </Button>
                  <Button size="sm" className="flex-1" asChild>
                    <Link to="/register" onClick={() => setMobileOpen(false)}>
                      Sign up
                    </Link>
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
  const { i18n } = useTranslation();
  const lang = (i18n.language || "en").startsWith("fr") ? "fr" : "en";

  const cols: Array<{ heading: string; links: Array<{ label: string; to: string }> }> = [
    {
      heading: "Diners",
      links: [
        { label: "Hey Cenaiva", to: "/#hey-cenaiva" },
        { label: "Discover", to: "/discover" },
        { label: "Loyalty", to: "/#loyalty" },
        { label: "Get the app", to: "/register" },
      ],
    },
    {
      heading: "Restaurants",
      links: [
        { label: "Product", to: "/#for-restaurants" },
        { label: "Pricing", to: "/#pricing" },
        { label: "Customers", to: "/about" },
        { label: "Demo", to: "/register" },
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
        { label: "Terms", to: "/about" },
        { label: "Privacy", to: "/about" },
        { label: "Security", to: "/about" },
        { label: "Accessibility", to: "/about" },
      ],
    },
  ];

  return (
    <footer className="border-t border-border/40 bg-background py-16">
      <div className="mx-auto grid w-full max-w-[1320px] gap-10 px-6 sm:px-8 md:grid-cols-[1.4fr_repeat(4,1fr)] lg:px-10 xl:px-12">
        <div className="max-w-xs">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-gold/15 text-gold">
              <span className="block size-2.5 rounded-sm bg-gold" />
            </span>
            <span className="font-serif text-xl font-semibold text-white">Cenaiva</span>
          </Link>
          <p className="mt-4 text-sm leading-relaxed text-text-muted">
            The operating system for the modern dining room. Made in Toronto, on purpose.
          </p>
          <div className="mt-5 inline-flex items-center gap-1 rounded-full border border-border bg-bg-surface/60 p-1 text-xs font-medium">
            {(["en", "fr"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => void i18n.changeLanguage(code)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 uppercase tracking-wider transition-colors",
                  lang === code ? "bg-gold/15 text-gold" : "text-text-muted hover:text-white",
                )}
              >
                {code}
              </button>
            ))}
          </div>
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
      <div className="mx-auto mt-12 flex w-full max-w-[1320px] flex-col items-start justify-between gap-2 border-t border-border/40 px-6 pt-6 text-xs text-text-muted sm:flex-row sm:items-center sm:px-8 lg:px-10 xl:px-12">
        <span>© {new Date().getFullYear()} Cenaiva Inc. ca-central-1.</span>
        <span className="font-mono">v2.4.1</span>
      </div>
    </footer>
  );
}
