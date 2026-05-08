-- Phase 11 hotfix: modify_reservation_slot self-blocks on its own
-- denormalized table_id.
--
-- Repro: a reservation R has table_id=T (set when it was originally booked).
-- User edits R to a new time. The RPC:
--   1. Releases R's reservation_tables (sets released_at), so they no longer
--      contribute to the partial-index UNION clause inside
--      find_available_table_group.
--   2. UPDATEs R's reserved_at + party_size to the new values.
--   3. Calls find_available_table_group(restaurant, NEW_at, party, turn)
--      — WITHOUT passing R as p_exclude_reservation_id.
--
-- The second UNION clause inside find_available_table_group selects table_id
-- from reservations where status='active' AND the reserved_at window
-- overlaps the requested slot. After step 2 R's reserved_at IS the new slot,
-- so R appears as overlapping and its (still-denormalized) table_id T is
-- treated as blocked. With T removed from the candidate pool, large-party
-- modifies that need many tables fail with P0001 'no_table' even though
-- the actual physical state is fine.
--
-- Fix: pass p_reservation_id to find_available_table_group so the UNION
-- clause excludes R via `r.id <> p_exclude_reservation_id`.
--
-- This only affects modify_reservation_slot. book_reservation creates a new
-- row whose table_id is set AFTER the INSERT + table-group lookup, so it
-- cannot self-block.

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

  -- IMPORTANT: pass p_reservation_id so find_available_table_group's
  -- UNION-on-reservations.table_id clause doesn't see the just-updated row
  -- as blocking its own slot.
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
$$;

REVOKE EXECUTE ON FUNCTION public.modify_reservation_slot(
  uuid, uuid, uuid, timestamptz, integer, integer
) FROM anon;

GRANT EXECUTE ON FUNCTION public.modify_reservation_slot(
  uuid, uuid, uuid, timestamptz, integer, integer
) TO service_role, authenticated;
