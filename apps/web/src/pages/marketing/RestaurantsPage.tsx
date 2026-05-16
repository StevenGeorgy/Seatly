import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  ClipboardList,
  CreditCard,
  Receipt,
  Settings,
  Sparkles,
  Users,
  UtensilsCrossed,
  WalletCards,
} from "lucide-react";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const DASHBOARD_STATS = [
  { label: "Tonight", value: "142", trend: "+18%" },
  { label: "Revenue", value: "$24.8k", trend: "+13%" },
  { label: "Avg cover", value: "$87", trend: "" },
  { label: "No-show", value: "3", trend: "flag" },
];

const TIMELINE = [
  { time: "7:30pm", guest: "Lefebvre - party of 4", status: "seated" },
  { time: "7:45pm", guest: "Chen - party of 2", status: "confirmed" },
  { time: "8pm", guest: "Singh - party of 6 - VIP", status: "at-risk" },
  { time: "8:15pm", guest: "Walk-in - party of 2", status: "waiting" },
  { time: "8:30pm", guest: "Tremblay - party of 3 - anniversary", status: "confirmed" },
];

const STATUS_STYLES: Record<string, string> = {
  seated: "border-success/30 bg-success/10 text-success",
  confirmed: "border-gold/30 bg-gold/10 text-gold",
  "at-risk": "border-warning/30 bg-warning/10 text-warning",
  waiting: "border-border bg-bg-elevated text-text-muted",
};

const FEATURES = [
  {
    icon: CalendarDays,
    title: "Reservations + waitlist",
    desc: "Realtime floor plan, deposit policies, no-show risk scoring built in.",
  },
  {
    icon: ClipboardList,
    title: "Orders & KDS",
    desc: "Pre-orders, dine-in QR, takeout, optional delivery - one ticket pipeline to the kitchen.",
  },
  {
    icon: CreditCard,
    title: "Honest pricing",
    desc: "No cut of your menu prices. Native CAD, billed monthly.",
  },
  {
    icon: Sparkles,
    title: "AI that pays its rent",
    desc: "Demand forecasts, menu performance, no-show flags, receipt scanning, accountant exports.",
  },
];

const MODULES = [
  {
    icon: CalendarDays,
    title: "Reservations",
    desc: "Realtime floor plan, deposit policies, no-show risk scoring, waitlist with SMS.",
  },
  {
    icon: WalletCards,
    title: "Floor plan",
    desc: "Drag tables, merge for parties, see covers in real time. No iPad-only nonsense.",
  },
  {
    icon: UtensilsCrossed,
    title: "Orders + KDS",
    desc: "One ticket pipeline for dine-in QR, pre-orders, takeout, optional delivery.",
  },
  {
    icon: Receipt,
    title: "Menu & wine",
    desc: "Live 86 list, allergen flags, wine pairings - pushed to every channel at once.",
  },
  {
    icon: CreditCard,
    title: "Payments",
    desc: "Native CAD, no third-party processor lock-in. Tip pooling, splits, auto-tax handling.",
  },
  {
    icon: Users,
    title: "Staff",
    desc: "Schedule, time clock, tip declaration, document storage. T4s come ready.",
  },
  {
    icon: BarChart3,
    title: "Analytics",
    desc: "Demand forecasts, menu-item performance, server scoreboards, accountant exports.",
  },
  {
    icon: Settings,
    title: "CRM",
    desc: "Guest profiles, allergies, anniversaries, lifetime spend. The host knows.",
  },
];

const VALUE_CARDS = [
  {
    badge: "Confirmed bookings",
    title: "Booking fee",
    cta: "Book a demo",
    href: "/register",
    highlighted: false,
    features: [
      "All eight modules",
      "Staff workflows included",
      "Email and chat support",
      "Weekly accountant export",
    ],
  },
  {
    badge: "Restaurant friendly",
    title: "No commission",
    cta: "Book a demo",
    href: "/register",
    highlighted: true,
    features: [
      "Keep your menu prices",
      "Unlimited staff seats",
      "Priority support response",
      "Custom branded confirmations",
      "API and webhook access",
    ],
  },
  {
    badge: "Multi-location",
    title: "Tailored rollout",
    cta: "Talk to sales",
    href: "/register",
    highlighted: false,
    features: [
      "Cross-location reporting",
      "Dedicated success manager",
      "SSO and custom roles",
      "Onboarding migration",
    ],
  },
];

