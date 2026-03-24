import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import {
  CalendarDays,
  MapPin,
  UtensilsCrossed,
  Users,
  BarChart3,
  Sparkles,
  Clock,
  Receipt,
  UserCircle,
  PartyPopper,
  Gift,
  Globe,
} from "lucide-react";

import { MarketingShell } from "@/components/marketing/MarketingShell";

const FEATURES = [
  { icon: CalendarDays, title: "Reservations", desc: "Online booking with confirmation codes, deposits, and automated reminders." },
  { icon: MapPin, title: "Live Floor Plan", desc: "Real-time table status with drag-and-drop editing. See your floor at a glance." },
  { icon: UtensilsCrossed, title: "Orders & KDS", desc: "Kitchen display system with real-time order tracking from table to plate." },
  { icon: Users, title: "Staff Scheduling", desc: "Smart shifts optimized against busy hours. Clock-in/out and payroll tracking." },
  { icon: BarChart3, title: "Analytics", desc: "Revenue charts, peak hour heatmaps, menu performance, and demand forecasting." },
  { icon: Sparkles, title: "AI Insights", desc: "Claude-powered menu suggestions, no-show prediction, and guest behavior analysis." },
  { icon: Clock, title: "Waitlist", desc: "Real-time queue with SMS notifications. Remote join for guests on the go." },
  { icon: Receipt, title: "Expense Tracking", desc: "Scan receipts with AI. Track costs by category with accountant-ready exports." },
  { icon: UserCircle, title: "Guest CRM", desc: "Full profiles with visit history, preferences, loyalty points, and VIP tagging." },
  { icon: PartyPopper, title: "Events & Tickets", desc: "Create events, sell tickets, and manage capacity \u2014 all in one place." },
  { icon: Gift, title: "Loyalty Program", desc: "Points on every transaction. Redeemable for menu items, discounts, and event tickets." },
  { icon: Globe, title: "Bilingual", desc: "English and French from day one. Built for Canadian restaurants." },
];

const ease = [0.25, 0.46, 0.45, 0.94] as const;

export default function FeaturesPage() {
  const { t } = useTranslation();

  return (
    <MarketingShell>
      {/* Hero with phone mockup */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(201,168,76,0.05)_0%,_transparent_60%)]" />

        <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-12 px-6 py-20 sm:py-28 lg:flex-row lg:gap-16">
          {/* Left text */}
          <div className="flex-1 text-center lg:text-left">
            <motion.span
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease }}
              className="mb-4 inline-flex items-center rounded-full bg-gold/10 px-4 py-1.5 text-xs font-semibold text-gold"
            >
              Everything in one platform
            </motion.span>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.08, ease }}
              className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl"
            >
              The Operating System for{" "}
              <span className="text-gold">Modern Restaurants</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.16, ease }}
              className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-text-secondary lg:mx-0"
            >
              Seatly replaces every disconnected tool with a single, beautiful
              platform. Reservations, staff, orders, CRM, analytics, and AI
              insights — all working together.
            </motion.p>
          </div>

          {/* Right: Phone mockup */}
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.2, ease }}
            className="relative flex shrink-0 items-center justify-center"
          >
            <div className="relative h-[420px] w-[210px] overflow-hidden rounded-[32px] border-2 border-border bg-bg-surface shadow-2xl shadow-black/40">
              {/* Phone notch */}
              <div className="absolute left-1/2 top-2 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-bg-base" />
              {/* Screen content */}
              <div className="flex h-full flex-col pt-10">
                <div className="px-4 py-3">
                  <span className="text-[10px] font-bold tracking-[0.2em] text-gold">SEATLY</span>
                </div>
                <div className="flex-1 space-y-2.5 px-4">
                  <div className="h-2 w-3/4 rounded-full bg-gold/30" />
                  <div className="h-2 w-1/2 rounded-full bg-gold/20" />
                  <div className="mt-4 space-y-2">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg bg-bg-elevated px-3 py-2.5">
                        <div className="size-6 rounded-md bg-gold/20" />
                        <div className="flex-1 space-y-1">
                          <div className="h-1.5 w-2/3 rounded-full bg-text-muted/30" />
                          <div className="h-1.5 w-1/3 rounded-full bg-text-muted/20" />
                        </div>
                        <div className="h-5 w-12 rounded-md bg-gold/15" />
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 h-8 w-full rounded-lg bg-gold/80" />
                </div>
              </div>
            </div>
            {/* Glow effect */}
            <div className="absolute -inset-8 -z-10 rounded-full bg-gold/5 blur-3xl" />
          </motion.div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-14 text-center"
        >
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {t("routes.features.title")}
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-base text-text-secondary">
            Every tool your restaurant needs, in one platform. No more juggling
            disconnected apps.
          </p>
        </motion.div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
              className="group rounded-xl border border-border bg-bg-surface p-6 transition-all hover:border-gold/30 hover:shadow-lg hover:shadow-gold/5"
            >
              <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-gold/10 transition-colors group-hover:bg-gold/20">
                <f.icon className="size-5 text-gold" />
              </div>
              <h3 className="text-sm font-semibold text-text-primary">{f.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-text-muted">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
