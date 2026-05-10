import { cn } from "@/lib/utils";
import { normalizeRestaurantPriceLevel, type RestaurantPriceLevel } from "@/lib/restaurant-price-level";

type RestaurantPriceMeterProps = {
  level: RestaurantPriceLevel | null | undefined;
  className?: string;
  activeClassName?: string;
  inactiveClassName?: string;
};

const PRICE_SLOTS: RestaurantPriceLevel[] = [1, 2, 3];

export function RestaurantPriceMeter({
  level,
  className,
  activeClassName,
  inactiveClassName,
}: RestaurantPriceMeterProps) {
  const normalizedLevel = normalizeRestaurantPriceLevel(level);
  // When the restaurant has no price_range set, render the meter as a
  // 3-slot placeholder (all outlined, none filled) instead of returning
  // null. The visible-but-empty state lets the UI element keep its
  // position in the metadata row and signals "price not set" without
  // inventing a value. Owners can populate price_range from the
  // dashboard to fill the meter.
  const filledCount = normalizedLevel ?? 0;

  return (
    <span className={cn("inline-flex items-center gap-0.5 font-semibold", className)}>
      {PRICE_SLOTS.map((slot) => (
        <span
          key={slot}
          className={cn(
            slot <= filledCount ? "text-gold" : "text-transparent [-webkit-text-stroke:1px_var(--text-muted)]",
            slot <= filledCount ? activeClassName : inactiveClassName,
          )}
        >
          $
        </span>
      ))}
    </span>
  );
}
