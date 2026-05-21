import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  ClipboardList,
  Coins,
  CreditCard,
  Receipt,
  Settings,
  UtensilsCrossed,
  WalletCards,
} from "lucide-react";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const FEATURES = [
  {
    icon: CalendarDays,
    title: "Reservations + floor plan",
    desc: "Realtime availability, deposit policies, modify and cancel flows, cover-cap enforcement built in.",
  },
  {
    icon: ClipboardList,
    title: "Pre-orders & deposits",
    desc: "Pre-orders attached to bookings. Tier-based deposit policy. Stripe Connect handles payments.",
  },
  {
    icon: CreditCard,
    title: "Honest pricing",
    desc: "$199.99/mo + $1 per confirmed booking. 5.5% on pre-orders & deposits. Zero commission on menu prices. Native CAD.",
  },
  {
    icon: BarChart3,
    title: "Service overview",
    desc: "Tonight's covers, paid pre-order income, today's pre-orders, and a live reservation timeline on one dashboard.",
  },
];

const MODULES = [
  {
    icon: CalendarDays,
    title: "Reservations",
    desc: "Realtime availability, deposit policies, modify and cancel flows, cover-cap enforcement at the database level.",
  },
  {
    icon: WalletCards,
    title: "Floor plan",
    desc: "Drag tables across multiple floors, merge for parties, see covers in real time. Multi-table combiner picks the right combo automatically.",
  },
  {
    icon: UtensilsCrossed,
    title: "Pre-orders",
    desc: "Pre-orders attached to bookings with tier-based deposits. Multi-payer deposit split. Stripe Connect handles payments.",
  },
  {
    icon: Receipt,
    title: "Menu management",
    desc: "Add menu items, flag allergens per dish, set per-item availability and price. Pre-orders pull live from this menu.",
  },
  {
    icon: CreditCard,
    title: "Payments",
    desc: "Stripe Connect Embedded onboarding. Native CAD. Diners pay our 5.5% platform fee + Stripe processing on top of every deposit and pre-order, so restaurants keep 100% of the base.",
  },
  {
    icon: BarChart3,
    title: "Service overview",
    desc: "Tonight's covers, paid pre-order income, today's pre-orders, and a live reservation timeline on one dashboard.",
  },
  {
    icon: Settings,
    title: "Guest profiles",
    desc: "Dietary restrictions and allergies attached to every booking. The host knows before they greet.",
  },
  {
    icon: Coins,
    title: "Income & Expenses",
    desc: "Log money in and out by category. Tax separated. Recurring rules for rent, payroll, suppliers. Income-vs-expenses chart over time.",
  },
];

const VALUE_CARDS = [
  {
    badge: "Per month",
    title: "Subscription",
    priceKey: "subscription" as const,
    cta: "Book a demo",
    href: "/register",
    highlighted: false,
    features: [
      "Reservations + floor plan",
      "Modify and cancel flows",
      "Stripe Connect onboarding",
      "Service overview dashboard",
    ],
  },
  {
    badge: "Per booking",
    title: "Booking fee",
    priceKey: "booking" as const,
    cta: "Book a demo",
    href: "/register",
    highlighted: false,
    features: [
      "Zero commission on menu prices",
      "Native CAD",
      "Confirmation codes + reminders",
      "Diner double-book prevention",
    ],
  },
  {
    badge: "Pre-orders + deposits",
    title: "Platform fee",
    priceKey: "platform" as const,
    cta: "Book a demo",
    href: "/register",
    highlighted: false,
    features: [
      "Pre-orders attached to bookings",
      "Tier-based deposit policy",
      "Multi-payer deposit splitting",
      "Diners cover Stripe processing fees",
      "Cancellation refunds handled automatically",
    ],
  },
];

