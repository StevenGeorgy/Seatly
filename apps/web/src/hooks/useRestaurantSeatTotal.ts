import { useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * Sums `tables.capacity` for all active tables at the restaurant — i.e. the
 * absolute physical-seat ceiling. Used by the dashboard to show "Your
 * restaurant's total seat capacity: N" so owners know what `shifts.max_covers`
 * COULD safely be raised to if they want whole-restaurant bookings, and as the
 * upper bound for deposit-policy thresholds (Phase 3).
 *
 * Returns `null` while loading or when no rows exist; never throws.
 */
export function useRestaurantSeatTotal(restaurantId: string | null | undefined): number | null {
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Reset on input change. The downstream fetch resolves async so this
    // brief null is the loading state for consumers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTotal(null);
    if (!restaurantId || !isSupabaseConfigured()) return;

    const client = getSupabaseBrowserClient();
    void client
      .from("tables")
      .select("capacity")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !Array.isArray(data)) {
          setTotal(0);
          return;
        }
        const sum = data.reduce((acc, row) => {
          const cap = (row as { capacity?: number | null }).capacity;
          return acc + (typeof cap === "number" ? cap : 0);
        }, 0);
        setTotal(sum);
      });

    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  return total;
}
