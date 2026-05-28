-- Soft idempotency for update_staff_reservation_status.
--
-- Before this migration: calling the RPC twice with the same target status
-- (e.g. double-click "Mark no-show" on the dashboard) re-stamped
-- no_show_at / completed_at / cancelled_at to the second call's `now()`
-- AND wrote a second staff_audit_events row, polluting the audit trail
-- and losing the original detection timestamp.
--
-- After: if the reservation is already in p_status, return true early
-- without touching the row or writing an audit event. The window guard
-- still runs first so a "force" attempt outside the window is still
-- rejected before any work happens (matching prior behavior).
--
-- This is "soft" because it only dedups the no-op case. Legitimate
-- transitions (confirmed → no_show, no_show → completed) still run
-- the full code path including audit.

BEGIN;

CREATE OR REPLACE FUNCTION update_staff_reservation_status(
  p_reservation_id uuid,
  p_status text,
  p_approval_token text DEFAULT NULL,
  p_force boolean DEFAULT false
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

  -- Soft idempotency: target status matches current. Return true without
  -- re-stamping timestamps or writing audit events. Authorisation +
  -- role check above still ran, so a non-staff caller still 403s.
  IF v_reservation.status = p_status THEN
    RETURN true;
  END IF;

  IF p_status = 'cancelled' AND v_role NOT IN ('owner', 'manager') THEN
    v_approval := consume_manager_approval(v_reservation.restaurant_id, 'reservation.cancel', p_approval_token);
  END IF;

  IF p_status = 'no_show' THEN
    IF p_force = false THEN
      IF v_reservation.reserved_at - interval '1 hour' > now()
         OR v_reservation.reserved_at + interval '24 hours' < now() THEN
        RAISE EXCEPTION 'outside_seating_window'
          USING ERRCODE = 'P0020',
                DETAIL = format('reserved_at=%s, now=%s', v_reservation.reserved_at, now());
      END IF;
    ELSE
      IF v_role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'force_requires_owner_or_manager'
          USING ERRCODE = 'P0021';
      END IF;
      PERFORM write_staff_audit_event(
        v_reservation.restaurant_id,
        'reservation.no_show_force_override',
        'reservation',
        p_reservation_id,
        to_jsonb(v_reservation),
        jsonb_build_object('role', v_role, 'now', now()),
        NULL
      );
    END IF;
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
    jsonb_build_object('status', p_status, 'role', v_role, 'forced', p_force),
    v_approval
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION update_staff_reservation_status(uuid, text, text, boolean)
  TO authenticated, service_role;

COMMIT;
