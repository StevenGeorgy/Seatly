import { useEffect, useMemo, useRef, useState } from "react";
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
  Heart,
  Bookmark,
  Bell,
  ArrowLeft,
  ArrowRight,
  Plus,
  LocateFixed,
  LogOut,
  User,
  Settings,
  CalendarDays,
  Clock,
  Users,
} from "lucide-react";

import { useUser } from "@/hooks/useUser";
import { useMyReservations } from "@/hooks/useMyReservations";
import { useMyStaffInvites } from "@/hooks/useMyStaffInvites";
import { useNotifications } from "@/hooks/useNotifications";
import { usePublicRestaurants, type Restaurant } from "@/hooks/useRestaurant";
import { useRestaurantPreviewStatsByRestaurantIds } from "@/hooks/useRestaurantPreviewStats";
import { fetchAvailabilitySlots, type AvailabilitySlot } from "@/hooks/useAvailability";
import { useRestaurantPrefetch } from "@/lib/prefetch";
import { useStaffRestaurants } from "@/hooks/useStaffRestaurants";
import { useAssistant } from "@/components/cenaiva/AssistantProvider";
import { buildWakeGreeting } from "@/lib/cenaiva/buildWakeGreeting";
import { CenaivaWordmark } from "@/components/brand/CenaivaWordmark";
import { CustomerNav } from "@/components/customer/CustomerNav";
import { RestaurantPreviewModal } from "@/components/customer/RestaurantPreviewModal";
import { NotifyMeButton } from "@/components/customer/NotifyMeButton";
import { RestaurantPriceMeter } from "@/components/customer/RestaurantPriceMeter";
import { ScrollWheelPicker } from "@/components/customer/ScrollWheelPicker";
import { StaffWorkspaceMenuItems } from "@/components/customer/StaffWorkspaceMenuItems";
import {
  fetchDisplayAvailabilitySlots,
  fetchDisplayAvailabilitySlotsForRestaurants,
  normalizePartySize,
} from "@/lib/customer/availabilityFilters";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DiscoverReviewBanner } from "@/components/customer/DiscoverReviewBanner";
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
import { cn, capitalizeWords } from "@/lib/utils";
import { normalizeRestaurantPriceLevel, restaurantPriceLabelFromRange, type RestaurantPriceLevel } from "@/lib/restaurant-price-level";
import { normalizeRestaurantDietaryTags, type RestaurantDietaryTag } from "@/lib/restaurant-dietary-tags";
import { formatCompactTimeLabel } from "@/lib/utils/time";
import {
  CENAIVA_MAP_STYLES,
  hasGoogleMapsApiKey,
  loadGoogleMaps,
  type GoogleMapsMarker,
  type GoogleMapsNamespace,
} from "@/lib/google-maps";
import { MarkerClusterer, type Cluster, type Renderer } from "@googlemaps/markerclusterer";

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

