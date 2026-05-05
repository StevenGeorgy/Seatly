import type { EventRow, EventWithRestaurant } from "@/hooks/useEvents";
import {
  getPromotionLabel,
  type PromotionRow,
  type PromotionWithRestaurant,
} from "@/hooks/usePromotions";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatCompactTimeLabel } from "@/lib/utils/time";

export type EventPromotionSource = "event" | "promotion";

export type RestaurantDisplayInfo = {
  name: string;
  slug?: string | null;
  cuisine_type?: string | null;
  avg_rating?: number | null;
  cover_photo_url?: string | null;
  city?: string | null;
  price_range?: number | null;
};

export type EventPromotionDisplay = {
  id: string;
  source: EventPromotionSource;
  restaurantName: string;
  restaurantSlug: string | null;
  cuisineLabel: string;
  cityLabel: string;
  priceRangeLabel: string;
  ratingLabel: string;
  title: string;
  description: string | null;
  badgeLabel: string;
  availabilityLabel: string;
  imageUrl: string | null;
  imageLabel: string;
  mediaUrl: string | null;
  mediaType: "image" | "pdf" | null;
  mediaName: string | null;
  dateLabel: string;
  timeLabel: string;
  priceLabel: string;
  perCoverLabel: string | null;
  seatsLabel: string | null;
  actionLabel: string;
  promoCode: string | null;
  isActive: boolean;
};

function formatDate(date: string | null | undefined): string {
  if (!date) return "Date to be announced";
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "Date to be announced";
  return parsed.toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatDateRange(start: string, end: string | null | undefined): string {
  const startLabel = formatDate(start);
  if (!end || end === start) return startLabel;
  return `${startLabel} - ${formatDate(end)}`;
}

function formatTime(time: string | null | undefined): string {
  if (!time) return "";
  const [hourPart, minutePart] = time.split(":");
  const hour = Number(hourPart);
  const minute = Number(minutePart ?? 0);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;

  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return formatCompactTimeLabel(date);
}

function formatTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  const startLabel = formatTime(start);
  const endLabel = formatTime(end);
  if (startLabel && endLabel) return `${startLabel} - ${endLabel}`;
  if (startLabel) return startLabel;
  if (endLabel) return `Until ${endLabel}`;
  return "Time to be announced";
}

function priceRangeLabel(priceRange: number | null | undefined): string {
  if (!priceRange || priceRange < 1) return "$$";
  return "$".repeat(Math.min(Math.round(priceRange), 4));
}

