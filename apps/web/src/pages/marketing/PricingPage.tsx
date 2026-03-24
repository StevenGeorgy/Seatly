import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Check } from "lucide-react";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";

export default function PricingPage() {
  const { t } = useTranslation();

  return (
    <MarketingShell>
      <section className="mx-auto max-w-4xl px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-14 text-center"
        >
          <h1 className="text-3xl font-bold tracking-tight text-text-primary sm:text-4xl">
            {t("routes.pricing.title")}
          </h1>
          <p className="mt-4 text-base text-text-secondary">
            Simple, transparent pricing. No hidden fees.
          </p>
        </motion.div>

        <div className="mx-auto max-w-lg">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="rounded-2xl border-2 border-gold/30 bg-bg-surface p-8"
          >
            <div className="mb-6 text-center">
              <span className="text-xs font-semibold uppercase tracking-wider text-gold">
                Per Booking
              </span>
              <div className="mt-2 flex items-baseline justify-center gap-1">
                <span className="text-4xl font-bold text-text-primary">$1.00</span>
                <span className="text-sm text-text-muted">/ reservation</span>
              </div>
              <p className="mt-2 text-sm text-text-secondary">
                Plus $1.00 per payment transaction processed through Seatly.
              </p>
            </div>

            <div className="h-px bg-border" />

            <ul className="mt-6 flex flex-col gap-3">
              {[
                "Unlimited reservations",
                "Floor plan management",
                "Orders & kitchen display",
                "Staff scheduling",
                "Guest CRM & loyalty",
                "AI insights & forecasting",
                "Analytics & reporting",
                "Bilingual (EN/FR)",
              ].map((feature) => (
                <li key={feature} className="flex items-center gap-3 text-sm text-text-secondary">
                  <Check className="size-4 shrink-0 text-gold" />
                  {feature}
                </li>
              ))}
            </ul>

            <Button size="lg" className="mt-8 h-12 w-full text-base" asChild>
              <Link to="/register">Get Started</Link>
            </Button>

            <p className="mt-4 text-center text-xs text-text-muted">
              Subscription tiers coming soon. Only confirmed reservations are billed.
            </p>
          </motion.div>
        </div>
      </section>
    </MarketingShell>
  );
}
