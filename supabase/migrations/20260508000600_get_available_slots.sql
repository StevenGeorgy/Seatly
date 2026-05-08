-- SPEED_PLAN Phase 4 — single-shot SQL availability function.
--
-- Ports the canonical slot-building logic from
-- supabase/functions/_shared/availability.ts (lines 60-308) into a single
-- Postgres function so the get-availability edge function can collapse
-- ~50 round trips into one. Behaviour is intentionally byte-identical with
-- the current wrapper output (display_time + slot-derived hours_window are
-- still formatted in TS to avoid V8/PG string-formatting drift).

-- ---------------------------------------------------------------------------
-- Helper: parse a clock string into minutes-of-day (0..1439). Returns NULL on
-- failure. Mirrors parseTimeToMinutes() in _shared/availability.ts:26-45.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._availability_parse_time_to_minutes(p_value text)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_trimmed text;
  v_match text[];
  v_hours int;
  v_minutes int;
  v_period text;
  v_parts text[];
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;
  v_trimmed := btrim(p_value);
  IF v_trimmed = '' THEN
    RETURN NULL;
  END IF;

  -- 12-hour with am/pm marker.
  v_match := regexp_match(v_trimmed, '^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$', 'i');
  IF v_match IS NOT NULL THEN
    v_hours := v_match[1]::int;
    v_minutes := COALESCE(NULLIF(v_match[2], '')::int, 0);
    v_period := lower(v_match[3]);
    IF v_period = 'pm' AND v_hours <> 12 THEN v_hours := v_hours + 12; END IF;
    IF v_period = 'am' AND v_hours = 12 THEN v_hours := 0; END IF;
    RETURN v_hours * 60 + v_minutes;
  END IF;

  -- Otherwise: split on ':' and parse first two parts as numbers (matches the
  -- JS Number()/split(":") behaviour, including loose forms like "17", "17:00",
  -- "17:00:00").
  v_parts := string_to_array(v_trimmed, ':');
  BEGIN
    v_hours := btrim(v_parts[1])::int;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  BEGIN
    v_minutes := CASE
      WHEN array_length(v_parts, 1) >= 2 AND v_parts[2] <> ''
      THEN btrim(v_parts[2])::int
      ELSE 0
    END;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  RETURN v_hours * 60 + v_minutes;
END;
$$;

