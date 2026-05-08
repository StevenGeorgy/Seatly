-- Phase 10a (SPEED_PLAN.md / CONCURRENCY_PLAN.md): in-database availability
-- result cache.
--
-- Customers, AI flows, and the edge function all read availability through
-- the same SQL function (`get_available_slots`). Previously each caller
-- recomputed the full slot list on every request — k6 measured a 24-active-
-- user ceiling at p95<1s on the live project.
--
-- This adds a tiny UNLOGGED cache table and a wrapper function that:
--   1. Looks up `(restaurant_id, date, party_size)` and returns the cached
--      payload if it was computed within the last 7 seconds.
--   2. Otherwise calls the canonical `get_available_slots` and stores the
--      result.
--
-- UNLOGGED tables skip WAL — perfect for a regenerable cache. The data is
-- lost on crash; the worst case is the cache rebuilds itself on the next
-- request.
--
-- TTL choice: 7 seconds. Long enough that bursts of concurrent users on the
-- same hot slot collapse into one DB compute; short enough that a freshly
-- booked slot disappears from availability views fast.
--
-- Booking writes are NEVER cached. `book_reservation` and
-- `modify_reservation_slot` continue to operate on live data; the exclusion
-- constraint is the unbreakable backstop.

CREATE UNLOGGED TABLE IF NOT EXISTS public.availability_cache (
  cache_key   text PRIMARY KEY,
  payload     jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- Periodic-ish cleanup of stale rows. We keep anything younger than 5 minutes
-- to give us headroom; older rows are pruned on next write.
CREATE INDEX IF NOT EXISTS idx_availability_cache_computed_at
  ON public.availability_cache (computed_at);

CREATE OR REPLACE FUNCTION public.get_available_slots_cached(
  p_restaurant_id uuid,
  p_date          text,
  p_party_size    integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key     text := p_restaurant_id::text || '|' || p_date || '|' || p_party_size::text;
  v_payload jsonb;
BEGIN
  -- Cache lookup. The PK index makes this an O(log N) read.
  SELECT payload INTO v_payload
  FROM public.availability_cache
  WHERE cache_key = v_key
    AND computed_at > now() - interval '7 seconds';

  IF v_payload IS NOT NULL THEN
    RETURN v_payload;
  END IF;

  -- Cache miss: compute fresh result.
  v_payload := public.get_available_slots(p_restaurant_id, p_date, p_party_size);

  -- Upsert. Multiple concurrent misses on the same key all attempt this; the
  -- last writer wins. That's fine — every result is correct at the time it
  -- was computed; the next miss starts a fresh 7-second window from there.
  INSERT INTO public.availability_cache (cache_key, payload, computed_at)
  VALUES (v_key, v_payload, now())
  ON CONFLICT (cache_key) DO UPDATE
    SET payload = EXCLUDED.payload,
        computed_at = EXCLUDED.computed_at;

  -- Opportunistic pruning. Keeps the table tiny without a separate cron.
  -- Only fires on cache miss, so the steady-state cost is negligible.
  DELETE FROM public.availability_cache
  WHERE computed_at < now() - interval '5 minutes';

  RETURN v_payload;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_available_slots_cached(uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_available_slots_cached(uuid, text, integer)
  TO service_role, authenticated, anon;
