import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Bookmark,
  CalendarDays,
  Check,
  ChevronDown,
  Flame,
  LayoutDashboard,
  LayoutGrid,
  LocateFixed,
  LogOut,
  Map as MapIcon,
  Minus,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Tag,
  User,
  X,
} from "lucide-react";

import { useUser } from "@/hooks/useUser";
import {
  useAllActivePromotions,
  type PromotionWithRestaurant,
} from "@/hooks/usePromotions";
import { useStaffRestaurants } from "@/hooks/useStaffRestaurants";
import { CustomerNav } from "@/components/customer/CustomerNav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type EventType =
  | "Tasting Menu"
  | "Happy Hour"
  | "Event"
  | "Prix Fixe"
  | "Promotion"
  | "Wine"
  | "Brunch";

type DemoEvent = {
  id: string;
  type: EventType;
  spotsLeft: number;
  restaurant: string;
  title: string;
  when: string;
  price: string;
  initials: string;
  city: string;
  category: "Tonight" | "This Weekend" | "This Week";
};

const DATE_FILTERS = ["Tonight", "This Weekend", "This Week", "All Dates"] as const;
const TYPE_FILTERS = [
  "All Types",
  "Events",
  "Promotions",
  "Happy Hour",
  "Tasting Menu",
  "Prix Fixe",
  "Wine Events",
  "Brunch",
] as const;

const TIME_OPTIONS = [
  "6:00 PM",
  "6:30 PM",
  "7:00 PM",
  "7:30 PM",
  "8:00 PM",
  "8:30 PM",
  "9:00 PM",
  "9:30 PM",
];
const PRICE_OPTIONS = ["$", "$$", "$$$", "$$$$"];
const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, "8+"] as const;
const PRICE_FOR_TYPE: Record<string, string> = {
  "Tasting Menu": "$$$$",
  "Happy Hour": "$",
  Event: "$$$",
  "Prix Fixe": "$$",
  Promotion: "$$",
  Wine: "$$$",
  Brunch: "$$",
};

const DEMO_EVENTS: DemoEvent[] = [
  {
    id: "truffle-barolo",
    type: "Tasting Menu",
    spotsLeft: 6,
    restaurant: "Nova Ristorante",
    title: "Truffle & Barolo Tasting Night",
    when: "Tonight at 7:00 PM",
    price: "$185 / person",
    initials: "TRUFFLE",
    city: "Toronto",
    category: "Tonight",
  },
  {
    id: "happy-cocktails",
    type: "Happy Hour",
    spotsLeft: 24,
    restaurant: "Le Petit Jardin",
    title: "Happy Hour: Craft Cocktails 2-for-1",
    when: "Tonight at 4:00 PM",
    price: "From $9",
    initials: "COCKTAILS",
    city: "Toronto",
    category: "Tonight",
  },
  {
    id: "vinyl-bbq",
    type: "Event",
    spotsLeft: 14,
    restaurant: "The Smokehouse",
    title: "Vinyl Night — Bourbon & BBQ Pairings",
    when: "Tonight at 8:30 PM",
    price: "$65 / person",
    initials: "VINYL",
    city: "Toronto",
    category: "Tonight",
  },
  {
    id: "late-three-forty",
    type: "Prix Fixe",
    spotsLeft: 8,
    restaurant: "Bistro Lumière",
    title: "Late Service — Three for Forty",
    when: "Tonight at 9:30 PM",
    price: "$40 / person",
    initials: "BISTRO",
    city: "Montréal",
    category: "Tonight",
  },
  {
    id: "wine-friday",
    type: "Wine",
    spotsLeft: 12,
    restaurant: "Maison Verre",
    title: "Côtes du Rhône Flight Friday",
    when: "Friday at 7:00 PM",
    price: "$95 / person",
    initials: "WINE",
    city: "Toronto",
    category: "This Weekend",
  },
  {
    id: "omakase-sat",
    type: "Tasting Menu",
    spotsLeft: 4,
    restaurant: "Ginkgo",
    title: "Omakase 12-course",
    when: "Saturday at 6:30 PM",
    price: "$240 / person",
    initials: "OMAKASE",
    city: "Toronto",
    category: "This Weekend",
  },
  {
    id: "brunch-pigeon",
    type: "Brunch",
    spotsLeft: 18,
    restaurant: "Le Pigeon Bleu",
    title: "Sunday Bottomless Brunch",
    when: "Sunday at 11:00 AM",
    price: "$58 / person",
    initials: "BRUNCH",
    city: "Montréal",
    category: "This Weekend",
  },
  {
    id: "promo-osteria",
    type: "Promotion",
    spotsLeft: 30,
    restaurant: "Osteria Nova",
    title: "Wood-fired Wednesday — 25% off pizza",
    when: "Wed at 5:00 PM",
    price: "Save 25%",
    initials: "PIZZA",
    city: "Toronto",
    category: "This Week",
  },
  {
    id: "salt-tomahawk",
    type: "Event",
    spotsLeft: 9,
    restaurant: "Salt & Ember",
    title: "Tomahawk for Two",
    when: "Thu at 8:00 PM",
    price: "$220 / table",
    initials: "STEAK",
    city: "Toronto",
    category: "This Week",
  },
];