function formatTimeOption(hours24: number, minutes: number): string {
  const period = hours24 >= 12 ? "PM" : "AM";
  const display = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${display}:${minutes === 0 ? "00" : "30"} ${period}`;
}

const TIME_OPTIONS = (() => {
  const out: string[] = [];
  for (let h = 6; h < 24; h += 1) {
    for (const m of [0, 30] as const) out.push(formatTimeOption(h, m));
  }
  return out;
})();

function getNearestUpcomingHalfHour(): string {
  const now = new Date();
  let h = now.getHours();
  let m = now.getMinutes();
  if (m === 0 || m === 30) {
    // exact slot — keep
  } else if (m < 30) {
    m = 30;
  } else {
    h = (h + 1) % 24;
    m = 0;
  }
  if (h < 6) {
    h = 6;
    m = 0;
  }
  return formatTimeOption(h, m);
}

const PRICE_OPTIONS = ["$", "$$", "$$$"];

const FEATURE_OPTIONS = [
  "Vegetarian",
  "Vegan",
  "Gluten-free",
  "Dairy-free",
  "Nut-free",
  "Halal",
  "Kosher",
  "Walk-ins accepted",
];

const PARTY_SIZES = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, "Large group",
] as const;

const RADIUS_OPTIONS = (() => {
  const steps: (number | "anywhere")[] = [];
  for (let km = 5; km <= 150; km += 5) steps.push(km);
  steps.push("anywhere");
  return steps;
})();
type RadiusOption = (typeof RADIUS_OPTIONS)[number];

function radiusLabel(value: RadiusOption): string {
  return value === "anywhere" ? "Anywhere" : `${value} km`;
}

type RestaurantCard = {
  id: string;
  slug?: string;
  name: string;
  cuisine: string;
  price: string;
  priceLevel: RestaurantPriceLevel | null;
  area: string;
  bookedToday: number;
  avgRating: number | null;
  totalReviews: number;
  slots: string[];
  availableSlots: AvailabilitySlot[];
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

type GeoPoint = {
  lat: number;
  lng: number;
};

type GoogleMapInstance = {
  panTo: (point: GeoPoint) => void;
  setZoom: (zoom: number) => void;
  getZoom: () => number | undefined;
  getBounds: () => { contains: (point: GeoPoint) => boolean } | undefined;
  addListener: (event: string, handler: (...args: unknown[]) => void) => { remove: () => void };
};

function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const earthRadius = 6_371_000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

function priceFromRange(range: number | null | undefined): string {
  return restaurantPriceLabelFromRange(range);
}

function adaptRestaurant(
  r: Restaurant,
  stats: { bookedToday: number; avgRating: number | null; totalReviews: number },
  availableSlots: AvailabilitySlot[] = [],
): RestaurantCard {
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
    bookedToday: stats.bookedToday,
    avgRating: stats.avgRating,
    totalReviews: stats.totalReviews,
    slots: [],
    availableSlots,
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
  const coverPhotoUrl = restaurant.coverPhotoUrl ?? "";
  const hasCoverPhoto = coverPhotoUrl.length > 0;

  return (
    <div className={cn("relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-bg-elevated", className)}>
      {hasCoverPhoto ? (
        <img
          src={coverPhotoUrl}
          alt={`${restaurant.name} cover`}
          className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : (
        <>
          <div className="absolute inset-0 opacity-80 [background-image:repeating-linear-gradient(135deg,var(--gold)_0_1px,transparent_1px_14px)]" />
          <div className="absolute inset-0 bg-black/50" />
          <div className={cn("relative z-[1] size-9 rounded-full bg-gold/30 ring-4 ring-black/30", logoClassName)} />
        </>
      )}
      {hasCoverPhoto ? <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/20 to-bg-base/80" /> : null}
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

function FilterPickerButton({
  icon: Icon,
  label,
  value,
  active,
}: {
  icon: typeof Heart;
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-[9rem] flex-1 cursor-pointer flex-col items-start gap-1 rounded-2xl border bg-bg-elevated px-4 py-3 transition-colors",
        active
          ? "border-gold/60 bg-gold/5"
          : "border-border hover:border-gold/40",
      )}
    >
      <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-text-muted">
        <Icon className="size-3.5" />
        {label}
      </span>
      <span className="truncate text-sm text-white">{value}</span>
    </div>
  );
}

function FavoriteButton({
  active,
  onToggle,
  icon,
  label,
  size = "md",
}: {
  active: boolean;
  onToggle: () => void;
  icon?: "heart" | "bookmark";
  label?: string;
  /** `lg` — map popup and other expanded surfaces */
  size?: "md" | "lg";
}) {
  const Icon = icon === "bookmark" ? Bookmark : Heart;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "rounded-full border border-border bg-black/60 backdrop-blur transition-colors hover:border-gold/50",
        size === "lg" ? "p-2" : "p-1.5",
      )}
      aria-label={label ?? "Save restaurant"}
    >
      <Icon
        className={cn(
          size === "lg" ? "size-5" : "size-4",
          active ? "fill-gold text-gold" : "text-white",
        )}
      />
    </button>
  );
}

function AvailableTimes({
  slots,
  onBookSlot,
  size = "md",
}: {
  slots: AvailabilitySlot[];
  onBookSlot: (slot: AvailabilitySlot) => void;
  size?: "md" | "lg";
}) {
  const visibleSlots = slots.slice(0, 6);
  if (visibleSlots.length === 0) return null;
  return (
    <div className={cn("grid grid-cols-3", size === "lg" ? "gap-2.5" : "gap-2")}>
      {visibleSlots.map((slot) => (
        <button
          key={`${slot.shift_id}-${slot.date_time}`}
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onBookSlot(slot);
          }}
          className={cn(
            "flex items-center justify-center rounded-md border border-gold/25 bg-gold/10 font-semibold text-gold transition-colors hover:border-gold/60 hover:bg-gold/20",
            size === "lg"
              ? "min-h-12 px-3 text-base"
              : "min-h-11 px-2 text-sm",
          )}
        >
          {formatCompactTimeLabel(slot.display_time)}
        </button>
      ))}
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

function GridCard({
  r,
  favorite,
  saved,
  onToggleFav,
  onToggleSave,
  onBookSlot,
  onOpen,
  notifyDefaults,
}: {
  r: RestaurantCard;
  favorite: boolean;
  saved: boolean;
  onToggleFav: () => void;
  onToggleSave: () => void;
  onBookSlot: (slot: AvailabilitySlot) => void;
  onOpen: () => void;
  notifyDefaults: { date: string; time: string; partySize: number };
}) {
  const prefetch = useRestaurantPrefetch(r.id, r.slug);
  return (
    <motion.div
      ref={prefetch.setRef}
      role="button"
      tabIndex={0}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.4 }}
      onClick={onOpen}
      onMouseEnter={prefetch.onMouseEnter}
      onMouseLeave={prefetch.onMouseLeave}
      onFocus={prefetch.onMouseEnter}
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
        {r.dietaryTags.length > 0 ? (
          <div className="absolute bottom-3 left-3 right-3 flex flex-wrap gap-1.5">
            {r.dietaryTags.slice(0, 3).map((tag) => <DietaryTagChip key={tag} tag={tag} />)}
          </div>
        ) : null}
        <div className="absolute right-3 top-3 flex items-center gap-2">
          <FavoriteButton active={favorite} onToggle={onToggleFav} icon="heart" label="Favorite restaurant" />
          <FavoriteButton active={saved} onToggle={onToggleSave} icon="bookmark" label="Save restaurant" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <p className="font-serif text-2xl leading-tight tracking-tight text-white sm:text-3xl">{r.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <RestaurantPriceMeter level={r.priceLevel} />
          {r.cuisine ? <span>{capitalizeWords(r.cuisine)}</span> : null}
          {r.area ? <span>{capitalizeWords(r.area)}</span> : null}
        </div>
        {r.availableSlots.length > 0 ? (
          <AvailableTimes slots={r.availableSlots} onBookSlot={onBookSlot} />
        ) : (
          <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 rounded-md border border-border bg-bg-elevated/40 px-3 py-2 text-xs text-text-secondary">
              <Clock className="size-3.5 text-text-muted" />
              <span>Booked up tonight — tap to pick another night</span>
            </div>
            <NotifyMeButton
              variant="restaurant"
              restaurantId={r.id}
              restaurantName={r.name}
              restaurantSlug={r.slug}
              defaultDate={notifyDefaults.date}
              defaultTime={notifyDefaults.time}
              defaultPartySize={notifyDefaults.partySize}
              size="sm"
              className="w-full justify-center"
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

function MapListCard({
  r,
  favorite,
  saved,
  onToggleFav,
  onToggleSave,
  onBookSlot,
  onHover,
  highlighted,
  onSelect,
}: {
  r: RestaurantCard;
  favorite: boolean;
  saved: boolean;
  onToggleFav: () => void;
  onToggleSave: () => void;
  onBookSlot: (slot: AvailabilitySlot) => void;
  onHover: (id: string | null) => void;
  highlighted: boolean;
  onSelect: () => void;
}) {
  const prefetch = useRestaurantPrefetch(r.id, r.slug);
  return (
    <div
      ref={prefetch.setRef}
      role="button"
      tabIndex={0}
      onMouseEnter={() => {
        onHover(r.id);
        prefetch.onMouseEnter();
      }}
      onMouseLeave={() => {
        onHover(null);
        prefetch.onMouseLeave();
      }}
      onFocus={prefetch.onMouseEnter}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "flex cursor-pointer gap-4 rounded-2xl border bg-bg-surface/40 p-4 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
        highlighted ? "border-gold/70 bg-gold/5 shadow-lg shadow-gold/10" : "border-border hover:border-gold/30 hover:bg-bg-surface/70",
      )}
    >
      <div className="relative w-40 shrink-0 overflow-hidden rounded-xl">
        <RestaurantCardImage restaurant={r} className="aspect-square" logoClassName="size-12" />
        {r.badge ? (
          <div className="absolute left-2 top-2">
            <BadgeChip label={r.badge} />
          </div>
        ) : null}
        {r.dietaryTags.length > 0 ? (
          <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1">
            {r.dietaryTags.slice(0, 2).map((tag) => <DietaryTagChip key={tag} tag={tag} />)}
          </div>
        ) : null}
        <div className="absolute right-2 top-2 flex items-center gap-1.5">
          <FavoriteButton active={favorite} onToggle={onToggleFav} icon="heart" label="Favorite restaurant" />
          <FavoriteButton active={saved} onToggle={onToggleSave} icon="bookmark" label="Save restaurant" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <p className="font-serif text-xl text-white">{r.name}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <RestaurantPriceMeter level={r.priceLevel} />
          {r.cuisine ? <span>{capitalizeWords(r.cuisine)}</span> : null}
          {r.area ? <span>{capitalizeWords(r.area)}</span> : null}
          {r.features.filter((feature) => !r.dietaryTags.some((tag) => feature === tag.replace(/_/g, "-"))).slice(0, 3).map((f) => (
            <span
              key={f}
              className="rounded-full border border-border bg-bg-elevated px-2 py-0.5 text-[11px] text-text-secondary"
            >
              {capitalizeWords(f)}
            </span>
          ))}
        </div>
        <AvailableTimes slots={r.availableSlots} onBookSlot={onBookSlot} />
        <p className="text-xs text-text-muted">
          {r.acceptsWalkins ? "Walk-ins accepted when available" : "Reservations only"}
        </p>
      </div>
    </div>
  );
}

// CENAIVA_MAP_STYLES moved to apps/web/src/lib/google-maps.ts so the voice
// shell can share the same dark theme. Imported above.

function pinIconSvg({
  active,
  priceLevel,
}: {
  active: boolean;
  priceLevel: number | null;
}): { url: string; size: { width: number; height: number } } {
  const filterId = `s${active ? "a" : "d"}`;

  if (priceLevel == null) {
    const size = active ? 32 : 24;
    const cx = size / 2;
    const cy = size / 2;
    const r = active ? 11 : 8;
    const fill = active ? "#F5E6C8" : "#C9A84C";
    const stroke = active ? "#0A0A0A" : "rgba(10,10,10,0.6)";
    const strokeWidth = active ? 2 : 1.25;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>
      <defs>
        <filter id='${filterId}' x='-50%' y='-50%' width='200%' height='200%'>
          <feDropShadow dx='0' dy='2' stdDeviation='2' flood-color='#000000' flood-opacity='0.55'/>
        </filter>
      </defs>
      <circle cx='${cx}' cy='${cy}' r='${r}' fill='${fill}' stroke='${stroke}' stroke-width='${strokeWidth}' filter='url(#${filterId})'/>
    </svg>`;
    return {
      url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      size: { width: size, height: size },
    };
  }

  const dollarCount = Math.min(Math.max(priceLevel, 1), 3);
  const dollars = "$".repeat(dollarCount);
  const fontSize = active ? 14 : 12;
  const padX = active ? 10 : 8;
  const height = active ? 28 : 22;
  const charWidth = fontSize * 0.65;
  const width = Math.round(dollars.length * charWidth + padX * 2);
  const fill = active ? "#F5E6C8" : "#0A0A0A";
  const textColor = active ? "#0A0A0A" : "#C9A84C";
  const stroke = active ? "#C9A84C" : "rgba(201,168,76,0.65)";
  const strokeWidth = active ? 2 : 1.25;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'>
    <defs>
      <filter id='${filterId}' x='-50%' y='-50%' width='200%' height='200%'>
        <feDropShadow dx='0' dy='2' stdDeviation='2' flood-color='#000000' flood-opacity='0.55'/>
      </filter>
    </defs>
    <rect x='${strokeWidth / 2}' y='${strokeWidth / 2}' width='${width - strokeWidth}' height='${height - strokeWidth}' rx='${height / 2}' ry='${height / 2}' fill='${fill}' stroke='${stroke}' stroke-width='${strokeWidth}' filter='url(#${filterId})'/>
    <text x='50%' y='50%' dominant-baseline='central' text-anchor='middle' font-family='ui-monospace, SFMono-Regular, Menlo, monospace' font-weight='700' font-size='${fontSize}' fill='${textColor}'>${dollars}</text>
  </svg>`;
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, size: { width, height } };
}

function clusterIconSvg(count: number): { url: string; size: number } {
  const size = count >= 50 ? 56 : count >= 10 ? 48 : 40;
  const cx = size / 2;
  const cy = size / 2;
  const halo = size / 2 - 2;
  const r = size / 2 - 7;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>
    <defs>
      <filter id='cs' x='-50%' y='-50%' width='200%' height='200%'>
        <feDropShadow dx='0' dy='2' stdDeviation='2.5' flood-color='#000000' flood-opacity='0.55'/>
      </filter>
    </defs>
    <circle cx='${cx}' cy='${cy}' r='${halo}' fill='rgba(201,168,76,0.16)' stroke='rgba(245,230,200,0.35)' stroke-width='1.5'/>
    <circle cx='${cx}' cy='${cy}' r='${r}' fill='#C9A84C' stroke='#0A0A0A' stroke-width='2' filter='url(#cs)'/>
  </svg>`;
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, size };
}

