-- Phase 11 follow-up: route create_staff_reservation through the same
-- protections as book_reservation.
--
-- Until now, the staff dashboard's create_staff_reservation skipped:
--   - the (restaurant_id, reserved_at) advisory lock,
--   - the diner-overlap pre-check (P0006),
--   - the cover-cap recheck under the lock.
--
-- The exclusion constraints (reservations_user_no_overlap and friends, plus
-- reservation_tables_no_overlap) made true double-books impossible, but the
-- staff caller saw raw 23P01 errors and concurrent staff creates didn't
-- serialize. This migration replaces the function so it acquires the lock
-- and runs the same pre-checks. Backwards-compatible: same arguments, same
-- return type, same audit log call. Adds a clean P0006 / diner_double_book
-- error code so the dashboard can map it to a friendly message.
--
-- The function still delegates physical table assignment to
-- assign_reservation_tables (which staff overload with manual table picks).
-- Cover-cap pre-check inside the lock prevents over-booking the shift.

DROP FUNCTION IF EXISTS public.create_staff_reservation(
  uuid, text, text, text, integer, timestamptz, text
);

CREATE OR REPLACE FUNCTION public.create_staff_reservation(
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
  v_turn_minutes integer;
  v_slot_end timestamptz;
  v_slot_range tstzrange;
  v_email_norm text;
  v_phone_norm text;
  v_overlap_id uuid;
  v_total_covers integer;
  v_max_covers integer;
  v_shift_id uuid;
BEGIN
  v_role := public.require_staff_role(p_restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);
  v_turn_minutes := COALESCE(public.restaurant_turn_time_minutes(p_restaurant_id), 90);

  IF p_party_size IS NULL OR p_party_size < 1 THEN
    RAISE EXCEPTION 'Party size must be at least 1.';
  END IF;
  IF p_reserved_at IS NULL THEN
    RAISE EXCEPTION 'Reservation time is required.' USING ERRCODE = '22023';
  END IF;

  v_slot_end := p_reserved_at + (v_turn_minutes * interval '1 minute');
  v_slot_range := tstzrange(p_reserved_at, v_slot_end, '[)');

  -- Same advisory-lock key as book_reservation / modify_reservation_slot, so
  -- a concurrent customer booking and staff create on the same slot
  -- serialize cleanly.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_restaurant_id::text || '|' || extract(epoch FROM p_reserved_at)::text)::bigint
  );

  v_email_norm := lower(NULLIF(trim(COALESCE(p_guest_email, '')), ''));
  v_phone_norm := NULLIF(regexp_replace(COALESCE(p_guest_phone, ''), '\D', '', 'g'), '');

  -- Diner-overlap pre-check. Staff bookings are always guest-checkout, so we
  -- match by lower(guest_email) and digits-only guest_phone. Same predicates
  -- as the partial exclusion constraints, surfaced as a clean P0006 error.
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

  -- Cover-cap recheck. We pick the active shift containing this slot — the
  -- staff dashboard typically lets staff override past closing time, so we
  -- only enforce when an active shift covers the requested time. If no
  -- shift covers it, fall through (staff can book outside service hours).
  SELECT s.id, COALESCE(s.max_covers, 100)
  INTO v_shift_id, v_max_covers
  FROM public.shifts s
  WHERE s.restaurant_id = p_restaurant_id
    AND s.is_active
    AND s.start_time IS NOT NULL
    AND s.end_time IS NOT NULL
    AND (
      (extract(epoch FROM (p_reserved_at::time - s.start_time)) >= 0
       AND extract(epoch FROM (p_reserved_at::time - s.end_time)) < 0)
      OR s.start_time > s.end_time
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

  -- Atomic INSERT. If the partial exclusion constraint somehow fires (a race
  -- between the pre-check and INSERT), surface the same P0006 code instead
  -- of the opaque 23P01.
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
$$;

GRANT EXECUTE ON FUNCTION public.create_staff_reservation(uuid, text, text, text, integer, timestamptz, text) TO authenticated, service_role;
