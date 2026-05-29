-- Block marking a reservation 'no_show' BEFORE its reserved time.
--
-- Why: a "no-show" means the party failed to turn up at the booked time.
-- That state is meaningless before the time has arrived — there is nothing
-- to "not show up" to yet. The prior window allowed no-show as early as
-- 1 hour before reserved_at (non-force) and arbitrarily early via the
-- owner/manager force path. That let staff put a still-future reservation
-- into a terminal status, which then surfaces to the diner as an
-- "Upcoming" booking they can't cancel (the cancel-reservation defensive
-- gate refuses terminal statuses). See CLAUDE.md #F13/#F14.
--
-- After this migration, for p_status = 'no_show':
--   * now() < reserved_at            → HARD BLOCK for everyone, even
--                                      owner/manager force. (new code P0022)
--   * reserved_at <= now() <= +24h   → allowed (non-force).
--   * now() > reserved_at + 24h      → outside_seating_window (P0020);
--                                      owner/manager may still force the
--                                      LATE side as before.
-- The force escape-hatch now only relaxes the late boundary; it can never
-- reach back before the reservation time. 'completed' / 'cancelled'
-- transitions and the seat RPC are unchanged.
--
-- Rebased verbatim from the deployed 20260528150000 body (soft idempotency
-- retained); only the p_status = 'no_show' branch changes.

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
    -- Hard rule for EVERYONE (incl. owner/manager force): you cannot mark a
    -- no-show before the reservation time has arrived.
    IF now() < v_reservation.reserved_at THEN
      RAISE EXCEPTION 'no_show_before_reservation'
        USING ERRCODE = 'P0022',
              DETAIL = format('reserved_at=%s, now=%s', v_reservation.reserved_at, now());
    END IF;

    IF p_force = false THEN
      -- Early side is already covered by the hard rule above; only the
      -- late (+24h) boundary remains for the normal window.
      IF v_reservation.reserved_at + interval '24 hours' < now() THEN
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
