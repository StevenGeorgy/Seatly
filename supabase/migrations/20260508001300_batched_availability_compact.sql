-- Lever 3 (Phase 10 follow-up): compact batched listing RPC.
--
-- Discover/Deals only renders the first 3 upcoming slot pills per card, but
-- `get_available_slots_for_restaurants` returns up to 48 slots × ~10 fields
-- per restaurant — most of that is unused on the listing surface. This
-- compact variant returns only what the listing UI consumes:
--   - first 3 FUTURE slots per restaurant (already in date_time order)
--   - each slot stripped of `table_ids` (the booking page re-fetches with
--     full slot data, so the listing doesn't need them)
--   - top-level `floor_capacity` + `timezone` preserved for parity with the
--     non-compact variant
--
-- Effect: payload shrinks roughly 10–20× per response, which raises the
-- per-rps ceiling at the same bandwidth/CPU and speeds up parse on the
-- client side. Each lookup still goes through `get_available_slots_cached`
-- so the 20-second cache continues to dedupe.

CREATE OR REPLACE FUNCTION public.get_available_slots_for_restaurants_compact(
  p_restaurant_ids uuid[],
  p_date           text,
  p_party_size     integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_id uuid;
  v_payload jsonb;
  v_compact_slots jsonb;
  v_now timestamptz := now();
BEGIN
  IF p_restaurant_ids IS NULL OR array_length(p_restaurant_ids, 1) IS NULL THEN
    RETURN v_result;
  END IF;

  FOREACH v_id IN ARRAY p_restaurant_ids LOOP
    v_payload := public.get_available_slots_cached(v_id, p_date, p_party_size);

    -- First 3 future slots in date_time order, with table_ids removed.
    SELECT COALESCE(jsonb_agg(slot - 'table_ids' ORDER BY (slot->>'date_time')::timestamptz), '[]'::jsonb)
    INTO v_compact_slots
    FROM (
      SELECT slot
      FROM jsonb_array_elements(COALESCE(v_payload->'slots', '[]'::jsonb)) AS slot
      WHERE (slot->>'date_time')::timestamptz >= v_now
      ORDER BY (slot->>'date_time')::timestamptz
      LIMIT 3
    ) trimmed;

    v_result := v_result || jsonb_build_object(v_id::text, jsonb_build_object(
      'slots', v_compact_slots,
      'floor_capacity', v_payload->'floor_capacity',
      'timezone', v_payload->'timezone'
    ));
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_available_slots_for_restaurants_compact(uuid[], text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_available_slots_for_restaurants_compact(uuid[], text, integer)
  TO service_role, authenticated, anon;