function GoogleDiscoverMap({
  restaurants,
  selectedId,
  hoveredId,
  userLocation,
  onSelect,
  onHover,
}: {
  restaurants: RestaurantCard[];
  selectedId: string | null;
  hoveredId: string | null;
  userLocation: GeoPoint | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const markersRef = useRef<GoogleMapsMarker[]>([]);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const userMarkerRef = useRef<GoogleMapsMarker | null>(null);
  // The map is created asynchronously inside loadGoogleMaps().then. Using a
  // ref alone means the marker / pan / user-pin effects never re-run after
  // mapRef.current goes from null → ready — the page sits with no pins until
  // an unrelated dep (selectedId, hoveredId) bumps and forces a re-run.
  // Tracking readiness in state forces a re-render when the map finishes
  // loading, which triggers the dependent effects.
  const [mapReady, setMapReady] = useState(false);
  const googleReady = hasGoogleMapsApiKey();
  const mappableRestaurants = useMemo(
    () => restaurants.filter((r) => r.lat != null && r.lng != null),
    [restaurants],
  );

  // Read initial center/zoom from refs so this effect runs ONCE per mount.
  // Previously this depended on `mappableRestaurants` and `userLocation`,
  // which meant the map was destroyed and rebuilt every time those changed
  // — orphaning any markers attached to the prior Map instance and leaving
  // the visible map (a fresh instance) blank. Subsequent center/zoom
  // updates are handled by separate panTo effects below.
  const initialCenterRef = useRef<{ lat: number; lng: number }>({ lat: 43.6532, lng: -79.3832 });
  const initialZoomRef = useRef<number>(11);
  if (userLocation) {
    initialCenterRef.current = userLocation;
    initialZoomRef.current = 13;
  } else if (mappableRestaurants[0]?.lat != null && mappableRestaurants[0]?.lng != null) {
    initialCenterRef.current = { lat: mappableRestaurants[0].lat, lng: mappableRestaurants[0].lng };
  }

  // Keep a ref to the latest onSelect so the map background click listener
  // (registered once at map-init) always dismisses to the current handler
  // without needing to re-create the map.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!googleReady || !mapNodeRef.current) return;
    let cancelled = false;

    void loadGoogleMaps().then((maps) => {
      if (cancelled || !mapNodeRef.current) return;
      const map = new maps.Map(mapNodeRef.current, {
        center: initialCenterRef.current,
        zoom: initialZoomRef.current,
        minZoom: 4,
        maxZoom: 18,
        disableDefaultUI: true,
        zoomControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
        streetViewControl: false,
        clickableIcons: false,
        gestureHandling: "greedy",
        backgroundColor: "#0A0A0A",
        styles: CENAIVA_MAP_STYLES,
      }) as GoogleMapInstance;
      // Background click dismisses the open restaurant popup. Marker
      // clicks have their own listener and do NOT fire this — Google
      // Maps stops propagation from markers to the map background.
      map.addListener("click", () => {
        onSelectRef.current(null);
      });
      mapRef.current = map;
      setMapReady(true);
    }).catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [googleReady]);

  // Refs let the click/hover listeners always read the latest handlers
  // without forcing the marker-creation effect (below) to re-run and
  // destroy every marker on each render. Same pattern as the map-bg
  // click listener above.
  const onHoverRef = useRef(onHover);
  useEffect(() => { onHoverRef.current = onHover; }, [onHover]);
  // We keep a parallel array of restaurant ids alongside markersRef so the
  // active-state update effect (below) can match markers to ids without
  // depending on closure capture.
  const markerIdsRef = useRef<string[]>([]);

  // Create markers ONCE per restaurant-list change. Active-state (hovered
  // /selected) updates happen in a separate effect that flips icons +
  // zIndex on the existing markers — no marker destruction on hover.
  useEffect(() => {
    const map = mapRef.current;
    const google = (window as Window & { google?: { maps?: GoogleMapsNamespace } }).google;
    const maps = google?.maps;
    if (!map || !maps) return;

    if (clustererRef.current) {
      clustererRef.current.clearMarkers();
      clustererRef.current = null;
    }
    markersRef.current.forEach((marker) => marker.setMap(null));

    markersRef.current = mappableRestaurants.map((restaurant) => {
      const { url, size } = pinIconSvg({
        active: false,
        priceLevel: normalizeRestaurantPriceLevel(restaurant.priceLevel),
      });
      const marker = new maps.Marker({
        position: { lat: restaurant.lat, lng: restaurant.lng },
        title: restaurant.name,
        icon: {
          url,
          scaledSize: new maps.Size(size.width, size.height),
          anchor: new maps.Point(size.width / 2, size.height / 2),
        },
        zIndex: 1,
      });
      marker.addListener("click", () => onSelectRef.current(restaurant.id));
      marker.addListener("mouseover", () => onHoverRef.current(restaurant.id));
      marker.addListener("mouseout", () => onHoverRef.current(null));
      return marker;
    });
    markerIdsRef.current = mappableRestaurants.map((r) => r.id);

    const renderer: Renderer = {
      render: ({ count, position }: Cluster) => {
        const { url, size } = clusterIconSvg(count);
        return new maps.Marker({
          position,
          icon: {
            url,
            scaledSize: new maps.Size(size, size),
            anchor: new maps.Point(size / 2, size / 2),
          },
          label: {
            text: String(count),
            color: "#0a0907",
            fontWeight: "700",
            fontSize: count >= 50 ? "13px" : "12px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          },
          zIndex: 1000 + count,
        }) as unknown as google.maps.Marker;
      },
    };

    clustererRef.current = new MarkerClusterer({
      map: map as unknown as google.maps.Map,
      markers: markersRef.current as unknown as google.maps.Marker[],
      renderer,
    });

    return () => {
      if (clustererRef.current) {
        clustererRef.current.clearMarkers();
        clustererRef.current = null;
      }
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
      markerIdsRef.current = [];
    };
  }, [mappableRestaurants, mapReady]);

  // Update existing markers' icon + zIndex when the active restaurant
  // changes. No marker destruction — no flicker.
  useEffect(() => {
    const google = (window as Window & { google?: { maps?: GoogleMapsNamespace } }).google;
    const maps = google?.maps;
    if (!maps) return;
    markersRef.current.forEach((marker, idx) => {
      const restaurant = mappableRestaurants[idx];
      if (!restaurant) return;
      const active = selectedId === restaurant.id || hoveredId === restaurant.id;
      const { url, size } = pinIconSvg({
        active,
        priceLevel: normalizeRestaurantPriceLevel(restaurant.priceLevel),
      });
      marker.setIcon({
        url,
        scaledSize: new maps.Size(size.width, size.height),
        anchor: new maps.Point(size.width / 2, size.height / 2),
      });
      marker.setZIndex(active ? 999 : 1);
    });
  }, [hoveredId, selectedId, mappableRestaurants]);


  useEffect(() => {
    const map = mapRef.current;
    const google = (window as Window & { google?: { maps?: GoogleMapsNamespace } }).google;
    const maps = google?.maps;
    if (!map || !maps) return;

    if (userMarkerRef.current) {
      userMarkerRef.current.setMap(null);
      userMarkerRef.current = null;
    }
    if (!userLocation) return;

    userMarkerRef.current = new maps.Marker({
      map,
      position: userLocation,
      title: "Your location",
      icon: {
        path: maps.SymbolPath.CIRCLE,
        scale: 8,
        fillColor: "#3B82F6",
        fillOpacity: 1,
        strokeColor: "#BFDBFE",
        strokeWeight: 4,
      },
    });
    map.panTo(userLocation);

    return () => {
      if (userMarkerRef.current) {
        userMarkerRef.current.setMap(null);
        userMarkerRef.current = null;
      }
    };
  }, [mapReady, userLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const selected = mappableRestaurants.find((restaurant) => restaurant.id === selectedId);
    if (selected?.lat == null || selected.lng == null) return;
    const point = { lat: selected.lat, lng: selected.lng };
    map.panTo(point);
    // Zoom in close enough to see the street the restaurant is on. Only
    // zoom in (never out) — if the user already zoomed past 16 manually,
    // respect their choice.
    const currentZoom = map.getZoom?.();
    if (currentZoom == null || currentZoom < 16) {
      map.setZoom(16);
    }
  }, [mappableRestaurants, mapReady, selectedId]);

  return (
    <div className="absolute inset-0">
      {googleReady ? (
        <>
          <div ref={mapNodeRef} className="size-full" />
          <div className="absolute right-4 top-4 overflow-hidden rounded-xl border border-gold/25 bg-bg-surface/90 shadow-2xl shadow-black/30 backdrop-blur">
    <button
      type="button"
              onClick={() => {
                const map = mapRef.current;
                if (!map) return;
                map.setZoom(Math.min((map.getZoom() ?? 12) + 1, 18));
              }}
              className="flex size-10 items-center justify-center border-b border-border text-lg font-semibold text-gold transition-colors hover:bg-gold/10 hover:text-white"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => {
                const map = mapRef.current;
                if (!map) return;
                map.setZoom(Math.max((map.getZoom() ?? 12) - 1, 4));
              }}
              className="flex size-10 items-center justify-center text-lg font-semibold text-gold transition-colors hover:bg-gold/10 hover:text-white"
              aria-label="Zoom out"
            >
              -
            </button>
          </div>
        </>
      ) : (
        <div className="flex size-full items-center justify-center bg-bg-elevated px-8 text-center text-sm text-text-secondary">
          Add VITE_GOOGLE_MAPS_API_KEY to the root .env and restart the dev server to enable Google Maps.
        </div>
      )}
    </div>
  );
}

