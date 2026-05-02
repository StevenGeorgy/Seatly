import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Gift,
  Receipt,
  Sparkles,
  Star,
  Ticket,
  Trophy,
  Users,
  WalletCards,
} from "lucide-react";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const TIERS = [
  { name: "Aperitivo", label: "Welcome", points: "Start", progress: "w-1/4" },
  { name: "Trattoria", label: "Member", points: "500 pts", progress: "w-2/5", active: true },
  { name: "Tavola", label: "Regular", points: "2,500 pts", progress: "w-2/3" },
  { name: "Cantina", label: "Inner circle", points: "7,500 pts", progress: "w-full" },
];

const PERKS = [
  "1 priority booking each month",
  "Anniversary dessert from the chef",
  "5% off pre-order checkouts",
];

const EARN_SUMMARY = [
  {
    label: "How you earn",
    value: "5 pts",
    title: "Reservation",
    desc: "Per confirmed booking. Show up and they post.",
  },
  {
    label: "How you earn",
    value: "1 pt / $",
    title: "Pre-order",
    desc: "Every dollar pre-ordered through the app.",
  },
  {
    label: "How you earn",
    value: "250 pts",
    title: "Refer a friend",
    desc: "When they complete their first dinner.",
  },
];

const EARN_WAYS = [
  {
    icon: CalendarDays,
    value: "5 pts",
    title: "Reservation",
    desc: "Per confirmed booking. They post the moment you sit down.",
  },
  {
    icon: Receipt,
    value: "1 pt / $",
    title: "Pre-order",
    desc: "Every dollar pre-ordered through the app - food, wine, deposits.",
  },
  {
    icon: Gift,
    value: "250 pts",
    title: "Refer a friend",
    desc: "When they finish their first dinner. They get a glass on the house.",
  },
  {
    icon: WalletCards,
    value: "50 pts",
    title: "New venue",
    desc: "First booking at any restaurant new to your history.",
  },
  {
    icon: Star,
    value: "2x pts",
    title: "Tip the chef",
    desc: "Add a chef's tip on a tasting menu - points double on that ticket.",
  },
  {
    icon: Sparkles,
    value: "+10%",
    title: "Hey Cenaiva",
    desc: "Bookings made via voice earn ten percent more - because we like that you used it.",
  },
];

function SectionEyebrow({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-gold">
      <span className="h-px w-4 bg-gold/60" />
      {children}
    </span>
  );
}

