-- Reservation duration and restaurant-wide default turn time.
-- The dashboard stores a restaurant-wide default in restaurants.settings_json,
-- while each reservation snapshots the duration used for table blocking.

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS duration_minutes integer NOT NULL DEFAULT 90;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reservations_duration_minutes_check'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_duration_minutes_check
      CHECK (duration_minutes BETWEEN 15 AND 480);
  END IF;
END $$;

UPDATE reservations
SET duration_minutes = 90
WHERE duration_minutes IS NULL;

UPDATE restaurants
SET settings_json = COALESCE(settings_json, '{}'::jsonb) || jsonb_build_object('turnTimeMinutes', 90)
WHERE settings_json IS NULL
  OR settings_json->>'turnTimeMinutes' IS NULL;

CREATE OR REPLACE FUNCTION public.restaurant_turn_time_minutes(
  p_restaurant_id uuid,
  p_shift_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT GREATEST(
    15,
    LEAST(
      480,
      COALESCE(
        NULLIF((restaurant.settings_json->>'turnTimeMinutes')::integer, 0),
        shift_row.turn_time_minutes,
        90
      )
    )
  )
  FROM public.restaurants restaurant
  LEFT JOIN public.shifts shift_row
    ON shift_row.id = p_shift_id
    AND shift_row.restaurant_id = restaurant.id
  WHERE restaurant.id = p_restaurant_id;
$$;

CREATE OR REPLACE FUNCTION public.find_available_table_group(
  p_restaurant_id uuid,
  p_reserved_at timestamptz,
  p_party_size integer,
  p_turn_minutes integer DEFAULT NULL,
  p_exclude_reservation_id uuid DEFAULT NULL,
  p_adjacency_distance double precision DEFAULT 170
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_turn_minutes integer;
  v_slot_end timestamptz;
  v_unavailable uuid[];
  v_group uuid[];
BEGIN
  IF p_restaurant_id IS NULL OR p_reserved_at IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  v_turn_minutes := COALESCE(p_turn_minutes, public.restaurant_turn_time_minutes(p_restaurant_id), 90);
  v_slot_end := p_reserved_at + make_interval(mins => v_turn_minutes);

  SELECT COALESCE(array_agg(DISTINCT blocked.table_id), ARRAY[]::uuid[])
  INTO v_unavailable
  FROM (
    SELECT rt.table_id
    FROM reservations r
    JOIN reservation_tables rt
      ON rt.reservation_id = r.id
      AND rt.released_at IS NULL
    WHERE r.restaurant_id = p_restaurant_id
      AND (p_exclude_reservation_id IS NULL OR r.id <> p_exclude_reservation_id)
      AND r.status IN ('pending', 'confirmed', 'seated')
      AND r.reserved_at < v_slot_end
      AND r.reserved_at + make_interval(mins => COALESCE(r.duration_minutes, v_turn_minutes, 90)) > p_reserved_at

    UNION

    SELECT r.table_id
    FROM reservations r
    WHERE r.restaurant_id = p_restaurant_id
      AND r.table_id IS NOT NULL
      AND (p_exclude_reservation_id IS NULL OR r.id <> p_exclude_reservation_id)
      AND r.status IN ('pending', 'confirmed', 'seated')
      AND r.reserved_at < v_slot_end
      AND r.reserved_at + make_interval(mins => COALESCE(r.duration_minutes, v_turn_minutes, 90)) > p_reserved_at
  ) blocked;

  SELECT ARRAY[t.id]
  INTO v_group
  FROM "tables" t
  WHERE t.restaurant_id = p_restaurant_id
    AND COALESCE(t.is_active, true)
    AND COALESCE(t.status, 'empty') <> 'blocked'
    AND NOT (t.id = ANY(v_unavailable))
    AND COALESCE(t.min_party, 1) <= p_party_size
    AND t.capacity >= p_party_size
  ORDER BY t.capacity ASC, t.table_number ASC
  LIMIT 1;

  IF COALESCE(array_length(v_group, 1), 0) > 0 THEN
    RETURN v_group;
  END IF;

  SELECT ARRAY[t1.id, t2.id]
  INTO v_group
  FROM "tables" t1
  JOIN "tables" t2
    ON t1.id < t2.id
    AND COALESCE(t1.section_id::text, t1.section, '') = COALESCE(t2.section_id::text, t2.section, '')
  WHERE t1.restaurant_id = p_restaurant_id
    AND t2.restaurant_id = p_restaurant_id
    AND COALESCE(t1.is_active, true)
    AND COALESCE(t2.is_active, true)
    AND COALESCE(t1.status, 'empty') <> 'blocked'
    AND COALESCE(t2.status, 'empty') <> 'blocked'
    AND NOT (t1.id = ANY(v_unavailable))
    AND NOT (t2.id = ANY(v_unavailable))
    AND COALESCE(t1.min_party, 1) <= p_party_size
    AND COALESCE(t2.min_party, 1) <= p_party_size
    AND t1.capacity + t2.capacity >= p_party_size
    AND sqrt(power(COALESCE(t1.position_x, 0) - COALESCE(t2.position_x, 0), 2) + power(COALESCE(t1.position_y, 0) - COALESCE(t2.position_y, 0), 2)) <= p_adjacency_distance
  ORDER BY (t1.capacity + t2.capacity) ASC, t1.table_number ASC, t2.table_number ASC
  LIMIT 1;

  IF COALESCE(array_length(v_group, 1), 0) > 0 THEN
    RETURN v_group;
  END IF;

  SELECT ARRAY[t1.id, t2.id, t3.id]
  INTO v_group
  FROM "tables" t1
  JOIN "tables" t2
    ON t1.id < t2.id
    AND COALESCE(t1.section_id::text, t1.section, '') = COALESCE(t2.section_id::text, t2.section, '')
  JOIN "tables" t3
    ON t2.id < t3.id
    AND COALESCE(t1.section_id::text, t1.section, '') = COALESCE(t3.section_id::text, t3.section, '')
  WHERE t1.restaurant_id = p_restaurant_id
    AND t2.restaurant_id = p_restaurant_id
    AND t3.restaurant_id = p_restaurant_id
    AND COALESCE(t1.is_active, true)
    AND COALESCE(t2.is_active, true)
    AND COALESCE(t3.is_active, true)
    AND COALESCE(t1.status, 'empty') <> 'blocked'
    AND COALESCE(t2.status, 'empty') <> 'blocked'
    AND COALESCE(t3.status, 'empty') <> 'blocked'
    AND NOT (t1.id = ANY(v_unavailable))
    AND NOT (t2.id = ANY(v_unavailable))
    AND NOT (t3.id = ANY(v_unavailable))
    AND COALESCE(t1.min_party, 1) <= p_party_size
    AND COALESCE(t2.min_party, 1) <= p_party_size
    AND COALESCE(t3.min_party, 1) <= p_party_size
    AND t1.capacity + t2.capacity + t3.capacity >= p_party_size
    AND (
      (sqrt(power(COALESCE(t1.position_x, 0) - COALESCE(t2.position_x, 0), 2) + power(COALESCE(t1.position_y, 0) - COALESCE(t2.position_y, 0), 2)) <= p_adjacency_distance)::integer +
      (sqrt(power(COALESCE(t1.position_x, 0) - COALESCE(t3.position_x, 0), 2) + power(COALESCE(t1.position_y, 0) - COALESCE(t3.position_y, 0), 2)) <= p_adjacency_distance)::integer +
      (sqrt(power(COALESCE(t2.position_x, 0) - COALESCE(t3.position_x, 0), 2) + power(COALESCE(t2.position_y, 0) - COALESCE(t3.position_y, 0), 2)) <= p_adjacency_distance)::integer
    ) >= 2
  ORDER BY (t1.capacity + t2.capacity + t3.capacity) ASC, t1.table_number ASC, t2.table_number ASC, t3.table_number ASC
  LIMIT 1;

  RETURN COALESCE(v_group, ARRAY[]::uuid[]);
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_reservation_tables(
  p_reservation_id uuid,
  p_restaurant_id uuid,
  p_reserved_at timestamptz,
  p_party_size integer,
  p_turn_minutes integer DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid[];
  v_table_id uuid;
  v_index integer := 1;
  v_reservation_restaurant uuid;
  v_turn_minutes integer;
BEGIN
  SELECT restaurant_id
  INTO v_reservation_restaurant
  FROM reservations
  WHERE id = p_reservation_id;

  IF v_reservation_restaurant IS NULL OR v_reservation_restaurant <> p_restaurant_id THEN
    RAISE EXCEPTION 'Reservation not found for this restaurant.';
  END IF;

  PERFORM require_staff_role(p_restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);

  v_turn_minutes := COALESCE(p_turn_minutes, public.restaurant_turn_time_minutes(p_restaurant_id), 90);

  v_group := find_available_table_group(
    p_restaurant_id,
    p_reserved_at,
    p_party_size,
    v_turn_minutes,
    p_reservation_id
  );

  IF COALESCE(array_length(v_group, 1), 0) = 0 THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  UPDATE reservation_tables
  SET released_at = now()
  WHERE reservation_id = p_reservation_id
    AND released_at IS NULL;

  FOREACH v_table_id IN ARRAY v_group LOOP
    INSERT INTO reservation_tables (
      restaurant_id,
      reservation_id,
      table_id,
      is_primary
    )
    VALUES (
      p_restaurant_id,
      p_reservation_id,
      v_table_id,
      v_index = 1
    );
    v_index := v_index + 1;
  END LOOP;

  UPDATE reservations
  SET table_id = v_group[1],
      duration_minutes = v_turn_minutes,
      updated_at = now()
  WHERE id = p_reservation_id
    AND restaurant_id = p_restaurant_id;

  RETURN v_group;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_staff_reservation(
  p_restaurant_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_party_size integer,
  p_reserved_at timestamptz,
  p_special_request text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_guest_id uuid;
  v_reservation_id uuid;
  v_table_ids uuid[];
  v_turn_minutes integer;
BEGIN
  v_role := require_staff_role(p_restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);
  v_turn_minutes := COALESCE(public.restaurant_turn_time_minutes(p_restaurant_id), 90);

  IF p_party_size IS NULL OR p_party_size < 1 THEN
    RAISE EXCEPTION 'Party size must be at least 1.';
  END IF;

  SELECT id INTO v_guest_id
  FROM guests
  WHERE restaurant_id = p_restaurant_id
    AND (
      (p_guest_phone IS NOT NULL AND btrim(p_guest_phone) <> '' AND phone = p_guest_phone)
      OR (p_guest_email IS NOT NULL AND btrim(p_guest_email) <> '' AND lower(email) = lower(p_guest_email))
    )
  LIMIT 1;

  IF v_guest_id IS NULL THEN
    INSERT INTO guests (restaurant_id, full_name, phone, email)
    VALUES (
      p_restaurant_id,
      NULLIF(btrim(COALESCE(p_guest_name, '')), ''),
      NULLIF(btrim(COALESCE(p_guest_phone, '')), ''),
      NULLIF(btrim(COALESCE(p_guest_email, '')), '')
    )
    RETURNING id INTO v_guest_id;
  END IF;

  INSERT INTO reservations (
    restaurant_id,
    guest_id,
    guest_full_name,
    guest_email,
    guest_phone,
    party_size,
    reserved_at,
    duration_minutes,
    special_request,
    status,
    confirmation_code,
    source,
    is_guest_checkout
  )
  VALUES (
    p_restaurant_id,
    v_guest_id,
    NULLIF(btrim(COALESCE(p_guest_name, '')), ''),
    NULLIF(btrim(COALESCE(p_guest_email, '')), ''),
    NULLIF(btrim(COALESCE(p_guest_phone, '')), ''),
    p_party_size,
    p_reserved_at,
    v_turn_minutes,
    NULLIF(btrim(COALESCE(p_special_request, '')), ''),
    'confirmed',
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
    'dashboard',
    true
  )
  RETURNING id INTO v_reservation_id;

  v_table_ids := assign_reservation_tables(v_reservation_id, p_restaurant_id, p_reserved_at, p_party_size, v_turn_minutes);
  IF COALESCE(array_length(v_table_ids, 1), 0) = 0 THEN
    UPDATE reservations
    SET status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = 'No available table for party size.'
    WHERE id = v_reservation_id;
    RAISE EXCEPTION 'No available table can fit this party at that time.';
  END IF;

  PERFORM write_staff_audit_event(
    p_restaurant_id,
    'reservation.create',
    'reservation',
    v_reservation_id,
    '{}'::jsonb,
    jsonb_build_object(
      'party_size', p_party_size,
      'reserved_at', p_reserved_at,
      'duration_minutes', v_turn_minutes,
      'role', v_role
    )
  );

  RETURN v_reservation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restaurant_turn_time_minutes(uuid, uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.find_available_table_group(uuid, timestamptz, integer, integer, uuid, double precision) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.assign_reservation_tables(uuid, uuid, timestamptz, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_staff_reservation(uuid, text, text, text, integer, timestamptz, text) TO authenticated, service_role;
