import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { endOfMonth, format, isValid, parse, startOfMonth, startOfToday } from "date-fns";
import {
  Bookmark,
  CalendarDays,
  Camera,
  Clock,
  Heart,
  Info,
  MapPin,
  MessageCircle,
  Sparkles,
  Star,
  Utensils,
  Users,
  X,
} from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import { EventPromotionDetailCard } from "@/components/customer/EventPromotionDetailCard";
import { RestaurantPriceMeter } from "@/components/customer/RestaurantPriceMeter";
import { RestaurantSocialLinks } from "@/components/restaurant/RestaurantSocialLinks";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { eventToDisplay, type RestaurantDisplayInfo } from "@/lib/customer/eventPromotionDisplay";
import {
  fetchAvailableDateSet,
  filterSlotsByConflicts,
  formatConflictWindow,
  useAvailability,
  useAvailabilityRealtimeInvalidate,
  useDinerConflictWindows,
} from "@/hooks/useAvailability";
import { useUser } from "@/hooks/useUser";
import { useAllActiveEvents } from "@/hooks/useEvents";
import { usePublicMenuCategories, usePublicMenuItems } from "@/hooks/useMenuItems";
import { useRestaurant } from "@/hooks/useRestaurant";
import { useRestaurantReviews } from "@/hooks/useRestaurantReviews";
import { TimeWheel } from "@/components/booking/TimeWheel";
import { SeatWheel } from "@/components/booking/SeatWheel";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatCompactTimeLabel } from "@/lib/utils/time";
import { formatRestaurantHoursRows } from "@/lib/restaurant-hours";
import {
  deriveRestaurantPriceLevelFromMenu,
  restaurantPriceLevelFromLabel,
} from "@/lib/restaurant-price-level";
import { normalizeRestaurantDietaryTags, type RestaurantDietaryTag } from "@/lib/restaurant-dietary-tags";

export type RestaurantPreviewSummary = {
  id: string;
  slug?: string;
  name: string;
  cuisine: string;
  price: string;
  area: string;
  bookedToday: number;
  slots: string[];
  initials: string;
  badge: string;
  city: string;
  distanceKm?: number;
  features: string[];
  dietaryTags?: RestaurantDietaryTag[];
  logoUrl?: string | null;
  coverPhotoUrl?: string | null;
  avgRating?: number | null;
  totalReviews?: number | null;
};

type PreviewTab = "menu" | "photos" | "reviews" | "about" | "events";

type RestaurantPreviewModalProps = {
  restaurant: RestaurantPreviewSummary | null;
  favorite: boolean;
  partySize: string;
  bookingDate?: string;
  preferredTime?: string;
  currencyCode?: string;
  availabilityNotice?: string | null;
  onClose: () => void;
  onToggleFavorite: () => void;
  onReserve: (
    slot: string,
    partySize: string,
    shiftId?: string,
    displayTime?: string,
    bookingDate?: string,
    options?: { optimistic?: boolean },
  ) => void | Promise<void>;
};

const TABS: { id: PreviewTab; label: string }[] = [
  { id: "menu", label: "Menu" },
  { id: "photos", label: "Photos" },
  { id: "reviews", label: "Reviews" },
  { id: "about", label: "About" },
  { id: "events", label: "Events" },
];

type PreviewMenuItem = {
  id: string;
  category: string;
  name: string;
  description: string;
  price: number;
  badge: string | null;
  imageUrl: string | null;
};

function todayDateValue(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isUuid(value: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value ?? "");
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value, index, list) => list.indexOf(value) === index);
}

function shortTime(time: string): string {
  return formatCompactTimeLabel(time);
}

function dateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function StripeArt({
  label,
  className,
  imageUrl,
}: {
  label: string;
  className?: string;
  imageUrl?: string | null;
}) {
  return (
    <div className={cn("relative flex min-h-36 overflow-hidden rounded-xl bg-bg-elevated", className)}>
      {imageUrl ? (
        <img src={imageUrl} alt="" className="size-full object-cover" />
      ) : (
        <>
          <div className="absolute inset-0 opacity-80 [background-image:repeating-linear-gradient(135deg,var(--gold)_0_1px,transparent_1px_14px)]" />
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative m-auto size-9 rounded-full bg-gold/30 ring-4 ring-black/30" />
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70">
            {label}
          </span>
        </>
      )}
    </div>
  );
}

