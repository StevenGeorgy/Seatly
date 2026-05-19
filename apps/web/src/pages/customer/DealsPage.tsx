import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  CalendarDays,
  Flame,
  Heart,
  LayoutGrid,
  LocateFixed,
  LogOut,
  Map as MapIcon,
  Search,
  Settings,
  SlidersHorizontal,
  Tag,
  User,
  Clock,
  Users,
  X,
} from "lucide-react";

import { useUser } from "@/hooks/useUser";
import { useMyReservations } from "@/hooks/useMyReservations";
import { usePublicRestaurants, type Restaurant } from "@/hooks/useRestaurant";
import { useRestaurantPreviewStatsByRestaurantIds } from "@/hooks/useRestaurantPreviewStats";
import { fetchAvailabilitySlots, type AvailabilitySlot } from "@/hooks/useAvailability";
import {
  fetchEventById,
  useAllActiveEvents,
  type EventWithRestaurant,
} from "@/hooks/useEvents";
import {
  fetchPromotionById,
  useAllActivePromotions,
  type PromotionWithRestaurant,
} from "@/hooks/usePromotions";
import { useStaffRestaurants } from "@/hooks/useStaffRestaurants";
import { EventPromotionDetailDialog } from "@/components/customer/EventPromotionDetailCard";
import { CenaivaWordmark } from "@/components/brand/CenaivaWordmark";
import { CustomerNav } from "@/components/customer/CustomerNav";
import { CustomerBellDropdown } from "@/components/customer/CustomerBellDropdown";
import { NotifyMeButton } from "@/components/customer/NotifyMeButton";
import { ScrollWheelPicker } from "@/components/customer/ScrollWheelPicker";
import { StaffWorkspaceMenuItems } from "@/components/customer/StaffWorkspaceMenuItems";
import {
  RestaurantPreviewModal,
  type RestaurantPreviewSummary,
} from "@/components/customer/RestaurantPreviewModal";
import {
  fetchDisplayAvailabilitySlots,
  fetchDisplayAvailabilitySlotsForRestaurants,
  normalizePartySize,
} from "@/lib/customer/availabilityFilters";
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
import { formatCompactTimeLabel } from "@/lib/utils/time";
import { hasGoogleMapsApiKey, loadGoogleMaps, type GoogleMapsMarker, type GoogleMapsNamespace } from "@/lib/google-maps";
import {
  eventToDisplay,
  promotionToDisplay,
  type EventPromotionDisplay,
} from "@/lib/customer/eventPromotionDisplay";
import { restaurantPriceLabelFromRange } from "@/lib/restaurant-price-level";
import { MarkerClusterer, type Cluster, type Renderer } from "@googlemaps/markerclusterer";

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
  availability: string;
  restaurant: string;
  restaurantId: string;
  title: string;
  when: string;
  price: string;
  initials: string;
  imageUrl: string | null;
  city: string;
  category: "Tonight" | "This Weekend" | "This Week";
  detail: EventPromotionDisplay;
  lat: number | null;
  lng: number | null;
  availableSlots: AvailabilitySlot[];
  // Derived flags for rail routing. `isSoldOut` covers ticketed events whose
  // tickets_sold has caught up to capacity. `isPast` covers events whose
  // end_time has elapsed (so finished events don't squat at the top of the
  // page). `daysUntilExpiry` is non-null only for promotions and feeds the
  // "Expiring soon" rail to surface deals that are about to disappear.
  isSoldOut: boolean;
  isPast: boolean;
  daysUntilExpiry: number | null;
};

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

const TIME_OPTIONS = (() => {
  const out: string[] = [];
  for (let h = 6; h < 24; h += 1) {
    for (const m of [0, 30] as const) out.push(formatTimeOption(h, m));
  }
  return out;
})();
const PRICE_OPTIONS = ["$", "$$", "$$$", "$$$$"];
const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, "8+"] as const;
const RADIUS_OPTIONS = (() => {
  const steps: (number | "anywhere")[] = [];
  for (let km = 5; km <= 150; km += 5) steps.push(km);
  steps.push("anywhere");
  return steps;
})();
type RadiusOption = (typeof RADIUS_OPTIONS)[number];
const PRICE_FOR_TYPE: Record<string, string> = {
  "Tasting Menu": "$$$$",
  "Happy Hour": "$",
  Event: "$$$",
  "Prix Fixe": "$$",
  Promotion: "$$",
  Wine: "$$$",
  Brunch: "$$",
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
};

function radiusLabel(value: RadiusOption): string {
  return value === "anywhere" ? "Anywhere" : `${value} km`;
}

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

function getNearestUpcomingHalfHour(): string {
  const now = new Date();
  let h = now.getHours();
  let m = now.getMinutes();
  if (m === 0 || m === 30) {
    // exact slot
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

function dateParamFromSelection(dateId: string, customDate: Date | undefined): string {
  if (dateId === "custom" && customDate) return format(customDate, "yyyy-MM-dd");
  const today = new Date();
  if (dateId === "tomorrow") return format(addDays(today, 1), "yyyy-MM-dd");
  if (dateId === "sat") return format(addDays(today, (6 - today.getDay() + 7) % 7 || 7), "yyyy-MM-dd");
  return format(today, "yyyy-MM-dd");
}

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

function priceFromRange(range?: number | null): string {
  return restaurantPriceLabelFromRange(range);
}

function restaurantInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).join(" ").toUpperCase() || "RESTAURANT";
}

function adaptRestaurantPreview(
  restaurant: Restaurant,
  stats: { bookedToday: number; avgRating: number | null; totalReviews: number },
): RestaurantPreviewSummary {
  return {
    id: restaurant.id,
    slug: restaurant.slug,
    name: restaurant.name,
    cuisine: restaurant.cuisine_type ?? "",
    price: priceFromRange(restaurant.price_range),
    area: restaurant.city ?? restaurant.address ?? "",
    bookedToday: stats.bookedToday,
    slots: [],
    initials: restaurantInitials(restaurant.name),
    badge: restaurant.business_type ?? "",
    city: restaurant.city ?? "",
    features: [restaurant.cuisine_type, restaurant.business_type, restaurant.city].filter(Boolean) as string[],
    logoUrl: restaurant.logo_url,
    coverPhotoUrl: restaurant.cover_photo_url,
    avgRating: stats.avgRating,
    totalReviews: stats.totalReviews,
  };
}

