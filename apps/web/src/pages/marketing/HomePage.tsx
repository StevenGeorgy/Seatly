import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Sparkles,
  Mic,
  MessageCircle,
  CalendarDays,
  MapPin,
  UtensilsCrossed,
  Users,
  BarChart3,
  UserCircle,
  Tag,
  Check,
  CreditCard,
  Scissors,
  Heart,
  Globe,
  Zap,
  Palette,
  Building2,
  Receipt,
} from "lucide-react";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const DINER_FEATURES = [
  { icon: MapPin, title: "Discover", desc: "Search and browse restaurants by cuisine, city, rating, or dietary preference." },
  { icon: CalendarDays, title: "Book & Preorder", desc: "Dine-in reservations with optional preorder — all in one seamless flow." },
  { icon: Sparkles, title: "Allergen-aware menus", desc: "Set your restrictions once and see them flagged across every menu, automatically." },
  { icon: Scissors, title: "Split the bill", desc: "Divide the check between up to 10 cards without any awkward math." },
  { icon: CreditCard, title: "Saved cards & tipping", desc: "Pay with a tap. Choose 15 / 18 / 20% or custom tip, before or after the meal." },
  { icon: Heart, title: "Loyalty points", desc: "Earn on every transaction. Redeem for menu items, discounts, and event tickets." },
];

const RESTAURANT_FEATURES = [
  { icon: CalendarDays, title: "Reservations", desc: "Online booking with confirmation codes, no-show risk scores, and automated reminders." },
  { icon: MapPin, title: "Live floor plan", desc: "Drag-and-drop tables across multiple floors with live status and undo/redo." },
  { icon: UtensilsCrossed, title: "Point of sale", desc: "Dine-in orders managed from a single real-time dashboard." },
  { icon: Users, title: "Staff & roster", desc: "Manage roles, hourly rates, and employment types for your whole team." },
  { icon: BarChart3, title: "Analytics", desc: "Revenue charts, peak-hour heatmaps, and menu performance — always up to date." },
  { icon: UserCircle, title: "Guest CRM", desc: "Visit history, spend totals, dietary restrictions, VIP flags, tags, and loyalty balance." },
  { icon: Globe, title: "Menu management", desc: "86 items in real time, flag allergens, and get AI-powered menu suggestions." },
  { icon: Tag, title: "Promotions", desc: "BOGO, %-off, fixed discount, and free-item promos with codes and expiry dates." },
];

const PLATFORM_HIGHLIGHTS = [
  { icon: Zap, title: "Real-time everywhere", desc: "Live updates keep reservations, orders, and the floor plan in sync across every device." },
  { icon: Globe, title: "Bilingual — EN / FR", desc: "Full English and French support built in from day one, not bolted on." },
  { icon: Sparkles, title: "Claude-powered AI", desc: "No-show prediction, demand forecasting, lifetime value, auto-tagging, and shift briefings." },
  { icon: Palette, title: "Custom branding", desc: "Your restaurant's colours and multi-currency support — CAD, USD, EUR, and more." },
  { icon: Building2, title: "Multi-location", desc: "Manage every location from one account and switch with a single tap." },
  { icon: Receipt, title: "Receipt scanning", desc: "Point your camera at a receipt and expenses are logged and categorised automatically." },
];

const CHAT_DEMO = [
  { role: "user", text: "Book me a table for 4 tonight at 8 pm." },
  { role: "ai", text: "Done — reserved at Nonna's Kitchen for 4 guests tonight at 8:00 PM. Confirmation: SEAT-4F2A." },
  { role: "user", text: "Does it have gluten-free options?" },
  { role: "ai", text: "Yes, 6 items are gluten-free — including the wild mushroom risotto and two pasta dishes." },
];

