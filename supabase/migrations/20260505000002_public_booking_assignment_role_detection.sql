-- Allow the public booking Edge Function's service-role client to assign tables
-- when PostgREST does not populate request.jwt.claim.role for service calls.
CREATE OR REPLACE FUNCTION public.assign_reservation_tables(
  p_reservation_id uuid,
  p_restaurant_id uuid,
  p_reserved_at timestamptz,
  p_party_size integer,
  p_turn_minutes integer DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid[];
  v_table_id uuid;
  v_index integer := 1;
  v_reservation_restaurant uuid;
  v_turn_minutes integer;
  v_request_role text;
BEGIN
  SELECT restaurant_id
  INTO v_reservation_restaurant
  FROM public.reservations
  WHERE id = p_reservation_id;

  IF v_reservation_restaurant IS NULL OR v_reservation_restaurant <> p_restaurant_id THEN
    RAISE EXCEPTION 'Reservation not found for this restaurant.';
  END IF;

  v_request_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  IF v_request_role <> '' AND v_request_role <> 'service_role' THEN
    PERFORM public.require_staff_role(p_restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);
  END IF;

  v_turn_minutes := COALESCE(p_turn_minutes, public.restaurant_turn_time_minutes(p_restaurant_id), 90);

  v_group := public.find_available_table_group(
    p_restaurant_id,
    p_reserved_at,
    p_party_size,
    v_turn_minutes,
    p_reservation_id
  );

  IF COALESCE(array_length(v_group, 1), 0) = 0 THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  UPDATE public.reservation_tables
  SET released_at = now()
  WHERE reservation_id = p_reservation_id
    AND released_at IS NULL;

  FOREACH v_table_id IN ARRAY v_group LOOP
    INSERT INTO public.reservation_tables (
      restaurant_id,
      reservation_id,
      table_id,
      is_primary
    )
    VALUES (
      p_restaurant_id,
      p_reservation_id,
      v_table_id,
      v_index = 1
    );
    v_index := v_index + 1;
  END LOOP;

  UPDATE public.reservations
  SET table_id = v_group[1],
      duration_minutes = v_turn_minutes,
      updated_at = now()
  WHERE id = p_reservation_id
    AND restaurant_id = p_restaurant_id;

  RETURN v_group;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_reservation_tables(uuid, uuid, timestamptz, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_reservation_tables(uuid, uuid, timestamptz, integer, integer) TO authenticated, service_role;
