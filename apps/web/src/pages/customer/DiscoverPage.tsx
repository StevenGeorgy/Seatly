import { useEffect, useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Map as MapIcon,
  LayoutGrid,
  SlidersHorizontal,
  X,
  Check,
  Heart,
  Bell,
  ArrowLeft,
  ArrowRight,
  Plus,
  LocateFixed,
  LogOut,
  User,
  Settings,
} from "lucide-react";

import { useUser } from "@/hooks/useUser";
import { useMyStaffInvites } from "@/hooks/useMyStaffInvites";
import { useNotifications } from "@/hooks/useNotifications";
import { usePublicRestaurants, type Restaurant } from "@/hooks/useRestaurant";
import { useRestaurantPreviewStatsByRestaurantIds } from "@/hooks/useRestaurantPreviewStats";
import { useStaffRestaurants } from "@/hooks/useStaffRestaurants";
import { CustomerNav } from "@/components/customer/CustomerNav";
import { RestaurantPreviewModal } from "@/components/customer/RestaurantPreviewModal";
import { RestaurantPriceMeter } from "@/components/customer/RestaurantPriceMeter";
import { StaffWorkspaceMenuItems } from "@/components/customer/StaffWorkspaceMenuItems";
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
import { normalizeRestaurantPriceLevel, restaurantPriceLabelFromRange, type RestaurantPriceLevel } from "@/lib/restaurant-price-level";
import { normalizeRestaurantDietaryTags, type RestaurantDietaryTag } from "@/lib/restaurant-dietary-tags";
import { formatCompactTimeLabel } from "@/lib/utils/time";

function datePresetOptions() {
  const today = new Date();
  const tomorrow = addDays(today, 1);
  const saturday = addDays(today, (6 - today.getDay() + 7) % 7 || 7);
  return [
    { id: "today", label: `Today · ${format(today, "MMM d")}` },
    { id: "tomorrow", label: `Tomorrow · ${format(tomorrow, "MMM d")}` },
    { id: "sat", label: `${format(saturday, "EEE")} · ${format(saturday, "MMM d")}` },
    { id: "custom", label: "Pick a date…" },
  ];
}

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

const PRICE_OPTIONS = ["$", "$$", "$$$"];

const FEATURE_OPTIONS = ["Vegetarian", "Vegan", "Gluten-free", "Halal", "Kosher", "Walk-ins accepted"];

const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, "8+"] as const;

type RestaurantCard = {
  id: string;
  slug?: string;
  name: string;
  cuisine: string;
  price: string;
  priceLevel: RestaurantPriceLevel | null;
  area: string;
  bookedToday: number;
  slots: string[];
  initials: string;
  badge: string;
  city: string;
  features: string[];
  dietaryTags: RestaurantDietaryTag[];
  logoUrl: string | null;
  coverPhotoUrl: string | null;
  acceptsWalkins: boolean;
  lat: number | null;
  lng: number | null;
};

function priceFromRange(range: number | null | undefined): string {
  return restaurantPriceLabelFromRange(range);
}

function adaptRestaurant(r: Restaurant, bookedToday: number): RestaurantCard {
  const initials = (r.name || "?").split(/\s+/).slice(0, 2).join(" ").toUpperCase();
  const dietaryTags = normalizeRestaurantDietaryTags(r.settings_json?.dietaryTags);
  const features = [
    r.cuisine_type,
    r.business_type,
    r.accepts_walkins === false ? null : "Walk-ins accepted",
    ...dietaryTags.map((tag) => tag.replace(/_/g, "-")),
  ].filter(Boolean) as string[];
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    cuisine: r.cuisine_type ?? "",
    price: priceFromRange(r.price_range),
    priceLevel: normalizeRestaurantPriceLevel(r.price_range),
    area: r.city ?? r.address ?? "",
    bookedToday,
    slots: [],
    initials,
    badge: r.business_type ?? "",
    city: r.city ?? "",
    features,
    dietaryTags,
    logoUrl: r.logo_url,
    coverPhotoUrl: r.cover_photo_url,
    acceptsWalkins: r.accepts_walkins !== false,
    lat: r.lat,
    lng: r.lng,
  };
}

