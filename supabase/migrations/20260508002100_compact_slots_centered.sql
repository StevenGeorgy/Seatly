-- Phase 11 UX: centered windowing on the compact slots RPC.
--
-- Previous behavior: returned the first 6 future slots after now() per
-- restaurant, regardless of the user's requested time. So if you asked for
-- 7:00 PM and the only opening was 8:00 PM, you saw 8:00–9:15 PM and never
-- the 6:00–6:45 PM slots that were also bookable. OpenTable's pattern
-- shows alternatives on BOTH sides of the requested time.
--
-- New behavior: when the caller passes `p_target_time` ("HH:MM" 24h, in
-- restaurant local time), return up to 3 slots strictly before the target
-- + up to 3 slots at-or-after the target, ordered chronologically. If
-- either bucket has fewer than 3, backfill from whichever side has more.
-- If `p_target_time` is NULL or unparseable, fall back to the original
-- "first 6 future slots" behavior.
--
-- Empty-day fallback: if there are < 6 total bookable slots, returns
-- whatever exists. The caller decides whether to render "No times" copy.

DROP FUNCTION IF EXISTS public.get_available_slots_for_restaurants_compact(uuid[], text, integer);

CREATE OR REPLACE FUNCTION public.get_available_slots_for_restaurants_compact(
  p_restaurant_ids uuid[],
  p_date           text,
  p_party_size     integer,
  p_target_time    text DEFAULT NULL
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
  v_timezone text;
  v_target_ts timestamptz;
BEGIN
  IF p_restaurant_ids IS NULL OR array_length(p_restaurant_ids, 1) IS NULL THEN
    RETURN v_result;
  END IF;

  FOREACH v_id IN ARRAY p_restaurant_ids LOOP
    v_payload := public.get_available_slots_cached(v_id, p_date, p_party_size);
    v_timezone := COALESCE(v_payload->>'timezone', 'UTC');

    -- Restaurant-local target timestamp. NULL when caller didn't pass a
    -- target or the format is wrong; in that case we fall back to the
    -- "first 6 future" behavior at the bottom of this branch.
    v_target_ts := NULL;
    IF p_target_time IS NOT NULL AND p_target_time ~ '^\d{1,2}:\d{2}$' THEN
      BEGIN
        v_target_ts := (p_date || 'T' || p_target_time || ':00')::timestamp AT TIME ZONE v_timezone;
      EXCEPTION WHEN OTHERS THEN
        v_target_ts := NULL;
      END;
    END IF;

    IF v_target_ts IS NULL THEN
      -- Fallback: first 6 future slots in chronological order.
      SELECT COALESCE(jsonb_agg(slot - 'table_ids' ORDER BY (slot->>'date_time')::timestamptz), '[]'::jsonb)
      INTO v_compact_slots
      FROM (
        SELECT slot
        FROM jsonb_array_elements(COALESCE(v_payload->'slots', '[]'::jsonb)) AS slot
        WHERE (slot->>'date_time')::timestamptz >= v_now
        ORDER BY (slot->>'date_time')::timestamptz
        LIMIT 6
      ) trimmed;
    ELSE
      -- Centered: 3 before + 3 at/after, then backfill from the larger side
      -- so the user always sees up to 6 alternatives on whichever side has
      -- supply.
      WITH all_future AS (
        SELECT slot, (slot->>'date_time')::timestamptz AS slot_ts
        FROM jsonb_array_elements(COALESCE(v_payload->'slots', '[]'::jsonb)) AS slot
        WHERE (slot->>'date_time')::timestamptz >= v_now
      ),
      before_target AS (
        SELECT slot, slot_ts
        FROM all_future
        WHERE slot_ts < v_target_ts
        ORDER BY slot_ts DESC
        LIMIT 3
      ),
      at_or_after AS (
        SELECT slot, slot_ts
        FROM all_future
        WHERE slot_ts >= v_target_ts
        ORDER BY slot_ts ASC
        LIMIT 3
      ),
      core AS (
        SELECT slot, slot_ts FROM before_target
        UNION ALL
        SELECT slot, slot_ts FROM at_or_after
      ),
      backfill AS (
        SELECT slot, slot_ts
        FROM all_future
        WHERE slot_ts NOT IN (SELECT slot_ts FROM core)
        ORDER BY ABS(EXTRACT(EPOCH FROM (slot_ts - v_target_ts)))
        LIMIT GREATEST(0, 6 - (SELECT count(*) FROM core))
      ),
      combined AS (
        SELECT slot, slot_ts FROM core
        UNION ALL
        SELECT slot, slot_ts FROM backfill
      )
      SELECT COALESCE(jsonb_agg(slot - 'table_ids' ORDER BY slot_ts), '[]'::jsonb)
      INTO v_compact_slots
      FROM combined;
    END IF;

    v_result := v_result || jsonb_build_object(v_id::text, jsonb_build_object(
      'slots', v_compact_slots,
      'floor_capacity', v_payload->'floor_capacity',
      'timezone', v_payload->'timezone'
    ));
  END LOOP;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_available_slots_for_restaurants_compact(uuid[], text, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_available_slots_for_restaurants_compact(uuid[], text, integer, text)
  TO service_role, authenticated, anon;