const TYPE_BADGE_LABEL: Record<EventType, string> = {
  "Tasting Menu": "TASTING MENU",
  "Happy Hour": "HAPPY HOUR",
  Event: "EVENT",
  "Prix Fixe": "PRIX FIXE",
  Promotion: "PROMOTION",
  Wine: "WINE EVENT",
  Brunch: "BRUNCH",
};

function adaptPromotion(p: PromotionWithRestaurant, idx: number): DemoEvent {
  const initials = (p.title || p.restaurants.name)
    .split(/\s+/)
    .slice(0, 1)
    .join(" ")
    .toUpperCase();
  let type: EventType = "Promotion";
  switch (p.promo_type) {
    case "bogo":
      type = "Promotion";
      break;
    case "free_item":
      type = "Event";
      break;
    case "percentage":
    case "fixed":
      type = "Promotion";
      break;
  }
  const remaining =
    p.max_uses != null ? Math.max(p.max_uses - p.current_uses, 0) : 12 + (idx % 20);

  let priceLabel = "Special offer";
  if (p.discount_unit === "percent" && p.discount_value)
    priceLabel = `Save ${p.discount_value}%`;
  if (p.discount_unit === "dollar" && p.discount_value)
    priceLabel = `Save $${p.discount_value}`;

  const expiry = p.ends_at ? new Date(p.ends_at) : null;
  const when = expiry
    ? `Ends ${expiry.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`
    : "Limited time";

  return {
    id: p.id,
    type,
    spotsLeft: remaining,
    restaurant: p.restaurants.name,
    title: p.title,
    when,
    price: priceLabel,
    initials,
    city: p.restaurants.city ?? "—",
    category: "This Week",
  };
}

function StripePlaceholder({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden",
        className,
      )}
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
      <Flame className="size-3" /> {children}
    </span>
  );
}

function EventCard({
  e,
  saved,
  onToggleSave,
  onReserve,
}: {
  e: DemoEvent;
  saved: boolean;
  onToggleSave: () => void;
  onReserve: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.4 }}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-bg-surface transition-colors hover:border-gold/40"
    >
      <div className="relative">
        <StripePlaceholder label={e.initials} className="aspect-auto h-44 sm:h-48 xl:h-52" />
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <span className="rounded-md border border-gold/40 bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-gold backdrop-blur">
            {TYPE_BADGE_LABEL[e.type]}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-gold/40 bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-gold backdrop-blur">
            <Flame className="size-3" /> {e.spotsLeft} left
          </span>
        </div>
        <button
          type="button"
          onClick={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            onToggleSave();
          }}
          aria-label="Save"
          className="absolute right-3 top-3 rounded-full border border-border bg-black/60 p-1.5 backdrop-blur transition-colors hover:border-gold/50"
        >
          <Bookmark
            className={cn("size-4", saved ? "fill-gold text-gold" : "text-white")}
          />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
          {e.restaurant}
        </p>
        <p className="font-serif text-2xl leading-tight text-white">{e.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-3.5 text-text-muted" />
            {e.when}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Tag className="size-3.5 text-text-muted" />
            {e.price}
          </span>
        </div>
        <Button
          onClick={onReserve}
          className="mt-2 h-11 w-full rounded-md font-semibold"
        >
          <CalendarDays className="size-4" />
          Reserve a spot
        </Button>
      </div>
    </motion.div>
  );
}

