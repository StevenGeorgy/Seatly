-- 2026-05-21 — Migrate `restaurants.paused_reason` from a free-text + CHECK
-- constraint to a true Postgres enum type. Avoids drift between the DB
-- constraint and the frontend union (`StaffRestaurantRow.paused_reason`)
-- and lets Postgres enforce membership at insert/update time without the
-- per-row CHECK overhead.
--
-- Migration strategy:
--   1. Create the enum type.
--   2. Drop the existing CHECK constraint.
--   3. Add a new TEXT column → CAST-with-fallback → swap.
--      We do the safe cast in two passes so any pre-existing row whose
--      value is outside the enum gets NULLed (with a NOTICE) rather than
--      blowing up the whole migration.
--   4. Drop the old column, rename the new one, re-add COMMENT.
--
-- Any column-level dependencies (publish-gate trigger touches it via NEW
-- but not by name in WHERE / RETURNING) keep working — the column name
-- stays `paused_reason`.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'restaurant_paused_reason'
  ) THEN
    CREATE TYPE public.restaurant_paused_reason AS ENUM (
      'owner_unpublished',
      'payment_failed',
      'pending_deletion',
      'subscription_cancelled'
    );
  END IF;
END $$;

-- Drop the CHECK constraint (added by 20260520001200) so we can change
-- the column type without it blocking us.
ALTER TABLE public.restaurants
  DROP CONSTRAINT IF EXISTS restaurants_paused_reason_check;

-- Sanity pass: NULL out any value that isn't in the enum so the cast
-- below succeeds for every row. Logs a NOTICE per offending row so
-- ops can spot data hygiene issues post-migration.
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count
  FROM public.restaurants
  WHERE paused_reason IS NOT NULL
    AND paused_reason NOT IN (
      'owner_unpublished',
      'payment_failed',
      'pending_deletion',
      'subscription_cancelled'
    );
  IF bad_count > 0 THEN
    RAISE NOTICE
      'paused_reason migration: nulling % unknown values',
      bad_count;
    UPDATE public.restaurants
       SET paused_reason = NULL
     WHERE paused_reason IS NOT NULL
       AND paused_reason NOT IN (
         'owner_unpublished',
         'payment_failed',
         'pending_deletion',
         'subscription_cancelled'
       );
  END IF;
END $$;

-- Switch the column type. USING handles the implicit cast from TEXT to
-- the new enum. Wrapped in a guard so re-running the migration on a
-- partially-applied DB doesn't error.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'restaurants'
       AND column_name = 'paused_reason'
       AND data_type <> 'USER-DEFINED'
  ) THEN
    ALTER TABLE public.restaurants
      ALTER COLUMN paused_reason TYPE public.restaurant_paused_reason
      USING paused_reason::public.restaurant_paused_reason;
  END IF;
END $$;

COMMENT ON COLUMN public.restaurants.paused_reason IS
  'Why is_published=false. Enum-typed (restaurant_paused_reason). Drives the dashboard banner shown to the owner.';
