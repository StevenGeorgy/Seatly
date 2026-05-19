import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CalendarDays,
  CalendarHeart,
  MessageCircle,
  Sparkles,
} from "lucide-react";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { HeyCenaivaVoiceMock } from "@/components/marketing/HeyCenaivaVoiceMock";
import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/useUser";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

// Auth gate destination — where to send the user when they tap "Try Hey
// Cenaiva". Signed-in users go straight to the voice shell. Anonymous
// users are sent to /login with a `from` param so they bounce back here
// after authenticating.
const TRY_DESTINATION = "/discover?concierge=1";

const PROMPTS = [
  {
    label: "Spontaneous",
    prompt: "Find me somewhere nearby for two, in the next hour.",
    response: "Three options under a 6-minute walk. La Cigogne has a table free at 7:15.",
  },
  {
    label: "Planning",
    prompt: "Book somewhere good for my anniversary next Saturday — surprise me, but Italian.",
    response: "Booked a 2-top at Bar Vendetta, 8:30. Anniversary noted on the reservation.",
  },
  {
    label: "Group",
    prompt: "Dinner with the team Friday — six of us, dietary notes in the chat.",
    response: "Confirmed Trinity Common, 7pm. Dietary notes saved to the booking.",
  },
  {
    label: "Pre-order",
    prompt: "Lock in the wine pairing for tonight's reservation.",
    response: "Wine pairing added to your pre-order — kitchen will have it ready when you sit down.",
  },
  {
    label: "Dietary",
    prompt: "I'm gluten-free — only show me places that respect it.",
    response: "Three options nearby with GF mains on the menu. Aloette is 8 minutes away.",
  },
  {
    label: "Modify",
    prompt: "Push tonight's booking to 8:30 and add one more person.",
    response: "Updated your Bar Vendetta reservation — 8:30pm, party of 3. New deposit if any is shown before you confirm.",
  },
];

const BENEFITS = [
  {
    icon: Sparkles,
    title: "Triggered by your voice",
    desc: "Hey Cenaiva only wakes when you say the trigger phrase. Nothing is sent for transcription until then.",
  },
  {
    icon: MessageCircle,
    title: "Knows your taste",
    desc: "Remembers your dietary restrictions and preferences — every recommendation respects them.",
  },
  {
    icon: CalendarDays,
    title: "Plans the whole evening",
    desc: '"Book dinner for two on Friday" — Cenaiva picks a place and a time that work, with the deposit handled in the same conversation.',
  },
  {
    icon: CalendarHeart,
    title: "Change of plans? No problem.",
    desc: "Modify the time, party size, or cancel — right from your reservation. Refunds follow the restaurant's policy.",
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

export default function HeyCenaivaPage() {
  const navigate = useNavigate();
  const { user } = useUser();

  // Tapping any "Try Hey Cenaiva" CTA. Signed-in diners are sent straight
  // to the voice shell (?concierge=1 auto-opens it on /discover). Anonymous
  // visitors are bounced to /login with the same destination as ?from, so
  // they return here after sign-in. The voice shell requires auth — see
  // CLAUDE.md hard rule under "Voice (Hey Cenaiva)".
  const handleTryHeyCenaiva = () => {
    if (user) {
      navigate(TRY_DESTINATION);
    } else {
      navigate(`/login?from=${encodeURIComponent(TRY_DESTINATION)}`);
    }
  };

  return (
    <MarketingShell>
      <section className="relative overflow-hidden border-b border-border/40">
        <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:radial-gradient(ellipse_at_18%_0%,var(--gold)_0%,transparent_52%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:64px_64px]" />
        <div className="relative w-full px-12 py-24 sm:px-16 md:px-20 lg:px-24 lg:py-32 xl:px-32 2xl:px-40">
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
              A voice concierge built for going out. Plan the night, book the
              table, pre-order a course — without thumbing through a single
              screen.
            </p>
            <div className="mt-10">
              <Button
                type="button"
                onClick={handleTryHeyCenaiva}
                className="h-11 rounded-md px-6 font-semibold"
              >
                Try Hey Cenaiva <ArrowRight className="ml-1 size-4" />
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      <section id="conversation" className="scroll-mt-24 py-24">
        <div className="grid w-full gap-12 px-12 sm:px-16 md:px-20 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:px-24 xl:px-32 2xl:px-40">
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
              Hey Cenaiva is the voice concierge on iOS, Android, and your
              browser. Plan an outing, book a table, and pre-order a course —
              without thumbing through a single screen.
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
              <Button
                type="button"
                onClick={handleTryHeyCenaiva}
                className="h-11 rounded-md px-6 font-semibold"
              >
                Try Hey Cenaiva <ArrowRight className="ml-1 size-4" />
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-md px-6">
                <Link to="/discover">
                  <span className="mr-1.5 size-1.5 rounded-full bg-gold" />
                  Find a table
                </Link>
              </Button>
            </div>
          </motion.div>

          <HeyCenaivaVoiceMock />
        </div>
      </section>

      <section className="border-b border-border/40 py-20">
        <div className="w-full px-12 sm:px-16 md:px-20 lg:px-24 xl:px-32 2xl:px-40">
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
          className="relative flex w-full flex-col items-center px-12 text-center sm:px-16 md:px-20 lg:px-24 xl:px-32 2xl:px-40"
        >
          <SectionEyebrow>Get it</SectionEyebrow>
          <h2 className="mt-6 max-w-5xl font-serif text-5xl leading-[1.02] text-white sm:text-6xl lg:text-7xl">
            It's part of the app.{" "}
            <span className="italic text-gold">
              Sign up
              <br className="hidden sm:block" /> once.
            </span>
          </h2>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              onClick={handleTryHeyCenaiva}
              className="h-12 rounded-md px-8 font-semibold"
            >
              Try Hey Cenaiva <ArrowRight className="ml-1 size-4" />
            </Button>
            <Button asChild variant="outline" className="h-12 rounded-md px-8">
              <Link to="/discover">Browse restaurants</Link>
            </Button>
          </div>
          <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.28em] text-text-muted sm:text-xs">
            Free · Available on iOS, Android, and your browser
          </p>
        </motion.div>
      </section>
    </MarketingShell>
  );
}
