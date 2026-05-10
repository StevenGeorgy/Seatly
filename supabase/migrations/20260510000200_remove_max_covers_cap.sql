-- Remove the per-shift max_covers bouncer for any shift whose max_covers IS NULL.
--
-- Background: shifts.max_covers was a per-shift cap on simultaneous covers
-- (people seated at once during a shift's turn window). Defaulted to 100 in
-- both the SettingsPage seed and the RPCs' COALESCE fallback. Owners had no
-- UI to view or edit it, so it silently throttled real bookings — Georgy Inc
-- was capped at 40 covers across a 48-seat floor plan.
--
-- New rule: if shifts.max_covers IS NULL, the cover-cap check is skipped
-- entirely. The only ceiling becomes physical seats (enforced via
-- find_available_table_group, which already early-returns when party_size
-- exceeds restaurant_floor_capacity). Owners who DO want a kitchen/throughput
-- throttle can set a number on shifts.max_covers via a future dashboard
-- control; until then, every shift becomes uncapped.
--
-- Touches 4 RPCs (book_reservation, modify_reservation_slot,
-- create_staff_reservation, get_available_slots) and runs a one-time data
-- sweep so existing rows benefit immediately.

-- ---------------------------------------------------------------------------
-- 1. book_reservation — drop COALESCE, gate cover-cap on NOT NULL.
-- Use IF NOT FOUND for shift_not_found detection (was relying on COALESCE side
-- effects).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.book_reservation(
  p_restaurant_id uuid,
  p_shift_id uuid,
  p_reserved_at timestamp with time zone,
  p_party_size integer,
  p_turn_minutes integer,
  p_guest_id uuid,
  p_user_profile_id uuid,
  p_confirmation_code text,
  p_source text DEFAULT 'web'::text,
  p_special_request text DEFAULT NULL::text,
  p_dietary_notes text DEFAULT NULL::text,
  p_occasion text DEFAULT NULL::text,
  p_is_guest_checkout boolean DEFAULT false,
  p_guest_full_name text DEFAULT NULL::text,
  p_guest_email text DEFAULT NULL::text,
  p_guest_phone text DEFAULT NULL::text,
  p_status text DEFAULT 'pending'::text
)
RETURNS TABLE(reservation_id uuid, confirmation_code text, table_ids uuid[], duration_minutes integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_turn integer;
  v_slot_end timestamptz;
  v_slot_range tstzrange;
  v_max_covers integer;
  v_total_covers integer;
  v_table_ids uuid[];
  v_reservation_id uuid;
  v_request_role text;
  v_table_id uuid;
  v_index integer := 1;
  v_status text;
  v_email_norm text;
  v_phone_norm text;
  v_overlap_id uuid;
  v_timezone text;
  v_shift_start time;
  v_shift_end time;
  v_local_min int;
  v_shift_start_min int;
  v_shift_end_min int;
  v_persisted_code text;
BEGIN
  IF p_restaurant_id IS NULL OR p_shift_id IS NULL OR p_reserved_at IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  v_status := COALESCE(NULLIF(p_status, ''), 'pending');
  IF v_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  v_email_norm := lower(NULLIF(trim(COALESCE(p_guest_email, '')), ''));
  v_phone_norm := NULLIF(regexp_replace(COALESCE(p_guest_phone, ''), '\D', '', 'g'), '');
  IF p_user_profile_id IS NULL AND v_email_norm IS NULL AND v_phone_norm IS NULL THEN
    RAISE EXCEPTION 'missing_identifier'
      USING ERRCODE = 'P0007',
            DETAIL = 'reservation needs user_profile_id, guest_email, or guest_phone';
  END IF;

  v_request_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  IF v_request_role <> '' AND v_request_role <> 'service_role' THEN
    PERFORM public.require_staff_role(p_restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);
  END IF;

  v_turn := COALESCE(NULLIF(p_turn_minutes, 0), public.restaurant_turn_time_minutes(p_restaurant_id), 90);
  v_slot_end := p_reserved_at + (v_turn * interval '1 minute');
  v_slot_range := tstzrange(p_reserved_at, v_slot_end, '[)');

  PERFORM pg_advisory_xact_lock(
    hashtext(p_restaurant_id::text || '|' || extract(epoch FROM p_reserved_at)::text)::bigint
  );

  IF p_user_profile_id IS NOT NULL THEN
    SELECT r.id INTO v_overlap_id
    FROM public.reservations r
    WHERE r.user_profile_id = p_user_profile_id
      AND r.status IN ('pending','confirmed','seated')
      AND r.slot_range && v_slot_range
    LIMIT 1;
    IF v_overlap_id IS NOT NULL THEN
      RAISE EXCEPTION 'diner_double_book'
        USING ERRCODE = 'P0006', DETAIL = 'overlap_reservation_id=' || v_overlap_id::text;
    END IF;
  ELSE
    IF v_email_norm IS NOT NULL THEN
      SELECT r.id INTO v_overlap_id
      FROM public.reservations r
      WHERE r.user_profile_id IS NULL
        AND lower(r.guest_email) = v_email_norm
        AND r.status IN ('pending','confirmed','seated')
        AND r.slot_range && v_slot_range
      LIMIT 1;
      IF v_overlap_id IS NOT NULL THEN
        RAISE EXCEPTION 'diner_double_book'
          USING ERRCODE = 'P0006', DETAIL = 'overlap_reservation_id=' || v_overlap_id::text;
      END IF;
    END IF;

    IF v_phone_norm IS NOT NULL THEN
      SELECT r.id INTO v_overlap_id
      FROM public.reservations r
      WHERE r.user_profile_id IS NULL
        AND regexp_replace(COALESCE(r.guest_phone, ''), '\D', '', 'g') = v_phone_norm
        AND r.status IN ('pending','confirmed','seated')
        AND r.slot_range && v_slot_range
      LIMIT 1;
      IF v_overlap_id IS NOT NULL THEN
        RAISE EXCEPTION 'diner_double_book'
          USING ERRCODE = 'P0006', DETAIL = 'overlap_reservation_id=' || v_overlap_id::text;
      END IF;
    END IF;
  END IF;

  -- BUOY: was COALESCE(s.max_covers, 100). Now NULL = no cap.
  -- Detect shift_not_found via NOT FOUND (no row matched).
  SELECT s.max_covers, s.start_time, s.end_time
    INTO v_max_covers, v_shift_start, v_shift_end
  FROM public.shifts s
  WHERE s.id = p_shift_id AND s.restaurant_id = p_restaurant_id AND s.is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0003';
  END IF;

  v_timezone := COALESCE((SELECT timezone FROM public.restaurants WHERE id = p_restaurant_id), 'UTC');

  IF v_shift_start IS NOT NULL AND v_shift_end IS NOT NULL AND v_shift_end > v_shift_start THEN
    v_local_min :=
      EXTRACT(HOUR   FROM (p_reserved_at AT TIME ZONE v_timezone)::time)::int * 60 +
      EXTRACT(MINUTE FROM (p_reserved_at AT TIME ZONE v_timezone)::time)::int;
    v_shift_start_min :=
      EXTRACT(HOUR FROM v_shift_start)::int * 60 + EXTRACT(MINUTE FROM v_shift_start)::int;
    v_shift_end_min :=
      EXTRACT(HOUR FROM v_shift_end)::int * 60 + EXTRACT(MINUTE FROM v_shift_end)::int;
    IF v_local_min < v_shift_start_min THEN
      RAISE EXCEPTION 'past_shift_close'
        USING ERRCODE = 'P0008',
              DETAIL = 'reserved_at is before shift open';
    END IF;
    IF v_local_min + v_turn > v_shift_end_min THEN
      RAISE EXCEPTION 'past_shift_close'
        USING ERRCODE = 'P0008',
              DETAIL = format('booking would run %s minutes past close', v_local_min + v_turn - v_shift_end_min);
    END IF;
  END IF;

  -- Cover-cap check: only fires when owner has explicitly set max_covers.
  IF v_max_covers IS NOT NULL THEN
    SELECT COALESCE(SUM(r.party_size), 0)::integer INTO v_total_covers
    FROM public.reservations r
    WHERE r.restaurant_id = p_restaurant_id
      AND r.shift_id = p_shift_id
      AND r.status IN ('pending', 'confirmed', 'seated')
      AND r.reserved_at < v_slot_end
      AND r.reserved_at + (COALESCE(NULLIF(r.duration_minutes, 0), v_turn) * interval '1 minute') > p_reserved_at;

    IF v_total_covers + p_party_size > v_max_covers THEN
      RAISE EXCEPTION 'over_cover_cap' USING ERRCODE = 'P0002';
    END IF;
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

  BEGIN
    INSERT INTO public.reservations AS r (
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
    RETURNING r.id, r.confirmation_code INTO v_reservation_id, v_persisted_code;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'diner_double_book' USING ERRCODE = 'P0006';
    WHEN check_violation THEN
      RAISE EXCEPTION 'missing_identifier' USING ERRCODE = 'P0007';
  END;

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
  confirmation_code := v_persisted_code;
  table_ids := v_table_ids;
  duration_minutes := v_turn;
  RETURN NEXT;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. modify_reservation_slot — drop COALESCE, gate cover-cap on NOT NULL.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.modify_reservation_slot(
  p_reservation_id uuid,
  p_restaurant_id uuid,
  p_shift_id uuid,
  p_new_reserved_at timestamp with time zone,
  p_new_party_size integer,
  p_turn_minutes integer
)
RETURNS TABLE(out_reservation_id uuid, out_table_ids uuid[], out_duration integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_turn integer;
  v_slot_end timestamptz;
  v_slot_range tstzrange;
  v_max_covers integer;
  v_total_covers integer;
  v_table_ids uuid[];
  v_status text;
  v_reservation_restaurant uuid;
  v_user_profile_id uuid;
  v_guest_email text;
  v_guest_phone text;
  v_request_role text;
  v_table_id uuid;
  v_index integer := 1;
  v_email_norm text;
  v_phone_norm text;
  v_overlap_id uuid;
  v_timezone text;
  v_shift_start time;
  v_shift_end time;
  v_local_min int;
  v_shift_start_min int;
  v_shift_end_min int;
BEGIN
  IF p_reservation_id IS NULL
     OR p_restaurant_id IS NULL
     OR p_shift_id IS NULL
     OR p_new_reserved_at IS NULL
     OR p_new_party_size IS NULL
     OR p_new_party_size < 1
  THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  v_request_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  IF v_request_role <> '' AND v_request_role <> 'service_role' THEN
    PERFORM public.require_staff_role(p_restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);
  END IF;

  v_turn := COALESCE(NULLIF(p_turn_minutes, 0), public.restaurant_turn_time_minutes(p_restaurant_id), 90);
  v_slot_end := p_new_reserved_at + (v_turn * interval '1 minute');
  v_slot_range := tstzrange(p_new_reserved_at, v_slot_end, '[)');

  PERFORM pg_advisory_xact_lock(
    hashtext(p_restaurant_id::text || '|' || extract(epoch FROM p_new_reserved_at)::text)::bigint
  );

  SELECT restaurant_id, status, user_profile_id, guest_email, guest_phone
  INTO v_reservation_restaurant, v_status, v_user_profile_id, v_guest_email, v_guest_phone
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_reservation_restaurant IS NULL OR v_reservation_restaurant <> p_restaurant_id THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0005';
  END IF;
  IF COALESCE(v_status, 'pending') NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'not_modifiable' USING ERRCODE = 'P0004';
  END IF;

  v_email_norm := lower(NULLIF(trim(COALESCE(v_guest_email, '')), ''));
  v_phone_norm := NULLIF(regexp_replace(COALESCE(v_guest_phone, ''), '\D', '', 'g'), '');
  IF v_user_profile_id IS NULL AND v_email_norm IS NULL AND v_phone_norm IS NULL THEN
    RAISE EXCEPTION 'missing_identifier'
      USING ERRCODE = 'P0007',
            DETAIL = 'existing reservation lacks identifier; cannot be modified';
  END IF;

  IF v_user_profile_id IS NOT NULL THEN
    SELECT r.id INTO v_overlap_id
    FROM public.reservations r
    WHERE r.user_profile_id = v_user_profile_id
      AND r.id <> p_reservation_id
      AND r.status IN ('pending','confirmed','seated')
      AND r.slot_range && v_slot_range
    LIMIT 1;
    IF v_overlap_id IS NOT NULL THEN
      RAISE EXCEPTION 'diner_double_book'
        USING ERRCODE = 'P0006', DETAIL = 'overlap_reservation_id=' || v_overlap_id::text;
    END IF;
  ELSE
    IF v_email_norm IS NOT NULL THEN
      SELECT r.id INTO v_overlap_id
      FROM public.reservations r
      WHERE r.user_profile_id IS NULL
        AND r.id <> p_reservation_id
        AND lower(r.guest_email) = v_email_norm
        AND r.status IN ('pending','confirmed','seated')
        AND r.slot_range && v_slot_range
      LIMIT 1;
      IF v_overlap_id IS NOT NULL THEN
        RAISE EXCEPTION 'diner_double_book'
          USING ERRCODE = 'P0006', DETAIL = 'overlap_reservation_id=' || v_overlap_id::text;
      END IF;
    END IF;

    IF v_phone_norm IS NOT NULL THEN
      SELECT r.id INTO v_overlap_id
      FROM public.reservations r
      WHERE r.user_profile_id IS NULL
        AND r.id <> p_reservation_id
        AND regexp_replace(COALESCE(r.guest_phone, ''), '\D', '', 'g') = v_phone_norm
        AND r.status IN ('pending','confirmed','seated')
        AND r.slot_range && v_slot_range
      LIMIT 1;
      IF v_overlap_id IS NOT NULL THEN
        RAISE EXCEPTION 'diner_double_book'
          USING ERRCODE = 'P0006', DETAIL = 'overlap_reservation_id=' || v_overlap_id::text;
      END IF;
    END IF;
  END IF;

  -- BUOY: was COALESCE(s.max_covers, 100). Now NULL = no cap.
  SELECT s.max_covers, s.start_time, s.end_time
    INTO v_max_covers, v_shift_start, v_shift_end
  FROM public.shifts s
  WHERE s.id = p_shift_id AND s.restaurant_id = p_restaurant_id AND s.is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0003';
  END IF;

  v_timezone := COALESCE((SELECT timezone FROM public.restaurants WHERE id = p_restaurant_id), 'UTC');

  IF v_shift_start IS NOT NULL AND v_shift_end IS NOT NULL AND v_shift_end > v_shift_start THEN
    v_local_min :=
      EXTRACT(HOUR   FROM (p_new_reserved_at AT TIME ZONE v_timezone)::time)::int * 60 +
      EXTRACT(MINUTE FROM (p_new_reserved_at AT TIME ZONE v_timezone)::time)::int;
    v_shift_start_min :=
      EXTRACT(HOUR FROM v_shift_start)::int * 60 + EXTRACT(MINUTE FROM v_shift_start)::int;
    v_shift_end_min :=
      EXTRACT(HOUR FROM v_shift_end)::int * 60 + EXTRACT(MINUTE FROM v_shift_end)::int;
    IF v_local_min < v_shift_start_min THEN
      RAISE EXCEPTION 'past_shift_close'
        USING ERRCODE = 'P0008',
              DETAIL = 'new_reserved_at is before shift open';
    END IF;
    IF v_local_min + v_turn > v_shift_end_min THEN
      RAISE EXCEPTION 'past_shift_close'
        USING ERRCODE = 'P0008',
              DETAIL = format('modified booking would run %s minutes past close', v_local_min + v_turn - v_shift_end_min);
    END IF;
  END IF;

  -- Cover-cap check: only fires when owner has explicitly set max_covers.
  IF v_max_covers IS NOT NULL THEN
    SELECT COALESCE(SUM(r.party_size), 0)::integer INTO v_total_covers
    FROM public.reservations r
    WHERE r.restaurant_id = p_restaurant_id
      AND r.shift_id = p_shift_id
      AND r.id <> p_reservation_id
      AND r.status IN ('pending', 'confirmed', 'seated')
      AND r.reserved_at < v_slot_end
      AND r.reserved_at + (COALESCE(NULLIF(r.duration_minutes, 0), v_turn) * interval '1 minute') > p_new_reserved_at;

    IF v_total_covers + p_new_party_size > v_max_covers THEN
      RAISE EXCEPTION 'over_cover_cap' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  UPDATE public.reservation_tables rt
  SET released_at = now()
  WHERE rt.reservation_id = p_reservation_id
    AND rt.released_at IS NULL;

  BEGIN
    UPDATE public.reservations
    SET reserved_at = p_new_reserved_at,
        party_size = p_new_party_size,
        shift_id = p_shift_id,
        duration_minutes = v_turn,
        updated_at = now()
    WHERE id = p_reservation_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'diner_double_book' USING ERRCODE = 'P0006';
  END;

  v_table_ids := public.find_available_table_group(
    p_restaurant_id,
    p_new_reserved_at,
    p_new_party_size,
    v_turn,
    p_reservation_id
  );

  IF COALESCE(array_length(v_table_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'no_table' USING ERRCODE = 'P0001';
  END IF;

  FOREACH v_table_id IN ARRAY v_table_ids LOOP
    INSERT INTO public.reservation_tables (
      restaurant_id, reservation_id, table_id, is_primary
    ) VALUES (
      p_restaurant_id, p_reservation_id, v_table_id, v_index = 1
    );
    v_index := v_index + 1;
  END LOOP;

  UPDATE public.reservations
  SET table_id = v_table_ids[1],
      updated_at = now()
  WHERE id = p_reservation_id;

  out_reservation_id := p_reservation_id;
  out_table_ids := v_table_ids;
  out_duration := v_turn;
  RETURN NEXT;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. create_staff_reservation — drop COALESCE, gate cover-cap on NOT NULL.
-- This RPC's shift query already does its own NULL check (v_shift_id IS NOT
-- NULL) so we don't need NOT FOUND here — just gate the cover-cap branch on
-- max_covers IS NOT NULL.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_staff_reservation(
  p_restaurant_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_party_size integer,
  p_reserved_at timestamp with time zone,
  p_special_request text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_guest_id uuid;
  v_reservation_id uuid;
  v_table_ids uuid[];
  v_turn_minutes integer;
  v_slot_end timestamptz;
  v_slot_range tstzrange;
  v_email_norm text;
  v_phone_norm text;
  v_overlap_id uuid;
  v_total_covers integer;
  v_max_covers integer;
  v_shift_id uuid;
  v_shift_start time;
  v_shift_end time;
  v_local_time time;
  v_local_min int;
  v_shift_start_min int;
  v_shift_end_min int;
BEGIN
  v_role := public.require_staff_role(p_restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);
  v_turn_minutes := COALESCE(public.restaurant_turn_time_minutes(p_restaurant_id), 90);

  IF p_party_size IS NULL OR p_party_size < 1 THEN
    RAISE EXCEPTION 'Party size must be at least 1.';
  END IF;
  IF p_reserved_at IS NULL THEN
    RAISE EXCEPTION 'Reservation time is required.' USING ERRCODE = '22023';
  END IF;

  v_email_norm := lower(NULLIF(trim(COALESCE(p_guest_email, '')), ''));
  v_phone_norm := NULLIF(regexp_replace(COALESCE(p_guest_phone, ''), '\D', '', 'g'), '');

  IF v_email_norm IS NULL AND v_phone_norm IS NULL THEN
    RAISE EXCEPTION 'missing_identifier'
      USING ERRCODE = 'P0007',
            DETAIL = 'staff reservation needs guest_email or guest_phone';
  END IF;

  v_slot_end := p_reserved_at + (v_turn_minutes * interval '1 minute');
  v_slot_range := tstzrange(p_reserved_at, v_slot_end, '[)');

  PERFORM pg_advisory_xact_lock(
    hashtext(p_restaurant_id::text || '|' || extract(epoch FROM p_reserved_at)::text)::bigint
  );

  IF v_email_norm IS NOT NULL THEN
    SELECT r.id INTO v_overlap_id
    FROM public.reservations r
    WHERE r.user_profile_id IS NULL
      AND lower(r.guest_email) = v_email_norm
      AND r.status IN ('pending','confirmed','seated')
      AND r.slot_range && v_slot_range
    LIMIT 1;
    IF v_overlap_id IS NOT NULL THEN
      RAISE EXCEPTION 'diner_double_book'
        USING ERRCODE = 'P0006', DETAIL = 'overlap_reservation_id=' || v_overlap_id::text;
    END IF;
  END IF;

  IF v_phone_norm IS NOT NULL THEN
    SELECT r.id INTO v_overlap_id
    FROM public.reservations r
    WHERE r.user_profile_id IS NULL
      AND regexp_replace(COALESCE(r.guest_phone, ''), '\D', '', 'g') = v_phone_norm
      AND r.status IN ('pending','confirmed','seated')
      AND r.slot_range && v_slot_range
    LIMIT 1;
    IF v_overlap_id IS NOT NULL THEN
      RAISE EXCEPTION 'diner_double_book'
        USING ERRCODE = 'P0006', DETAIL = 'overlap_reservation_id=' || v_overlap_id::text;
    END IF;
  END IF;

  v_local_time := (p_reserved_at AT TIME ZONE COALESCE(
    (SELECT timezone FROM public.restaurants WHERE id = p_restaurant_id),
    'UTC'
  ))::time;

  -- BUOY: was COALESCE(s.max_covers, 100). Now NULL = no cap.
  SELECT s.id, s.max_covers, s.start_time, s.end_time
  INTO v_shift_id, v_max_covers, v_shift_start, v_shift_end
  FROM public.shifts s
  WHERE s.restaurant_id = p_restaurant_id
    AND s.is_active
    AND s.start_time IS NOT NULL
    AND s.end_time IS NOT NULL
    AND (
      (s.start_time <= s.end_time
        AND v_local_time >= s.start_time
        AND v_local_time < s.end_time)
      OR
      (s.start_time > s.end_time
        AND (v_local_time >= s.start_time OR v_local_time < s.end_time))
    )
  ORDER BY s.start_time
  LIMIT 1;

  IF v_shift_id IS NOT NULL
     AND v_shift_start IS NOT NULL AND v_shift_end IS NOT NULL
     AND v_shift_end > v_shift_start THEN
    v_local_min :=
      EXTRACT(HOUR   FROM v_local_time)::int * 60 +
      EXTRACT(MINUTE FROM v_local_time)::int;
    v_shift_start_min :=
      EXTRACT(HOUR FROM v_shift_start)::int * 60 + EXTRACT(MINUTE FROM v_shift_start)::int;
    v_shift_end_min :=
      EXTRACT(HOUR FROM v_shift_end)::int * 60 + EXTRACT(MINUTE FROM v_shift_end)::int;
    IF v_local_min + v_turn_minutes > v_shift_end_min THEN
      RAISE EXCEPTION 'past_shift_close'
        USING ERRCODE = 'P0008',
              DETAIL = format('booking would run %s minutes past close', v_local_min + v_turn_minutes - v_shift_end_min);
    END IF;
  END IF;

  -- Cover-cap check: only fires when both shift is found AND max_covers set.
  IF v_shift_id IS NOT NULL AND v_max_covers IS NOT NULL THEN
    SELECT COALESCE(SUM(r.party_size), 0)::integer INTO v_total_covers
    FROM public.reservations r
    WHERE r.restaurant_id = p_restaurant_id
      AND r.shift_id = v_shift_id
      AND r.status IN ('pending', 'confirmed', 'seated')
      AND r.reserved_at < v_slot_end
      AND r.reserved_at + (COALESCE(NULLIF(r.duration_minutes, 0), v_turn_minutes) * interval '1 minute') > p_reserved_at;
    IF v_total_covers + p_party_size > v_max_covers THEN
      RAISE EXCEPTION 'over_cover_cap' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  v_guest_id := public.canonical_guest_id(p_restaurant_id, NULL, p_guest_email, p_guest_phone);

  IF v_guest_id IS NULL THEN
    INSERT INTO public.guests (restaurant_id, full_name, phone, email)
    VALUES (
      p_restaurant_id,
      NULLIF(btrim(COALESCE(p_guest_name, '')), ''),
      NULLIF(btrim(COALESCE(p_guest_phone, '')), ''),
      public.crm_normalized_email(p_guest_email)
    )
    RETURNING id INTO v_guest_id;
  ELSE
    UPDATE public.guests
    SET
      full_name = COALESCE(NULLIF(btrim(COALESCE(p_guest_name, '')), ''), full_name),
      phone = COALESCE(NULLIF(btrim(COALESCE(p_guest_phone, '')), ''), phone),
      email = COALESCE(public.crm_normalized_email(p_guest_email), email)
    WHERE id = v_guest_id;
  END IF;

  BEGIN
    INSERT INTO public.reservations (
      restaurant_id, guest_id, shift_id,
      guest_full_name, guest_email, guest_phone,
      party_size, reserved_at, duration_minutes,
      special_request, status, confirmation_code, source,
      is_guest_checkout, confirmed_at
    )
    VALUES (
      p_restaurant_id, v_guest_id, v_shift_id,
      NULLIF(btrim(COALESCE(p_guest_name, '')), ''),
      public.crm_normalized_email(p_guest_email),
      NULLIF(btrim(COALESCE(p_guest_phone, '')), ''),
      p_party_size, p_reserved_at, v_turn_minutes,
      NULLIF(btrim(COALESCE(p_special_request, '')), ''),
      'confirmed',
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
      'dashboard',
      true, now()
    )
    RETURNING id INTO v_reservation_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'diner_double_book' USING ERRCODE = 'P0006';
    WHEN check_violation THEN
      RAISE EXCEPTION 'missing_identifier' USING ERRCODE = 'P0007';
  END;

  v_table_ids := public.assign_reservation_tables(v_reservation_id, p_restaurant_id, p_reserved_at, p_party_size, v_turn_minutes);
  IF COALESCE(array_length(v_table_ids, 1), 0) = 0 THEN
    UPDATE public.reservations
    SET status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = 'No available table for party size.'
    WHERE id = v_reservation_id;
    RAISE EXCEPTION 'no_table' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.write_staff_audit_event(
    p_restaurant_id,
    'reservation.create',
    'reservation',
    v_reservation_id,
    '{}'::jsonb,
    jsonb_build_object(
      'party_size', p_party_size,
      'reserved_at', p_reserved_at,
      'duration_minutes', v_turn_minutes,
      'role', v_role
    )
  );

  RETURN v_reservation_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. get_available_slots — drop COALESCE, gate per-slot cover check on
-- NOT NULL. Also affects the `v_total_covers <= v_max_covers` slot filter.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_restaurant_id uuid,
  p_date text,
  p_party_size integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_date_only text;
  v_request_date date;
  v_today date;
  v_restaurant_row record;
  v_timezone text;
  v_hours_json jsonb;
  v_floor_capacity_rpc int;
  v_floor_capacity_top int;
  v_active_table_count int;
  v_dow int;
  v_dow_names text[] := ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  v_dow_name text;
  v_special jsonb;
  v_pair record;
  v_configured_hours_window text := NULL;
  v_configured_state text := NULL;
  v_configured_open int;
  v_configured_close int;
  v_day_start_utc timestamptz;
  v_day_end_utc timestamptz;
  v_shift record;
  v_slot_min int;
  v_end_min int;
  v_slot_inc int;
  v_turn_mins int;
  v_max_covers int;
  v_advance_days int;
  v_max_booking_date date;
  v_slot_start_utc timestamptz;
  v_slot_end_utc timestamptz;
  v_total_covers int;
  v_overlap_party int;
  v_table_ids uuid[];
  v_slot_obj jsonb;
  v_slots_arr jsonb := '[]'::jsonb;
  v_candidates_count int := 0;
  v_table_blocked_count int := 0;
  v_unavailable_reason text := NULL;
  v_message text := NULL;
  v_table_capacity_blocked boolean := false;
BEGIN
  v_date_only := substring(p_date FROM 1 FOR 10);
  v_request_date := v_date_only::date;
  v_today := (now() AT TIME ZONE 'UTC')::date;

  SELECT timezone, hours_json
    INTO v_restaurant_row
  FROM public.restaurants
  WHERE id = p_restaurant_id;
  v_timezone := COALESCE(v_restaurant_row.timezone, 'UTC');
  v_hours_json := CASE
    WHEN v_restaurant_row.hours_json IS NOT NULL
         AND jsonb_typeof(v_restaurant_row.hours_json) = 'object'
    THEN v_restaurant_row.hours_json
    ELSE NULL
  END;

  v_floor_capacity_rpc := COALESCE(public.restaurant_floor_capacity(p_restaurant_id), 0);

  SELECT COALESCE(SUM(capacity), 0)::int, COUNT(*)::int
    INTO v_floor_capacity_top, v_active_table_count
  FROM public."tables"
  WHERE restaurant_id = p_restaurant_id AND is_active = true;
  IF v_active_table_count = 0 THEN
    v_floor_capacity_top := NULL;
  END IF;

  IF p_party_size < 1 OR p_party_size > v_floor_capacity_rpc THEN
    RETURN jsonb_build_object(
      'slots', '[]'::jsonb,
      'floor_capacity', v_floor_capacity_top,
      'configured_hours_window', NULL,
      'unavailable_reason', NULL,
      'message', CASE
        WHEN v_floor_capacity_rpc > 0
          THEN 'This restaurant can take parties up to ' || v_floor_capacity_rpc || '.'
        ELSE 'This restaurant does not have a saved floor plan yet.'
      END,
      'timezone', v_timezone
    );
  END IF;

  v_dow := EXTRACT(DOW FROM
    timezone(v_timezone, (v_request_date + time '12:00') AT TIME ZONE 'UTC')
  )::int;
  v_dow_name := COALESCE(v_dow_names[v_dow + 1], 'monday');

  IF v_hours_json IS NOT NULL THEN
    v_special := public._availability_find_special_day(v_hours_json, v_date_only);
    IF v_special IS NOT NULL THEN
      IF (v_special ->> 'closed') = 'true' THEN
        v_configured_state := 'closed';
      ELSE
        SELECT * INTO v_pair FROM public._availability_read_hours_pair(jsonb_build_object(
          'open', v_special -> 'from',
          'close', v_special -> 'to',
          'closed', false
        ));
        IF v_pair.state = 'open' THEN
          v_configured_state := 'open';
          v_configured_open := v_pair.open_min;
          v_configured_close := v_pair.close_min;
          v_configured_hours_window := v_pair.label;
        ELSE
          v_configured_state := 'closed';
        END IF;
      END IF;
    ELSE
      SELECT * INTO v_pair FROM public._availability_read_hours_pair(v_hours_json -> v_dow_name);
      IF v_pair.state = 'open' THEN
        v_configured_state := 'open';
        v_configured_open := v_pair.open_min;
        v_configured_close := v_pair.close_min;
        v_configured_hours_window := v_pair.label;
      ELSE
        v_configured_state := 'closed';
      END IF;
    END IF;
  END IF;

  IF v_configured_state = 'closed' THEN
    v_special := CASE WHEN v_hours_json IS NOT NULL
      THEN public._availability_find_special_day(v_hours_json, v_date_only)
      ELSE NULL
    END;
    RETURN jsonb_build_object(
      'slots', '[]'::jsonb,
      'floor_capacity', v_floor_capacity_top,
      'configured_hours_window', NULL,
      'unavailable_reason', 'closed',
      'message', CASE
        WHEN v_special IS NOT NULL AND (v_special ->> 'closed') = 'true' THEN
          CASE
            WHEN COALESCE(v_special ->> 'label', '') <> ''
              THEN 'Closed for ' || (v_special ->> 'label') || '.'
            ELSE 'This restaurant is closed on that date.'
          END
        ELSE 'No availability on that date.'
      END,
      'timezone', v_timezone
    );
  END IF;

  v_day_start_utc := (v_request_date::timestamp + time '00:00') AT TIME ZONE v_timezone;
  v_day_end_utc   := (v_request_date::timestamp + time '23:59') AT TIME ZONE v_timezone;

  FOR v_shift IN
    SELECT id, name, start_time, end_time, slot_duration_minutes,
           turn_time_minutes, max_covers, blackout_dates, advance_booking_days
    FROM public.shifts
    WHERE restaurant_id = p_restaurant_id
      AND is_active = true
      AND days_of_week @> ARRAY[v_dow]
    ORDER BY id ASC
  LOOP
    v_advance_days := COALESCE(v_shift.advance_booking_days, 30);
    v_max_booking_date := v_today + v_advance_days;
    IF v_request_date > v_max_booking_date THEN
      CONTINUE;
    END IF;

    IF v_shift.blackout_dates IS NOT NULL
       AND v_request_date = ANY(v_shift.blackout_dates) THEN
      CONTINUE;
    END IF;

    v_slot_inc := COALESCE(v_shift.slot_duration_minutes, 15);
    v_turn_mins := COALESCE(v_shift.turn_time_minutes, 90);
    -- BUOY: was COALESCE(v_shift.max_covers, 100). NULL means no cap.
    v_max_covers := v_shift.max_covers;

    v_slot_min := EXTRACT(HOUR FROM COALESCE(v_shift.start_time, time '17:00'))::int * 60
                + EXTRACT(MINUTE FROM COALESCE(v_shift.start_time, time '17:00'))::int;
    v_end_min := EXTRACT(HOUR FROM COALESCE(v_shift.end_time, time '23:00'))::int * 60
               + EXTRACT(MINUTE FROM COALESCE(v_shift.end_time, time '23:00'))::int;

    IF v_configured_state = 'open' THEN
      v_slot_min := GREATEST(v_slot_min, v_configured_open);
      v_end_min  := LEAST(v_end_min,  v_configured_close);
    END IF;
    IF v_end_min <= v_slot_min THEN
      CONTINUE;
    END IF;

    WHILE v_slot_min + v_turn_mins <= v_end_min LOOP
      v_slot_start_utc := (v_request_date::timestamp + (v_slot_min * interval '1 minute')) AT TIME ZONE v_timezone;
      v_slot_end_utc := v_slot_start_utc + (v_turn_mins * interval '1 minute');

      -- When max_covers is NULL we skip the SUM/cover-cap check entirely;
      -- the only ceiling becomes find_available_table_group, which respects
      -- restaurant_floor_capacity.
      IF v_max_covers IS NOT NULL THEN
        SELECT COALESCE(SUM(party_size), 0)::int
          INTO v_overlap_party
        FROM public.reservations r
        WHERE r.restaurant_id = p_restaurant_id
          AND r.shift_id = v_shift.id
          AND r.status IN ('pending', 'confirmed', 'seated')
          AND r.reserved_at >= v_day_start_utc
          AND r.reserved_at <= v_day_end_utc
          AND v_slot_start_utc < (r.reserved_at + (COALESCE(r.duration_minutes, v_turn_mins) * interval '1 minute'))
          AND v_slot_end_utc   > r.reserved_at;

        v_total_covers := p_party_size + v_overlap_party;
      ELSE
        v_total_covers := 0;
      END IF;

      IF v_max_covers IS NULL OR v_total_covers <= v_max_covers THEN
        v_candidates_count := v_candidates_count + 1;
        v_table_ids := public.find_available_table_group(
          p_restaurant_id  => p_restaurant_id,
          p_reserved_at    => v_slot_start_utc,
          p_party_size     => p_party_size,
          p_turn_minutes   => v_turn_mins
        );
        IF v_table_ids IS NULL OR array_length(v_table_ids, 1) IS NULL THEN
          v_table_blocked_count := v_table_blocked_count + 1;
        ELSE
          v_slot_obj := jsonb_build_object(
            'shift_id', v_shift.id,
            'shift_name', COALESCE(v_shift.name, 'Shift'),
            'date_time', to_char(
              v_slot_start_utc AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'table_ids', to_jsonb(v_table_ids::text[]),
            'duration_minutes', v_turn_mins
          );
          v_slots_arr := v_slots_arr || jsonb_build_array(v_slot_obj);
          IF jsonb_array_length(v_slots_arr) >= 48 THEN
            EXIT;
          END IF;
        END IF;
      END IF;

      v_slot_min := v_slot_min + v_slot_inc;
    END LOOP;

    IF jsonb_array_length(v_slots_arr) >= 48 THEN
      EXIT;
    END IF;
  END LOOP;

  IF jsonb_array_length(v_slots_arr) = 0
     AND v_candidates_count > 0
     AND v_table_blocked_count >= v_candidates_count THEN
    v_table_capacity_blocked := true;
  END IF;

  IF v_table_capacity_blocked THEN
    v_unavailable_reason := 'fully_booked';
    v_message := 'The restaurant is fully booked for that date.';
  ELSIF jsonb_array_length(v_slots_arr) = 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.shifts
      WHERE restaurant_id = p_restaurant_id
        AND is_active = true
        AND days_of_week @> ARRAY[v_dow]
    ) THEN
      v_message := 'No availability on that date.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'slots', v_slots_arr,
    'floor_capacity', v_floor_capacity_top,
    'configured_hours_window', v_configured_hours_window,
    'unavailable_reason', v_unavailable_reason,
    'message', v_message,
    'timezone', v_timezone
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. One-time data sweep: clear max_covers on every existing shift so all
-- restaurants benefit immediately. Owners who want to re-cap a shift can
-- update this column directly until the dashboard exposes it.
-- ---------------------------------------------------------------------------

UPDATE public.shifts SET max_covers = NULL;
