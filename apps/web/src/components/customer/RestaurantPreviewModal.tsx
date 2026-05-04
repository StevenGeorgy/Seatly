import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
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

import { EventPromotionDetailCard } from "@/components/customer/EventPromotionDetailCard";
import { eventToDisplay, type RestaurantDisplayInfo } from "@/lib/customer/eventPromotionDisplay";
import { useAvailability } from "@/hooks/useAvailability";
import { useAllActiveEvents } from "@/hooks/useEvents";
import { usePublicMenuCategories, usePublicMenuItems } from "@/hooks/useMenuItems";
import { useRestaurant } from "@/hooks/useRestaurant";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatCompactTimeLabel } from "@/lib/utils/time";
import { formatRestaurantHoursRows } from "@/lib/restaurant-hours";
import {
  deriveRestaurantPriceLevel,
  restaurantPriceLabelFromLevel,
  restaurantPriceLevelFromLabel,
} from "@/lib/restaurant-price-level";
import { normalizeRestaurantDietaryTags, type RestaurantDietaryTag } from "@/lib/restaurant-dietary-tags";

export type RestaurantPreviewSummary = {
  id: string;
  name: string;
  reviews: number;
  rating: number;
  cuisine: string;
  price: string;
  area: string;
  bookedToday: number;
  slots: string[];
  initials: string;
  badge: string;
  city: string;
  distanceKm: number;
  features: string[];
  dietaryTags?: RestaurantDietaryTag[];
  logoUrl?: string | null;
  coverPhotoUrl?: string | null;
};

type PreviewTab = "menu" | "photos" | "reviews" | "about" | "events";

type RestaurantPreviewModalProps = {
  restaurant: RestaurantPreviewSummary | null;
  favorite: boolean;
  partySize: string;
  currencyCode?: string;
  onClose: () => void;
  onToggleFavorite: () => void;
  onReserve: (slot: string) => void;
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

function todayDisplayValue(): string {
  return new Date().toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
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

function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-0.5 text-gold">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={cn("size-3", i < full ? "fill-gold" : "text-text-muted")} />
      ))}
    </span>
  );
}

