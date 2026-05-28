-- 2026-05-28 Orphan split-tender sweep
--
-- Background: split-tender reservations are created in status='pending_payment'
-- with N `reservation_deposit_payments` rows in status='pending'. They only
-- flip to 'confirmed' (via the settle trigger) once every RDP row charges.
-- If the diner abandons checkout (closes the tab, Stripe errors, etc.) before
-- ANY RDP charges, the reservation sits in pending_payment forever, taking up
-- a slot on the floor without ever being a real booking.
--
-- This cron runs every 10 min and cancels reservations stuck in
-- pending_payment for > 30 min where ZERO RDP rows have charged. It is
-- intentionally a NARROW exception to the "never raw-UPDATE reservations.
-- status='cancelled' outside cancel-reservation" rule in CLAUDE.md:
--
--   * No money has moved (RDP charged_count = 0)
--   * The cancel-reservation refund pipeline therefore has nothing to do
--   * The diner never received a confirmation email (create-public-booking
--     skips the owner notification for split-tender; the diner-side
--     reservation_confirmation only fires AFTER charge in confirm-deposit-paid)
--   * So there's nothing for cancel-reservation to clean up beyond the
--     status flip itself, which this sweep does correctly
--
-- Once cancelled, the slot becomes available again via the existing
-- availability gates (they only consider non-cancelled non-no_show rows).
-- The pending RDP rows are left as-is for audit. They don't affect
-- anything because the reservation is no longer considered active.

CREATE OR REPLACE FUNCTION sweep_abandoned_split_tender_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cancelled_count integer := 0;
BEGIN
  WITH abandoned AS (
    SELECT r.id
    FROM reservations r
    WHERE r.status = 'pending_payment'
      AND r.created_at < (now() - interval '30 minutes')
      AND NOT EXISTS (
        SELECT 1 FROM reservation_deposit_payments rdp
        WHERE rdp.reservation_id = r.id
          AND rdp.status = 'charged'
      )
  )
  UPDATE reservations
     SET status = 'cancelled',
         cancelled_at = now(),
         cancellation_reason = 'auto_cancel_abandoned_split_tender'
   WHERE id IN (SELECT id FROM abandoned)
     AND status = 'pending_payment';

  GET DIAGNOSTICS v_cancelled_count = ROW_COUNT;
  RETURN v_cancelled_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION sweep_abandoned_split_tender_reservations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sweep_abandoned_split_tender_reservations() TO service_role;

-- Schedule every 10 min. Idempotent migration (drops existing of same name).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cenaiva_sweep_abandoned_split_tender') THEN
    PERFORM cron.unschedule('cenaiva_sweep_abandoned_split_tender');
  END IF;
END $$;

SELECT cron.schedule(
  'cenaiva_sweep_abandoned_split_tender',
  '*/10 * * * *',
  $$SELECT sweep_abandoned_split_tender_reservations()$$
);