function MapRestaurantPopup({
  restaurant,
  favorite,
  saved,
  onBookSlot,
  onClose,
  onToggleFavorite,
  onToggleSave,
  onOpenPreview,
  notifyDefaults,
}: {
  restaurant: RestaurantCard;
  favorite: boolean;
  saved: boolean;
  onBookSlot: (slot: AvailabilitySlot) => void;
  onClose: () => void;
  onToggleFavorite: () => void;
  onToggleSave: () => void;
  onOpenPreview: () => void;
  notifyDefaults: { date: string; time: string; partySize: number };
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenPreview}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenPreview();
        }
      }}
      aria-label={`Open ${restaurant.name} preview`}
      className="group absolute bottom-4 left-4 z-10 flex w-[min(20rem,calc(100vw-2rem))] cursor-pointer flex-col overflow-hidden rounded-2xl border border-border bg-bg-surface/95 shadow-2xl shadow-black/50 backdrop-blur transition-colors hover:border-gold/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
    >
      <div className="relative">
        <RestaurantCardImage
          restaurant={restaurant}
          className="aspect-auto h-24 sm:h-28"
          logoClassName="size-8 sm:size-9"
        />
        {restaurant.badge ? (
          <div className="absolute left-2 top-2">
            <BadgeChip label={restaurant.badge} />
          </div>
        ) : null}
        {restaurant.dietaryTags.length > 0 ? (
          <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1">
            {restaurant.dietaryTags.slice(0, 1).map((tag) => <DietaryTagChip key={tag} tag={tag} />)}
          </div>
        ) : null}
        <div className="absolute right-2 top-2 flex items-center gap-1.5">
          <FavoriteButton
            active={favorite}
            onToggle={onToggleFavorite}
            icon="heart"
            label="Favorite restaurant"
          />
          <FavoriteButton
            active={saved}
            onToggle={onToggleSave}
            icon="bookmark"
            label="Save restaurant"
          />
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className="rounded-full border border-border bg-black/60 p-1.5 text-white backdrop-blur transition-colors hover:border-gold/50"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="font-serif text-lg leading-tight tracking-tight text-white sm:text-xl">
          {restaurant.name}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
          <RestaurantPriceMeter level={restaurant.priceLevel} className="text-base" />
          {restaurant.cuisine ? <span>{capitalizeWords(restaurant.cuisine)}</span> : null}
          {restaurant.area ? <span>{capitalizeWords(restaurant.area)}</span> : null}
        </div>
        {restaurant.availableSlots.length > 0 ? (
          <AvailableTimes slots={restaurant.availableSlots} onBookSlot={onBookSlot} />
        ) : (
          <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-text-secondary">Booked up tonight.</p>
            <NotifyMeButton
              variant="restaurant"
              restaurantId={restaurant.id}
              restaurantName={restaurant.name}
              restaurantSlug={restaurant.slug}
              defaultDate={notifyDefaults.date}
              defaultTime={notifyDefaults.time}
              defaultPartySize={notifyDefaults.partySize}
              className="w-full justify-center"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    user,
    profile,
    signOut,
    restaurantRoles,
  } = useUser();
  const { restaurants: staffRestaurants } = useStaffRestaurants(restaurantRoles);
  const { restaurants, loading } = usePublicRestaurants();
  const { notifications, unreadCount, markRead } = useNotifications();
  const { invites: pendingStaffInvites } = useMyStaffInvites();
  const assistant = useAssistant();

  // Auto-open Hey Cenaiva when the user lands on /discover with ?concierge=1.
  // Triggered by the post-login bounce from CustomerNav's sign-in dialog: an
  // anon visitor clicks "Concierge" → signs in → returns here, and we open the
  // assistant for them so they don't have to click the button a second time.
  //
  // The ref guards against re-firing within the same page load. Without it,
  // `assistant` (a context value memo) can flip references on every render —
  // re-running the effect after the URL strip but before React Router's
  // searchParams update propagates — which loops open() at 60fps and pins
  // state.isOpen=true so the X button click can never take effect.
  const autoOpenFiredRef = useRef(false);
  useEffect(() => {
    if (autoOpenFiredRef.current) return;
    if (!user) return;
    if (!assistant) return;
    if (searchParams.get("concierge") !== "1") return;
    autoOpenFiredRef.current = true;
    const greetingText = buildWakeGreeting(user);
    assistant.open(undefined, undefined, { autoListen: true, greetingText });
    // Strip the param so a refresh doesn't re-open. Preserve any other
    // query the caller already had on the URL.
    const next = new URLSearchParams(searchParams);
    next.delete("concierge");
    const search = next.toString();
    void navigate(
      { pathname: "/discover", search: search ? `?${search}` : "" },
      { replace: true },
    );
  }, [user, assistant, searchParams, navigate]);

  const [view, setView] = useState<"grid" | "map">("map");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [dateId, setDateId] = useState("today");
  const [time, setTime] = useState(searchParams.get("time") ?? getNearestUpcomingHalfHour());
  const [partySize, setPartySize] = useState<string>(
    searchParams.get("people") ?? "2",
  );
  // Pending values while the filter panel is open — applied on Done click.
  const [pendingDateId, setPendingDateId] = useState(dateId);
  const [pendingCustomDate, setPendingCustomDate] = useState<Date | undefined>(undefined);
  const [pendingTime, setPendingTime] = useState(time);
  const [pendingPartySize, setPendingPartySize] = useState(partySize);
  const [radius, setRadius] = useState<RadiusOption>("anywhere");
  const [pendingRadius, setPendingRadius] = useState<RadiusOption>("anywhere");
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
  const [radiusPickerOpen, setRadiusPickerOpen] = useState(false);
  const [activePrices, setActivePrices] = useState<Set<string>>(new Set());
  const [activeFeatures, setActiveFeatures] = useState<Set<string>>(new Set());
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [savedRestaurants, setSavedRestaurants] = useState<Set<string>>(new Set());
  const [availabilityByRestaurantId, setAvailabilityByRestaurantId] = useState<Record<string, AvailabilitySlot[]>>({});
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  // Separate "a fetch is in flight" flag — always set during ANY fetch
  // (foreground or background). Used by the auto-roll effect to avoid
  // racing with an in-progress fetch. We need this distinct from
  // `availabilityLoading` because the 60-second tick refreshes data
  // silently without flipping the skeleton-display flag.
  const [availabilityFetching, setAvailabilityFetching] = useState(false);
  // Set true when the next fetch should be silent (no skeleton flicker).
  // Read + reset by the fetch effect on each run.
  const silentRefreshRef = useRef(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapEdgeMode, setMapEdgeMode] = useState(false);
  const searchSentinelRef = useRef<HTMLDivElement | null>(null);
  const [previewRestaurant, setPreviewRestaurant] = useState<RestaurantCard | null>(null);
  const [previewAvailabilityNotice, setPreviewAvailabilityNotice] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<GeoPoint | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "requesting" | "allowed" | "denied" | "unsupported">(
    () => ("geolocation" in navigator ? "idle" : "unsupported"),
  );
  const previewParam = searchParams.get("preview");
  const previewSource = searchParams.get("from");
  const restaurantIds = useMemo(() => restaurants.map((restaurant) => restaurant.id), [restaurants]);
  const { statsByRestaurantId } = useRestaurantPreviewStatsByRestaurantIds(restaurantIds);
  const datePresets = useMemo(() => datePresetOptions(), []);
  const selectedBookingDate = useMemo(() => dateParamFromSelection(dateId, customDate), [customDate, dateId]);
  const selectedPartySize = normalizePartySize(partySize);
  const listingLoading = loading || availabilityLoading;

  // Auto-roll to the next available date when the user is on the default
  // date selection ("today", no manual pick) and every active restaurant
  // has zero remaining slots — most often because we're past the last
  // bookable time of day. Without this, Discover renders an empty page
  // with no signal that anything exists. Capped at 14 attempts so a
  // fully-closed catalog doesn't loop forever; reset to 0 whenever the
  // user picks a different date manually so we never override their
  // explicit choice.
  const [autoRollOffsetDays, setAutoRollOffsetDays] = useState(0);
  // Flips true after the first availability fetch settles. Without this gate,
  // auto-roll fires on cold load DURING the window between "restaurants list
  // arrived" and "availability fetch began" — `availabilityLoading` is still
  // its previous-render `false` while `cards.length` is already 11, so the
  // auto-roll effect sees `cardsWithSlotsCount === 0` and advances the date
  // before the fetch even kicks off. By gating on this flag, the first valid
  // auto-roll decision can only happen after real data has been seen at least
  // once.
  const [availabilityHasLoaded, setAvailabilityHasLoaded] = useState(false);
  // Tracks the `effectiveBookingDate` that the most recent availability fetch
  // actually settled for. Used by the auto-roll effect below to prevent a
  // synchronous loop: setting `autoRollOffsetDays` advances `effectiveBookingDate`
  // and triggers a new fetch, but `availabilityLoading` doesn't flip true
  // until the NEXT render. Without this date-anchor, the auto-roll effect
  // re-fires inside the same render cycle and runs to the 14-day cap before
  // any real network call completes — tripping React's max-update-depth warning.
  const [availabilitySettledForDate, setAvailabilitySettledForDate] = useState<string | null>(null);
  // Bumped whenever the user's reservation set changes (cancel / book / modify)
  // OR the tab regains focus. Threaded into the availability fetch effect's
  // deps so Discover refreshes after the user cancels — without it the
  // auto-roll banner could lie forever ("No availability for May 13") even
  // after the conflicting bookings were cancelled, because Discover doesn't
  // hold a realtime socket per restaurant card.
  const [availabilityRefreshTick, setAvailabilityRefreshTick] = useState(0);
  const { upcoming: myUpcomingReservations, refresh: refreshMyReservations } = useMyReservations();
  const myReservationIdsKey = useMemo(
    () => myUpcomingReservations.map((r) => r.id).sort().join(","),
    [myUpcomingReservations],
  );
  const isOnDefaultDate = dateId === "today" && customDate === undefined;
  const effectiveBookingDate = useMemo(() => {
    if (autoRollOffsetDays === 0) return selectedBookingDate;
    const base = new Date(`${selectedBookingDate}T00:00:00`);
    return format(addDays(base, autoRollOffsetDays), "yyyy-MM-dd");
  }, [selectedBookingDate, autoRollOffsetDays]);
  useEffect(() => {
    // User changed their date selection — drop any prior auto-roll so we
    // don't silently advance off the date they just picked. setState-in-
    // effect is intentional: the user's pick is a state change that should
    // trigger a single reset, not a derived value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isOnDefaultDate && autoRollOffsetDays !== 0) setAutoRollOffsetDays(0);
  }, [isOnDefaultDate, autoRollOffsetDays]);

  // When the user's reservations change (cancel via /bookings, modify, or
  // book), reset any prior auto-roll so the banner doesn't keep lying, and
  // bump the refresh tick so the availability fetch effect re-runs. Skip the
  // initial mount (empty -> first batch) so we don't wipe a legitimate roll
  // that just settled.
  const lastReservationIdsKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastReservationIdsKeyRef.current === null) {
      lastReservationIdsKeyRef.current = myReservationIdsKey;
      return;
    }
    if (lastReservationIdsKeyRef.current === myReservationIdsKey) return;
    lastReservationIdsKeyRef.current = myReservationIdsKey;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAutoRollOffsetDays(0);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAvailabilityRefreshTick((t) => t + 1);
  }, [myReservationIdsKey]);

  // Tab refocus → re-pull the user's reservation list. Handles cases where
  // reservations were cancelled outside this tab (Hey Cenaiva on another
  // device, the harness, or a backend cleanup) while Discover was idle.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      void refreshMyReservations();
      // Reset auto-roll so the user's original date gets a fresh look on
      // tab return — see the periodic-refresh effect below for why.
      setAutoRollOffsetDays(0);
      setAvailabilityRefreshTick((t) => t + 1);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refreshMyReservations]);

  // Periodic refresh while the tab is visible. Without this, the auto-roll
  // banner can keep showing "No availability for today" long after slots
  // open up (e.g. a restaurant just got a cancellation, or a shift's
  // cutoff time passed and earlier-evening slots dropped off). 60s is a
  // gentle cadence — one server-side cache miss per minute per active
  // viewer, well under the rate limits.
  //
  // Resetting `autoRollOffsetDays` here is what lets auto-roll RETREAT.
  // Without the reset, the periodic fetch faithfully re-queries
  // `effectiveBookingDate` (the rolled date), never re-checks the user's
  // original selection, and the banner gets stuck announcing "no
  // availability for May 13" indefinitely. With the reset, each minute we
  // give the user's actual date a fresh chance; if it still has zero
  // supply the existing auto-roll effect re-advances within the same
  // render cycle (one extra RPC call, cheap).
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      // Mark this refresh as silent — the fetch effect below will swap
      // data without flipping `availabilityLoading`, so the map/grid
      // doesn't unmount and remount every minute.
      silentRefreshRef.current = true;
      setAutoRollOffsetDays(0);
      setAvailabilityRefreshTick((t) => t + 1);
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Consume the silent-refresh marker so this fetch knows whether to
    // show skeletons. Reset immediately so the NEXT fetch (e.g. user
    // changes filters mid-tick) shows skeletons normally.
    const silent = silentRefreshRef.current;
    silentRefreshRef.current = false;
    void (async () => {
      if (restaurantIds.length === 0) {
        if (!cancelled) {
          setAvailabilityByRestaurantId({});
          setAvailabilityLoading(false);
          setAvailabilityFetching(false);
        }
        return;
      }
      setAvailabilityFetching(true);
      if (!silent) setAvailabilityLoading(true);
      try {
        const map = await fetchDisplayAvailabilitySlotsForRestaurants(
          restaurantIds,
          effectiveBookingDate,
          selectedPartySize,
          time,
        );
        if (cancelled) return;
        setAvailabilityByRestaurantId(map);
        setAvailabilityHasLoaded(true);
        setAvailabilitySettledForDate(effectiveBookingDate);
      } catch {
        // Silent refresh failures must keep the existing data visible —
        // a network blip shouldn't blank out the page. The next tick
        // (or user action) will retry. Foreground failures fall through
        // to the same behavior; the loading flag is cleared in `finally`
        // so the UI doesn't get stuck on the skeleton.
      } finally {
        if (cancelled) return;
        setAvailabilityFetching(false);
        if (!silent) setAvailabilityLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantIds, effectiveBookingDate, selectedPartySize, time, availabilityRefreshTick]);

  const cards: RestaurantCard[] = useMemo(() => {
    return restaurants.map((restaurant) => adaptRestaurant(
      restaurant,
      statsByRestaurantId[restaurant.id] ?? { bookedToday: 0, avgRating: null, totalReviews: 0 },
      availabilityByRestaurantId[restaurant.id] ?? [],
    ));
  }, [availabilityByRestaurantId, restaurants, statsByRestaurantId]);

  // Trigger auto-roll: when every active restaurant has zero slots AND the
  // user hasn't manually picked a date, advance the effective date by 1
  // day and re-fetch. Capped at 14 attempts (server-side dates also cap
  // at advance_booking_days). Only fires when no filter is active so we
  // don't roll past dates the user is actively narrowing.
  const cardsWithSlotsCount = useMemo(
    () => cards.filter((c) => c.availableSlots.length > 0).length,
    [cards],
  );
  // How many of the user's own upcoming reservations fall on the date(s)
  // we just rolled past. Surfaced in the banner so users understand why
  // their default date appeared empty — their existing bookings may have
  // occupied the very tables/timeslots they'd want to use. Dates compared
  // in browser-local timezone, which matches what the user sees elsewhere.
  const bookingsInRolledWindow = useMemo(() => {
    if (autoRollOffsetDays === 0) return 0;
    const start = selectedBookingDate;
    const end = effectiveBookingDate;
    return myUpcomingReservations.filter((r) => {
      const resDate = format(new Date(r.reserved_at), "yyyy-MM-dd");
      return resDate >= start && resDate < end;
    }).length;
  }, [autoRollOffsetDays, myUpcomingReservations, selectedBookingDate, effectiveBookingDate]);
  const noFiltersActive =
    !search.trim() && activePrices.size === 0 && activeFeatures.size === 0;
  useEffect(() => {
    if (!isOnDefaultDate || !noFiltersActive) return;
    // Use `availabilityFetching` (set during ANY fetch) not
    // `availabilityLoading` (now skipped on silent tick refreshes) —
    // we still need to wait for an in-flight background fetch to settle
    // before advancing the date, otherwise we race.
    if (availabilityFetching || cards.length === 0) return;
    // Cold-load guard: don't advance the date until at least one real
    // availability fetch has settled. Without this, the brief render window
    // between "restaurants list arrived" and "fetch effect runs" wrongly
    // shows `cardsWithSlotsCount === 0`, and auto-roll fires before any
    // server response.
    if (!availabilityHasLoaded) return;
    // Per-date settled guard: only roll when the LAST settled fetch was for
    // the CURRENT effective date. After we increment `autoRollOffsetDays`,
    // `effectiveBookingDate` changes but `availabilitySettledForDate` still
    // points at the previous date — so this guard bails until the new fetch
    // resolves. Without it, the effect could re-fire synchronously (before
    // `availabilityFetching` propagates) and run to the 14-day cap in a
    // single tick, tripping React's max-update-depth warning.
    if (availabilitySettledForDate !== effectiveBookingDate) return;
    if (cardsWithSlotsCount > 0) return;
    if (autoRollOffsetDays >= 14) return;
    // setState-in-effect is intentional here: we need to advance the date
    // AFTER the availability fetch settles. Computing this synchronously in
    // a useMemo would create a stale closure on the loading flag and re-fire
    // before the new fetch completes. Same pattern as
    // CenaivaVoicePreferenceProvider's refresh effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAutoRollOffsetDays((prev) => prev + 1);
  }, [
    isOnDefaultDate,
    noFiltersActive,
    availabilityFetching,
    availabilityHasLoaded,
    availabilitySettledForDate,
    effectiveBookingDate,
    cards.length,
    cardsWithSlotsCount,
    autoRollOffsetDays,
  ]);

  // All cards matching search / price / feature / location filters — WITH OR
  // WITHOUT slots. Drives the page-level count and the "Booked up tonight"
  // rail, so restaurants whose seatings have already passed for the night
  // stay visible (just rendered without time pills + a "fully booked"
  // caption so the user can still tap in and pick another date).
  const filteredAll = useMemo(() => {
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
      const wanted = new Set([...activeFeatures].map((f) => f.toLowerCase()));
      list = list.filter((r) =>
        [...wanted].every((target) => r.features.some((feature) => feature.toLowerCase() === target)),
      );
    }
    if (userLocation) {
      if (radius !== "anywhere") {
        const radiusMeters = radius * 1000;
        list = list.filter((r) => {
          if (r.lat == null || r.lng == null) return false;
          return distanceMeters(userLocation, { lat: r.lat, lng: r.lng }) <= radiusMeters;
        });
      }
      list = [...list].sort((a, b) => {
        if (a.lat == null || a.lng == null) return 1;
        if (b.lat == null || b.lng == null) return -1;
        return distanceMeters(userLocation, { lat: a.lat, lng: a.lng }) - distanceMeters(userLocation, { lat: b.lat, lng: b.lng });
      });
    }
    return list;
  }, [cards, search, activePrices, activeFeatures, userLocation, radius]);

  // Bookable tonight subset — drives the rails that imply "you can book this
  // right now" and the map view.
  const filtered = useMemo(
    () => filteredAll.filter((r) => r.availableSlots.length > 0),
    [filteredAll],
  );

  // Booked-up subset — feeds the new "Booked up tonight — try another
  // night" rail so users can still discover restaurants whose last seating
  // has already passed (or that are fully sold out for the night).
  const bookedUpTonightPool = useMemo(
    () => filteredAll.filter((r) => r.availableSlots.length === 0),
    [filteredAll],
  );

  useEffect(() => {
    // Bug fix 2026-05-17: previously this only ran in map view, so the
    // hardcoded "TORONTO" header on grid view never had a chance to reflect
    // the user's real city. Run on initial idle regardless of view so the
    // header's geo-eyebrow can resolve.
    if (locationStatus !== "idle") return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocationStatus("allowed");
      },
      () => {
        setLocationStatus("denied");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 300_000 },
    );
  }, [locationStatus]);

  // Reverse-geocode the user's location to a city label for the header
  // eyebrow. Falls back gracefully when geolocation is denied/unsupported —
  // no city is shown rather than risking a wrong one (the prior hardcoded
  // "TORONTO" was confusing Guelph users into thinking the matcher was
  // broken).
  const [userCityLabel, setUserCityLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!userLocation) return;
    let cancelled = false;
    void loadGoogleMaps().then((maps) => {
      if (cancelled) return;
      const geocoder = new maps.Geocoder();
      geocoder.geocode({ location: userLocation }, (results, status) => {
        if (cancelled) return;
        if (status !== "OK" || !results) return;
        const localityComp = results
          .flatMap((r) => r.address_components ?? [])
          .find((c) =>
            c.types.includes("locality") ||
            c.types.includes("administrative_area_level_2"),
          );
        if (localityComp?.long_name) setUserCityLabel(localityComp.long_name);
      });
    });
    return () => { cancelled = true; };
  }, [userLocation]);

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
    (time !== getNearestUpcomingHalfHour() ? 1 : 0) +
    (partySize !== "2" ? 1 : 0) +
    (radius !== "anywhere" ? 1 : 0);

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
  const toggleSavedRestaurant = (id: string) =>
    setSavedRestaurants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clearAll = () => {
    const defaultTime = getNearestUpcomingHalfHour();
    setDateId("today");
    setCustomDate(undefined);
    setTime(defaultTime);
    setPartySize("2");
    setRadius("anywhere");
    setActivePrices(new Set());
    setActiveFeatures(new Set());
    setPendingDateId("today");
    setPendingCustomDate(undefined);
    setPendingTime(defaultTime);
    setPendingPartySize("2");
    setPendingRadius("anywhere");
  };

  const applyFilters = () => {
    setDateId(pendingDateId);
    setCustomDate(pendingCustomDate);
    setTime(pendingTime);
    setPartySize(pendingPartySize);
    setRadius(pendingRadius);
    setFiltersOpen(false);
  };

  useEffect(() => {
    if (filtersOpen) {
      void Promise.resolve().then(() => {
        setPendingDateId(dateId);
        setPendingCustomDate(customDate);
        setPendingTime(time);
        setPendingPartySize(partySize);
        setPendingRadius(radius);
      });
    }
    // Only sync when panel toggles open — actual values flow into pending.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersOpen]);

  const refreshRestaurantDisplaySlots = async (
    restaurantId: string,
    partyCount: number,
    options: { forceRefresh?: boolean } = {},
  ) => {
    const refreshedSlots = await fetchDisplayAvailabilitySlots(
      restaurantId,
      selectedBookingDate,
      partyCount,
      time,
      options,
    );
    setAvailabilityByRestaurantId((prev) => ({
      ...prev,
      [restaurantId]: refreshedSlots,
    }));
    return refreshedSlots;
  };

  const handleSlotClick = async (
    r: RestaurantCard,
    slot: string,
    selectedPartySize = partySize,
    shiftId?: string,
    _displayTime?: string,
    bookingDate?: string,
    _options: { optimistic?: boolean } = {},
  ) => {
    const backQuery = isDashboardPreview ? "&back=dashboard" : "";
    const slotDate = bookingDate
      ?? dateParamFromSelection(dateId, customDate);
    const partyCount = normalizePartySize(selectedPartySize);
    const navigateToSlot = (
      nextSlot: string,
      nextShiftId: string | undefined,
      nextDisplayTime: string | undefined,
      state?: unknown,
    ) => {
      const shiftQuery = nextShiftId ? `&shift_id=${encodeURIComponent(nextShiftId)}` : "";
      const timeParam = nextDisplayTime
        ? formatCompactTimeLabel(nextDisplayTime)
        : formatCompactTimeLabel(nextSlot);
    navigate(
        `/${r.slug ?? r.id}?slot=${encodeURIComponent(nextSlot)}&time=${encodeURIComponent(timeParam)}&people=${partyCount}&date=${encodeURIComponent(slotDate)}${shiftQuery}${backQuery}`,
        state ? { state } : undefined,
      );
    };

    // Always re-check availability against the live cache before navigating
    // to checkout — even when the click came from the preview modal's
    // confirm. The `optimistic` flag used to skip this and was the source of
    // "the slot was already taken when I got to checkout" reports.
    const refreshed = await fetchAvailabilitySlots(r.id, slotDate, partyCount, { forceRefresh: true })
      .catch(() => null);
    const refreshedSlot = refreshed?.slots.find((candidate) =>
      candidate.date_time === slot && (!shiftId || candidate.shift_id === shiftId),
    );
    if (!refreshedSlot) {
      const refreshedDisplaySlots = await refreshRestaurantDisplaySlots(r.id, partyCount, { forceRefresh: true });
      setPreviewAvailabilityNotice(
        refreshed?.message ?? "That time is no longer available. Pick another time.",
      );
      setPreviewRestaurant({
        ...r,
        availableSlots: refreshedDisplaySlots,
      });
      return;
    }
    navigateToSlot(refreshedSlot.date_time, refreshedSlot.shift_id, refreshedSlot.display_time);
  };

  const openRestaurantPreview = (r: RestaurantCard) => {
    setPreviewAvailabilityNotice(null);
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

  useEffect(() => {
    if (view !== "map") {
      void Promise.resolve().then(() => setMapEdgeMode(false));
      return;
    }
    const checkScroll = () => {
      const sentinel = searchSentinelRef.current;
      if (!sentinel) return;
      const rect = sentinel.getBoundingClientRect();
      setMapEdgeMode(rect.top <= 88);
    };
    checkScroll();
    window.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      window.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [view, filtersOpen]);

  const featured = filtered.slice(0, 4);
  const dateNight = filtered.slice(4, 8).length === 4 ? filtered.slice(4, 8) : filtered.slice(0, 4);
  const newOnCenaiva =
    filtered.slice(8, 12).length === 4 ? filtered.slice(8, 12) : filtered.slice(-4);

  // Rail title reflects whatever date the cards are actually showing. When
  // auto-roll has advanced past the user's selection, the rail's slot
  // pills are for `effectiveBookingDate` (e.g. Fri, May 15), not for
  // tonight — keeping the "tonight" label here would misrepresent the
  // data the user sees right below it.
  const availableRowTitle = useMemo(() => {
    if (autoRollOffsetDays === 0) return "Available tonight near you";
    const d = new Date(`${effectiveBookingDate}T00:00:00`);
    if (autoRollOffsetDays <= 6) {
      return `Available ${format(d, "EEEE")} near you`;
    }
    return `Available ${format(d, "EEE, MMM d")} near you`;
  }, [autoRollOffsetDays, effectiveBookingDate]);

  // Short day-only label used as a suffix on the OTHER rail titles when
  // auto-roll has fired. Without this, "Date night picks" and "New on
  // Cenaiva" silently show slot pills for the rolled-to date (e.g. May 15
  // 5pm) while their titles still imply "tonight" — the user reads "5pm"
  // on May 14 and assumes it's today's 5pm. The suffix turns the rail
  // into "Date night picks · Fri, May 15" so the date is unambiguous.
  const rolledDateSuffix = useMemo(() => {
    if (autoRollOffsetDays === 0) return null;
    const d = new Date(`${effectiveBookingDate}T00:00:00`);
    if (autoRollOffsetDays <= 6) return format(d, "EEEE");
    return format(d, "EEE, MMM d");
  }, [autoRollOffsetDays, effectiveBookingDate]);

  const dateNightRowTitle = rolledDateSuffix
    ? `Date night picks · ${rolledDateSuffix}`
    : "Date night picks";
  const newOnCenaivaRowTitle = rolledDateSuffix
    ? `New on Cenaiva · ${rolledDateSuffix}`
    : "New on Cenaiva";
  const bookedUpRowTitle = rolledDateSuffix
    ? `Booked up ${rolledDateSuffix} — try another night`
    : "Booked up tonight — try another night";

  const greetingName = profile?.full_name?.split(" ")[0] ?? "guest";

  const today = new Date();
  const headerCityPart = userCityLabel ? ` · ${userCityLabel.toUpperCase()}` : "";
  const headerEyebrow = `${today.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase()} · ${today
    .toLocaleDateString("en-US", { month: "long", day: "numeric" })
    .toUpperCase()}${headerCityPart}`;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/85 backdrop-blur-xl">
        <div className="flex h-[5.5rem] w-full items-center px-4 sm:px-5">
          <Link to="/" className="flex shrink-0 items-center" aria-label="Cenaiva home">
            <CenaivaWordmark />
          </Link>

          <CustomerNav />

          <div className="ml-auto flex shrink-0 items-center gap-4">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="relative inline-flex size-11 items-center justify-center rounded-full border border-border bg-bg-surface/70 text-text-secondary transition-colors hover:border-gold/40 hover:text-white"
                  aria-label="Notifications"
                >
                  <Bell className="size-5" />
                  {unreadCount + pendingStaffInvites.length > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 font-mono text-[11px] font-bold text-black">
                      {Math.min(unreadCount + pendingStaffInvites.length, 9)}
                    </span>
                  ) : null}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 border-border bg-bg-elevated p-0 text-text-primary">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <div>
                    <p className="font-serif text-lg text-white">Notifications</p>
                    <p className="text-xs text-text-muted">Invites and account updates</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate("/notifications")}
                    className="text-xs font-medium text-gold transition-colors hover:text-gold/80"
                  >
                    View all
                  </button>
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

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="rounded-full outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-gold/40"
                    aria-label={t("routes.account.title")}
                  >
                    <Avatar className="size-11">
                      <AvatarImage src={profile?.avatar_url ?? undefined} />
                      <AvatarFallback className="bg-gold/10 text-sm text-gold">{initials}</AvatarFallback>
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
                  <DropdownMenuItem onClick={() => void navigate("/setup?new=1")}>
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
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void navigate("/login?from=/discover")}
                  className="text-sm font-medium text-text-secondary transition-colors hover:text-white"
                >
                  Log in
                </button>
                <Button
                  type="button"
                  size="sm"
                  className="rounded-full px-5 font-semibold"
                  onClick={() => void navigate("/register?from=/discover")}
                >
                  Sign up
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="w-full px-12 py-10 sm:px-16 md:px-20 lg:px-24 xl:px-32 2xl:px-40 lg:py-12">
        <DiscoverReviewBanner />
        <div className="text-center">
        <SectionEyebrow>{headerEyebrow}</SectionEyebrow>
        <h1 className="mt-4 font-serif text-5xl leading-[1.05] text-white sm:text-6xl">
          Good evening, <span className="capitalize">{greetingName}</span>.
        </h1>
        <p className="mt-3 text-base text-text-secondary">
          {filteredAll.length} restaurant{filteredAll.length === 1 ? "" : "s"} on Cenaiva.
        </p>
        </div>

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
        <div ref={searchSentinelRef} aria-hidden className="h-px w-full" />

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

                <div className="mt-6 flex flex-wrap gap-3 [&>*]:min-w-[12rem] [&>*]:flex-1">
                  {/* Date picker */}
                  <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                                <PopoverTrigger asChild>
                      <button type="button" className="text-left">
                        <FilterPickerButton
                          icon={CalendarDays}
                          label="Date"
                          value={(() => {
                            if (pendingDateId === "custom" && pendingCustomDate) {
                              return format(pendingCustomDate, "EEE · MMM d");
                            }
                            return datePresets.find((p) => p.id === pendingDateId)?.label ?? "Pick a date";
                          })()}
                          active={pendingDateId !== "today"}
                        />
                                  </button>
                                </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-3">
                                  <Calendar
                                    mode="single"
                        selected={pendingCustomDate ?? new Date()}
                                    onSelect={(d) => {
                                      if (d) {
                            setPendingCustomDate(d);
                            setPendingDateId("custom");
                            setDatePickerOpen(false);
                          }
                        }}
                        disabled={(date) => {
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          return date < today;
                        }}
                        className="p-0 [--cell-size:2.75rem] text-base"
                        classNames={{
                          month_caption: "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size) text-base font-semibold text-white",
                          weekday: "flex-1 text-text-muted font-mono text-xs uppercase tracking-wider",
                          day: "relative size-(--cell-size) p-0 text-center text-sm",
                                    }}
                                    initialFocus
                                  />
                                </PopoverContent>
                              </Popover>

                  {/* Time picker */}
                  <Popover open={timePickerOpen} onOpenChange={setTimePickerOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" className="text-left">
                        <FilterPickerButton
                          icon={Clock}
                          label="Time"
                          value={pendingTime}
                          active={pendingTime !== getNearestUpcomingHalfHour()}
                        />
                            </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-44 p-2">
                      <ScrollWheelPicker
                        items={TIME_OPTIONS}
                        value={pendingTime}
                        onChange={setPendingTime}
                      />
                      <div className="mt-2 flex justify-end">
                        <Button
                          size="sm"
                          onClick={() => setTimePickerOpen(false)}
                          className="h-8 px-3 text-xs"
                        >
                          Done
                        </Button>
                  </div>
                    </PopoverContent>
                  </Popover>

                  {/* Party size picker */}
                  <Popover open={partyPickerOpen} onOpenChange={setPartyPickerOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" className="text-left">
                        <FilterPickerButton
                          icon={Users}
                          label="Party size"
                          value={
                            /^\d+$/.test(pendingPartySize)
                              ? `${pendingPartySize} ${pendingPartySize === "1" ? "guest" : "guests"}`
                              : pendingPartySize
                          }
                          active={pendingPartySize !== "2"}
                        />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-40 p-2">
                      <ScrollWheelPicker
                        items={PARTY_SIZES.map(String)}
                        value={pendingPartySize}
                        onChange={setPendingPartySize}
                        formatLabel={(v) =>
                          /^\d+$/.test(v) ? `${v} ${v === "1" ? "guest" : "guests"}` : v
                        }
                      />
                      <div className="mt-2 flex justify-end">
                        <Button
                          size="sm"
                          onClick={() => setPartyPickerOpen(false)}
                          className="h-8 px-3 text-xs"
                        >
                          Done
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>

                  {/* Radius picker */}
                  <Popover open={radiusPickerOpen} onOpenChange={setRadiusPickerOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" className="text-left">
                        <FilterPickerButton
                          icon={LocateFixed}
                          label="Radius"
                          value={
                            userLocation
                              ? radiusLabel(pendingRadius)
                              : locationStatus === "denied"
                                ? "Location blocked"
                                : "Tap to enable"
                          }
                          active={!!userLocation && pendingRadius !== "anywhere"}
                        />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-56 p-3">
                      {userLocation ? (
                        <>
                          <ScrollWheelPicker
                            items={RADIUS_OPTIONS}
                            value={pendingRadius}
                            onChange={setPendingRadius}
                            formatLabel={radiusLabel}
                          />
                          <div className="mt-2 flex justify-end">
                            <Button
                              size="sm"
                              onClick={() => setRadiusPickerOpen(false)}
                              className="h-8 px-3 text-xs"
                            >
                              Done
                            </Button>
                    </div>
                        </>
                      ) : (
                        <div className="space-y-3 text-center">
                          <div className="mx-auto flex size-9 items-center justify-center rounded-full bg-gold/15">
                            <LocateFixed className="size-4 text-gold" />
                  </div>
                          <p className="text-sm font-medium text-white">
                            {locationStatus === "denied"
                              ? "Location is blocked"
                              : "Find restaurants near you"}
                          </p>
                          <p className="text-xs text-text-secondary">
                            {locationStatus === "denied"
                              ? "Allow location for this site in your browser settings, then try again."
                              : "We'll ask your browser for permission to use your location."}
                          </p>
                          <button
                            type="button"
                            disabled={locationStatus === "requesting" || locationStatus === "unsupported"}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              if (!("geolocation" in navigator)) {
                                setLocationStatus("unsupported");
                                return;
                              }
                              setLocationStatus("requesting");
                              navigator.geolocation.getCurrentPosition(
                                (position) => {
                                  setUserLocation({
                                    lat: position.coords.latitude,
                                    lng: position.coords.longitude,
                                  });
                                  setLocationStatus("allowed");
                                },
                                (error) => {
                                  console.warn("Geolocation request failed", error);
                                  setLocationStatus("denied");
                                },
                                { enableHighAccuracy: true, timeout: 10_000, maximumAge: 300_000 },
                              );
                            }}
                            className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-gold px-3 text-xs font-semibold text-black transition-colors hover:bg-gold/90 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <LocateFixed className="size-3.5" />
                            {locationStatus === "requesting"
                              ? "Requesting…"
                              : locationStatus === "denied"
                                ? "Try again"
                                : "Enable location"}
                          </button>
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                    </div>

                <div className="mt-6 grid gap-8 lg:grid-cols-2">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
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
                    onClick={applyFilters}
                    className="h-11 rounded-md px-6 font-semibold"
                  >
                    Done
                  </Button>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Auto-rolled date banner: shows when we advanced past a fully-booked
            "today" because nothing had availability. Only renders when there's
            actually a non-empty list to display — avoids stacking with the
            empty-state card below when even auto-roll exhausted. */}
        {autoRollOffsetDays > 0 && !listingLoading && filtered.length > 0 && (
          <div className="mt-6 flex flex-col items-center justify-center gap-1 rounded-xl border border-gold/30 bg-gold/5 px-4 py-3 text-center text-sm text-text-secondary">
            <span>
              No availability for {format(new Date(`${selectedBookingDate}T00:00:00`), "EEE, MMM d")}.
              Showing <span className="font-medium text-white">{format(new Date(`${effectiveBookingDate}T00:00:00`), "EEE, MMM d")}</span> instead.
            </span>
            {bookingsInRolledWindow > 0 && (
              <span className="text-xs text-text-tertiary">
                You already have {bookingsInRolledWindow} booking{bookingsInRolledWindow === 1 ? "" : "s"} on
                {" "}{bookingsInRolledWindow === 1 ? "that day" : "those days"} — they may be holding tables.{" "}
                <Link to="/bookings" className="underline underline-offset-2 hover:text-white">
                  Review your bookings
                </Link>
              </span>
            )}
          </div>
        )}

        {/* Loading */}
        {listingLoading && (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-[420px] animate-pulse rounded-2xl border border-border bg-bg-surface"
              />
            ))}
          </div>
        )}

        {/* Empty — gate on filteredAll so the page only goes empty when NO
            restaurants (bookable or otherwise) match the search/filter. */}
        {!listingLoading && filteredAll.length === 0 && (
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

        {/* Grid view — render whenever ANY restaurants match (bookable or
            booked-up). The "Available tonight" rail only renders when there
            ARE bookable restaurants; the "Booked up tonight" rail covers the
            rest so the user can still discover them and pick a different
            night. */}
        {!listingLoading && filteredAll.length > 0 && view === "grid" && (() => {
          const rows = [
            ...(filtered.length > 0
              ? [{ key: "available", eyebrow: "Curated", title: availableRowTitle, pool: filtered, preview: featured }]
              : []),
            ...(bookedUpTonightPool.length > 0
              ? [{ key: "booked-up", eyebrow: "Tonight", title: bookedUpRowTitle, pool: bookedUpTonightPool, preview: bookedUpTonightPool.slice(0, 4) }]
              : []),
            { key: "date-night", eyebrow: "Curated", title: dateNightRowTitle, pool: filtered, preview: dateNight },
            { key: "new", eyebrow: "Curated", title: newOnCenaivaRowTitle, pool: filtered, preview: newOnCenaiva },
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
                          saved={savedRestaurants.has(r.id)}
                          onToggleFav={() => toggleFavorite(r.id)}
                          onToggleSave={() => toggleSavedRestaurant(r.id)}
                          onBookSlot={(slot) => void handleSlotClick(r, slot.date_time, partySize, slot.shift_id, slot.display_time, slot.booking_date)}
                          onOpen={() => openRestaurantPreview(r)}
                          notifyDefaults={{
                            date: selectedBookingDate,
                            time,
                            partySize: selectedPartySize,
                          }}
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
        {!listingLoading && filtered.length > 0 && view === "map" && (
          <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(420px,1fr)]">
            <div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-text-secondary">
                  <span className="font-serif text-xl text-white">{filtered.length}</span>{" "}
                  restaurants · sorted by <span className="text-gold">{userLocation ? "Nearest" : "Best match"}</span>
                </p>
                <p className="hidden text-xs text-text-muted sm:block">
                  {locationStatus === "requesting" ? "Requesting location..." : "Hover to highlight on map"}
                </p>
              </div>
              <div className="mt-4 space-y-4">
                {filtered.map((r) => (
                  <MapListCard
                    key={r.id}
                    r={r}
                    favorite={favorites.has(r.id)}
                    saved={savedRestaurants.has(r.id)}
                    onToggleFav={() => toggleFavorite(r.id)}
                    onToggleSave={() => toggleSavedRestaurant(r.id)}
                    onBookSlot={(slot) => void handleSlotClick(r, slot.date_time, partySize, slot.shift_id, slot.display_time, slot.booking_date)}
                    onHover={setHoveredId}
                    highlighted={selectedId === r.id}
                    onSelect={() => setSelectedId(r.id)}
                  />
                ))}
              </div>
            </div>

            {/* Map area — self-start so sticky locks to viewport inside grid (tall list row) */}
            <div
              className={cn(
                "lg:sticky lg:top-[5.5rem] lg:z-10 lg:h-[calc(100vh-5.5rem)] lg:self-start lg:transition-[margin] lg:duration-300 lg:ease-out",
                mapEdgeMode && "lg:-mr-24 xl:-mr-32 2xl:-mr-40",
              )}
            >
              <div
                className={cn(
                  "relative h-[560px] overflow-hidden rounded-2xl border border-border bg-bg-surface lg:h-full lg:transition-[border-radius,border-width] lg:duration-300",
                  mapEdgeMode && "lg:rounded-r-none lg:border-r-0",
                )}
              >
                <GoogleDiscoverMap
                  restaurants={filtered}
                  selectedId={selectedId}
                  hoveredId={hoveredId}
                  userLocation={userLocation}
                  onSelect={setSelectedId}
                  onHover={setHoveredId}
                />

                {/* Re-center */}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    setLocationStatus("geolocation" in navigator ? "idle" : "unsupported");
                  }}
                  className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-surface/90 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:border-gold/40"
                >
                  <LocateFixed className="size-3.5 text-gold" />
                  {userLocation ? "Use my location" : "Find near me"}
                </button>
                {locationStatus === "denied" || locationStatus === "unsupported" ? (
                  <div className="absolute left-4 right-4 top-16 rounded-xl border border-border bg-bg-surface/90 px-3 py-2 text-xs text-text-secondary backdrop-blur sm:right-auto sm:max-w-sm">
                    Location is unavailable. Search by city or restaurant name to browse manually.
                  </div>
                ) : null}

                {/* Hover/selected restaurant popup */}
                {(() => {
                  const previewId = selectedId ?? hoveredId;
                  if (!previewId) return null;
                  const r = filtered.find((x) => x.id === previewId);
                    if (!r) return null;
                    return (
                    <MapRestaurantPopup
                      restaurant={r}
                      favorite={favorites.has(r.id)}
                      saved={savedRestaurants.has(r.id)}
                      onBookSlot={(slot) => void handleSlotClick(r, slot.date_time, partySize, slot.shift_id, slot.display_time, slot.booking_date)}
                      onClose={() => {
                        setSelectedId(null);
                        setHoveredId(null);
                      }}
                      onToggleFavorite={() => toggleFavorite(r.id)}
                      onToggleSave={() => toggleSavedRestaurant(r.id)}
                      onOpenPreview={() => openRestaurantPreview(r)}
                      notifyDefaults={{
                        date: selectedBookingDate,
                        time,
                        partySize: selectedPartySize,
                      }}
                    />
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
        availabilityNotice={previewAvailabilityNotice}
        onClose={() => {
          if (isDashboardPreview) {
            navigate("/dashboard");
            return;
          }
          setPreviewAvailabilityNotice(null);
          setPreviewRestaurant(null);
          // The user just saw a per-restaurant view, which fetches fresh
          // availability + subscribes to realtime invalidation. If their
          // intent was "let me double-check whether the banner is right,"
          // we should now reconcile Discover's snapshot with whatever they
          // just saw — bump the tick so the next paint reflects current
          // reality rather than the stale "0 slots today" that triggered
          // the banner. Also reset auto-roll so the user's original date
          // gets re-checked (the modal may have shown them slots Discover
          // missed earlier in the session).
          setAutoRollOffsetDays(0);
          setAvailabilityRefreshTick((t) => t + 1);
        }}
        onToggleFavorite={() => {
          if (activePreviewRestaurant) toggleFavorite(activePreviewRestaurant.id);
        }}
        onReserve={(slot, selectedPartySize, shiftId, displayTime, bookingDate, options) => {
          if (activePreviewRestaurant) {
            setPartySize(selectedPartySize);
            return handleSlotClick(activePreviewRestaurant, slot, selectedPartySize, shiftId, displayTime, bookingDate, options);
          }
          return undefined;
        }}
      />
    </div>
  );
}