const TYPE_BADGE_LABEL: Record<EventType, string> = {
  "Tasting Menu": "TASTING MENU",
  "Happy Hour": "HAPPY HOUR",
  Event: "EVENT",
  "Prix Fixe": "PRIX FIXE",
  Promotion: "PROMOTION",
  Wine: "WINE EVENT",
  Brunch: "BRUNCH",
};

// Combine an event's `date` (yyyy-MM-dd) and `end_time` (HH:MM[:SS]) into a
// JS Date. Returns null when either input is missing or unparseable. Uses
// browser-local timezone — fine for the dominant case (user + restaurant in
// the same city); off by an hour or two in cross-region cases, which is
// acceptable for past-event filtering.
function combineDateTime(dateStr: string | null, timeStr: string | null): Date | null {
  if (!dateStr) return null;
  const time = timeStr && /^\d{1,2}:\d{2}/.test(timeStr) ? timeStr.slice(0, 5) : "23:59";
  const d = new Date(`${dateStr}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function adaptPromotion(p: PromotionWithRestaurant): DemoEvent {
  const detail = promotionToDisplay(p);
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
  let priceLabel = detail.priceLabel;
  if (p.discount_unit === "percent" && p.discount_value)
    priceLabel = `Save ${p.discount_value}%`;
  if (p.discount_unit === "dollar" && p.discount_value)
    priceLabel = `Save $${p.discount_value}`;

  const expiry = p.ends_at ? new Date(p.ends_at) : null;
  const when = expiry
    ? `Ends ${expiry.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`
    : "Limited time";

  const isPast = expiry ? expiry.getTime() < Date.now() : false;
  const daysUntilExpiry = expiry
    ? Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;

  return {
    id: `promotion-${p.id}`,
    type,
    availability: detail.availabilityLabel,
    restaurant: p.restaurants.name,
    restaurantId: p.restaurants.id,
    title: p.title,
    when,
    price: priceLabel,
    initials,
    imageUrl: detail.imageUrl,
    city: p.restaurants.city ?? "—",
    category: "This Week",
    detail,
    lat: p.restaurants.lat,
    lng: p.restaurants.lng,
    availableSlots: [],
    isSoldOut: false,
    isPast,
    daysUntilExpiry,
  };
}

function adaptEvent(event: EventWithRestaurant): DemoEvent {
  const detail = eventToDisplay(event);
  const theme = event.theme?.toLowerCase() ?? "";
  let type: EventType = "Event";
  if (theme.includes("tasting")) type = "Tasting Menu";
  else if (theme.includes("wine")) type = "Wine";
  else if (theme.includes("prix")) type = "Prix Fixe";
  else if (theme.includes("brunch")) type = "Brunch";

  // Sold-out: capacity tracked AND tickets caught up. Free-capacity events
  // (capacity = null) never count as sold out.
  const isSoldOut = detail.seatsLeft != null && detail.seatsLeft <= 0;

  // Past: combine date + end_time (falls back to 23:59) and compare to now.
  // `event.end_date` covers multi-day events — if it's set and in the future
  // the event isn't past.
  const lastDate = event.end_date ?? event.date;
  const endDt = combineDateTime(lastDate, event.end_time ?? event.start_time);
  const isPast = endDt != null && endDt.getTime() < Date.now();

  return {
    id: `event-${event.id}`,
    type,
    availability: detail.availabilityLabel,
    restaurant: event.restaurants.name,
    restaurantId: event.restaurants.id,
    title: event.name,
    when: `${detail.dateLabel} · ${detail.timeLabel}`,
    price: detail.priceLabel,
    initials: detail.imageLabel,
    imageUrl: detail.imageUrl,
    city: event.restaurants.city ?? "—",
    category: "This Week",
    detail,
    lat: event.restaurants.lat,
    lng: event.restaurants.lng,
    availableSlots: [],
    isSoldOut,
    isPast,
    daysUntilExpiry: null,
  };
}

function StripePlaceholder({
  label,
  imageUrl,
  className,
}: {
  label: string;
  imageUrl?: string | null;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden bg-bg-base",
        className,
      )}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />
      ) : (
        <>
          <div
            aria-hidden
            className="absolute inset-0 bg-[repeating-linear-gradient(135deg,var(--gold)_0_1px,transparent_1px_16px)] opacity-20"
          />
          <div className="size-9 rounded-full bg-gold/40 ring-4 ring-black/30" />
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-[0.3em] text-gold/70">
            {label}
          </span>
        </>
      )}
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

function AvailableTimes({
  slots,
  onBookSlot,
  size = "md",
}: {
  slots: AvailabilitySlot[];
  onBookSlot: (slot: AvailabilitySlot) => void;
  size?: "sm" | "md" | "lg";
}) {
  const visibleSlots = slots.slice(0, 6);
  if (visibleSlots.length === 0) return null;
  return (
    <div
      className={cn(
        "grid grid-cols-3",
        size === "lg" ? "gap-2.5" : size === "sm" ? "gap-1.5" : "gap-2",
      )}
    >
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
              : size === "sm"
                ? "min-h-9 px-1.5 text-xs"
                : "min-h-11 px-2 text-sm",
          )}
        >
          {formatCompactTimeLabel(slot.display_time)}
        </button>
      ))}
    </div>
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

const CENAIVA_MAP_STYLES: Array<Record<string, unknown>> = [
  { elementType: "geometry", stylers: [{ color: "#0A0A0A" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#AAAAAA" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0A0A0A" }, { weight: 4 }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#2E2E2E" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#F5E6C8" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#F5E6C8" }] },
  { featureType: "administrative.neighborhood", elementType: "labels.text.fill", stylers: [{ color: "#C9A84C" }] },
  { featureType: "landscape.man_made", elementType: "geometry.fill", stylers: [{ color: "#242424" }] },
  { featureType: "landscape.man_made", elementType: "geometry.stroke", stylers: [{ color: "#A8873A" }, { weight: 0.6 }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#0F0F0F" }] },
  { featureType: "landscape.natural.terrain", elementType: "geometry", stylers: [{ color: "#121412" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#888888" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#0F1A12" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#A8873A" }] },
  { featureType: "poi.business", elementType: "labels.text.fill", stylers: [{ color: "#AAAAAA" }] },
  { featureType: "poi.medical", stylers: [{ visibility: "off" }] },
  { featureType: "poi.school", stylers: [{ visibility: "off" }] },
  { featureType: "poi.government", stylers: [{ visibility: "off" }] },
  { featureType: "poi.place_of_worship", stylers: [{ visibility: "off" }] },
  { featureType: "poi.sports_complex", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#1A1A1A" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0A0A0A" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#888888" }] },
  { featureType: "road", elementType: "labels.text.stroke", stylers: [{ color: "#0A0A0A" }, { weight: 3 }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "road.highway", elementType: "geometry.fill", stylers: [{ color: "#2E2E2E" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#0A0A0A" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#C9A84C" }] },
  { featureType: "road.arterial", elementType: "geometry.fill", stylers: [{ color: "#242424" }] },
  { featureType: "road.arterial", elementType: "labels.text.fill", stylers: [{ color: "#AAAAAA" }] },
  { featureType: "road.local", elementType: "geometry.fill", stylers: [{ color: "#1F1F1F" }] },
  { featureType: "road.local", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0A1320" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#5C7088" }] },
];

function priceLevelFromLabel(label: string): number | null {
  const count = (label.match(/\$/g) ?? []).length;
  return count > 0 ? count : null;
}

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
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'><defs><filter id='${filterId}' x='-50%' y='-50%' width='200%' height='200%'><feDropShadow dx='0' dy='2' stdDeviation='2' flood-color='#000000' flood-opacity='0.55'/></filter></defs><circle cx='${cx}' cy='${cy}' r='${r}' fill='${fill}' stroke='${stroke}' stroke-width='${strokeWidth}' filter='url(#${filterId})'/></svg>`;
    return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, size: { width: size, height: size } };
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
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' viewBox='0 0 ${width} ${height}'><defs><filter id='${filterId}' x='-50%' y='-50%' width='200%' height='200%'><feDropShadow dx='0' dy='2' stdDeviation='2' flood-color='#000000' flood-opacity='0.55'/></filter></defs><rect x='${strokeWidth / 2}' y='${strokeWidth / 2}' width='${width - strokeWidth}' height='${height - strokeWidth}' rx='${height / 2}' ry='${height / 2}' fill='${fill}' stroke='${stroke}' stroke-width='${strokeWidth}' filter='url(#${filterId})'/><text x='50%' y='50%' dominant-baseline='central' text-anchor='middle' font-family='ui-monospace, SFMono-Regular, Menlo, monospace' font-weight='700' font-size='${fontSize}' fill='${textColor}'>${dollars}</text></svg>`;
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, size: { width, height } };
}

