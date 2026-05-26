import { Fragment, useState, useMemo, useId, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { addDays, endOfMonth, format, isValid, parse, startOfMonth, startOfToday } from "date-fns";
import { useParams, Link, useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Star,
  MapPin,
  Phone,
  ChevronRight,
  Plus,
  Minus,
  Check,
  Flame,
  CalendarDays,
  Utensils,
  Users,
  ChevronDown,
  Trash2,
  CreditCard,
  Lock,
  Loader2,
  AlertTriangle,
  Split,
  Heart,
  Bookmark,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { EventPromotionDetailCard } from "@/components/customer/EventPromotionDetailCard";
import { ManageBookingView } from "@/components/customer/ManageBookingView";
import { RestaurantPriceMeter } from "@/components/customer/RestaurantPriceMeter";
import { RestaurantSocialLinks } from "@/components/restaurant/RestaurantSocialLinks";
import {
  fetchAvailabilitySlots,
  filterSlotsByConflicts,
  invalidateAvailabilityCache,
  useAvailability,
  useAvailabilityRealtimeInvalidate,
  useDinerConflictWindows,
  type AvailabilitySlot,
} from "@/hooks/useAvailability";
import { AvailabilityPanel } from "@/components/booking/AvailabilityPanel";
import { HoldExpiredDialog } from "@/components/booking/HoldExpiredDialog";
import { HoldTimerBanner } from "@/components/booking/HoldTimerBanner";
import { StripePaymentForm } from "@/components/booking/StripePaymentForm";
import { SplitTenderPaymentForm } from "@/components/booking/SplitTenderPaymentForm";
import { useReservationHold } from "@/hooks/useReservationHold";
import { toUserFacingError } from "@/lib/errors";
import { useAllActiveEvents } from "@/hooks/useEvents";
import { useRestaurant } from "@/hooks/useRestaurant";
import { usePublicMenuCategories, usePublicMenuItems } from "@/hooks/useMenuItems";
import { useAllActivePromotions, getPromotionLabel, getPromoTypeBadgeClasses } from "@/hooks/usePromotions";
import { useRestaurantPreviewStats } from "@/hooks/useRestaurantPreviewStats";
import { useRestaurantReviews } from "@/hooks/useRestaurantReviews";
import { useRestaurantPhotos, type RestaurantPhoto } from "@/hooks/useRestaurantPhotos";
import { PhotoReviewDialog } from "@/components/customer/PhotoReviewDialog";
import type { Restaurant } from "@/hooks/useRestaurant";
import { useUser } from "@/hooks/useUser";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { applyRestaurantTheme, resetTheme } from "@/lib/theme";
import { computePromoDiscount } from "@/lib/computePromoDiscount";
import { eventToDisplay, type RestaurantDisplayInfo } from "@/lib/customer/eventPromotionDisplay";
import { cn, capitalizeWords } from "@/lib/utils";
import { formatCompactTimeLabel } from "@/lib/utils/time";
import { formatRestaurantHoursRows } from "@/lib/restaurant-hours";
import {
  deriveRestaurantPriceLevel,
  deriveRestaurantPriceLevelFromMenu,
  normalizeRestaurantPriceLevel,
} from "@/lib/restaurant-price-level";
import { normalizeRestaurantDietaryTags, type RestaurantDietaryTag } from "@/lib/restaurant-dietary-tags";
import { normalizeE164Phone } from "@/lib/validation/phone-schemas";
import { computeDinerCharge } from "@/lib/stripe-fee";
import { getProvincialTax } from "@/lib/billing/canadianTax";
import { SEATING_PREFERENCES } from "@/lib/booking/seating-preferences";

// ─── Types ───────────────────────────────────────────────────────────────────
type Step = "details" | "menu" | "checkout" | "confirmed";

type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  popular: boolean;
  dietary: string[];
  photoUrl?: string | null;
  /** Key allergens present in this dish */
  allergens: string[];
  /** Human-readable ingredient highlights shown in the warning section */
  ingredients: string;
};

type CartItem = MenuItem & { qty: number; note?: string };

type DineInDetails = {
  date: string;
  time: string;
  party_size: number | "";
  seating_preference: string;
  name: string;
  email: string;
  phone: string;
  allergies: string;
  occasion: string;
};

type PublicBookingResponse = {
  reservation_id?: string;
  order_id?: string | null;
  confirmation_code?: string;
  confirmation_delivery?: "sent" | "skipped" | "failed";
  confirmation_delivery_channel?: "email" | "sms" | null;
  deposit_required?: boolean;
  deposit_amount_cents?: number;
  error?: string;
  unavailable_reason?:
    | "slot_taken"
    | "over_cover_cap"
    | "diner_double_book"
    | string;
};

type PreviewSlotRevalidationState = {
  previewSlotRevalidation?: {
    slot?: string;
    shiftId?: string | null;
    date?: string;
    partySize?: number;
  };
};

const OCCASIONS = ["", "Anniversary", "Birthday", "Business Dinner", "Date Night", "Family Gathering"];
const CUISINE_GRADIENT: Record<string, string> = {
  French:   "from-indigo-900 to-blue-900",
  Japanese: "from-rose-900 to-pink-900",
  Italian:  "from-green-900 to-emerald-900",
  Mexican:  "from-orange-900 to-red-900",
  Seafood:  "from-cyan-900 to-teal-900",
  BBQ:      "from-stone-800 to-neutral-800",
  Indian:   "from-yellow-900 to-orange-900",
};
function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Step indicator ───────────────────────────────────────────────────────────
const STEPS: { key: Step; labelKey: string }[] = [
  { key: "details", labelKey: "customerPublic.booking.stepDetails" },
  { key: "menu", labelKey: "customerPublic.booking.stepMenu" },
  { key: "checkout", labelKey: "customerPublic.booking.stepPayment" },
];

function StepBar({
  current,
  onNavigate,
}: {
  current: Step;
  onNavigate?: (step: Step) => void;
}) {
  const { t } = useTranslation();
  const idx = STEPS.findIndex((s) => s.key === current);
  if (current === "confirmed") return null;
  return (
    <div className="flex items-center">
      {STEPS.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        const clickable = Boolean(done && onNavigate);
        const label = t(s.labelKey);
        const circle = (
          <div
            className={`flex size-7 items-center justify-center rounded-full border-2 text-xs font-bold transition-all ${
              done
                ? "border-gold bg-gold text-bg-base"
                : active
                  ? "border-gold bg-gold/15 text-gold"
                  : "border-border bg-bg-elevated text-text-muted"
            }`}
          >
            {done ? <Check className="size-3.5" /> : i + 1}
          </div>
        );
        const caption = (
          <span
            className={`text-[10px] font-medium ${
              active ? "text-gold" : done ? "text-text-secondary" : "text-text-muted"
            }`}
          >
            {label}
          </span>
        );
        return (
          <Fragment key={s.key}>
            <div className="flex flex-col items-center gap-1">
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onNavigate?.(s.key)}
                  aria-label={t("customerPublic.booking.goToStep", { step: label })}
                  className="flex flex-col items-center gap-1 rounded-lg p-0.5 outline-none transition-colors hover:bg-gold/10 focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
                >
                  {circle}
                  {caption}
                </button>
              ) : (
                <>
                  {circle}
                  {caption}
                </>
              )}
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`mb-4 h-px flex-1 mx-2 transition-colors ${i < idx ? "bg-gold" : "bg-border"}`}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

function PreviewArt({ label, imageUrl }: { label: string; imageUrl?: string | null }) {
  return (
    <div className="relative flex size-full min-h-24 items-center justify-center overflow-hidden rounded-xl border border-gold/15 bg-bg-base">
      {imageUrl ? (
        <img src={imageUrl} alt="" className="size-full object-cover" />
      ) : (
        <>
          <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(201,168,76,0.22)_0,rgba(201,168,76,0.22)_1px,transparent_1px,transparent_16px)]" />
          <span className="relative flex size-10 items-center justify-center rounded-full border border-gold/30 bg-gold/15 font-mono text-[9px] uppercase tracking-[0.28em] text-gold/70">
            {label.slice(0, 3)}
          </span>
        </>
      )}
    </div>
  );
}

function PreviewDishCard({ item, compact = false }: { item: MenuItem; compact?: boolean }) {
  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-bg-elevated/70 shadow-xl shadow-black/20",
        compact ? "grid grid-cols-[78px_minmax(0,1fr)] gap-3 p-3" : "",
      )}
    >
      <div className={compact ? "h-full min-h-20" : "aspect-[4/3]"}>
        <PreviewArt label={item.name} imageUrl={item.photoUrl} />
      </div>
      <div className={compact ? "min-w-0" : "p-4"}>
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 font-serif text-lg leading-tight text-white">{item.name}</h3>
          <span className="shrink-0 font-serif text-2xl font-semibold tracking-tight text-gold">
            {formatCurrency(item.price, "cad")}
          </span>
        </div>
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-secondary">{item.description}</p>
        {!compact && item.popular && (
          <span className="mt-3 inline-flex rounded-full bg-gold/15 px-2 py-0.5 text-[10px] text-gold">
            Popular
          </span>
        )}
      </div>
    </article>
  );
}

const STAFF_PREVIEW_TABS = ["Menu", "Photos", "Reviews", "About", "Events"] as const;
type StaffPreviewTab = (typeof STAFF_PREVIEW_TABS)[number];

function todayDateValue(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateValueFromDiscoverPreset(value: string | null): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date();
  if (value === "tomorrow") {
    date.setDate(date.getDate() + 1);
  } else if (value === "sat") {
    date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7 || 7));
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function optionalDateValueFromSearch(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (value === "tomorrow" || value === "sat") return dateValueFromDiscoverPreset(value);
  return null;
}

function previewSlotRevalidationFromState(state: unknown): PreviewSlotRevalidationState["previewSlotRevalidation"] {
  if (!state || typeof state !== "object" || !("previewSlotRevalidation" in state)) return undefined;
  const candidate = (state as PreviewSlotRevalidationState).previewSlotRevalidation;
  if (!candidate || typeof candidate !== "object") return undefined;
  return candidate;
}

function dateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function SeatWheel({
  maxSeats,
  value,
  onCommit,
}: {
  maxSeats: number;
  value: number;
  onCommit: (value: number) => void;
}) {
  const seats = useMemo(() => Array.from({ length: Math.max(1, maxSeats) }, (_, index) => index + 1), [maxSeats]);
  const [draftValue, setDraftValue] = useState(value);
  const scrollToSeat = (seat: number) => {
    setDraftValue(Math.min(Math.max(1, seat), maxSeats));
  };
  const commitSeat = (seat: number) => {
    onCommit(Math.min(Math.max(1, seat), maxSeats));
  };

  useEffect(() => {
    void Promise.resolve().then(() => setDraftValue(value));
  }, [value]);

  return (
    <div>
      <div
        role="listbox"
        aria-label="Party size"
        tabIndex={0}
        onWheel={(event) => {
          event.preventDefault();
          if (Math.abs(event.deltaY) < 4) return;
          scrollToSeat(draftValue + (event.deltaY > 0 ? 1 : -1));
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") scrollToSeat(draftValue + 1);
          if (event.key === "ArrowUp") scrollToSeat(draftValue - 1);
          if (event.key === "Enter") commitSeat(draftValue);
        }}
        className="max-h-56 overflow-y-auto rounded-2xl border border-border bg-bg-base p-2 outline-none [scrollbar-color:var(--gold)_transparent] [scrollbar-width:thin] focus-visible:ring-2 focus-visible:ring-gold/40"
      >
        {seats.map((seat) => {
          const active = seat === draftValue;
          return (
            <button
              key={seat}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => commitSeat(seat)}
              className={cn(
                "flex h-10 w-full items-center justify-center rounded-xl text-sm transition-colors",
                active ? "bg-gold text-bg-base" : "text-text-secondary hover:bg-bg-elevated hover:text-white",
              )}
            >
              {seat} seat{seat === 1 ? "" : "s"}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => commitSeat(draftValue)}
        className="mt-2 h-10 w-full rounded-xl bg-gold text-sm font-semibold text-bg-base transition-opacity hover:opacity-90"
      >
        Select {draftValue} guest{draftValue === 1 ? "" : "s"}
      </button>
    </div>
  );
}

function uniquePreviewValues(values: Array<string | null | undefined>): string[] {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value, index, list) => list.indexOf(value) === index);
}

function DietaryTagPill({ tag, compact = false }: { tag: RestaurantDietaryTag; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex rounded-full border border-gold/30 bg-gold/10 font-mono uppercase tracking-[0.2em] text-gold",
        compact ? "px-2 py-0.5 text-[9px]" : "px-3 py-1 text-[10px]",
      )}
    >
      {t(`restaurantDietaryTags.${tag}`)}
    </span>
  );
}

