-- Phase A (CONCURRENCY_PLAN.md): denormalize the reservation's [reserved_at,
-- reserved_at + duration_minutes) range onto reservation_tables so a single-
-- column GiST exclusion constraint can be defined in Phase B.
--
-- The column is kept in sync by two triggers:
--   1. BEFORE INSERT/UPDATE on reservation_tables — populates slot_range from
--      the parent reservation when a row is written.
--   2. AFTER UPDATE OF reserved_at/duration_minutes on reservations —
--      propagates changes down to all non-released child rows.
--
-- Backfill runs once for existing rows, then NOT NULL is enforced.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.reservation_tables
  ADD COLUMN IF NOT EXISTS slot_range tstzrange;

-- BEFORE INSERT/UPDATE: populate slot_range from parent reservation.
CREATE OR REPLACE FUNCTION public.reservation_tables_set_slot_range()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reserved_at timestamptz;
  v_duration_minutes integer;
  v_turn_minutes integer;
BEGIN
  SELECT reserved_at, duration_minutes
  INTO v_reserved_at, v_duration_minutes
  FROM public.reservations
  WHERE id = NEW.reservation_id;

  IF v_reserved_at IS NULL THEN
    RAISE EXCEPTION 'reservation_tables.reservation_id % does not exist', NEW.reservation_id;
  END IF;

  IF v_duration_minutes IS NULL OR v_duration_minutes <= 0 THEN
    v_turn_minutes := COALESCE(public.restaurant_turn_time_minutes(NEW.restaurant_id), 90);
  ELSE
    v_turn_minutes := v_duration_minutes;
  END IF;

  NEW.slot_range := tstzrange(
    v_reserved_at,
    v_reserved_at + make_interval(mins => v_turn_minutes),
    '[)'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservation_tables_set_slot_range ON public.reservation_tables;
CREATE TRIGGER reservation_tables_set_slot_range
  BEFORE INSERT OR UPDATE OF reservation_id ON public.reservation_tables
  FOR EACH ROW
  EXECUTE FUNCTION public.reservation_tables_set_slot_range();

-- AFTER UPDATE on reservations: propagate window changes to child rows.
CREATE OR REPLACE FUNCTION public.reservations_propagate_slot_range()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_turn_minutes integer;
BEGIN
  IF NEW.reserved_at IS DISTINCT FROM OLD.reserved_at
     OR COALESCE(NEW.duration_minutes, -1) IS DISTINCT FROM COALESCE(OLD.duration_minutes, -1)
  THEN
    IF NEW.duration_minutes IS NULL OR NEW.duration_minutes <= 0 THEN
      v_turn_minutes := COALESCE(public.restaurant_turn_time_minutes(NEW.restaurant_id), 90);
    ELSE
      v_turn_minutes := NEW.duration_minutes;
    END IF;

    UPDATE public.reservation_tables
    SET slot_range = tstzrange(
          NEW.reserved_at,
          NEW.reserved_at + make_interval(mins => v_turn_minutes),
          '[)'
        )
    WHERE reservation_id = NEW.id
      AND released_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservations_propagate_slot_range ON public.reservations;
CREATE TRIGGER reservations_propagate_slot_range
  AFTER UPDATE OF reserved_at, duration_minutes ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.reservations_propagate_slot_range();

-- Backfill existing rows. Uses the parent reservation's window directly,
-- falling back to 90 minutes if duration_minutes is missing — same default
-- the application uses.
UPDATE public.reservation_tables rt
SET slot_range = tstzrange(
      r.reserved_at,
      r.reserved_at + make_interval(mins => COALESCE(NULLIF(r.duration_minutes, 0), 90)),
      '[)'
    )
FROM public.reservations r
WHERE rt.reservation_id = r.id
  AND rt.slot_range IS NULL;

-- Enforce NOT NULL only after backfill is complete.
ALTER TABLE public.reservation_tables
  ALTER COLUMN slot_range SET NOT NULL;
