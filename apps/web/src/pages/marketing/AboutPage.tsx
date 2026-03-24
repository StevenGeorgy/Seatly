import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";

export default function AboutPage() {
  const { t } = useTranslation();

  return (
    <MarketingShell>
      <section className="mx-auto max-w-3xl px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <h1 className="text-3xl font-bold tracking-tight text-text-primary sm:text-4xl">
            {t("routes.about.title")}
          </h1>
          <p className="mt-6 text-base leading-relaxed text-text-secondary">
            Seatly is a bilingual marketplace platform built for Canadian restaurants. We believe
            restaurant technology should be all-in-one, beautiful, and affordable. No more paying
            for five different tools that don't talk to each other.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="mt-12 grid gap-6 sm:grid-cols-3"
        >
          {[
            { value: "2", label: "Audiences", sub: "Restaurants & diners" },
            { value: "2", label: "Languages", sub: "English & French" },
            { value: "1", label: "Platform", sub: "Web, mobile, AI" },
          ].map((stat, i) => (
            <div key={stat.label} className="rounded-xl border border-border bg-bg-surface p-6 text-center">
              <p className="text-3xl font-bold text-gold">{stat.value}</p>
              <p className="mt-1 text-sm font-medium text-text-primary">{stat.label}</p>
              <p className="mt-0.5 text-xs text-text-muted">{stat.sub}</p>
            </div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="mt-12 text-center"
        >
          <p className="text-sm text-text-muted">
            For restaurants. For diners. For Canada.
          </p>
          <Button size="lg" className="mt-6 h-12 px-10 text-base" asChild>
            <Link to="/register">Join Seatly</Link>
          </Button>
        </motion.div>
      </section>
    </MarketingShell>
  );
}
