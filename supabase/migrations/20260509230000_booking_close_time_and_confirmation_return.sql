-- Two fixes surfaced by the 2026-05-09 end-to-end smoke test against the
-- live edge functions:
--
-- Bug A — Post-close start times accepted by the booking RPCs.
--   `get_available_slots` (close-time loop fixed earlier today in
--   20260509205914_*) refuses to OFFER 22:45 starts against an 11pm
--   close, but the booking RPCs trust the caller-supplied `date_time`.
--   `find_available_table_group` returns a table because no other
--   reservation conflicts, so the booking persists. Bypass: any client
--   that builds its own ISO timestamp (mobile, voice, curl, third party).
--   Fix: same-day shift bounds check inside `book_reservation`,
--   `modify_reservation_slot`, and `create_staff_reservation`. Mirrors
--   the `WHILE v_slot_min + v_turn_mins <= v_end_min` invariant from
--   `get_available_slots`. New error code: `P0008 'past_shift_close'`.
--   Overnight shifts (start > end) preserved as-is — the slot generator
--   doesn't generate slots for them today, so this isn't a regression;
--   adds in a follow-up alongside proper overnight slot generation.
--
-- Bug B — Confirmation code in API response / SMS / email doesn't match
--   the persisted DB value.
--   Trigger `reservations_confirmation_code` runs `generate_confirmation_code()`
--   which UNCONDITIONALLY sets `NEW.confirmation_code := upper(substr(md5(...),1,8))`.
--   `book_reservation`'s INSERT supplies `p_confirmation_code` but the
--   trigger overwrites it; the RPC's RETURN block then re-emits
--   `p_confirmation_code` (the input value), so the edge function's
--   `bookingRow.confirmation_code` is the placeholder, not the DB code.
--   Customer cannot manage their booking via that code (verified live:
--   401 "Invalid confirmation code"). Fix: capture the trigger-set
--   value via `RETURNING id, confirmation_code INTO ...` and return
--   that as the function's output. Trigger stays untouched (preserves
--   collision-resistance and is shared by every INSERT path).

-- ─────────────────────────────────────────────────────────────────────
-- book_reservation
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.book_reservation(
  p_restaurant_id uuid,
  p_shift_id uuid,
  p_reserved_at timestamp with time zone,
  p_party_size integer,
  p_turn_minutes integer,
  p_guest_id uuid,
  p_user_profile_id uuid,
  p_confirmation_code text,
  p_source text DEFAULT 'web',
  p_special_request text DEFAULT NULL,
  p_dietary_notes text DEFAULT NULL,
  p_occasion text DEFAULT NULL,
  p_is_guest_checkout boolean DEFAULT false,
  p_guest_full_name text DEFAULT NULL,
  p_guest_email text DEFAULT NULL,
  p_guest_phone text DEFAULT NULL,
  p_status text DEFAULT 'pending'
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

  -- Load shift hours + tz alongside max_covers so we can enforce the
  -- close-time bound in the same fetch.
  SELECT COALESCE(s.max_covers, 100), s.start_time, s.end_time
    INTO v_max_covers, v_shift_start, v_shift_end
  FROM public.shifts s
  WHERE s.id = p_shift_id AND s.restaurant_id = p_restaurant_id AND s.is_active;

  IF v_max_covers IS NULL THEN
    RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0003';
  END IF;

  v_timezone := COALESCE((SELECT timezone FROM public.restaurants WHERE id = p_restaurant_id), 'UTC');

  -- Bug A guard: the booking's start + turn must fit inside the shift
  -- window. Same-day shifts only; overnight (start > end) is preserved
  -- pending overnight slot-generator support.
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
    -- Bug B fix: capture the trigger-generated confirmation_code so the
    -- function output matches what landed in the row. Without this,
    -- callers (edge function, email/SMS, customer self-serve modify)
    -- received the input p_confirmation_code while the DB had a
    -- different value generated by the BEFORE INSERT trigger.
    -- NOTE: alias the table as `r` so RETURNING can disambiguate
    -- `confirmation_code` (otherwise the function's TABLE(...)-style OUT
    -- parameter `confirmation_code` collides — surfaces as
    -- "column reference confirmation_code is ambiguous").
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

  -- Load shift hours + tz alongside max_covers (Bug A — close-time guard).
  SELECT COALESCE(s.max_covers, 100), s.start_time, s.end_time
    INTO v_max_covers, v_shift_start, v_shift_end
  FROM public.shifts s
  WHERE s.id = p_shift_id AND s.restaurant_id = p_restaurant_id AND s.is_active;

  IF v_max_covers IS NULL THEN
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

  SELECT s.id, COALESCE(s.max_covers, 100), s.start_time, s.end_time
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

  -- Bug A guard: same-day shift bounds. Fires after the shift is matched
  -- so the existing "no shift covers this time" path still returns no
  -- match cleanly via the LIMIT 1 returning null.
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
