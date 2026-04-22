import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Layers,
  Zap,
  Globe,
  Heart,
  UtensilsCrossed,
  Sparkles,
  Database,
  ArrowRight,
} from "lucide-react";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

export default function AboutPage() {
  return (
    <MarketingShell>
      {/* ── Hero ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(201,168,76,0.05)_0%,_transparent_60%)]" />
        <div className="relative mx-auto max-w-3xl px-6 py-20 sm:py-28">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease }}
            className="text-center"
          >
            <span className="mb-5 inline-flex items-center rounded-full bg-gold/10 px-4 py-1.5 text-xs font-semibold text-gold">
              For restaurants &bull; For diners &bull; For Canada
            </span>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
              Restaurant tech,{" "}
              <span className="text-gold">reimagined for Canada.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-text-secondary">
              Cenaiva is a bilingual restaurant platform connecting diners with the
              best restaurants while giving owners everything they need to run their
              operation — in a single, beautifully designed product.
            </p>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-text-secondary">
              We built Cenaiva because the status quo is broken: restaurant owners pay
              for five separate tools that don&apos;t talk to each other, and diners
              still have to call ahead or use three apps to find a table. We think
              that&apos;s fixable.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── Mission ───────────────────────────────────────── */}
      <section className="border-t border-border bg-bg-surface/40 py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-gold">
              Our mission
            </p>
            <p className="mx-auto mt-5 max-w-2xl text-xl leading-relaxed text-text-primary sm:text-2xl">
              &ldquo;Give every restaurant — from the family-run diner to the growing
              chain — the same powerful technology that was once only available to
              the largest players.&rdquo;
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── Why Cenaiva (3 pillars) ────────────────────────── */}
      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-4xl px-6">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-12 text-center"
          >
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Why <span className="text-gold">Cenaiva</span>
            </h2>
          </motion.div>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              {
                icon: Layers,
                title: "All-in-one",
                desc: "Reservations, orders, floor plan, staff, CRM, analytics, expenses, events, and AI — one login, one platform, no juggling.",
              },
              {
                icon: Zap,
                title: "Beautiful & fast",
                desc: "Real-time live updates across every device. Changes on one screen appear everywhere instantly, with no refresh required.",
              },
              {
                icon: Globe,
                title: "Bilingual from day one",
                desc: "Full English and French support throughout — not an afterthought. Built specifically for the Canadian market.",
              },
            ].map((pillar, i) => (
              <motion.div
                key={pillar.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                className="rounded-xl border border-border bg-bg-surface p-6 text-center"
              >
                <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-gold/10">
                  <pillar.icon className="size-6 text-gold" />
                </div>
                <h3 className="text-base font-bold text-text-primary">{pillar.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-muted">{pillar.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Two audiences ─────────────────────────────────── */}
      <section className="border-t border-border bg-bg-surface/30 py-20">
        <div className="mx-auto max-w-5xl px-6">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-12 text-center"
          >
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Two audiences,{" "}
              <span className="text-gold">one platform</span>
            </h2>
          </motion.div>
          <div className="grid gap-8 sm:grid-cols-2">
            <motion.div
              initial={{ opacity: 0, x: -12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="rounded-xl border border-border bg-bg-surface p-6"
            >
              <div className="mb-4 flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-gold/10">
                  <Heart className="size-5 text-gold" />
                </div>
                <h3 className="text-lg font-bold text-white">For Diners</h3>
              </div>
              <p className="text-sm leading-relaxed text-text-secondary">
                Discover restaurants by cuisine, rating, and city. Book a table, optionally
                preorder from the menu, and pay — all in one app. Cenaiva AI, the
                concierge, handles your booking by voice or text, knows your allergies,
                and can split the bill between your whole table.
              </p>
              <Button variant="outline" size="sm" className="mt-5" asChild>
                <Link to="/discover">
                  Find a restaurant <ArrowRight className="ml-2 size-3.5" />
                </Link>
              </Button>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: 12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="rounded-xl border border-border bg-bg-surface p-6"
            >
              <div className="mb-4 flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-gold/10">
                  <UtensilsCrossed className="size-5 text-gold" />
                </div>
                <h3 className="text-lg font-bold text-white">For Restaurants</h3>
              </div>
              <p className="text-sm leading-relaxed text-text-secondary">
                Replace every disconnected tool with a single dashboard — reservations,
                a live drag-and-drop floor plan, POS, staff roster, guest CRM,
                analytics, expense tracking, events, and promotions. Cenaiva AI gives
                your staff hands-free control over today&apos;s service.
              </p>
              <Button size="sm" className="mt-5" asChild>
                <Link to="/register">
                  Get started free <ArrowRight className="ml-2 size-3.5" />
                </Link>
              </Button>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Values ────────────────────────────────────────── */}
      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-3xl px-6">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mb-12 text-center"
          >
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              What we believe
            </h2>
          </motion.div>
          <div className="space-y-4">
            {[
              {
                icon: UtensilsCrossed,
                title: "Restaurant-first",
                desc: "Every product decision is made with operators in mind. If it doesn't make a shift easier, it doesn't ship.",
              },
              {
                icon: Globe,
                title: "Bilingual is not optional",
                desc: "Canada is bilingual. Our platform is fully English and French from the very first release — not a future roadmap item.",
              },
              {
                icon: Sparkles,
                title: "AI that earns its keep",
                desc: "Cenaiva AI books, orders, and manages service. Claude-powered insights forecast demand and reduce no-shows. No AI fluff — only features that save real time.",
              },
              {
                icon: Database,
                title: "Your data is yours",
                desc: "We don't sell your guest data. Restaurants own their CRM, their revenue history, and their export files. Period.",
              },
            ].map((value, i) => (
              <motion.div
                key={value.title}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.08 }}
                className="flex items-start gap-4 rounded-xl border border-border bg-bg-surface p-5"
              >
                <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-gold/10">
                  <value.icon className="size-4 text-gold" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text-primary">{value.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-text-muted">{value.desc}</p>
                </div>
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
            Be part of what we&apos;re building.
          </h2>
          <p className="mt-3 text-sm text-text-secondary">
            Join the restaurants and diners already on Cenaiva.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button size="lg" className="h-12 px-10 text-base" asChild>
              <Link to="/register">Join Cenaiva</Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 px-10 text-base" asChild>
              <Link to="/features">
                See features <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </motion.div>
      </section>
    </MarketingShell>
  );
}
