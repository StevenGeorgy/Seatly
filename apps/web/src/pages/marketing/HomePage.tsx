import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  CalendarDays,
  Clock,
  Users,
  Search,
  ArrowRight,
  MapPin,
  UtensilsCrossed,
  BarChart3,
  Sparkles,
  ChevronDown,
} from "lucide-react";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";

const FEATURES = [
  { icon: CalendarDays, title: "Reservations", desc: "Online booking with confirmation codes, deposits, and automated reminders." },
  { icon: MapPin, title: "Live Floor Plan", desc: "Real-time table status with drag-and-drop editing." },
  { icon: UtensilsCrossed, title: "Orders & KDS", desc: "Kitchen display system with real-time order tracking." },
  { icon: Users, title: "Staff Management", desc: "Smart shifts, clock-in/out, and payroll tracking." },
  { icon: BarChart3, title: "Analytics", desc: "Revenue charts, peak hours, and demand forecasting." },
  { icon: Sparkles, title: "AI Insights", desc: "Menu suggestions, no-show prediction, and guest analysis." },
];

const ease = [0.25, 0.46, 0.45, 0.94] as const;

export default function HomePage() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <MarketingShell>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(201,168,76,0.06)_0%,_transparent_50%)]" />

        <div className="relative mx-auto flex max-w-6xl flex-col gap-12 px-6 py-20 sm:py-28 lg:flex-row lg:items-center lg:gap-16 lg:py-32">
          {/* Left: Text */}
          <div className="flex flex-1 flex-col items-start">
            <motion.span
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease }}
              className="mb-6 inline-flex items-center rounded-full bg-gold/10 px-4 py-1.5 text-xs font-semibold text-gold"
            >
              500+ restaurants &amp; 50,000+ diners monthly
            </motion.span>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.08, ease }}
              className="text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl"
            >
              Find Your Table.
              <br />
              Manage Your{" "}
              <span className="text-gold">Restaurant</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.16, ease }}
              className="mt-6 max-w-lg text-base leading-relaxed text-text-secondary sm:text-lg"
            >
              For diners: Discover and book the best restaurants instantly. For
              restaurants: Run your entire operation from one platform you own.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.24, ease }}
              className="mt-10 flex items-center gap-3"
            >
              <Button size="lg" className="h-12 gap-2 px-7 text-base" asChild>
                <Link to="/discover">
                  Find a Table
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 px-7 text-base"
                asChild
              >
                <Link to="/register">For Restaurants</Link>
              </Button>
            </motion.div>
          </div>

          {/* Right: Booking widget */}
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.2, ease }}
            className="w-full max-w-md flex-shrink-0 lg:w-[420px]"
          >
            <div className="rounded-2xl border border-border bg-bg-surface p-5 shadow-2xl shadow-black/30">
              {/* Date / Time / Party row */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-sm text-text-primary transition-colors hover:border-gold/30"
                >
                  <CalendarDays className="size-4 text-text-muted" />
                  <span>Mar 20</span>
                  <ChevronDown className="ml-auto size-3.5 text-text-muted" />
                </button>
                <button
                  type="button"
                  className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-sm text-text-primary transition-colors hover:border-gold/30"
                >
                  <Clock className="size-4 text-text-muted" />
                  <span>9:30 PM</span>
                  <ChevronDown className="ml-auto size-3.5 text-text-muted" />
                </button>
                <button
                  type="button"
                  className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-sm text-text-primary transition-colors hover:border-gold/30"
                >
                  <Users className="size-4 text-text-muted" />
                  <span>2 people</span>
                  <ChevronDown className="ml-auto size-3.5 text-text-muted" />
                </button>
              </div>

              {/* Search bar */}
              <div className="mt-3 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Location, Restaurant, or Cuisine"
                    className="h-11 w-full rounded-lg border border-border bg-bg-elevated pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-gold/40"
                  />
                </div>
                <Button className="h-11 px-5 text-sm font-semibold">
                  Let&apos;s go
                </Button>
              </div>

              {/* Location detection */}
              <div className="mt-3 flex items-center gap-1.5 text-xs text-text-muted">
                <MapPin className="size-3" />
                <span>
                  It looks like you&apos;re in Southern Ontario. Not correct?{" "}
                  <button
                    type="button"
                    className="font-semibold text-gold transition-colors hover:text-gold-light"
                  >
                    Get current location
                  </button>
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Built for Everyone */}
      <section className="border-t border-border bg-bg-surface/30 py-20">
        <div className="mx-auto max-w-5xl px-6">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-14 text-center"
          >
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Built for <span className="text-gold">Everyone</span>
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-base text-text-secondary">
              Whether you run a restaurant or you&apos;re looking for a table,
              Seatly has you covered
            </p>
          </motion.div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
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

      {/* CTA bottom */}
      <section className="border-t border-border py-20">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-2xl px-6 text-center"
        >
          <h2 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
            Ready to modernize your restaurant?
          </h2>
          <p className="mt-3 text-sm text-text-secondary">
            Join restaurants already using Seatly.
          </p>
          <Button size="lg" className="mt-8 h-12 px-10 text-base" asChild>
            <Link to="/register">Get Started Free</Link>
          </Button>
        </motion.div>
      </section>
    </MarketingShell>
  );
}