function imageLabelFromTitle(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .join(" ")
    .toUpperCase();
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatPromotionRecurrence(promotion: PromotionRow | PromotionWithRestaurant): string | null {
  if (!promotion.is_recurring || !promotion.recurrence_frequency) return null;
  const interval = Math.max(promotion.recurrence_interval || 1, 1);
  let summary = "";

  if (promotion.recurrence_frequency === "weekly") {
    const days = promotion.recurrence_days
      .slice()
      .sort((a, b) => a - b)
      .map((day) => WEEKDAY_LABELS[day])
      .filter(Boolean)
      .join(", ");
    summary = interval === 1
      ? `Repeats every ${days || "week"}`
      : `Repeats every ${interval} weeks${days ? ` on ${days}` : ""}`;
  } else {
    const unit = promotion.recurrence_frequency === "daily" ? "day" : "month";
    summary = interval === 1 ? `Repeats every ${unit}` : `Repeats every ${interval} ${unit}s`;
  }

  if (!promotion.recurrence_end_at) return summary;
  return `${summary} until ${formatDate(promotion.recurrence_end_at.slice(0, 10))}`;
}

function eventRestaurant(event: EventRow | EventWithRestaurant, fallback?: RestaurantDisplayInfo): RestaurantDisplayInfo {
  if ("restaurants" in event && event.restaurants) return event.restaurants;
  if (fallback) return fallback;
  throw new Error("Event is missing restaurant data.");
}

function promotionRestaurant(
  promotion: PromotionRow | PromotionWithRestaurant,
  fallback?: RestaurantDisplayInfo,
): RestaurantDisplayInfo {
  if ("restaurants" in promotion && promotion.restaurants) return promotion.restaurants;
  if (fallback) return fallback;
  throw new Error("Promotion is missing restaurant data.");
}

export function eventToDisplay(
  event: EventRow | EventWithRestaurant,
  restaurantFallback?: RestaurantDisplayInfo,
): EventPromotionDisplay {
  const restaurant = eventRestaurant(event, restaurantFallback);
  const seatsLeft =
    event.capacity == null ? null : Math.max(event.capacity - event.tickets_sold, 0);
  const priceLabel =
    event.price_per_person == null
      ? "Price to be announced"
      : `${formatCurrency(event.price_per_person, "cad")} / person`;

  return {
    id: event.id,
    source: "event",
    restaurantName: restaurant.name,
    restaurantSlug: restaurant.slug ?? null,
    cuisineLabel: restaurant.cuisine_type ?? "Restaurant",
    cityLabel: restaurant.city ?? "Toronto",
    priceRangeLabel: priceRangeLabel(restaurant.price_range),
    ratingLabel:
      restaurant.avg_rating == null ? "New" : `${restaurant.avg_rating.toFixed(1)} stars`,
    title: event.name,
    description: event.description,
    badgeLabel: event.theme ?? "Event",
    availabilityLabel: seatsLeft == null ? "Seats available" : `${seatsLeft} left`,
    imageUrl: event.media_type === "image" ? event.media_url : event.cover_image_url,
    imageLabel: imageLabelFromTitle(event.theme ?? event.name),
    mediaUrl: event.media_url,
    mediaType: event.media_type,
    mediaName: event.media_name,
    dateLabel: formatDateRange(event.date, event.end_date),
    timeLabel: formatTimeRange(event.start_time, event.end_time),
    priceLabel,
    perCoverLabel: event.price_per_person == null ? null : priceLabel,
    seatsLabel: event.capacity == null ? null : `${seatsLeft ?? 0} of ${event.capacity} seats left`,
    actionLabel: "Book",
    promoCode: null,
    isActive: event.is_active,
  };
}

export function promotionToDisplay(
  promotion: PromotionRow | PromotionWithRestaurant,
  restaurantFallback?: RestaurantDisplayInfo,
): EventPromotionDisplay {
  const restaurant = promotionRestaurant(promotion, restaurantFallback);
  const remaining =
    promotion.max_uses == null
      ? null
      : Math.max(promotion.max_uses - promotion.current_uses, 0);
  const starts = promotion.starts_at.slice(0, 10);
  const ends = promotion.ends_at?.slice(0, 10) ?? null;
  const promotionLabel = getPromotionLabel(promotion);
  const priceLabel = promotion.promo_type === "free_item"
    ? `${promotion.free_item_name ? `Free ${promotion.free_item_name}` : "Free item"}${promotion.eligible_item_ids.length > 0 ? " with qualifying order" : ""}`
    : promotionLabel;
  const imageUrl = promotion.media_type === "image"
    ? promotion.media_url
    : promotion.cover_image_url ?? restaurant.cover_photo_url ?? null;

  return {
    id: promotion.id,
    source: "promotion",
    restaurantName: restaurant.name,
    restaurantSlug: restaurant.slug ?? null,
    cuisineLabel: restaurant.cuisine_type ?? "Restaurant",
    cityLabel: restaurant.city ?? "Toronto",
    priceRangeLabel: priceRangeLabel(restaurant.price_range),
    ratingLabel:
      restaurant.avg_rating == null ? "New" : `${restaurant.avg_rating.toFixed(1)} stars`,
    title: promotion.title,
    description: promotion.description,
    badgeLabel: promotionLabel,
    availabilityLabel: remaining == null ? "Limited time" : `${remaining} left`,
    imageUrl,
    imageLabel: imageLabelFromTitle(promotion.title),
    mediaUrl: promotion.media_url,
    mediaType: promotion.media_type,
    mediaName: promotion.media_name,
    dateLabel: formatPromotionRecurrence(promotion) ?? formatDateRange(starts, ends),
    timeLabel: promotion.is_recurring ? "Available on recurring service days" : "Available during service",
    priceLabel,
    perCoverLabel: null,
    seatsLabel: remaining == null ? null : `${remaining} redemptions left`,
    actionLabel: "Book",
    promoCode: promotion.promo_code,
    isActive: promotion.is_active,
  };
}
