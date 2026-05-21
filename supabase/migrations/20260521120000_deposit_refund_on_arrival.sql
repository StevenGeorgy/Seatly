-- 2026-05-21 — Deposit refund on arrival
--
-- Supports the "Seated / No-show / auto-assume" deposit flow:
--   1. Add `no_show_at timestamptz` to reservations (parity with
--      seated_at, cancelled_at, completed_at, confirmed_at, checked_in_at).
--   2. Patch `update_staff_reservation_status` so transitioning to
--      `no_show` stamps `no_show_at = now()`. Keeps all existing
--      shape (auth via require_staff_role, manager-approval branch for
--      cancel, audit-event call, table-release call).
--   3. Schedule daily 5 AM UTC cron `cenaiva_auto_complete_stale_reservations`
--      that dispatches the `auto-complete-stale-reservations` edge fn
--      via the existing `cenaiva_call_cron_function` pattern.
--
-- Idempotent: safe to re-run.

-- 1. Add no_show_at column
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS no_show_at timestamptz;

-- 2. Patch update_staff_reservation_status to also stamp no_show_at
CREATE OR REPLACE FUNCTION update_staff_reservation_status(
  p_reservation_id uuid,
  p_status text,
  p_approval_token text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation reservations%ROWTYPE;
  v_role text;
  v_action text;
  v_approval uuid;
BEGIN
  SELECT * INTO v_reservation FROM reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.';
  END IF;

  v_role := require_staff_role(v_reservation.restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);
  v_action := 'reservation.' || p_status;

  IF p_status NOT IN ('completed', 'cancelled', 'no_show') THEN
    RAISE EXCEPTION 'Unsupported reservation status.';
  END IF;

  IF p_status = 'cancelled' AND v_role NOT IN ('owner', 'manager') THEN
    v_approval := consume_manager_approval(v_reservation.restaurant_id, 'reservation.cancel', p_approval_token);
  END IF;

  UPDATE reservations
  SET status = p_status,
      completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE completed_at END,
      cancelled_at = CASE WHEN p_status = 'cancelled' THEN now() ELSE cancelled_at END,
      no_show_at   = CASE WHEN p_status = 'no_show'   THEN now() ELSE no_show_at   END
  WHERE id = p_reservation_id;

  IF p_status IN ('completed', 'cancelled', 'no_show') THEN
    PERFORM release_reservation_tables(p_reservation_id);
  END IF;

  PERFORM write_staff_audit_event(
    v_reservation.restaurant_id,
    v_action,
    'reservation',
    p_reservation_id,
    to_jsonb(v_reservation),
    jsonb_build_object('status', p_status, 'role', v_role),
    v_approval
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION update_staff_reservation_status(uuid, text, text)
  TO authenticated, service_role;

-- 3. Schedule daily 5 AM UTC sweep for stale (past-end, not-terminal) reservations.
--    Idempotent: unschedule first inside an exception-tolerant block (no-op
--    when the job doesn't exist yet), then schedule.
DO $$
BEGIN
  PERFORM cron.unschedule('cenaiva_auto_complete_stale_reservations');
EXCEPTION WHEN OTHERS THEN
  -- Job did not exist; ignore.
  NULL;
END;
$$;

SELECT cron.schedule(
  'cenaiva_auto_complete_stale_reservations',
  '0 5 * * *',
  $$SELECT cenaiva_call_cron_function('auto-complete-stale-reservations')$$
);
