-- Phase 11: diner double-book prevention at the DB layer.
--
-- Up to now the only "you already have a reservation at this time" check
-- lived in the create-public-booking edge function. Anything that bypassed
-- the edge function (admin tools, AI flows, direct RPC calls) could create
-- two overlapping reservations for the same diner. This migration closes
-- that gap with three partial GiST exclusion constraints on `reservations`.
--
-- Identity dimensions:
--   1. user_profile_id           — logged-in diner
--   2. lower(guest_email)        — guest checkout, when no profile
--   3. digits-only guest_phone   — guest checkout, when no profile
--
-- Active statuses ('pending','confirmed','seated') are the only ones that
-- block; cancelled/completed/no_show don't count.
--
-- slot_range is maintained by a BEFORE INSERT/UPDATE trigger (not a STORED
-- generated column) because timestamptz + interval is STABLE, not IMMUTABLE,
-- which Postgres rejects for generated columns.
--
-- Pre-step: existing rows with active overlaps (test seed bookings
-- demonstrating the bug) are auto-cancelled with reason
-- 'auto_resolved_double_book_2026_05_08'. Loops to handle 3-way chains.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. Auto-resolve existing overlaps before adding the constraints.
DO $$
DECLARE
  v_round integer := 0;
  v_changed integer;
BEGIN
  LOOP
    v_round := v_round + 1;
    EXIT WHEN v_round > 10;

    WITH conflicts AS (
      SELECT b.id
      FROM public.reservations a
      JOIN public.reservations b
        ON a.user_profile_id IS NOT NULL
       AND a.user_profile_id = b.user_profile_id
       AND a.id <> b.id
       AND a.created_at <= b.created_at
       AND (a.created_at < b.created_at OR a.id < b.id)
       AND a.status IN ('pending','confirmed','seated')
       AND b.status IN ('pending','confirmed','seated')
       AND tstzrange(
             a.reserved_at,
             a.reserved_at + (COALESCE(NULLIF(a.duration_minutes, 0), 90) * interval '1 minute'),
             '[)'
           )
        && tstzrange(
             b.reserved_at,
             b.reserved_at + (COALESCE(NULLIF(b.duration_minutes, 0), 90) * interval '1 minute'),
             '[)'
           )
    )
    UPDATE public.reservations r
       SET status = 'cancelled',
           cancellation_reason = COALESCE(r.cancellation_reason, 'auto_resolved_double_book_2026_05_08'),
           cancelled_at = COALESCE(r.cancelled_at, now()),
           updated_at = now()
     WHERE r.id IN (SELECT id FROM conflicts);
    GET DIAGNOSTICS v_changed = ROW_COUNT;
    EXIT WHEN v_changed = 0;
  END LOOP;
END
$$;

UPDATE public.reservation_tables rt
   SET released_at = COALESCE(rt.released_at, now())
  FROM public.reservations r
 WHERE rt.reservation_id = r.id
   AND r.status = 'cancelled'
   AND r.cancellation_reason = 'auto_resolved_double_book_2026_05_08'
   AND rt.released_at IS NULL;

-- 2. slot_range column + maintenance trigger.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS slot_range tstzrange;

CREATE OR REPLACE FUNCTION public.reservations_set_slot_range()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.slot_range := tstzrange(
    NEW.reserved_at,
    NEW.reserved_at + (COALESCE(NULLIF(NEW.duration_minutes, 0), 90) * interval '1 minute'),
    '[)'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservations_set_slot_range_trg ON public.reservations;
CREATE TRIGGER reservations_set_slot_range_trg
  BEFORE INSERT OR UPDATE OF reserved_at, duration_minutes
  ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.reservations_set_slot_range();

UPDATE public.reservations
   SET slot_range = tstzrange(
         reserved_at,
         reserved_at + (COALESCE(NULLIF(duration_minutes, 0), 90) * interval '1 minute'),
         '[)'
       )
 WHERE slot_range IS NULL;

ALTER TABLE public.reservations
  ALTER COLUMN slot_range SET NOT NULL;

CREATE INDEX IF NOT EXISTS reservations_slot_range_active_gist
  ON public.reservations USING gist (slot_range)
  WHERE status IN ('pending','confirmed','seated');

-- 3. Three partial exclusion constraints.
ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_user_no_overlap;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_user_no_overlap
  EXCLUDE USING gist (user_profile_id WITH =, slot_range WITH &&)
  WHERE (
    user_profile_id IS NOT NULL
    AND status IN ('pending','confirmed','seated')
  );

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_guest_email_no_overlap;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_guest_email_no_overlap
  EXCLUDE USING gist ((lower(guest_email)) WITH =, slot_range WITH &&)
  WHERE (
    user_profile_id IS NULL
    AND guest_email IS NOT NULL
    AND status IN ('pending','confirmed','seated')
  );

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_guest_phone_no_overlap;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_guest_phone_no_overlap
  EXCLUDE USING gist ((regexp_replace(guest_phone, '\D', '', 'g')) WITH =, slot_range WITH &&)
  WHERE (
    user_profile_id IS NULL
    AND guest_phone IS NOT NULL
    AND status IN ('pending','confirmed','seated')
  );

COMMENT ON CONSTRAINT reservations_user_no_overlap ON public.reservations IS
  'Prevents the same logged-in diner from holding two overlapping active reservations across any restaurant.';
COMMENT ON CONSTRAINT reservations_guest_email_no_overlap ON public.reservations IS
  'Prevents guest-checkout double-booking on the same email across any restaurant.';
COMMENT ON CONSTRAINT reservations_guest_phone_no_overlap ON public.reservations IS
  'Prevents guest-checkout double-booking on the same phone across any restaurant.';
