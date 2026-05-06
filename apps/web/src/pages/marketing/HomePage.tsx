import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowUpRight,
  Calendar as CalendarIcon,
  Check,
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

type Restaurant = {
  id: string;
  name: string;
  reviews: number;
  cuisine: string;
  price: string;
  area: string;
  bookedToday: number;
  slots: string[];
  initials: string;
};

const RESTAURANTS: Restaurant[] = [
  {
    id: "maison-verre",
    name: "Maison Verre",
    reviews: 1538,
    cuisine: "Modern French",
    price: "$$$$",
    area: "Yorkville",
    bookedToday: 82,
    slots: ["9:30 PM", "9:45 PM", "10:00 PM"],
    initials: "MAISON",
  },
  {
    id: "taps-public-house",
    name: "Taps Public House",
    reviews: 1238,
    cuisine: "Fusion / Eclectic",
    price: "$$$",
    area: "Mississauga",
    bookedToday: 64,
    slots: ["9:30 PM", "9:45 PM", "10:00 PM"],
    initials: "TAPS",
  },
  {
    id: "osteria-nova",
    name: "Osteria Nova",
    reviews: 892,
    cuisine: "Italian · Wood-fired",
    price: "$$$",
    area: "King West",
    bookedToday: 47,
    slots: ["6:45 PM", "7:30 PM", "9:00 PM"],
    initials: "OSTERIA",
  },
  {
    id: "salt-ember",
    name: "Salt & Ember",
    reviews: 2104,
    cuisine: "Live-fire grill",
    price: "$$$",
    area: "Distillery",
    bookedToday: 118,
    slots: ["7:15 PM", "8:00 PM", "8:45 PM"],
    initials: "SALT",
  },
];

const TIMELINE = [
  { time: "7:30pm", who: "Lefebvre · party of 4", status: "seated" as const },
  { time: "7:45pm", who: "Chen · party of 2", status: "confirmed" as const },
  { time: "8pm", who: "Singh · party of 6 · VIP", status: "at-risk" as const },
  { time: "8:15pm", who: "Walk-in · party of 2", status: "waiting" as const },
  { time: "8:30pm", who: "Tremblay · party of 3 · anniversary", status: "confirmed" as const },
];

const STATUS_STYLES: Record<(typeof TIMELINE)[number]["status"], string> = {
  seated: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
  confirmed: "bg-gold/10 text-gold border border-gold/30",
  "at-risk": "bg-amber-500/10 text-amber-400 border border-amber-500/30",
  waiting: "bg-zinc-500/10 text-zinc-300 border border-zinc-500/30",
};

const DINER_FEATURES = [
  {
    icon: MapIcon,
    title: "Discover, mapped",
    desc: "Map view, recommended lists, AI search. Filter by mood, budget, dietary needs, or how far you feel like walking.",
  },
  {
    icon: CalendarDays,
    title: "Book in two taps",
    desc: "Pre-pay deposits, hold a table, modify or cancel from your wrist. Confirmation codes synced to your calendar.",
  },
  {
    icon: Wallet,
    title: "Order before you sit",
    desc: "Pre-order courses with the booking. Or scan the table QR for dine-in. Or order takeout. Same wallet, same loyalty.",
  },
  {
    icon: Coins,
    title: "Loyalty that compounds",
    desc: "Earn points everywhere. Redeem for discounts, free menu items, or event tickets. Tier unlocks and perks across every Cenaiva restaurant.",
  },
  {
    icon: CalendarHeart,
    title: "Plan the moment",
    desc: "Anniversaries, birthdays, business dinners, post-game ramen. Save groups, favourite spots, and dietary profiles per guest.",
  },
  {
    icon: CreditCard,
    title: "Pay & split, gracefully",
    desc: "Apple Pay, Google Pay, gift cards. Split equally or by item. Tipping defaults set the way you actually tip.",
  },
];

const FAQ = [
  {
    q: "Is Cenaiva free for diners?",
    a: "Yes. Forever. Diners pay nothing to discover, book, pre-order, or earn loyalty across every Cenaiva restaurant.",
  },
  {
    q: 'How does "Hey Cenaiva" actually work?',
    a: "One trigger phrase wakes the assistant. Audio is processed on-device until you confirm an action, at which point the request is encrypted and sent for booking. It works on iOS, Android, Apple Watch, CarPlay, and HomePod.",
  },
  {
    q: "Does it work in French?",
    a: "Fully. Both the diner app and the restaurant dashboard ship in English and French — including Hey Cenaiva voice, receipts, and email confirmations.",
  },
  {
    q: "What if I cancel?",
    a: "Cancel a booking from the app, your watch, or by saying so. Most restaurants allow free cancellation up to 2 hours before — deposit terms are shown before you confirm.",
  },
  {
    q: "Where can I use it?",
    a: "Toronto, Montréal, and Vancouver today, with 800+ restaurants on the platform. New cities roll out every quarter.",
  },
];

