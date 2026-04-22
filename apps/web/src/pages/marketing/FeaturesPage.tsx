import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CalendarDays,
  MapPin,
  UtensilsCrossed,
  Globe,
  Users,
  BarChart3,
  Sparkles,
  Clock,
  Receipt,
  UserCircle,
  PartyPopper,
  Tag,
  Search,
  Heart,
  CreditCard,
  Scissors,
  Zap,
  Palette,
  Building2,
  Download,
  Bell,
  Mic,
  MessageCircle,
  Check,
  ArrowRight,
} from "lucide-react";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const RESTAURANT_FEATURES = [
  {
    icon: CalendarDays,
    title: "Reservations",
    desc: "Online booking with confirmation codes, no-show risk scores, deposits, and automated reminders.",
  },
  {
    icon: MapPin,
    title: "Live Floor Plan",
    desc: "Drag-and-drop tables across multiple floors with live status, sections, and 30-step undo/redo.",
  },
  {
    icon: UtensilsCrossed,
    title: "Point of Sale",
    desc: "Dine-in orders managed from a single real-time dashboard.",
  },
  {
    icon: Globe,
    title: "Menu Management",
    desc: "86 items instantly, flag allergens per dish, and surface AI-powered menu suggestions.",
  },
  {
    icon: Users,
    title: "Staff & Roster",
    desc: "Manage roles, hourly rates, and employment types. Full team roster in one place.",
  },
  {
    icon: BarChart3,
    title: "Analytics",
    desc: "Revenue, average spend, covers, no-show rate, and peak-hour heatmaps across 7 or 30 days.",
  },
  {
    icon: Sparkles,
    title: "AI Insights",
    desc: "Claude-powered no-show prediction, demand forecasting, lifetime value, auto-tagging, and shift briefings.",
  },
  {
    icon: Clock,
    title: "Waitlist",
    desc: "Real-time queue with estimated waits, remote join from a guest's phone, and one-tap seat or notify.",
  },
  {
    icon: Receipt,
    title: "Expense Tracking",
    desc: "Scan receipts with your camera. Auto-categorised and export-ready for your accountant.",
  },
  {
    icon: UserCircle,
    title: "Guest CRM",
    desc: "Visit history, spend totals, dietary restrictions, VIP and blocked flags, tags, and loyalty balance.",
  },
  {
    icon: PartyPopper,
    title: "Events & Tickets",
    desc: "Create events, set capacity, sell tickets — managed entirely within Cenaiva.",
  },
  {
    icon: Tag,
    title: "Promotions Builder",
    desc: "BOGO, %-off, fixed discount, free-item, and promo codes — with scheduling and usage limits.",
  },
];

const DINER_FEATURES = [
  {
    icon: Search,
    title: "Discover",
    desc: "Search restaurants by cuisine, city, rating, or dietary preference.",
  },
  {
    icon: CalendarDays,
    title: "Book & Preorder in one flow",
    desc: "Dine-in reservations with optional preorder from the menu — no app-switching.",
  },
  {
    icon: Sparkles,
    title: "Allergen-aware menus",
    desc: "Set your restrictions once and see them flagged across every menu, automatically.",
  },
  {
    icon: Scissors,
    title: "Split the bill",
    desc: "Divide the check between up to 10 cards without any awkward conversations.",
  },
  {
    icon: CreditCard,
    title: "Saved cards & tipping",
    desc: "Pay with a tap. Choose 15 / 18 / 20% or a custom tip, before or after the meal.",
  },
  {
    icon: Heart,
    title: "Loyalty points",
    desc: "Earn on every order. Redeem for menu items, discounts, and event tickets.",
  },
];

const PLATFORM = [
  { icon: Zap, label: "Real-time live updates" },
  { icon: Globe, label: "Bilingual — EN & FR" },
  { icon: Building2, label: "Multi-location" },
  { icon: Palette, label: "Custom branding & multi-currency" },
  { icon: Download, label: "Data export (CSV)" },
  { icon: Bell, label: "Automated guest messaging" },
];