function ListEventCard({
  e,
  saved,
  onToggleSave,
  onReserve,
  onHover,
  highlighted,
}: {
  e: DemoEvent;
  saved: boolean;
  onToggleSave: () => void;
  onReserve: () => void;
  onHover: (id: string | null) => void;
  highlighted: boolean;
}) {
  return (
    <div
      onMouseEnter={() => onHover(e.id)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "flex gap-4 rounded-2xl border bg-bg-surface/40 p-4 transition-colors",
        highlighted ? "border-gold/60" : "border-border hover:border-gold/30",
      )}
    >
      <div className="relative w-44 shrink-0 overflow-hidden rounded-xl">
        <StripePlaceholder label={e.initials} className="aspect-square" />
        <span className="absolute left-2 top-2 rounded-md border border-gold/40 bg-black/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-gold">
          {TYPE_BADGE_LABEL[e.type]}
        </span>
        <span className="absolute left-2 bottom-2 inline-flex items-center gap-1 rounded-md border border-gold/40 bg-black/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold">
          <Flame className="size-2.5" /> {e.spotsLeft} left
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
            {e.restaurant}
          </p>
          <button
            type="button"
            onClick={onToggleSave}
            aria-label="Save"
            className="rounded-full border border-border bg-bg-elevated p-1.5 hover:border-gold/40"
          >
            <Bookmark
              className={cn("size-3.5", saved ? "fill-gold text-gold" : "text-white")}
            />
          </button>
        </div>
        <p className="font-serif text-xl leading-tight text-white">{e.title}</p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-3.5 text-text-muted" />
            {e.when}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Tag className="size-3.5 text-text-muted" />
            {e.price}
          </span>
        </div>
        <Button onClick={onReserve} className="mt-1 h-10 w-fit rounded-md font-semibold">
          Reserve a spot
        </Button>
      </div>
    </div>
  );
}

function MapPin({
  e,
  active,
  onClick,
}: {
  e: DemoEvent;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "absolute -translate-x-1/2 -translate-y-full rounded-full border px-3 py-1 text-xs font-medium shadow-lg transition-all",
        active
          ? "z-20 border-gold bg-gold text-black"
          : "border-gold/40 bg-bg-surface text-white hover:border-gold",
      )}
      style={{
        left: `${20 + ((e.id.charCodeAt(0) * 9) % 60)}%`,
        top: `${20 + ((e.id.charCodeAt(1) * 7) % 60)}%`,
      }}
    >
      {e.restaurant}
    </button>
  );
}