function dateParamFromSelection(dateId: string, customDate: Date | undefined): string {
  if (dateId === "custom" && customDate) return format(customDate, "yyyy-MM-dd");
  const today = new Date();
  if (dateId === "tomorrow") return format(addDays(today, 1), "yyyy-MM-dd");
  if (dateId === "sat") return format(addDays(today, (6 - today.getDay() + 7) % 7 || 7), "yyyy-MM-dd");
  return format(today, "yyyy-MM-dd");
}

function RestaurantCardImage({
  restaurant,
  className,
  logoClassName,
}: {
  restaurant: RestaurantCard;
  className?: string;
  logoClassName?: string;
}) {
  return (
    <div className={cn("relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-bg-elevated", className)}>
      {restaurant.coverPhotoUrl ? (
        <img
          src={restaurant.coverPhotoUrl}
          alt={`${restaurant.name} cover`}
          className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-gold/15 via-bg-elevated to-bg-base" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/20 to-bg-base/80" />
      <div className={cn("relative flex size-14 items-center justify-center overflow-hidden rounded-2xl border border-gold/30 bg-bg-elevated font-mono text-xs font-semibold text-gold shadow-lg shadow-black/30", logoClassName)}>
        {restaurant.logoUrl ? (
          <img src={restaurant.logoUrl} alt={`${restaurant.name} logo`} className="size-full object-cover" />
        ) : (
          restaurant.initials
        )}
      </div>
    </div>
  );
}

function BadgeChip({ label }: { label: string }) {
  return (
    <span className="rounded-md border border-border bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-gold backdrop-blur">
      {label}
    </span>
  );
}

function DietaryTagChip({ tag }: { tag: RestaurantDietaryTag }) {
  const { t } = useTranslation();
  return (
    <span className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[11px] text-gold">
      {t(`restaurantDietaryTags.${tag}`)}
    </span>
  );
}

function FavoriteButton({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className="rounded-full border border-border bg-black/60 p-1.5 backdrop-blur transition-colors hover:border-gold/50"
      aria-label="Save restaurant"
    >
      <Heart className={cn("size-4", active ? "fill-gold text-gold" : "text-white")} />
    </button>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-gold">
      <span className="inline-block h-px w-3 bg-gold/60" /> {children}
    </span>
  );
}

function GridCard({
  r,
  favorite,
  onToggleFav,
  onOpen,
}: {
  r: RestaurantCard;
  favorite: boolean;
  onToggleFav: () => void;
  onOpen: () => void;
}) {
  return (
    <motion.div
      role="button"
      tabIndex={0}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.4 }}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-border bg-bg-surface transition-colors hover:border-gold/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
    >
      <div className="relative">
        <RestaurantCardImage restaurant={r} className="aspect-auto h-44 sm:h-48 xl:h-52" />
        {r.badge ? (
          <div className="absolute left-3 top-3">
            <BadgeChip label={r.badge} />
          </div>
        ) : null}
        <div className="absolute right-3 top-3">
          <FavoriteButton active={favorite} onToggle={onToggleFav} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <p className="font-serif text-xl text-white">{r.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <RestaurantPriceMeter level={r.priceLevel} />
          {r.cuisine ? <span>{r.cuisine}</span> : null}
          {r.area ? <span>{r.area}</span> : null}
        </div>
        {r.dietaryTags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {r.dietaryTags.slice(0, 2).map((tag) => <DietaryTagChip key={tag} tag={tag} />)}
          </div>
        ) : null}
        <div className="mt-auto pt-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            className="inline-flex items-center justify-center rounded-md border border-gold/30 bg-gold/10 px-4 py-2 text-xs font-semibold text-gold hover:bg-gold/20"
          >
            View preview
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function MapListCard({
  r,
  favorite,
  onToggleFav,
  onHover,
  highlighted,
  onOpen,
}: {
  r: RestaurantCard;
  favorite: boolean;
  onToggleFav: () => void;
  onHover: (id: string | null) => void;
  highlighted: boolean;
  onOpen: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onMouseEnter={() => onHover(r.id)}
      onMouseLeave={() => onHover(null)}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "flex cursor-pointer gap-4 rounded-2xl border bg-bg-surface/40 p-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
        highlighted ? "border-gold/60" : "border-border hover:border-gold/30",
      )}
    >
      <div className="relative w-40 shrink-0 overflow-hidden rounded-xl">
        <RestaurantCardImage restaurant={r} className="aspect-square" logoClassName="size-12" />
        {r.badge ? (
          <div className="absolute left-2 top-2">
            <BadgeChip label={r.badge} />
          </div>
        ) : null}
        <div className="absolute right-2 top-2">
          <FavoriteButton active={favorite} onToggle={onToggleFav} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <p className="font-serif text-xl text-white">{r.name}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <RestaurantPriceMeter level={r.priceLevel} />
          {r.cuisine ? <span>{r.cuisine}</span> : null}
          {r.area ? <span>{r.area}</span> : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {r.dietaryTags.slice(0, 2).map((tag) => <DietaryTagChip key={tag} tag={tag} />)}
          {r.features.slice(0, 3).map((f) => (
            <span
              key={f}
              className="rounded-full border border-border bg-bg-elevated px-2 py-0.5 text-[11px] text-text-secondary"
            >
              {f}
            </span>
          ))}
        </div>
        <p className="text-xs text-text-muted">
          {r.acceptsWalkins ? "Walk-ins accepted when available" : "Reservations only"}
        </p>
      </div>
    </div>
  );
}

function MapPin({
  r,
  active,
  onClick,
}: {
  r: RestaurantCard;
  active: boolean;
  onClick: () => void;
}) {
  if (r.lat == null || r.lng == null) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "absolute -translate-x-1/2 -translate-y-full rounded-full border px-3 py-1 text-xs font-medium shadow-lg transition-all",
        active
          ? "z-20 border-gold bg-gold text-black shadow-gold/40"
          : "border-gold/40 bg-bg-surface text-white hover:border-gold",
      )}
      style={{ left: `${Math.max(8, Math.min(92, 50 + r.lng))}%`, top: `${Math.max(8, Math.min(92, 50 - r.lat))}%` }}
    >
      {r.name} <span className={active ? "text-black/70" : "text-gold"}>{r.price}</span>
    </button>
  );
}