export default function FeaturesPage() {
  return (
    <MarketingShell>
      {/* ── Hero ──────────────────────────────────────────── */}
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
              The complete restaurant OS
            </motion.span>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.08, ease }}
              className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl"
            >
              The Operating System for Modern Restaurants —{" "}
              <span className="text-gold">and the diners who love them.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.16, ease }}
              className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-text-secondary lg:mx-0"
            >
              One bilingual platform replacing every disconnected tool — with Cenaiva AI,
              the concierge that books, orders, and answers questions for both
              diners and staff.
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
              <div className="absolute left-1/2 top-2 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-bg-base" />
              <div className="flex h-full flex-col pt-10">
                <div className="px-4 py-3">
                  <span className="text-[10px] font-bold tracking-[0.2em] text-gold">CENAIVA</span>
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
            <div className="absolute -inset-8 -z-10 rounded-full bg-gold/5 blur-3xl" />
          </motion.div>
        </div>
      </section>

      {/* ── Cenaiva AI highlight card ─────────────────────────── */}
      <section className="border-b border-border bg-bg-surface/40 py-14">
        <div className="mx-auto max-w-5xl px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="rounded-2xl border border-gold/20 bg-gradient-to-br from-bg-surface to-bg-elevated p-8 shadow-lg shadow-gold/5"
          >
            <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#C8A951] to-[#A68B3E]">
                <Sparkles className="size-6 text-black" />
              </div>
              <div className="flex-1">
                <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-gold">
                  Signature feature
                </p>
                <h2 className="text-2xl font-bold text-white">
                  Cenaiva AI — concierge for diners and staff
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-secondary">
                  Cenaiva AI is a bilingual, voice-enabled assistant. Diners use it to
                  discover restaurants, book tables, browse allergen-filtered menus, place
                  orders, and pay with a saved card. Restaurant staff use it to seat guests,
                  update order status, and get a daily revenue summary — all by voice or text.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    { icon: MessageCircle, label: "Natural conversation — voice or text" },
                    { icon: Mic, label: '"Hey Cenaiva" wake word' },
                    { icon: Globe, label: "English & French" },
                    { icon: Check, label: "Allergen & preference aware" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center gap-2 rounded-lg border border-border bg-bg-base px-3 py-2.5 text-xs text-text-secondary"
                    >
                      <item.icon className="size-3.5 shrink-0 text-gold" />
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── For Restaurants ───────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-14"
        >
          <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-gold/10 px-3 py-1 text-xs font-semibold text-gold">
            <UtensilsCrossed className="size-3" /> For Restaurants
          </span>
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Run your entire restaurant from one dashboard
          </h2>
          <p className="mt-3 max-w-lg text-sm text-text-secondary">
            No more five tabs for five tools. Every operational need, in one place.
          </p>
        </motion.div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {RESTAURANT_FEATURES.map((f, i) => (
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

      {/* ── For Diners ────────────────────────────────────── */}
      <section className="border-t border-border bg-bg-surface/30 py-20">
        <div className="mx-auto max-w-5xl px-6">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-14"
          >
            <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-gold/10 px-3 py-1 text-xs font-semibold text-gold">
              <Heart className="size-3" /> For Diners
            </span>
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              The best way to discover, book, and dine
            </h2>
            <p className="mt-3 max-w-lg text-sm text-text-secondary">
              From browsing to booking to paying — all in one place, with an AI that
              knows your preferences.
            </p>
          </motion.div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {DINER_FEATURES.map((f, i) => (
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
        </div>
      </section>

      {/* ── Platform-wide strip ───────────────────────────── */}
      <section className="border-t border-border py-14">
        <div className="mx-auto max-w-5xl px-6">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="mb-6 text-center text-xs font-semibold uppercase tracking-widest text-text-muted"
          >
            Platform-wide
          </motion.p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PLATFORM.map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.3, delay: i * 0.05 }}
                className="flex items-center gap-3 rounded-lg border border-border bg-bg-surface px-4 py-3"
              >
                <item.icon className="size-4 shrink-0 text-gold" />
                <span className="text-xs text-text-secondary">{item.label}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────────── */}
      <section className="border-t border-border py-16">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-2xl px-6 text-center"
        >
          <h2 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
            Ready to see it in action?
          </h2>
          <p className="mt-3 text-sm text-text-secondary">
            Restaurants get a full-featured dashboard. Diners get instant access to
            book, order, and pay.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button size="lg" className="h-12 px-10 text-base" asChild>
              <Link to="/register">Get Started Free</Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-10 text-base" asChild>
              <Link to="/discover">
                Find a Table <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </motion.div>
      </section>
    </MarketingShell>
  );
}