-- ---------------------------------------------------------------------------
-- Helper: read an hours pair (open/close) from a jsonb object using the same
-- flexible key list as readHoursPair() in availability.ts:47-58.
-- Returns:
--   ('closed', NULL, NULL, NULL) when explicitly closed or unparseable
--   ('open',   open_min, close_min, label) when valid
--   ('none',   NULL, NULL, NULL) when input is not an object (signals "no
--               configured hours for this day" — caller may then fall through)
-- ---------------------------------------------------------------------------
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
  -- TS branch: "if (typeof openValue !== 'string' || typeof closeValue !== 'string')"
  -- Matched by jsonb_typeof check on each key.
  IF v_open_value IS NULL OR v_close_value IS NULL THEN
    RETURN QUERY SELECT 'closed'::text, NULL::int, NULL::int, NULL::text;
    RETURN;
  END IF;
  -- Confirm the underlying JSON value was a string (not a number/bool that the
  -- ->> operator coerced to text). Mirrors the typeof-string guard.
  IF jsonb_typeof(p_obj -> 'open') NOT IN ('string') AND
     jsonb_typeof(p_obj -> 'from') NOT IN ('string') AND
     jsonb_typeof(p_obj -> 'open_time') NOT IN ('string') AND
     jsonb_typeof(p_obj -> 'openTime') NOT IN ('string') AND
     jsonb_typeof(p_obj -> 'opens') NOT IN ('string') AND
     jsonb_typeof(p_obj -> 'start') NOT IN ('string') THEN
    RETURN QUERY SELECT 'closed'::text, NULL::int, NULL::int, NULL::text;
    RETURN;
  END IF;
  -- (Same check for the close side — at least one of the close keys must be a
  -- string. We rely on COALESCE picking the first non-null; if the chosen
  -- value wasn't originally a string, jsonb_typeof of the corresponding key
  -- would not be 'string' either.)

  v_open := public._availability_parse_time_to_minutes(v_open_value);
  v_close := public._availability_parse_time_to_minutes(v_close_value);
  IF v_open IS NULL OR v_close IS NULL OR v_close <= v_open THEN
    RETURN QUERY SELECT 'closed'::text, NULL::int, NULL::int, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'open'::text, v_open, v_close, (v_open_value || ' to ' || v_close_value);
END;
$$;

-- ---------------------------------------------------------------------------
-- Helper: scan hours_json.special[] for an entry whose date range covers
-- p_date_only. Returns NULL when no match.
-- Mirrors findSpecialDayForDate() in _shared/closures.ts:35-58.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._availability_find_special_day(
  p_hours_json jsonb,
  p_date_only text
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_entry jsonb;
  v_start text;
  v_end text;
  v_swap text;
BEGIN
  IF p_hours_json IS NULL OR jsonb_typeof(p_hours_json -> 'special') <> 'array' THEN
    RETURN NULL;
  END IF;
  FOR v_entry IN SELECT jsonb_array_elements(p_hours_json -> 'special') LOOP
    IF jsonb_typeof(v_entry) <> 'object' THEN CONTINUE; END IF;

    v_start := COALESCE(
      v_entry ->> 'startDate',
      v_entry ->> 'start_date',
      v_entry ->> 'date'
    );
    IF v_start IS NULL THEN CONTINUE; END IF;
    v_start := substring(btrim(v_start) FROM 1 FOR 10);
    IF v_start !~ '^\d{4}-\d{2}-\d{2}$' THEN CONTINUE; END IF;

    v_end := COALESCE(
      v_entry ->> 'endDate',
      v_entry ->> 'end_date',
      v_entry ->> 'date'
    );
    IF v_end IS NOT NULL THEN
      v_end := substring(btrim(v_end) FROM 1 FOR 10);
      IF v_end !~ '^\d{4}-\d{2}-\d{2}$' THEN
        v_end := v_start;
      END IF;
    ELSE
      v_end := v_start;
    END IF;

    IF v_end < v_start THEN
      v_swap := v_start; v_start := v_end; v_end := v_swap;
    END IF;

    IF p_date_only >= v_start AND p_date_only <= v_end THEN
      -- Return a normalised match object including the closed flag, label,
      -- and from/to so the caller can use them directly.
      RETURN jsonb_build_object(
        'startDate', v_start,
        'endDate', v_end,
        'label', NULLIF(btrim(COALESCE(v_entry ->> 'label', v_entry ->> 'name', '')), ''),
        'description', NULLIF(btrim(COALESCE(v_entry ->> 'description', '')), ''),
        'closed', (v_entry ->> 'closed') = 'true'
                  OR (v_entry ->> 'is_closed') = 'true'
                  OR (v_entry ->> 'open') = 'false',
        'from', NULLIF(btrim(COALESCE(
          v_entry ->> 'from', v_entry ->> 'open', v_entry ->> 'open_time',
          v_entry ->> 'openTime', v_entry ->> 'opens', v_entry ->> 'start', ''
        )), ''),
        'to', NULLIF(btrim(COALESCE(
          v_entry ->> 'to', v_entry ->> 'close', v_entry ->> 'close_time',
          v_entry ->> 'closeTime', v_entry ->> 'closes', v_entry ->> 'end', ''
        )), '')
      );
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Main RPC: get_available_slots
-- Returns a single jsonb object matching the existing get-availability HTTP
-- response body, MINUS display_time and the slot-derived hours_window
-- fallback (both formatted in TS to preserve byte-identity with V8's en-US
-- time formatter, which inserts a NARROW NO-BREAK SPACE between time and
-- AM/PM that PG to_char would not match).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_restaurant_id uuid,
  p_date text,
  p_party_size int
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date_only text;
  v_request_date date;
  v_today date;
  v_restaurant_row record;
  v_timezone text;
  v_hours_json jsonb;
  v_floor_capacity_rpc int;
  v_floor_capacity_top int;
  v_active_table_count int;
  v_dow int;
  v_dow_names text[] := ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  v_dow_name text;
  v_special jsonb;
  v_pair record;
  v_configured_hours_window text := NULL;
  v_configured_state text := NULL;        -- 'open' | 'closed' | NULL (no hours_json)
  v_configured_open int;
  v_configured_close int;
  v_day_start_utc timestamptz;
  v_day_end_utc timestamptz;
  v_shift record;
  v_slot_min int;
  v_end_min int;
  v_slot_inc int;
  v_turn_mins int;
  v_max_covers int;
  v_advance_days int;
  v_blackouts jsonb;
  v_max_booking_date date;
  v_slot_start_utc timestamptz;
  v_slot_end_utc timestamptz;
  v_total_covers int;
  v_overlap_party int;
  v_table_ids uuid[];
  v_slot_obj jsonb;
  v_slots_arr jsonb := '[]'::jsonb;
  v_candidates_count int := 0;
  v_table_blocked_count int := 0;
  v_unavailable_reason text := NULL;
  v_message text := NULL;
  v_table_capacity_blocked boolean := false;
BEGIN
  v_date_only := substring(p_date FROM 1 FOR 10);
  v_request_date := v_date_only::date;
  v_today := (now() AT TIME ZONE 'UTC')::date;

  -- 1. Fetch restaurant fields (timezone, hours_json). settings_json is read
  -- in TS only for configuredTurnMinutes which the wrapper overrides anyway,
  -- so we do not honour it (matches the current wrapper output exactly).
  SELECT timezone, hours_json
    INTO v_restaurant_row
  FROM public.restaurants
  WHERE id = p_restaurant_id;
  v_timezone := COALESCE(v_restaurant_row.timezone, 'UTC');
  v_hours_json := CASE
    WHEN v_restaurant_row.hours_json IS NOT NULL
         AND jsonb_typeof(v_restaurant_row.hours_json) = 'object'
    THEN v_restaurant_row.hours_json
    ELSE NULL
  END;

  -- 2. Floor capacities. The TS guard uses restaurant_floor_capacity() (excludes
  -- blocked tables); the wrapper's HTTP response top-level uses SUM(capacity)
  -- WHERE is_active=true (includes "blocked" rows but skips inactive). We
  -- replicate both so byte-identity holds even when those values disagree.
  v_floor_capacity_rpc := COALESCE(public.restaurant_floor_capacity(p_restaurant_id), 0);

  SELECT COALESCE(SUM(capacity), 0)::int, COUNT(*)::int
    INTO v_floor_capacity_top, v_active_table_count
  FROM public."tables"
  WHERE restaurant_id = p_restaurant_id AND is_active = true;
  IF v_active_table_count = 0 THEN
    v_floor_capacity_top := NULL;
  END IF;

  -- 3. Party size guard (lines 86-94 of availability.ts).
  IF p_party_size < 1 OR p_party_size > v_floor_capacity_rpc THEN
    RETURN jsonb_build_object(
      'slots', '[]'::jsonb,
      'floor_capacity', v_floor_capacity_top,
      'configured_hours_window', NULL,
      'unavailable_reason', NULL,
      'message', CASE
        WHEN v_floor_capacity_rpc > 0
          THEN 'This restaurant can take parties up to ' || v_floor_capacity_rpc || '.'
        ELSE 'This restaurant does not have a saved floor plan yet.'
      END
    );
  END IF;

  -- 4. Day-of-week + name. JS-style 0=Sun..6=Sat using a noon-UTC anchor (lines
  -- 96-102 of availability.ts; localDayOfWeek in time.ts:27-34).
  v_dow := EXTRACT(DOW FROM
    timezone(v_timezone, (v_request_date + time '12:00') AT TIME ZONE 'UTC')
  )::int;
  v_dow_name := COALESCE(v_dow_names[v_dow + 1], 'monday');

  -- 5. Configured hours resolution: special-day first, then weekly (lines
  -- 104-149). Sets v_configured_state, v_configured_open/close,
  -- v_configured_hours_window.
  IF v_hours_json IS NOT NULL THEN
    v_special := public._availability_find_special_day(v_hours_json, v_date_only);
    IF v_special IS NOT NULL THEN
      IF (v_special ->> 'closed') = 'true' THEN
        v_configured_state := 'closed';
      ELSE
        SELECT * INTO v_pair FROM public._availability_read_hours_pair(jsonb_build_object(
          'open', v_special -> 'from',
          'close', v_special -> 'to',
          'closed', false
        ));
        IF v_pair.state = 'open' THEN
          v_configured_state := 'open';
          v_configured_open := v_pair.open_min;
          v_configured_close := v_pair.close_min;
          v_configured_hours_window := v_pair.label;
        ELSE
          v_configured_state := 'closed';
        END IF;
      END IF;
    ELSE
      SELECT * INTO v_pair FROM public._availability_read_hours_pair(v_hours_json -> v_dow_name);
      IF v_pair.state = 'open' THEN
        v_configured_state := 'open';
        v_configured_open := v_pair.open_min;
        v_configured_close := v_pair.close_min;
        v_configured_hours_window := v_pair.label;
      ELSE
        v_configured_state := 'closed';
      END IF;
    END IF;
  END IF;

  -- 6. Closed-day early return (lines 140-149).
  IF v_configured_state = 'closed' THEN
    v_special := CASE WHEN v_hours_json IS NOT NULL
      THEN public._availability_find_special_day(v_hours_json, v_date_only)
      ELSE NULL
    END;
    RETURN jsonb_build_object(
      'slots', '[]'::jsonb,
      'floor_capacity', v_floor_capacity_top,
      'configured_hours_window', NULL,
      'unavailable_reason', 'closed',
      'message', CASE
        WHEN v_special IS NOT NULL AND (v_special ->> 'closed') = 'true' THEN
          CASE
            WHEN COALESCE(v_special ->> 'label', '') <> ''
              THEN 'Closed for ' || (v_special ->> 'label') || '.'
            ELSE 'This restaurant is closed on that date.'
          END
        ELSE 'No availability on that date.'
      END
    );
  END IF;

  -- 7. UTC bounds for the restaurant-local day (lines 165-167).
  v_day_start_utc := (v_request_date::timestamp + time '00:00') AT TIME ZONE v_timezone;
  v_day_end_utc   := (v_request_date::timestamp + time '23:59') AT TIME ZONE v_timezone;

  -- 8. Iterate matching shifts, enumerate candidate slots, table-assign each
  -- (lines 151-292). Order shifts by id ASC for deterministic output ordering.
  FOR v_shift IN
    SELECT id, name, start_time, end_time, slot_duration_minutes,
           turn_time_minutes, max_covers, blackout_dates, advance_booking_days
    FROM public.shifts
    WHERE restaurant_id = p_restaurant_id
      AND is_active = true
      AND days_of_week @> ARRAY[v_dow]
    ORDER BY id ASC
  LOOP
    v_advance_days := COALESCE(v_shift.advance_booking_days, 30);
    v_max_booking_date := v_today + v_advance_days;
    IF v_request_date > v_max_booking_date THEN
      CONTINUE;
    END IF;

    -- Blackout dates: shift.blackout_dates is date[]; .includes(dateOnly)
    IF v_shift.blackout_dates IS NOT NULL
       AND v_request_date = ANY(v_shift.blackout_dates) THEN
      CONTINUE;
    END IF;

    v_slot_inc := COALESCE(v_shift.slot_duration_minutes, 15);
    v_turn_mins := COALESCE(v_shift.turn_time_minutes, 90);
    v_max_covers := COALESCE(v_shift.max_covers, 100);

    -- start_time / end_time are time(without tz) cols. Default if NULL.
    v_slot_min := EXTRACT(HOUR FROM COALESCE(v_shift.start_time, time '17:00'))::int * 60
                + EXTRACT(MINUTE FROM COALESCE(v_shift.start_time, time '17:00'))::int;
    v_end_min := EXTRACT(HOUR FROM COALESCE(v_shift.end_time, time '23:00'))::int * 60
               + EXTRACT(MINUTE FROM COALESCE(v_shift.end_time, time '23:00'))::int;

    IF v_configured_state = 'open' THEN
      v_slot_min := GREATEST(v_slot_min, v_configured_open);
      v_end_min  := LEAST(v_end_min,  v_configured_close);
    END IF;
    IF v_end_min <= v_slot_min THEN
      CONTINUE;
    END IF;

    -- Enumerate slot starts: while (slot_min + slot_inc <= end_min) — i.e.
    -- slot_min in [start, end_min - slot_inc] stepping by slot_inc.
    WHILE v_slot_min + v_slot_inc <= v_end_min LOOP
      v_slot_start_utc := (v_request_date::timestamp + (v_slot_min * interval '1 minute')) AT TIME ZONE v_timezone;
      v_slot_end_utc := v_slot_start_utc + (v_turn_mins * interval '1 minute');

      -- Capacity overlap check: for reservations on this shift overlapping
      -- [slot_start, slot_end), sum party_size and ensure
      -- (party + sum) <= max_covers (lines 229-242).
      SELECT COALESCE(SUM(party_size), 0)::int
        INTO v_overlap_party
      FROM public.reservations r
      WHERE r.restaurant_id = p_restaurant_id
        AND r.shift_id = v_shift.id
        AND r.status IN ('pending', 'confirmed', 'seated')
        AND r.reserved_at >= v_day_start_utc
        AND r.reserved_at <= v_day_end_utc
        AND v_slot_start_utc < (r.reserved_at + (COALESCE(r.duration_minutes, v_turn_mins) * interval '1 minute'))
        AND v_slot_end_utc   > r.reserved_at;

      v_total_covers := p_party_size + v_overlap_party;
      IF v_total_covers <= v_max_covers THEN
        v_candidates_count := v_candidates_count + 1;
        -- Resolve table assignment via existing RPC (lines 257-272).
        v_table_ids := public.find_available_table_group(
          p_restaurant_id  => p_restaurant_id,
          p_reserved_at    => v_slot_start_utc,
          p_party_size     => p_party_size,
          p_turn_minutes   => v_turn_mins
        );
        IF v_table_ids IS NULL OR array_length(v_table_ids, 1) IS NULL THEN
          v_table_blocked_count := v_table_blocked_count + 1;
        ELSE
          v_slot_obj := jsonb_build_object(
            'shift_id', v_shift.id,
            'shift_name', COALESCE(v_shift.name, 'Shift'),
            'date_time', to_char(
              v_slot_start_utc AT TIME ZONE 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'table_ids', to_jsonb(v_table_ids::text[]),
            'duration_minutes', v_turn_mins
          );
          v_slots_arr := v_slots_arr || jsonb_build_array(v_slot_obj);
          -- Cap at 48 (line 298). Stop adding once we hit the cap, but keep
          -- iterating so candidates_count remains accurate for the
          -- "fully_booked" signal logic below.
          IF jsonb_array_length(v_slots_arr) >= 48 THEN
            EXIT;
          END IF;
        END IF;
      END IF;

      v_slot_min := v_slot_min + v_slot_inc;
    END LOOP;

    IF jsonb_array_length(v_slots_arr) >= 48 THEN
      EXIT;
    END IF;
  END LOOP;

  -- 9. tableCapacityBlocked signal (lines 123-126 of get-availability/index.ts).
  -- Note: the TS wrapper computes this as
  --   slots.length === 0 && availability.slots.length > 0
  --   && tableBlockedCount >= availability.slots.length
  -- In the SQL version, candidates_count plays the role of
  -- availability.slots.length (post-inner-table-assignment in the TS path,
  -- but here we only do one pass — the equivalent condition is "every
  -- candidate that survived capacity-overlap was rejected by table assignment").
  IF jsonb_array_length(v_slots_arr) = 0
     AND v_candidates_count > 0
     AND v_table_blocked_count >= v_candidates_count THEN
    v_table_capacity_blocked := true;
  END IF;

  IF v_table_capacity_blocked THEN
    v_unavailable_reason := 'fully_booked';
    v_message := 'The restaurant is fully booked for that date.';
  ELSIF jsonb_array_length(v_slots_arr) = 0 THEN
    -- No shifts matched OR every slot rejected by capacity overlap. The TS
    -- inner code returns `message: "No availability on that date."` only when
    -- the shifts query returned zero rows; otherwise `message` is undefined
    -- and the wrapper turns it into null. We replicate that distinction.
    IF NOT EXISTS (
      SELECT 1 FROM public.shifts
      WHERE restaurant_id = p_restaurant_id
        AND is_active = true
        AND days_of_week @> ARRAY[v_dow]
    ) THEN
      v_message := 'No availability on that date.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'slots', v_slots_arr,
    'floor_capacity', v_floor_capacity_top,
    'configured_hours_window', v_configured_hours_window,
    'unavailable_reason', v_unavailable_reason,
    'message', v_message
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public._availability_parse_time_to_minutes(text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._availability_read_hours_pair(jsonb)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._availability_find_special_day(jsonb, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_available_slots(uuid, text, int)
  TO anon, authenticated, service_role;