export default function LoyaltyPage() {
  return (
    <MarketingShell>
      <section className="relative overflow-hidden border-b border-border/40">
        <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:radial-gradient(ellipse_at_35%_0%,var(--gold)_0%,transparent_52%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:64px_64px]" />
        <div className="relative mx-auto w-full max-w-[1320px] px-6 py-24 sm:px-8 lg:px-10 lg:py-32 xl:px-12">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease }}
            className="max-w-4xl"
          >
            <SectionEyebrow>Loyalty</SectionEyebrow>
            <h1 className="mt-6 font-serif text-5xl leading-[1.02] text-white sm:text-6xl lg:text-7xl">
              One card. <span className="italic text-gold">Every restaurant.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-relaxed text-text-secondary sm:text-lg">
              Every booking and every dollar earns points across the network. Climb
              four tiers, unlock real perks, get treated like a regular wherever you go.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Button asChild className="h-11 rounded-md px-6 font-semibold">
                <Link to="/register">
                  Join free <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-md px-6">
                <a href="#tiers">See the tiers</a>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      <section id="tiers" className="scroll-mt-24 border-b border-border/40 py-20">
        <div className="mx-auto w-full max-w-[1320px] px-6 sm:px-8 lg:px-10 xl:px-12">
          <div className="grid gap-10 lg:grid-cols-[1fr_320px] lg:items-start">
            <div>
              <SectionEyebrow>Loyalty</SectionEyebrow>
              <h2 className="mt-5 font-serif text-4xl leading-[1.05] text-white sm:text-5xl">
                One card.
                <br />
                <span className="italic text-gold">Every restaurant.</span>
              </h2>
              <p className="mt-6 max-w-2xl text-base leading-relaxed text-text-secondary">
                Every booking and every dollar spent earns points across the network -
                not at one restaurant, but across all of Cenaiva. Climb four tiers,
                unlock real perks, get treated like a regular wherever you go.
              </p>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, ease }}
              className="rounded-2xl border border-border bg-bg-surface/80 p-5 shadow-2xl shadow-black/20"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-muted">
                Tonight's ledger
              </p>
              <div className="mt-4 flex items-end gap-2">
                <span className="font-serif text-5xl leading-none text-gold">2,840</span>
                <span className="pb-1 text-xs text-text-secondary">points</span>
              </div>
              <p className="mt-2 text-xs text-text-muted">
                Trattoria - 660 to Tavola
              </p>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-bg-elevated">
                <div className="h-full w-[78%] rounded-full bg-gold" />
              </div>
            </motion.div>
          </div>

          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TIERS.map((tier, index) => (
              <motion.article
                key={tier.name}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: index * 0.05, ease }}
                className={cn(
                  "rounded-2xl border bg-bg-surface/70 p-5",
                  tier.active
                    ? "border-gold/50 shadow-2xl shadow-gold/10 ring-1 ring-gold/20"
                    : "border-border",
                )}
              >
                <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">
                  <span>{tier.label}</span>
                  <span>{tier.points}</span>
                </div>
                <h3 className="mt-6 font-serif text-2xl text-white">{tier.name}</h3>
                <div className="mt-5 h-px bg-border" />
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-bg-elevated">
                  <div className={cn("h-full rounded-full bg-gold", tier.progress)} />
                </div>
              </motion.article>
            ))}
          </div>

          <div className="mt-6 grid gap-5 rounded-2xl border border-border bg-bg-surface/70 p-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-gold">
                Member - from 500 points
              </p>
              <h3 className="mt-4 font-serif text-4xl text-white">Trattoria</h3>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-text-secondary">
                You've become a regular. Monthly priority bookings, dessert from the
                chef on anniversaries, and quiet discounts on pre-order checkouts.
              </p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-muted">
                Perks
              </p>
              <div className="mt-4 space-y-3">
                {PERKS.map((perk) => (
                  <div
                    key={perk}
                    className="flex items-center gap-3 rounded-lg border border-border/60 bg-bg-elevated/60 px-4 py-3 text-sm text-text-secondary"
                  >
                    <span className="flex size-6 items-center justify-center rounded-md border border-gold/20 bg-gold/10 text-gold">
                      <Check className="size-3.5" />
                    </span>
                    {perk}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {EARN_SUMMARY.map((item, index) => (
              <motion.article
                key={item.title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: index * 0.05, ease }}
                className="rounded-2xl border border-border bg-bg-surface/70 p-5"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-muted">
                  {item.label}
                </p>
                <p className="mt-4 font-serif text-3xl text-gold">{item.value}</p>
                <p className="mt-2 text-sm font-semibold text-white">{item.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-text-muted">{item.desc}</p>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="mx-auto w-full max-w-[1320px] px-6 sm:px-8 lg:px-10 xl:px-12">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <SectionEyebrow>How you earn</SectionEyebrow>
              <h2 className="mt-5 font-serif text-4xl leading-[1.05] text-white sm:text-5xl">
                Six ways.
                <br />
                <span className="italic text-gold">No fine print.</span>
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-relaxed text-text-secondary lg:justify-self-end">
              Points post within an hour of your check arriving. They never expire as
              long as you book at least once a year. No blackout dates, no holdouts
              during the holidays.
            </p>
          </div>

          <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {EARN_WAYS.map((item, index) => (
              <motion.article
                key={item.title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: index * 0.04, ease }}
                className="rounded-2xl border border-border bg-bg-surface/70 p-6"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg border border-gold/20 bg-gold/10 text-gold">
                    <item.icon className="size-5" />
                  </span>
                  <span className="font-serif text-2xl text-gold">{item.value}</span>
                </div>
                <h3 className="mt-5 text-sm font-semibold text-white">{item.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-text-muted">{item.desc}</p>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-border/40 py-24 text-center">
        <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:radial-gradient(ellipse_at_center,var(--gold)_0%,transparent_55%)]" />
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.55, ease }}
          className="relative mx-auto max-w-3xl px-6"
        >
          <SectionEyebrow>Start earning</SectionEyebrow>
          <h2 className="mt-6 font-serif text-4xl leading-[1.05] text-white sm:text-5xl">
            Join once. Earn everywhere.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-text-secondary">
            Your Cenaiva account is your loyalty card across every restaurant in the
            network.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild className="h-12 rounded-md px-8 font-semibold">
              <Link to="/register">
                Join free <ArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-12 rounded-md px-8">
              <Link to="/discover">Find restaurants</Link>
            </Button>
          </div>
        </motion.div>
      </section>
    </MarketingShell>
  );
}
