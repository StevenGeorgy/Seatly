-- Phase 10b (SPEED_PLAN.md / CONCURRENCY_PLAN.md): batched listing
-- availability for Discover/Deals.
--
-- Discover/Deals fired one `get_available_slots_cached` RPC per visible card —
-- 20 cards meant 20 round trips per filter change. This wrapper accepts an
-- array of restaurant_ids and returns a single jsonb object keyed by id.
--
-- Each per-restaurant lookup still goes through the cached function so the
-- 7-second cache continues to dedupe across simultaneous viewers. The win
-- here is collapsing the network/PostgREST hops, not the DB compute itself
-- (Phase 10a already collapsed that).
--
-- Returns: { "<uuid>": <get_available_slots_cached payload>, ... }.
-- A restaurant id with no rows still appears in the map with the function's
-- normal "no slots" payload — callers don't have to special-case missing keys.

CREATE OR REPLACE FUNCTION public.get_available_slots_for_restaurants(
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
BEGIN
  IF p_restaurant_ids IS NULL OR array_length(p_restaurant_ids, 1) IS NULL THEN
    RETURN v_result;
  END IF;

  FOREACH v_id IN ARRAY p_restaurant_ids LOOP
    v_payload := public.get_available_slots_cached(v_id, p_date, p_party_size);
    v_result := v_result || jsonb_build_object(v_id::text, v_payload);
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_available_slots_for_restaurants(uuid[], text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_available_slots_for_restaurants(uuid[], text, integer)
  TO service_role, authenticated, anon;