const VALUE_NOTES = [
  {
    title: "No setup fee",
    desc: "Migration from your current stack is included.",
  },
  {
    title: "No card-rate markup",
    desc: "You pay your processor's rate. We do not skim a cent.",
  },
  {
    title: "Cancel any month",
    desc: "30-day data export, free, no questions.",
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

function DashboardMock() {
  return (
    <div className="rounded-3xl border border-border bg-bg-surface/80 p-6 shadow-2xl shadow-black/30">
      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.24em] text-text-muted">
        <span>Live - Maison Verre - Saturday service</span>
        <span>7:42pm</span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {DASHBOARD_STATS.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-bg-elevated/60 p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
              {stat.label}
            </p>
            <p className="mt-2 font-serif text-2xl text-white">{stat.value}</p>
            <p className="mt-1 text-[11px] text-gold">{stat.trend || " "}</p>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-gold">
          Tonight's timeline
        </p>
        <ul className="mt-3 divide-y divide-border/50">
          {TIMELINE.map((row) => (
            <li key={row.time + row.guest} className="flex items-center justify-between py-3 text-sm">
              <span className="flex items-center gap-4">
                <span className="w-12 font-mono text-xs text-gold">{row.time}</span>
                <span className="text-text-secondary">{row.guest}</span>
              </span>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                  STATUS_STYLES[row.status],
                )}
              >
                {row.status}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4 border-t border-border/50 pt-5 text-xs">
        {[
          ["Floor plan", "24/30 occupied"],
          ["KDS", "7 tickets active"],
          ["Staff", "12 clocked in"],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="font-mono uppercase tracking-[0.18em] text-text-muted">{label}</p>
            <p className="mt-1 text-text-secondary">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RestaurantsPage() {
  const bookingFee = formatCurrency(1, "cad");

  return (
    <MarketingShell>
      <section className="relative overflow-hidden border-b border-border/40">
        <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:radial-gradient(ellipse_at_28%_0%,var(--gold)_0%,transparent_52%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:64px_64px]" />
        <div className="relative w-full px-12 py-24 sm:px-16 md:px-20 lg:px-24 lg:py-32 xl:px-32 2xl:px-40">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease }}
            className="max-w-5xl"
          >
            <SectionEyebrow>For restaurants</SectionEyebrow>
            <h1 className="mt-6 max-w-5xl font-serif text-5xl leading-[1.02] text-white sm:text-6xl lg:text-7xl">
              The operating system{" "}
              <span className="italic text-gold">
                for the modern dining room.
              </span>
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-relaxed text-text-secondary sm:text-lg">
              Reservations, floor plan, kitchen display, staff scheduling, CRM,
              analytics, payments - on one ledger, in one login. {bookingFee} per
              confirmed booking. Zero commission, ever.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Button asChild className="h-11 rounded-md px-6 font-semibold">
                <Link to="/setup">
                  List your restaurant <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-md px-6">
                <Link to="/book-a-demo">Book a demo</Link>
              </Button>
            </div>
            <p className="mt-5 text-sm text-text-muted">
              <span className="text-gold">Free 3 months</span>, then $199 CAD/month.
              {" "}{bookingFee} per reservation + 5.5% on pre-orders &amp; deposits.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="border-b border-border/40 py-24">
        <div className="grid w-full gap-12 px-12 sm:px-16 md:px-20 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:px-24 xl:px-32 2xl:px-40">
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease }}
          >
            <SectionEyebrow>For restaurants</SectionEyebrow>
            <h2 className="mt-5 font-serif text-5xl leading-[0.98] text-white">
              Run a restaurant?
              <br />
              <span className="italic text-gold">We replaced the stack.</span>
            </h2>
            <p className="mt-7 max-w-md text-base leading-relaxed text-text-secondary">
              Reservations, floor plan, kitchen display, staff scheduling, CRM,
              analytics, payments - on one ledger, in one login. {bookingFee} per
              confirmed booking. Zero commission on orders, ever.
            </p>

            <ul className="mt-10 space-y-5">
              {FEATURES.map((item) => (
                <li key={item.title} className="flex gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-gold/20 bg-gold/10 text-gold">
                    <item.icon className="size-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-white">{item.title}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-text-muted">
                      {item.desc}
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Button asChild className="h-11 rounded-md px-6 font-semibold">
                <Link to="/setup">
                  List your restaurant <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-md px-6">
                <Link to="/book-a-demo">Book a demo</Link>
              </Button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.55, ease }}
          >
            <DashboardMock />
          </motion.div>
        </div>
      </section>

      <section className="border-b border-border/40 py-24">
        <div className="w-full px-12 sm:px-16 md:px-20 lg:px-24 xl:px-32 2xl:px-40">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <SectionEyebrow>What's in the box</SectionEyebrow>
              <h2 className="mt-5 font-serif text-4xl leading-[1.05] text-white sm:text-5xl">
                Eight modules.
                <br />
                <span className="italic text-gold">One login.</span>
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-relaxed text-text-secondary lg:justify-self-end">
              No add-ons, no per-seat pricing, no separate vendors talking past each
              other. Everything dining rooms need to operate, on one ledger.
            </p>
          </div>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map((item, index) => (
              <motion.article
                key={item.title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: index * 0.035, ease }}
                className="rounded-2xl border border-border bg-bg-surface/70 p-5"
              >
                <span className="flex size-10 items-center justify-center rounded-lg border border-gold/20 bg-gold/10 text-gold">
                  <item.icon className="size-5" />
                </span>
                <h3 className="mt-6 text-sm font-semibold text-white">{item.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-text-muted">{item.desc}</p>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="scroll-mt-24 border-b border-border/40 py-24">
        <div className="w-full px-12 sm:px-16 md:px-20 lg:px-24 xl:px-32 2xl:px-40">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <SectionEyebrow>Pricing</SectionEyebrow>
              <h2 className="mt-5 font-serif text-4xl leading-[1.05] text-white sm:text-5xl">
                One price.
                <br />
                <span className="italic text-gold">No surprises.</span>
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-relaxed text-text-secondary lg:justify-self-end">
              A flat dollar per confirmed booking. No commission on your menu prices.
              No card-network markups. Cancel any month.
            </p>
          </div>

          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {VALUE_CARDS.map((card, index) => (
              <motion.article
                key={card.title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: index * 0.05, ease }}
                className={cn(
                  "rounded-2xl border bg-bg-surface/70 p-6",
                  card.highlighted
                    ? "border-gold/50 shadow-2xl shadow-gold/10 ring-1 ring-gold/20"
                    : "border-border",
                )}
              >
                <span
                  className={cn(
                    "inline-flex rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em]",
                    card.highlighted
                      ? "border-gold/40 bg-gold/15 text-gold"
                      : "border-border bg-bg-elevated text-text-muted",
                  )}
                >
                  {card.badge}
                </span>
                <h3 className="mt-7 font-serif text-3xl text-white">{card.title}</h3>
                <p className="mt-6 flex items-baseline gap-2 font-serif text-5xl text-gold">
                  {card.title === "Booking fee" ? bookingFee : card.title === "No commission" ? "0%" : "Custom"}
                  <span className="text-sm font-normal text-text-muted">
                    {card.title === "Booking fee" ? "per booking" : ""}
                  </span>
                </p>
                <Button
                  asChild
                  variant={card.highlighted ? "default" : "outline"}
                  className="mt-7 h-11 w-full rounded-md font-semibold"
                >
                  <Link to={card.href}>{card.cta}</Link>
                </Button>
                <ul className="mt-7 space-y-3 text-sm text-text-secondary">
                  {card.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-gold" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </motion.article>
            ))}
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {VALUE_NOTES.map((note) => (
              <div key={note.title} className="flex gap-3 text-sm">
                <Check className="mt-1 size-4 shrink-0 text-gold" />
                <span>
                  <span className="block font-semibold text-white">{note.title}</span>
                  <span className="mt-1 block text-text-muted">{note.desc}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden py-24 text-center sm:py-28">
        <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:radial-gradient(ellipse_at_center,var(--gold)_0%,transparent_55%)]" />
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.55, ease }}
          className="relative mx-auto max-w-5xl px-12 sm:px-16 md:px-20 lg:px-24 xl:px-32 2xl:px-40"
        >
          <SectionEyebrow>Replace the stack</SectionEyebrow>
          <h2 className="mt-6 font-serif text-5xl leading-[1.02] text-white sm:text-6xl">
            One ledger. <span className="italic text-gold">One login. Honest pricing.</span>
          </h2>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild className="h-12 rounded-md px-8 font-semibold">
              <Link to="/setup">
                List your restaurant <ArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-12 rounded-md px-8">
              <Link to="/book-a-demo">Book a 30-min demo</Link>
            </Button>
          </div>
          <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.28em] text-text-muted sm:text-xs">
            {bookingFee} per booking - no commission - no setup fee - cancel any month
          </p>
        </motion.div>
      </section>
    </MarketingShell>
  );
}