const VALUE_NOTES = [
  {
    title: "No setup fee",
    desc: "Self-serve onboarding takes about an hour.",
  },
  {
    title: "You keep 100% of the base",
    desc: "Diners pay our 5.5% platform fee + Stripe processing on top of every deposit and pre-order. The full base lands in your Stripe Connect account, nothing skimmed.",
  },
  {
    title: "Cancel any month",
    desc: "No questions, no cancellation fee.",
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
              Reservations, floor plan, pre-orders, deposits, payments — on one
              dashboard, one login. {bookingFee} per confirmed booking + 5.5%
              on pre-orders & deposits. Zero commission on your menu prices.
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
              <span className="text-gold">Free 3 months</span>, then $199.99 CAD/month.
              {" "}{bookingFee} per reservation + 5.5% on pre-orders &amp; deposits.
            </p>
          </motion.div>
        </div>
      </section>

      <section className="border-b border-border/40 py-24">
        <div className="mx-auto grid w-full gap-12 px-12 sm:px-16 md:px-20 lg:grid-cols-[1fr_1.1fr] lg:gap-16 lg:px-24 xl:px-32 2xl:px-40">
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease }}
          >
            <SectionEyebrow>For restaurants</SectionEyebrow>
            <h2 className="mt-4 font-serif text-6xl leading-[1.05] text-white lg:text-7xl">
              Run a restaurant?
              <br />
              <span className="italic text-gold">We replaced the stack.</span>
            </h2>
            <p className="mt-8 max-w-lg text-lg leading-relaxed text-text-secondary">
              Reservations, floor plan, pre-orders, deposits, payments — on one
              dashboard, one login.{" "}
              <span className="text-gold">$199.99/mo · {bookingFee} per confirmed booking.</span>{" "}
              Zero commission on your menu prices.
            </p>

            <div className="mt-12 flex flex-wrap items-center gap-4">
              <Button asChild className="h-12 rounded-md px-6 text-base font-semibold">
                <Link to="/setup">
                  List your restaurant <ArrowRight className="ml-1.5 size-5" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-12 rounded-md px-6 text-base">
                <Link to="/book-a-demo">Book a demo</Link>
              </Button>
              <a
                href="#pricing"
                className="text-sm text-text-secondary transition-colors hover:text-white"
              >
                See pricing →
              </a>
            </div>
            <p className="mt-5 text-sm text-text-muted">
              <span className="text-gold">Free 3 months</span>, then $199.99 CAD/month.
              {bookingFee} per reservation + 5.5% on pre-orders &amp; deposits.
              Cancel any month.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease }}
          >
            <ul className="space-y-8">
              {FEATURES.map((item) => (
                <li key={item.title} className="flex gap-5">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10">
                    <item.icon className="size-6 text-gold" />
                  </span>
                  <div>
                    <p className="text-base font-semibold text-white">{item.title}</p>
                    <p className="mt-1.5 text-base leading-relaxed text-text-muted">
                      {item.desc}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
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
              $199.99 CAD/month per restaurant. A flat dollar per confirmed booking,
              plus 5.5% on pre-orders & deposits. Zero commission on your menu
              prices. Cancel any month.
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
                  "group rounded-2xl border bg-bg-surface/70 p-6 transition-all duration-200",
                  card.highlighted
                    ? "border-gold/50 shadow-2xl shadow-gold/10 ring-1 ring-gold/20"
                    : "border-border hover:border-gold/50 hover:shadow-2xl hover:shadow-gold/10",
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
                  {card.priceKey === "subscription"
                    ? "$199.99"
                    : card.priceKey === "booking"
                      ? bookingFee
                      : "5.5%"}
                  <span className="text-sm font-normal text-text-muted">
                    {card.priceKey === "subscription"
                      ? "CAD / month"
                      : card.priceKey === "booking"
                        ? "per booking"
                        : "on pre-orders & deposits"}
                  </span>
                </p>
                <Button
                  asChild
                  variant={card.highlighted ? "default" : "outline"}
                  className={cn(
                    "mt-7 h-11 w-full rounded-md font-semibold transition-colors duration-200",
                    !card.highlighted &&
                      "group-hover:border-gold group-hover:bg-gold group-hover:text-black",
                  )}
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
