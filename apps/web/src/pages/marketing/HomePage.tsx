import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  ArrowRight,
  Calendar as CalendarIcon,
  ChevronDown,
  Clock,
  Heart,
  MapPin,
  Search,
  Sparkles,
  Users,
  AudioLines,
  CalendarDays,
  Wallet,
  CalendarHeart,
  CreditCard,
  Map as MapIcon,
  Coins,
  CheckCircle2,
} from "lucide-react";

import { MarketingShell } from "@/components/marketing/MarketingShell";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { formatCompactTimeLabel } from "@/lib/utils/time";
import { HeyCenaivaVoiceMock } from "@/components/marketing/HeyCenaivaVoiceMock";
import { useUser } from "@/hooks/useUser";

const ease = [0.25, 0.46, 0.45, 0.94] as const;

const TIME_SLOTS = [
  "5:00 PM",
  "5:30 PM",
  "6:00 PM",
  "6:30 PM",
  "7:00 PM",
  "7:30 PM",
  "8:00 PM",
  "8:30 PM",
  "9:00 PM",
  "9:30 PM",
];

const PARTY_SIZES = Array.from({ length: 10 }, (_, i) => i + 1);

const QUICK_PROMPTS = [
  '"$120 anniversary nearby"',
  '"Patio with wine list"',
  '"Late-night ramen for 4"',
];

const DINER_FEATURES = [
  {
    icon: MapIcon,
    title: "Discover, mapped",
    desc: "Map view, recommended lists, voice search. Filter by cuisine, budget, dietary needs, or how far you feel like walking.",
  },
  {
    icon: CalendarDays,
    title: "Book in two taps",
    desc: "Pre-pay deposits, modify or cancel right from your reservation. Confirmation codes on every booking.",
  },
  {
    icon: Wallet,
    title: "Order before you sit",
    desc: "Pre-order courses with the booking. Pay with a saved card. The kitchen has it ready when you arrive.",
  },
  {
    icon: Search,
    title: "Find any reservation",
    desc: "Look up your booking by confirmation code or email — no account login required.",
  },
  {
    icon: CalendarHeart,
    title: "Plan the moment",
    desc: "Anniversaries, birthdays, business dinners, post-game ramen. Tag the occasion when you book — the restaurant sees it.",
  },
  {
    icon: CreditCard,
    title: "Pay & split, gracefully",
    desc: "Apple Pay, Google Pay, saved cards. Split deposits across multiple cards. Pay-the-bill split is on the roadmap.",
  },
];

const FAQ = [
  {
    q: "Is Cenaiva free for diners?",
    a: "Yes. Forever. Diners pay nothing to discover, book, and pre-order across every Cenaiva restaurant.",
  },
  {
    q: "Do I need to download an app?",
    a: "You can, but you don't have to. Cenaiva is available on iOS and Android, and works just as well in any web browser on desktop, phone, or tablet. Sign in once and everything syncs across all three.",
  },
  {
    q: 'How does "Hey Cenaiva" actually work?',
    a: "One trigger phrase wakes the assistant in your browser. Once you start a booking request, the audio is transcribed by our voice partner and the request is sent for booking.",
  },
  {
    q: "Can I pre-order food before I arrive?",
    a: "Yes. When you book, you can browse the restaurant's menu and pre-order entrées, wine, or anything they've listed. The kitchen sees your order attached to your reservation.",
  },
  {
    q: "How do deposits work?",
    a: "Some restaurants ask for a deposit at booking — usually based on party size. You'll see the exact amount before you confirm, and you can split it across multiple cards if you're booking with friends.",
  },
  {
    q: "What if I have dietary restrictions or allergies?",
    a: "Set your dietary preferences once on your profile. Cenaiva remembers them on every booking, and every restaurant's menu items are flagged for allergens at the source.",
  },
  {
    q: "Can I modify my booking after I make it?",
    a: "Yes. Change the time, party size, or cancel right from your reservation — no phone call needed. If the new party size changes the deposit, you'll see the difference before you confirm.",
  },
  {
    q: "What if I cancel?",
    a: "Cancel a booking right from your reservation. Most cancellations are fully refunded — deposit terms are shown before you confirm.",
  },
  {
    q: "Where can I use it?",
    a: "Launching in Toronto — onboarding our first restaurants now. Built for Canada from day one.",
  },
  {
    q: "Is loyalty available yet?",
    a: "Not yet — coming soon. Points and tier perks across every Cenaiva restaurant. We'll let you know when it launches.",
  },
];