function RestaurantStaffPreview({
  restaurant,
  menuItems,
  hasSavedMenu,
  onBack,
  onStartBooking,
}: {
  restaurant: Restaurant;
  menuItems: MenuItem[];
  hasSavedMenu: boolean;
  onBack: () => void;
  onStartBooking: (slot: string, partySize: number, shiftId?: string, displayTime?: string, bookingDate?: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<StaffPreviewTab>("Menu");
  const [favorite, setFavorite] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedTime, setSelectedTime] = useState("");
  const [previewDate, setPreviewDate] = useState(todayDateValue());
  const [previewPartySize, setPreviewPartySize] = useState(2);
  const previewDateTriggerId = useId();
  const [previewDatePopoverOpen, setPreviewDatePopoverOpen] = useState(false);
  const [selectedSnap, setSelectedSnap] = useState<RestaurantPhoto | null>(null);
  const [previewPartyPopoverOpen, setPreviewPartyPopoverOpen] = useState(false);
  const [previewCalendarMonth, setPreviewCalendarMonth] = useState(() => new Date());
  const [availableDateKeys, setAvailableDateKeys] = useState<Set<string>>(new Set());
  const [dateAvailabilityLoading, setDateAvailabilityLoading] = useState(false);
  const [previewAvailabilityNotice, setPreviewAvailabilityNotice] = useState<string | null>(null);
  const [previewReserving, setPreviewReserving] = useState(false);
  const previewCalendarDay = useMemo(() => {
    const parsedDate = parse(previewDate, "yyyy-MM-dd", new Date());
    return isValid(parsedDate) ? parsedDate : undefined;
  }, [previewDate]);
  const previewDateLabel = new Date(`${previewDate}T12:00:00`).toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const availability = useAvailability();
  const fetchPreviewSlots = availability.fetchSlots;
  const conflictWindows = useDinerConflictWindows({
    userProfileId: null,
    currentRestaurantId: restaurant?.id ?? null,
    date: previewDate,
    timezone: restaurant?.timezone ?? null,
  });
  const { events: allEvents, loading: eventsLoading } = useAllActiveEvents();
  const { stats } = useRestaurantPreviewStats(restaurant.id);
  const { reviews, summary: reviewSummary, loading: reviewsLoading } = useRestaurantReviews(restaurant.id);
  const { photos: dinerPhotos, loading: dinerPhotosLoading } = useRestaurantPhotos(restaurant.id);
  const savedMenuItems = useMemo(() => (hasSavedMenu ? menuItems : []), [hasSavedMenu, menuItems]);
  const menuHighlights = savedMenuItems.slice(0, 4);
  const menuSections = useMemo(() => {
    const categories = uniquePreviewValues(savedMenuItems.map((item) => item.category));
    return categories.map((category) => ({
      category,
      items: savedMenuItems.filter((item) => item.category === category),
    }));
  }, [savedMenuItems]);
  const restaurantEvents = useMemo(
    () => allEvents.filter((event) => event.restaurant_id === restaurant.id),
    [allEvents, restaurant.id],
  );
  const restaurantDisplay = useMemo<RestaurantDisplayInfo>(() => ({
    name: restaurant.name,
    slug: restaurant.slug,
    cuisine_type: restaurant.cuisine_type,
    avg_rating: reviewSummary.avgRating,
    cover_photo_url: restaurant.cover_photo_url,
    city: restaurant.city,
    price_range: deriveRestaurantPriceLevel(savedMenuItems, restaurant.price_range),
  }), [restaurant, reviewSummary.avgRating, savedMenuItems]);
  const eventCards = useMemo(
    () => restaurantEvents.map((event) => eventToDisplay(event, restaurantDisplay)),
    [restaurantDisplay, restaurantEvents],
  );
  const photoSources = useMemo(
    () => uniquePreviewValues([
      restaurant.cover_photo_url,
      restaurant.logo_url,
      ...savedMenuItems.map((item) => item.photoUrl ?? null),
      ...restaurantEvents.map((event) => event.media_type === "image" ? event.media_url : event.cover_image_url),
    ]),
    [restaurant.cover_photo_url, restaurant.logo_url, restaurantEvents, savedMenuItems],
  );
  const availableSlots = useMemo(
    () => filterSlotsByConflicts(availability.slots, conflictWindows),
    [availability.slots, conflictWindows],
  );
  const availableTimes = useMemo(() => availableSlots.map((slot) => slot.display_time), [availableSlots]);
  const hoursRows = useMemo(() => formatRestaurantHoursRows(restaurant.hours_json), [restaurant.hours_json]);
  const priceLevel = deriveRestaurantPriceLevelFromMenu(savedMenuItems);
  const dietaryTags = normalizeRestaurantDietaryTags(restaurant.settings_json?.dietaryTags);
  const selectedTimeLabel = selectedTime ? formatCompactTimeLabel(selectedTime) : "";
  const selectedAvailabilitySlot = availableSlots.find((slot) => slot.display_time === selectedTime);
  const maxPreviewPartySize = Math.max(1, availability.floorCapacity ?? 200);
  const reserveSelectedPreviewSlot = async () => {
    if (!selectedAvailabilitySlot || previewReserving) return;
    setPreviewReserving(true);
    setPreviewAvailabilityNotice(null);
    try {
      const result = await fetchPreviewSlots(restaurant.id, previewDate, previewPartySize, { forceRefresh: true });
      const refreshedSlots = filterSlotsByConflicts(result.slots, conflictWindows);
      const refreshedSlot = refreshedSlots.find((slot) =>
        slot.date_time === selectedAvailabilitySlot.date_time &&
        slot.shift_id === selectedAvailabilitySlot.shift_id,
      );
      if (!refreshedSlot) {
        setPreviewAvailabilityNotice(
          result.message ?? "That time is no longer available. Pick another time.",
        );
        setSelectedTime("");
        return;
      }
      onStartBooking(
        refreshedSlot.date_time,
        previewPartySize,
        refreshedSlot.shift_id,
        formatCompactTimeLabel(refreshedSlot.display_time),
        previewDate,
      );
    } finally {
      setPreviewReserving(false);
    }
  };
  const unavailableDate = (date: Date) => {
    if (date < startOfToday()) return true;
    if (dateAvailabilityLoading) return false;
    return !availableDateKeys.has(dateKey(date));
  };
  const headerBadges = uniquePreviewValues([restaurant.business_type, restaurant.cuisine_type]);

  useEffect(() => {
    void fetchPreviewSlots(restaurant.id, previewDate, previewPartySize);
  }, [fetchPreviewSlots, previewDate, previewPartySize, restaurant.id]);

  useEffect(() => {
    void Promise.resolve().then(() => setPreviewAvailabilityNotice(null));
  }, [previewDate, previewPartySize, restaurant.id]);

  useEffect(() => {
    let cancelled = false;
    const monthStart = startOfMonth(previewCalendarMonth);
    const monthEnd = endOfMonth(previewCalendarMonth);
    const days: string[] = [];
    for (let cursor = monthStart; cursor <= monthEnd; cursor = addDays(cursor, 1)) {
      if (cursor >= startOfToday()) days.push(dateKey(cursor));
    }

    void Promise.resolve().then(() => {
      if (!cancelled) setDateAvailabilityLoading(true);
    });
    void Promise.all(
      days.map(async (day) => {
        const result = await fetchAvailabilitySlots(restaurant.id, day, previewPartySize);
        return result.slots.length > 0 ? day : null;
      }),
    )
      .then((availableDays) => {
        if (!cancelled) {
          setAvailableDateKeys(new Set(availableDays.filter((day): day is string => Boolean(day))));
        }
      })
      .catch(() => {
        if (!cancelled) setAvailableDateKeys(new Set());
      })
      .finally(() => {
        if (!cancelled) setDateAvailabilityLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [previewCalendarMonth, previewPartySize, restaurant.id]);

  useEffect(() => {
    if (availability.loading) return;
    if (availableTimes.length === 0) {
      if (selectedTime) {
        void Promise.resolve().then(() => setSelectedTime(""));
      }
      return;
    }
    if (previewAvailabilityNotice) return;
    if (!availableTimes.includes(selectedTime)) {
      void Promise.resolve().then(() => setSelectedTime(availableTimes[0]));
    }
  }, [availability.loading, availableTimes, previewAvailabilityNotice, selectedTime]);

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      <button
        type="button"
        onClick={onBack}
        className="fixed right-5 top-5 z-50 flex size-10 items-center justify-center rounded-full border border-border bg-bg-elevated/90 text-text-muted shadow-xl shadow-black/40 transition-colors hover:text-white"
        aria-label="Back to dashboard"
      >
        <X className="size-5" />
      </button>

      <div className="relative h-48 border-b border-border bg-bg-base">
        {restaurant.cover_photo_url ? (
          <img src={restaurant.cover_photo_url} alt="" className="size-full object-cover opacity-45" />
        ) : (
          <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(201,168,76,0.24)_0,rgba(201,168,76,0.24)_1px,transparent_1px,transparent_18px)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg-base via-bg-base/55 to-transparent" />
      </div>

      <main className="mx-auto -mt-16 grid max-w-6xl grid-cols-1 gap-5 px-5 pb-16 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="lg:col-span-2">
          <div className="rounded-3xl border border-border bg-bg-surface p-6 shadow-2xl shadow-black/40">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-4">
                <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-gold/30 bg-bg-elevated font-mono text-sm font-semibold text-gold shadow-lg shadow-black/20">
                  {restaurant.logo_url ? (
                    <img src={restaurant.logo_url} alt={`${restaurant.name} logo`} className="size-full object-cover" />
                  ) : (
                    restaurant.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase()
                  )}
                </div>
                <div>
                  <div className="flex flex-wrap gap-2">
                    {headerBadges.map((badge) => (
                      <span
                        key={badge}
                        className="rounded-full border border-border bg-bg-elevated px-3 py-1 font-mono text-[10px] uppercase tracking-[0.24em] text-text-secondary"
                      >
                        {badge}
                      </span>
                    ))}
                    {dietaryTags.map((tag) => (
                      <DietaryTagPill key={tag} tag={tag} />
                    ))}
                    {availableTimes.length > 0 && (
                      <span className="rounded-full border border-success/30 bg-success/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.24em] text-success">
                        {availableTimes.length} times today
                      </span>
                    )}
                  </div>
                  <h1 className="mt-4 font-serif text-5xl leading-none text-white">{restaurant.name}</h1>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-text-secondary">
                    {restaurant.cuisine_type ? <span>{capitalizeWords(restaurant.cuisine_type)}</span> : null}
                    <RestaurantPriceMeter level={priceLevel} />
                    {restaurant.city ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" />
                        {restaurant.city}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <RestaurantSocialLinks
                  settingsJson={restaurant.settings_json}
                  websiteFallback={restaurant.website}
                  linkClassName="size-10"
                />
                <button
                  type="button"
                  aria-pressed={favorite}
                  onClick={() => setFavorite((value) => !value)}
                  className={cn(
                    "flex size-10 items-center justify-center rounded-full border border-border bg-bg-elevated transition-colors",
                    favorite ? "text-gold" : "text-text-muted hover:text-white",
                  )}
                >
                  <Heart className={cn("size-4", favorite ? "fill-gold" : "")} />
                </button>
                <button
                  type="button"
                  aria-pressed={saved}
                  onClick={() => setSaved((value) => !value)}
                  className={cn(
                    "flex size-10 items-center justify-center rounded-full border border-border bg-bg-elevated transition-colors",
                    saved ? "text-gold" : "text-text-muted hover:text-white",
                  )}
                >
                  <Bookmark className={cn("size-4", saved ? "fill-gold" : "")} />
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-5">
          <div className="grid grid-cols-5 rounded-full border border-border bg-bg-surface p-1 text-xs">
            {STAFF_PREVIEW_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "rounded-full px-4 py-2 transition-colors",
                  activeTab === tab ? "bg-gold text-bg-base" : "text-text-secondary hover:text-white",
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          {activeTab === "Menu" ? (
            <>
              <div className="rounded-3xl border border-border bg-bg-surface p-5">
                <div className="mb-5 flex items-end justify-between">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold">Menu</p>
                    <h2 className="mt-2 font-serif text-2xl text-white">Menu highlights</h2>
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-muted">
                    {menuHighlights.length} dishes
                  </span>
                </div>
                {menuHighlights.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {menuHighlights.map((item) => <PreviewDishCard key={item.id} item={item} />)}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border bg-bg-elevated p-5 text-sm text-text-muted">
                    No public menu items have been added yet.
                  </div>
                )}
              </div>

              {menuSections.map((section) => (
                <div key={section.category} className="rounded-3xl border border-border bg-bg-surface p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="font-serif text-2xl text-white">{section.category}</h2>
                    <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-muted">{section.items.length} items</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {section.items.map((item) => <PreviewDishCard key={item.id} item={item} compact />)}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div className="rounded-3xl border border-border bg-bg-surface p-6">
              {activeTab === "Photos" && (
                <>
                  <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold">Media</p>
                  <h2 className="mt-2 font-serif text-2xl text-white">Photos</h2>

                  {/* Diner snaps — visit_photos joined with reviewer info +
                      paired review via booking_id / ±5min heuristic. Mobile
                      writes these; web is read-only for snap creation. */}
                  <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                    From diners
                  </p>
                  {dinerPhotosLoading ? (
                    <div className="mt-3 rounded-2xl border border-dashed border-border bg-bg-elevated p-5 text-sm text-text-muted">
                      Loading photos...
                    </div>
                  ) : dinerPhotos.length > 0 ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                      {dinerPhotos.map((p) => (
                        <article
                          key={p.id}
                          className="overflow-hidden rounded-2xl border border-border bg-bg-elevated"
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedSnap(p)}
                            className="block aspect-square w-full overflow-hidden bg-bg-base transition-opacity hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
                            aria-label={`View full review from ${p.poster_name ?? "this diner"}`}
                          >
                            <img
                              src={p.image_url}
                              alt={p.caption ?? `Photo at ${restaurant.name}`}
                              loading="lazy"
                              className="size-full object-cover"
                            />
                          </button>
                          <div className="space-y-2 p-3">
                            <div className="flex items-center gap-2">
                              {p.poster_avatar_url ? (
                                <img
                                  src={p.poster_avatar_url}
                                  alt=""
                                  className="size-7 rounded-full object-cover"
                                />
                              ) : (
                                <div className="flex size-7 items-center justify-center rounded-full bg-gold/15 text-[10px] font-semibold text-gold">
                                  {(p.poster_name ?? "?").slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              <span className="truncate text-xs text-text-secondary">
                                {p.poster_name ?? "A diner"}
                              </span>
                              {p.paired_review ? (
                                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-gold/10 px-2 py-0.5 text-[11px] font-medium text-gold">
                                  <Star className="size-3 fill-gold" />
                                  {p.paired_review.rating}
                                </span>
                              ) : p.rating ? (
                                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-gold/10 px-2 py-0.5 text-[11px] font-medium text-gold">
                                  <Star className="size-3 fill-gold" />
                                  {p.rating}
                                </span>
                              ) : null}
                            </div>
                            {p.paired_review?.review_text ? (
                              <p className="line-clamp-2 text-sm leading-snug text-text-secondary">
                                {p.paired_review.review_text}
                              </p>
                            ) : p.caption ? (
                              <p className="line-clamp-2 text-sm leading-snug text-text-secondary">
                                {p.caption}
                              </p>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-2xl border border-dashed border-border bg-bg-elevated p-5 text-sm text-text-muted">
                      No photos shared yet. Diners can post photos from the mobile app after their visit.
                    </div>
                  )}

                  {/* Restaurant-owned photos (cover, menu shots) — owner-uploaded
                      gallery, distinct from diner snaps. */}
                  {photoSources.length > 0 ? (
                    <>
                      <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                        From the restaurant
                      </p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        {photoSources.map((imageUrl) => (
                          <div key={imageUrl} className="h-36">
                            <PreviewArt label={restaurant.name} imageUrl={imageUrl} />
                          </div>
                        ))}
                      </div>
                    </>
                  ) : null}
                </>
              )}
              {activeTab === "Reviews" && (
                <>
                  <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold">Guest sentiment</p>
                  <div className="mt-2 flex items-center justify-between gap-4">
                    <h2 className="font-serif text-2xl text-white">Reviews</h2>
                    {reviewSummary.totalReviews > 0 && reviewSummary.avgRating != null ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-sm text-gold">
                        <Star className="size-4 fill-gold" />
                        <span className="font-semibold">{reviewSummary.avgRating.toFixed(1)}</span>
                        <span className="text-xs text-text-muted">({reviewSummary.totalReviews})</span>
                      </span>
                    ) : null}
                  </div>
                  {reviewsLoading ? (
                    <div className="mt-5 rounded-2xl border border-dashed border-border bg-bg-elevated p-5 text-sm text-text-muted">
                      Loading reviews...
                    </div>
                  ) : reviews.length > 0 ? (
                    <div className="mt-5 space-y-3">
                      {reviews.map((review) => (
                        <article key={review.id} className="rounded-2xl bg-bg-elevated p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                              {review.reviewer_avatar_url ? (
                                <img
                                  src={review.reviewer_avatar_url}
                                  alt=""
                                  className="size-8 rounded-full object-cover"
                                />
                              ) : (
                                <div className="flex size-8 items-center justify-center rounded-full bg-gold/15 text-xs font-semibold text-gold">
                                  {(review.reviewer_name ?? "?").slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="truncate text-sm text-white">
                                  {review.reviewer_name ?? "A diner"}
                                </p>
                                <div className="mt-0.5 flex items-center gap-0.5 text-gold">
                                  {[1, 2, 3, 4, 5].map((value) => (
                                    <Star
                                      key={value}
                                      className={cn(
                                        "size-3.5",
                                        value <= review.rating ? "fill-gold text-gold" : "text-text-muted",
                                      )}
                                    />
                                  ))}
                                </div>
                              </div>
                            </div>
                            <span className="shrink-0 text-[11px] text-text-muted">
                              {format(new Date(review.created_at), "MMM d, yyyy")}
                            </span>
                          </div>
                          {review.review_text ? (
                            <p className="mt-3 text-sm leading-6 text-text-secondary">{review.review_text}</p>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-5 rounded-2xl border border-dashed border-border bg-bg-elevated p-5 text-sm text-text-muted">
                      No public reviews have been recorded for this restaurant yet.
                    </div>
                  )}
                </>
              )}
              {activeTab === "About" && (
                <>
                  <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold">About</p>
                  <h2 className="mt-2 font-serif text-2xl text-white">{restaurant.name}</h2>
                  <p className="mt-4 leading-relaxed text-text-secondary">
                    {restaurant.description ?? `${restaurant.name} has not added a public description yet.`}
                  </p>
                  <div className="mt-5 grid gap-3 text-sm text-text-secondary sm:grid-cols-2">
                    <p className="rounded-2xl bg-bg-elevated p-4">{restaurant.address ?? "Address not set"}</p>
                    <p className="rounded-2xl bg-bg-elevated p-4">{restaurant.phone ?? "Phone not set"}</p>
                  </div>
                  <div className="mt-5 rounded-2xl bg-bg-elevated p-4">
                    <h3 className="font-serif text-lg text-white">Weekly hours</h3>
                    <dl className="mt-3 space-y-2 text-xs text-text-secondary">
                      {hoursRows.map((row) => (
                        <div key={row.key} className="flex justify-between gap-4">
                          <dt>{row.label}</dt>
                          <dd className={row.open ? "text-white" : "text-text-muted"}>{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </>
              )}
              {activeTab === "Events" && (
                <>
                  <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold">Upcoming</p>
                  <h2 className="mt-2 font-serif text-2xl text-white">Events</h2>
                  {eventCards.length > 0 ? (
                    <div className="mt-5 grid gap-3">
                      {eventCards.map((event) => (
                        <EventPromotionDetailCard
                          key={event.id}
                          item={event}
                          onReserve={() => void reserveSelectedPreviewSlot()}
                          onRestaurantOpen={() => setActiveTab("Menu")}
                          className="shadow-none"
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="mt-5 rounded-2xl border border-dashed border-border bg-bg-elevated p-5 text-sm text-text-muted">
                      {eventsLoading ? "Loading events..." : "No active events have been added yet."}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        <aside className="space-y-4 lg:sticky lg:top-5 lg:self-start">
          <div className="rounded-3xl border border-border bg-bg-surface p-6">
            <h2 className="font-serif text-2xl text-white">Reserve a table</h2>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Popover open={previewDatePopoverOpen} onOpenChange={setPreviewDatePopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    id={previewDateTriggerId}
                    type="button"
                    className="flex items-center gap-3 rounded-2xl bg-bg-elevated p-4 text-left transition-colors hover:bg-bg-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
                  >
                    <CalendarDays className="size-4 text-gold" />
                    <span>
                      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-muted">Date</p>
                      <p className="mt-2 text-sm text-white">{previewDateLabel}</p>
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-auto border-border bg-bg-elevated p-0 text-text-primary shadow-2xl"
                >
                  <Calendar
                    mode="single"
                    required={false}
                    selected={previewCalendarDay}
                    month={previewCalendarMonth}
                    onMonthChange={setPreviewCalendarMonth}
                    onSelect={(date) => {
                      if (!date) return;
                      setPreviewDate(format(date, "yyyy-MM-dd"));
                      setPreviewDatePopoverOpen(false);
                    }}
                    disabled={unavailableDate}
                    className="rounded-md border-0 bg-transparent [--cell-size:--spacing(8)]"
                  />
                </PopoverContent>
              </Popover>
              <Popover open={previewPartyPopoverOpen} onOpenChange={setPreviewPartyPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-3 rounded-2xl bg-bg-elevated p-4 text-left transition-colors hover:bg-bg-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
                  >
                    <Users className="size-4 text-gold" />
                    <span>
                      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-muted">Party</p>
                      <p className="mt-2 text-sm text-white">
                        {previewPartySize} guest{previewPartySize === 1 ? "" : "s"}
                      </p>
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-48 border-border bg-bg-elevated p-2 text-text-primary shadow-2xl"
                >
                  <SeatWheel
                    maxSeats={maxPreviewPartySize}
                    value={previewPartySize}
                    onCommit={(party) => {
                      setPreviewPartySize(party);
                      setPreviewPartyPopoverOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.24em] text-text-muted">Available times</p>
            {availableTimes.length > 0 ? (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {availableTimes.map((time) => (
                  <button
                    key={time}
                    type="button"
                    onClick={() => {
                      setPreviewAvailabilityNotice(null);
                      setSelectedTime(time);
                    }}
                    className={cn(
                      "rounded-xl px-3 py-3 text-xs transition-colors",
                      selectedTime === time ? "bg-gold text-bg-base" : "bg-bg-elevated text-text-secondary hover:text-white",
                    )}
                  >
                    {formatCompactTimeLabel(time)}
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-2xl bg-bg-elevated p-4 text-xs text-text-muted">
                {availability.loading
                  ? "Checking availability..."
                  : availability.unavailableReason === "party_size_out_of_range"
                    ? availability.floorCapacity
                      ? `This restaurant seats up to ${availability.floorCapacity} guests. Try a smaller party or contact the restaurant directly for larger groups.`
                      : "That party size is outside this restaurant's bookable range."
                    : availability.unavailableReason === "fully_booked"
                      ? "Fully booked for this date — try another day."
                      : availability.unavailableReason === "closed"
                        ? "Closed on this date."
                        : availability.unavailableReason === "no_shifts"
                          ? "No service hours configured for this date."
                          : availability.unavailableReason === "no_future_slots"
                            ? "No more times available later today — try another date."
                            : (availability.unavailableMessage ?? "Unavailable for this date and party size.")}
              </div>
            )}
            <Button
              className="mt-4 h-12 w-full rounded-xl"
              onClick={() => void reserveSelectedPreviewSlot()}
              disabled={!selectedAvailabilitySlot || availability.loading || previewReserving}
            >
              {previewReserving ? "Checking availability..." : selectedTimeLabel ? `Continue with ${selectedTimeLabel}` : "No times available"}
            </Button>
            {previewAvailabilityNotice ? (
              <p className="mt-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
                {previewAvailabilityNotice}
              </p>
            ) : null}
            <p className="mt-5 rounded-xl bg-bg-elevated/60 p-3 text-xs leading-relaxed text-text-muted">
              Availability is calculated from this restaurant's saved tables, reservations, and booking rules.
            </p>
          </div>
          <div className="rounded-3xl border border-border bg-bg-surface p-5 text-xs text-text-secondary">
            <p>{stats.bookedToday} booking{stats.bookedToday === 1 ? "" : "s"} today</p>
            <p className="mt-3">{restaurant.accepts_walkins === false ? "Reservations only" : "Walk-ins accepted when available"}</p>
            <p className="mt-3">Party size uses live availability</p>
          </div>
        </aside>
      </main>
      <PhotoReviewDialog
        open={selectedSnap !== null}
        onOpenChange={(next) => { if (!next) setSelectedSnap(null); }}
        photo={selectedSnap}
        restaurantName={restaurant.name}
      />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function RestaurantPublicPage() {
  const { t } = useTranslation();
  const { restaurantSlug } = useParams<{ restaurantSlug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  /** Did the user arrive here from Cenaiva's prepay flow? If so, after the
   *  checkout confirms we want to drop them back on their dashboard rather
   *  than the generic "Back to Discover" CTA. */
  const cameFromCenaivaPrepay = !!searchParams.get("order_id");
  const isStaffPreview = searchParams.get("preview") === "dashboard";
  const backParam = searchParams.get("back");
  const returnDetail = searchParams.get("returnDetail");
  const backTarget =
    backParam === "dashboard"
      ? "/dashboard"
      : backParam === "deals"
        ? returnDetail
          ? `/deals?detail=${encodeURIComponent(returnDetail)}`
          : "/deals"
        : "/discover";
  const requestedBookingTime = searchParams.get("time") ?? searchParams.get("slot");
  const requestedBookingSlot = searchParams.get("slot");
  const requestedShiftId = searchParams.get("shift_id") ?? "";
  const requestedIsoSlot = requestedBookingSlot?.match(/^\d{4}-\d{2}-\d{2}T/)
    ? requestedBookingSlot
    : requestedBookingTime?.match(/^\d{4}-\d{2}-\d{2}T/)
      ? requestedBookingTime
      : "";
  const initialBookingTime = requestedBookingTime?.match(/^\d{4}-\d{2}-\d{2}T/)
    ? formatCompactTimeLabel(new Date(requestedBookingTime))
    : requestedBookingTime
      ? formatCompactTimeLabel(requestedBookingTime)
      : "";
  const requestedDateParam = optionalDateValueFromSearch(searchParams.get("date"));
  const initialBookingDate = requestedDateParam
    ?? (requestedIsoSlot ? requestedIsoSlot.slice(0, 10) : dateValueFromDiscoverPreset(searchParams.get("date")));
  const initialPartySize = Math.max(1, Number.parseInt(searchParams.get("people") ?? "2", 10) || 2);
  const previewSlotRevalidation = previewSlotRevalidationFromState(location.state);
  const previewSlotRevalidationMatchesRequest = Boolean(
    previewSlotRevalidation &&
    previewSlotRevalidation.slot === requestedIsoSlot &&
    previewSlotRevalidation.date === initialBookingDate &&
    previewSlotRevalidation.partySize === initialPartySize &&
    (!previewSlotRevalidation.shiftId || previewSlotRevalidation.shiftId === requestedShiftId),
  );
  // Lock the slot only when an exact ISO `slot=` came in (preview-modal
  // and time-pill-click flows). When only `date/time/people` are passed
  // — e.g. from /deals → event/promo card → Book — we still want the
  // diner to pick a real slot from the AvailabilityPanel pills; those
  // params just pre-fill the panel's date and party controls.
  const bookingLockedFromPreview = Boolean(searchParams.get("slot"));
  const { restaurant, loading } = useRestaurant(restaurantSlug);
  const { user, profile, restaurantRoles } = useUser();
  const viewerIsStaffOfRestaurant = Boolean(
    restaurant && restaurantRoles.some((r) => r.restaurant_id === restaurant.id),
  );
  const { promotions: allPromos } = useAllActivePromotions();
  const [step, setStep] = useState<Step>("details");
  const menuQueriesEnabled = step === "menu" || step === "checkout";
  const { categories: dbCategories } = usePublicMenuCategories(restaurant?.id, { enabled: menuQueriesEnabled });
  const { items: dbMenuItems, loading: menuLoading } = usePublicMenuItems(restaurant?.id, { enabled: menuQueriesEnabled });
  const restaurantPromos = useMemo(
    () => allPromos.filter((p) => p.restaurant_id === restaurant?.id),
    [allPromos, restaurant?.id],
  );

  // Map DB menu items to the local MenuItem shape used by the cart/allergen system
  const menuItems = useMemo<MenuItem[]>(() => {
    const activeCategoriesById = new Map(dbCategories.map((category) => [category.id, category]));
    return dbMenuItems.flatMap((row) => {
      const category = row.category_id ? activeCategoriesById.get(row.category_id) : null;
      if (!category) return [];
      return [{
        id: row.id,
        name: row.name,
        description: row.description ?? "",
        price: row.price,
        category: category.name,
        popular: row.is_featured,
        dietary: row.dietary_flags ?? [],
        photoUrl: row.photo_url,
        allergens: row.allergens ?? [],
        ingredients: row.description ?? "",
      }];
    });
  }, [dbMenuItems, dbCategories]);

  const categoryList = useMemo(
    () => ["All", ...uniquePreviewValues([
      ...dbCategories.map((c) => c.name),
      ...menuItems.map((item) => item.category),
    ])],
    [dbCategories, menuItems],
  );

  const [activeCategory, setActiveCategory] = useState("All");
  const [activePromoId, setActivePromoId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);

  const [dineIn, setDineIn] = useState<DineInDetails>({
    date: initialBookingDate, time: initialBookingTime, party_size: initialPartySize,
    seating_preference: "",
    name: "", email: "", phone: "", allergies: "", occasion: "",
  });
  // Slot picked via the unified <AvailabilityPanel>. Falls back to
  // selectedAvailabilitySlot (the legacy lookup) when not set.
  const [pickedAvailabilitySlot, setPickedAvailabilitySlot] = useState<AvailabilitySlot | null>(null);

  useEffect(() => {
    if (!bookingLockedFromPreview || cameFromCenaivaPrepay) return;
    void Promise.resolve().then(() => {
      setDineIn((details) => {
        const nextDate = initialBookingDate || details.date;
        const nextTime = initialBookingTime || details.time;
        const nextPartySize = initialPartySize || details.party_size;
        if (
          details.date === nextDate &&
          details.time === nextTime &&
          details.party_size === nextPartySize
        ) {
          return details;
        }
        return {
          ...details,
          date: nextDate,
          time: nextTime,
          party_size: nextPartySize,
        };
      });
    });
  }, [bookingLockedFromPreview, cameFromCenaivaPrepay, initialBookingDate, initialBookingTime, initialPartySize]);

  // Pre-fill contact fields from logged-in profile (only on first load)
  useEffect(() => {
    if (!profile) return;
    const name = profile.full_name ?? "";
    const email = profile.email ?? "";
    const phone = profile.phone ?? "";
    const allergies = profile.allergies?.join(", ") ?? "";
    const seating = profile.seating_preference ?? "";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prefill form from asynchronously loaded profile once available
    setDineIn((d) => ({
      ...d,
      name: d.name || name,
      email: d.email || email,
      phone: d.phone || phone,
      allergies: d.allergies || allergies,
      seating_preference: d.seating_preference || seating,
    }));
  }, [profile]);

  // Apply this restaurant's theme while on its public page; reset on leave.
  useEffect(() => {
    if (!restaurant?.settings_json?.theme) return;
    applyRestaurantTheme(restaurant.settings_json.theme);
    return () => { resetTheme(); };
  }, [restaurant?.id, restaurant?.settings_json]);

  /** When arriving via Cenaiva's order_id deep-link we already have a
   *  reservation + order in the DB. Holding the existing reservation_id
   *  lets handlePlaceOrder skip re-inserting a new one (which would fail
   *  anyway — dineIn.date is only populated from the existing record, so
   *  a manual-flow insert would ship "T19:00:00" as the timestamp). */
  const [existingReservationId, setExistingReservationId] = useState<string | null>(null);
  const [existingOrderId, setExistingOrderId] = useState<string | null>(null);
  const availability = useAvailability();
  const fetchRestaurantSlots = availability.fetchSlots;
  const forcedPreviewRevalidationKeyRef = useRef<string | null>(null);
  // Conflict filter: hide slots that overlap a logged-in diner's other bookings
  // on the same calendar day across different restaurants. No-op for guests.
  const dinerConflictWindows = useDinerConflictWindows({
    userProfileId: profile?.id ?? null,
    currentRestaurantId: restaurant?.id ?? null,
    date: dineIn?.date || null,
    timezone: restaurant?.timezone ?? null,
  });
  const filteredAvailabilitySlots = useMemo(
    () => filterSlotsByConflicts(availability.slots, dinerConflictWindows),
    [availability.slots, dinerConflictWindows],
  );

  // Live invalidation: when another diner's booking lands at this restaurant,
  // drop the cached availability so the next render shows fresh slots. If a
  // date/party is currently in view, kick a re-fetch right away.
  const dineInDate = dineIn?.date || null;
  const dineInPartySize = typeof dineIn?.party_size === "number" ? dineIn.party_size : null;
  const refetchSlots = useCallback(() => {
    if (!restaurant?.id || !dineInDate || !dineInPartySize) return;
    void fetchRestaurantSlots(restaurant.id, dineInDate, dineInPartySize, { forceRefresh: true });
  }, [restaurant?.id, dineInDate, dineInPartySize, fetchRestaurantSlots]);
  useAvailabilityRealtimeInvalidate(restaurant?.id ?? null, refetchSlots);

  // ── Deep-link from Cenaiva voice pre-order: ?step=menu (2026-05-16) ──────
  // When Cenaiva orchestrator hands off a pre-order intent ("I want to
  // pre-order food at X"), it navigates to /<slug>?step=menu expecting the
  // page to jump straight to the menu step. Without this useEffect the page
  // lands on Details (the default initial step) and the user has to manually
  // click "Continue" to reach the menu — defeats the hand-off.
  useEffect(() => {
    const targetStep = searchParams.get("step") as Step | null;
    if (targetStep === "menu" && step !== "menu") {
      setStep("menu");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Deep-link from Cenaiva post-confirm pre-order: ?reservation_id= ──────
  // R11 (2026-05-18): when voice creates the reservation FIRST and then
  // asks "want to pre-order?", an affirmative routes the user here with
  // the reservation_id pinned. Setting existingReservationId tells
  // handlePlaceOrder (~line 1962) to skip the booking-create branch and
  // attach the pre-order to the existing row. Without this, proceeding
  // to checkout would call book_reservation, which fires diner_double_book
  // (P0006) since the user already has a reservation at that slot.
  useEffect(() => {
    const reservationIdParam = searchParams.get("reservation_id");
    if (reservationIdParam && !existingReservationId) {
      setExistingReservationId(reservationIdParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Deep-link from Cenaiva: ?order_id=xxx&step=checkout ──────────────────
  // When Cenaiva creates an order and the user wants to pay via the manual
  // checkout (split bill, different card), it links here with the order_id.
  // We fetch the order + its linked reservation, populate cart + dine-in
  // state, and jump to the checkout step. Without pulling the reservation
  // into dineIn, the checkout form's hidden date field stays empty and the
  // reservation insert fails with "invalid input syntax for type timestamp"
  // because the built string collapses to "T19:00:00".
  useEffect(() => {
    const orderId = searchParams.get("order_id");
    const targetStep = searchParams.get("step") as Step | null;
    if (!orderId || targetStep !== "checkout" || !isSupabaseConfigured()) return;

    void (async () => {
      // Fetch via edge function (service role) — the customer arriving from
      // Cenaiva's prepay deep-link is unauthenticated, so the orders RLS
      // policy `orders_select_own` would return null for a direct query.
      const client = getSupabaseBrowserClient();
      const { data: sessionData } = await client.auth.getSession();
      const token = sessionData.session?.access_token ?? null;
      const res = await fetch(
        `${getSupabaseProjectUrl()}/functions/v1/get-order-public?order_id=${encodeURIComponent(orderId)}`,
        {
          headers: {
            apikey: getSupabaseAnonKey(),
            Authorization: `Bearer ${token ?? getSupabaseAnonKey()}`,
          },
        },
      );
      if (!res.ok) return;
      const json = (await res.json()) as { order?: unknown };
      const order = json.order as
        | {
            id: string;
            notes: string | null;
            reservation_id: string | null;
            order_items: { name: string; quantity: number; unit_price: number; modifications: string | null; menu_item_id: string | null }[];
            reservations: { id: string; reserved_at: string | null; party_size: number | null; guest_full_name: string | null; guest_email: string | null; guest_phone: string | null; special_request: string | null; occasion: string | null } | null;
          }
        | undefined;
      if (!order) return;

      const orderItems = (order.order_items || []) as {
        name: string; quantity: number; unit_price: number;
        modifications: string | null; menu_item_id: string | null;
      }[];

      // Populate cart from order items — build minimal MenuItem shells
      const cartItems: CartItem[] = orderItems.map((item) => ({
        id: item.menu_item_id || `item-${Math.random()}`,
        name: item.name,
        description: "",
        price: item.unit_price,
        category: "",
        popular: false,
        dietary: [],
        photoUrl: null,
        allergens: [],
        ingredients: "",
        qty: item.quantity,
        note: item.modifications || undefined,
      }));

      setCart(cartItems);
      setExistingOrderId(order.id as string);

      const resv = (order as { reservations?: {
        id: string; reserved_at: string | null; party_size: number | null;
        guest_full_name: string | null; guest_email: string | null; guest_phone: string | null;
        special_request: string | null; occasion: string | null;
      } | null }).reservations;
      if (resv) {
        setExistingReservationId(resv.id);
        // reserved_at is an ISO timestamp — split into YYYY-MM-DD + "h:mm AM/PM"
        let date = "";
        let time = "";
        if (resv.reserved_at) {
          const d = new Date(resv.reserved_at);
          if (!Number.isNaN(d.getTime())) {
            const y = d.getFullYear();
            const mo = String(d.getMonth() + 1).padStart(2, "0");
            const da = String(d.getDate()).padStart(2, "0");
            date = `${y}-${mo}-${da}`;
            let h = d.getHours();
            const mi = String(d.getMinutes()).padStart(2, "0");
            const period = h >= 12 ? "PM" : "AM";
            if (h === 0) h = 12;
            else if (h > 12) h -= 12;
            time = `${h}:${mi} ${period}`;
          }
        }
        setDineIn((prev) => ({
          ...prev,
          date,
          time,
          party_size: resv.party_size ?? prev.party_size,
          name: resv.guest_full_name ?? prev.name,
          email: resv.guest_email ?? prev.email,
          phone: resv.guest_phone ?? prev.phone,
          allergies: resv.special_request ?? prev.allergies,
          occasion: resv.occasion ?? prev.occasion,
        }));
      }

      setStep("checkout");
    })();
  // Run once on mount — searchParams is stable for the initial URL
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [paymentSplitMode, setPaymentSplitMode] = useState<"single" | "split">("single");
  // Split-deposit-with-friends (the magic-link variant) was consolidated
  // into Split tender on 2026-05-20. All split-pay flows now use the
  // multi-card-on-one-device path via SplitTenderPaymentForm. The
  // magic-link infrastructure (prepare-deposit / dispatch-deposit-invites
  // / DepositPayPage) is still in place for owner-initiated deposit
  // invites in the dashboard, just no longer triggered from this page.

  // True between the Stripe form submit and the post-payment reservation
  // creation. Disables Place Order to prevent double-submits.
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  /** Raw input so the field can be cleared while typing; clamped on blur. Parsed as `splitPartyCount`. */
  const [splitPartyCountInput, setSplitPartyCountInput] = useState("2");
  const splitPartyCountParse = useMemo(() => {
    const raw = splitPartyCountInput.trim();
    if (raw === "") return { kind: "empty" as const };
    const n = Number.parseInt(splitPartyCountInput, 10);
    if (Number.isNaN(n)) return { kind: "invalid" as const };
    if (n < 2 || n > 10) return { kind: "out_of_range" as const };
    return { kind: "ok" as const, value: n };
  }, [splitPartyCountInput]);
  const splitPartyCount =
    splitPartyCountParse.kind === "ok" ? splitPartyCountParse.value : NaN;
  // Split-tender card collection is handled inside SplitTenderPaymentForm —
  // no per-row card state in the parent.
  const [tipOption, setTipOption] = useState<"15" | "18" | "20" | "custom" | "after">("18");
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [confirmationCode, setConfirmationCode] = useState<string>("");
  const [confirmationDelivery, setConfirmationDelivery] = useState<{
    status: "sent" | "skipped" | "failed";
    channel: "email" | "sms" | null;
  }>({ status: "skipped", channel: null });

  const currency = restaurant?.currency ?? "cad";
  const gradient = CUISINE_GRADIENT[restaurant?.cuisine_type ?? ""] ?? "from-zinc-900 to-neutral-900";

  useEffect(() => {
    if (!restaurant?.id || !dineIn.date || typeof dineIn.party_size !== "number") return;
    const previewRevalidationKey = previewSlotRevalidationMatchesRequest && requestedIsoSlot
      ? `${restaurant.id}|${requestedIsoSlot}|${requestedShiftId}|${dineIn.date}|${dineIn.party_size}`
      : "";
    const forceRefresh = Boolean(
      previewRevalidationKey &&
      forcedPreviewRevalidationKeyRef.current !== previewRevalidationKey,
    );
    if (forceRefresh) {
      forcedPreviewRevalidationKeyRef.current = previewRevalidationKey;
    }
    void fetchRestaurantSlots(
      restaurant.id,
      dineIn.date,
      dineIn.party_size,
      forceRefresh ? { forceRefresh: true } : undefined,
    );
  }, [
    fetchRestaurantSlots,
    dineIn.date,
    dineIn.party_size,
    previewSlotRevalidationMatchesRequest,
    requestedIsoSlot,
    requestedShiftId,
    restaurant?.id,
  ]);

  const availableTimeOptions = useMemo(
    () => filteredAvailabilitySlots.map((slot) => formatCompactTimeLabel(slot.display_time)),
    [filteredAvailabilitySlots],
  );

  const lockedPreviewSlotAvailable = useMemo(
    () => {
      if (!bookingLockedFromPreview) return false;
      if (!requestedIsoSlot) return true;
      if (availability.loading || !dineIn.date) return true;
      return filteredAvailabilitySlots.some((slot) =>
        slot.date_time === requestedIsoSlot && (!requestedShiftId || slot.shift_id === requestedShiftId),
      );
    },
    [availability.loading, bookingLockedFromPreview, dineIn.date, filteredAvailabilitySlots, requestedIsoSlot, requestedShiftId],
  );
  const previewSlotNoLongerAvailable =
    bookingLockedFromPreview && Boolean(requestedIsoSlot) && !availability.loading && !lockedPreviewSlotAvailable;
  useEffect(() => {
    if (!dineIn.date || availability.loading || availability.slots.length === 0) return;
    if (availableTimeOptions.includes(dineIn.time)) return;
    // When the URL pinned a specific slot, leave dineIn.time alone — the URL
    // is authoritative. A preview-time mismatch surfaces via the "no longer
    // available" warning rather than a silent reset (which would both lie to
    // the user about their pick and could submit a different time).
    if (bookingLockedFromPreview && requestedIsoSlot) return;
    // 2026-05-16 fix: when Cenaiva voice deep-links here with ?time= but no
    // ?slot=, leave dineIn.time alone — the URL is authoritative.
    if (requestedBookingTime) return;
    void Promise.resolve().then(() => {
      setDineIn((details) => ({ ...details, time: availableTimeOptions[0] ?? "" }));
    });
  }, [
    availability.loading,
    availability.slots.length,
    availableTimeOptions,
    bookingLockedFromPreview,
    dineIn.date,
    dineIn.time,
    requestedIsoSlot,
    requestedBookingTime,
  ]);

  useEffect(() => {
    // Clear stale time only once the user has actually picked a date/party and
    // the resulting fetch returned zero slots. Without the URL-pin guard, this
    // would also fire on the very first render (slots.length === 0 before any
    // fetch has started) and wipe the time we just read from the URL — that's
    // how a 12:30pm pick was ending up displayed as 11am.
    if (bookingLockedFromPreview) return;
    if (!dineIn.date || availability.loading || availability.slots.length > 0 || !dineIn.time) return;
    void Promise.resolve().then(() => {
      setDineIn((details) => ({ ...details, time: "" }));
    });
  }, [availability.loading, availability.slots.length, bookingLockedFromPreview, dineIn.date, dineIn.time]);

  const filteredMenu = useMemo(() => {
    let list = activeCategory === "All" ? menuItems : menuItems.filter((m) => m.category === activeCategory);
    if (activePromoId) {
      const promo = restaurantPromos.find((p) => p.id === activePromoId);
      if (promo) {
        if (promo.promo_type === "bogo" && promo.bogo_item_ids.length > 0) {
          const ids = new Set(promo.bogo_item_ids);
          list = list.filter((m) => ids.has(m.id));
        } else if (promo.promo_type === "free_item" && promo.free_item_id) {
          list = list.filter((m) => m.id === promo.free_item_id);
        } else if ((promo.promo_type === "percentage" || promo.promo_type === "fixed") && promo.eligible_item_ids.length > 0) {
          const ids = new Set(promo.eligible_item_ids);
          list = list.filter((m) => ids.has(m.id));
        }
        // bogo/percentage/fixed with no item IDs = applies to full menu — no filter
      }
    }
    return list;
  }, [activeCategory, activePromoId, menuItems, restaurantPromos]);

  const eligiblePromoItemIds = useMemo<Set<string>>(() => {
    if (!activePromoId) return new Set();
    const promo = restaurantPromos.find((p) => p.id === activePromoId);
    if (!promo) return new Set();
    const allIds = () => new Set(menuItems.map((m) => m.id));
    if (promo.promo_type === "bogo") {
      return promo.bogo_item_ids.length > 0 ? new Set(promo.bogo_item_ids) : allIds();
    }
    if (promo.promo_type === "free_item") {
      return promo.free_item_id ? new Set([promo.free_item_id]) : new Set();
    }
    // percentage / fixed: empty eligible_item_ids = whole cart
    return promo.eligible_item_ids.length > 0 ? new Set(promo.eligible_item_ids) : allIds();
  }, [activePromoId, restaurantPromos, menuItems]);

  // Parse the user's allergy text into individual keywords and find flagged items
  const { flaggedItems, allergenKeywords } = useMemo(() => {
    const raw = dineIn.allergies;
    if (!raw.trim()) return { flaggedItems: [], allergenKeywords: [] };

    // Split on commas, spaces, common separators and lowercase
    const keywords = raw
      .toLowerCase()
      .split(/[,;/\s]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 2);

    // Canonical allergen map — maps user words → allergen tag
    const ALIAS: Record<string, string> = {
      nut: "nuts", nuts: "nuts", peanut: "nuts", peanuts: "nuts", almond: "nuts",
      walnut: "nuts", cashew: "nuts", hazelnut: "nuts", pistachio: "nuts",
      tree: "nuts",
      dairy: "dairy", milk: "dairy", cream: "dairy", cheese: "dairy",
      butter: "dairy", lactose: "dairy",
      gluten: "gluten", wheat: "gluten", bread: "gluten", flour: "gluten",
      barley: "gluten", rye: "gluten",
      egg: "eggs", eggs: "eggs",
      fish: "fish", salmon: "fish", tuna: "fish", cod: "fish",
      shellfish: "shellfish", shrimp: "shellfish", prawn: "shellfish",
      lobster: "shellfish", crab: "shellfish", oyster: "shellfish",
      soy: "soy", soya: "soy",
      pork: "pork", bacon: "pork", ham: "pork", prosciutto: "pork",
      sulphite: "sulphites", sulphites: "sulphites", sulfite: "sulphites",
      vegan: "dairy", vegetarian: "pork",
    };

    const matched = new Set<string>();
    keywords.forEach((k) => {
      if (ALIAS[k]) matched.add(ALIAS[k]);
      // also check if any allergen tag contains the keyword
      else Object.values(ALIAS).forEach((v) => { if (v.includes(k) || k.includes(v)) matched.add(v); });
    });

    const flagged = menuItems.filter((item) =>
      item.allergens.some((a) => matched.has(a)),
    ).map((item) => ({
      ...item,
      matchedAllergens: item.allergens.filter((a) => matched.has(a)),
    }));

    return { flaggedItems: flagged, allergenKeywords: Array.from(matched) };
  }, [dineIn.allergies, menuItems]);

  const cartTotal          = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const cartCount          = cart.reduce((s, i) => s + i.qty, 0);
  // Province-aware tax: if the restaurant row has an explicit tax_rate
  // override use it; otherwise look up the provincial rate. Falls back to
  // ON 13% when province is null. See lib/billing/canadianTax.ts.
  const provincialTax      = getProvincialTax(restaurant?.province);
  const taxRate            = restaurant?.tax_rate ?? provincialTax.rate;
  const taxLabel           = provincialTax.label;
  const activePromo        = activePromoId ? restaurantPromos.find((p) => p.id === activePromoId) ?? null : null;
  const { discount }       = activePromo ? computePromoDiscount(cart, activePromo) : { discount: 0 };
  const discountedSubtotal = Math.max(0, cartTotal - discount);
  const tax                = discountedSubtotal * taxRate;
  // Tip preference UI removed; tip is no longer collected at checkout. Keeping
  // the variable wired through downstream calls so existing call sites that
  // record `tip_amount: 0` don't need to change.
  const tipAmount = 0;
  // Deposit preview: highest applicable tier × party size, computed client-side
  // from restaurant.deposit_tiers so the checkout total reflects the deposit
  // BEFORE the booking row is created. The server still recomputes via
  // compute_deposit_for_party() and writes the canonical value to the
  // reservation; this is just for display.
  const previewDepositDollars = useMemo(() => {
    const tiers = Array.isArray(restaurant?.deposit_tiers) ? restaurant.deposit_tiers : [];
    if (tiers.length === 0) return 0;
    const partySize = Number(dineIn.party_size) || 1;
    const applicable = tiers
      .filter((t) => partySize >= t.min_party_size)
      .sort((a, b) => b.min_party_size - a.min_party_size)[0];
    if (!applicable) return 0;
    return (applicable.amount_per_person_cents * partySize) / 100;
  }, [restaurant?.deposit_tiers, dineIn.party_size]);
  const total              = discountedSubtotal + tax;
  // 2026-05-23: split-tender now covers ALL payable amounts (preorder + tax
  // + deposit) so each payer's share is the full per-person total. Each of
  // the N cards is charged for `totalNow / N` via SplitTenderPaymentForm.
  // Previously this excluded the deposit from totalNow in split mode, which
  // caused pre-order-only split-tender to fall through to single-card form.
  const totalNow = total + previewDepositDollars;
  // Stripe processing fee pass-through: diner pays our 2.9% + 30¢ on top so
  // the restaurant nets the full base. Display-only; server is the source of
  // truth on the actual amount charged.
  const dinerCharge = useMemo(
    () => computeDinerCharge(Math.round(totalNow * 100)),
    [totalNow],
  );
  const cenaivaFeeDollars = dinerCharge.cenaivaFeeCents / 100;
  const processingFeeDollars = dinerCharge.processingFeeCents / 100;
  const dinerGrandTotalDollars = dinerCharge.dinerTotalCents / 100;

  const splitEachShare = useMemo(() => {
    if (paymentSplitMode !== "split") return NaN;
    const n = splitPartyCount;
    if (!Number.isFinite(n) || n < 2 || n > 10) return NaN;
    return roundMoney(totalNow / n);
  }, [paymentSplitMode, splitPartyCount, totalNow]);

  const splitCheckoutValid = useMemo(() => {
    if (paymentSplitMode !== "split") return true;
    if (!Number.isFinite(splitPartyCount) || splitPartyCount < 2 || splitPartyCount > 10) return false;
    if (!Number.isFinite(splitEachShare) || splitEachShare <= 0) return false;
    // Per-slot validation is owned by SplitTenderPaymentForm; the parent
    // gate just checks the count + share are sane.
    return true;
  }, [paymentSplitMode, splitPartyCount, splitEachShare]);

  function addToCart(item: MenuItem, qty = 1) {
    setCart((prev) => {
      const ex = prev.find((c) => c.id === item.id);
      if (ex) return prev.map((c) => c.id === item.id ? { ...c, qty: c.qty + qty } : c);
      return [...prev, { ...item, qty }];
    });
  }
  function removeFromCart(id: string) {
    setCart((prev) => {
      const ex = prev.find((c) => c.id === id);
      if (!ex) return prev;
      if (ex.qty === 1) return prev.filter((c) => c.id !== id);
      return prev.map((c) => c.id === id ? { ...c, qty: c.qty - 1 } : c);
    });
  }
  function deleteFromCart(id: string) {
    setCart((prev) => prev.filter((c) => c.id !== id));
  }

  // Resolve the slot to submit. When the URL pinned a specific slot via
  // ?slot=<ISO>, prefer the exact ISO match — this prevents the previous
  // bug where a 6pm pick could submit as 1pm because find() returned the
  // first slot whose display_time matched the (auto-reset) dineIn.time.
  // Only fall back to a display_time match when the user has actively
  // changed the time field (so dineIn.time no longer matches the URL pin).
  const isoSlotMatch = requestedIsoSlot
    ? filteredAvailabilitySlots.find((slot) => slot.date_time === requestedIsoSlot)
    : undefined;
  const dineInTimeMatch = filteredAvailabilitySlots.find(
    (slot) => formatCompactTimeLabel(slot.display_time) === dineIn.time,
  );
  const selectedAvailabilitySlot = requestedIsoSlot
    ? (isoSlotMatch ?? (dineIn.time && dineIn.time !== initialBookingTime ? dineInTimeMatch : undefined))
    : dineInTimeMatch;
  const selectedPreviewSlot =
    lockedPreviewSlotAvailable && requestedIsoSlot && requestedShiftId && dineIn.time
      ? {
          shift_id: requestedShiftId,
          shift_name: "Selected",
          date_time: requestedIsoSlot,
          display_time: dineIn.time,
        }
      : null;
  const selectedBookingSlot = selectedAvailabilitySlot ?? selectedPreviewSlot;
  const maxBookablePartySize = availability.floorCapacity ?? (
    typeof dineIn.party_size === "number" ? Math.max(200, dineIn.party_size) : 200
  );

  // ── Reservation hold (Phase C of holds rollout, 2026-05-16) ────────────
  // Owns the soft-hold lifecycle while the diner is inside the 3-step
  // booking flow (details → menu → checkout). The hook gates on `enabled`
  // and on the presence of a concrete restaurant + shift + slot. Conversion
  // happens at Place Order — either through `create-public-booking` (with
  // `hold_id` passed through) for free bookings, or through
  // `confirm-hold-paid` once Stripe clears for deposit/pre-order flows.
  // Voice hand-off may attach `?hold=<id>` — the hook hydrates from
  // sessionStorage internally so we don't have to wire it explicitly here.
  const holdEnabled = step === "details" || step === "menu" || step === "checkout";
  const holdPartySize = typeof dineIn.party_size === "number" ? dineIn.party_size : 0;
  const restaurantName = restaurant?.name ?? "the restaurant";
  const hold = useReservationHold({
    restaurantId: restaurant?.id ?? null,
    shiftId: selectedBookingSlot?.shift_id ?? null,
    dateTime: selectedBookingSlot?.date_time ?? null,
    partySize: holdPartySize,
    enabled: holdEnabled,
    source: "web",
    eventId: searchParams.get("event_id") ?? null,
    promotionId: activePromoId ?? searchParams.get("promotion_id") ?? null,
    appliedPromoCode: searchParams.get("promo_code") ?? null,
    // Page-scoped timer: silent rehydrate is killed. Only an explicit
    // `?hold=<id>` (voice handoff) resumes a persisted hold; everything
    // else gets a fresh timer on every entry to the booking page.
    resumeHoldId: searchParams.get("hold"),
    // Race-window protection: once the diner reaches checkout, don't let
    // pagehide cancel the hold server-side. There's a 1-2s gap between
    // Stripe PI succeeding and `confirm-hold-paid` firing where closing
    // the tab could otherwise charge the card without finalising the
    // booking (the webhook's convert RPC rejects cancelled holds). Hold
    // expires naturally in 30 min if abandoned.
    inPaymentFlow: step === "checkout",
  });

  // Push cart changes into the hold (debounced) so the server keeps the
  // line items in sync with what the diner sees. Only fires while the hold
  // is active and the diner is past Step 1 (cart is meaningless on
  // details). 500ms debounce prevents flooding on rapid +/- clicks.
  const holdStatus = hold.state.status;
  const holdUpdateCart = hold.updateCart;
  useEffect(() => {
    if (holdStatus !== "active") return;
    if (step !== "menu" && step !== "checkout") return;
    const timer = setTimeout(() => {
      const snapshot = {
        items: cart.map((item) => ({
          menu_item_id: item.id,
          name: item.name,
          quantity: item.qty,
          unit_price: roundMoney(item.price),
        })),
        subtotal: roundMoney(discountedSubtotal),
        tax_amount: roundMoney(tax),
        tip_amount: roundMoney(tipAmount),
      };
      void holdUpdateCart(snapshot, Math.round(totalNow * 100));
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot is rebuilt from primitives
  }, [
    holdStatus,
    holdUpdateCart,
    step,
    cart,
    discountedSubtotal,
    tax,
    tipAmount,
    totalNow,
  ]);

  const canProceedDetails = () => {
    // Phase 11 (2026-05-15): phone is now required at the booking form
    // alongside name + email. We need both contact channels on file so
    // confirmation SMS goes through and email is the fallback. Validate
    // the E.164 shape inline; the server enforces the same gate.
    const phoneTrimmed = (dineIn.phone ?? "").trim();
    const phoneValid = phoneTrimmed.length > 0 && normalizeE164Phone(phoneTrimmed) !== null;
    return (
      dineIn.date &&
      dineIn.name &&
      dineIn.email &&
      phoneValid &&
      typeof dineIn.party_size === "number" &&
      dineIn.party_size >= 1 &&
      dineIn.party_size <= maxBookablePartySize &&
      !availability.loading &&
      Boolean(selectedBookingSlot)
    );
  };

  // Refund a successful Stripe charge when the reservation couldn't be
  // created (slot was taken in the race window between Stripe success and
  // create-public-booking). Returns true if the refund went through.
  async function refundPayment(paymentIntentId: string, reason: string): Promise<boolean> {
    try {
      const res = await fetch(
        `${getSupabaseProjectUrl()}/functions/v1/refund-payment-intent`,
        {
          method: "POST",
          headers: { apikey: getSupabaseAnonKey(), "Content-Type": "application/json" },
          body: JSON.stringify({ payment_intent_id: paymentIntentId, reason }),
        },
      );
      const body = await res.json().catch(() => ({}));
      return res.ok && Boolean((body as { refund_id?: string }).refund_id);
    } catch {
      return false;
    }
  }

  // Called by the Stripe form after the card has been successfully charged.
  // Creates the reservation; if create-public-booking 409s (slot just taken),
  // auto-refunds the card and surfaces a clean error.
  async function handlePaidBooking(paymentIntentId: string) {
    setPaymentProcessing(true);
    try {
      await createReservationCore({ paymentIntentId });
      setStep("confirmed");
      toast.success(
        "Payment received — your reservation will appear in My Bookings in a few seconds.",
        { duration: 6000 },
      );
    } catch (err) {
      const friendly = toUserFacingError(err, "We couldn't finish your reservation after payment.");
      console.error("[RestaurantPublicPage.handlePaidBooking]", friendly.code, friendly.technical ?? err);
      const refundOk = await refundPayment(paymentIntentId, "slot_taken");
      const fullMsg = refundOk
        ? `${friendly.message} Your card has been refunded.`
        : `${friendly.message} Please contact help@cenaiva.com to refund your card.`;
      setOrderError(fullMsg);
      toast.error(fullMsg);
    } finally {
      setPaymentProcessing(false);
    }
  }

  /**
   * Split-tender booking: creates the reservation in pending_payment status
   * + N reservation_deposit_payments rows in one server call (via
   * create-public-booking with `split_tender_payers: N`). Returns the IDs
   * so SplitTenderPaymentForm can drive N separate PI charges. The
   * reservation flips to 'confirmed' via the settle trigger once every
   * row's confirm-deposit-paid call lands.
   */
  async function createSplitTenderReservation(
    payerCount: number,
  ): Promise<{ reservation_id: string; deposit_row_ids: string[] }> {
    if (!restaurant) throw new Error("Restaurant not loaded");
    const selectedSlot = selectedBookingSlot;
    if (!selectedSlot) throw new Error("Please choose an available time.");
    const partySize = typeof dineIn.party_size === "number" ? dineIn.party_size : 1;
    const cartItems = cart.map((item) => ({
      menu_item_id: item.id,
      name: item.name,
      quantity: item.qty,
      unit_price: roundMoney(item.price),
    }));
    const contactName = dineIn.name;
    const contactEmail = dineIn.email;
    const contactPhoneRaw = (dineIn.phone ?? "").trim();
    // 2026-05-22: strict E.164 — same rationale as the other createReservation
    // path (line ~2040). Fail fast instead of letting the server reject.
    const contactPhone = normalizeE164Phone(contactPhoneRaw);
    if (!contactPhone) {
      toast.error(
        "Please enter a valid phone number with country code, e.g. +1 416 555 0123.",
      );
      setStep("details");
      throw new Error("phone_validation_failed");
    }
    const activeHoldId = hold.state.status === "active" ? hold.state.holdId : null;
    const client = getSupabaseBrowserClient();
    const { data: sessionData } = await client.auth.getSession();
    const token = sessionData.session?.access_token ?? null;
    const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/create-public-booking`, {
      method: "POST",
      headers: {
        apikey: getSupabaseAnonKey(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        restaurant_id: restaurant.id,
        shift_id: selectedSlot.shift_id,
        date_time: selectedSlot.date_time,
        party_size: partySize,
        guest_name: contactName,
        guest_email: contactEmail,
        guest_phone: contactPhone,
        allergies: dineIn.allergies || null,
        seating_preference: dineIn.seating_preference || null,
        occasion: dineIn.occasion || null,
        cart_items: cartItems,
        subtotal: roundMoney(discountedSubtotal),
        tax_amount: roundMoney(tax),
        tip_amount: roundMoney(tipAmount),
        total_amount: roundMoney(totalNow),
        discount_amount: discount > 0 ? roundMoney(discount) : null,
        discount_reason: activePromo?.title ?? null,
        promotion_id: activePromo?.id ?? searchParams.get("promotion_id") ?? null,
        payment_method: "split",
        event_id: searchParams.get("event_id") ?? null,
        applied_promo_code: searchParams.get("promo_code") ?? null,
        hold_id: activeHoldId,
        split_tender_payers: payerCount,
        // 2026-05-23: pass per-payer cents so the backend can size each
        // deposit_payment row to cover the full share (preorder + tax +
        // deposit / N), not just the deposit portion. Without this, pre-order
        // split-tender would create rows of $0 each.
        split_tender_share_cents: Math.round((totalNow * 100) / Math.max(2, payerCount)),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as PublicBookingResponse & {
      split_tender_deposit_row_ids?: string[];
    };
    if (!res.ok || body.error || !body.reservation_id) {
      throw new Error(body.error ?? "Couldn't start split-tender checkout");
    }
    const rowIds = Array.isArray(body.split_tender_deposit_row_ids)
      ? body.split_tender_deposit_row_ids
      : [];
    if (rowIds.length !== payerCount) {
      throw new Error(
        `Expected ${payerCount} deposit rows but got ${rowIds.length}. Try again or contact support.`,
      );
    }
    setConfirmationCode(body.confirmation_code ?? "");
    setConfirmationDelivery({
      status: body.confirmation_delivery ?? "skipped",
      channel: body.confirmation_delivery_channel ?? null,
    });
    return { reservation_id: body.reservation_id, deposit_row_ids: rowIds };
  }

  async function handlePlaceOrder() {
    if (placingRef.current) return;
    if (!restaurant) return;
    if (!isSupabaseConfigured()) {
      setOrderError(t("auth.errors.supabaseNotConfigured"));
      return;
    }

    const totalToChargeCents = Math.round(totalNow * 100);
    if (totalToChargeCents > 0) {
      // Paid path is driven by the inline Stripe form's submit handler. The
      // Place Order button submits that form via form="diner-pay-form", and
      // its onPaid callback (handlePaidBooking) creates the reservation
      // post-payment. We should never end up here for paid bookings.
      return;
    }

    placingRef.current = true;
    setPlacing(true);
    setOrderError(null);

    try {
      await createReservationCore({ paymentIntentId: null });
      setStep("confirmed");
    } catch (err) {
      const friendly = toUserFacingError(err, "Couldn't place your reservation. Try again.");
      console.error("[RestaurantPublicPage.handlePlaceOrder]", friendly.code, friendly.technical ?? err);
      setOrderError(friendly.message);
      toast.error(friendly.message);
    } finally {
      placingRef.current = false;
      setPlacing(false);
    }
  }

  // Shared reservation-creation routine. Called by handlePlaceOrder (free
  // path) and handlePaidBooking (after Stripe success).
  async function createReservationCore({
    paymentIntentId,
  }: {
    paymentIntentId: string | null;
  }): Promise<void> {
    if (!restaurant) throw new Error("Restaurant not loaded");
    let depositCentsLocal = 0;
    let depositReservationLocal: string | null = null;

    const client = getSupabaseBrowserClient();

    // Contact info from dine-in reservation form.
    // Phase 11 (2026-05-15): phone is required and normalized to E.164
    // before the server call, mirroring PhoneLoginPage/OnboardingPage.
    const contactName = dineIn.name;
    const contactEmail = dineIn.email;
    const contactPhoneRaw = (dineIn.phone ?? "").trim();
    // 2026-05-22: strict E.164 — the previous `?? contactPhoneRaw` fallback
    // was the chronic cause of the "Couldn't place your reservation" toast.
    // Server schema rejects non-E.164 strictly; we now fail fast with a
    // clear message and bounce the user back to the Details step.
    const contactPhone = normalizeE164Phone(contactPhoneRaw);
    if (!contactPhone) {
      toast.error(
        "Please enter a valid phone number with country code, e.g. +1 416 555 0123.",
      );
      setStep("details");
      throw new Error("phone_validation_failed");
    }
    let createdReservationId: string | null = existingReservationId ?? null;
    let createdOrderId: string | null = existingOrderId ?? null;

      // 1. Create or reuse the reservation. When we arrived via a Cenaiva
      //    order_id deep-link, both the reservation and the order already
      //    exist — creating a second one would double-book the table and
      //    also fails ("T19:00:00") because dineIn.date is only mirrored
      //    from the existing row.
      if (existingReservationId) {
        // Existing voice-created reservations are already table-assigned.
      } else {
        const selectedSlot = selectedBookingSlot;
        if (!selectedSlot) {
          throw new Error("Please choose an available time.");
        }
        const partySize = typeof dineIn.party_size === "number" ? dineIn.party_size : 1;

        // Final live re-check before submitting. Cuts out the case where the
        // user sat on the checkout step long enough that another booker took
        // the slot. The server (`book_reservation` RPC) is still authoritative
        // — this is just a friendlier UX than waiting for the 409.
        //
        // IMPORTANT: use the restaurant-local date the user picked
        // (`dineIn.date`, already YYYY-MM-DD). `selectedSlot.date_time` is a
        // UTC ISO string, so slicing the first 10 chars of an evening EDT slot
        // returns the *next* UTC day and we'd fetch the wrong window's
        // availability — producing a false "no longer available" rejection.
        // Slot revalidation always uses the restaurant-local date the user
        // picked (`dineIn.date`, YYYY-MM-DD). The previous fallback on
        // `selectedSlot.booking_date` was dead code — `dineIn.date` is
        // populated by both the AvailabilityPanel and the preview-locked
        // path, so the fallback never fires.
        const slotDate =
          dineIn?.date && /^\d{4}-\d{2}-\d{2}$/.test(dineIn.date) ? dineIn.date : null;
        if (slotDate) {
          const refreshed = await fetchAvailabilitySlots(
            restaurant.id,
            slotDate,
            partySize,
            { forceRefresh: true },
          ).catch(() => null);
          const stillAvailable = refreshed?.slots.some(
            (candidate) =>
              candidate.date_time === selectedSlot.date_time
              && (!selectedSlot.shift_id || candidate.shift_id === selectedSlot.shift_id),
          );
          if (refreshed && !stillAvailable) {
            throw new Error(
              refreshed.message
              ?? "That time was just taken. Please pick another time and try again.",
            );
          }
        }

        const cartItems = cart.map((item) => ({
          menu_item_id: item.id,
          name: item.name,
          quantity: item.qty,
          unit_price: roundMoney(item.price),
        }));
        const { data: sessionData } = await client.auth.getSession();
        const token = sessionData.session?.access_token ?? null;

        // Hold conversion (Phase C, 2026-05-16): when a hold is active and
        // we just cleared Stripe, prefer `confirm-hold-paid` — it converts
        // the reservation_holds row into a real reservation atomically and
        // settles the deposit row in one server hop. Free bookings (and
        // paid bookings without an active hold, e.g. legacy paths) keep
        // calling `create-public-booking` with `hold_id` so the server can
        // still fork on hold presence behind the CENAIVA_HOLDS_ENABLED env
        // flag.
        const activeHoldId = hold.state.status === "active" ? hold.state.holdId : null;
        const useConfirmHoldPaid = Boolean(paymentIntentId && activeHoldId);
        const res = useConfirmHoldPaid
          ? await fetch(`${getSupabaseProjectUrl()}/functions/v1/confirm-hold-paid`, {
              method: "POST",
              headers: {
                apikey: getSupabaseAnonKey(),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                hold_id: activeHoldId,
                payment_intent_id: paymentIntentId,
              }),
            })
          : await fetch(`${getSupabaseProjectUrl()}/functions/v1/create-public-booking`, {
              method: "POST",
              headers: {
                apikey: getSupabaseAnonKey(),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                restaurant_id: restaurant.id,
                shift_id: selectedSlot.shift_id,
                date_time: selectedSlot.date_time,
                party_size: partySize,
                guest_name: contactName,
                guest_email: contactEmail,
                guest_phone: contactPhone,
                allergies: dineIn.allergies || null,
                seating_preference: dineIn.seating_preference || null,
                occasion: dineIn.occasion || null,
                cart_items: cartItems,
                subtotal: roundMoney(discountedSubtotal),
                tax_amount: roundMoney(tax),
                tip_amount: roundMoney(tipAmount),
                total_amount: roundMoney(totalNow),
                discount_amount: discount > 0 ? roundMoney(discount) : null,
                discount_reason: activePromo?.title ?? null,
                promotion_id: activePromo?.id ?? searchParams.get("promotion_id") ?? null,
                payment_method: paymentSplitMode === "split" ? "split" : "card",
                // When the diner came in via /deals → event/promotion card, the
                // URL pre-fills `event_id` so the new reservation is tagged
                // with the right event for owner-dashboard attendee lists.
                event_id: searchParams.get("event_id") ?? null,
                applied_promo_code: searchParams.get("promo_code") ?? null,
                // Server forks on hold presence behind the
                // CENAIVA_HOLDS_ENABLED env flag — passing null is safe.
                hold_id: activeHoldId,
              }),
            });
        const body = await res.json().catch(() => ({})) as PublicBookingResponse;
        if (!res.ok || body.error || !body.reservation_id) {
          // Log the full server response (including any Zod `issues` array)
          // so the developer can see which field was rejected. The user-
          // facing toast still shows only the friendly fallback.
          console.error(
            "[createReservationCore] booking rejected",
            { status: res.status, body },
          );
          // Surface a friendlier prompt for the diner double-book case so the
          // user knows the action they need to take next.
          if (body.unavailable_reason === "diner_double_book") {
            throw new Error(
              body.error
              ?? "You already have a reservation at this time. Cancel or modify it from “My bookings” first.",
            );
          }
          // Slot/cap collisions: drop our local availability cache so the
          // user sees fresh slots when they back up.
          if (body.unavailable_reason === "slot_taken" || body.unavailable_reason === "over_cover_cap") {
            if (restaurant?.id) invalidateAvailabilityCache(restaurant.id);
          }
          // Attach the validation issues to the Error so the outer catch
          // can include them in its console log (otherwise they get
          // dropped on the floor by `new Error(string)`).
          const bookingErr = new Error(body.error ?? "Reservation failed");
          interface BookingErrorContext { responseStatus?: number; responseBody?: unknown }
          (bookingErr as unknown as BookingErrorContext).responseStatus = res.status;
          (bookingErr as unknown as BookingErrorContext).responseBody = body;
          throw bookingErr;
        }
        setConfirmationCode(body.confirmation_code ?? "");
        setConfirmationDelivery({
          status: body.confirmation_delivery ?? "skipped",
          channel: body.confirmation_delivery_channel ?? null,
        });
        if (body.deposit_required && (body.deposit_amount_cents ?? 0) > 0) {
          depositCentsLocal = body.deposit_amount_cents ?? 0;
          depositReservationLocal = body.reservation_id ?? null;
        }
        createdReservationId = body.reservation_id ?? createdReservationId;
        createdOrderId = body.order_id ?? createdOrderId;

        // Hold has been converted server-side (either via the
        // hold-aware fork of create-public-booking or via
        // confirm-hold-paid). Tell the hook to stop the countdown so
        // the banner disappears and grabAgain is disarmed.
        if (activeHoldId && createdReservationId) {
          hold.confirmConverted(createdReservationId, body.confirmation_code ?? "");
        }
      }

      // 2. Update an existing Cenaiva preorder, if this page was opened from a
      //    voice checkout deep-link. New manual bookings are created by the
      //    Edge Function above so table assignment cannot be bypassed.
      if (existingOrderId) {
        // Cenaiva already created the order with line items. Update tip /
        // payment / discount on the existing row and mark it pending.
        const { error: orderUpdErr } = await client
          .from("orders")
          .update({
            subtotal: roundMoney(discountedSubtotal),
            tax_amount: roundMoney(tax),
            tip_amount: roundMoney(tipAmount),
            total_amount: roundMoney(totalNow),
            discount_amount: discount > 0 ? roundMoney(discount) : null,
            discount_reason: activePromo?.title ?? null,
            promotion_id: activePromo?.id ?? null,
            payment_method: paymentSplitMode === "split" ? "split" : "card",
            status: "pending",
          })
          .eq("id", existingOrderId);
        if (orderUpdErr) throw new Error(`Order: ${orderUpdErr.message}`);
      } else if (
        existingReservationId &&
        cart.length > 0 &&
        !createdOrderId
      ) {
        // R11 (2026-05-18): voice handoff path — Cenaiva created the
        // reservation but NOT an order. User picked items on this page;
        // create the order + order_items here so the pre-order persists
        // and mark-order-paid (post-payment, below) can flip it to 'paid'.
        // Without this, the user would pay via Stripe but their food
        // selections would never be saved → reservation exists with no
        // attached pre-order. That's the "dead button" symptom: the
        // payment goes through but the order data vanishes.
        if (!restaurant?.id) throw new Error("Restaurant not loaded for pre-order");
        if (!profile?.id) throw new Error("Sign in required to attach a pre-order");
        const { data: guestRow, error: guestErr } = await client
          .from("guests")
          .select("id")
          .eq("user_profile_id", profile.id)
          .eq("restaurant_id", restaurant.id)
          .maybeSingle();
        if (guestErr || !guestRow?.id) {
          throw new Error(
            guestErr?.message
              ?? "Couldn't find your guest record for this restaurant — the reservation may still be settling.",
          );
        }
        const orderCode = `SEAT-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const { data: newOrder, error: newOrderErr } = await client
          .from("orders")
          .insert({
            restaurant_id: restaurant.id,
            guest_id: guestRow.id,
            reservation_id: existingReservationId,
            is_preorder: true,
            order_type: "dine_in",
            status: "pending",
            subtotal: roundMoney(discountedSubtotal),
            tax_amount: roundMoney(tax),
            tip_amount: roundMoney(tipAmount),
            total_amount: roundMoney(totalNow),
            discount_amount: discount > 0 ? roundMoney(discount) : null,
            discount_reason: activePromo?.title ?? null,
            promotion_id: activePromo?.id ?? null,
            payment_method: paymentSplitMode === "split" ? "split" : "card",
            confirmation_code: orderCode,
            source: "cenaiva",
          })
          .select("id")
          .single();
        if (newOrderErr || !newOrder) {
          throw new Error(newOrderErr?.message ?? "Couldn't create your pre-order");
        }
        const newOrderItems = cart.map((item) => ({
          order_id: newOrder.id,
          menu_item_id: item.id,
          name: item.name,
          quantity: item.qty,
          unit_price: roundMoney(item.price),
          line_total: roundMoney(item.price * item.qty),
          status: "pending",
        }));
        const { error: newItemsErr } = await client
          .from("order_items")
          .insert(newOrderItems);
        if (newItemsErr) {
          // Roll back the headless order so we don't leave a $0 orphan.
          await client.from("orders").delete().eq("id", newOrder.id);
          throw new Error(newItemsErr.message);
        }
        createdOrderId = newOrder.id;
      }

      // 3. Save phone to user profile if it changed (so it's remembered next time)
      if (profile && contactPhone && contactPhone !== (profile.phone ?? "")) {
        await client
          .from("user_profiles")
          .update({ phone: contactPhone })
          .eq("id", profile.id);
      }

      // Drop cached availability so this device sees the new state on the
      // next view without waiting for the realtime channel to fire.
      if (restaurant?.id) invalidateAvailabilityCache(restaurant.id);

    // If a deposit is required AND we just paid for it, record the deposit
    // payment row marked 'charged' so the existing settle trigger flips the
    // reservation to 'confirmed'. For free bookings (paymentIntentId === null)
    // there's no deposit by definition (totalNow === 0).
    if (paymentIntentId && depositReservationLocal && depositCentsLocal > 0) {
      try {
        // Single-pay deposit: one payer (the diner), one row, one PI.
        // Split-tender deposits are NOT handled here — they're created
        // at booking time by create-public-booking
        // (split_tender_payers field) and charged per-slot by
        // SplitTenderPaymentForm, which calls confirm-deposit-paid
        // itself for each row.
        const prepRes = await fetch(
          `${getSupabaseProjectUrl()}/functions/v1/prepare-deposit`,
          {
            method: "POST",
            headers: { apikey: getSupabaseAnonKey(), "Content-Type": "application/json" },
            body: JSON.stringify({
              reservation_id: depositReservationLocal,
              payers: [
                {
                  email: dineIn.email ?? "",
                  full_name: dineIn.name ?? "",
                  amount_cents: depositCentsLocal,
                },
              ],
              // Stamp metadata.deposit_payment_ids on the PI server-side
              // (Vuln 2 hardening) so confirm-deposit-paid's strict
              // metadata check passes below.
              payment_intent_id: paymentIntentId,
            }),
          },
        );
        const prepBody = (await prepRes.json().catch(() => ({}))) as {
          payments?: Array<{ id: string }>;
          error?: string;
        };
        if (!prepRes.ok || !prepBody.payments?.[0]?.id) {
          throw new Error(prepBody.error ?? "Couldn't prepare deposit");
        }
        const confirmRes = await fetch(
          `${getSupabaseProjectUrl()}/functions/v1/confirm-deposit-paid`,
          {
            method: "POST",
            headers: { apikey: getSupabaseAnonKey(), "Content-Type": "application/json" },
            body: JSON.stringify({
              payment_id: prepBody.payments[0].id,
              payment_intent_id: paymentIntentId,
            }),
          },
        );
        if (!confirmRes.ok) {
          const confirmBody = (await confirmRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(confirmBody.error ?? `confirm-deposit-paid ${confirmRes.status}`);
        }
      } catch (err) {
        // Don't fail the whole flow — the user paid and got a reservation.
        // Log for ops follow-up; webhook + reconciliation can catch this.
        console.error("[checkout] post-payment deposit recording failed", err);
      }
    }

    // Mark the order row as paid for pre-order checkouts (food + tax). The
    // booking edge function creates it with status='pending'; mark-order-paid
    // (service-role) flips it to 'paid' now that Stripe cleared. orders RLS
    // only allows staff to UPDATE rows, so this must go through the edge fn.
    if (paymentIntentId && createdOrderId) {
      try {
        const markRes = await fetch(
          `${getSupabaseProjectUrl()}/functions/v1/mark-order-paid`,
          {
            method: "POST",
            headers: { apikey: getSupabaseAnonKey(), "Content-Type": "application/json" },
            body: JSON.stringify({
              order_id: createdOrderId,
              payment_intent_id: paymentIntentId,
            }),
          },
        );
        if (!markRes.ok) {
          const markBody = (await markRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(markBody.error ?? `mark-order-paid ${markRes.status}`);
        }
      } catch (err) {
        console.error("[checkout] post-payment order paid-update failed", err);
      }
    }

    // Phase 3 of diner auth overhaul (2026-05-15): write the diner's
    // contact details back to user_profiles after a successful booking
    // so future bookings pre-fill from the profile and the diner never
    // has to retype this info. Skip if not logged in (guest checkout).
    // Best-effort — never block the booking success on this.
    if (user && profile) {
      try {
        const trimmedName = (dineIn.name ?? "").trim();
        const trimmedEmail = (dineIn.email ?? "").trim().toLowerCase();
        const trimmedPhone = (dineIn.phone ?? "").trim();
        const trimmedAllergies = (dineIn.allergies ?? "").trim();
        const trimmedSeating = (dineIn.seating_preference ?? "").trim();

        const updates: Record<string, string | string[]> = {};
        if (trimmedName && trimmedName !== (profile.full_name ?? "")) {
          updates.full_name = trimmedName;
        }
        if (trimmedEmail && trimmedEmail !== (profile.email ?? "").toLowerCase()) {
          updates.email = trimmedEmail;
        }
        if (trimmedPhone && trimmedPhone !== (profile.phone ?? "")) {
          updates.phone = trimmedPhone;
        }
        if (
          trimmedAllergies &&
          trimmedAllergies !== ((profile.allergies ?? []).join(", "))
        ) {
          updates.allergies = trimmedAllergies
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
        if (trimmedSeating && trimmedSeating !== (profile.seating_preference ?? "")) {
          updates.seating_preference = trimmedSeating;
        }

        if (Object.keys(updates).length > 0) {
          void client
            .from("user_profiles")
            .update(updates)
            .eq("auth_user_id", user.id)
            .then(({ error: pErr }) => {
              if (pErr) {
                console.warn("[checkout] profile write-back failed", pErr.message);
              }
            });
        }
      } catch (err) {
        console.warn("[checkout] profile write-back errored", err);
      }
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-base">
        <Skeleton className="h-44 w-full" />
        <div className="mx-auto max-w-2xl space-y-4 p-6">
          <Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-32" /><Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  if (!restaurant) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg-base text-text-primary">
        <p className="text-lg font-semibold">Restaurant not found</p>
        <Button variant="outline" asChild><Link to="/discover">Back to Discover</Link></Button>
      </div>
    );
  }

  if (restaurant.is_published === false && !viewerIsStaffOfRestaurant) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg-base text-text-primary">
        <p className="text-lg font-semibold">This restaurant isn't accepting bookings yet.</p>
        <Button variant="outline" asChild><Link to="/discover">Back to Discover</Link></Button>
      </div>
    );
  }

  const publicPriceLevel = normalizeRestaurantPriceLevel(restaurant.price_range);
  const publicDietaryTags = normalizeRestaurantDietaryTags(restaurant.settings_json?.dietaryTags);

  if (isStaffPreview) {
    return (
      <RestaurantStaffPreview
        restaurant={restaurant}
        menuItems={menuItems}
        hasSavedMenu={dbMenuItems.length > 0}
        onBack={() => navigate("/dashboard")}
        onStartBooking={(slot, partySize, shiftId, displayTime, bookingDate) => {
          const slotDate = bookingDate ?? (/^\d{4}-\d{2}-\d{2}T/.test(slot) ? slot.slice(0, 10) : todayDateValue());
          const slotTime = displayTime ? formatCompactTimeLabel(displayTime) : formatCompactTimeLabel(slot);
          setDineIn((details) => ({ ...details, date: slotDate, time: slotTime, party_size: partySize }));
          setStep("details");
          const shiftQuery = shiftId ? `&shift_id=${encodeURIComponent(shiftId)}` : "";
          navigate(`/${restaurant.slug || restaurant.id}?back=dashboard&slot=${encodeURIComponent(slot)}&time=${encodeURIComponent(slotTime)}&people=${partySize}&date=${slotDate}${shiftQuery}`);
        }}
      />
    );
  }

  // Manage-existing-booking mode: deep link from confirmation SMS/email
  // (`/<slug>?confirmation=<code>&email=<email>`). Render the manage view
  // instead of the booking flow. Email is forwarded through from
  // /find-reservation so the guest cancel path can re-prove identity
  // server-side (closes the code-only enumeration attack).
  const manageCode = searchParams.get("confirmation")?.trim() || null;
  const manageEmail = searchParams.get("email")?.trim() || null;
  if (manageCode && restaurantSlug) {
    return (
      <div className="min-h-screen bg-bg-base text-text-primary">
        <ManageBookingView
          slug={restaurantSlug}
          code={manageCode}
          email={manageEmail}
          backHref={`/${restaurantSlug}`}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      {/* ── Sticky back button (hidden in R11 voice add-on mode) ───────────── */}
      {!existingReservationId && (
        <Button
          variant="ghost"
          size="sm"
          className="fixed left-4 top-4 z-50 gap-1.5 border border-border bg-bg-elevated/85 shadow-xl shadow-black/40 backdrop-blur hover:bg-bg-elevated"
          asChild
        >
          <Link to={backTarget}><ArrowLeft className="size-4" />Back</Link>
        </Button>
      )}

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <div className={`relative h-12 w-full bg-gradient-to-b ${gradient}`}>
        <div className="absolute inset-0 bg-gradient-to-t from-bg-base via-bg-base/20 to-transparent" />
      </div>

      {/* ── Restaurant info ───────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-6xl px-4 pt-2 sm:px-6 lg:px-10">
        <div className="flex items-end justify-between gap-4 pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{restaurant.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              {restaurant.cuisine_type && <span className="text-text-secondary">{capitalizeWords(restaurant.cuisine_type)}</span>}
              <RestaurantPriceMeter level={publicPriceLevel} />
              {publicDietaryTags.map((tag) => (
                <DietaryTagPill key={tag} tag={tag} compact />
              ))}
              {restaurant.avg_rating != null && (restaurant.total_reviews ?? 0) > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-gold/10 px-2 py-0.5">
                  <Star className="size-3 fill-gold text-gold" />
                  <span className="font-bold text-gold">{restaurant.avg_rating.toFixed(1)}</span>
                  <span className="text-text-muted">({restaurant.total_reviews})</span>
                </span>
              )}
              {restaurant.address && (
                <span className="flex items-center gap-1 text-text-muted"><MapPin className="size-3" />{restaurant.city}</span>
              )}
              {restaurant.phone && (
                <a href={`tel:${restaurant.phone}`} className="flex items-center gap-1 text-text-muted hover:text-gold transition-colors">
                  <Phone className="size-3" />{restaurant.phone}
                </a>
              )}
              <RestaurantSocialLinks
                settingsJson={restaurant.settings_json}
                websiteFallback={restaurant.website}
                className="gap-1"
                linkClassName="size-7 border-transparent bg-transparent"
                iconClassName="size-3.5"
              />
            </div>
          </div>
        </div>

        {/* ── Step bar (hidden in R11 voice add-on mode — booking is locked) ─ */}
        {!existingReservationId && (
          <div className="mb-6">
            <StepBar current={step} onNavigate={setStep} />
          </div>
        )}

        {/* ── Hold timer banner (suppressed in add-on mode — no hold to expire) ─ */}
        {!existingReservationId && hold.state.status === "active" && (
          <HoldTimerBanner
            mode="active"
            secondsLeft={hold.state.secondsLeft}
            visualState={hold.visualState}
            className="-mx-4 sm:-mx-6 mb-4"
          />
        )}
        {!existingReservationId && hold.state.status === "creating" && (
          <HoldTimerBanner
            mode="creating"
            className="-mx-4 sm:-mx-6 mb-4"
          />
        )}
        {!existingReservationId && hold.state.status === "error" && (
          <HoldTimerBanner
            mode="error"
            message={hold.state.message}
            className="-mx-4 sm:-mx-6 mb-4"
          />
        )}

        {/* ── R11 add-on mode banner — replaces the stepper/timer ────────────── */}
        {existingReservationId && step === "menu" && (
          <div className="mb-6 rounded-2xl border border-border bg-bg-elevated/60 p-4">
            <p className="text-sm font-medium text-text-primary">
              Your table is confirmed. Pre-ordering food is optional — add what you like.
            </p>
          </div>
        )}

        {/* ── Step content ─────────────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">

          {/* ═══════════════════════════════════ STEP 1: DETAILS ═══════════════ */}
          {step === "details" && (
            <motion.div
              key="details"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.25 }}
              className="pointer-events-auto"
            >
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Book your table</h2>
              </div>

              <div className="rounded-2xl border border-border bg-bg-surface p-5 sm:p-6">
                {previewSlotNoLongerAvailable ? (
                  <p className="mb-4 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
                    That preview time is no longer available. Pick another time.
                  </p>
                ) : null}
                <div className="space-y-4">
                    {bookingLockedFromPreview ? (
                      // Came from the preview modal with a slot already chosen.
                      // Show a read-only summary instead of the full panel so
                      // the user can't change the slot from under themselves.
                      <div className="grid grid-cols-3 gap-3 rounded-xl border border-border bg-bg-elevated p-3 text-sm text-text-secondary">
                        <div>
                          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Date</p>
                          <p className="mt-1 text-white">
                            {dineIn.date
                              ? new Date(`${dineIn.date}T12:00:00`).toLocaleDateString(undefined, {
                                  weekday: "short",
                                  month: "short",
                                  day: "numeric",
                                })
                              : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Time</p>
                          <p className="mt-1 text-white">
                            {dineIn.time ? formatCompactTimeLabel(dineIn.time) : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Party</p>
                          <p className="mt-1 text-white">
                            {typeof dineIn.party_size === "number"
                              ? `${dineIn.party_size} guest${dineIn.party_size === 1 ? "" : "s"}`
                              : "—"}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <>
                        {previewDepositDollars > 0 && (
                          <div className="rounded-md border border-gold/40 bg-gold/5 px-3 py-2 text-sm text-gold mb-3">
                            Party of {Number(dineIn.party_size) || 0}: a {formatCurrency(previewDepositDollars, currency)} deposit ({formatCurrency(previewDepositDollars / (Number(dineIn.party_size) || 1), currency)}/guest) is collected at checkout to hold this booking.
                          </div>
                        )}
                      <AvailabilityPanel
                        restaurantId={restaurant.id}
                        restaurantTimezone={restaurant.timezone || "America/Toronto"}
                        userProfileId={profile?.id ?? null}
                        initialDate={dineIn.date || undefined}
                        initialTime={initialBookingTime || dineIn.time || undefined}
                        initialPartySize={typeof dineIn.party_size === "number" ? dineIn.party_size : undefined}
                        selectedSlotIso={pickedAvailabilitySlot?.date_time ?? null}
                        onStateChange={({ date: nextDate, partySize: nextParty }) => {
                          setDineIn((prev) => {
                            const dateChanged = nextDate !== prev.date;
                            const partyChanged = nextParty !== prev.party_size;
                            if (!dateChanged && !partyChanged) return prev;
                            // Clear the picked slot when the inputs change so
                            // the user re-selects from the new pill grid. The
                            // panel emits a new onSelectSlot when they pick.
                            if (dateChanged || partyChanged) setPickedAvailabilitySlot(null);
                            return {
                              ...prev,
                              date: nextDate || prev.date,
                              party_size: nextParty,
                            };
                          });
                        }}
                        onSelectSlot={(slot) => {
                          setPickedAvailabilitySlot(slot);
                          setDineIn((prev) => ({
                            ...prev,
                            date: slot.booking_date ?? prev.date,
                            time: formatCompactTimeLabel(slot.display_time),
                          }));
                        }}
                      />
                      </>
                    )}

                    <div className="h-px bg-border" />

                    {/* Contact */}
                    <div>
                      <Label htmlFor="di-name" className="mb-1.5 block text-xs text-text-muted">Full Name <span className="text-danger">*</span></Label>
                      <Input id="di-name" required maxLength={120} value={dineIn.name} onChange={(e) => setDineIn((d) => ({ ...d, name: e.target.value.slice(0, 120) }))} placeholder="Jane Smith" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="di-email" className="mb-1.5 block text-xs text-text-muted">Email <span className="text-danger">*</span></Label>
                        <Input id="di-email" type="email" required maxLength={254} value={dineIn.email} onChange={(e) => setDineIn((d) => ({ ...d, email: e.target.value.slice(0, 254) }))} placeholder="jane@example.com" />
                      </div>
                      <div>
                        <Label htmlFor="di-phone" className="mb-1.5 block text-xs text-text-muted">Phone <span className="text-danger">*</span></Label>
                        <PhoneInput
                          id="di-phone"
                          required
                          value={dineIn.phone}
                          onChange={(formatted) => setDineIn((d) => ({ ...d, phone: formatted }))}
                          error={dineIn.phone.trim().length > 0 && normalizeE164Phone(dineIn.phone) === null}
                        />
                        {dineIn.phone.trim().length > 0 && normalizeE164Phone(dineIn.phone) === null ? (
                          <p className="mt-1 text-[11px] text-danger" role="alert">
                            That phone number doesn't look right. Try +1 416 555 1234.
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="h-px bg-border" />

                    {/* Seating preference */}
                    <div>
                      <Label className="mb-1.5 block text-xs text-text-muted">Table preference (optional)</Label>
                      <div className="relative">
                        <select
                          value={dineIn.seating_preference}
                          onChange={(e) =>
                            setDineIn((d) => ({ ...d, seating_preference: e.target.value }))
                          }
                          className="h-10 w-full appearance-none rounded-lg border border-border bg-bg-elevated px-3 pr-8 text-sm text-text-primary outline-none focus:border-gold/40"
                        >
                          {SEATING_PREFERENCES.map((pref) => (
                            <option key={pref || "none"} value={pref}>
                              {pref || "No preference"}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                      </div>
                    </div>

                    {/* Occasion */}
                    <div>
                      <Label className="mb-1.5 block text-xs text-text-muted">Occasion (optional)</Label>
                      <div className="relative">
                        <select
                          value={dineIn.occasion}
                          onChange={(e) => setDineIn((d) => ({ ...d, occasion: e.target.value }))}
                          className="h-10 w-full appearance-none rounded-lg border border-border bg-bg-elevated px-3 pr-8 text-sm text-text-primary outline-none focus:border-gold/40"
                        >
                          {OCCASIONS.map((o) => <option key={o} value={o}>{o || "Select occasion…"}</option>)}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                      </div>
                    </div>

                    {/* Dietary restrictions */}
                    <div>
                      <Label htmlFor="di-allergies" className="mb-1.5 block text-xs text-text-muted">Dietary restrictions & allergies</Label>
                      <Input id="di-allergies" maxLength={500} value={dineIn.allergies} onChange={(e) => setDineIn((d) => ({ ...d, allergies: e.target.value.slice(0, 500) }))} placeholder="e.g. Nut allergy (2 guests), 1 vegan, gluten-free" />
                      <p className="mt-1.5 text-[11px] text-text-muted">Please list restrictions for every guest in your party.</p>
                    </div>
                </div>
              </div>

              <Button
                className="mt-5 h-12 w-full text-base font-semibold"
                disabled={!canProceedDetails()}
                onClick={() => {
                  // Mirror the diner's Step-1 inputs into the hold so the
                  // server-side hold row matches what the diner sees on
                  // Step 2/3. If the hold path returns a diner_double_book,
                  // we surface a friendly error and stay on Step 1 instead
                  // of advancing.
                  if (hold.state.status === "active") {
                    void (async () => {
                      // 2026-05-22: normalize phone to E.164 before sending
                      // to the hold. Server validation is strict; sending
                      // an un-normalized phone would 400 with a generic
                      // toast. canProceedDetails() should already block
                      // this path, but this is a belt-and-suspenders guard
                      // for paste-after-validate cases.
                      const normalizedPhone = normalizeE164Phone((dineIn.phone ?? "").trim());
                      if (!normalizedPhone) {
                        toast.error(
                          "Please enter a valid phone number with country code, e.g. +1 416 555 0123.",
                        );
                        return;
                      }
                      const result = await hold.updateDiner({
                        name: dineIn.name,
                        email: dineIn.email,
                        phone: normalizedPhone,
                        specialRequest: dineIn.allergies || null,
                        dietaryNotes: dineIn.allergies || null,
                        occasion: dineIn.occasion || null,
                        seatingPreference: dineIn.seating_preference || null,
                      });
                      if (!result.ok) {
                        if (result.reason === "diner_double_book") {
                          toast.error(
                            "You already have a reservation at this time. Cancel or modify it from My bookings first.",
                          );
                          return;
                        }
                        toast.error("Couldn't save your details. Please try again.");
                        return;
                      }
                      setStep("menu");
                    })();
                  } else {
                    setStep("menu");
                  }
                }}
              >
                Continue — add preorder (optional)
                <ChevronRight className="size-4 ml-1" />
              </Button>
            </motion.div>
          )}

          {/* ═══════════════════════════════════ STEP 2: MENU ══════════════════ */}
          {step === "menu" && (
            <motion.div key="menu" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }}>
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">
                  {existingReservationId ? "Add to your booking (optional)" : "Preorder (optional)"}
                </h2>
                {/* R12 (2026-05-18): in R11 add-on mode, the user has no "back to booking" because the booking is already confirmed — show "View booking" link to /bookings instead */}
                {existingReservationId ? (
                  <Link to="/bookings" className="text-xs text-text-muted hover:text-gold transition-colors">View booking →</Link>
                ) : (
                  <button type="button" onClick={() => setStep("details")} className="text-xs text-text-muted hover:text-gold transition-colors">← Back to booking</button>
                )}
              </div>

              {/* ── Allergen warning section ── */}
              {flaggedItems.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-5 rounded-2xl border border-danger/30 bg-danger/5 p-4"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-danger/15">
                      <AlertTriangle className="size-4 text-danger" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-danger">Avoid these items</p>
                      <p className="text-xs text-text-muted">
                        Based on your restrictions:{" "}
                        <span className="font-medium text-text-secondary">
                          {allergenKeywords.join(", ")}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {flaggedItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start gap-3 rounded-xl border border-danger/20 bg-danger/5 p-3"
                      >
                        {item.photoUrl ? (
                          <img src={item.photoUrl} alt="" className="mt-0.5 size-10 shrink-0 rounded-lg object-cover" />
                        ) : (
                          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-bg-elevated text-gold">
                            <Utensils className="size-4" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-text-primary">{item.name}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{item.ingredients}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {item.matchedAllergens.map((a) => (
                              <span key={a} className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-danger">
                                {a}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Active promotions strip */}
              {restaurantPromos.length > 0 && (
                <div className="mb-4 flex flex-col gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-400">Active Deals</p>
                  <div className="flex flex-wrap gap-2">
                    {restaurantPromos.map((promo) => {
                      const label = getPromotionLabel(promo);
                      const badgeClasses = getPromoTypeBadgeClasses(promo.badge_color);
                      const isSelected = activePromoId === promo.id;
                      const canFilter =
                        (promo.promo_type === "bogo" && promo.bogo_item_ids.length > 0) ||
                        (promo.promo_type === "free_item" && !!promo.free_item_id);
                      return (
                        <button
                          key={promo.id}
                          type="button"
                          onClick={() => setActivePromoId(isSelected ? null : promo.id)}
                          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-all ${badgeClasses} ${
                            isSelected
                              ? "ring-2 ring-current ring-offset-1 ring-offset-bg-base opacity-100"
                              : "opacity-80 hover:opacity-100"
                          }`}
                        >
                          <span className="font-bold tracking-wide">{label}</span>
                          <span className="font-medium opacity-90">{promo.title}</span>
                          {promo.free_item_name && (
                            <span className="opacity-75">· Free: {promo.free_item_name}</span>
                          )}
                          {canFilter && (
                            <span className="ml-1 rounded-full bg-current/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
                              {isSelected ? "Clear" : "Filter"}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {activePromoId && (
                    <p className="text-[11px] text-text-muted">
                      {eligiblePromoItemIds.size > 0 ? "Showing items included in this deal." : "This deal applies to your entire cart."}{" "}
                      <button
                        type="button"
                        onClick={() => setActivePromoId(null)}
                        className="text-gold underline hover:no-underline"
                      >
                        Show all
                      </button>
                    </p>
                  )}
                </div>
              )}

              {/* Category chips */}
              {categoryList.length > 1 ? (
                <div className="mb-4 flex flex-wrap gap-2">
                {categoryList.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    className={`rounded-full border px-4 py-1.5 text-xs font-medium transition-all ${
                      activeCategory === cat
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-border bg-bg-surface text-text-secondary hover:border-gold/40 hover:text-gold"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
                </div>
              ) : null}

              {/* Items */}
              <div className="flex flex-col gap-2.5">
                {menuLoading ? (
                  <>
                    <Skeleton className="h-24 rounded-xl" />
                    <Skeleton className="h-24 rounded-xl" />
                    <Skeleton className="h-24 rounded-xl" />
                  </>
                ) : (
                <AnimatePresence mode="popLayout">
                  {filteredMenu.map((item, i) => {
                    const inCart = cart.find((c) => c.id === item.id);
                    return (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2, delay: i * 0.03 }}
                        className="flex items-center gap-3 rounded-xl border border-border bg-bg-surface p-4 transition-colors hover:border-gold/20"
                      >
                        {item.photoUrl ? (
                          <img src={item.photoUrl} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
                        ) : (
                          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-bg-elevated text-gold">
                            <Utensils className="size-4" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-semibold text-text-primary">{item.name}</span>
                            {item.popular && (
                              <span className="flex items-center gap-0.5 rounded-full bg-gold/10 px-1.5 py-0.5 text-[10px] font-bold text-gold">
                                <Flame className="size-2.5" />Popular
                              </span>
                            )}
                            {item.dietary.map((d) => (
                              <span key={d} className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-text-muted">{d}</span>
                            ))}
                          </div>
                          <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">{item.description}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <span className="text-sm font-bold text-text-primary">{formatCurrency(item.price, currency)}</span>
                          {activePromo && eligiblePromoItemIds.has(item.id) && (
                            <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${getPromoTypeBadgeClasses(activePromo.badge_color)}`}>
                              {getPromotionLabel(activePromo)}
                            </span>
                          )}
                          {inCart ? (
                            <div className="flex items-center gap-1">
                              <button type="button" onClick={() => removeFromCart(item.id)} className="flex size-7 items-center justify-center rounded-lg border border-border text-text-secondary hover:border-gold/40 hover:text-gold transition-colors">
                                <Minus className="size-3" />
                              </button>
                              <span className="w-5 text-center text-sm font-bold text-gold">{inCart.qty}</span>
                              <button type="button" onClick={() => addToCart(item)} className="flex size-7 items-center justify-center rounded-lg bg-gold text-bg-base hover:bg-gold-dark transition-colors">
                                <Plus className="size-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                const isBogo = activePromo?.promo_type === "bogo" && eligiblePromoItemIds.has(item.id);
                                addToCart(item, isBogo ? (activePromo!.buy_quantity + activePromo!.get_quantity) : 1);
                              }}
                              className="flex size-7 items-center justify-center rounded-lg border border-gold/40 bg-gold/10 text-gold hover:bg-gold/20 transition-colors"
                            >
                              <Plus className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                  {filteredMenu.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-bg-surface p-5 text-sm text-text-muted">
                      No public menu items have been added yet.
                    </div>
                  ) : null}
                </AnimatePresence>
                )}
              </div>

              {/* Continue button — skips straight to confirmation when cart is empty */}
              <div className="sticky bottom-4 mt-5">
                <Button
                  className="h-12 w-full text-base font-semibold shadow-xl"
                  disabled={placing}
                  onClick={() => {
                    if (placing) return;
                    // Deposit-required parties always go through checkout so
                    // the deposit can be collected via the same single/split
                    // tender UI as the preorder cart. No-deposit, no-cart
                    // bookings keep today's "skip straight to confirmed" flow.
                    if (cartCount === 0 && previewDepositDollars <= 0) {
                      void handlePlaceOrder();
                    } else {
                      setStep("checkout");
                    }
                  }}
                >
                  {/* R12 (2026-05-18): add-on mode (R11 voice handoff with existingReservationId)
                       reframes the sticky button. Booking is already confirmed, so:
                       - empty cart → "Skip add-on" (not "Skip preorder · Confirm booking")
                       - has items → "Add to my booking · N items · $X" (not "Continue · ...") */}
                  {existingReservationId
                    ? (cartCount === 0
                        ? placing ? "Saving…" : "Skip add-on"
                        : `Add to my booking · ${cartCount} item${cartCount !== 1 ? "s" : ""} · ${formatCurrency(cartTotal, currency)}`)
                    : (cartCount === 0 && previewDepositDollars <= 0
                        ? placing ? t("customerPublic.booking.confirmingBooking") : "Skip preorder · Confirm booking"
                        : cartCount === 0
                          ? `Continue to checkout · Deposit ${formatCurrency(previewDepositDollars, currency)}`
                          : `Continue · ${cartCount} item${cartCount !== 1 ? "s" : ""} · ${formatCurrency(cartTotal, currency)}`)}
                  <ChevronRight className="size-4 ml-1" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* ═══════════════════════════════════ STEP 4: CHECKOUT ══════════════ */}
          {step === "checkout" && (
            <motion.div key="checkout" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }}>
              <div className="mb-5 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-white">Review & Pay</h2>
                <button
                  type="button"
                  onClick={() => setStep("details")}
                  className="inline-flex items-center gap-2 rounded-xl border-2 border-gold/40 bg-gold/10 px-5 py-3 text-base font-semibold text-gold shadow-md shadow-gold/10 transition-all hover:border-gold hover:bg-gold/20 hover:shadow-lg hover:shadow-gold/20"
                >
                  <ArrowLeft className="size-5" />
                  Edit details
                </button>
              </div>

              {/* Order summary */}
              <div className="rounded-2xl border border-border bg-bg-surface p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-text-muted">Order Summary</p>
                <div className="flex flex-col gap-2">
                  {cart.map((item) => (
                    <div key={item.id} className="flex items-center gap-3">
                      {item.photoUrl ? (
                        <img src={item.photoUrl} alt="" className="size-8 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-bg-elevated text-gold">
                          <Utensils className="size-3.5" />
                        </span>
                      )}
                      <span className="flex-1 text-sm text-text-secondary">
                        {item.qty}× {item.name}
                      </span>
                      <span className="text-sm font-medium text-text-primary">{formatCurrency(item.price * item.qty, currency)}</span>
                      <button type="button" onClick={() => deleteFromCart(item.id)} className="text-text-muted hover:text-danger transition-colors">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-4 space-y-2 border-t border-border pt-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Subtotal</span>
                    <span className="text-text-primary">{formatCurrency(cartTotal, currency)}</span>
                  </div>
                  {discount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-green-400">Discount {activePromo ? `(${activePromo.title})` : ""}</span>
                      <span className="text-green-400">- {formatCurrency(discount, currency)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-text-secondary">Tax ({taxLabel})</span>
                    <span className="text-text-primary">{formatCurrency(tax, currency)}</span>
                  </div>
                  {previewDepositDollars > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gold">
                        Deposit ({Number(dineIn.party_size) || 0} × {formatCurrency(previewDepositDollars / (Number(dineIn.party_size) || 1), currency)})
                      </span>
                      <span className="text-gold">{formatCurrency(previewDepositDollars, currency)}</span>
                    </div>
                  )}
                  {cenaivaFeeDollars > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Platform fee (5.5%)</span>
                      <span className="text-text-primary">{formatCurrency(cenaivaFeeDollars, currency)}</span>
                    </div>
                  )}
                  {processingFeeDollars > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Processing fee</span>
                      <span className="text-text-primary">{formatCurrency(processingFeeDollars, currency)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
                    <span className="text-text-primary">Total due now</span>
                    <span className="text-gold">{formatCurrency(dinerGrandTotalDollars, currency)}</span>
                  </div>
                  {previewDepositDollars > 0 && (
                    <p className="pt-2 text-xs text-text-muted leading-relaxed">
                      Platform and processing fees are non-refundable.
                      Your <strong>{formatCurrency(previewDepositDollars, currency)}</strong> deposit
                      is fully refundable when the restaurant marks you seated.
                    </p>
                  )}
                </div>
              </div>

              {/* Booking summary */}
              <div className="mt-3 rounded-2xl border border-border bg-bg-surface p-5">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-text-muted">Reservation</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
                  <div><p className="text-text-muted text-xs">Name</p><p className="font-medium text-text-primary">{dineIn.name}</p></div>
                  <div><p className="text-text-muted text-xs">Date & Time</p><p className="font-medium text-text-primary">{dineIn.date} · {formatCompactTimeLabel(dineIn.time)}</p></div>
                  <div><p className="text-text-muted text-xs">Party size</p><p className="font-medium text-text-primary">{dineIn.party_size || 1} guests</p></div>
                  {dineIn.seating_preference && (
                    <div>
                      <p className="text-text-muted text-xs">Table preference</p>
                      <p className="font-medium text-text-primary">{dineIn.seating_preference}</p>
                    </div>
                  )}
                  {dineIn.allergies && <div><p className="text-text-muted text-xs">Dietary notes</p><p className="font-medium text-text-primary">{dineIn.allergies}</p></div>}
                  {dineIn.occasion && <div><p className="text-text-muted text-xs">Occasion</p><p className="font-medium text-text-primary">{dineIn.occasion}</p></div>}
                </div>
              </div>

              {/* Payment */}
              <div className="mt-3 rounded-2xl border border-border bg-bg-surface p-5">
                <div className="mb-4 rounded-xl border border-border bg-bg-elevated p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Split className="size-4 text-gold" />
                    <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">
                      {t("customerPublic.checkout.splitTenderTitle")}
                    </p>
                  </div>
                  <p className="mb-3 text-[11px] leading-relaxed text-text-muted">
                    {t("customerPublic.checkout.splitTenderHint")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentSplitMode("single")}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        paymentSplitMode === "single"
                          ? "border-gold bg-gold/10 text-gold"
                          : "border-border text-text-secondary hover:border-gold/30 hover:text-gold"
                      }`}
                    >
                      {t("customerPublic.checkout.paymentSingle")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentSplitMode("split")}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        paymentSplitMode === "split"
                          ? "border-gold bg-gold/10 text-gold"
                          : "border-border text-text-secondary hover:border-gold/30 hover:text-gold"
                      }`}
                    >
                      {t("customerPublic.checkout.paymentSplitTender")}
                    </button>
                  </div>
                  {paymentSplitMode === "split" && (
                    <div className="mt-3 space-y-3">
                      <div>
                        <Label htmlFor="split-party-count" className="mb-1.5 block text-xs text-text-muted">
                          {t("customerPublic.checkout.splitAmongPeopleLabel")}
                        </Label>
                        <Input
                          id="split-party-count"
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          value={splitPartyCountInput}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
                            setSplitPartyCountInput(digits);
                          }}
                          onBlur={() => {
                            const n = Number.parseInt(splitPartyCountInput, 10);
                            if (splitPartyCountInput.trim() === "" || Number.isNaN(n)) {
                              setSplitPartyCountInput("2");
                              return;
                            }
                            setSplitPartyCountInput(String(Math.min(10, Math.max(2, n))));
                          }}
                          className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-text-secondary">{t("customerPublic.checkout.splitEachShareLabel")}</span>
                        <span className="font-medium text-text-primary">
                          {Number.isFinite(splitEachShare) && splitEachShare > 0
                            ? formatCurrency(splitEachShare, currency)
                            : "—"}
                        </span>
                      </div>
                      {!splitCheckoutValid && splitPartyCountParse.kind !== "ok" && (
                        <p className="border-t border-border pt-3 text-xs leading-relaxed text-danger">
                          {t("customerPublic.checkout.splitPartyCountRangeHint")}
                        </p>
                      )}
                      {!splitCheckoutValid && splitPartyCountParse.kind === "ok" && (
                        <p className="border-t border-border pt-3 text-xs leading-relaxed text-danger">
                          {t("customerPublic.checkout.splitInvalidHintCompleteCards", {
                            count: splitPartyCount,
                          })}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="mb-4 flex items-center gap-2">
                  <CreditCard className="size-4 text-gold" />
                  <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">Payment</p>
                  <Lock className="ml-auto size-3 text-text-muted" />
                  <span className="text-[10px] text-text-muted">Secured</span>
                </div>
                {paymentSplitMode === "split" && totalNow > 0 && restaurant?.id ? (
                  <SplitTenderPaymentForm
                    restaurantId={restaurant.id}
                    shareCents={Math.round((totalNow * 100) / Math.max(2, splitPartyCount))}
                    payerCount={Math.max(2, Math.min(10, splitPartyCount))}
                    holdId={hold.state.status === "active" ? hold.state.holdId : null}
                    formId="diner-pay-form"
                    onPreCheckout={async () => {
                      // Pre-create reservation in pending_payment status +
                      // N deposit rows. SplitTenderPaymentForm then charges
                      // each row's PI in sequence. Reservation flips to
                      // 'confirmed' via the settle trigger when the last
                      // row settles.
                      const result = await createSplitTenderReservation(splitPartyCount);
                      return {
                        reservation_id: result.reservation_id,
                        deposit_row_ids: result.deposit_row_ids,
                      };
                    }}
                    onAllPaid={async () => {
                      setStep("confirmed");
                      toast.success("All payments received — your reservation is confirmed.", { duration: 6000 });
                    }}
                    onError={(msg) => setOrderError(msg)}
                  />
                ) : Math.round(totalNow * 100) > 0 && restaurant?.id ? (
                  <StripePaymentForm
                    restaurantId={restaurant.id}
                    amountCents={Math.round(totalNow * 100)}
                    holdId={hold.state.status === "active" ? hold.state.holdId : null}
                    formId="diner-pay-form"
                    hideInternalSubmit
                    onPaid={async (paymentIntentId) => {
                      await handlePaidBooking(paymentIntentId);
                    }}
                    onError={(msg) => {
                      setOrderError(msg);
                    }}
                  />
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-bg-elevated/40 p-4 text-sm text-text-muted">
                    <p className="font-medium text-text-secondary">No payment required.</p>
                    <p className="mt-1 text-xs">
                      Click <span className="font-semibold text-gold">Place Order</span> to confirm your reservation.
                    </p>
                  </div>
                )}
              </div>

              {orderError && (
                <div className="mt-4 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
                  {orderError}
                </div>
              )}
              {Math.round(totalNow * 100) > 0 ? (
                <Button
                  type="submit"
                  form="diner-pay-form"
                  size="lg"
                  disabled={paymentProcessing || (paymentSplitMode === "split" && !splitCheckoutValid)}
                  className="mt-6 h-16 w-full rounded-2xl text-lg font-semibold tracking-wide [&_svg:not([class*='size-'])]:size-5"
                >
                  {paymentProcessing ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" /> Processing payment…
                    </>
                  ) : (
                    <>
                      <Lock className="mr-2" /> Place Order
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="mt-6 h-16 w-full rounded-2xl text-lg font-semibold tracking-wide [&_svg:not([class*='size-'])]:size-5"
                  disabled={placing}
                  onClick={() => void handlePlaceOrder()}
                >
                  <Lock className="mr-2" />
                  {placing ? "Placing order…" : "Place Order"}
                </Button>
              )}
              <p className="mt-2 text-center text-[11px] text-text-muted">
                By booking, you agree to our{" "}
                <Link to="/terms" className="text-gold underline-offset-2 hover:underline">
                  Terms
                </Link>{" "}
                and{" "}
                <Link to="/refund-policy" className="text-gold underline-offset-2 hover:underline">
                  Refund Policy
                </Link>
                .{" "}
                {tipOption === "after"
                  ? "Tip will be collected after your experience."
                  : "Selected tip is included in today's checkout."}
              </p>
            </motion.div>
          )}

          {/* ═══════════════════════════════════ CONFIRMED ══════════════════════ */}
          {step === "confirmed" && (
            <motion.div
              key="confirmed"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, type: "spring", stiffness: 260, damping: 20 }}
              className="flex flex-col items-center gap-6 py-12 text-center"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 300, damping: 18 }}
                className="flex size-20 items-center justify-center rounded-full bg-success/15 ring-4 ring-success/20"
              >
                <Check className="size-9 text-success" />
              </motion.div>

              <div>
                <h2 className="text-2xl font-bold text-white">Table Booked!</h2>
                <p className="mt-2 text-sm text-text-secondary">
                  {`Your table at ${restaurant.name} is reserved for ${dineIn.party_size || 1} on ${dineIn.date} at ${formatCompactTimeLabel(dineIn.time)}.`}
                </p>
              </div>

              <div className="w-full rounded-2xl border border-success/20 bg-success/5 px-6 py-4">
                <p className="text-xs text-text-muted">Confirmation code</p>
                <p className="mt-1 font-mono text-xl font-bold tracking-widest text-gold">
                  {confirmationCode}
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  {confirmationDelivery.status === "sent" && confirmationDelivery.channel === "sms"
                    ? t("customerPublic.booking.confirmationSentSms")
                    : confirmationDelivery.status === "sent"
                      ? t("customerPublic.booking.confirmationSentEmail")
                      : t("customerPublic.booking.confirmationSaved")}
                </p>
              </div>

              <div className="flex w-full flex-col gap-2">
                {cameFromCenaivaPrepay ? (
                  <Button onClick={() => navigate("/account")}>
                    Back to dashboard
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() => {
                        setStep("details");
                        setCart([]);
                        setTipOption("18");
                        setPaymentSplitMode("single");
                        setSplitPartyCountInput("2");
                        setConfirmationCode("");
                        setConfirmationDelivery({ status: "skipped", channel: null });
                        setOrderError(null);
                      }}
                    >
                      Book again
                    </Button>
                    <Button variant="outline" asChild>
                      <Link to="/discover">Back to Discover</Link>
                    </Button>
                  </>
                )}
              </div>
            </motion.div>
          )}

        </AnimatePresence>

        <div className="h-10" />
      </div>

      {/* ── Hold expired dialog ─────────────────────────────────────────────── */}
      <HoldExpiredDialog
        open={hold.state.status === "expired"}
        restaurantName={restaurantName}
        conflictReason={null}
        grabbing={hold.state.status === "creating"}
        onGrabAgain={async () => {
          // 2026-05-22: re-run details validation before re-grabbing.
          // If the diner spent the original hold's lifetime editing the
          // form into an invalid state (e.g. cleared their phone number),
          // we'd otherwise create a fresh hold tied to bad data and
          // submit it server-side. Force them back to the form first.
          if (!canProceedDetails()) {
            toast.error(
              "Please complete the booking details before reserving the slot again.",
            );
            setStep("details");
            return;
          }
          await hold.grabAgain();
          // The hook reports failures via `state.status === "error"` —
          // surfacing the toast/banner is owned by the hook & dialog UI.
        }}
        onPickDifferentTime={() => {
          setStep("details");
        }}
      />
    </div>
  );
}
