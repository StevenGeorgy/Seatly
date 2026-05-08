-- Phase 10d (CONCURRENCY_PLAN.md): application-level rate limiting.
--
-- Belt-and-braces protection on the booking write endpoints. Supabase's
-- platform-level PostgREST throttle handles raw request floods; this layer
-- protects against abuse on EXPENSIVE operations (creating reservations,
-- modifying reservations) where each call holds an advisory lock and writes
-- multiple rows.
--
-- Strategy: fixed-window counter keyed on (endpoint|identifier|window_start).
-- Identifier is the caller's IP for anon and the auth user_id for logged-in
-- users. UNLOGGED table — losing the counter on crash is fine; worst case is
-- a brief reset of limits.
--
-- Why fixed-window not sliding-window: cheaper (one PK lookup, one upsert)
-- and the burst-at-window-edge anomaly doesn't matter for human-rate booking
-- traffic. The window resets at most every 60s.

CREATE UNLOGGED TABLE IF NOT EXISTS public.rate_limit_buckets (
  bucket_key   text PRIMARY KEY,
  hit_count    integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_window_start
  ON public.rate_limit_buckets (window_start);

-- Returns TRUE if the call is allowed (count <= limit AFTER incrementing),
-- FALSE if the limit is exceeded. Always increments — i.e. denied calls also
-- count toward the next window's allowance, which discourages retry storms.
--
-- p_key                : free-form bucket key. Callers should namespace
--                        ("book|ip|1.2.3.4", "modify|user|abc-uuid").
-- p_limit              : max allowed within the window.
-- p_window_seconds     : window length in seconds.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key            text,
  p_limit          integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz;
  v_window_key text;
  v_count integer;
BEGIN
  IF p_key IS NULL OR p_limit IS NULL OR p_limit < 1 OR p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RETURN TRUE;
  END IF;

  -- Truncate to the window. All callers within the same window share the
  -- same bucket regardless of when they hit it.
  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );
  v_window_key := p_key || '|' || extract(epoch FROM v_window_start)::bigint::text;

  INSERT INTO public.rate_limit_buckets (bucket_key, hit_count, window_start)
  VALUES (v_window_key, 1, v_window_start)
  ON CONFLICT (bucket_key) DO UPDATE
    SET hit_count = public.rate_limit_buckets.hit_count + 1
  RETURNING hit_count INTO v_count;

  -- Opportunistic cleanup of buckets older than 1 hour. Keeps the table
  -- tiny without a separate cron job.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_buckets
    WHERE window_start < now() - interval '1 hour';
  END IF;

  RETURN v_count <= p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer)
  TO service_role, authenticated;