export default function DiscoverPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    profile,
    signOut,
    restaurantRoles,
  } = useUser();
  const { restaurants: staffRestaurants } = useStaffRestaurants(restaurantRoles);
  const { restaurants, loading } = usePublicRestaurants();
  const { notifications, unreadCount, markRead } = useNotifications();
  const { invites: pendingStaffInvites } = useMyStaffInvites();

  const [view, setView] = useState<"grid" | "map">("grid");
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [dateId, setDateId] = useState("today");
  const [time, setTime] = useState(searchParams.get("time") ?? "7:30 PM");
  const [partySize, setPartySize] = useState<string>(
    searchParams.get("people") ?? "2",
  );
  const [activePrices, setActivePrices] = useState<Set<string>>(new Set());
  const [activeFeatures, setActiveFeatures] = useState<Set<string>>(new Set());
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewRestaurant, setPreviewRestaurant] = useState<RestaurantCard | null>(null);
  const previewParam = searchParams.get("preview");
  const previewSource = searchParams.get("from");
  const restaurantIds = useMemo(() => restaurants.map((restaurant) => restaurant.id), [restaurants]);
  const { statsByRestaurantId } = useRestaurantPreviewStatsByRestaurantIds(restaurantIds);
  const datePresets = useMemo(() => datePresetOptions(), []);

  const cards: RestaurantCard[] = useMemo(() => {
    return restaurants.map((restaurant) => adaptRestaurant(
      restaurant,
      statsByRestaurantId[restaurant.id]?.bookedToday ?? 0,
    ));
  }, [restaurants, statsByRestaurantId]);

  const filtered = useMemo(() => {
    let list = cards;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.cuisine.toLowerCase().includes(q) ||
          r.area.toLowerCase().includes(q),
      );
    }
    if (activePrices.size > 0) {
      list = list.filter((r) => activePrices.has(r.price));
    }
    if (activeFeatures.size > 0) {
      list = list.filter((r) => r.features.some((feature) => activeFeatures.has(feature)));
    }
    return list;
  }, [cards, search, activePrices, activeFeatures]);

  const urlPreviewRestaurant = useMemo(() => {
    if (!previewParam) return null;
    return cards.find((r) => r.id === previewParam || r.slug === previewParam) ?? null;
  }, [cards, previewParam]);

  const activePreviewRestaurant = previewRestaurant ?? urlPreviewRestaurant;
  const isDashboardPreview = previewSource === "dashboard" && !!urlPreviewRestaurant;

  const activeFilterCount =
    (activePrices.size > 0 ? 1 : 0) +
    (activeFeatures.size > 0 ? 1 : 0) +
    (dateId !== "today" ? 1 : 0) +
    (time !== "7:30 PM" ? 1 : 0);

  const togglePrice = (p: string) =>
    setActivePrices((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const toggleFeature = (f: string) =>
    setActiveFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  const toggleFavorite = (id: string) =>
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clearAll = () => {
    setDateId("today");
    setCustomDate(undefined);
    setTime("7:30 PM");
    setPartySize("2");
    setActivePrices(new Set());
    setActiveFeatures(new Set());
  };

  const handleSlotClick = (
    r: RestaurantCard,
    slot: string,
    selectedPartySize = partySize,
    shiftId?: string,
    displayTime?: string,
  ) => {
    const backQuery = isDashboardPreview ? "&back=dashboard" : "";
    const slotDate = /^\d{4}-\d{2}-\d{2}T/.test(slot)
      ? slot.slice(0, 10)
      : dateParamFromSelection(dateId, customDate);
    const shiftQuery = shiftId ? `&shift_id=${encodeURIComponent(shiftId)}` : "";
    const timeParam = displayTime ? formatCompactTimeLabel(displayTime) : formatCompactTimeLabel(slot);
    navigate(
      `/${r.slug ?? r.id}?slot=${encodeURIComponent(slot)}&time=${encodeURIComponent(timeParam)}&people=${selectedPartySize}&date=${encodeURIComponent(slotDate)}${shiftQuery}${backQuery}`,
    );
  };

  const openRestaurantPreview = (r: RestaurantCard) => {
    setPreviewRestaurant(r);
  };

  const initials = (profile?.full_name ?? profile?.email ?? "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // Cmd/Ctrl-K focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const el = document.getElementById("discover-search") as HTMLInputElement | null;
        el?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const featured = filtered.slice(0, 4);
  const dateNight = filtered.slice(4, 8).length === 4 ? filtered.slice(4, 8) : filtered.slice(0, 4);
  const newOnCenaiva =
    filtered.slice(8, 12).length === 4 ? filtered.slice(8, 12) : filtered.slice(-4);

  const greetingName = profile?.full_name?.split(" ")[0] ?? "guest";

  const today = new Date();
  const headerEyebrow = `${today.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase()} · ${today
    .toLocaleDateString("en-US", { month: "long", day: "numeric" })
    .toUpperCase()} · TORONTO`;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-[1320px] items-center px-5 lg:px-8">
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
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="relative inline-flex size-9 items-center justify-center rounded-full border border-border bg-bg-surface/70 text-text-secondary transition-colors hover:border-gold/40 hover:text-white"
                  aria-label="Notifications"
                >
                  <Bell className="size-4" />
                  {unreadCount + pendingStaffInvites.length > 0 ? (
                    <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-gold font-mono text-[10px] font-bold text-black">
                      {Math.min(unreadCount + pendingStaffInvites.length, 9)}
                    </span>
                  ) : null}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 border-border bg-bg-elevated p-0 text-text-primary">
                <div className="border-b border-border px-4 py-3">
                  <p className="font-serif text-lg text-white">Notifications</p>
                  <p className="text-xs text-text-muted">Invites and account updates</p>
                </div>
                <div className="max-h-80 overflow-y-auto p-2">
                  {pendingStaffInvites.map((invite) => (
                    <button
                      key={invite.id}
                      type="button"
                      onClick={() => void navigate(`/accept-invite?token=${encodeURIComponent(invite.token)}`)}
                      className="w-full rounded-lg px-3 py-3 text-left transition-colors hover:bg-bg-surface"
                    >
                      <p className="text-sm font-medium text-white">Staff invite</p>
                      <p className="mt-1 text-xs text-text-secondary">
                        Join {invite.restaurant_name} as {invite.role}.
                      </p>
                    </button>
                  ))}
                  {notifications.map((notification) => (
                    <button
                      key={notification.id}
                      type="button"
                      onClick={() => {
                        void markRead(notification.id);
                        const route = notification.data?.route;
                        if (typeof route === "string") void navigate(route);
                      }}
                      className="w-full rounded-lg px-3 py-3 text-left transition-colors hover:bg-bg-surface"
                    >
                      <p className="text-sm font-medium text-white">{notification.title}</p>
                      {notification.body ? (
                        <p className="mt-1 text-xs text-text-secondary">{notification.body}</p>
                      ) : null}
                    </button>
                  ))}
                  {pendingStaffInvites.length === 0 && notifications.length === 0 ? (
                    <p className="px-3 py-6 text-center text-xs text-text-muted">No notifications yet.</p>
                  ) : null}
                </div>
              </PopoverContent>
            </Popover>

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
                <DropdownMenuItem onClick={() => void navigate("/setup")}>
                  <Plus className="size-4" />
                  {t("dashboard.shell.setupRestaurant")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void navigate("/account")}>
                  <Settings className="size-4" />
                  Settings
                </DropdownMenuItem>
                <StaffWorkspaceMenuItems
                  restaurants={staffRestaurants}
                  restaurantRoles={restaurantRoles}
                />
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => void signOut()}>
                  <LogOut className="size-4" />
                  {t("dashboard.shell.signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1320px] px-5 py-10 lg:px-8 lg:py-12">
        {/* Greeting */}
        <SectionEyebrow>{headerEyebrow}</SectionEyebrow>
        <h1 className="mt-4 font-serif text-5xl leading-[1.05] text-white sm:text-6xl">
          Good evening, <span className="capitalize">{greetingName}</span>.
        </h1>
        <p className="mt-3 text-base text-text-secondary">
          {filtered.length} restaurant{filtered.length === 1 ? "" : "s"} available from Cenaiva.
        </p>

        {/* Search bar + view toggle */}
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <input
              id="discover-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search restaurants, cuisines, neighbourhoods, or dishes…"
              className="h-14 w-full rounded-2xl border border-border bg-bg-surface/70 pl-12 pr-20 text-sm text-white placeholder:text-text-muted focus:border-gold/50 focus:outline-none"
            />
            <kbd className="absolute right-5 top-1/2 -translate-y-1/2 rounded-md border border-border bg-bg-elevated px-2 py-0.5 font-mono text-[11px] text-text-muted">
              ⌘K
            </kbd>
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
                view === "map"
                  ? "bg-gold text-black"
                  : "text-text-secondary hover:text-white",
              )}
            >
              <MapIcon className="size-4" /> Map
            </button>
            <button
              type="button"
              onClick={() => setView("grid")}
              className={cn(
                "inline-flex h-full items-center gap-1.5 rounded-xl px-4 text-sm font-medium transition-colors",
                view === "grid"
                  ? "bg-gold text-black"
                  : "text-text-secondary hover:text-white",
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
                      {datePresets.map((p) => {
                        const active = dateId === p.id;
                        const isCustom = p.id === "custom";
                        const label =
                          isCustom && customDate
                            ? format(customDate, "EEE · MMM d")
                            : p.label;
                        if (isCustom) {
                          return (
                            <li key={p.id}>
                              <Popover
                                open={datePopoverOpen}
                                onOpenChange={setDatePopoverOpen}
                              >
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    className={cn(
                                      "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
                                      active
                                        ? "bg-gold text-black"
                                        : "text-text-secondary hover:bg-bg-elevated hover:text-white",
                                    )}
                                  >
                                    {label}
                                    {active && <Check className="size-4" />}
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent
                                  align="start"
                                  className="w-auto p-0"
                                >
                                  <Calendar
                                    mode="single"
                                    selected={customDate}
                                    onSelect={(d) => {
                                      if (d) {
                                        setCustomDate(d);
                                        setDateId("custom");
                                      }
                                      setDatePopoverOpen(false);
                                    }}
                                    initialFocus
                                  />
                                </PopoverContent>
                              </Popover>
                            </li>
                          );
                        }
                        return (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => setDateId(p.id)}
                              className={cn(
                                "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
                                active
                                  ? "bg-gold text-black"
                                  : "text-text-secondary hover:bg-bg-elevated hover:text-white",
                              )}
                            >
                              {label}
                              {active && <Check className="size-4" />}
                            </button>
                          </li>
                        );
                      })}
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
                          {formatCompactTimeLabel(tt)}
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

                  {/* Features */}
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
                      Features
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {FEATURE_OPTIONS.map((f) => {
                        const active = activeFeatures.has(f);
                        return (
                          <button
                            key={f}
                            type="button"
                            onClick={() => toggleFeature(f)}
                            className={cn(
                              "rounded-full border px-3 py-1 text-xs transition-colors",
                              active
                                ? "border-gold bg-gold/15 text-gold"
                                : "border-border bg-bg-surface text-text-secondary hover:border-gold/40",
                            )}
                          >
                            {f}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between border-t border-border/50 pt-5">
                  <p className="text-sm">
                    <span className="font-serif text-2xl text-white">{filtered.length}</span>{" "}
                    <span className="text-text-muted">restaurants match</span>
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
              <Search className="size-6 text-gold" />
            </div>
            <p className="font-serif text-2xl text-white">Nothing matches that.</p>
            <p className="text-sm text-text-muted">Try a different search or relax a filter.</p>
            <Button variant="outline" className="mt-3" onClick={clearAll}>
              Clear all filters
            </Button>
          </div>
        )}

        {/* Grid view */}
        {!loading && filtered.length > 0 && view === "grid" && (() => {
          const rows = [
            { key: "available", eyebrow: "Curated", title: "Available tonight near you", pool: filtered, preview: featured },
            { key: "date-night", eyebrow: "Curated", title: "Date night picks", pool: filtered, preview: dateNight },
            { key: "new", eyebrow: "Curated", title: "New on Cenaiva", pool: filtered, preview: newOnCenaiva },
          ];
          const visible = expandedRow
            ? rows.filter((r) => r.key === expandedRow)
            : rows;

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
                const items = isExpanded ? row.pool : row.preview;
                return (
                  <section key={row.title}>
                    <div className="flex items-end justify-between gap-6">
                      <div>
                        <SectionEyebrow>{row.eyebrow}</SectionEyebrow>
                        <h2 className="mt-3 font-serif text-3xl text-white sm:text-4xl">
                          {row.title}
                        </h2>
                      </div>
                      {!isExpanded && row.pool.length > row.preview.length && (
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
                      {items.map((r) => (
                        <GridCard
                          key={r.id + row.title}
                          r={r}
                          favorite={favorites.has(r.id)}
                          onToggleFav={() => toggleFavorite(r.id)}
                          onOpen={() => openRestaurantPreview(r)}
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
              <div className="flex items-center justify-between">
                <p className="text-sm text-text-secondary">
                  <span className="font-serif text-xl text-white">{filtered.length}</span>{" "}
                  restaurants · sorted by <span className="text-gold">Best match</span>
                </p>
                <p className="hidden text-xs text-text-muted sm:block">Hover to highlight on map</p>
              </div>
              <div className="mt-4 space-y-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2 lg:scrollbar-thin">
                {filtered.map((r) => (
                  <MapListCard
                    key={r.id}
                    r={r}
                    favorite={favorites.has(r.id)}
                    onToggleFav={() => toggleFavorite(r.id)}
                    onHover={(id) => {
                      setHoveredId(id);
                      if (id) setSelectedId(id);
                    }}
                    highlighted={hoveredId === r.id || selectedId === r.id}
                    onOpen={() => openRestaurantPreview(r)}
                  />
                ))}
              </div>
            </div>

            {/* Map area */}
            <div className="lg:h-full lg:min-h-0">
              <div className="relative h-[560px] overflow-hidden rounded-2xl border border-border bg-bg-surface lg:h-full">
                {/* faint grid */}
                <div className="absolute inset-0 bg-gold/5" />

                {/* you-are-here pulse */}
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                  <div className="size-4 rounded-full bg-blue-500 ring-4 ring-blue-500/30" />
                </div>

                {filtered.filter((r) => r.lat != null && r.lng != null).slice(0, 12).map((r) => (
                  <MapPin
                    key={r.id}
                    r={r}
                    active={hoveredId === r.id || selectedId === r.id}
                    onClick={() => setSelectedId(r.id)}
                  />
                ))}

                {/* Re-center */}
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-surface/90 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:border-gold/40"
                >
                  <LocateFixed className="size-3.5 text-gold" />
                  Re-center
                </button>

                {/* Selected restaurant card */}
                {selectedId &&
                  (() => {
                    const r = filtered.find((x) => x.id === selectedId);
                    if (!r) return null;
                    return (
                      <div className="absolute bottom-12 left-4 right-20 max-w-md rounded-2xl border border-border bg-bg-surface/95 p-3 shadow-2xl shadow-black/40 backdrop-blur">
                        <div className="flex gap-3">
                          <div className="size-20 shrink-0 overflow-hidden rounded-xl">
                            <RestaurantCardImage restaurant={r} className="aspect-square" logoClassName="size-10" />
                          </div>
                          <div className="flex-1">
                            <p className="font-serif text-lg text-white">{r.name}</p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                              <RestaurantPriceMeter level={r.priceLevel} />
                              {r.cuisine ? <span>{r.cuisine}</span> : null}
                            </div>
                            {r.dietaryTags.length > 0 ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {r.dietaryTags.slice(0, 2).map((tag) => <DietaryTagChip key={tag} tag={tag} />)}
                              </div>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => openRestaurantPreview(r)}
                              className="mt-2 rounded-md bg-gold px-2.5 py-1 text-[11px] font-semibold text-black hover:opacity-90"
                            >
                              View preview
                            </button>
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
      <RestaurantPreviewModal
        restaurant={activePreviewRestaurant}
        favorite={activePreviewRestaurant ? favorites.has(activePreviewRestaurant.id) : false}
        partySize={partySize}
        bookingDate={dateParamFromSelection(dateId, customDate)}
        preferredTime={time}
        onClose={() => {
          if (isDashboardPreview) {
            navigate("/dashboard");
            return;
          }
          setPreviewRestaurant(null);
        }}
        onToggleFavorite={() => {
          if (activePreviewRestaurant) toggleFavorite(activePreviewRestaurant.id);
        }}
        onReserve={(slot, selectedPartySize, shiftId, displayTime) => {
          if (activePreviewRestaurant) {
            setPartySize(selectedPartySize);
            handleSlotClick(activePreviewRestaurant, slot, selectedPartySize, shiftId, displayTime);
          }
        }}
      />
    </div>
  );
}
