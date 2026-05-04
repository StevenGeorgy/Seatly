import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  AudioLines,
  CalendarDays,
  Car,
  Check,
  Home,
  MessageCircle,
  Smartphone,
  Sparkles,
  Watch,
} from "lucide-react";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const SURFACES = [
  {
    icon: Smartphone,
    title: "Phone",
    meta: "iOS + Android",
    desc: "Long-press the side button.",
  },
  {
    icon: Watch,
    title: "Watch",
    meta: "Apple Watch",
    desc: 'Raise wrist. "Hey Cenaiva."',
  },
  {
    icon: Car,
    title: "Car",
    meta: "CarPlay + Android Auto",
    desc: "Hands free, eyes on the road.",
  },
  {
    icon: Home,
    title: "Home speaker",
    meta: "HomePod + Echo",
    desc: "Family-aware. Knows whose turn it is to pick.",
  },
];

const PROMPTS = [
  {
    label: "Spontaneous",
    prompt: "Find me a quiet patio nearby for two, in the next hour.",
    response: "Three options under a 6-minute walk. La Cigogne has your usual table free at 7:15.",
  },
  {
    label: "Planning",
    prompt: "Book somewhere good for my anniversary next Saturday - surprise me, but Italian.",
    response: "Held a 2-top at Bar Vendetta, 8:30, anniversary noted. They'll bring out the chef's amaro.",
  },
  {
    label: "Group",
    prompt: "Dinner with the team Friday - six of us, near the office, dietary stuff in the chat.",
    response: "Confirmed Trinity Common, 7pm. Two vegan, one shellfish allergy on the booking. Calendar invites sent.",
  },
  {
    label: "Mid-meal",
    prompt: "Add the pairing to my pre-order and use my points.",
    response: "Wine pairing added. 1,200 points redeemed - your tab is now $42. Enjoy the cassoulet.",
  },
  {
    label: "Travel",
    prompt: "I'm in Montreal Thursday. Find me where the locals eat after a show.",
    response: "Three rooms still seating after 11pm. Joe Beef's walk-in bar has space at 11:20.",
  },
  {
    label: "Loyalty",
    prompt: "Where am I closest to the next tier?",
    response: "You're 660 points from Tavola. One more dinner at $90+ this month gets you there.",
  },
];

