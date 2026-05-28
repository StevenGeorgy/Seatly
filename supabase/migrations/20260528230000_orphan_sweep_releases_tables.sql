-- 2026-05-28 — sweep_abandoned_split_tender_reservations: also release tables
--
-- Original migration 20260528200000 introduced the orphan sweep but used a
-- raw UPDATE on reservations.status without calling
-- release_reservation_tables(). Result: cancelled-by-sweep reservations
-- still had their reservation_tables rows with released_at=NULL, which
-- means the reservation_tables_no_overlap exclusion constraint still
-- considered those tables booked. The next diner trying to book the same
-- slot would get a 23P01 exclusion_violation -> diner_double_book error
-- because the table was perceived as still in use.
--
-- Fix: rewrite the sweep to call release_reservation_tables(id) for each
-- swept reservation. Mirrors what update_staff_reservation_status does
-- when it flips a row to 'cancelled'.

CREATE OR REPLACE FUNCTION sweep_abandoned_split_tender_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cancelled_count integer := 0;
  v_id uuid;
BEGIN
  FOR v_id IN
    SELECT r.id
    FROM reservations r
    WHERE r.status = 'pending_payment'
      AND r.created_at < (now() - interval '30 minutes')
      AND NOT EXISTS (
        SELECT 1 FROM reservation_deposit_payments rdp
        WHERE rdp.reservation_id = r.id
          AND rdp.status = 'charged'
      )
  LOOP
    UPDATE reservations
       SET status = 'cancelled',
           cancelled_at = now(),
           cancellation_reason = 'auto_cancel_abandoned_split_tender'
     WHERE id = v_id
       AND status = 'pending_payment';
    IF FOUND THEN
      v_cancelled_count := v_cancelled_count + 1;
      PERFORM release_reservation_tables(v_id);
    END IF;
  END LOOP;

  RETURN v_cancelled_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION sweep_abandoned_split_tender_reservations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sweep_abandoned_split_tender_reservations() TO service_role;
