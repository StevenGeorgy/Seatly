-- Identifier-guard parity for the two non-public reservation writers, so
-- every path that creates or relocates a reservation surfaces the same
-- friendly P0007 'missing_identifier' error that book_reservation already
-- raises (added in 20260509081135_reservations_require_identifier.sql).
--
-- Why we need this:
--   * `create_staff_reservation` (dashboard host quick-add, floor service
--     form, reservation drawer) was relying on the table-level CHECK
--     constraint to catch all-null identifiers — surfaced as opaque
--     23514 to the frontend, which renders raw "new row for relation
--     reservations violates check constraint reservations_must_have_
--     identifier" in toast popups.
--   * `modify_reservation_slot` doesn't write identifier columns, so the
--     CHECK never fires for it. Guard reads the EXISTING row's
--     identifiers — defensive parity that catches any future regression
--     where modify gains an identifier-mutating param, and makes the
--     failure mode explicit if anyone ever tries to re-modify one of
--     the 16 grandfathered pre-CHECK rows.
--
-- Both bodies below are byte-identical to the deployed source captured
-- via `pg_get_functiondef`, with only the new guard + (for create_staff_
-- reservation) the WHEN check_violation rewrap added.

-- ─────────────────────────────────────────────────────────────────────
-- create_staff_reservation
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_staff_reservation(
  p_restaurant_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_party_size integer,
  p_reserved_at timestamp with time zone,
  p_special_request text DEFAULT NULL
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
  v_local_time time;
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

  -- Identifier guard: parity with book_reservation. Staff path has no
  -- user_profile_id parameter, so at least one of guest_email or
  -- guest_phone must be present.
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

  SELECT s.id, COALESCE(s.max_covers, 100)
  INTO v_shift_id, v_max_covers
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

  IF v_shift_id IS NOT NULL THEN
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
      restaurant_id,
      guest_id,
      shift_id,
      guest_full_name,
      guest_email,
      guest_phone,
      party_size,
      reserved_at,
      duration_minutes,
      special_request,
      status,
      confirmation_code,
      source,
      is_guest_checkout,
      confirmed_at
    )
    VALUES (
      p_restaurant_id,
      v_guest_id,
      v_shift_id,
      NULLIF(btrim(COALESCE(p_guest_name, '')), ''),
      public.crm_normalized_email(p_guest_email),
      NULLIF(btrim(COALESCE(p_guest_phone, '')), ''),
      p_party_size,
      p_reserved_at,
      v_turn_minutes,
      NULLIF(btrim(COALESCE(p_special_request, '')), ''),
      'confirmed',
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
      'dashboard',
      true,
      now()
    )
    RETURNING id INTO v_reservation_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'diner_double_book' USING ERRCODE = 'P0006';
    WHEN check_violation THEN
      -- Surfaces reservations_must_have_identifier as a friendly error, not 23514.
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

-- ─────────────────────────────────────────────────────────────────────
-- modify_reservation_slot
-- ─────────────────────────────────────────────────────────────────────
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

  -- Identifier guard: defensive parity with book_reservation /
  -- create_staff_reservation. Modify never writes identifier columns,
  -- so this only fires for pre-CHECK grandfathered rows. Surface a
  -- friendly P0007 instead of letting downstream overlap checks
  -- silently no-op (their partial WHERE clauses skip rows whose
  -- identifier columns are all null).
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
    AND r.id <> p_reservation_id
    AND r.status IN ('pending', 'confirmed', 'seated')
    AND r.reserved_at < v_slot_end
    AND r.reserved_at + (COALESCE(NULLIF(r.duration_minutes, 0), v_turn) * interval '1 minute') > p_new_reserved_at;

  IF v_total_covers + p_new_party_size > v_max_covers THEN
    RAISE EXCEPTION 'over_cover_cap' USING ERRCODE = 'P0002';
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
