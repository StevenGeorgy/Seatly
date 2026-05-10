-- Bug fix: two reservations with all of (user_profile_id, guest_email, guest_phone)
-- null landed at the same restaurant + slot. The three partial GiST exclusions
-- (reservations_user_no_overlap, reservations_guest_email_no_overlap,
-- reservations_guest_phone_no_overlap) are partial WHERE clauses that require
-- at least one of those identifiers to fire — so when all are null, the check
-- silently doesn't apply. The book_reservation overlap pre-check has the same
-- gap. Result: the same diner could double-book any restaurant just by going
-- through a path that doesn't capture email or phone.
--
-- Two-part fix:
--   1) CHECK constraint on the table — every reservation must carry at least
--      one of the three traditional identifiers. NOT VALID so we don't have
--      to rewrite historical rows; new INSERTs/UPDATEs are enforced.
--   2) book_reservation — raise 'missing_identifier' early so callers get a
--      friendly 4xx instead of an opaque constraint violation.

-- ── Part 1: CHECK constraint ────────────────────────────────────────────────
alter table public.reservations
  add constraint reservations_must_have_identifier
  check (
    user_profile_id is not null
    or (guest_email is not null and length(trim(guest_email)) > 0)
    or (guest_phone is not null and regexp_replace(guest_phone, '\D', '', 'g') <> '')
  ) not valid;

-- ── Part 2: book_reservation early guard ────────────────────────────────────
create or replace function public.book_reservation(
  p_restaurant_id uuid,
  p_shift_id uuid,
  p_reserved_at timestamp with time zone,
  p_party_size integer,
  p_turn_minutes integer,
  p_guest_id uuid,
  p_user_profile_id uuid,
  p_confirmation_code text,
  p_source text default 'web',
  p_special_request text default null,
  p_dietary_notes text default null,
  p_occasion text default null,
  p_is_guest_checkout boolean default false,
  p_guest_full_name text default null,
  p_guest_email text default null,
  p_guest_phone text default null,
  p_status text default 'pending'
)
returns table(reservation_id uuid, confirmation_code text, table_ids uuid[], duration_minutes integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- Identifier guard: every reservation must carry at least one of
  -- user_profile_id / guest_email / guest_phone so the overlap check has
  -- something to match against. Fail early with a friendly error rather
  -- than relying on the CHECK constraint to surface as 23514.
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
      RAISE EXCEPTION 'diner_double_book' USING ERRCODE = 'P0006';
    WHEN check_violation THEN
      -- Surfaces reservations_must_have_identifier as a friendly error, not 23514.
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
  confirmation_code := p_confirmation_code;
  table_ids := v_table_ids;
  duration_minutes := v_turn;
  RETURN NEXT;
END;
$function$;
