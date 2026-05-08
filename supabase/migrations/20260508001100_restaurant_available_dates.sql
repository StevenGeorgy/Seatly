-- Phase 10c (SPEED_PLAN.md / CONCURRENCY_PLAN.md): batched modal date probe.
--
-- Opening the restaurant preview modal previously fired ~30 parallel
-- `fetchAvailabilitySlots` RPCs (one per day in the visible month) to figure
-- out which dates were bookable. This wrapper does the loop server-side and
-- returns just the array of dates that have ≥1 slot. Each per-day lookup
-- still flows through the 7-second cache (`get_available_slots_cached`), so
-- popular months become near-free across simultaneous viewers.
--
-- Output: text[] of YYYY-MM-DD dates (subset of [p_start_date, p_end_date])
-- where the cached availability payload has a non-empty slots array. Text
-- chosen so the value round-trips identically through PostgREST/JSON without
-- timezone surprises.

CREATE OR REPLACE FUNCTION public.restaurant_available_dates(
  p_restaurant_id uuid,
  p_party_size    integer,
  p_start_date    date,
  p_end_date      date
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dates text[] := ARRAY[]::text[];
  v_cursor date := p_start_date;
  v_payload jsonb;
BEGIN
  IF p_restaurant_id IS NULL OR p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RETURN v_dates;
  END IF;

  -- Hard cap on range size to prevent accidental year-long scans.
  IF p_end_date - p_start_date > 62 THEN
    RAISE EXCEPTION 'date range too large (max 62 days)' USING ERRCODE = '22023';
  END IF;

  WHILE v_cursor <= p_end_date LOOP
    v_payload := public.get_available_slots_cached(
      p_restaurant_id,
      to_char(v_cursor, 'YYYY-MM-DD'),
      GREATEST(1, COALESCE(p_party_size, 2))
    );

    IF jsonb_array_length(COALESCE(v_payload->'slots', '[]'::jsonb)) > 0 THEN
      v_dates := v_dates || to_char(v_cursor, 'YYYY-MM-DD');
    END IF;

    v_cursor := v_cursor + 1;
  END LOOP;

  RETURN v_dates;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restaurant_available_dates(uuid, integer, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.restaurant_available_dates(uuid, integer, date, date)
  TO service_role, authenticated, anon;