export default function DealsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    profile,
    signOut,
    canUseCustomerView,
    isCustomerView,
    switchToCustomerView,
    switchToStaffView,
    restaurantRoles,
  } = useUser();
  const { restaurants: staffRestaurants } = useStaffRestaurants(restaurantRoles);
  const { promotions, loading } = useAllActivePromotions();

  const [view, setView] = useState<"grid" | "map">("grid");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<"tonight" | "weekend" | "week" | null>(null);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<(typeof DATE_FILTERS)[number] | "Custom">("Tonight");
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]>("All Types");
  const [time, setTime] = useState("7:30 PM");
  const [partySize, setPartySize] = useState("2");
  const [activePrices, setActivePrices] = useState<Set<string>>(new Set());
  const [distanceKm, setDistanceKm] = useState(20);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const events: DemoEvent[] = useMemo(() => {
    if (promotions.length > 0) return promotions.map(adaptPromotion);
    return DEMO_EVENTS;
  }, [promotions]);

  const filtered = useMemo(() => {
    let list = events.map((e, i) => ({
      ...e,
      _price: PRICE_FOR_TYPE[e.type] ?? "$$",
      _distanceKm: 0.4 + ((i * 7) % 18) / 10,
    }));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.restaurant.toLowerCase().includes(q) ||
          e.type.toLowerCase().includes(q),
      );
    }
    if (dateFilter !== "All Dates" && dateFilter !== "Custom") {
      list = list.filter((e) => e.category === dateFilter);
    }
    if (typeFilter !== "All Types") {
      const map: Record<string, EventType[]> = {
        Events: ["Event"],
        Promotions: ["Promotion"],
        "Happy Hour": ["Happy Hour"],
        "Tasting Menu": ["Tasting Menu"],
        "Prix Fixe": ["Prix Fixe"],
        "Wine Events": ["Wine"],
        Brunch: ["Brunch"],
      };
      const allowed = map[typeFilter];
      if (allowed) list = list.filter((e) => allowed.includes(e.type));
    }
    if (activePrices.size > 0) {
      list = list.filter((e) => activePrices.has(e._price));
    }
    list = list.filter((e) => e._distanceKm <= distanceKm);
    return list;
  }, [events, search, dateFilter, typeFilter, activePrices, distanceKm]);

  const activeFilterCount =
    (dateFilter !== "Tonight" ? 1 : 0) +
    (typeFilter !== "All Types" ? 1 : 0) +
    (time !== "7:30 PM" ? 1 : 0) +
    (partySize !== "2" ? 1 : 0) +
    (activePrices.size > 0 ? 1 : 0) +
    (distanceKm !== 20 ? 1 : 0) +
    (search.trim() ? 1 : 0);

  const togglePrice = (p: string) =>
    setActivePrices((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const clearAll = () => {
    setDateFilter("Tonight");
    setCustomDate(undefined);
    setTypeFilter("All Types");
    setTime("7:30 PM");
    setPartySize("2");
    setActivePrices(new Set());
    setDistanceKm(20);
    setSearch("");
  };

  const tonight = filtered.filter((e) => e.category === "Tonight");
  const weekend = filtered.filter((e) => e.category === "This Weekend");
  const week = filtered.filter((e) => e.category === "This Week");

  const initials = (profile?.full_name ?? profile?.email ?? "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const toggleSave = (id: string) =>
    setSaved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const reserve = (e: DemoEvent) => {
    navigate(`/discover?q=${encodeURIComponent(e.restaurant)}`);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/85 backdrop-blur-xl">
        <div className="flex h-16 w-full items-center px-5 lg:px-8">
          <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="Cenaiva home">
            <span className="flex size-7 items-center justify-center rounded-md bg-gold/15">
              <span className="block size-2.5 rounded-sm bg-gold" />
            </span>
            <span className="font-serif text-xl font-semibold tracking-tight text-white">
              Cenaiva
            </span>
          </Link>

          <CustomerNav />

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <button
              type="button"
              className="relative inline-flex size-9 items-center justify-center rounded-full border border-border bg-bg-surface/70 text-text-secondary transition-colors hover:border-gold/40 hover:text-white"
              aria-label="Notifications"
            >
              <Bell className="size-4" />
              <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-gold font-mono text-[10px] font-bold text-black">
                3
              </span>
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="rounded-full outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-gold/40"
                  aria-label={t("routes.account.title")}
                >
                  <Avatar>
                    <AvatarImage src={profile?.avatar_url ?? undefined} />
                    <AvatarFallback className="bg-gold/10 text-gold">{initials}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 min-w-56">
                <DropdownMenuLabel className="truncate">
                  {profile?.full_name ?? profile?.email ?? t("routes.account.title")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void navigate("/account")}>
                  <User className="size-4" />
                  {t("routes.account.title")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void navigate("/account")}>
                  <Settings className="size-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => void signOut()}>
                  <LogOut className="size-4" />
                  {t("dashboard.shell.signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {restaurantRoles.length > 0 &&
              (staffRestaurants.length > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-transparent px-3 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-white/5">
                    <LayoutDashboard className="size-3.5" />
                    Dashboard
                    <ChevronDown className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    {staffRestaurants.map((r) => (
                      <DropdownMenuItem
                        key={r.id}
                        onClick={() => {
                          localStorage.setItem("cenaiva.selectedRestaurantId", r.id);
                          if (isCustomerView) switchToStaffView();
                          void navigate("/dashboard");
                        }}
                      >
                        <LayoutDashboard className="size-4" />
                        {r.name ?? r.slug}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  onClick={() => {
                    if (isCustomerView) switchToStaffView();
                    void navigate("/dashboard");
                  }}
                >
                  <LayoutDashboard className="size-4" />
                  Dashboard
                </Button>
              ))}

            {canUseCustomerView && !isCustomerView && (
              <Button variant="outline" size="sm" onClick={switchToCustomerView}>
                Diner view
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="w-full px-5 py-10 lg:px-8 lg:py-12">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-gold">
          <span className="inline-block h-px w-3 bg-gold/60" /> LIMITED · THIS WEEK IN TORONTO
        </span>
        <h1 className="mt-4 font-serif text-5xl leading-[1.05] text-white sm:text-6xl">
          Promotions <span className="italic text-gold">&amp;</span> Events
        </h1>
        <p className="mt-3 max-w-2xl text-base text-text-secondary">
          Tasting menus, happy hours, and chef's table experiences from restaurants
          you follow.
        </p>

        {/* Search + Filters + view toggle */}
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events, restaurants, or cuisines…"
              className="h-14 w-full rounded-2xl border border-border bg-bg-surface/70 pl-12 pr-5 text-sm text-white placeholder:text-text-muted focus:border-gold/50 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className={cn(
              "inline-flex h-14 shrink-0 items-center gap-2 rounded-2xl px-5 text-sm font-semibold transition-colors",
              activeFilterCount > 0
                ? "bg-gold text-black hover:opacity-90"
                : "border border-border bg-bg-surface/70 text-white hover:border-gold/40",
            )}
          >
            <SlidersHorizontal className="size-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-1 inline-flex size-5 items-center justify-center rounded-md bg-black/15 font-mono text-xs">
                {activeFilterCount}
              </span>
            )}
          </button>
          <div className="inline-flex h-14 shrink-0 items-center gap-1 rounded-2xl border border-border bg-bg-surface/70 p-1">
            <button
              type="button"
              onClick={() => setView("map")}
              className={cn(
                "inline-flex h-full items-center gap-1.5 rounded-xl px-4 text-sm font-medium transition-colors",
                view === "map" ? "bg-gold text-black" : "text-text-secondary hover:text-white",
              )}
            >
              <MapIcon className="size-4" /> Map
            </button>
            <button
              type="button"
              onClick={() => setView("grid")}
              className={cn(
                "inline-flex h-full items-center gap-1.5 rounded-xl px-4 text-sm font-medium transition-colors",
                view === "grid" ? "bg-gold text-black" : "text-text-secondary hover:text-white",
              )}
            >
              <LayoutGrid className="size-4" /> Grid
            </button>
          </div>
        </div>

        {/* Filters panel */}
        <AnimatePresence initial={false}>
          {filtersOpen && (
            <motion.section
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="mt-4 overflow-hidden"
            >
              <div className="rounded-2xl border border-border bg-bg-surface/40 p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="size-4 text-text-secondary" />
                    <span className="text-sm font-semibold text-white">Filters</span>
                    {activeFilterCount > 0 && (
                      <span className="rounded-md border border-gold/40 bg-gold/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gold">
                        {activeFilterCount} active
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      clearAll();
                      setFiltersOpen(false);
                    }}
                    className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-white"
                  >
                    Clear all <X className="size-3" />
                  </button>
                </div>

                <div className="mt-6 grid gap-8 lg:grid-cols-4">
                  {/* Date */}
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
                      Date
                    </p>
                    <ul className="mt-3 space-y-2">
                      {DATE_FILTERS.map((d) => (
                        <li key={d}>
                          <button
                            type="button"
                            onClick={() => setDateFilter(d)}
                            className={cn(
                              "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
                              dateFilter === d
                                ? "bg-gold text-black"
                                : "text-text-secondary hover:bg-bg-elevated hover:text-white",
                            )}
                          >
                            {d}
                            {dateFilter === d && <Check className="size-4" />}
                          </button>
                        </li>
                      ))}
                      <li>
                        <Popover
                          open={datePopoverOpen}
                          onOpenChange={setDatePopoverOpen}
                        >
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className={cn(
                                "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
                                dateFilter === "Custom"
                                  ? "bg-gold text-black"
                                  : "text-text-secondary hover:bg-bg-elevated hover:text-white",
                              )}
                            >
                              {dateFilter === "Custom" && customDate
                                ? format(customDate, "EEE · MMM d")
                                : "Pick a date…"}
                              {dateFilter === "Custom" && <Check className="size-4" />}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-auto p-0">
                            <Calendar
                              mode="single"
                              selected={customDate}
                              onSelect={(d) => {
                                if (d) {
                                  setCustomDate(d);
                                  setDateFilter("Custom");
                                }
                                setDatePopoverOpen(false);
                              }}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </li>
                    </ul>
                  </div>

                  {/* Time */}
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
                      Time
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {TIME_OPTIONS.map((tt) => (
                        <button
                          key={tt}
                          type="button"
                          onClick={() => setTime(tt)}
                          className={cn(
                            "rounded-md border px-3 py-2 text-sm transition-colors",
                            time === tt
                              ? "border-gold bg-gold/15 text-gold"
                              : "border-border bg-bg-surface text-text-secondary hover:border-gold/40",
                          )}
                        >
                          {tt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Party size + Price */}
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
                      Party size
                    </p>
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {PARTY_SIZES.map((n) => {
                        const v = String(n);
                        const active = partySize === v;
                        return (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setPartySize(v)}
                            className={cn(
                              "rounded-md border py-2 text-sm transition-colors",
                              active
                                ? "border-gold bg-gold/15 text-gold"
                                : "border-border bg-bg-surface text-text-secondary hover:border-gold/40",
                            )}
                          >
                            {v}
                          </button>
                        );
                      })}
                    </div>

                    <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
                      Price
                    </p>
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      {PRICE_OPTIONS.map((p) => {
                        const active = activePrices.has(p);
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => togglePrice(p)}
                            className={cn(
                              "rounded-md border py-2 text-sm transition-colors",
                              active
                                ? "border-gold bg-gold/15 text-gold"
                                : "border-border bg-bg-surface text-text-secondary hover:border-gold/40",
                            )}
                          >
                            {p}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Type + Distance */}
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
                      Type
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {TYPE_FILTERS.map((tf) => {
                        const active = typeFilter === tf;
                        return (
                          <button
                            key={tf}
                            type="button"
                            onClick={() => setTypeFilter(tf)}
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs transition-colors",
                              active
                                ? "border-gold bg-gold/15 text-gold"
                                : "border-border bg-bg-surface text-text-secondary hover:border-gold/40",
                            )}
                          >
                            {tf}
                          </button>
                        );
                      })}
                    </div>

                    <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
                      Distance
                    </p>
                    <div className="mt-4 px-1">
                      <input
                        type="range"
                        min={0}
                        max={20}
                        step={1}
                        value={distanceKm}
                        onChange={(e) => setDistanceKm(Number(e.target.value))}
                        className="w-full accent-gold"
                      />
                      <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-wider text-text-muted">
                        <span>0km</span>
                        <span className="text-gold">{distanceKm}km</span>
                        <span>20km</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between border-t border-border/50 pt-5">
                  <p className="text-sm">
                    <span className="font-serif text-2xl text-white">{filtered.length}</span>{" "}
                    <span className="text-text-muted">events match</span>
                  </p>
                  <Button
                    onClick={() => setFiltersOpen(false)}
                    className="h-11 rounded-md px-6 font-semibold"
                  >
                    Show results
                  </Button>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Filter chips row */}
        <div id="deals-filter-chips" className="mt-6 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {DATE_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setDateFilter(f)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm transition-colors",
                  dateFilter === f
                    ? "border-gold bg-gold text-black"
                    : "border-border bg-bg-surface text-text-secondary hover:border-gold/40 hover:text-white",
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <span className="hidden h-6 w-px bg-border sm:inline-block" />
          <div className="flex flex-wrap items-center gap-2">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setTypeFilter(f)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm transition-colors",
                  typeFilter === f
                    ? "border-gold/60 bg-gold/15 text-gold"
                    : "border-border bg-bg-surface text-text-secondary hover:border-gold/40 hover:text-white",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-[420px] animate-pulse rounded-2xl border border-border bg-bg-surface"
              />
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && filtered.length === 0 && (
          <div className="mt-16 flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-gold/10">
              <Tag className="size-6 text-gold" />
            </div>
            <p className="font-serif text-2xl text-white">Nothing on right now.</p>
            <p className="text-sm text-text-muted">Try a different date or type.</p>
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => {
                setDateFilter("All Dates");
                setTypeFilter("All Types");
                setSearch("");
              }}
            >
              Show everything
            </Button>
          </div>
        )}

        {/* Grid view */}
        {!loading && filtered.length > 0 && view === "grid" && (() => {
          const rows = [
            {
              key: "tonight" as const,
              eyebrow: "Right now",
              title: "Available tonight",
              sub: "Walk-in distance, last-minute spots, late-service deals.",
              pool: tonight,
            },
            {
              key: "weekend" as const,
              eyebrow: "Curated",
              title: "Worth the weekend",
              sub: undefined,
              pool: weekend,
            },
            {
              key: "week" as const,
              eyebrow: "This week",
              title: "On the calendar",
              sub: undefined,
              pool: week,
            },
          ].filter((r) => r.pool.length > 0);
          const visible = expandedRow ? rows.filter((r) => r.key === expandedRow) : rows;

          return (
            <div className="mt-12 space-y-16">
              {expandedRow && (
                <button
                  type="button"
                  onClick={() => setExpandedRow(null)}
                  className="-mb-12 inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-white"
                >
                  <ArrowLeft className="size-4" /> Back to all curated lists
                </button>
              )}
              {visible.map((row) => {
                const isExpanded = expandedRow === row.key;
                const items = isExpanded ? row.pool : row.pool.slice(0, 4);
                return (
                  <section key={row.key}>
                    <div className="flex items-end justify-between gap-6">
                      <div>
                        <SectionEyebrow>{row.eyebrow}</SectionEyebrow>
                        <h2 className="mt-3 font-serif text-3xl text-white sm:text-4xl">
                          {row.title}
                        </h2>
                        {row.sub && (
                          <p className="mt-2 text-sm text-text-muted">{row.sub}</p>
                        )}
                      </div>
                      {!isExpanded && row.pool.length > 4 && (
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedRow(row.key);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                          className="hidden items-center gap-1 text-sm text-gold hover:underline sm:inline-flex"
                        >
                          See all {row.pool.length}
                          <ArrowRight className="size-4" />
                        </button>
                      )}
                    </div>
                    <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {items.map((e) => (
                        <EventCard
                          key={e.id}
                          e={e}
                          saved={saved.has(e.id)}
                          onToggleSave={() => toggleSave(e.id)}
                          onReserve={() => reserve(e)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          );
        })()}

        {/* Map view */}
        {!loading && filtered.length > 0 && view === "map" && (
          <div className="mt-10 grid gap-6 lg:h-[calc(100vh-8rem)] lg:min-h-[560px] lg:grid-cols-[minmax(0,1.25fr)_minmax(420px,1fr)] lg:overflow-hidden">
            <div className="min-h-0 lg:flex lg:flex-col">
              <p className="text-sm text-text-secondary">
                <span className="font-serif text-xl text-white">{filtered.length}</span> events
                · sorted by <span className="text-gold">Tonight first</span>
              </p>
              <div className="mt-4 space-y-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2 lg:scrollbar-thin">
                {filtered.map((e) => (
                  <ListEventCard
                    key={e.id}
                    e={e}
                    saved={saved.has(e.id)}
                    onToggleSave={() => toggleSave(e.id)}
                    onReserve={() => reserve(e)}
                    onHover={(id) => {
                      setHoveredId(id);
                      if (id) setSelectedId(id);
                    }}
                    highlighted={hoveredId === e.id || selectedId === e.id}
                  />
                ))}
              </div>
            </div>

            <div className="lg:h-full lg:min-h-0">
              <div
                className="relative h-[560px] overflow-hidden rounded-2xl border border-border lg:h-full"
                style={{
                  backgroundImage:
                    "radial-gradient(circle at 30% 30%, rgba(201,168,76,0.08) 0%, transparent 40%), radial-gradient(circle at 70% 70%, rgba(201,168,76,0.05) 0%, transparent 50%), linear-gradient(180deg, #0a0a0a 0%, #1a1a1a 100%)",
                }}
              >
                <div
                  className="absolute inset-0 opacity-30"
                  style={{
                    backgroundImage:
                      "linear-gradient(rgba(201,168,76,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(201,168,76,0.06) 1px, transparent 1px)",
                    backgroundSize: "48px 48px",
                  }}
                />
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                  <div className="size-4 rounded-full bg-blue-500 ring-4 ring-blue-500/30" />
                </div>

                {filtered.slice(0, 12).map((e) => (
                  <MapPin
                    key={e.id}
                    e={e}
                    active={hoveredId === e.id || selectedId === e.id}
                    onClick={() => setSelectedId(e.id)}
                  />
                ))}

                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-surface/90 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:border-gold/40"
                >
                  <LocateFixed className="size-3.5 text-gold" />
                  Re-center
                </button>

                <div className="absolute right-4 top-4 flex flex-col gap-1">
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-md border border-border bg-bg-surface/90 text-white hover:border-gold/40"
                    aria-label="Zoom in"
                  >
                    <Plus className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="flex size-8 items-center justify-center rounded-md border border-border bg-bg-surface/90 text-white hover:border-gold/40"
                    aria-label="Zoom out"
                  >
                    <Minus className="size-4" />
                  </button>
                </div>

                {selectedId &&
                  (() => {
                    const e = filtered.find((x) => x.id === selectedId);
                    if (!e) return null;
                    return (
                      <div className="absolute bottom-4 left-4 right-20 max-w-md rounded-2xl border border-border bg-bg-surface/95 p-3 shadow-2xl shadow-black/40 backdrop-blur">
                        <div className="flex gap-3">
                          <div className="size-20 shrink-0 overflow-hidden rounded-xl">
                            <StripePlaceholder label={e.initials} className="aspect-square" />
                          </div>
                          <div className="flex-1">
                            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                              {e.restaurant}
                            </p>
                            <p className="font-serif text-lg leading-tight text-white">
                              {e.title}
                            </p>
                            <p className="mt-1 text-xs text-text-secondary">
                              {e.when} · <span className="text-gold">{e.price}</span>
                            </p>
                            <Button
                              size="sm"
                              onClick={() => reserve(e)}
                              className="mt-2 h-8 rounded-md font-semibold"
                            >
                              Reserve
                            </Button>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedId(null)}
                            className="self-start rounded-full p-1 text-text-muted hover:text-white"
                            aria-label="Close"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })()}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