function clusterIconSvg(count: number): { url: string; size: number } {
  const size = count >= 50 ? 56 : count >= 10 ? 48 : 40;
  const cx = size / 2;
  const cy = size / 2;
  const halo = size / 2 - 2;
  const r = size / 2 - 7;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'><defs><filter id='cs' x='-50%' y='-50%' width='200%' height='200%'><feDropShadow dx='0' dy='2' stdDeviation='2.5' flood-color='#000000' flood-opacity='0.55'/></filter></defs><circle cx='${cx}' cy='${cy}' r='${halo}' fill='rgba(201,168,76,0.16)' stroke='rgba(245,230,200,0.35)' stroke-width='1.5'/><circle cx='${cx}' cy='${cy}' r='${r}' fill='#C9A84C' stroke='#0A0A0A' stroke-width='2' filter='url(#cs)'/></svg>`;
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, size };
}

function GoogleDealsMap({
  events,
  selectedId,
  hoveredId,
  userLocation,
  onSelect,
  onHover,
}: {
  events: DemoEvent[];
  selectedId: string | null;
  hoveredId: string | null;
  userLocation: GeoPoint | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMapInstance | null>(null);
  const markersRef = useRef<GoogleMapsMarker[]>([]);
  // Maps each `google.maps.Marker` instance to the event/promo id it represents.
  // Needed so the cluster-click handler can look up which events live in the
  // cluster (cluster.markers gives us markers, not ids) and decide whether to
  // auto-open the first event (single-restaurant cluster) or clear the popover
  // (mixed-restaurant cluster).
  const markerEventIdRef = useRef<Map<google.maps.Marker, string>>(new Map());
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const userMarkerRef = useRef<GoogleMapsMarker | null>(null);
  const googleReady = hasGoogleMapsApiKey();
  const mappableEvents = useMemo(
    () => events.filter((event) => event.lat != null && event.lng != null),
    [events],
  );

  useEffect(() => {
    if (!googleReady || !mapNodeRef.current) return;
    let cancelled = false;
    void loadGoogleMaps().then((maps) => {
      if (cancelled || !mapNodeRef.current) return;
      const center = userLocation ?? (
        mappableEvents[0]?.lat != null && mappableEvents[0]?.lng != null
          ? { lat: mappableEvents[0].lat, lng: mappableEvents[0].lng }
          : { lat: 43.6532, lng: -79.3832 }
      );
      mapRef.current = new maps.Map(mapNodeRef.current, {
        center,
        zoom: userLocation ? 13 : 11,
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
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [googleReady, mappableEvents, userLocation]);

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
    markerEventIdRef.current = new Map();

    markersRef.current = mappableEvents.map((event) => {
      const active = selectedId === event.id || hoveredId === event.id;
      const { url, size } = pinIconSvg({
        active,
        priceLevel: priceLevelFromLabel(PRICE_FOR_TYPE[event.type] ?? "$$"),
      });
      const marker = new maps.Marker({
        position: { lat: event.lat, lng: event.lng },
        title: `${event.restaurant} · ${event.title}`,
        icon: {
          url,
          scaledSize: new maps.Size(size.width, size.height),
          anchor: new maps.Point(size.width / 2, size.height / 2),
        },
        zIndex: active ? 999 : 1,
      });
      marker.addListener("click", () => onSelect(event.id));
      marker.addListener("mouseover", () => onHover(event.id));
      marker.addListener("mouseout", () => onHover(null));
      markerEventIdRef.current.set(marker as unknown as google.maps.Marker, event.id);
      return marker;
    });

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
      // Without a custom handler the library zooms into the cluster but does
      // NOT touch `selectedId`. That leaves the previous popover stuck on
      // screen at `bottom-4 left-4`, visually disconnected from the cluster
      // the user just clicked. We zoom AND reconcile state: open the first
      // event when the cluster is one restaurant (so the popover lines up);
      // clear state when the cluster mixes restaurants (so a stale popover
      // doesn't lie about which marker the user picked).
      onClusterClick: (_clickEvent, cluster, mapArg) => {
        if (cluster.bounds) {
          mapArg.fitBounds(cluster.bounds);
        }
        const idsInCluster = (cluster.markers ?? [])
          .map((m) => markerEventIdRef.current.get(m as google.maps.Marker))
          .filter((id): id is string => typeof id === "string");
        const eventsInCluster = mappableEvents.filter((e) => idsInCluster.includes(e.id));
        const restaurantIds = new Set(eventsInCluster.map((e) => e.restaurantId));
        if (restaurantIds.size === 1 && eventsInCluster.length > 0) {
          onSelect(eventsInCluster[0].id);
        } else {
          onSelect(null);
        }
      },
    });

    return () => {
      if (clustererRef.current) {
        clustererRef.current.clearMarkers();
        clustererRef.current = null;
      }
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
      markerEventIdRef.current = new Map();
    };
  }, [hoveredId, mappableEvents, onHover, onSelect, selectedId]);

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
  }, [userLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const selected = mappableEvents.find((event) => event.id === selectedId);
    if (selected?.lat == null || selected.lng == null) return;
    // Always pan to the picked marker, even if it's already in view. The
    // popover anchors at `bottom-4 left-4`; without an explicit pan, clicking
    // a pin near the upper-right would leave the popover feeling
    // disconnected from the click.
    map.panTo({ lat: selected.lat, lng: selected.lng });
  }, [mappableEvents, selectedId]);

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

function EventCard({
  e,
  saved,
  favoriteRestaurant,
  onToggleSave,
  onToggleFavoriteRestaurant,
  onBookSlot,
  onReserve,
  onOpen,
  onRestaurantOpen,
}: {
  e: DemoEvent;
  saved: boolean;
  favoriteRestaurant: boolean;
  onToggleSave: () => void;
  onToggleFavoriteRestaurant: () => void;
  onBookSlot: (slot: AvailabilitySlot) => void;
  onReserve: () => void;
  onOpen: () => void;
  onRestaurantOpen: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.4 }}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") onOpen();
      }}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-bg-surface transition-colors hover:border-gold/40"
    >
      <div className="relative">
        <StripePlaceholder label={e.initials} imageUrl={e.imageUrl} className="aspect-auto h-44 sm:h-48 xl:h-52" />
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <span className="rounded-md border border-gold/40 bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-gold backdrop-blur">
            {TYPE_BADGE_LABEL[e.type]}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-gold/40 bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-gold backdrop-blur">
            <Flame className="size-3" /> {e.availability}
          </span>
        </div>
        <div className="absolute right-3 top-3 flex items-center gap-2">
          <button
            type="button"
            onClick={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              onToggleFavoriteRestaurant();
            }}
            aria-label="Favorite restaurant"
            className="rounded-full border border-border bg-black/60 p-1.5 backdrop-blur transition-colors hover:border-gold/50"
          >
            <Heart className={cn("size-4", favoriteRestaurant ? "fill-gold text-gold" : "text-white")} />
          </button>
          <button
            type="button"
            onClick={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              onToggleSave();
            }}
            aria-label="Save"
            className="rounded-full border border-border bg-black/60 p-1.5 backdrop-blur transition-colors hover:border-gold/50"
          >
            <Bookmark className={cn("size-4", saved ? "fill-gold text-gold" : "text-white")} />
          </button>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <button
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            onRestaurantOpen();
          }}
          className="w-fit text-left font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted transition-colors hover:text-gold"
        >
          {e.restaurant}
        </button>
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
        <AvailableTimes slots={e.availableSlots} onBookSlot={onBookSlot} />
        {e.isSoldOut ? (
          <div className="mt-2 space-y-2" onClick={(ev) => ev.stopPropagation()}>
            <Button
              onClick={(ev) => {
                ev.stopPropagation();
                onOpen();
              }}
              variant="outline"
              className="h-11 w-full rounded-md font-semibold opacity-70"
            >
              Sold out — view details
            </Button>
            <NotifyMeButton
              variant="event"
              eventId={e.id.startsWith("event-") ? e.id.replace(/^event-/, "") : undefined}
              eventName={e.title}
              defaultPartySize={2}
              className="w-full justify-center"
            />
          </div>
        ) : (
          <Button
            onClick={(ev) => {
              ev.stopPropagation();
              onReserve();
            }}
            className="mt-2 h-11 w-full rounded-md font-semibold"
          >
            <CalendarDays className="size-4" />
            {e.detail?.actionLabel ?? "Book"}
          </Button>
        )}
      </div>
    </motion.div>
  );
}