export default function HomePage() {
  return (
    <MarketingShell>
      {/* ── Hero ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_rgba(201,168,76,0.06)_0%,_transparent_50%)]" />
        <div className="relative mx-auto flex max-w-6xl flex-col px-6 py-20 sm:py-28 lg:py-32">
          <div className="flex flex-col items-start">
            <motion.span
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease }}
              className="mb-6 inline-flex items-center rounded-full bg-gold/10 px-4 py-1.5 text-xs font-semibold text-gold"
            >
              AI-powered &bull; Bilingual &bull; Built in Canada
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
              <span className="text-gold">Restaurant.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.16, ease }}
              className="mt-6 max-w-xl text-base leading-relaxed text-text-secondary sm:text-lg"
            >
              Cenaiva connects diners with the best restaurants and gives owners the
              complete platform they need — reservations, orders, staff, analytics,
              and AI — all in one place.
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
              <Button size="lg" variant="outline" className="h-12 px-7 text-base" asChild>
                <Link to="/register">For Restaurants</Link>
              </Button>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Cenaiva AI concierge ──────────────────────────── */}
      <section className="border-t border-border bg-bg-surface/40 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col gap-12 lg:flex-row lg:items-center lg:gap-16">
            {/* Left: description */}
            <div className="flex-1">
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
              >
                <span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-gold/10 px-3 py-1 text-xs font-semibold text-gold">
                  <Sparkles className="size-3" /> AI concierge
                </span>
                <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                  Meet Cenaiva AI, your concierge.
                </h2>
                <p className="mt-4 max-w-md text-base leading-relaxed text-text-secondary">
                  Just say — or type — what you need. Cenaiva AI books tables, browses menus
                  with your allergies in mind, places orders, and charges your saved card.
                  No forms, no app-switching.
                </p>

                <ul className="mt-6 space-y-3">
                  {[
                    "Book a reservation at any Cenaiva restaurant",
                    "Browse menus filtered by your dietary needs",
                    "Preorder from the menu before you arrive",
                    "Pay with a saved card — with tip included",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-text-secondary">
                      <Check className="mt-0.5 size-4 shrink-0 text-gold" />
                      {item}
                    </li>
                  ))}
                </ul>

                <div className="mt-6 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-muted">
                    <Mic className="size-3 text-gold" /> Say &ldquo;Hey Cenaiva&rdquo; to start
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-muted">
                    <Globe className="size-3 text-gold" /> English &amp; French
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-muted">
                    <MessageCircle className="size-3 text-gold" /> Voice or text
                  </span>
                </div>

                <p className="mt-5 text-xs text-text-muted">
                  For restaurant staff: Cenaiva AI also manages today&apos;s service — seat
                  guests, update order status, and get a daily revenue summary by voice.
                </p>
              </motion.div>
            </div>

            {/* Right: chat mockup */}
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.97 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: 0.1, ease }}
              className="w-full max-w-sm flex-shrink-0 lg:w-[380px]"
            >
              <div className="relative rounded-2xl border border-border bg-bg-surface p-5 shadow-2xl shadow-black/30">
                <div className="mb-4 flex items-center gap-3 border-b border-border pb-4">
                  <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-[#C8A951] to-[#A68B3E]">
                    <Sparkles className="size-4 text-black" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-text-primary">Cenaiva AI</p>
                    <p className="text-xs text-text-muted">AI concierge &middot; always on</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {CHAT_DEMO.map((msg, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 6 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.3, delay: i * 0.12 + 0.2 }}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                          msg.role === "user"
                            ? "bg-gold/20 text-text-primary"
                            : "bg-bg-elevated text-text-secondary"
                        }`}
                      >
                        {msg.text}
                      </div>
                    </motion.div>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-bg-elevated px-3 py-2.5">
                  <span className="flex-1 text-xs text-text-muted">Ask Cenaiva AI anything…</span>
                  <Mic className="size-3.5 text-gold" />
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── For Diners / For Restaurants ─────────────────── */}
      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-6xl px-6">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-14 text-center"
          >
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Built for <span className="text-gold">both sides</span> of the table
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-base text-text-secondary">
              Whether you&apos;re looking for a great meal or running a restaurant,
              Cenaiva was built for you.
            </p>
          </motion.div>

          <div className="grid gap-10 lg:grid-cols-2">
            {/* Diners */}
            <div>
              <div className="mb-6 flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-gold/10">
                  <Heart className="size-5 text-gold" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">For Diners</h3>
                  <p className="text-xs text-text-muted">Discover, book, eat, and pay</p>
                </div>
              </div>
              <div className="space-y-3">
                {DINER_FEATURES.map((f, i) => (
                  <motion.div
                    key={f.title}
                    initial={{ opacity: 0, x: -12 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.35, delay: i * 0.05 }}
                    className="group flex items-start gap-3 rounded-xl border border-border bg-bg-surface p-4 transition-all hover:border-gold/30"
                  >
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-gold/10 transition-colors group-hover:bg-gold/20">
                      <f.icon className="size-4 text-gold" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-text-primary">{f.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{f.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
              <div className="mt-6">
                <Button variant="outline" className="w-full" asChild>
                  <Link to="/discover">
                    Find a Restaurant <ArrowRight className="ml-2 size-4" />
                  </Link>
                </Button>
              </div>
            </div>

            {/* Restaurants */}
            <div>
              <div className="mb-6 flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-gold/10">
                  <UtensilsCrossed className="size-5 text-gold" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">For Restaurants</h3>
                  <p className="text-xs text-text-muted">The complete operating platform</p>
                </div>
              </div>
              <div className="space-y-3">
                {RESTAURANT_FEATURES.map((f, i) => (
                  <motion.div
                    key={f.title}
                    initial={{ opacity: 0, x: 12 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.35, delay: i * 0.05 }}
                    className="group flex items-start gap-3 rounded-xl border border-border bg-bg-surface p-4 transition-all hover:border-gold/30"
                  >
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-gold/10 transition-colors group-hover:bg-gold/20">
                      <f.icon className="size-4 text-gold" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-text-primary">{f.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{f.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
              <div className="mt-6">
                <Button className="w-full" asChild>
                  <Link to="/register">
                    Get Started Free <ArrowRight className="ml-2 size-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Platform highlights ───────────────────────────── */}
      <section className="border-t border-border bg-bg-surface/30 py-20">
        <div className="mx-auto max-w-5xl px-6">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-14 text-center"
          >
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              One platform,{" "}
              <span className="text-gold">everything connected</span>
            </h2>
          </motion.div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PLATFORM_HIGHLIGHTS.map((f, i) => (
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

      {/* ── CTA ───────────────────────────────────────────── */}
      <section className="border-t border-border py-20">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mx-auto max-w-2xl px-6 text-center"
        >
          <h2 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
            Ready to stop juggling five tools?
          </h2>
          <p className="mt-3 text-sm text-text-secondary">
            Join the restaurants already running on Cenaiva.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button size="lg" className="h-12 px-10 text-base" asChild>
              <Link to="/register">Get Started Free</Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-10 text-base" asChild>
              <Link to="/discover">Find a Table</Link>
            </Button>
          </div>
        </motion.div>
      </section>
    </MarketingShell>
  );
}
