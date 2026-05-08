-- Phase F (CONCURRENCY_PLAN.md): atomic reservation slot modification.
--
-- Companion to book_reservation. Same advisory-lock key on
-- (restaurant_id, new reserved_at) so concurrent modifies and fresh bookings
-- serialize against each other on a hot slot.
--
-- Order of operations inside the transaction:
--   1. Acquire advisory lock on the NEW slot.
--   2. Validate reservation exists, belongs to the restaurant, and is in a
--      modifiable status.
--   3. Validate the target shift exists and is active.
--   4. Cover-cap recheck for the new slot, excluding this reservation by id.
--   5. Release current reservation_tables rows so they no longer count under
--      the exclusion constraint partial index (released_at IS NOT NULL).
--   6. UPDATE the reservation (reserved_at, party_size, shift_id,
--      duration_minutes). The propagate trigger only touches non-released
--      child rows, so the just-released ones stay frozen at their old range.
--   7. find_available_table_group on the new slot (released rows are already
--      out of the partial index, so no exclusion list needed).
--   8. Insert new reservation_tables rows (BEFORE INSERT trigger sets
--      slot_range from the now-updated parent reservation).
--   9. Set reservations.table_id to the primary table and bump updated_at.
--
-- Returns the same shape as book_reservation. Raises:
--   P0001 'no_table'         — no fitting tables for the new slot.
--   P0002 'over_cover_cap'   — shift would exceed max_covers.
--   P0003 'shift_not_found'  — shift_id invalid or inactive.
--   P0004 'not_modifiable'   — reservation status is not pending/confirmed.
--   22023 'invalid_arguments' — null/zero inputs.
--   23P01                    — exclusion constraint backstop (extremely rare
--                              under the lock; edge function should still map
--                              this to a 409 slot_taken).

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
  v_max_covers integer;
  v_total_covers integer;
  v_table_ids uuid[];
  v_status text;
  v_reservation_restaurant uuid;
  v_request_role text;
  v_table_id uuid;
  v_index integer := 1;
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

  -- Same role guard as book_reservation / assign_reservation_tables.
  v_request_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  IF v_request_role <> '' AND v_request_role <> 'service_role' THEN
    PERFORM public.require_staff_role(p_restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);
  END IF;

  v_turn := COALESCE(NULLIF(p_turn_minutes, 0), public.restaurant_turn_time_minutes(p_restaurant_id), 90);
  v_slot_end := p_new_reserved_at + make_interval(mins => v_turn);

  -- Lock the NEW slot. Same hash function as book_reservation so a fresh
  -- booking and a modify targeting the same slot serialize cleanly.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_restaurant_id::text || '|' || extract(epoch FROM p_new_reserved_at)::text)::bigint
  );

  -- Reservation existence + ownership + modifiable status.
  SELECT restaurant_id, status
  INTO v_reservation_restaurant, v_status
  FROM public.reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_reservation_restaurant IS NULL OR v_reservation_restaurant <> p_restaurant_id THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0005';
  END IF;
  IF COALESCE(v_status, 'pending') NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'not_modifiable' USING ERRCODE = 'P0004';
  END IF;

  -- Shift validation.
  SELECT COALESCE(s.max_covers, 100) INTO v_max_covers
  FROM public.shifts s
  WHERE s.id = p_shift_id AND s.restaurant_id = p_restaurant_id AND s.is_active;

  IF v_max_covers IS NULL THEN
    RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0003';
  END IF;

  -- Cover-cap recheck for the NEW slot, excluding this reservation by id so
  -- it doesn't conflict with itself.
  SELECT COALESCE(SUM(r.party_size), 0)::integer INTO v_total_covers
  FROM public.reservations r
  WHERE r.restaurant_id = p_restaurant_id
    AND r.shift_id = p_shift_id
    AND r.id <> p_reservation_id
    AND r.status IN ('pending', 'confirmed', 'seated')
    AND r.reserved_at < v_slot_end
    AND r.reserved_at + make_interval(mins => COALESCE(NULLIF(r.duration_minutes, 0), v_turn)) > p_new_reserved_at;

  IF v_total_covers + p_new_party_size > v_max_covers THEN
    RAISE EXCEPTION 'over_cover_cap' USING ERRCODE = 'P0002';
  END IF;

  -- Note: the OUT column names are prefixed `out_` so they don't collide with
  -- the `reservation_id` column on `reservation_tables` inside this function
  -- body (PG raises a 42702 if both names are visible in the same scope).
  --
  -- Release current reservation_tables BEFORE the reservation update so the
  -- propagate trigger doesn't try to re-range them into the new slot (which
  -- could collide with another booking the lock already protects against,
  -- but we want a clean release-then-insert flow regardless).
  UPDATE public.reservation_tables rt
  SET released_at = now()
  WHERE rt.reservation_id = p_reservation_id
    AND rt.released_at IS NULL;

  -- Update the parent reservation with the new slot/party/shift/duration.
  UPDATE public.reservations
  SET reserved_at = p_new_reserved_at,
      party_size = p_new_party_size,
      shift_id = p_shift_id,
      duration_minutes = v_turn,
      updated_at = now()
  WHERE id = p_reservation_id;

  -- Find tables for the new slot. Released rows are already out of the
  -- partial index, so no need to pass an exclude list.
  v_table_ids := public.find_available_table_group(
    p_restaurant_id,
    p_new_reserved_at,
    p_new_party_size,
    v_turn
  );

  IF COALESCE(array_length(v_table_ids, 1), 0) = 0 THEN
    -- No tables for the new slot. Bail out; the surrounding transaction
    -- rollback restores the original reservation row and the released
    -- reservation_tables rows (released_at goes back to NULL).
    RAISE EXCEPTION 'no_table' USING ERRCODE = 'P0001';
  END IF;

  -- Insert new reservation_tables rows. BEFORE INSERT trigger reads the
  -- now-updated parent reservation and sets slot_range to the new window.
  FOREACH v_table_id IN ARRAY v_table_ids LOOP
    INSERT INTO public.reservation_tables (
      restaurant_id, reservation_id, table_id, is_primary
    ) VALUES (
      p_restaurant_id, p_reservation_id, v_table_id, v_index = 1
    );
    v_index := v_index + 1;
  END LOOP;

  -- Mirror book_reservation: keep the denormalized table_id pointer in sync.
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