function ListEventCard({
  e,
  saved,
  favoriteRestaurant,
  onToggleSave,
  onToggleFavoriteRestaurant,
  onBookSlot,
  onReserve,
  onOpen,
  onRestaurantOpen,
  onHover,
  highlighted,
}: {
  e: DemoEvent;
  saved: boolean;
  favoriteRestaurant: boolean;
  onToggleSave: () => void;
  onToggleFavoriteRestaurant: () => void;
  onBookSlot: (slot: AvailabilitySlot) => void;
  onReserve: () => void;
  onOpen: () => void;
  onRestaurantOpen: () => void;
  onHover: (id: string | null) => void;
  highlighted: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onOpen();
        }
      }}
      onMouseEnter={() => onHover(e.id)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "flex cursor-pointer gap-4 rounded-2xl border bg-bg-surface/40 p-4 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
        highlighted ? "border-gold/70 bg-gold/5 shadow-lg shadow-gold/10" : "border-border hover:border-gold/30 hover:bg-bg-surface/70",
      )}
    >
      <div className="relative w-44 shrink-0 overflow-hidden rounded-xl">
        <StripePlaceholder label={e.initials} imageUrl={e.imageUrl} className="aspect-square" />
        <span className="absolute left-2 top-2 rounded-md border border-gold/40 bg-black/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-gold">
          {TYPE_BADGE_LABEL[e.type]}
        </span>
        <span className="absolute left-2 bottom-2 inline-flex items-center gap-1 rounded-md border border-gold/40 bg-black/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold">
          <Flame className="size-2.5" /> {e.availability}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              onRestaurantOpen();
            }}
            className="text-left font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted transition-colors hover:text-gold"
          >
            {e.restaurant}
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                onToggleFavoriteRestaurant();
              }}
              aria-label="Favorite restaurant"
              className="rounded-full border border-border bg-bg-elevated p-1.5 hover:border-gold/40"
            >
              <Heart
                className={cn("size-3.5", favoriteRestaurant ? "fill-gold text-gold" : "text-white")}
              />
            </button>
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                onToggleSave();
              }}
              aria-label="Save"
              className="rounded-full border border-border bg-bg-elevated p-1.5 hover:border-gold/40"
            >
              <Bookmark
                className={cn("size-3.5", saved ? "fill-gold text-gold" : "text-white")}
              />
            </button>
          </div>
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
        <AvailableTimes slots={e.availableSlots} onBookSlot={onBookSlot} />
        <Button
          onClick={(ev) => {
            ev.stopPropagation();
            onReserve();
          }}
          className="mt-1 h-10 w-full rounded-md font-semibold"
        >
          {e.detail?.actionLabel ?? "Book"}
        </Button>
      </div>
    </div>
  );
}

