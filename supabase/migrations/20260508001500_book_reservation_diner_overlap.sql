-- Phase 11 follow-up: bake diner double-book prevention into book_reservation
-- and modify_reservation_slot.
--
-- The 20260508001400 migration added partial exclusion constraints. Those are
-- correctness backstops — they raise SQLSTATE 23P01 (exclusion_violation),
-- which is opaque. The RPCs below pre-check the same conditions under the
-- advisory lock and raise a clean SQLSTATE P0006 'diner_double_book' so the
-- edge function and clients can map it to a friendly 409.
--
-- Error codes after this migration (across both RPCs):
--   P0001 'no_table'             — no fitting tables for the slot
--   P0002 'over_cover_cap'       — shift would exceed max_covers
--   P0003 'shift_not_found'      — shift_id invalid or inactive
--   P0004 'not_modifiable'       — modify_reservation_slot only: bad status
--   P0005 'reservation_not_found'— modify_reservation_slot only
--   P0006 'diner_double_book'    — same diner has overlapping active booking
--   22023 'invalid_arguments'    — null/zero inputs
--   23P01                        — exclusion constraint backstop (treat as
--                                  P0006 in callers)

DROP FUNCTION IF EXISTS public.book_reservation(
  uuid, uuid, timestamptz, integer, integer, uuid, uuid, text, text, text, text, text, boolean, text, text, text, text
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
  v_slot_end := p_reserved_at + (v_turn * interval '1 minute');
  v_slot_range := tstzrange(p_reserved_at, v_slot_end, '[)');

  PERFORM pg_advisory_xact_lock(
    hashtext(p_restaurant_id::text || '|' || extract(epoch FROM p_reserved_at)::text)::bigint
  );

  -- Diner double-book pre-check. Logged-in users match by user_profile_id;
  -- guest checkouts by lower(email) or digits-only phone. Same predicates as
  -- the partial exclusion constraints, surfaced as a clean error code.
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
    v_email_norm := lower(NULLIF(trim(COALESCE(p_guest_email, '')), ''));
    v_phone_norm := NULLIF(regexp_replace(COALESCE(p_guest_phone, ''), '\D', '', 'g'), '');

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
  EXCEPTION
    WHEN exclusion_violation THEN
      -- The user/email/phone exclusion constraint fired (race between the
      -- pre-check and insert). Surface the same friendly code.
      RAISE EXCEPTION 'diner_double_book' USING ERRCODE = 'P0006';
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
  confirmation_code := p_confirmation_code;
  table_ids := v_table_ids;
  duration_minutes := v_turn;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_reservation(
  uuid, uuid, timestamptz, integer, integer, uuid, uuid, text, text, text, text, text, boolean, text, text, text, text
) TO service_role, authenticated;

-- modify_reservation_slot: same diner-overlap pre-check, excluding self.
CREATE OR REPLACE FUNCTION public.modify_reservation_slot(
  p_reservation_id    uuid,
  p_restaurant_id     uuid,
  p_shift_id          uuid,
  p_new_reserved_at   timestamptz,
  p_new_party_size    integer,
  p_turn_minutes      integer
)
RETURNS TABLE (
  out_reservation_id uuid,
  out_table_ids      uuid[],
  out_duration       integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Diner double-book pre-check (excluding self).
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
    v_email_norm := lower(NULLIF(trim(COALESCE(v_guest_email, '')), ''));
    v_phone_norm := NULLIF(regexp_replace(COALESCE(v_guest_phone, ''), '\D', '', 'g'), '');

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
    v_turn
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
$$;

REVOKE EXECUTE ON FUNCTION public.modify_reservation_slot(
  uuid, uuid, uuid, timestamptz, integer, integer
) FROM anon;

GRANT EXECUTE ON FUNCTION public.modify_reservation_slot(
  uuid, uuid, uuid, timestamptz, integer, integer
) TO service_role, authenticated;
