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

  return (
    <span className={cn("inline-flex items-center gap-0.5 font-semibold", className)}>
      {PRICE_SLOTS.map((slot) => (
        <span
          key={slot}
          className={cn(
            slot <= (normalizedLevel ?? 0) ? "text-gold" : "text-text-muted",
            slot <= (normalizedLevel ?? 0) ? activeClassName : inactiveClassName,
          )}
        >
          $
        </span>
      ))}
    </span>
  );
}