export function RestaurantPreviewModal({
  restaurant,
  favorite,
  partySize,
  currencyCode = "cad",
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

  const activeTab =
    restaurant && tabState.restaurantId === restaurant.id ? tabState.tab : "menu";
  const previewDate = todayDateValue();
  const previewDateLabel = todayDisplayValue();
  const { restaurant: restaurantDetails } = useRestaurant(restaurant?.id);
  const { categories: dbCategories } = usePublicMenuCategories(restaurant?.id);
  const { items: dbMenuItems, loading: menuLoading } = usePublicMenuItems(restaurant?.id);
  const { events: activeEvents, loading: eventsLoading } = useAllActiveEvents();
  const {
    slots: availabilitySlots,
    loading: availabilityLoading,
    fetchSlots,
    clearSlots,
  } = useAvailability();

  const availableTimes = useMemo(() => {
    const liveSlots = availabilitySlots.map((slot) => slot.display_time);
    return Array.from(new Set(liveSlots)).slice(0, 6);
  }, [availabilitySlots]);

  const selectedTime =
    restaurant && timeState.restaurantId === restaurant.id
      ? timeState.time
      : availableTimes[0] ?? "";

  const restaurantEvents = useMemo(
    () => activeEvents.filter((event) => event.restaurant_id === restaurant?.id),
    [activeEvents, restaurant?.id],
  );
  const dietaryTags = normalizeRestaurantDietaryTags(
    restaurantDetails?.settings_json?.dietaryTags ?? restaurant?.dietaryTags,
  );

  const previewMenuItems = useMemo<PreviewMenuItem[]>(() => (
    dbMenuItems.map((item) => ({
      id: item.id,
      category: item.category ?? dbCategories.find((category) => category.id === item.category_id)?.name ?? "Other",
      name: item.name,
      description: item.description ?? "",
      price: item.price,
      badge: item.is_featured ? "Popular" : null,
      imageUrl: item.photo_url,
    }))
  ), [dbCategories, dbMenuItems]);

  const priceLevel = useMemo(
    () => deriveRestaurantPriceLevel(
      dbMenuItems,
      restaurantDetails?.price_range ?? restaurantPriceLevelFromLabel(restaurant?.price),
    ),
    [dbMenuItems, restaurant?.price, restaurantDetails?.price_range],
  );
  const priceLabel = restaurantPriceLabelFromLevel(priceLevel);

  const restaurantDisplay = useMemo<RestaurantDisplayInfo>(() => ({
    name: restaurantDetails?.name ?? restaurant?.name ?? "",
    slug: restaurantDetails?.slug ?? null,
    cuisine_type: restaurantDetails?.cuisine_type ?? restaurant?.cuisine ?? null,
    avg_rating: restaurantDetails?.avg_rating ?? restaurant?.rating ?? null,
    cover_photo_url: restaurantDetails?.cover_photo_url ?? null,
    city: restaurantDetails?.city ?? restaurant?.city ?? null,
    price_range: priceLevel,
  }), [priceLevel, restaurant, restaurantDetails]);

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

  const logoUrl = restaurantDetails?.logo_url ?? restaurant?.logoUrl ?? null;
  const coverPhotoUrl = restaurantDetails?.cover_photo_url ?? restaurant?.coverPhotoUrl ?? null;

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
    () => formatRestaurantHoursRows(restaurantDetails?.hours_json),
    [restaurantDetails?.hours_json],
  );
  const detailTags = uniqueValues([
    restaurantDetails?.cuisine_type,
    restaurantDetails?.business_type,
    ...(restaurant?.features ?? []),
  ]);
  const aboutText =
    restaurantDetails?.description
    ?? null;
  const headerBadges = uniqueValues([
    restaurantDetails?.business_type,
    restaurant?.badge,
    ...((restaurant?.features ?? []).slice(0, 2)),
  ]);
  const headerMeta = uniqueValues([
    restaurantDetails?.cuisine_type ?? restaurant?.cuisine,
    priceLabel,
    restaurantDetails?.city ?? restaurant?.area,
  ]);

  const setRestaurantTab = (tab: PreviewTab) => {
    setTabState({ restaurantId: restaurant?.id ?? null, tab });
  };

  const setRestaurantTime = (time: string) => {
    setTimeState({ restaurantId: restaurant?.id ?? null, time });
  };

  useEffect(() => {
    if (!restaurant) {
      clearSlots();
      return;
    }

    void fetchSlots(
      restaurant.id,
      previewDate,
      Number.parseInt(partySize, 10) || 2,
    );
  }, [clearSlots, fetchSlots, partySize, previewDate, restaurant]);

  useEffect(() => {
    if (!restaurant || availableTimes.length === 0) return;
    if (timeState.restaurantId === restaurant.id && availableTimes.includes(timeState.time)) return;
    void Promise.resolve().then(() => {
      setTimeState({ restaurantId: restaurant.id, time: availableTimes[0] });
    });
  }, [availableTimes, restaurant, timeState.restaurantId, timeState.time]);

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
            className="mx-auto min-h-[92vh] max-w-6xl overflow-hidden rounded-3xl border border-border bg-bg-base shadow-2xl shadow-black"
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.24 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="relative h-44 overflow-hidden border-b border-border bg-bg-elevated">
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

            <div className="mx-auto -mt-16 max-w-5xl px-4 pb-10 sm:px-6 lg:px-8">
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
                      {headerMeta.map((meta) => (
                        <span key={meta} className={meta === priceLabel ? "text-gold" : undefined}>
                          {meta}
                        </span>
                      ))}
                      <span className="inline-flex items-center gap-1">
                        <Star className="size-3 fill-gold text-gold" />
                        {restaurant.reviews > 0
                          ? `${restaurant.rating.toFixed(1)} · ${restaurant.reviews.toLocaleString()} reviews`
                          : "No reviews yet"}
                      </span>
                    </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
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

              <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
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
                                  className="min-h-28 rounded-none"
                                />
                                <div className="p-3">
                                  <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">
                                    {item.category}
                                  </p>
                                  <p className="mt-1 font-serif text-base text-white">{item.name}</p>
                                  <p className="mt-1 line-clamp-2 text-xs text-text-secondary">
                                    {item.description}
                                  </p>
                                  <div className="mt-3 flex items-center justify-between text-xs">
                                    <span className="text-gold">
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
                                      <span className="shrink-0 text-xs text-gold">
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
                          {restaurant.reviews > 0 ? (
                            <div className="grid gap-5 sm:grid-cols-[160px_1fr]">
                              <div>
                                <p className="font-serif text-5xl text-gold">{restaurant.rating.toFixed(1)}</p>
                                <Stars rating={restaurant.rating} />
                                <p className="mt-1 text-xs text-text-muted">
                                  {restaurant.reviews.toLocaleString()} reviews
                                </p>
                              </div>
                              <div className="rounded-xl border border-dashed border-border bg-bg-elevated p-4 text-sm leading-relaxed text-text-secondary">
                                Guest review details have not been added yet.
                              </div>
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
                          {restaurantDetails?.website && (
                            <p className="mt-3 text-xs text-text-muted">{restaurantDetails.website}</p>
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
                              {(restaurantDetails?.address || restaurant.area) && (
                                <p className="inline-flex items-center gap-2">
                                  <MapPin className="size-3 text-gold" /> {restaurantDetails?.address ?? restaurant.area}
                                </p>
                              )}
                              <p className="inline-flex items-center gap-2">
                                <Clock className="size-3 text-gold" /> {restaurantDetails?.timezone ?? "Timezone not set"}
                              </p>
                              {restaurantDetails?.phone && (
                                <p className="inline-flex items-center gap-2">
                                  <Sparkles className="size-3 text-gold" /> {restaurantDetails.phone}
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
                                onReserve={() => selectedTime && onReserve(selectedTime)}
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
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-bg-elevated p-3">
                        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Date</p>
                        <p className="mt-1 text-sm text-white">{previewDateLabel}</p>
                      </div>
                      <div className="rounded-xl bg-bg-elevated p-3">
                        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">Party</p>
                        <p className="mt-1 text-sm text-white">
                          {partySize} guest{partySize === "1" ? "" : "s"}
                        </p>
                      </div>
                    </div>

                    <p className="mt-5 font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">
                      Available times
                    </p>
                    {availableTimes.length > 0 ? (
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        {availableTimes.map((time) => (
                          <button
                            key={time}
                            type="button"
                            onClick={() => setRestaurantTime(time)}
                            className={cn(
                              "rounded-md px-3 py-2 text-xs transition-colors",
                              selectedTime === time
                                ? "bg-gold text-black shadow-lg shadow-gold/20"
                                : "bg-bg-elevated text-text-secondary hover:text-white",
                            )}
                          >
                            {shortTime(time)}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-xl bg-bg-elevated p-3 text-xs text-text-muted">
                        {availabilityLoading ? "Checking availability..." : "No available times for this date."}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => selectedTime && onReserve(selectedTime)}
                      disabled={!selectedTime}
                      className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-gold px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {selectedTime ? `Continue with ${shortTime(selectedTime)}` : "No times available"}
                      <CalendarDays className="size-4" />
                    </button>

                    <div className="mt-5 space-y-2 border-t border-border pt-4 text-xs text-text-secondary">
                      <p className="flex justify-between">
                        <span>Cancellation</span>
                        <span className="text-white">
                          {restaurantDetails?.cancellation_hours
                            ? `${restaurantDetails.cancellation_hours}h notice`
                            : "Set by restaurant"}
                        </span>
                      </p>
                      {restaurantDetails?.no_show_fee != null && (
                        <p className="flex justify-between">
                          <span>No-show fee</span>
                          <span className="text-white">{formatCurrency(restaurantDetails.no_show_fee, currencyCode)}</span>
                        </p>
                      )}
                    </div>

                    <p className="mt-5 flex gap-2 text-[11px] leading-relaxed text-text-muted">
                      <Info className="mt-0.5 size-3.5 shrink-0 text-gold" />
                      Availability is calculated from this restaurant's saved tables, reservations, and booking rules.
                    </p>
                  </div>

                  <div className="mt-3 rounded-2xl border border-border bg-bg-surface/70 p-4 text-xs text-text-secondary">
                    <p className="inline-flex items-center gap-2">
                      <Utensils className="size-3.5 text-gold" />
                      {restaurant.bookedToday} booking{restaurant.bookedToday === 1 ? "" : "s"} created today
                    </p>
                    <p className="mt-2 inline-flex items-center gap-2">
                      <MessageCircle className="size-3.5 text-gold" />
                      {restaurantDetails?.accepts_walkins === false ? "Reservations only" : "Walk-ins accepted when available"}
                    </p>
                    <p className="mt-2 inline-flex items-center gap-2">
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
