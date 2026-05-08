-- Phase 11 UX: surface 6 future slots per restaurant card instead of 3.
--
-- The original compact RPC (20260508001300) capped at 3 because that was all
-- the listing rendered. Customer feedback: 6 gives a much better feel for a
-- restaurant's availability without changing payload shape. Each slot is
-- still stripped of `table_ids` for bandwidth.

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

    SELECT COALESCE(jsonb_agg(slot - 'table_ids' ORDER BY (slot->>'date_time')::timestamptz), '[]'::jsonb)
    INTO v_compact_slots
    FROM (
      SELECT slot
      FROM jsonb_array_elements(COALESCE(v_payload->'slots', '[]'::jsonb)) AS slot
      WHERE (slot->>'date_time')::timestamptz >= v_now
      ORDER BY (slot->>'date_time')::timestamptz
      LIMIT 6
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
