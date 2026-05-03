import { useEffect, useMemo, useState } from "react";
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
import type { EventPromotionDisplay } from "@/lib/customer/eventPromotionDisplay";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";

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

const FALLBACK_TIMES = ["5:30 PM", "6:45 PM", "7:15 PM", "7:45 PM", "8:30 PM", "9:00 PM"];

const MENU_HIGHLIGHTS = [
  {
    category: "Snacks & Bread",
    name: "Gougères",
    description: "Comté and black pepper, warm from the oven.",
    price: 11,
    badge: "Popular",
  },
  {
    category: "Snacks",
    name: "Oysters - half dozen",
    description: "Tonight's selection with champagne mignonette and lemon.",
    price: 24,
    badge: "Chef pick",
  },
  {
    category: "First Course",
    name: "Trout - cured 18 hours",
    description: "Citrus-cured trout, dill crème, garlic oil, sea salt.",
    price: 26,
    badge: "New",
  },
  {
    category: "Main Course",
    name: "Lamb shoulder",
    description: "Braised lamb, pomme purée, charred alliums.",
    price: 54,
    badge: "Limited",
  },
];

const MENU_SECTIONS = [
  {
    title: "Snacks & Bread",
    items: [
      { name: "House sourdough", description: "Cultured butter, smoked salt, chive oil.", price: 9 },
      { name: "Gougères", description: "Comté and black pepper, warm from the oven.", price: 11 },
    ],
  },
  {
    title: "First Course",
    items: [
      { name: "Celeriac velouté", description: "Hazelnut, brown butter, fine herbs.", price: 18 },
      { name: "Beef tartare", description: "Caperberry, egg yolk, grilled country bread.", price: 22 },
    ],
  },
  {
    title: "Main Course",
    items: [
      { name: "Duck with quince", description: "Dry-aged breast, quince jus, bitter greens.", price: 42 },
      { name: "Mushroom pithivier", description: "Wild mushroom, truffle cream, winter herbs.", price: 34 },
    ],
  },
];

const REVIEW_ROWS = [
  {
    name: "Julien R.",
    context: "Visited for Anniversary",
    text: "Service was extraordinary. Every course explained, every wine considered. The morels with petit pois were the dish of the year for us.",
  },
  {
    name: "Priya K.",
    context: "Date night",
    text: "Patio at dusk is unbeatable. Trout cured 18 hours was a quiet revelation.",
  },
  {
    name: "Marcus T.",
    context: "Late service",
    text: "Elegant room, generous pacing, and a staff that remembered our allergies without making a fuss.",
  },
];

const EVENT_ROWS = [
  {
    type: "Tasting Menu",
    spots: 4,
    title: "Spring Garden 7-Course Chef's Table",
    when: "Sat, May 4 at 6:30 PM",
    price: 120,
  },
  {
    type: "Wine Event",
    spots: 8,
    title: "Natural Wines of the Loire - Six Producers",
    when: "Wed, May 15 at 7:00 PM",
    price: 135,
  },
  {
    type: "Prix Fixe",
    spots: 12,
    title: "Late Service Three-Course Prix Fixe",
    when: "Thu-Sun after 9:00 PM",
    price: 58,
  },
];

function previewEventToDisplay(
  event: (typeof EVENT_ROWS)[number],
  restaurant: RestaurantPreviewSummary,
  currencyCode: string,
): EventPromotionDisplay {
  return {
    id: `${restaurant.id}-${event.title}`,
    source: "event",
    restaurantName: restaurant.name,
    restaurantSlug: null,
    cuisineLabel: restaurant.cuisine,
    cityLabel: restaurant.city,
    priceRangeLabel: restaurant.price,
    ratingLabel: `${restaurant.rating.toFixed(1)} stars`,
    title: event.title,
    description: "Hosted on-site with limited seats and a dedicated service experience.",
    badgeLabel: event.type,
    availabilityLabel: `${event.spots} left`,
    imageUrl: null,
    imageLabel: event.type,
    mediaUrl: null,
    mediaType: null,
    mediaName: null,
    dateLabel: event.when,
    timeLabel: "Select a reservation time",
    priceLabel: `${formatCurrency(event.price, currencyCode)} / person`,
    perCoverLabel: `${formatCurrency(event.price, currencyCode)} / person`,
    seatsLabel: `${event.spots} seats left`,
    actionLabel: "Book",
    promoCode: null,
    isActive: true,
  };
}

