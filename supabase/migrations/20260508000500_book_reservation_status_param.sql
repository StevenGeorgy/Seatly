-- Phase D follow-up: extend book_reservation with an optional p_status
-- parameter so AI-confirmed bookings (cenaiva-chat) can write status='confirmed'
-- the same way they did before this RPC existed. Default stays 'pending'
-- for the customer flow (create-public-booking). All other semantics
-- unchanged from the original migration.

DROP FUNCTION IF EXISTS public.book_reservation(
  uuid, uuid, timestamptz, integer, integer, uuid, uuid, text, text, text, text, text, boolean, text, text, text
);

CREATE OR REPLACE FUNCTION public.book_reservation(
  p_restaurant_id      uuid,
  p_shift_id           uuid,
  p_reserved_at        timestamptz,
  p_party_size         integer,
  p_turn_minutes       integer,
  p_guest_id           uuid,
  p_user_profile_id    uuid,
  p_confirmation_code  text,
  p_source             text DEFAULT 'web',
  p_special_request    text DEFAULT NULL,
  p_dietary_notes      text DEFAULT NULL,
  p_occasion           text DEFAULT NULL,
  p_is_guest_checkout  boolean DEFAULT false,
  p_guest_full_name    text DEFAULT NULL,
  p_guest_email        text DEFAULT NULL,
  p_guest_phone        text DEFAULT NULL,
  p_status             text DEFAULT 'pending'
)
RETURNS TABLE (
  reservation_id    uuid,
  confirmation_code text,
  table_ids         uuid[],
  duration_minutes  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_turn integer;
  v_slot_end timestamptz;
  v_max_covers integer;
  v_total_covers integer;
  v_table_ids uuid[];
  v_reservation_id uuid;
  v_request_role text;
  v_table_id uuid;
  v_index integer := 1;
  v_status text;
BEGIN
  IF p_restaurant_id IS NULL OR p_shift_id IS NULL OR p_reserved_at IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  v_status := COALESCE(NULLIF(p_status, ''), 'pending');
  IF v_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  v_request_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  IF v_request_role <> '' AND v_request_role <> 'service_role' THEN
    PERFORM public.require_staff_role(p_restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);
  END IF;

  v_turn := COALESCE(NULLIF(p_turn_minutes, 0), public.restaurant_turn_time_minutes(p_restaurant_id), 90);
  v_slot_end := p_reserved_at + make_interval(mins => v_turn);

  PERFORM pg_advisory_xact_lock(
    hashtext(p_restaurant_id::text || '|' || extract(epoch FROM p_reserved_at)::text)::bigint
  );

  SELECT COALESCE(s.max_covers, 100) INTO v_max_covers
  FROM public.shifts s
  WHERE s.id = p_shift_id AND s.restaurant_id = p_restaurant_id AND s.is_active;

  IF v_max_covers IS NULL THEN
    RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0003';
  END IF;

  SELECT COALESCE(SUM(r.party_size), 0)::integer INTO v_total_covers
  FROM public.reservations r
  WHERE r.restaurant_id = p_restaurant_id
    AND r.shift_id = p_shift_id
    AND r.status IN ('pending', 'confirmed', 'seated')
    AND r.reserved_at < v_slot_end
    AND r.reserved_at + make_interval(mins => COALESCE(NULLIF(r.duration_minutes, 0), v_turn)) > p_reserved_at;

  IF v_total_covers + p_party_size > v_max_covers THEN
    RAISE EXCEPTION 'over_cover_cap' USING ERRCODE = 'P0002';
  END IF;

  v_table_ids := public.find_available_table_group(
    p_restaurant_id,
    p_reserved_at,
    p_party_size,
    v_turn
  );

  IF COALESCE(array_length(v_table_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'no_table' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.reservations (
    restaurant_id, guest_id, user_profile_id, shift_id, party_size, reserved_at,
    duration_minutes, status, source, confirmation_code,
    special_request, dietary_notes, occasion,
    is_guest_checkout, guest_full_name, guest_email, guest_phone,
    confirmed_at
  ) VALUES (
    p_restaurant_id, p_guest_id, p_user_profile_id, p_shift_id, p_party_size, p_reserved_at,
    v_turn, v_status, COALESCE(p_source, 'web'), p_confirmation_code,
    p_special_request, p_dietary_notes, p_occasion,
    p_is_guest_checkout, p_guest_full_name, p_guest_email, p_guest_phone,
    CASE WHEN v_status = 'confirmed' THEN now() ELSE NULL END
  )
  RETURNING id INTO v_reservation_id;

  FOREACH v_table_id IN ARRAY v_table_ids LOOP
    INSERT INTO public.reservation_tables (
      restaurant_id, reservation_id, table_id, is_primary
    ) VALUES (
      p_restaurant_id, v_reservation_id, v_table_id, v_index = 1
    );
    v_index := v_index + 1;
  END LOOP;

  UPDATE public.reservations
  SET table_id = v_table_ids[1],
      duration_minutes = v_turn,
      updated_at = now()
  WHERE id = v_reservation_id;

  reservation_id := v_reservation_id;
  confirmation_code := p_confirmation_code;
  table_ids := v_table_ids;
  duration_minutes := v_turn;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_reservation(
  uuid, uuid, timestamptz, integer, integer, uuid, uuid, text, text, text, text, text, boolean, text, text, text, text
) TO service_role, authenticated;