const PRICING = [
  {
    badge: "For diners",
    name: "Cenaiva",
    tagline: "Discover, book, earn",
    price: "Free",
    suffix: "",
    cta: "Get the app",
    href: "/register",
    highlighted: false,
    features: [
      "Unlimited bookings",
      "Hey Cenaiva voice",
      "Loyalty across all restaurants",
      "EN + FR",
    ],
  },
  {
    badge: "For restaurants",
    name: "Counter",
    tagline: "Cafés & quick-service",
    price: "$89",
    suffix: "/ month",
    cta: "Start trial",
    href: "/register",
    highlighted: false,
    features: [
      "Reservations & waitlist",
      "Single location",
      "Email support",
      "$1 / confirmed booking",
    ],
  },
  {
    badge: "Most popular",
    name: "Service",
    tagline: "Full-service dining",
    price: "$249",
    suffix: "/ month",
    cta: "Start trial",
    href: "/register",
    highlighted: true,
    features: [
      "Everything in Counter",
      "Floor plan + KDS",
      "Staff scheduling",
      "Priority chat",
    ],
  },
  {
    badge: "For restaurants",
    name: "Group",
    tagline: "Multi-location",
    price: "Custom",
    suffix: "",
    cta: "Talk to sales",
    href: "/about",
    highlighted: false,
    features: [
      "Everything in Service",
      "Unlimited locations",
      "Dedicated success lead",
      "Custom integrations",
    ],
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
    <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-gold">
      <span className="inline-block h-px w-3 bg-gold/60" /> {children}
    </span>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
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
        <div className="relative grid w-full items-center gap-12 px-12 py-20 sm:px-16 md:px-20 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-16 lg:px-24 lg:py-24 xl:grid-cols-[minmax(0,640px)_420px] xl:px-32 2xl:px-40">
          <div className="flex flex-col">
            <motion.span
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease }}
              className="inline-flex w-fit items-center gap-2 rounded-full border border-gold/30 bg-gold/5 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-gold"
            >
              <span className="size-1.5 rounded-full bg-gold" />
              800+ restaurants · Toronto · Montréal · Vancouver
            </motion.span>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.05, ease }}
              className="mt-8 font-serif text-5xl font-medium leading-[1.05] tracking-tight text-white sm:text-6xl lg:text-7xl"
            >
              Dinner, planned
              <br />
              <span className="italic text-gold">in three words.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.12, ease }}
              className="mt-7 max-w-xl text-base leading-relaxed text-text-secondary sm:text-lg"
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
              className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
            >
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-12 items-center justify-between rounded-xl border border-border bg-bg-surface/70 px-4 text-left text-sm text-white transition-colors hover:border-gold/40"
                  >
                    <span className="flex items-center gap-2">
                      <CalendarIcon className="size-4 text-text-muted" />
                      {dateLabel}
                    </span>
                    <ChevronDown className="size-4 text-text-muted" />
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
                <SelectTrigger className="!h-12 rounded-xl border-border bg-bg-surface/70 px-4 text-sm">
                  <span className="flex items-center gap-2">
                    <Clock className="size-4 text-text-muted" />
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
                <SelectTrigger className="!h-12 rounded-xl border-border bg-bg-surface/70 px-4 text-sm">
                  <span className="flex items-center gap-2">
                    <Users className="size-4 text-text-muted" />
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
                className="h-12 rounded-xl px-6 font-semibold"
              >
                Let's go
                <ArrowRight className="ml-1 size-4" />
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
              className="mt-3 flex h-12 items-center gap-2 rounded-xl border border-border bg-bg-surface/70 px-4"
            >
              <Search className="size-4 text-text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Location, Restaurant, or Cuisine"
                className="flex-1 bg-transparent text-sm text-white placeholder:text-text-muted focus:outline-none"
              />
            </motion.form>

            <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
              <span>It looks like you're in Toronto. Not correct?</span>
              <button
                type="button"
                onClick={detectLocation}
                className="inline-flex items-center gap-1 text-gold hover:underline"
              >
                <MapPin className="size-3" />
                Get current location
              </button>
            </div>

            <div className="mt-7 flex flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
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
                  className="shrink-0 rounded-full border border-border bg-bg-surface/70 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-gold/40 hover:text-white"
                >
                  {p}
                </button>
              ))}
            </div>

            <div className="mt-14 grid max-w-xl grid-cols-3 gap-8 border-t border-border/50 pt-8">
              <div>
                <p className="font-serif text-3xl text-white">12,400+</p>
                <p className="mt-1 text-xs text-text-muted">restaurants nationwide</p>
              </div>
              <div>
                <p className="font-serif text-3xl text-white">Free</p>
                <p className="mt-1 text-xs text-text-muted">forever for diners</p>
              </div>
              <div>
                <p className="font-serif text-3xl text-white">1.5x</p>
                <p className="mt-1 text-xs text-text-muted">points on Tuesdays</p>
              </div>
            </div>
          </div>

          {/* Phone mock */}
          <div className="relative hidden lg:block">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.15, ease }}
              className="relative mx-auto w-full max-w-[360px]"
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
                      ✦ Earn 185 points · ≈ $1.85
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

      {/* ── Available tonight ─────────────────────────────────── */}
      <section className="border-t border-border/40 py-20">
        <div className="w-full px-12 sm:px-16 md:px-20 lg:px-24 xl:px-32 2xl:px-40">
          <div className="flex items-end justify-between gap-6">
            <div>
              <SectionEyebrow>Available tonight near you</SectionEyebrow>
              <h2 className="mt-3 font-serif text-4xl text-white sm:text-5xl">
                Toronto · {formatCompactTimeLabel(time)} · {people} {people === "1" ? "guest" : "guests"}
              </h2>
            </div>
            <Link
              to="/discover"
              className="hidden items-center gap-1 text-sm text-gold hover:underline sm:inline-flex"
            >
              See all 142
              <ArrowRight className="size-4" />
            </Link>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {RESTAURANTS.map((r, i) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.45, delay: i * 0.06 }}
                className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-bg-surface transition-colors hover:border-gold/40"
              >
                <div className="relative">
                  <StripePlaceholder label={r.initials} />
                  <button
                    type="button"
                    onClick={() => toggleFavorite(r.id)}
                    aria-label="Save restaurant"
                    className="absolute right-3 top-3 rounded-full border border-border bg-black/60 p-1.5 backdrop-blur transition-colors hover:border-gold/50"
                  >
                    <Heart
                      className={cn(
                        "size-4",
                        favorites.has(r.id) ? "fill-gold text-gold" : "text-white",
                      )}
                    />
                  </button>
                </div>
                <div className="flex flex-1 flex-col gap-3 p-5">
                  <div>
                    <p className="font-serif text-xl text-white">{r.name}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-text-secondary">
                      <span className="text-gold">★★★★☆</span>
                      <span>{r.reviews.toLocaleString()} reviews</span>
                    </div>
                  </div>
                  <p className="text-xs text-text-secondary">
                    {r.cuisine} · {r.price} · {r.area}
                  </p>
                  <p className="flex items-center gap-1.5 text-xs text-text-muted">
                    <ArrowUpRight className="size-3 text-gold" />
                    Booked {r.bookedToday} times today
                  </p>
                  <div className="mt-auto grid grid-cols-3 gap-2 pt-2">
                    {r.slots.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() =>
                          goToDiscover({ restaurant: r.id, slot: s })
                        }
                        className="rounded-md bg-gold py-2 text-xs font-semibold text-black transition-opacity hover:opacity-90"
                      >
                        {formatCompactTimeLabel(s)}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── For Restaurants ─────────────────────────────────── */}
      <section
        id="for-restaurants"
        className="scroll-mt-24 border-t border-border/40 bg-bg-surface/30 py-20"
      >
        <div className="grid w-full gap-12 px-12 sm:px-16 md:px-20 lg:grid-cols-[1fr_1.1fr] lg:gap-16 lg:px-24 xl:px-32 2xl:px-40">
          <div>
            <SectionEyebrow>For restaurants</SectionEyebrow>
            <h2 className="mt-3 font-serif text-5xl leading-[1.05] text-white">
              Run a restaurant?
              <br />
              <span className="italic text-gold">We replaced the stack.</span>
            </h2>
            <p className="mt-6 max-w-md text-base leading-relaxed text-text-secondary">
              Reservations, floor plan, kitchen display, staff scheduling, CRM,
              analytics, payments — on one ledger, in one login.{" "}
              <span className="text-gold">$1.00 per confirmed booking.</span> Zero
              commission on orders, ever.
            </p>

            <ul className="mt-10 space-y-6">
              {[
                {
                  icon: CalendarDays,
                  title: "Reservations + waitlist",
                  desc: "Realtime floor plan, deposit policies, no-show risk scoring built in.",
                },
                {
                  icon: Wallet,
                  title: "Orders & KDS",
                  desc: "Pre-orders, dine-in QR, takeout, optional delivery — one ticket pipeline to the kitchen.",
                },
                {
                  icon: Coins,
                  title: "Honest pricing",
                  desc: "$1 per confirmed booking. No cut of your menu prices. Native CAD, billed monthly.",
                },
                {
                  icon: Sparkles,
                  title: "AI that pays its rent",
                  desc: "Demand forecasts, menu performance, no-show flags, receipt scanning, accountant exports.",
                },
              ].map((item) => (
                <li key={item.title} className="flex gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10">
                    <item.icon className="size-5 text-gold" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-text-muted">
                      {item.desc}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-10 flex items-center gap-3">
              <Button asChild className="h-11 rounded-md px-5 font-semibold">
                <Link to="/restaurants">
                  Book a demo <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 rounded-md px-5">
                <Link to="/restaurants#pricing">See pricing</Link>
              </Button>
            </div>
          </div>

          {/* Live dashboard mock */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease }}
            className="rounded-2xl border border-border bg-bg-surface p-6 shadow-2xl shadow-black/30"
          >
            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
              <span>Live · Maison Verre · Saturday Service</span>
              <span>7:42pm</span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Tonight", value: "142", trend: "+18%" },
                { label: "Revenue", value: "$24.8k", trend: "+13%" },
                { label: "Avg cover", value: "$87", trend: "—" },
                { label: "No-show", value: "3", trend: "flag" },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-xl border border-border bg-bg-elevated/50 p-4"
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                    {s.label}
                  </p>
                  <p className="mt-2 font-serif text-2xl text-white">{s.value}</p>
                  <p className="mt-1 text-[11px] text-gold">{s.trend}</p>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
                — Tonight's timeline
              </p>
              <ul className="mt-3 divide-y divide-border/50">
                {TIMELINE.map((row) => (
                  <li
                    key={row.time + row.who}
                    className="flex items-center justify-between py-3 text-sm"
                  >
                    <span className="flex items-center gap-4">
                      <span className="w-12 font-mono text-xs text-text-muted">
                        {row.time}
                      </span>
                      <span className="text-text-secondary">{row.who}</span>
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
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
              <div>
                <p className="font-mono uppercase tracking-[0.18em] text-text-muted">
                  Floor plan
                </p>
                <p className="mt-1 text-text-secondary">24/30 occupied</p>
              </div>
              <div>
                <p className="font-mono uppercase tracking-[0.18em] text-text-muted">
                  KDS
                </p>
                <p className="mt-1 text-text-secondary">7 tickets active</p>
              </div>
              <div>
                <p className="font-mono uppercase tracking-[0.18em] text-text-muted">
                  Staff
                </p>
                <p className="mt-1 text-text-secondary">12 clocked in</p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Hey Cenaiva ─────────────────────────────────── */}
      <section
        id="hey-cenaiva"
        className="scroll-mt-24 border-t border-border/40 py-20"
      >
        <div className="grid w-full gap-12 px-12 sm:px-16 md:px-20 lg:grid-cols-[1fr_1.15fr] lg:gap-16 lg:px-24 xl:px-32 2xl:px-40">
          <div>
            <SectionEyebrow>Hey Cenaiva</SectionEyebrow>
            <h2 className="mt-3 font-serif text-5xl leading-[1.05] text-white">
              Just <span className="italic text-gold">say it.</span>
              <br />
              We'll book it.
            </h2>
            <p className="mt-6 max-w-md text-base leading-relaxed text-text-secondary">
              Hey Cenaiva is the voice concierge built into the app, your watch,
              your car, and your home speaker. Plan an outing, hold a table, pre-order
              a course, redeem points — without thumbing through a single screen.
            </p>

            <ul className="mt-10 space-y-6">
              {[
                {
                  icon: Sparkles,
                  title: "Always on, never creepy",
                  desc: "One trigger phrase. Audio is processed on-device until you confirm.",
                },
                {
                  icon: Sparkles,
                  title: "Knows your taste",
                  desc: "Remembers your dietary restrictions, favourite neighbourhoods, and who you usually dine with.",
                },
                {
                  icon: CalendarDays,
                  title: "Plans the whole evening",
                  desc: '"Book dinner before the 8pm Leafs game" — it picks a place, a time, and warns you about traffic.',
                },
                {
                  icon: Coins,
                  title: "Redeems your points",
                  desc: '"Use my points for the wine pairing tonight" — done at checkout, automatically.',
                },
              ].map((item) => (
                <li key={item.title} className="flex gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10">
                    <item.icon className="size-5 text-gold" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-text-muted">
                      {item.desc}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-10 flex items-center gap-3">
              <Button asChild className="h-11 rounded-md px-5 font-semibold">
                <Link to="/hey-cenaiva">
                  Try Hey Cenaiva <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button
                variant="outline"
                className="h-11 rounded-md px-5"
                onClick={() => toast("Voice demo coming soon.", { icon: "🎙️" })}
              >
                <span className="mr-1.5 size-1.5 rounded-full bg-gold" />
                Listen to a demo
              </Button>
            </div>
          </div>

          {/* Voice mock */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6, ease }}
            className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-b from-bg-surface to-black/60 p-6"
          >
            <div className="flex items-center justify-end gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
              {(["phone", "watch", "car", "homepod"] as const).map((d, i) => (
                <span
                  key={d}
                  className={cn(
                    "rounded-full px-2.5 py-0.5",
                    i === 0
                      ? "border border-gold/40 bg-gold/15 text-gold"
                      : "text-text-muted",
                  )}
                >
                  {d}
                </span>
              ))}
            </div>

            <div className="mt-6 space-y-4">
              <div className="flex items-start gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
                  You
                </span>
                <div className="flex-1 rounded-2xl border border-border bg-bg-surface px-4 py-3 text-sm text-text-secondary">
                  Hey Cenaiva, I have a hundred bucks for a date night Friday.
                  Somewhere quiet, walkable from the Annex.
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="ml-auto order-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
                  Cenaiva
                </span>
                <div className="order-1 ml-auto max-w-[80%] rounded-2xl border border-gold/30 bg-gold/5 px-4 py-3 text-sm text-white">
                  I found three tables under $50/person within a 12-minute walk.{" "}
                  <span className="text-gold">Bistro Lumière</span> at 7:30 has your
                  favourite Côtes du Rhône on the list. Want me to hold it?
                </div>
              </div>
            </div>

            <div className="my-10 flex items-center justify-center">
              <div className="relative flex size-32 items-center justify-center rounded-full border border-gold/30">
                <div className="absolute inset-3 rounded-full border border-gold/20" />
                <div className="absolute inset-6 rounded-full border border-gold/10" />
                <div className="flex size-16 items-center justify-center rounded-full bg-gold text-black shadow-lg shadow-gold/30">
                  <AudioLines className="size-7" />
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => toast.success("Bistro Lumière held for 6 minutes.")}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-3 py-1.5 text-xs text-white hover:border-gold/40"
                >
                  <Check className="size-3.5 text-gold" /> Hold the table
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/discover")}
                  className="rounded-full border border-border bg-bg-elevated px-3 py-1.5 text-xs text-white hover:border-gold/40"
                >
                  Show all 3
                </button>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-border bg-bg-elevated p-3 text-xs">
                <span className="flex size-9 items-center justify-center rounded-md bg-gold/15 font-mono text-[10px] text-gold">
                  BL
                </span>
                <div>
                  <p className="text-sm text-white">Bistro Lumière · Friday 7:30pm</p>
                  <p className="text-text-muted">Held for 6 min · MTL-3F2A8K</p>
                </div>
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-400">
                  Held
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── For Diners ─────────────────────────────────── */}
      <section id="loyalty" className="scroll-mt-24 border-t border-border/40 py-20">
        <div className="w-full px-12 sm:px-16 md:px-20 lg:px-24 xl:px-32 2xl:px-40">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <SectionEyebrow>For diners</SectionEyebrow>
              <h2 className="mt-3 font-serif text-5xl leading-[1.05] text-white">
                A personal dining
                <br />
                planner.
              </h2>
            </div>
            <p className="max-w-2xl self-end text-base leading-relaxed text-text-secondary">
              Free for life. Use it once a year, or twice a week — Cenaiva learns
              your taste, banks your loyalty across every restaurant on the
              platform, and quietly handles the boring parts of going out.
            </p>
          </div>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Button asChild className="h-11 rounded-md px-5 font-semibold">
              <Link to="/loyalty">
                Explore loyalty <ArrowRight className="ml-1 size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-11 rounded-md px-5">
              <Link to="/register">Join free</Link>
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
                  "border-border/60 bg-bg-surface/40 p-7 transition-colors hover:bg-bg-surface/80",
                  i % 3 !== 2 && "lg:border-r",
                  i % 2 !== 1 && "sm:[&:not(:nth-child(3n))]:border-r",
                  i < 3 && "lg:border-b",
                  i < 4 && "border-b sm:[&:nth-child(-n+4)]:border-b",
                )}
              >
                <span className="flex size-10 items-center justify-center rounded-lg border border-gold/30 bg-gold/10">
                  <f.icon className="size-5 text-gold" />
                </span>
                <p className="mt-6 font-serif text-2xl text-white">{f.title}</p>
                <p className="mt-3 text-sm leading-relaxed text-text-muted">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────── */}
      <section className="border-t border-border/40 py-20">
        <div className="mx-auto w-full max-w-3xl px-12 text-center sm:px-16 md:px-20 lg:px-24 xl:px-32 2xl:px-40">
          <SectionEyebrow>Questions</SectionEyebrow>
          <h2 className="mt-3 font-serif text-4xl text-white sm:text-5xl">
            The small print, made plain.
          </h2>

          <Accordion type="single" collapsible className="mt-12 space-y-3 text-left">
            {FAQ.map((item) => (
              <AccordionItem
                key={item.q}
                value={item.q}
                className="overflow-hidden rounded-xl border border-border bg-bg-surface/60 px-5"
              >
                <AccordionTrigger className="py-5 text-base font-medium text-white hover:no-underline">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="pb-5 text-sm leading-relaxed text-text-secondary">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────── */}
      <section id="pricing" className="scroll-mt-24 border-t border-border/40 py-20">
        <div className="w-full px-12 text-center sm:px-16 md:px-20 lg:px-24 xl:px-32 2xl:px-40">
          <SectionEyebrow>Pricing</SectionEyebrow>
          <h2 className="mt-3 font-serif text-4xl text-white sm:text-5xl">
            Free for diners. Honest for restaurants.
          </h2>
          <p className="mt-3 text-sm text-text-muted">
            All prices CAD. No commissions, ever.
          </p>

          <div className="mt-14 grid gap-5 text-left sm:grid-cols-2 lg:grid-cols-4">
            {PRICING.map((tier, i) => (
              <motion.div
                key={tier.name}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.45, delay: i * 0.06 }}
                className={cn(
                  "relative flex flex-col rounded-2xl border bg-bg-surface/40 p-6",
                  tier.highlighted
                    ? "border-gold/60 shadow-2xl shadow-gold/10 ring-1 ring-gold/40"
                    : "border-border",
                )}
              >
                <span
                  className={cn(
                    "inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
                    tier.highlighted
                      ? "border-gold bg-gold/15 text-gold"
                      : "border-border bg-bg-elevated text-text-muted",
                  )}
                >
                  {tier.badge}
                </span>
                <p className="mt-6 font-serif text-3xl text-white">{tier.name}</p>
                <p className="mt-1 text-xs text-text-muted">{tier.tagline}</p>

                <p className="mt-8 flex items-baseline gap-2 font-serif text-5xl text-white">
                  <span className={cn(tier.highlighted && "text-gold")}>{tier.price}</span>
                  {tier.suffix && (
                    <span className="text-sm font-normal text-text-muted">
                      {tier.suffix}
                    </span>
                  )}
                </p>

                <Button
                  asChild
                  variant={tier.highlighted || tier.name === "Cenaiva" ? "default" : "outline"}
                  className="mt-6 h-11 w-full rounded-md font-semibold"
                >
                  <Link to={tier.href}>{tier.cta}</Link>
                </Button>

                <ul className="mt-6 space-y-3 text-sm text-text-secondary">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-gold" />
                      {f}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