function shortTime(time: string): string {
  return time
    .replace(":00 PM", "p")
    .replace(":15 PM", ":15p")
    .replace(":30 PM", ":30p")
    .replace(":45 PM", ":45p");
}

function StripeArt({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("relative flex min-h-36 overflow-hidden rounded-xl bg-bg-elevated", className)}>
      <div className="absolute inset-0 opacity-80 [background-image:repeating-linear-gradient(135deg,var(--gold)_0_1px,transparent_1px_14px)]" />
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative m-auto size-9 rounded-full bg-gold/30 ring-4 ring-black/30" />
      <span className="absolute bottom-3 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70">
        {label}
      </span>
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
  const [tabState, setTabState] = useState<{ restaurantId: string | null; tab: PreviewTab }>({
    restaurantId: null,
    tab: "menu",
  });
  const [timeState, setTimeState] = useState<{ restaurantId: string | null; time: string }>({
    restaurantId: null,
    time: FALLBACK_TIMES[2],
  });

  const activeTab =
    restaurant && tabState.restaurantId === restaurant.id ? tabState.tab : "menu";
  const selectedTime =
    restaurant && timeState.restaurantId === restaurant.id
      ? timeState.time
      : restaurant?.slots[0] ?? FALLBACK_TIMES[2];

  const availableTimes = useMemo(() => {
    if (!restaurant || restaurant.slots.length === 0) return FALLBACK_TIMES;
    return Array.from(new Set([...restaurant.slots, ...FALLBACK_TIMES])).slice(0, 6);
  }, [restaurant]);

  const setRestaurantTab = (tab: PreviewTab) => {
    setTabState({ restaurantId: restaurant?.id ?? null, tab });
  };

  const setRestaurantTime = (time: string) => {
    setTimeState({ restaurantId: restaurant?.id ?? null, time });
  };

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
              <StripeArt label={restaurant.initials} className="absolute inset-0 rounded-none" />
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
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-md border border-gold/30 bg-gold/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-gold">
                        Tasting menu
                      </span>
                      {restaurant.features.slice(0, 2).map((feature) => (
                        <span
                          key={feature}
                          className="rounded-md border border-border bg-bg-elevated px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-text-secondary"
                        >
                          {feature}
                        </span>
                      ))}
                      <span className="rounded-md border border-success/30 bg-success/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-success">
                        Tables tonight
                      </span>
                    </div>
                    <h2 className="mt-3 font-serif text-4xl leading-none text-white sm:text-5xl">
                      {restaurant.name}
                    </h2>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
                      <span>{restaurant.cuisine}</span>
                      <span className="text-gold">{restaurant.price}</span>
                      <span className="inline-flex items-center gap-1">
                        <Star className="size-3 fill-gold text-gold" />
                        {restaurant.rating.toFixed(1)} · {restaurant.reviews.toLocaleString()} reviews
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3 text-text-muted" />
                        {restaurant.area}
                      </span>
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
                                Popular tonight
                              </p>
                              <h3 className="mt-1 font-serif text-2xl text-white">
                                Most-ordered this week
                              </h3>
                            </div>
                            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                              {MENU_HIGHLIGHTS.length} dishes
                            </p>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            {MENU_HIGHLIGHTS.map((item) => (
                              <article
                                key={item.name}
                                className="overflow-hidden rounded-xl border border-border bg-bg-elevated"
                              >
                                <StripeArt label={item.name.slice(0, 8)} className="min-h-28 rounded-none" />
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
                                    <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[10px] text-gold">
                                      {item.badge}
                                    </span>
                                  </div>
                                </div>
                              </article>
                            ))}
                          </div>
                        </section>

                        {MENU_SECTIONS.map((section) => (
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
                                <div key={item.name} className="flex gap-3 rounded-xl bg-bg-elevated p-3">
                                  <StripeArt
                                    label={item.name.slice(0, 3)}
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
                            <p className="text-xs text-text-muted">From recent service, updated weekly.</p>
                          </div>
                          <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                            <Camera className="size-3.5" /> 189 photos
                          </span>
                        </div>
                        <div className="grid h-[520px] grid-cols-2 gap-2 sm:grid-cols-3">
                          <StripeArt label="Plate of the day" className="col-span-2 row-span-2 min-h-0" />
                          <StripeArt label="Dining room" className="min-h-0" />
                          <StripeArt label="Trout lunch" className="min-h-0" />
                          <StripeArt label="Patio" className="min-h-0" />
                          <StripeArt label="Wine room" className="min-h-0" />
                        </div>
                      </section>
                    )}

                    {activeTab === "reviews" && (
                      <div className="space-y-4">
                        <section className="rounded-2xl border border-border bg-bg-surface p-4">
                          <div className="grid gap-5 sm:grid-cols-[160px_1fr_120px]">
                            <div>
                              <p className="font-serif text-5xl text-gold">{restaurant.rating.toFixed(1)}</p>
                              <Stars rating={restaurant.rating} />
                              <p className="mt-1 text-xs text-text-muted">
                                {restaurant.reviews.toLocaleString()} reviews
                              </p>
                            </div>
                            <div className="space-y-2">
                              {[5, 4, 3, 2, 1].map((score, index) => (
                                <div key={score} className="grid grid-cols-[16px_1fr_34px] items-center gap-3">
                                  <span className="text-xs text-text-muted">{score}</span>
                                  <div className="h-1.5 overflow-hidden rounded-full bg-bg-elevated">
                                    <div
                                      className="h-full rounded-full bg-gold"
                                      style={{ width: `${[82, 12, 4, 1, 1][index]}%` }}
                                    />
                                  </div>
                                  <span className="text-right text-[10px] text-text-muted">
                                    {[82, 12, 4, 1, 1][index]}%
                                  </span>
                                </div>
                              ))}
                            </div>
                            <div className="space-y-1 text-xs text-text-secondary">
                              <p>Food <span className="float-right text-gold">4.9</span></p>
                              <p>Service <span className="float-right text-gold">4.8</span></p>
                              <p>Ambience <span className="float-right text-gold">4.9</span></p>
                              <p>Value <span className="float-right text-gold">4.4</span></p>
                            </div>
                          </div>
                        </section>

                        {REVIEW_ROWS.map((review) => (
                          <article key={review.name} className="rounded-2xl border border-border bg-bg-surface p-4">
                            <div className="flex items-start gap-3">
                              <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-gold/10 font-mono text-[11px] text-gold">
                                {review.name.slice(0, 2).toUpperCase()}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="font-medium text-white">{review.name}</p>
                                    <p className="text-[11px] text-text-muted">{review.context}</p>
                                  </div>
                                  <Stars rating={5} />
                                </div>
                                <p className="mt-3 text-sm leading-relaxed text-text-secondary">{review.text}</p>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}

                    {activeTab === "about" && (
                      <div className="space-y-4">
                        <section className="rounded-2xl border border-border bg-bg-surface p-5">
                          <h3 className="font-serif text-2xl text-white">About {restaurant.name}</h3>
                          <p className="mt-3 text-sm leading-relaxed text-text-secondary">
                            A modern dining room in the heart of {restaurant.area}. The kitchen works around a
                            simple idea: careful technique, warm service, and a room that feels special without
                            feeling stiff. The menu changes with the market and keeps a few guest favourites
                            available every week.
                          </p>
                          <p className="mt-3 text-xs text-text-muted">
                            Open since 2019. Two AAA Diamonds. A Gold-tier Cenaiva partner.
                          </p>
                        </section>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <section className="rounded-2xl border border-border bg-bg-surface p-5">
                            <h4 className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
                              Hours
                            </h4>
                            <dl className="mt-4 space-y-2 text-xs text-text-secondary">
                              {[
                                ["Mon", "Closed"],
                                ["Tue", "5:30 - 10:00 PM"],
                                ["Wed", "5:30 - 10:00 PM"],
                                ["Thu", "5:30 - 11:00 PM"],
                                ["Fri", "5:30 - 11:00 PM"],
                                ["Sat", "5:00 - 11:00 PM"],
                                ["Sun", "5:00 - 9:30 PM"],
                              ].map(([day, hours]) => (
                                <div key={day} className="flex justify-between gap-4">
                                  <dt>{day}</dt>
                                  <dd className="text-white">{hours}</dd>
                                </div>
                              ))}
                            </dl>
                          </section>
                          <section className="rounded-2xl border border-border bg-bg-surface p-5">
                            <h4 className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
                              Details
                            </h4>
                            <div className="mt-4 space-y-2 text-xs text-text-secondary">
                              <p className="inline-flex items-center gap-2">
                                <MapPin className="size-3 text-gold" /> 116 {restaurant.area} Ave, {restaurant.city}
                              </p>
                              <p className="inline-flex items-center gap-2">
                                <Clock className="size-3 text-gold" /> {restaurant.distanceKm.toFixed(1)} km away
                              </p>
                              <p className="inline-flex items-center gap-2">
                                <Sparkles className="size-3 text-gold" /> Cenaiva accepted
                              </p>
                            </div>
                            <div className="mt-5 flex flex-wrap gap-2">
                              {["Patio", "Bar seating", "Private dining", "Late service"].map((tag) => (
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
                          Tasting menus, wine evenings, and chef's table experiences hosted on-site.
                        </p>
                        <div className="mt-4 grid gap-4">
                          {EVENT_ROWS.map((event) => (
                            <EventPromotionDetailCard
                              key={event.title}
                              item={previewEventToDisplay(event, restaurant, currencyCode)}
                              onReserve={() => onReserve(selectedTime)}
                              className="shadow-none"
                            />
                          ))}
                        </div>
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
                        <p className="mt-1 text-sm text-white">Sat · Apr 27</p>
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

                    <button
                      type="button"
                      onClick={() => onReserve(selectedTime)}
                      className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-gold px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90"
                    >
                      Continue with {shortTime(selectedTime)}
                      <CalendarDays className="size-4" />
                    </button>

                    <div className="mt-5 space-y-2 border-t border-border pt-4 text-xs text-text-secondary">
                      <p className="flex justify-between">
                        <span>Deposit (refundable)</span>
                        <span className="text-white">{formatCurrency(40, currencyCode)} / guest</span>
                      </p>
                      <p className="flex justify-between">
                        <span>Cancellation</span>
                        <span className="text-white">24h notice</span>
                      </p>
                      <p className="flex justify-between">
                        <span>Loyalty earned</span>
                        <span className="text-gold">+185 pts</span>
                      </p>
                    </div>

                    <p className="mt-5 flex gap-2 text-[11px] leading-relaxed text-text-muted">
                      <Info className="mt-0.5 size-3.5 shrink-0 text-gold" />
                      Your last visit was 6 weeks ago. The team remembers your nut allergy.
                    </p>
                  </div>

                  <div className="mt-3 rounded-2xl border border-border bg-bg-surface/70 p-4 text-xs text-text-secondary">
                    <p className="inline-flex items-center gap-2">
                      <Utensils className="size-3.5 text-gold" />
                      Booked {restaurant.bookedToday} times today
                    </p>
                    <p className="mt-2 inline-flex items-center gap-2">
                      <MessageCircle className="size-3.5 text-gold" />
                      Concierge notes available after booking
                    </p>
                    <p className="mt-2 inline-flex items-center gap-2">
                      <Users className="size-3.5 text-gold" />
                      Great for parties of 2-6
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
