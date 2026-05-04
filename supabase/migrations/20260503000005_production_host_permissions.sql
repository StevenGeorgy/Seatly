-- Production host permissions: audit logs, manager approvals, and guarded
-- reservation operations. Staff identity is user_restaurant_roles, not
-- user_profiles.role.

ALTER TABLE staff_invitations DROP CONSTRAINT IF EXISTS staff_invitations_status_check;
ALTER TABLE staff_invitations
  ADD CONSTRAINT staff_invitations_status_check
  CHECK (status IN ('pending', 'accepted', 'cancelled', 'declined', 'expired'));

CREATE TABLE IF NOT EXISTS staff_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  actor_profile_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  actor_role text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_profile_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE staff_audit_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_staff_audit_events_restaurant_created
  ON staff_audit_events(restaurant_id, created_at DESC);

DROP POLICY IF EXISTS staff_audit_events_select_owner_manager ON staff_audit_events;
CREATE POLICY staff_audit_events_select_owner_manager
  ON staff_audit_events FOR SELECT
  TO authenticated
  USING (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager']));

CREATE TABLE IF NOT EXISTS manager_action_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  action text NOT NULL,
  requested_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  approved_by uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  used_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE manager_action_approvals ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_manager_action_approvals_token
  ON manager_action_approvals(token);

DROP POLICY IF EXISTS manager_action_approvals_select_owner_manager ON manager_action_approvals;
CREATE POLICY manager_action_approvals_select_owner_manager
  ON manager_action_approvals FOR SELECT
  TO authenticated
  USING (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager']));

CREATE OR REPLACE FUNCTION current_profile_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id FROM user_profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION current_staff_role(p_restaurant_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT urr.role
  FROM user_restaurant_roles urr
  LEFT JOIN user_profiles up ON up.id = urr.user_id
  WHERE urr.restaurant_id = p_restaurant_id
    AND (urr.user_id = auth.uid() OR up.auth_user_id = auth.uid())
  ORDER BY CASE urr.role
    WHEN 'owner' THEN 1
    WHEN 'manager' THEN 2
    WHEN 'server' THEN 3
    WHEN 'host' THEN 4
    WHEN 'staff' THEN 5
    ELSE 9
  END
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION require_staff_role(
  p_restaurant_id uuid,
  p_roles text[]
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := current_staff_role(p_restaurant_id);
  IF v_role IS NULL OR NOT (v_role = ANY(p_roles)) THEN
    RAISE EXCEPTION 'Not allowed for this restaurant.';
  END IF;
  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION write_staff_audit_event(
  p_restaurant_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before_json jsonb DEFAULT '{}'::jsonb,
  p_after_json jsonb DEFAULT '{}'::jsonb,
  p_approval_profile_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO staff_audit_events (
    restaurant_id,
    actor_profile_id,
    actor_role,
    action,
    entity_type,
    entity_id,
    before_json,
    after_json,
    approval_profile_id
  )
  VALUES (
    p_restaurant_id,
    current_profile_id(),
    current_staff_role(p_restaurant_id),
    p_action,
    p_entity_type,
    p_entity_id,
    COALESCE(p_before_json, '{}'::jsonb),
    COALESCE(p_after_json, '{}'::jsonb),
    p_approval_profile_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION consume_manager_approval(
  p_restaurant_id uuid,
  p_action text,
  p_token text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approval manager_action_approvals%ROWTYPE;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION 'Manager approval is required.';
  END IF;

  SELECT *
  INTO v_approval
  FROM manager_action_approvals
  WHERE token = p_token
    AND restaurant_id = p_restaurant_id
    AND action = p_action
    AND used_at IS NULL
    AND expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manager approval is invalid or expired.';
  END IF;

  UPDATE manager_action_approvals
  SET used_at = now()
  WHERE id = v_approval.id;

  RETURN v_approval.approved_by;
END;
$$;

DROP POLICY IF EXISTS guests_select_staff ON guests;
DROP POLICY IF EXISTS guests_insert_owner ON guests;
DROP POLICY IF EXISTS guests_update_owner ON guests;
DROP POLICY IF EXISTS guests_select_staff_roles ON guests;
DROP POLICY IF EXISTS guests_insert_staff_roles ON guests;
DROP POLICY IF EXISTS guests_update_staff_roles ON guests;

CREATE POLICY guests_select_staff_roles
  ON guests FOR SELECT
  TO authenticated
  USING (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']));

CREATE POLICY guests_insert_staff_roles
  ON guests FOR INSERT
  TO authenticated
  WITH CHECK (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']));

CREATE POLICY guests_update_staff_roles
  ON guests FOR UPDATE
  TO authenticated
  USING (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']))
  WITH CHECK (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']));

DROP POLICY IF EXISTS reservations_select_staff ON reservations;
DROP POLICY IF EXISTS reservations_insert_staff ON reservations;
DROP POLICY IF EXISTS reservations_update_staff ON reservations;
DROP POLICY IF EXISTS reservations_select_staff_roles ON reservations;
DROP POLICY IF EXISTS reservations_insert_staff_roles ON reservations;
DROP POLICY IF EXISTS reservations_update_staff_roles ON reservations;

CREATE POLICY reservations_select_staff_roles
  ON reservations FOR SELECT
  TO authenticated
  USING (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']));

CREATE POLICY reservations_insert_staff_roles
  ON reservations FOR INSERT
  TO authenticated
  WITH CHECK (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']));

CREATE POLICY reservations_update_staff_roles
  ON reservations FOR UPDATE
  TO authenticated
  USING (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']))
  WITH CHECK (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']));

CREATE OR REPLACE FUNCTION create_staff_reservation(
  p_restaurant_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_party_size integer,
  p_reserved_at timestamptz,
  p_special_request text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_guest_id uuid;
  v_reservation_id uuid;
  v_table_ids uuid[];
BEGIN
  v_role := require_staff_role(p_restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);

  IF p_party_size IS NULL OR p_party_size < 1 THEN
    RAISE EXCEPTION 'Party size must be at least 1.';
  END IF;

  SELECT id INTO v_guest_id
  FROM guests
  WHERE restaurant_id = p_restaurant_id
    AND (
      (p_guest_phone IS NOT NULL AND btrim(p_guest_phone) <> '' AND phone = p_guest_phone)
      OR (p_guest_email IS NOT NULL AND btrim(p_guest_email) <> '' AND lower(email) = lower(p_guest_email))
    )
  LIMIT 1;

  IF v_guest_id IS NULL THEN
    INSERT INTO guests (restaurant_id, full_name, phone, email)
    VALUES (
      p_restaurant_id,
      NULLIF(btrim(COALESCE(p_guest_name, '')), ''),
      NULLIF(btrim(COALESCE(p_guest_phone, '')), ''),
      NULLIF(btrim(COALESCE(p_guest_email, '')), '')
    )
    RETURNING id INTO v_guest_id;
  END IF;

  INSERT INTO reservations (
    restaurant_id,
    guest_id,
    guest_full_name,
    guest_email,
    guest_phone,
    party_size,
    reserved_at,
    special_request,
    status,
    confirmation_code,
    source,
    is_guest_checkout
  )
  VALUES (
    p_restaurant_id,
    v_guest_id,
    NULLIF(btrim(COALESCE(p_guest_name, '')), ''),
    NULLIF(btrim(COALESCE(p_guest_email, '')), ''),
    NULLIF(btrim(COALESCE(p_guest_phone, '')), ''),
    p_party_size,
    p_reserved_at,
    NULLIF(btrim(COALESCE(p_special_request, '')), ''),
    'confirmed',
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
    'dashboard',
    true
  )
  RETURNING id INTO v_reservation_id;

  v_table_ids := assign_reservation_tables(v_reservation_id, p_restaurant_id, p_reserved_at, p_party_size, 90);
  IF COALESCE(array_length(v_table_ids, 1), 0) = 0 THEN
    UPDATE reservations
    SET status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = 'No available table for party size.'
    WHERE id = v_reservation_id;
    RAISE EXCEPTION 'No available table can fit this party at that time.';
  END IF;

  PERFORM write_staff_audit_event(
    p_restaurant_id,
    'reservation.create',
    'reservation',
    v_reservation_id,
    '{}'::jsonb,
    jsonb_build_object('party_size', p_party_size, 'reserved_at', p_reserved_at, 'role', v_role)
  );

  RETURN v_reservation_id;
END;
$$;

CREATE OR REPLACE FUNCTION seat_staff_reservation(
  p_reservation_id uuid,
  p_table_id uuid
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
    jsonb_build_object('table_id', p_table_id, 'role', v_role)
  );

  RETURN true;
END;
$$;

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
      cancelled_at = CASE WHEN p_status = 'cancelled' THEN now() ELSE cancelled_at END
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

CREATE OR REPLACE FUNCTION create_manager_action_approval(
  p_restaurant_id uuid,
  p_action text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_profile_id uuid;
  v_token text;
BEGIN
  v_role := require_staff_role(p_restaurant_id, ARRAY['owner', 'manager']);
  v_profile_id := current_profile_id();
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Manager profile not found.';
  END IF;

  INSERT INTO manager_action_approvals (
    restaurant_id,
    action,
    requested_by,
    approved_by
  )
  VALUES (p_restaurant_id, p_action, v_profile_id, v_profile_id)
  RETURNING token INTO v_token;

  PERFORM write_staff_audit_event(
    p_restaurant_id,
    'manager.approval.create',
    'manager_action_approval',
    NULL,
    '{}'::jsonb,
    jsonb_build_object('action', p_action, 'role', v_role),
    v_profile_id
  );

  RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION current_profile_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION current_staff_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION require_staff_role(uuid, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION write_staff_audit_event(uuid, text, text, uuid, jsonb, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION consume_manager_approval(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_staff_reservation(uuid, text, text, text, integer, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION seat_staff_reservation(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_staff_reservation_status(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION create_manager_action_approval(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION update_table_service_status(
  p_table_id uuid,
  p_status text,
  p_seated_count integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table "tables"%ROWTYPE;
  v_status text;
  v_seated integer;
  v_role text;
BEGIN
  SELECT *
  INTO v_table
  FROM "tables"
  WHERE id = p_table_id
    AND COALESCE(is_active, true);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Table not found.';
  END IF;

  v_role := require_staff_role(v_table.restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);

  v_status := CASE p_status
    WHEN 'empty' THEN 'empty'
    WHEN 'reserved' THEN 'reserved'
    WHEN 'occupied' THEN 'occupied'
    WHEN 'cleaning' THEN 'cleaning'
    ELSE NULL
  END;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Unsupported table service status.';
  END IF;

  IF COALESCE(v_table.status, 'empty') = 'blocked'
    AND v_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'Only owners and managers can update blocked tables.';
  END IF;

  v_seated := LEAST(GREATEST(COALESCE(p_seated_count, 0), 0), COALESCE(v_table.capacity, 0));

  IF v_status IN ('empty', 'cleaning') THEN
    v_seated := 0;
  END IF;

  UPDATE "tables"
  SET status = v_status,
      seated_count = v_seated,
      combined_with = CASE WHEN v_status = 'empty' THEN NULL ELSE combined_with END,
      updated_at = now()
  WHERE id = p_table_id;

  IF v_status = 'empty' AND to_regclass('public.reservation_tables') IS NOT NULL THEN
    UPDATE reservation_tables
    SET released_at = now()
    WHERE table_id = p_table_id
      AND released_at IS NULL;
  END IF;

  PERFORM write_staff_audit_event(
    v_table.restaurant_id,
    'table.status',
    'table',
    p_table_id,
    to_jsonb(v_table),
    jsonb_build_object('status', v_status, 'seated_count', v_seated, 'role', v_role)
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION update_table_service_status(uuid, text, integer) TO authenticated, service_role;
