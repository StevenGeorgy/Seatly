-- Prevent active reservations from accidentally losing their table assignment.
-- Intentional reassignment paths can call force_release_reservation_tables().

CREATE OR REPLACE FUNCTION public.release_reservation_tables_internal(
  p_reservation_id uuid,
  p_force boolean DEFAULT false
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation public.reservations%ROWTYPE;
  v_group uuid[];
  v_request_role text;
BEGIN
  SELECT *
  INTO v_reservation
  FROM public.reservations
  WHERE id = p_reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.';
  END IF;

  v_request_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  IF v_request_role <> 'service_role' THEN
    PERFORM public.require_staff_role(v_reservation.restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);
  END IF;

  IF NOT p_force AND v_reservation.status IN ('pending', 'confirmed', 'seated') THEN
    RAISE EXCEPTION 'Cannot release tables for an active reservation. Complete, cancel, mark no-show, or use explicit reassignment.';
  END IF;

  SELECT COALESCE(array_agg(table_id), ARRAY[]::uuid[])
  INTO v_group
  FROM public.reservation_tables
  WHERE reservation_id = p_reservation_id
    AND released_at IS NULL;

  IF COALESCE(array_length(v_group, 1), 0) = 0 THEN
    v_group := CASE
      WHEN v_reservation.table_id IS NULL THEN ARRAY[]::uuid[]
      ELSE ARRAY[v_reservation.table_id]
    END;
  END IF;

  UPDATE public.reservation_tables
  SET released_at = now()
  WHERE reservation_id = p_reservation_id
    AND released_at IS NULL;

  UPDATE public."tables"
  SET status = 'empty',
      seated_count = 0,
      combined_with = NULL,
      updated_at = now()
  WHERE id = ANY(v_group)
    AND COALESCE(status, 'empty') <> 'blocked';

  RETURN COALESCE(v_group, ARRAY[]::uuid[]);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_reservation_tables(
  p_reservation_id uuid
)
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.release_reservation_tables_internal(p_reservation_id, false);
$$;

CREATE OR REPLACE FUNCTION public.force_release_reservation_tables(
  p_reservation_id uuid
)
RETURNS uuid[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.release_reservation_tables_internal(p_reservation_id, true);
$$;

CREATE OR REPLACE FUNCTION public.seat_staff_reservation(
  p_reservation_id uuid,
  p_table_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation public.reservations%ROWTYPE;
  v_table public."tables"%ROWTYPE;
  v_role text;
BEGIN
  SELECT * INTO v_reservation FROM public.reservations WHERE id = p_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.';
  END IF;

  v_role := public.require_staff_role(v_reservation.restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);

  SELECT * INTO v_table
  FROM public."tables"
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

  UPDATE public.reservations
  SET status = 'seated',
      table_id = p_table_id,
      checked_in_at = COALESCE(checked_in_at, now()),
      seated_at = now()
  WHERE id = p_reservation_id;

  PERFORM public.force_release_reservation_tables(p_reservation_id);

  INSERT INTO public.reservation_tables (restaurant_id, reservation_id, table_id, is_primary)
  VALUES (v_reservation.restaurant_id, p_reservation_id, p_table_id, true);

  PERFORM public.mark_reservation_tables_seated(p_reservation_id, v_reservation.party_size);

  PERFORM public.write_staff_audit_event(
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

REVOKE EXECUTE ON FUNCTION public.release_reservation_tables_internal(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_reservation_tables_internal(uuid, boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_reservation_tables(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_reservation_tables(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.force_release_reservation_tables(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.force_release_reservation_tables(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.seat_staff_reservation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_reservation_tables(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.force_release_reservation_tables(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seat_staff_reservation(uuid, uuid) TO authenticated, service_role;