const BENEFITS = [
  {
    icon: Sparkles,
    title: "Always on, never creepy",
    desc: "One trigger phrase. Audio is processed only when you ask.",
  },
  {
    icon: MessageCircle,
    title: "Knows your taste",
    desc: "Remembers dietary needs, favourite neighbourhoods, and who you dine with.",
  },
  {
    icon: CalendarDays,
    title: "Plans the whole evening",
    desc: '"Book dinner before the game" - it picks a place, a time, and warns you about traffic.',
  },
  {
    icon: Check,
    title: "Redeems your points",
    desc: '"Use my points for the wine pairing tonight" - done at checkout, automatically.',
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

function VoiceOrb() {
  return (
    <div className="relative flex size-40 items-center justify-center rounded-full border border-gold/20">
      <div className="absolute inset-5 rounded-full border border-gold/15" />
      <div className="absolute inset-10 rounded-full border border-gold/10" />
      <div className="absolute inset-0 rounded-full bg-gold/5 blur-2xl" />
      <div className="relative flex size-20 items-center justify-center rounded-full bg-gold text-black shadow-2xl shadow-gold/20">
        <AudioLines className="size-9" />
      </div>
    </div>
  );
}

export default function HeyCenaivaPage() {
  return (
    <MarketingShell>
      <section className="relative overflow-hidden border-b border-border/40">
        <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:radial-gradient(ellipse_at_18%_0%,var(--gold)_0%,transparent_52%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:64px_64px]" />
        <div className="relative mx-auto w-full max-w-[1320px] px-6 py-24 sm:px-8 lg:px-10 lg:py-32 xl:px-12">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease }}
            className="max-w-2xl"
          >
            <SectionEyebrow>Hey Cenaiva</SectionEyebrow>
            <h1 className="mt-6 font-serif text-5xl leading-[0.98] text-white sm:text-6xl lg:text-7xl">
              Just <span className="italic text-gold">say it.</span>
            </h1>
            <p className="mt-7 max-w-xl text-base leading-relaxed text-text-secondary sm:text-lg">
              A voice concierge built for going out. Plan the night, book the table,
              redeem your points, send calendar invites - without thumbing through a
              single screen.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Button asChild className="h-11 rounded-md px-6 font-semibold">
                <Link to="/register">
                  Try Hey Cenaiva <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-md px-6">
                <a href="#conversation">
                  <span className="mr-1.5 size-1.5 rounded-full bg-gold" />
                  Listen to a demo
                </a>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      <section id="conversation" className="scroll-mt-24 py-24">
        <div className="mx-auto grid w-full max-w-[1320px] gap-12 px-6 sm:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:px-10 xl:px-12">
          <motion.div
            initial={{ opacity: 0, x: -16 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5, ease }}
          >
            <SectionEyebrow>Hey Cenaiva</SectionEyebrow>
            <h2 className="mt-5 font-serif text-5xl leading-[0.98] text-white">
              Just <span className="italic text-gold">say it.</span>
              <br />
              We'll book it.
            </h2>
            <p className="mt-7 max-w-md text-base leading-relaxed text-text-secondary">
              Hey Cenaiva is the voice concierge built into the app, your watch, your
              car, and your home speaker. Plan an outing, hold a table, pre-order a
              course, redeem points - without thumbing through a single screen.
            </p>

            <ul className="mt-10 space-y-5">
              {BENEFITS.map((item) => (
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
                <Link to="/register">
                  Try Hey Cenaiva <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-md px-6">
                <Link to="/discover">
                  <span className="mr-1.5 size-1.5 rounded-full bg-gold" />
                  Find a table
                </Link>
              </Button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.55, ease }}
            className="relative overflow-hidden rounded-3xl border border-border bg-bg-surface/70 p-6 shadow-2xl shadow-black/30"
          >
            <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:radial-gradient(ellipse_at_center,var(--gold)_0%,transparent_58%)]" />
            <div className="relative flex flex-wrap items-center justify-end gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
              {["phone", "watch", "car", "homepod"].map((device, index) => (
                <span
                  key={device}
                  className={cn(
                    "rounded-full px-3 py-1",
                    index === 0
                      ? "border border-gold/40 bg-gold text-black"
                      : "border border-border bg-bg-elevated/60 text-text-muted",
                  )}
                >
                  {device}
                </span>
              ))}
            </div>

            <div className="relative mt-8 space-y-4">
              <div className="flex items-start gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
                  You
                </span>
                <div className="flex-1 rounded-2xl border border-border bg-bg-elevated px-4 py-3 text-sm leading-relaxed text-text-secondary">
                  Hey Cenaiva, I have a hundred bucks for a date night Friday.
                  Somewhere quiet, walkable from the Annex.
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="ml-auto order-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
                  Cenaiva
                </span>
                <div className="order-1 ml-auto max-w-[85%] rounded-2xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm leading-relaxed text-white">
                  I found three tables under $50/person within a 12-minute walk.
                  Bistro Lumiere at 7:30 has your favourite Cotes du Rhone on the
                  list. Want me to hold it?
                </div>
              </div>
            </div>

            <div className="relative my-12 flex justify-center">
              <VoiceOrb />
            </div>

            <div className="relative flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-3 py-1.5 text-xs text-white"
                >
                  <Check className="size-3.5 text-gold" />
                  Hold the table
                </button>
                <Link
                  to="/discover"
                  className="rounded-full border border-border bg-bg-elevated px-3 py-1.5 text-xs text-white transition-colors hover:border-gold/40"
                >
                  Show all 3
                </Link>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 text-xs shadow-2xl shadow-black/30">
                <span className="flex size-11 items-center justify-center rounded-lg bg-gold/15 font-mono text-[10px] text-gold">
                  BL
                </span>
                <span>
                  <span className="block text-sm text-white">Bistro Lumiere - Friday 7:30pm</span>
                  <span className="block text-text-muted">Held for 6 min - MTL-3F2A8K</span>
                </span>
                <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-success">
                  Held
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="border-b border-border/40 py-20">
        <div className="mx-auto w-full max-w-[1320px] px-6 sm:px-8 lg:px-10 xl:px-12">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-start">
            <div>
              <SectionEyebrow>Everywhere you are</SectionEyebrow>
              <h2 className="mt-5 font-serif text-4xl leading-[1.05] text-white sm:text-5xl">
                Four surfaces.
                <br />
                <span className="italic text-gold">One conversation.</span>
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-relaxed text-text-secondary lg:justify-self-end">
              Start a request on your watch on the way home, finish it on your speaker
              while you're cooking, confirm it on your phone before you leave. The
              thread follows you.
            </p>
          </div>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SURFACES.map((surface, index) => (
              <motion.article
                key={surface.title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: index * 0.05, ease }}
                className="rounded-2xl border border-border bg-bg-surface/70 p-6 shadow-2xl shadow-black/10"
              >
                <span className="flex size-10 items-center justify-center rounded-lg border border-gold/20 bg-gold/10 text-gold">
                  <surface.icon className="size-5" />
                </span>
                <h3 className="mt-8 font-serif text-2xl text-white">{surface.title}</h3>
                <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.24em] text-text-muted">
                  {surface.meta}
                </p>
                <p className="mt-5 text-sm leading-relaxed text-text-secondary">
                  {surface.desc}
                </p>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border/40 py-20">
        <div className="mx-auto w-full max-w-[1320px] px-6 sm:px-8 lg:px-10 xl:px-12">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <SectionEyebrow>What you can say</SectionEyebrow>
              <h2 className="mt-5 font-serif text-4xl leading-[1.05] text-white sm:text-5xl">
                Talk like you'd talk
                <br />
                <span className="italic text-gold">to a friend who works in restaurants.</span>
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-relaxed text-text-secondary lg:justify-self-end">
              No keywords. No menus. No "sorry, I didn't get that." If a person could
              understand what you mean, Cenaiva does too.
            </p>
          </div>

          <div className="mt-14 grid gap-4 lg:grid-cols-2">
            {PROMPTS.map((item, index) => (
              <motion.article
                key={item.label}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: index * 0.035, ease }}
                className="rounded-2xl border border-border bg-bg-surface/70 p-5"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-gold">
                  {item.label}
                </p>
                <p className="mt-4 font-serif text-lg italic leading-relaxed text-white">
                  "{item.prompt}"
                </p>
                <div className="mt-5 border-t border-border/60 pt-4">
                  <p className="flex gap-3 text-sm leading-relaxed text-text-secondary">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-gold/20 bg-gold/10 text-gold">
                      <Sparkles className="size-3.5" />
                    </span>
                    {item.response}
                  </p>
                </div>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-border/40 py-24 sm:py-28">
        <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:radial-gradient(ellipse_at_center,var(--gold)_0%,transparent_55%)]" />
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.55, ease }}
          className="relative mx-auto flex w-full max-w-[1320px] flex-col items-center px-6 text-center sm:px-8 lg:px-10 xl:px-12"
        >
          <SectionEyebrow>Get it</SectionEyebrow>
          <h2 className="mt-6 max-w-5xl font-serif text-5xl leading-[1.02] text-white sm:text-6xl lg:text-7xl">
            It's part of the app.{" "}
            <span className="italic text-gold">
              Download
              <br className="hidden sm:block" /> once.
            </span>
          </h2>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Button asChild className="h-12 rounded-md px-8 font-semibold">
              <Link to="/register">
                Get Cenaiva <ArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-12 rounded-md px-8">
              <Link to="/register">Send to my phone</Link>
            </Button>
          </div>
          <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.28em] text-text-muted sm:text-xs">
            Free - iOS 17+ - Android 12+ - CarPlay - Apple Watch - HomePod
          </p>
        </motion.div>
      </section>
    </MarketingShell>
  );
}