export function RestaurantPreviewModal({
  restaurant,
  favorite,
  partySize,
  bookingDate,
  preferredTime,
  currencyCode = "cad",
  availabilityNotice,
  onClose,
  onToggleFavorite,
  onReserve,
}: RestaurantPreviewModalProps) {
  const { t } = useTranslation();
  const [tabState, setTabState] = useState<{ restaurantId: string | null; tab: PreviewTab }>({
    restaurantId: null,
    tab: "menu",
  });
  const [timeState, setTimeState] = useState<{ restaurantId: string | null; time: string }>({
    restaurantId: null,
    time: "",
  });
  const [bookingState, setBookingState] = useState<{
    restaurantId: string | null;
    date: string;
    partySize: number;
  }>({
    restaurantId: null,
    date: "",
    partySize: 2,
  });
  const bookingDateTriggerId = useId();
  const [bookingDatePopoverOpen, setBookingDatePopoverOpen] = useState(false);
  const [partyPopoverOpen, setPartyPopoverOpen] = useState(false);
  const [timePopoverOpen, setTimePopoverOpen] = useState(false);
  const [staleAvailabilityNotice, setStaleAvailabilityNotice] = useState<string | null>(null);
  const [dismissedExternalAvailabilityNotice, setDismissedExternalAvailabilityNotice] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const parsedDate = parse(bookingDate ?? todayDateValue(), "yyyy-MM-dd", new Date());
    return isValid(parsedDate) ? parsedDate : new Date();
  });
  const [availableDateKeys, setAvailableDateKeys] = useState<Set<string>>(new Set());
  const [dateAvailabilityLoading, setDateAvailabilityLoading] = useState(false);

  const previewRestaurantKey = restaurant?.slug ?? restaurant?.id;
  const { restaurant: restaurantDetails } = useRestaurant(previewRestaurantKey);
  const matchedRestaurantDetails =
    restaurantDetails
    && restaurant
    && (
      restaurantDetails.id === restaurant.id
      || restaurantDetails.slug === restaurant.id
      || restaurantDetails.slug === restaurant.slug
    )
      ? restaurantDetails
      : null;
  const resolvedRestaurantId = matchedRestaurantDetails?.id ?? (isUuid(restaurant?.id) ? restaurant?.id ?? null : null);
  const activeTab =
    restaurant && tabState.restaurantId === restaurant.id ? tabState.tab : "menu";
  const fallbackPreviewDate = bookingDate ?? todayDateValue();
  const fallbackPartySize = Math.max(1, Number.parseInt(partySize, 10) || 2);
  const previewDate =
    restaurant && bookingState.restaurantId === restaurant.id && bookingState.date
      ? bookingState.date
      : fallbackPreviewDate;
  const selectedPartySize =
    restaurant && bookingState.restaurantId === restaurant.id
      ? bookingState.partySize
      : fallbackPartySize;
  const previewDateLabel = new Date(`${previewDate}T12:00:00`).toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const previewCalendarDay = useMemo(() => {
    const parsedDate = parse(previewDate, "yyyy-MM-dd", new Date());
    return isValid(parsedDate) ? parsedDate : undefined;
  }, [previewDate]);
  const { categories: dbCategories } = usePublicMenuCategories(resolvedRestaurantId, { enabled: activeTab === "menu" });
  const { items: dbMenuItems, loading: menuLoading } = usePublicMenuItems(resolvedRestaurantId, { enabled: activeTab === "menu" });
  const { reviews, summary: reviewSummary, loading: reviewsLoading } = useRestaurantReviews(resolvedRestaurantId, { enabled: activeTab === "reviews" });
  const { events: activeEvents, loading: eventsLoading } = useAllActiveEvents({ enabled: activeTab === "events" });
  const {
    slots: availabilitySlots,
    loading: availabilityLoading,
    fetchSlots,
    clearSlots,
    floorCapacity,
    unavailableReason,
    unavailableMessage,
  } = useAvailability();
  const { profile } = useUser();
  const dinerConflictWindows = useDinerConflictWindows({
    userProfileId: profile?.id ?? null,
    currentRestaurantId: restaurant?.id ?? null,
    date: previewDate || null,
    timezone: matchedRestaurantDetails?.timezone ?? null,
  });
  const maxPreviewPartySize = Math.max(1, floorCapacity ?? 50);
  const unavailableHeadline = (() => {
    if (availabilityLoading) return "Checking availability...";
    switch (unavailableReason) {
      case "party_size_out_of_range":
        return floorCapacity
          ? `This restaurant seats up to ${floorCapacity} guests. Try a smaller party or contact the restaurant directly for larger groups.`
          : "That party size is outside this restaurant's bookable range.";
      case "fully_booked":
        return "Fully booked for this date — try another day.";
      case "closed":
        return "Closed on this date.";
      case "no_shifts":
        return "No service hours configured for this date.";
      case "no_future_slots":
        return "No more times available later today — try another date.";
      case "no_slots":
      default:
        return unavailableMessage ?? "Unavailable for this date and party size.";
    }
  })();
  const unavailableDate = (date: Date) => {
    if (date < startOfToday()) return true;
    if (dateAvailabilityLoading) return false;
    return !availableDateKeys.has(dateKey(date));
  };

  const availableSlots = useMemo(() => {
    const seen = new Set<string>();
    return filterSlotsByConflicts(availabilitySlots, dinerConflictWindows).filter((slot) => {
      if (seen.has(slot.display_time)) return false;
      seen.add(slot.display_time);
      return true;
    });
  }, [availabilitySlots, dinerConflictWindows]);
  const dinerConflictNotices = useMemo(() => {
    if (dinerConflictWindows.length === 0) return [] as string[];
    if (availableSlots.length === availabilitySlots.length) return [] as string[];
    const seen = new Set<string>();
    const tz = matchedRestaurantDetails?.timezone ?? null;
    for (const window of dinerConflictWindows) {
      const formatted = formatConflictWindow(window, tz);
      if (formatted) seen.add(formatted);
    }
    return Array.from(seen);
  }, [dinerConflictWindows, availableSlots.length, availabilitySlots.length, matchedRestaurantDetails?.timezone]);
  const availableTimes = useMemo(() => availableSlots.map((slot) => slot.display_time), [availableSlots]);
  const preferredAvailableSlot = useMemo(
    () => preferredTime
      ? availableSlots.find((slot) =>
        slot.display_time === preferredTime ||
        formatCompactTimeLabel(slot.display_time) === formatCompactTimeLabel(preferredTime),
      ) ?? null
      : null,
    [availableSlots, preferredTime],
  );
  const selectedSlot = useMemo(
    () => {
      if (restaurant && timeState.restaurantId === restaurant.id) {
        return availableSlots.find((slot) =>
          slot.display_time === timeState.time ||
          formatCompactTimeLabel(slot.display_time) === formatCompactTimeLabel(timeState.time),
        ) ?? null;
      }
      return preferredAvailableSlot ?? availableSlots[0] ?? null;
    },
    [availableSlots, preferredAvailableSlot, restaurant, timeState.restaurantId, timeState.time],
  );

  const selectedTime = selectedSlot?.display_time ?? "";
  const visibleAvailabilityNotice = staleAvailabilityNotice ?? (
    dismissedExternalAvailabilityNotice ? null : availabilityNotice ?? null
  );

  const restaurantEvents = useMemo(
    () => activeEvents.filter((event) => event.restaurant_id === resolvedRestaurantId),
    [activeEvents, resolvedRestaurantId],
  );
  const dietaryTags = normalizeRestaurantDietaryTags(
    matchedRestaurantDetails?.settings_json?.dietaryTags ?? restaurant?.dietaryTags,
  );

  const previewMenuItems = useMemo<PreviewMenuItem[]>(() => {
    const activeCategoriesById = new Map(dbCategories.map((category) => [category.id, category]));
    return dbMenuItems.flatMap((item) => {
      const category = item.category_id ? activeCategoriesById.get(item.category_id) : null;
      if (!category) return [];
      return [{
        id: item.id,
        category: category.name,
        name: item.name,
        description: item.description ?? "",
        price: item.price,
        badge: item.is_featured ? "Popular" : null,
        imageUrl: item.photo_url,
      }];
    });
  }, [dbCategories, dbMenuItems]);

  const priceLevel = useMemo(
    () => deriveRestaurantPriceLevelFromMenu(previewMenuItems),
    [previewMenuItems],
  );
  const eventPriceLevel = priceLevel ?? restaurantPriceLevelFromLabel(restaurant?.price);

  const restaurantDisplay = useMemo<RestaurantDisplayInfo>(() => ({
    name: matchedRestaurantDetails?.name ?? restaurant?.name ?? "",
    slug: matchedRestaurantDetails?.slug ?? null,
    cuisine_type: matchedRestaurantDetails?.cuisine_type ?? restaurant?.cuisine ?? null,
    avg_rating: reviewSummary.avgRating,
    cover_photo_url: matchedRestaurantDetails?.cover_photo_url ?? null,
    city: matchedRestaurantDetails?.city ?? restaurant?.city ?? null,
    price_range: eventPriceLevel,
  }), [eventPriceLevel, restaurant, matchedRestaurantDetails, reviewSummary.avgRating]);

  const hasSavedMenu = previewMenuItems.length > 0;

  const menuHighlights = useMemo<PreviewMenuItem[]>(
    () => previewMenuItems.slice(0, 4),
    [previewMenuItems],
  );

  const menuSections = useMemo((): { title: string; items: PreviewMenuItem[] }[] => {
    if (!hasSavedMenu) return [];

    const orderedCategoryNames = [
      ...dbCategories.map((category) => category.name),
      ...previewMenuItems.map((item) => item.category),
    ].filter((category, index, list) => list.indexOf(category) === index);

    return orderedCategoryNames
      .map((category) => ({
        title: category,
        items: previewMenuItems.filter((item) => item.category === category),
      }))
      .filter((section) => section.items.length > 0);
  }, [dbCategories, hasSavedMenu, previewMenuItems]);

  const logoUrl = matchedRestaurantDetails?.logo_url ?? restaurant?.logoUrl ?? null;
  const coverPhotoUrl = matchedRestaurantDetails?.cover_photo_url ?? restaurant?.coverPhotoUrl ?? null;

  const photoSources = useMemo(
    () => uniqueValues([
      coverPhotoUrl,
      logoUrl,
      ...previewMenuItems.map((item) => item.imageUrl),
      ...restaurantEvents.map((event) => event.media_type === "image" ? event.media_url : event.cover_image_url),
    ]),
    [coverPhotoUrl, logoUrl, previewMenuItems, restaurantEvents],
  );

  const eventCards = useMemo(
    () => restaurantEvents.map((event) => eventToDisplay(event, restaurantDisplay)),
    [restaurantDisplay, restaurantEvents],
  );

  const hoursRows = useMemo(
    () => formatRestaurantHoursRows(matchedRestaurantDetails?.hours_json),
    [matchedRestaurantDetails?.hours_json],
  );
  const detailTags = uniqueValues([
    matchedRestaurantDetails?.cuisine_type,
    matchedRestaurantDetails?.business_type,
    ...(restaurant?.features ?? []),
  ]);
  const aboutText =
    matchedRestaurantDetails?.description
    ?? null;
  const headerBadges = uniqueValues([
    matchedRestaurantDetails?.business_type,
    restaurant?.badge,
    ...((restaurant?.features ?? []).slice(0, 2)),
  ]);
  const headerMeta = uniqueValues([
    matchedRestaurantDetails?.cuisine_type ?? restaurant?.cuisine,
    matchedRestaurantDetails?.city ?? restaurant?.area,
  ]);

  const setRestaurantTab = (tab: PreviewTab) => {
    setTabState({ restaurantId: restaurant?.id ?? null, tab });
  };

  const setRestaurantTime = (time: string) => {
    setStaleAvailabilityNotice(null);
    setDismissedExternalAvailabilityNotice(true);
    setTimeState({ restaurantId: restaurant?.id ?? null, time });
  };

  const setRestaurantDate = (date: string) => {
    setStaleAvailabilityNotice(null);
    setDismissedExternalAvailabilityNotice(true);
    setBookingState({
      restaurantId: restaurant?.id ?? null,
      date,
      partySize: selectedPartySize,
    });
  };

  const setRestaurantPartySize = (party: number) => {
    setStaleAvailabilityNotice(null);
    setDismissedExternalAvailabilityNotice(true);
    const clamped = Math.min(Math.max(1, party), maxPreviewPartySize);
    setBookingState({
      restaurantId: restaurant?.id ?? null,
      date: previewDate,
      partySize: clamped,
    });
  };

  const reserveSelectedSlot = async () => {
    if (!restaurant || reserving) return;
    if (!selectedSlot) return;
    setReserving(true);
    setStaleAvailabilityNotice(null);
    try {
      // No `optimistic: true` — the parent re-checks availability against a
      // forced refresh before navigating, so a slot that just got booked by
      // another user shows the "no longer available" notice instead of
      // taking the user to checkout on stale data.
      await onReserve(
        selectedSlot.date_time,
        String(selectedPartySize),
        selectedSlot.shift_id,
        formatCompactTimeLabel(selectedSlot.display_time),
        previewDate,
      );
    } finally {
      setReserving(false);
    }
  };

  // Force a fresh DB hit every time the modal mounts or the user changes the
  // date / party size. The 45s in-memory cache exists to make Discover's
  // background prefetch + repeat opens cheap, but inside the modal the user
  // expects each interaction to re-check the database — both so the data is
  // current and so the "Loading…" indicator appears as visible feedback.
  useEffect(() => {
    if (!restaurant) {
      clearSlots();
      return;
    }

    void fetchSlots(
      restaurant.id,
      previewDate,
      selectedPartySize,
      { forceRefresh: true },
    );
  }, [clearSlots, fetchSlots, previewDate, restaurant, selectedPartySize]);

  // Live invalidation: when another diner's booking lands at this restaurant
  // while the preview is open, drop the cached availability and re-fetch the
  // current view immediately so a slot that just got taken disappears.
  useAvailabilityRealtimeInvalidate(
    restaurant?.id ?? null,
    () => {
      if (!restaurant) return;
      void fetchSlots(restaurant.id, previewDate, selectedPartySize, { forceRefresh: true });
    },
  );

  useEffect(() => {
    void Promise.resolve().then(() => setStaleAvailabilityNotice(null));
  }, [restaurant?.id, previewDate, selectedPartySize]);

  useEffect(() => {
    void Promise.resolve().then(() => setDismissedExternalAvailabilityNotice(false));
  }, [availabilityNotice]);

  useEffect(() => {
    void Promise.resolve().then(() => setDismissedExternalAvailabilityNotice(false));
  }, [restaurant?.id]);

  useEffect(() => {
    if (!restaurant) return;
    let cancelled = false;
    const monthStart = startOfMonth(calendarMonth);
    const monthEnd = endOfMonth(calendarMonth);
    const today = startOfToday();
    const rangeStart = monthStart < today ? today : monthStart;
    if (rangeStart > monthEnd) {
      setAvailableDateKeys(new Set());
      setDateAvailabilityLoading(false);
      return;
    }

    void Promise.resolve().then(() => {
      if (!cancelled) setDateAvailabilityLoading(true);
    });
    void fetchAvailableDateSet({
      restaurantId: restaurant.id,
      partySize: selectedPartySize,
      startDate: dateKey(rangeStart),
      endDate: dateKey(monthEnd),
    })
      .then((availableDays) => {
        if (!cancelled) setAvailableDateKeys(availableDays);
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
  }, [calendarMonth, restaurant, selectedPartySize]);

  useEffect(() => {
    if (!restaurant || availabilityLoading) return;
    if (availableTimes.length === 0) {
      if (timeState.restaurantId === restaurant.id && timeState.time) {
        void Promise.resolve().then(() => {
          setTimeState({ restaurantId: restaurant.id, time: "" });
        });
      }
      return;
    }
    if (!restaurant || availableTimes.length === 0) return;
    if (staleAvailabilityNotice) return;
    if (
      timeState.restaurantId === restaurant.id &&
      availableTimes.some((time) =>
        time === timeState.time ||
        formatCompactTimeLabel(time) === formatCompactTimeLabel(timeState.time),
      )
    ) return;
    void Promise.resolve().then(() => {
      setTimeState({
        restaurantId: restaurant.id,
        time: (preferredAvailableSlot ?? availableSlots[0])?.display_time ?? "",
      });
    });
  }, [availabilityLoading, availableSlots, availableTimes, preferredAvailableSlot, restaurant, staleAvailabilityNotice, timeState.restaurantId, timeState.time]);


  useEffect(() => {
    if (!restaurant) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [restaurant, onClose]);

  return (
    <AnimatePresence>
      {restaurant && (
        <motion.div
          className="fixed inset-0 z-[80] overflow-y-auto bg-black/85 px-4 py-6 backdrop-blur-md sm:px-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`${restaurant.name} details`}
            className="mx-auto min-h-[92vh] max-w-[84rem] overflow-hidden rounded-3xl border border-border bg-bg-base shadow-2xl shadow-black"
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.24 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="relative h-60 overflow-hidden border-b border-border bg-bg-elevated">
              <StripeArt
                label={restaurant.initials}
                imageUrl={coverPhotoUrl}
                className="absolute inset-0 rounded-none"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg-base/45 to-bg-base" />
              <button
                type="button"
                onClick={onClose}
                className="absolute right-4 top-4 inline-flex size-9 items-center justify-center rounded-full border border-border bg-bg-surface/80 text-text-secondary backdrop-blur transition-colors hover:border-gold/50 hover:text-white"
                aria-label="Close restaurant details"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mx-auto -mt-16 w-full px-4 pb-10 sm:px-6 lg:px-8">
              <section className="relative rounded-2xl border border-border bg-bg-surface/95 p-5 shadow-2xl shadow-black/30 backdrop-blur">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex gap-4">
                    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-gold/30 bg-bg-elevated font-mono text-sm font-semibold text-gold shadow-lg shadow-black/20">
                      {logoUrl ? (
                        <img src={logoUrl} alt={`${restaurant.name} logo`} className="size-full object-cover" />
                      ) : (
                        restaurant.initials
                      )}
                    </div>
                    <div>
                    <div className="flex flex-wrap gap-2">
                      {headerBadges.map((feature) => (
                        <span
                          key={feature}
                          className="rounded-md border border-border bg-bg-elevated px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary"
                        >
                          {feature}
                        </span>
                      ))}
                      {dietaryTags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md border border-gold/30 bg-gold/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-gold"
                        >
                          {t(`restaurantDietaryTags.${tag}`)}
                        </span>
                      ))}
                      {availableTimes.length > 0 && (
                        <span className="rounded-md border border-success/30 bg-success/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-success">
                          {availableTimes.length} times today
                        </span>
                      )}
                    </div>
                    <h2 className="mt-3 font-serif text-4xl leading-none text-white sm:text-5xl">
                      {restaurant.name}
                    </h2>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
                      <RestaurantPriceMeter level={priceLevel} />
                      {reviewSummary.totalReviews > 0 && reviewSummary.avgRating != null ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gold/10 px-2 py-0.5 text-gold">
                          <Star className="size-3 fill-gold text-gold" />
                          <span className="font-semibold">{reviewSummary.avgRating.toFixed(1)}</span>
                          <span className="text-text-muted">({reviewSummary.totalReviews})</span>
                        </span>
                      ) : null}
                      {headerMeta.map((meta) => (
                        <span key={meta}>{meta}</span>
                      ))}
                    </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    <RestaurantSocialLinks
                      settingsJson={matchedRestaurantDetails?.settings_json}
                      websiteFallback={matchedRestaurantDetails?.website}
                    />
                    <button
                      type="button"
                      onClick={onToggleFavorite}
                      className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-bg-elevated text-text-secondary transition-colors hover:border-gold/50 hover:text-white"
                      aria-label="Save restaurant"
                    >
                      <Heart className={cn("size-4", favorite && "fill-gold text-gold")} />
                    </button>
                    <button
                      type="button"
                      className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-bg-elevated text-text-secondary transition-colors hover:border-gold/50 hover:text-white"
                      aria-label="Bookmark restaurant"
                    >
                      <Bookmark className="size-4" />
                    </button>
                  </div>
                </div>
              </section>

              <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_440px]">
                <div>
                  <div className="flex rounded-xl border border-border bg-bg-surface p-1">
                    {TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setRestaurantTab(tab.id)}
                        className={cn(
                          "flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                          activeTab === tab.id
                            ? "bg-gold text-black shadow-lg shadow-gold/15"
                            : "text-text-secondary hover:text-white",
                        )}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-5">
                    {activeTab === "menu" && (
                      <div className="space-y-5">
                        <section className="rounded-2xl border border-border bg-bg-surface p-4">
                          <div className="mb-4 flex items-end justify-between">
                            <div>
                              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold">
                                Menu
                              </p>
                              <h3 className="mt-1 font-serif text-2xl text-white">
                                Menu highlights
                              </h3>
                            </div>
                            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                              {menuLoading && !hasSavedMenu ? "Loading" : `${menuHighlights.length} dishes`}
                            </p>
                          </div>
                          {menuHighlights.length > 0 ? (
                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                              {menuHighlights.map((item) => (
                              <article
                                key={item.id}
                                className="overflow-hidden rounded-xl border border-border bg-bg-elevated"
                              >
                                <StripeArt
                                  label={item.name.slice(0, 8)}
                                  imageUrl={item.imageUrl}
                                  className="aspect-[4/3] min-h-0 rounded-none"
                                />
                                <div className="p-3">
                                  <p className="font-serif text-base text-white">{item.name}</p>
                                  <p className="mt-1 line-clamp-2 text-xs text-text-secondary">
                                    {item.description}
                                  </p>
                                  <div className="mt-3 flex items-center justify-between gap-2">
                                    <span className="font-serif text-xl font-semibold tracking-tight text-gold">
                                      {formatCurrency(item.price, currencyCode)}
                                    </span>
                                    {item.badge ? (
                                      <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[10px] text-gold">
                                        {item.badge}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                </article>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-xl border border-dashed border-border bg-bg-elevated p-5 text-sm text-text-muted">
                              {menuLoading ? "Loading menu items..." : "No public menu items have been added yet."}
                            </div>
                          )}
                        </section>

                        {menuSections.map((section) => (
                          <section
                            key={section.title}
                            className="rounded-2xl border border-border bg-bg-surface p-4"
                          >
                            <div className="flex items-center justify-between">
                              <h3 className="font-serif text-2xl text-white">{section.title}</h3>
                              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                                {section.items.length} items
                              </span>
                            </div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              {section.items.map((item) => (
                                <div key={item.id} className="flex gap-3 rounded-xl bg-bg-elevated p-3">
                                  <StripeArt
                                    label={item.name.slice(0, 3)}
                                    imageUrl={item.imageUrl}
                                    className="size-20 min-h-0 shrink-0 rounded-lg"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-start justify-between gap-3">
                                      <p className="font-medium text-white">{item.name}</p>
                                      <span className="shrink-0 font-serif text-lg font-semibold tracking-tight text-gold">
                                        {formatCurrency(item.price, currencyCode)}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                                      {item.description}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </section>
                        ))}
                      </div>
                    )}

                    {activeTab === "photos" && (
                      <section className="rounded-2xl border border-border bg-bg-surface p-4">
                        <div className="mb-4 flex items-center justify-between">
                          <div>
                            <h3 className="font-serif text-2xl text-white">Photos</h3>
                            <p className="text-xs text-text-muted">Photos saved for this restaurant and menu.</p>
                          </div>
                          <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                            <Camera className="size-3.5" /> {photoSources.length} photos
                          </span>
                        </div>
                        {photoSources.length > 0 ? (
                          <div className="grid h-[520px] grid-cols-2 gap-2 sm:grid-cols-3">
                            {photoSources.slice(0, 5).map((imageUrl, index) => (
                              <StripeArt
                                key={imageUrl}
                                label={restaurant.name}
                                imageUrl={imageUrl}
                                className={cn(index === 0 && "col-span-2 row-span-2", "min-h-0")}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed border-border bg-bg-elevated p-5 text-sm text-text-muted">
                            No restaurant or menu photos have been added yet.
                          </div>
                        )}
                      </section>
                    )}

                    {activeTab === "reviews" && (
                      <div className="space-y-4">
                        <section className="rounded-2xl border border-border bg-bg-surface p-4">
                          <div className="mb-4 flex items-end justify-between gap-4">
                            <div>
                              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold">
                                Guest sentiment
                              </p>
                              <h3 className="mt-1 font-serif text-2xl text-white">
                                Reviews
                              </h3>
                            </div>
                            {reviewSummary.totalReviews > 0 && reviewSummary.avgRating != null ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-sm text-gold">
                                <Star className="size-4 fill-gold" />
                                <span className="font-semibold">{reviewSummary.avgRating.toFixed(1)}</span>
                                <span className="text-xs text-text-muted">({reviewSummary.totalReviews})</span>
                              </span>
                            ) : null}
                          </div>
                          {reviewsLoading ? (
                            <div className="rounded-xl border border-dashed border-border bg-bg-elevated p-5 text-sm text-text-muted">
                              Loading reviews...
                            </div>
                          ) : reviews.length > 0 ? (
                            <div className="space-y-3">
                              {reviews.map((review) => (
                                <article key={review.id} className="rounded-xl border border-border bg-bg-elevated p-4">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-1 text-gold">
                                      {[1, 2, 3, 4, 5].map((value) => (
                                        <Star
                                          key={value}
                                          className={cn(
                                            "size-4",
                                            value <= review.rating ? "fill-gold text-gold" : "text-text-muted",
                                          )}
                                        />
                                      ))}
                                    </div>
                                    <span className="text-[11px] text-text-muted">
                                      {format(new Date(review.created_at), "MMM d, yyyy")}
                                    </span>
                                  </div>
                                  {review.review_text ? (
                                    <p className="mt-3 text-sm leading-6 text-text-secondary">{review.review_text}</p>
                                  ) : (
                                    <p className="mt-3 text-sm text-text-muted">Rated {review.rating} out of 5.</p>
                                  )}
                                </article>
                              ))}
                            </div>
                          ) : (
                            <div className="rounded-xl border border-dashed border-border bg-bg-elevated p-5 text-sm text-text-muted">
                              No public reviews have been recorded for this restaurant yet.
                            </div>
                          )}
                        </section>
                      </div>
                    )}

                    {activeTab === "about" && (
                      <div className="space-y-4">
                        <section className="rounded-2xl border border-border bg-bg-surface p-5">
                          <h3 className="font-serif text-2xl text-white">About {restaurant.name}</h3>
                          {aboutText ? (
                            <p className="mt-3 text-sm leading-relaxed text-text-secondary">
                              {aboutText}
                            </p>
                          ) : (
                            <div className="mt-3 rounded-xl border border-dashed border-border bg-bg-elevated p-5 text-sm text-text-muted">
                              No public description has been added yet.
                            </div>
                          )}
                          {matchedRestaurantDetails?.website && (
                            <p className="mt-3 text-xs text-text-muted">{matchedRestaurantDetails.website}</p>
                          )}
                        </section>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <section className="rounded-2xl border border-border bg-bg-surface p-5">
                            <h4 className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
                              Hours
                            </h4>
                            <dl className="mt-4 space-y-2 text-xs text-text-secondary">
                              {hoursRows.map((row) => (
                                <div key={row.key} className="flex justify-between gap-4">
                                  <dt>{row.label}</dt>
                                  <dd className={row.open ? "text-white" : "text-text-muted"}>{row.value}</dd>
                                </div>
                              ))}
                            </dl>
                          </section>
                          <section className="rounded-2xl border border-border bg-bg-surface p-5">
                            <h4 className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
                              Details
                            </h4>
                            <div className="mt-4 space-y-2 text-xs text-text-secondary">
                              {(matchedRestaurantDetails?.address || restaurant.area) && (
                                <p className="flex items-center gap-2">
                                  <MapPin className="size-3 text-gold" /> {matchedRestaurantDetails?.address ?? restaurant.area}
                                </p>
                              )}
                              <p className="flex items-center gap-2">
                                <Clock className="size-3 text-gold" /> {matchedRestaurantDetails?.timezone ?? "Timezone not set"}
                              </p>
                              {matchedRestaurantDetails?.phone && (
                                <p className="flex items-center gap-2">
                                  <Sparkles className="size-3 text-gold" /> {matchedRestaurantDetails.phone}
                                </p>
                              )}
                            </div>
                            <div className="mt-5 flex flex-wrap gap-2">
                              {detailTags.map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-full border border-border bg-bg-elevated px-2 py-1 text-[11px] text-text-secondary"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </section>
                        </div>
                      </div>
                    )}

                    {activeTab === "events" && (
                      <section className="rounded-2xl border border-border bg-bg-surface p-4">
                        <h3 className="font-serif text-2xl text-white">Events at {restaurant.name}</h3>
                        <p className="mt-1 text-xs text-text-muted">
                          Active events saved for this restaurant.
                        </p>
                        {eventCards.length > 0 ? (
                          <div className="mt-4 grid gap-4">
                            {eventCards.map((event) => (
                              <EventPromotionDetailCard
                                key={event.id}
                                item={event}
                                onReserve={reserveSelectedSlot}
                                onRestaurantOpen={() => setRestaurantTab("menu")}
                                className="shadow-none"
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="mt-4 rounded-xl border border-dashed border-border bg-bg-elevated p-5 text-sm text-text-muted">
                            {eventsLoading ? "Loading events..." : "No active events have been added yet."}
                          </div>
                        )}
                      </section>
                    )}
                  </div>
                </div>

                <aside className="lg:sticky lg:top-6 lg:self-start">
                  <div className="rounded-2xl border border-border bg-bg-surface p-5 shadow-2xl shadow-black/30">
                    <h3 className="font-serif text-xl text-white">Reserve a table</h3>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <Popover
                        open={availabilityLoading || dateAvailabilityLoading ? false : bookingDatePopoverOpen}
                        onOpenChange={(open) => {
                          if (!availabilityLoading && !dateAvailabilityLoading) setBookingDatePopoverOpen(open);
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            id={bookingDateTriggerId}
                            type="button"
                            disabled={availabilityLoading || dateAvailabilityLoading}
                            className="flex items-center gap-3 rounded-xl bg-bg-elevated p-3 text-left transition-colors hover:bg-bg-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <CalendarDays className="size-4 text-gold" />
                            <span>
                              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Date</p>
                              <p className="mt-1 text-sm text-white">
                                {availabilityLoading || dateAvailabilityLoading ? "Loading…" : previewDateLabel}
                              </p>
                            </span>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          className="z-[90] w-auto border-border bg-bg-elevated p-0 text-text-primary shadow-2xl"
                        >
                          <Calendar
                            mode="single"
                            required={false}
                            selected={previewCalendarDay}
                            month={calendarMonth}
                            onMonthChange={setCalendarMonth}
                            onSelect={(date) => {
                              if (!date) return;
                              setRestaurantDate(format(date, "yyyy-MM-dd"));
                              setBookingDatePopoverOpen(false);
                            }}
                            disabled={unavailableDate}
                            className="rounded-md border-0 bg-transparent [--cell-size:--spacing(8)]"
                          />
                        </PopoverContent>
                      </Popover>
                      <Popover
                        open={availabilityLoading ? false : timePopoverOpen}
                        onOpenChange={(open) => {
                          if (!availabilityLoading) setTimePopoverOpen(open);
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            disabled={availabilityLoading}
                            className="flex items-center gap-3 rounded-xl bg-bg-elevated p-3 text-left transition-colors hover:bg-bg-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Clock className="size-4 text-gold" />
                            <span>
                              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Time</p>
                              <p className="mt-1 text-sm text-white">
                                {availabilityLoading
                                  ? "Loading…"
                                  : selectedTime
                                    ? shortTime(selectedTime)
                                    : availableTimes.length > 0
                                      ? "Pick a time"
                                      : "No times"}
                              </p>
                            </span>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          className="z-[90] w-48 border-border bg-bg-elevated p-2 text-text-primary shadow-2xl"
                        >
                          {availableTimes.length > 0 ? (
                            <TimeWheel
                              times={availableTimes}
                              value={selectedTime || availableTimes[0]}
                              onCommit={(time) => {
                                setRestaurantTime(time);
                                setTimePopoverOpen(false);
                              }}
                            />
                          ) : (
                            <p className="px-2 py-3 text-center text-xs text-text-muted">
                              {unavailableHeadline}
                            </p>
                          )}
                        </PopoverContent>
                      </Popover>
                      <Popover
                        open={availabilityLoading ? false : partyPopoverOpen}
                        onOpenChange={(open) => {
                          if (!availabilityLoading) setPartyPopoverOpen(open);
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            disabled={availabilityLoading}
                            className="flex items-center gap-3 rounded-xl bg-bg-elevated p-3 text-left transition-colors hover:bg-bg-elevated/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Users className="size-4 text-gold" />
                            <span>
                              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Party</p>
                              <p className="mt-1 text-sm text-white">
                                {availabilityLoading
                                  ? "Loading…"
                                  : `${selectedPartySize} guest${selectedPartySize === 1 ? "" : "s"}`}
                              </p>
                            </span>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          className="z-[90] w-48 border-border bg-bg-elevated p-2 text-text-primary shadow-2xl"
                        >
                          <SeatWheel
                            maxSeats={maxPreviewPartySize}
                            value={selectedPartySize}
                            onCommit={(party) => {
                              setRestaurantPartySize(party);
                              setPartyPopoverOpen(false);
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    {visibleAvailabilityNotice ? (
                      <p className="mt-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
                        {visibleAvailabilityNotice}
                      </p>
                    ) : null}
                    {dinerConflictNotices.length > 0 ? (
                      <div className="mt-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
                        <p className="font-semibold">Some times are hidden because you're already booked:</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-5">
                          {dinerConflictNotices.map((notice) => (
                            <li key={notice}>{notice}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={reserveSelectedSlot}
                      disabled={!selectedTime || availabilityLoading || reserving}
                      className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-gold px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {reserving ? "Checking availability..." : selectedTime ? `Continue with ${shortTime(selectedTime)}` : "No times available"}
                      <CalendarDays className="size-4" />
                    </button>

                    <p className="mt-5 flex gap-2 text-[11px] leading-relaxed text-text-muted">
                      <Info className="mt-0.5 size-3.5 shrink-0 text-gold" />
                      Availability is calculated from this restaurant's saved tables, reservations, and booking rules.
                    </p>
                  </div>

                  <div className="mt-3 space-y-2 rounded-2xl border border-border bg-bg-surface/70 p-4 text-xs text-text-secondary">
                    <p className="flex items-center gap-2">
                      <Utensils className="size-3.5 text-gold" />
                      {restaurant.bookedToday} booking{restaurant.bookedToday === 1 ? "" : "s"} created today
                    </p>
                    <p className="flex items-center gap-2">
                      <MessageCircle className="size-3.5 text-gold" />
                      {matchedRestaurantDetails?.accepts_walkins === false ? "Reservations only" : "Walk-ins accepted when available"}
                    </p>
                    <p className="flex items-center gap-2">
                      <Users className="size-3.5 text-gold" />
                      Party size uses live availability
                    </p>
                  </div>
                </aside>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
