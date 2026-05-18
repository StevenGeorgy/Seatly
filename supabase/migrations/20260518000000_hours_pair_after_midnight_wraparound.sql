-- 2026-05-18: fix availability for restaurants that close after midnight.
--
-- Bug: `_availability_read_hours_pair` rejected any open/close pair whose
-- close-minute value was less than or equal to the open-minute value
-- (line 139 of the original 20260508000600_get_available_slots.sql). The
-- minutes-since-midnight comparison broke for any "5pm to 12am", "5pm to
-- 1am" etc. wraparound — close wraps to 0/60/120 while open is 1020,
-- so close < open → function returned 'closed'.
--
-- Effect: every restaurant whose hours_json closed after midnight was
-- silently unbookable on those nights. STK Toronto and The Keg Mansion
-- were both stuck — Thursday, Friday, Saturday all reported "closed" with
-- 0 reservations on the dashboard (because nobody could ever book).
--
-- Fix: when close <= open in minutes-since-midnight, treat the close as
-- the NEXT calendar day and add 1440 (24h) to the close minute. The slot
-- enumeration loop in get_available_slots adds Postgres `interval` to the
-- request date — `2026-05-22 00:00 + interval '1500 minute'` natively
-- resolves to 2026-05-23 01:00 UTC offset, so no further changes are
-- needed there. The shift's own end_time still caps last seating; this
-- patch only stops the hours-window check from turning the day "closed"
-- before slot enumeration runs.
--
-- Mirrors the existing TS-side helper in `_shared/hours.ts:54-60` which
-- already handles wraparound correctly via `closeMinutes += 24 * 60`.
--
-- Equality (open == close) stays "closed" (zero-length window, not 24h).
-- Both NULLs stay "closed". Only close < open triggers wraparound.

CREATE OR REPLACE FUNCTION public._availability_read_hours_pair(p_obj jsonb)
RETURNS TABLE(state text, open_min int, close_min int, label text)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_open_value text;
  v_close_value text;
  v_open int;
  v_close int;
BEGIN
  IF p_obj IS NULL OR jsonb_typeof(p_obj) <> 'object' THEN
    RETURN QUERY SELECT 'closed'::text, NULL::int, NULL::int, NULL::text;
    RETURN;
  END IF;
  IF (p_obj ->> 'closed') = 'true'
     OR (p_obj ->> 'is_closed') = 'true'
     OR (p_obj ->> 'open') = 'false' THEN
    RETURN QUERY SELECT 'closed'::text, NULL::int, NULL::int, NULL::text;
    RETURN;
  END IF;

  v_open_value := COALESCE(
    p_obj ->> 'open',
    p_obj ->> 'from',
    p_obj ->> 'open_time',
    p_obj ->> 'openTime',
    p_obj ->> 'opens',
    p_obj ->> 'start'
  );
  v_close_value := COALESCE(
    p_obj ->> 'close',
    p_obj ->> 'to',
    p_obj ->> 'close_time',
    p_obj ->> 'closeTime',
    p_obj ->> 'closes',
    p_obj ->> 'end'
  );
  IF v_open_value IS NULL OR v_close_value IS NULL THEN
    RETURN QUERY SELECT 'closed'::text, NULL::int, NULL::int, NULL::text;
    RETURN;
  END IF;
  IF jsonb_typeof(p_obj -> 'open') NOT IN ('string') AND
     jsonb_typeof(p_obj -> 'from') NOT IN ('string') AND
     jsonb_typeof(p_obj -> 'open_time') NOT IN ('string') AND
     jsonb_typeof(p_obj -> 'openTime') NOT IN ('string') AND
     jsonb_typeof(p_obj -> 'opens') NOT IN ('string') AND
     jsonb_typeof(p_obj -> 'start') NOT IN ('string') THEN
    RETURN QUERY SELECT 'closed'::text, NULL::int, NULL::int, NULL::text;
    RETURN;
  END IF;

  v_open := public._availability_parse_time_to_minutes(v_open_value);
  v_close := public._availability_parse_time_to_minutes(v_close_value);
  -- Bail when either value failed to parse OR when open == close (zero-
  -- length window — treat as closed, not 24h open).
  IF v_open IS NULL OR v_close IS NULL OR v_open = v_close THEN
    RETURN QUERY SELECT 'closed'::text, NULL::int, NULL::int, NULL::text;
    RETURN;
  END IF;
  -- After-midnight wraparound: when close minute is less than open minute,
  -- the restaurant closes the NEXT calendar day. Add 24h to the close so
  -- slot enumeration spans the correct window. Without this, every
  -- restaurant with a late-night close looked permanently shut on those
  -- nights even though shifts + tables were active.
  IF v_close < v_open THEN
    v_close := v_close + 1440;
  END IF;

  RETURN QUERY SELECT 'open'::text, v_open, v_close, (v_open_value || ' to ' || v_close_value);
END;
$$;

GRANT EXECUTE ON FUNCTION public._availability_read_hours_pair(jsonb)
  TO anon, authenticated, service_role;
