-- Phase C (CONCURRENCY_PLAN.md): atomic reservation booking.
--
-- Wraps the entire happy path (cover-cap check + table selection + reservation
-- insert + reservation_tables insert + denormalized table_id update) in one
-- transaction with an advisory lock keyed on (restaurant_id, reserved_at).
-- Two concurrent calls for the same slot serialize cleanly: the second one
-- enters under the lock, sees the first's reservation_tables rows, and either
-- finds a different available table or returns no_table.
--
-- The exclusion constraint from Phase B remains the unbreakable backstop —
-- this function exists to turn would-be DB-level rejections into a friendly
-- "no_table" path before the constraint ever needs to fire.
--
-- Returns a single row: (reservation_id, confirmation_code, table_ids,
-- duration_minutes). On failure raises with one of:
--   SQLSTATE 'P0001' message 'no_table' — the slot has no fitting tables.
--   SQLSTATE 'P0002' message 'over_cover_cap' — shift has hit its max_covers.
--   SQLSTATE '23P01' (exclusion_violation) — backstop fired (extremely rare).
-- Edge-function callers should translate all three to a 409 slot_taken UX.

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
  p_guest_phone        text DEFAULT NULL
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
BEGIN
  IF p_restaurant_id IS NULL OR p_shift_id IS NULL OR p_reserved_at IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  -- Mirror the role guard used by assign_reservation_tables: customer-facing
  -- edge functions call this with service_role; staff calls go through staff
  -- role check.
  v_request_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  IF v_request_role <> '' AND v_request_role <> 'service_role' THEN
    PERFORM public.require_staff_role(p_restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);
  END IF;

  v_turn := COALESCE(NULLIF(p_turn_minutes, 0), public.restaurant_turn_time_minutes(p_restaurant_id), 90);
  v_slot_end := p_reserved_at + make_interval(mins => v_turn);

  -- Advisory lock keyed on (restaurant, slot start epoch). Held until the
  -- transaction commits or rolls back. Concurrent callers for the same
  -- slot serialize here.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_restaurant_id::text || '|' || extract(epoch FROM p_reserved_at)::text)::bigint
  );

  -- Cover-cap check, run UNDER the lock so the count cannot drift between
  -- here and the insert below. Mirrors the JS check in
  -- supabase/functions/create-public-booking/index.ts L283-310.
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

  -- Pick tables under the lock. Because the lock serializes same-slot
  -- callers, the result here will not race against another concurrent
  -- assignment on this slot.
  v_table_ids := public.find_available_table_group(
    p_restaurant_id,
    p_reserved_at,
    p_party_size,
    v_turn
  );

  IF COALESCE(array_length(v_table_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'no_table' USING ERRCODE = 'P0001';
  END IF;

  -- Atomic insert + assignment.
  INSERT INTO public.reservations (
    restaurant_id, guest_id, user_profile_id, shift_id, party_size, reserved_at,
    duration_minutes, status, source, confirmation_code,
    special_request, dietary_notes, occasion,
    is_guest_checkout, guest_full_name, guest_email, guest_phone
  ) VALUES (
    p_restaurant_id, p_guest_id, p_user_profile_id, p_shift_id, p_party_size, p_reserved_at,
    v_turn, 'pending', COALESCE(p_source, 'web'), p_confirmation_code,
    p_special_request, p_dietary_notes, p_occasion,
    p_is_guest_checkout, p_guest_full_name, p_guest_email, p_guest_phone
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
  uuid, uuid, timestamptz, integer, integer, uuid, uuid, text, text, text, text, text, boolean, text, text, text
) TO service_role, authenticated;
