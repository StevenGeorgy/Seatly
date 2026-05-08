-- SPEED_PLAN Phase 4 follow-up: surface restaurant timezone in
-- get_available_slots() output so browser callers can format display_time and
-- the slot-derived hours_window fallback without a separate timezone fetch.
-- The edge function continues to ignore the new key.

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
  v_configured_state text := NULL;
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

  v_floor_capacity_rpc := COALESCE(public.restaurant_floor_capacity(p_restaurant_id), 0);

  SELECT COALESCE(SUM(capacity), 0)::int, COUNT(*)::int
    INTO v_floor_capacity_top, v_active_table_count
  FROM public."tables"
  WHERE restaurant_id = p_restaurant_id AND is_active = true;
  IF v_active_table_count = 0 THEN
    v_floor_capacity_top := NULL;
  END IF;

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
      END,
      'timezone', v_timezone
    );
  END IF;

  v_dow := EXTRACT(DOW FROM
    timezone(v_timezone, (v_request_date + time '12:00') AT TIME ZONE 'UTC')
  )::int;
  v_dow_name := COALESCE(v_dow_names[v_dow + 1], 'monday');

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
      END,
      'timezone', v_timezone
    );
  END IF;

  v_day_start_utc := (v_request_date::timestamp + time '00:00') AT TIME ZONE v_timezone;
  v_day_end_utc   := (v_request_date::timestamp + time '23:59') AT TIME ZONE v_timezone;

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

    IF v_shift.blackout_dates IS NOT NULL
       AND v_request_date = ANY(v_shift.blackout_dates) THEN
      CONTINUE;
    END IF;

    v_slot_inc := COALESCE(v_shift.slot_duration_minutes, 15);
    v_turn_mins := COALESCE(v_shift.turn_time_minutes, 90);
    v_max_covers := COALESCE(v_shift.max_covers, 100);

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

    WHILE v_slot_min + v_slot_inc <= v_end_min LOOP
      v_slot_start_utc := (v_request_date::timestamp + (v_slot_min * interval '1 minute')) AT TIME ZONE v_timezone;
      v_slot_end_utc := v_slot_start_utc + (v_turn_mins * interval '1 minute');

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

  IF jsonb_array_length(v_slots_arr) = 0
     AND v_candidates_count > 0
     AND v_table_blocked_count >= v_candidates_count THEN
    v_table_capacity_blocked := true;
  END IF;

  IF v_table_capacity_blocked THEN
    v_unavailable_reason := 'fully_booked';
    v_message := 'The restaurant is fully booked for that date.';
  ELSIF jsonb_array_length(v_slots_arr) = 0 THEN
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
    'message', v_message,
    'timezone', v_timezone
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_available_slots(uuid, text, int)
  TO anon, authenticated, service_role;