function StripePlaceholder({ label }: { label: string }) {
  return (
    <div
      className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, rgba(201,168,76,0.18) 0 14px, rgba(0,0,0,0.55) 14px 28px)",
        backgroundColor: "#1a1a1a",
      }}
    >
      <div className="size-9 rounded-full bg-gold/40 ring-4 ring-black/30" />
      <span className="absolute bottom-3 left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-[0.3em] text-gold/70">
        {label}
      </span>
    </div>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-gold sm:text-[13px]">
      <span className="inline-block h-px w-4 bg-gold/60 sm:w-5" /> {children}
    </span>
  );
}

// Where "Try Hey Cenaiva" sends signed-in diners. The `?concierge=1` flag
// auto-opens the voice shell on /discover. Anonymous visitors are bounced
// to /login with this path as `?from` so they return here after sign-in
// (voice shell is auth-gated per CLAUDE.md hard rule).
const HEY_CENAIVA_DESTINATION = "/discover?concierge=1";

export default function HomePage() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [time, setTime] = useState<string>("7:30 PM");
  const [people, setPeople] = useState<string>("2");
  const [query, setQuery] = useState<string>("");
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const dateLabel = useMemo(
    () => (date ? format(date, "MMM d") : "Pick a date"),
    [date],
  );

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleTryHeyCenaiva = () => {
    if (user) {
      navigate(HEY_CENAIVA_DESTINATION);
    } else {
      navigate(`/login?from=${encodeURIComponent(HEY_CENAIVA_DESTINATION)}`);
    }
  };

  const goToDiscover = (extra?: Record<string, string>) => {
    const params = new URLSearchParams();
    if (date) params.set("date", format(date, "yyyy-MM-dd"));
    if (time) params.set("time", time);
    if (people) params.set("people", people);
    if (query.trim()) params.set("q", query.trim());
    if (extra) for (const [k, v] of Object.entries(extra)) params.set(k, v);
    navigate(`/discover?${params.toString()}`);
  };

  const detectLocation = () => {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation is not supported in this browser.");
      return;
    }
    toast.loading("Detecting your location…", { id: "geo" });
    navigator.geolocation.getCurrentPosition(
      () => toast.success("Location updated.", { id: "geo" }),
      () => toast.error("Couldn't get location. Permission denied?", { id: "geo" }),
      { timeout: 8000 },
    );
  };

  return (
    <MarketingShell>
      {/* ── HERO ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_15%_10%,rgba(201,168,76,0.10)_0%,transparent_55%)]" />
        <div className="relative grid w-full items-center gap-16 px-12 py-24 sm:px-16 sm:py-28 md:px-20 lg:grid-cols-[auto_1fr] lg:gap-24 lg:py-32 xl:gap-28 xl:px-32 2xl:px-40">
          <div className="flex min-w-0 max-w-[720px] flex-col">
            <motion.span
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease }}
              className="inline-flex w-fit items-center gap-2.5 rounded-full border border-gold/30 bg-gold/5 px-4 py-1.5 font-mono text-xs uppercase tracking-[0.2em] text-gold sm:text-[13px]"
            >
              <span className="size-2 rounded-full bg-gold" />
              Built in Canada · Onboarding our first restaurants now
            </motion.span>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.05, ease }}
              className="mt-10 font-serif text-6xl font-medium leading-[1.05] tracking-tight text-white sm:text-7xl lg:text-8xl"
            >
              Dinner, planned
              <br />
              <span className="italic text-gold">in three words.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.12, ease }}
              className="mt-8 max-w-2xl text-lg leading-relaxed text-text-secondary sm:text-xl"
            >
              Find tonight's table. Plan an anniversary. Pre-order before you arrive. Just say{" "}
              <span className="italic text-gold">"Hey Cenaiva"</span> — or book the
              old-fashioned way, in two taps.
            </motion.p>

            {/* Search row */}
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2, ease }}
              className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
            >
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-14 items-center justify-between rounded-xl border border-border bg-bg-surface/70 px-5 text-left text-base text-white transition-colors hover:border-gold/40"
                  >
                    <span className="flex items-center gap-2.5">
                      <CalendarIcon className="size-5 text-text-muted" />
                      {dateLabel}
                    </span>
                    <ChevronDown className="size-5 text-text-muted" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(d) => {
                      setDate(d ?? undefined);
                      setDatePickerOpen(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              <Select value={time} onValueChange={setTime}>
                <SelectTrigger className="!h-14 rounded-xl border-border bg-bg-surface/70 px-5 text-base">
                  <span className="flex items-center gap-2.5">
                    <Clock className="size-5 text-text-muted" />
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {TIME_SLOTS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {formatCompactTimeLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={people} onValueChange={setPeople}>
                <SelectTrigger className="!h-14 rounded-xl border-border bg-bg-surface/70 px-5 text-base">
                  <span className="flex items-center gap-2.5">
                    <Users className="size-5 text-text-muted" />
                    <SelectValue />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {PARTY_SIZES.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} {n === 1 ? "person" : "people"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                onClick={() => goToDiscover()}
                className="h-14 rounded-xl px-8 text-base font-semibold"
              >
                Let's go
                <ArrowRight className="ml-1.5 size-5" />
              </Button>
            </motion.div>

            <motion.form
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.26, ease }}
              onSubmit={(e) => {
                e.preventDefault();
                goToDiscover();
              }}
              className="mt-4 flex h-14 items-center gap-3 rounded-xl border border-border bg-bg-surface/70 px-5"
            >
              <Search className="size-5 text-text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Location, Restaurant, or Cuisine"
                className="flex-1 bg-transparent text-base text-white placeholder:text-text-muted focus:outline-none"
              />
            </motion.form>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-text-muted">
              <span>It looks like you're in Toronto. Not correct?</span>
              <button
                type="button"
                onClick={detectLocation}
                className="inline-flex items-center gap-1.5 text-gold hover:underline"
              >
                <MapPin className="size-4" />
                Get current location
              </button>
            </div>

            <div className="mt-8 flex flex-nowrap items-center gap-3 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <span className="shrink-0 font-mono text-xs uppercase tracking-[0.18em] text-text-muted sm:text-[13px]">
                Try Hey Cenaiva:
              </span>
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setQuery(p.replace(/^"|"$/g, ""));
                    goToDiscover({ q: p.replace(/^"|"$/g, "") });
                  }}
                  className="shrink-0 rounded-full border border-border bg-bg-surface/70 px-4 py-2 text-sm text-text-secondary transition-colors hover:border-gold/40 hover:text-white"
                >
                  {p}
                </button>
              ))}
            </div>

            <div className="mt-20 grid w-full grid-cols-3 gap-6 border-t border-border/50 pt-12 sm:gap-10 lg:gap-14">
              <div>
                <p className="font-serif text-4xl text-white lg:text-5xl">Free</p>
                <p className="mt-2 text-sm text-text-muted">forever for diners</p>
              </div>
              <div>
                <p className="font-serif text-4xl text-white lg:text-5xl">Voice</p>
                <p className="mt-2 text-sm text-text-muted">Hey Cenaiva included</p>
              </div>
              <div>
                <p className="font-serif text-4xl text-white lg:text-5xl">CA</p>
                <p className="mt-2 text-sm text-text-muted">built for Canada</p>
              </div>
            </div>
          </div>

          {/* Phone mock — centered in space between copy and viewport edge */}
          <div className="relative hidden min-w-0 lg:flex lg:w-full lg:justify-center">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.15, ease }}
              className="relative w-full max-w-[360px]"
            >
              <div className="absolute -left-12 top-12 z-10 hidden w-64 rounded-2xl border border-border bg-bg-surface/90 p-4 shadow-2xl shadow-black/40 backdrop-blur lg:block">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">— Listening</p>
                <p className="mt-1 text-sm italic text-white">
                  "Book Maison Verre tonight, 7:30, for two."
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <AudioLines className="size-4 text-gold" />
                  <div className="flex flex-1 gap-0.5">
                    {Array.from({ length: 18 }).map((_, i) => (
                      <span
                        key={i}
                        className="block w-0.5 rounded-full bg-gold/60"
                        style={{ height: `${6 + Math.abs(Math.sin(i)) * 14}px` }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-[36px] border border-border bg-bg-surface p-3 shadow-2xl shadow-black/50">
                <div className="overflow-hidden rounded-[28px] border border-border/60 bg-black">
                  <StripePlaceholder label="MAISON VERRE · COVER" />
                  <div className="space-y-3 p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-serif text-xl text-white">Maison Verre</p>
                        <p className="text-xs text-text-secondary">Modern French · $$$$</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleFavorite("hero-maison")}
                        aria-label="Save"
                        className="rounded-full border border-border p-1.5 hover:border-gold/40"
                      >
                        <Heart
                          className={cn(
                            "size-4",
                            favorites.has("hero-maison")
                              ? "fill-gold text-gold"
                              : "text-text-muted",
                          )}
                        />
                      </button>
                    </div>
                    <p className="text-xs text-text-muted">★ 4.8 · Yorkville · 0.4km</p>
                    <div className="grid grid-cols-3 gap-2">
                      {["7:00 PM", "7:15 PM", "7:45 PM"].map((slot) => (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => goToDiscover({ slot })}
                          className={cn(
                            "rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                            slot === "7:15 PM"
                              ? "border-gold bg-gold/15 text-gold"
                              : "border-border bg-bg-elevated text-text-secondary hover:border-gold/40",
                          )}
                        >
                          {formatCompactTimeLabel(slot)}
                        </button>
                      ))}
                    </div>
                    <Button
                      className="w-full rounded-md font-semibold"
                      onClick={() => goToDiscover({ slot: "7:15 PM" })}
                    >
                      Reserve · 7:15pm
                    </Button>
                    <p className="text-center text-[11px] text-text-muted">
                      ✦ Pre-order from the menu before you arrive
                    </p>
                  </div>
                </div>
              </div>

              <div className="absolute -bottom-6 left-1/2 z-10 w-72 -translate-x-1/2 rounded-2xl border border-border bg-bg-surface/95 p-3 shadow-2xl shadow-black/40 backdrop-blur">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                    <CheckCircle2 className="size-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">Confirmed · 7:30pm</p>
                    <p className="font-mono text-[10px] text-text-muted">
                      MV-7K2N91 · Patio T12 · 47 sec ago
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── For Restaurants ─────────────────────────────────── */}
      <section
        id="for-restaurants"
        className="scroll-mt-24 border-t border-border/40 bg-bg-surface/30 py-20"
      >
        <div className="mx-auto grid w-full gap-12 px-12 sm:px-16 md:px-20 lg:grid-cols-[1fr_1.1fr] lg:gap-16 lg:px-24 xl:px-32 2xl:px-40">
          <div>
            <SectionEyebrow>For restaurants</SectionEyebrow>
            <h2 className="mt-4 font-serif text-6xl leading-[1.05] text-white lg:text-7xl">
              Run a restaurant?
              <br />
              <span className="italic text-gold">We replaced the stack.</span>
            </h2>
            <p className="mt-8 max-w-lg text-lg leading-relaxed text-text-secondary">
              Reservations, floor plan, pre-orders, deposits, payments — on one
              dashboard, one login.{" "}
              <span className="text-gold">$199.99/mo · $1 per confirmed booking.</span>{" "}
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
              <Link
                to="/restaurants#pricing"
                className="text-sm text-text-secondary transition-colors hover:text-white"
              >
                See pricing →
              </Link>
            </div>
            <p className="mt-5 text-sm text-text-muted">
              <span className="text-gold">Free 3 months</span>, then $199.99 CAD/month.
              $1 per reservation + 2% on pre-orders &amp; deposits. Cancel any month.
            </p>
          </div>

          <div>
            <ul className="space-y-8">
              {[
                {
                  icon: CalendarDays,
                  title: "Reservations + floor plan",
                  desc: "Realtime availability, deposit policies, modify and cancel flows, cover-cap enforcement built in.",
                },
                {
                  icon: Wallet,
                  title: "Pre-orders & deposits",
                  desc: "Pre-orders attached to bookings. Tier-based deposit policy. Stripe Connect handles payments.",
                },
                {
                  icon: Coins,
                  title: "Honest pricing",
                  desc: "$199.99/mo + $1 per confirmed booking. 2% on pre-orders & deposits. Zero commission on menu prices. Native CAD.",
                },
                {
                  icon: Sparkles,
                  title: "Service overview",
                  desc: "Tonight's covers, paid pre-order income, today's pre-orders, and a live reservation timeline on one dashboard.",
                },
              ].map((item) => (
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
          </div>
        </div>
      </section>

      {/* ── Hey Cenaiva ─────────────────────────────────── */}
      <section
        id="hey-cenaiva"
        className="scroll-mt-24 border-t border-border/40 py-20"
      >
        <div className="mx-auto grid w-full gap-12 px-12 sm:px-16 md:px-20 lg:grid-cols-[1fr_1.15fr] lg:gap-16 lg:px-24 xl:px-32 2xl:px-40">
          <div>
            <SectionEyebrow>Hey Cenaiva</SectionEyebrow>
            <h2 className="mt-4 font-serif text-6xl leading-[1.05] text-white lg:text-7xl">
              Just <span className="italic text-gold">say it.</span>
              <br />
              We'll book it.
            </h2>
            <p className="mt-8 max-w-lg text-lg leading-relaxed text-text-secondary">
              Hey Cenaiva is the voice concierge on iOS, Android, and your
              browser. Plan an outing, book a table, and pre-order a course —
              without thumbing through a single screen.
            </p>

            <ul className="mt-12 space-y-8">
              {[
                {
                  icon: Sparkles,
                  title: "Triggered by your voice",
                  desc: "Hey Cenaiva only wakes when you say the trigger phrase. Nothing is sent for transcription until then.",
                },
                {
                  icon: Sparkles,
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
              ].map((item) => (
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

            <div className="mt-12 flex flex-wrap items-center gap-4">
              <Button
                type="button"
                onClick={handleTryHeyCenaiva}
                className="h-12 rounded-md px-6 text-base font-semibold"
              >
                Try Hey Cenaiva <ArrowRight className="ml-1.5 size-5" />
              </Button>
            </div>
          </div>

          {/* Voice mock — mirrors the real Cenaiva voice shell */}
          <HeyCenaivaVoiceMock />
        </div>
      </section>

      {/* ── For Diners ─────────────────────────────────── */}
      <section id="loyalty" className="scroll-mt-24 border-t border-border/40 py-20">
        <div className="w-full px-12 sm:px-16 md:px-20 lg:px-24 xl:px-32 2xl:px-40">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <SectionEyebrow>For diners</SectionEyebrow>
              <h2 className="mt-4 font-serif text-6xl leading-[1.05] text-white lg:text-7xl">
                A personal dining
                <br />
                planner.
              </h2>
            </div>
            <p className="max-w-2xl self-end text-lg leading-relaxed text-text-secondary lg:text-xl">
              Free for life. Use it once a year, or twice a week — Cenaiva
              remembers your dietary preferences and quietly handles the boring
              parts of going out.
            </p>
          </div>

          <div className="mt-10 flex flex-col gap-4 sm:flex-row">
            <Button asChild className="h-12 rounded-md px-6 text-base font-semibold">
              <Link to="/register">
                Join free <ArrowRight className="ml-1.5 size-5" />
              </Link>
            </Button>
          </div>

          <div className="mt-12 grid divide-border/40 overflow-hidden rounded-2xl border border-border/60 sm:grid-cols-2 lg:grid-cols-3">
            {DINER_FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                className={cn(
                  "border-border/60 bg-bg-surface/40 p-8 transition-colors hover:bg-bg-surface/80",
                  i % 3 !== 2 && "lg:border-r",
                  i % 2 !== 1 && "sm:[&:not(:nth-child(3n))]:border-r",
                  i < 3 && "lg:border-b",
                  i < 4 && "border-b sm:[&:nth-child(-n+4)]:border-b",
                )}
              >
                <span className="flex size-12 items-center justify-center rounded-lg border border-gold/30 bg-gold/10">
                  <f.icon className="size-6 text-gold" />
                </span>
                <p className="mt-8 font-serif text-3xl text-white">{f.title}</p>
                <p className="mt-4 text-base leading-relaxed text-text-muted">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────── */}
      <section className="border-t border-border/40 py-20">
        <div className="mx-auto w-full px-12 sm:px-16 md:px-20 lg:px-24 xl:px-32 2xl:px-40">
          <div className="mx-auto max-w-3xl text-center">
            <SectionEyebrow>Questions</SectionEyebrow>
            <h2 className="mt-4 font-serif text-5xl text-white sm:text-6xl">
              The small print, made plain.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-text-muted sm:text-lg">
              Quick answers to what diners ask before they sign up. Can't find
              what you're looking for? Reach out — we're a small team and
              actually reply.
            </p>
          </div>

          <Accordion
            type="single"
            collapsible
            className="mx-auto mt-14 grid w-full gap-3 text-left lg:grid-cols-2 lg:gap-x-5"
          >
            {FAQ.map((item) => (
              <AccordionItem
                key={item.q}
                value={item.q}
                className="overflow-hidden rounded-xl border border-border bg-bg-surface/60 px-6 h-fit"
              >
                <AccordionTrigger className="py-6 text-left text-lg font-medium text-white hover:no-underline">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="pb-6 text-base leading-relaxed text-text-secondary">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

    </MarketingShell>
  );
}
