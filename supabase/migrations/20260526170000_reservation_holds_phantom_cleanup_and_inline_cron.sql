-- Reservation holds: phantom cleanup + reliable inline-SQL expire cron.
--
-- BACKGROUND
-- ----------
-- The diner-double-book guard on `reservation_holds` uses a partial
-- exclusion constraint:
--   EXCLUDE USING gist (user_profile_id WITH =, slot_range WITH &&)
--     WHERE (user_profile_id IS NOT NULL AND status IN ('active','converting'))
-- The WHERE clause cannot reference now() (Postgres requires it to be
-- immutable), so rows whose expires_at has passed but whose status is
-- still 'active' continue to block legitimate new bookings ("phantom"
-- holds).
--
-- A cron `cenaiva_expire_reservation_holds` already exists (every 5
-- min) that calls the `expire-reservation-holds` edge function, but
-- that edge fn has been returning 401 on every call (CRON_SECRET
-- mismatch — env var was rotated without redeploying the fn). As a
-- result, phantoms have been accumulating.
--
-- This migration:
--   1. One-time cleanup: flips every existing clock-expired hold from
--      status='active' to 'expired'. Idempotent — safe to re-run.
--   2. Adds a NEW pg_cron job that runs inline SQL (no edge function,
--      no auth) every 5 minutes to keep status accurate going forward.
--      The 30-second grace tolerates clock skew between Postgres and
--      the heartbeat-reservation-hold edge fn. The existing broken
--      cron is left in place (it can be fixed separately by
--      redeploying the edge fn with the current CRON_SECRET); the new
--      cron is additive and idempotent — running both is fine.
--
-- Why inline SQL instead of fixing the edge fn?
--   - Removes the auth dependency entirely (no env-var sync required)
--   - Database can never observe a phantom because the flip happens
--     within the same Postgres instance
--   - Simpler operational story: one SQL line, no edge-fn deploy
--
-- See RESERVATION_HOLDS_AUDIT.md for the full investigation notes.

BEGIN;

-- ── Layer 1: one-time cleanup of existing phantoms ──
UPDATE public.reservation_holds
SET status = 'expired'
WHERE status = 'active'
  AND expires_at < now();

-- ── Layer 2: new inline-SQL cron job ──
-- Drop first so this migration is idempotent on re-apply.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'cenaiva_expire_holds_inline'
  ) THEN
    PERFORM cron.unschedule('cenaiva_expire_holds_inline');
  END IF;
END;
$$;

SELECT cron.schedule(
  'cenaiva_expire_holds_inline',
  '*/5 * * * *',
  $cron$
    UPDATE public.reservation_holds
    SET status = 'expired'
    WHERE status = 'active'
      AND expires_at < now() - interval '30 seconds'
  $cron$
);

COMMIT;
