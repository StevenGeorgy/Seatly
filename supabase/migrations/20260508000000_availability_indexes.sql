-- Phase 3 (SPEED_PLAN.md): availability hot-path indexes.
--
-- Purpose: speed up the two predicates the get-availability edge function
-- runs on every preview-modal open and booking-page step:
--   1. reservations: WHERE restaurant_id = $1 AND status IN ('pending','confirmed','seated')
--                    AND reserved_at BETWEEN $2 AND $3
--   2. shifts:       WHERE restaurant_id = $1 AND is_active = true
--                    (then array contains check on days_of_week)
--
-- The partial index on reservations stays small as completed/cancelled rows
-- accumulate. The shifts index INCLUDE'd column allows index-only scans for
-- the days_of_week array filter that follows.

CREATE INDEX IF NOT EXISTS idx_reservations_availability
  ON public.reservations (restaurant_id, status, reserved_at)
  WHERE status IN ('pending', 'confirmed', 'seated');

CREATE INDEX IF NOT EXISTS idx_shifts_active_per_restaurant
  ON public.shifts (restaurant_id, is_active)
  INCLUDE (days_of_week);
