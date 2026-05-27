-- 2026-05-27 — Time-window guard on Seated / No-show actions.
--
-- Today's deposit-policy audit revealed:
--   1. seat_staff_reservation has NO time-window check. Owner can mark
--      a reservation 'seated' weeks before or after the reserved_at —
--      no validation. Triggers an auto-refund of the deposit on the
--      restaurant's connected account, so a stale or premature click
--      is real money lost.
--   2. update_staff_reservation_status(_, 'no_show', _) has the same
--      gap. Owner could mark no-show days before the reservation even
--      happens and keep the deposit forever.
--
-- Fix: only allow these state transitions between (reserved_at - 1h)
-- and (reserved_at + 24h). Outside that window, the RPC rejects with
-- P0020 unless the caller is owner/manager AND explicitly passes
-- p_force = true. Force overrides are audit-logged for visibility.
--
-- NOT touched here:
--   - status='cancelled' transitions (cancel-reservation edge fn owns
--     its own policy)
--   - status='completed' transitions (the 5am-UTC cron uses them
--     legitimately past the window)
--   - the seat_force_override flow for 'arrived from no-show' undo
--     (markArrivedFromNoShow uses status='completed', not 'no_show')
--
-- Error codes (new):
--   P0020 outside_seating_window
--   P0021 force_requires_owner_or_manager
--
-- Window: 1 hour BEFORE reserved_at → 24 hours AFTER reserved_at.

BEGIN;

-- ── seat_staff_reservation: add p_force + window guard ──
CREATE OR REPLACE FUNCTION seat_staff_reservation(
  p_reservation_id uuid,
  p_table_id uuid,
  p_force boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation reservations%ROWTYPE;
  v_table "tables"%ROWTYPE;
  v_role text;
BEGIN
  SELECT * INTO v_reservation FROM reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.';
  END IF;

  v_role := require_staff_role(v_reservation.restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);

  -- Time-window guard: 1h before → 24h after reserved_at. Force path
  -- bypasses but requires owner/manager + logs an audit event.
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
      'reservation.seat_force_override',
      'reservation',
      p_reservation_id,
      to_jsonb(v_reservation),
      jsonb_build_object('table_id', p_table_id, 'role', v_role, 'now', now()),
      NULL
    );
  END IF;

  SELECT * INTO v_table
  FROM "tables"
  WHERE id = p_table_id
    AND restaurant_id = v_reservation.restaurant_id
    AND COALESCE(is_active, true);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Table not found.';
  END IF;
  IF COALESCE(v_table.status, 'empty') <> 'empty' THEN
    RAISE EXCEPTION 'Table is not available.';
  END IF;
  IF v_table.capacity < v_reservation.party_size THEN
    RAISE EXCEPTION 'Manager approval is required to seat above table capacity.';
  END IF;

  UPDATE reservations
  SET status = 'seated',
      table_id = p_table_id,
      checked_in_at = COALESCE(checked_in_at, now()),
      seated_at = now()
  WHERE id = p_reservation_id;

  PERFORM release_reservation_tables(p_reservation_id);

  INSERT INTO reservation_tables (restaurant_id, reservation_id, table_id, is_primary)
  VALUES (v_reservation.restaurant_id, p_reservation_id, p_table_id, true);

  PERFORM mark_reservation_tables_seated(p_reservation_id, v_reservation.party_size);

  PERFORM write_staff_audit_event(
    v_reservation.restaurant_id,
    'reservation.seat',
    'reservation',
    p_reservation_id,
    to_jsonb(v_reservation),
    jsonb_build_object('table_id', p_table_id, 'role', v_role, 'forced', p_force)
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION seat_staff_reservation(uuid, uuid, boolean)
  TO authenticated, service_role;

-- Drop the old 2-arg signature so callers don't accidentally hit it.
-- (Postgres keeps overloads alive otherwise.)
DROP FUNCTION IF EXISTS seat_staff_reservation(uuid, uuid);

-- ── update_staff_reservation_status: add p_force + window guard for no_show ──
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

  IF p_status = 'cancelled' AND v_role NOT IN ('owner', 'manager') THEN
    v_approval := consume_manager_approval(v_reservation.restaurant_id, 'reservation.cancel', p_approval_token);
  END IF;

  -- Time-window guard applies ONLY to no_show transitions:
  --   - completed: cron uses it legitimately past the window (5am UTC sweep)
  --   - cancelled: cancel-reservation edge fn owns its own policy
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

-- Drop the old 3-arg signature so callers don't accidentally hit it.
DROP FUNCTION IF EXISTS update_staff_reservation_status(uuid, text, text);

COMMIT;