export default function DealsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    profile,
    signOut,
    restaurantRoles,
  } = useUser();
  const { restaurants: staffRestaurants } = useStaffRestaurants(restaurantRoles);
  const { restaurants: publicRestaurants } = usePublicRestaurants();
  const { promotions, loading: promotionsLoading } = useAllActivePromotions();
  const { events: activeEvents, loading: eventsLoading } = useAllActiveEvents();

  const [view, setView] = useState<"grid" | "map">("map");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState<"tonight" | "weekend" | "week" | "expiring" | "sold-out" | null>(null);
  const [search, setSearch] = useState("");
  const [dateId, setDateId] = useState("today");
  const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]>("All Types");
  const [time, setTime] = useState(getNearestUpcomingHalfHour());
  const [partySize, setPartySize] = useState("2");
  const [pendingDateId, setPendingDateId] = useState(dateId);
  const [pendingCustomDate, setPendingCustomDate] = useState<Date | undefined>(undefined);
  const [pendingTime, setPendingTime] = useState(time);
  const [pendingPartySize, setPendingPartySize] = useState(partySize);
  const [radius, setRadius] = useState<RadiusOption>("anywhere");
  const [pendingRadius, setPendingRadius] = useState<RadiusOption>("anywhere");
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
  const [radiusPickerOpen, setRadiusPickerOpen] = useState(false);
  const [activePrices, setActivePrices] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapEdgeMode, setMapEdgeMode] = useState(false);
  const [detailItem, setDetailItem] = useState<EventPromotionDisplay | null>(null);
  const [previewRestaurant, setPreviewRestaurant] = useState<RestaurantPreviewSummary | null>(null);
  const [previewAvailabilityNotice, setPreviewAvailabilityNotice] = useState<string | null>(null);
  const [favoriteRestaurants, setFavoriteRestaurants] = useState<Set<string>>(new Set());
  const [availabilityByRestaurantId, setAvailabilityByRestaurantId] = useState<Record<string, AvailabilitySlot[]>>({});
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [userLocation, setUserLocation] = useState<GeoPoint | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "requesting" | "allowed" | "denied" | "unsupported">(
    () => ("geolocation" in navigator ? "idle" : "unsupported"),
  );
  const searchSentinelRef = useRef<HTMLDivElement | null>(null);

  const loading = promotionsLoading || eventsLoading;
  const listingLoading = loading || availabilityLoading;
  const restaurantIds = useMemo(() => publicRestaurants.map((restaurant) => restaurant.id), [publicRestaurants]);
  const { statsByRestaurantId } = useRestaurantPreviewStatsByRestaurantIds(restaurantIds);
  const datePresets = useMemo(() => datePresetOptions(), []);
  const selectedBookingDate = useMemo(
    () => dateParamFromSelection(dateId, customDate),
    [customDate, dateId],
  );
  const selectedPartySize = normalizePartySize(partySize);

  // Mirrors the Discover refresh strategy: Deals has no per-restaurant
  // realtime socket, so when the user cancels / books / modifies, the slot
  // grid would otherwise show stale data. The tick bumps re-run the
  // availability fetch effect; tab refocus pulls fresh reservations.
  const [availabilityRefreshTick, setAvailabilityRefreshTick] = useState(0);
  const { upcoming: myUpcomingReservations, refresh: refreshMyReservations } = useMyReservations();
  const myReservationIdsKey = useMemo(
    () => myUpcomingReservations.map((r) => r.id).sort().join(","),
    [myUpcomingReservations],
  );
  const lastReservationIdsKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastReservationIdsKeyRef.current === null) {
      lastReservationIdsKeyRef.current = myReservationIdsKey;
      return;
    }
    if (lastReservationIdsKeyRef.current === myReservationIdsKey) return;
    lastReservationIdsKeyRef.current = myReservationIdsKey;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAvailabilityRefreshTick((t) => t + 1);
  }, [myReservationIdsKey]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      void refreshMyReservations();
      setAvailabilityRefreshTick((t) => t + 1);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refreshMyReservations]);

  // Periodic refresh while the tab is visible. Matches the DiscoverPage
  // cadence so slot lists don't drift stale during a long browse session.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setAvailabilityRefreshTick((t) => t + 1);
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (restaurantIds.length === 0) {
        if (!cancelled) {
          setAvailabilityByRestaurantId({});
          setAvailabilityLoading(false);
        }
        return;
      }
      setAvailabilityLoading(true);
      const map = await fetchDisplayAvailabilitySlotsForRestaurants(
        restaurantIds,
        selectedBookingDate,
        selectedPartySize,
        time,
      );
      if (cancelled) return;
      setAvailabilityByRestaurantId(map);
      setAvailabilityLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantIds, selectedBookingDate, selectedPartySize, time, availabilityRefreshTick]);

  const events: DemoEvent[] = useMemo(() => {
    const rows = [
      ...activeEvents.map(adaptEvent),
      ...promotions.map(adaptPromotion),
    ];
    return rows.map((event) => ({
      ...event,
      availableSlots: availabilityByRestaurantId[event.restaurantId] ?? [],
    }));
  }, [activeEvents, availabilityByRestaurantId, promotions]);

  const restaurantPreviews = useMemo(
    () => publicRestaurants.map((restaurant) => adaptRestaurantPreview(
      restaurant,
      statsByRestaurantId[restaurant.id] ?? { bookedToday: 0, avgRating: null, totalReviews: 0 },
    )),
    [publicRestaurants, statsByRestaurantId],
  );
  const detailParam = searchParams.get("detail");

  const filtered = useMemo(() => {
    let list = events
      // Drop past events/promos so finished items don't squat at the top of
      // the page. Events are booked on their own fixed date+time so we
      // intentionally do NOT gate on the restaurant's "today" slots — that
      // filter used to hide all future-date events (May 22, May 29, …) just
      // because the host restaurant was full tonight. Sold-out events stay
      // in the list and get routed to the dedicated rail below.
      .filter((e) => !e.isPast)
      .map((e) => ({
        ...e,
        _price: PRICE_FOR_TYPE[e.type] ?? "$$",
      }));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.restaurant.toLowerCase().includes(q) ||
          e.type.toLowerCase().includes(q) ||
          e.city.toLowerCase().includes(q),
      );
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
    if (userLocation) {
      if (radius !== "anywhere") {
        const radiusMeters = radius * 1000;
        list = list.filter((e) => {
          if (e.lat == null || e.lng == null) return false;
          return distanceMeters(userLocation, { lat: e.lat, lng: e.lng }) <= radiusMeters;
        });
      }
      list = [...list].sort((a, b) => {
        if (a.lat == null || a.lng == null) return 1;
        if (b.lat == null || b.lng == null) return -1;
        return distanceMeters(userLocation, { lat: a.lat, lng: a.lng }) - distanceMeters(userLocation, { lat: b.lat, lng: b.lng });
      });
    }
    return list;
  }, [events, search, typeFilter, activePrices, userLocation, radius]);

  const activeFilterCount =
    (dateId !== "today" ? 1 : 0) +
    (typeFilter !== "All Types" ? 1 : 0) +
    (time !== getNearestUpcomingHalfHour() ? 1 : 0) +
    (partySize !== "2" ? 1 : 0) +
    (radius !== "anywhere" ? 1 : 0) +
    (activePrices.size > 0 ? 1 : 0) +
    (search.trim() ? 1 : 0);

  const togglePrice = (p: string) =>
    setActivePrices((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const clearAll = () => {
    const defaultTime = getNearestUpcomingHalfHour();
    setDateId("today");
    setCustomDate(undefined);
    setTypeFilter("All Types");
    setTime(defaultTime);
    setPartySize("2");
    setRadius("anywhere");
    setActivePrices(new Set());
    setSearch("");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersOpen]);

  useEffect(() => {
    if (view !== "map" || locationStatus !== "idle") return;
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
  }, [locationStatus, view]);

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

  const tonight = filtered.filter((e) => e.category === "Tonight" && !e.isSoldOut);
  const weekend = filtered.filter((e) => e.category === "This Weekend" && !e.isSoldOut);
  const week = filtered.filter((e) => e.category === "This Week" && !e.isSoldOut);
  // Sold-out events get their own rail so users still discover them
  // (typically high-demand experiences worth waitlisting for or planning
  // around). Mirrors the "Booked up tonight" rail on Discover.
  const soldOut = filtered.filter((e) => e.isSoldOut);
  // Promotions ending within the next 7 days get a dedicated urgency rail.
  // 7d is short enough to feel urgent and long enough to be actionable.
  const expiringPromos = filtered.filter(
    (e) => !e.isSoldOut && e.daysUntilExpiry != null && e.daysUntilExpiry <= 7,
  );

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
  const toggleFavoriteRestaurant = (id: string) =>
    setFavoriteRestaurants((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openDetail = (e: DemoEvent) => {
    setDetailItem(e.detail);
  };

  const closeDetail = () => {
    setDetailItem(null);
    if (!detailParam) return;

    const next = new URLSearchParams(searchParams);
    next.delete("detail");
    setSearchParams(next, { replace: true });
  };

  const openRestaurantPreview = (item: EventPromotionDisplay) => {
    const preview =
      restaurantPreviews.find((restaurant) => {
        const slug = item.restaurantSlug?.toLowerCase();
        return (
          (slug && restaurant.id.toLowerCase() === slug) ||
          restaurant.name.toLowerCase() === item.restaurantName.toLowerCase()
        );
      });
    if (preview) {
      setPreviewAvailabilityNotice(null);
      setPreviewRestaurant(preview);
    }
  };

  const openRestaurantPreviewFromEvent = (e: DemoEvent) => {
    openRestaurantPreview(e.detail);
  };

  const markCurrentDealsReturn = (detailKey: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("detail", detailKey);
    window.history.replaceState(window.history.state, "", `/deals?${next.toString()}`);
  };

  const bookItem = (
    item: EventPromotionDisplay,
    overrides?: { partySize: number; time: string; date?: string },
  ) => {
    const matchingPreview = restaurantPreviews.find(
      (restaurant) => restaurant.name.toLowerCase() === item.restaurantName.toLowerCase(),
    );
    const restaurantKey = item.restaurantSlug ?? matchingPreview?.id;

    if (!restaurantKey) {
      return;
    }

    const returnDetail = `${item.source}-${item.id}`;
    markCurrentDealsReturn(returnDetail);

    // Diner picks party size + arrival time on the event/promotion card.
    // Forward both to the restaurant public page so the booking form is
    // pre-filled. Also include the event_id or promotion_id so the resulting
    // reservation gets tagged (visible on /bookings + owner dashboard).
    const pickedTime = overrides?.time ?? time;
    const pickedParty = overrides?.partySize ?? normalizePartySize(partySize);
    const params = new URLSearchParams({
      back: "deals",
      returnDetail,
      time: pickedTime,
      people: String(pickedParty),
      source: item.source,
      item: item.id,
    });
    // Diner-picked date (overridden by card's date control). Falls back to
    // the event's actual date for single-day events, or the promo's start.
    const pickedDate = overrides?.date ?? item.rawDate ?? null;
    if (pickedDate) params.set("date", pickedDate);
    if (item.source === "event") params.set("event_id", item.id);
    if (item.source === "promotion") params.set("promotion_id", item.id);
    void navigate(`/${restaurantKey}?${params.toString()}`);
  };

  const bookEvent = (e: DemoEvent) => {
    bookItem(e.detail);
  };

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

  const bookEventSlot = async (e: DemoEvent, slot: AvailabilitySlot) => {
    const partyCount = normalizePartySize(partySize);
    const slotDate = slot.booking_date ?? selectedBookingDate;
    const refreshed = await fetchAvailabilitySlots(
      e.restaurantId,
      slotDate,
      partyCount,
      { forceRefresh: true },
    ).catch(() => null);
    const refreshedSlot = refreshed?.slots.find((candidate) =>
      candidate.date_time === slot.date_time && candidate.shift_id === slot.shift_id,
    );
    if (!refreshedSlot) {
      await refreshRestaurantDisplaySlots(e.restaurantId, partyCount, { forceRefresh: true });
      openRestaurantPreviewFromEvent(e);
      setPreviewAvailabilityNotice(
        refreshed?.message ?? "That time is no longer available. Pick another time.",
      );
      return;
    }
    const params = new URLSearchParams({
      back: "deals",
      slot: refreshedSlot.date_time,
      time: formatCompactTimeLabel(refreshedSlot.display_time),
      people: String(partyCount),
      date: slotDate,
      source: e.detail.source,
      item: e.detail.id,
    });
    if (refreshedSlot.shift_id) params.set("shift_id", refreshedSlot.shift_id);
    const returnDetail = `${e.detail.source}-${e.detail.id}`;
    params.set("returnDetail", returnDetail);
    markCurrentDealsReturn(returnDetail);
    void navigate(`/${e.detail.restaurantSlug ?? e.restaurantId}?${params.toString()}`);
  };

  useEffect(() => {
    if (!detailParam) return;

    const match = events.find((event) => {
      const detail = event.detail;
      return (
        event.id === detailParam ||
        detail.id === detailParam ||
        `${detail.source}-${detail.id}` === detailParam
      );
    });

    if (match) {
      void Promise.resolve().then(() => setDetailItem(match.detail));
    }
  }, [detailParam, events]);

  useEffect(() => {
    if (!detailParam) {
      return;
    }

    const existingMatch = events.some((event) => {
      const detail = event.detail;
      return (
        event.id === detailParam ||
        detail.id === detailParam ||
        `${detail.source}-${detail.id}` === detailParam
      );
    });
    if (existingMatch) return;

    const [source, ...idParts] = detailParam.split("-");
    const id = idParts.join("-");
    if ((source !== "event" && source !== "promotion") || !id) return;

    let cancelled = false;
    void (async () => {
      const item = source === "event"
        ? await fetchEventById(id).then((event) => event ? eventToDisplay(event) : null)
        : await fetchPromotionById(id).then((promotion) => promotion ? promotionToDisplay(promotion) : null);

      if (cancelled || !item) return;
      setDetailItem(item);
    })();

    return () => { cancelled = true; };
  }, [detailParam, events]);

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
            <CustomerBellDropdown className="size-11 rounded-full border border-border bg-bg-surface/70 hover:border-gold/40" />

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

      <main className="w-full px-12 py-10 sm:px-16 md:px-20 lg:px-24 xl:px-32 2xl:px-40 lg:py-12">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-gold">
            <span className="inline-block h-px w-3 bg-gold/60" /> LIMITED · THIS WEEK IN TORONTO
          </span>
          <h1 className="mt-4 font-serif text-5xl leading-[1.05] text-white sm:text-6xl">
            Promotions <span className="italic text-gold">&amp;</span> Events
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base text-text-secondary">
            Tasting menus, happy hours, and chef's table experiences from restaurants
            you follow.
          </p>
        </div>

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
                  <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
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
                            setDatePopoverOpen(false);
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
                        <Button size="sm" onClick={() => setTimePickerOpen(false)} className="h-8 px-3 text-xs">
                          Done
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>

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
                        <Button size="sm" onClick={() => setPartyPickerOpen(false)} className="h-8 px-3 text-xs">
                          Done
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>

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
                            <Button size="sm" onClick={() => setRadiusPickerOpen(false)} className="h-8 px-3 text-xs">
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
                            {locationStatus === "denied" ? "Location is blocked" : "Find promotions near you"}
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
                                () => {
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
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between border-t border-border/50 pt-5">
                  <p className="text-sm">
                    <span className="font-serif text-2xl text-white">{filtered.length}</span>{" "}
                    <span className="text-text-muted">events match</span>
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

        {/* Empty */}
        {!listingLoading && filtered.length === 0 && (
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
                setDateId("today");
                setCustomDate(undefined);
                setTypeFilter("All Types");
                setSearch("");
              }}
            >
              Show everything
            </Button>
          </div>
        )}

        {/* Grid view */}
        {!listingLoading && filtered.length > 0 && view === "grid" && (() => {
          const rows = [
            {
              key: "tonight" as const,
              eyebrow: "Right now",
              title: "Available tonight",
              sub: "Walk-in distance, last-minute spots, late-service deals.",
              pool: tonight,
            },
            {
              key: "expiring" as const,
              eyebrow: "Last chance",
              title: "Expiring soon",
              sub: "Promotions ending in the next 7 days.",
              pool: expiringPromos,
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
            {
              key: "sold-out" as const,
              eyebrow: "Booked up",
              title: "Sold out — try another night",
              sub: "Popular experiences that filled up tonight. Tap to plan another date.",
              pool: soldOut,
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
                          favoriteRestaurant={favoriteRestaurants.has(e.restaurantId)}
                          onToggleSave={() => toggleSave(e.id)}
                          onToggleFavoriteRestaurant={() => toggleFavoriteRestaurant(e.restaurantId)}
                          onBookSlot={(slot) => void bookEventSlot(e, slot)}
                          onReserve={() => bookEvent(e)}
                          onOpen={() => openDetail(e)}
                          onRestaurantOpen={() => openRestaurantPreviewFromEvent(e)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          );
        })()}

        {/* Map view — layout matches Discover (sticky map, list scrolls with page) */}
        {!listingLoading && filtered.length > 0 && view === "map" && (
          <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(420px,1fr)]">
            <div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-text-secondary">
                  <span className="font-serif text-xl text-white">{filtered.length}</span>{" "}
                  promotions · sorted by <span className="text-gold">{userLocation ? "Nearest" : "Best match"}</span>
                </p>
                <p className="hidden text-xs text-text-muted sm:block">
                  {locationStatus === "requesting" ? "Requesting location..." : "Hover to highlight on map"}
                </p>
              </div>
              <div className="mt-4 space-y-4">
                {filtered.map((e) => (
                  <ListEventCard
                    key={e.id}
                    e={e}
                    saved={saved.has(e.id)}
                    favoriteRestaurant={favoriteRestaurants.has(e.restaurantId)}
                    onToggleSave={() => toggleSave(e.id)}
                    onToggleFavoriteRestaurant={() => toggleFavoriteRestaurant(e.restaurantId)}
                    onBookSlot={(slot) => void bookEventSlot(e, slot)}
                    onReserve={() => bookEvent(e)}
                    onOpen={() => setSelectedId(e.id)}
                    onRestaurantOpen={() => openRestaurantPreviewFromEvent(e)}
                    onHover={setHoveredId}
                    highlighted={selectedId === e.id}
                  />
                ))}
              </div>
            </div>

            {/* Map area — same sticky/edge behavior as Discover (self-start = lock in grid) */}
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
                <GoogleDealsMap
                  events={filtered}
                  selectedId={selectedId}
                  hoveredId={hoveredId}
                  userLocation={userLocation}
                  onSelect={setSelectedId}
                  onHover={setHoveredId}
                />

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

                {(() => {
                  const previewId = selectedId ?? hoveredId;
                  if (!previewId) return null;
                  const e = filtered.find((x) => x.id === previewId);
                  if (!e) return null;
                  return (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => openDetail(e)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openDetail(e);
                        }
                      }}
                      aria-label={`Open ${e.title}`}
                      className="group absolute bottom-4 left-4 z-10 flex w-[min(17.5rem,calc(100vw-2rem))] cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-bg-surface/95 shadow-2xl shadow-black/50 backdrop-blur transition-colors hover:border-gold/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
                    >
                      <div className="relative">
                        <StripePlaceholder label={e.initials} imageUrl={e.imageUrl} className="aspect-auto h-20 sm:h-24" />
                        <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
                          <span className="rounded border border-gold/40 bg-black/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-gold backdrop-blur">
                            {TYPE_BADGE_LABEL[e.type]}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded border border-gold/40 bg-black/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-gold backdrop-blur">
                            <Flame className="size-2.5" /> {e.availability}
                          </span>
                        </div>
                        <div className="absolute right-2.5 top-2.5 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleFavoriteRestaurant(e.restaurantId);
                            }}
                            aria-label="Favorite restaurant"
                            className="rounded-full border border-border bg-black/60 p-1.5 backdrop-blur transition-colors hover:border-gold/50"
                          >
                            <Heart className={cn("size-3.5", favoriteRestaurants.has(e.restaurantId) ? "fill-gold text-gold" : "text-white")} />
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleSave(e.id);
                            }}
                            aria-label="Save"
                            className="rounded-full border border-border bg-black/60 p-1.5 backdrop-blur transition-colors hover:border-gold/50"
                          >
                            <Bookmark className={cn("size-3.5", saved.has(e.id) ? "fill-gold text-gold" : "text-white")} />
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedId(null);
                              setHoveredId(null);
                            }}
                            className="rounded-full border border-border bg-black/60 p-1.5 text-white backdrop-blur transition-colors hover:border-gold/50"
                            aria-label="Close"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-1 flex-col gap-1.5 p-2.5 sm:p-3">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openRestaurantPreviewFromEvent(e);
                          }}
                          className="w-fit text-left font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted transition-colors hover:text-gold"
                        >
                          {e.restaurant}
                        </button>
                        <p className="line-clamp-2 font-serif text-base leading-snug tracking-tight text-white sm:text-lg">
                          {e.title}
                        </p>
                        <p className="text-[11px] text-text-secondary">
                          {e.when} · <span className="text-gold">{e.price}</span>
                        </p>
                        <AvailableTimes slots={e.availableSlots} onBookSlot={(slot) => void bookEventSlot(e, slot)} size="sm" />
                        {e.isSoldOut ? (
                          <div onClick={(ev) => ev.stopPropagation()}>
                            <NotifyMeButton
                              variant="event"
                              eventId={e.id.startsWith("event-") ? e.id.replace(/^event-/, "") : undefined}
                              eventName={e.title}
                              defaultPartySize={2}
                              size="sm"
                              className="h-8 w-full justify-center text-xs"
                            />
                          </div>
                        ) : (
                          <Button
                            onClick={(event) => {
                              event.stopPropagation();
                              bookEvent(e);
                            }}
                            className="h-8 w-full rounded-md text-xs font-semibold"
                          >
                            {e.detail?.actionLabel ?? "Book"}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}
      </main>
      <EventPromotionDetailDialog
        item={detailItem}
        open={detailItem !== null}
        onOpenChange={(open) => {
          if (!open) closeDetail();
        }}
        onReserve={bookItem}
        onRestaurantOpen={openRestaurantPreview}
        keepOpenOnOutsideInteraction={previewRestaurant !== null}
        modal={previewRestaurant === null}
      />
      <RestaurantPreviewModal
        restaurant={previewRestaurant}
        favorite={previewRestaurant ? favoriteRestaurants.has(previewRestaurant.id) : false}
        partySize={partySize}
        bookingDate={selectedBookingDate}
        preferredTime={time}
        availabilityNotice={previewAvailabilityNotice}
        onClose={() => {
          setPreviewAvailabilityNotice(null);
          setPreviewRestaurant(null);
        }}
        onToggleFavorite={() => {
          if (!previewRestaurant) return;
          setFavoriteRestaurants((prev) => {
            const next = new Set(prev);
            if (next.has(previewRestaurant.id)) next.delete(previewRestaurant.id);
            else next.add(previewRestaurant.id);
            return next;
          });
        }}
        onReserve={(slot, selectedPartySize, shiftId, displayTime, bookingDate) => {
          if (!previewRestaurant) return;
          const slotDate = bookingDate ?? selectedBookingDate;
          const timeParam = displayTime ? formatCompactTimeLabel(displayTime) : formatCompactTimeLabel(slot);
          const params = new URLSearchParams({
            back: "deals",
            slot,
            time: timeParam,
            people: selectedPartySize,
            date: slotDate,
          });
          if (shiftId) params.set("shift_id", shiftId);
          if (detailItem) {
            const returnDetail = `${detailItem.source}-${detailItem.id}`;
            params.set("returnDetail", returnDetail);
            markCurrentDealsReturn(returnDetail);
          }
          // Public page re-validates the slot before submit (handlePlaceOrder)
          // and the modal/Discover paths force-refresh availability, so we no
          // longer need to forward the previewSlotRevalidation hint.
          void navigate(`/${previewRestaurant.id}?${params.toString()}`);
        }}
      />
    </div>
  );
}
