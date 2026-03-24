import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

type AuthPageLayoutProps = {
  titleKey: string;
  children: ReactNode;
};

export function AuthPageLayout({ titleKey, children }: AuthPageLayoutProps) {
  const { t } = useTranslation();

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background p-4">
      {/* Subtle radial glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(201,168,76,0.04)_0%,transparent_70%)]" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="relative w-full max-w-md"
      >
        {/* Brand */}
        <Link
          to="/"
          className="mb-8 block text-center text-sm font-bold tracking-[0.3em] text-primary transition-opacity hover:opacity-80"
        >
          SEATLY
        </Link>

        {/* Card */}
        <div className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-xl shadow-black/20 sm:p-8">
          <h1 className="text-center text-xl font-semibold text-foreground">
            {t(titleKey)}
          </h1>
          {children}
        </div>
      </motion.div>
    </main>
  );
}
