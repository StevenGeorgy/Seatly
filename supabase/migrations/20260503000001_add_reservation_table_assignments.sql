-- Floor plan booking assignments.
-- Keeps reservations.table_id as the primary table while supporting adjacent
-- multi-table reservations through an additive join table.

CREATE TABLE IF NOT EXISTS reservation_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES "tables"(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);

ALTER TABLE reservation_tables ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_reservation_tables_restaurant_id
  ON reservation_tables(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_reservation_tables_reservation_id
  ON reservation_tables(reservation_id);

CREATE INDEX IF NOT EXISTS idx_reservation_tables_table_id_active
  ON reservation_tables(table_id)
  WHERE released_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reservation_tables_unique_active
  ON reservation_tables(reservation_id, table_id)
  WHERE released_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reservation_tables_primary_active
  ON reservation_tables(reservation_id)
  WHERE is_primary AND released_at IS NULL;

DROP POLICY IF EXISTS reservation_tables_select_staff ON reservation_tables;
CREATE POLICY reservation_tables_select_staff
  ON reservation_tables FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM user_profiles
      WHERE user_profiles.auth_user_id = auth.uid()
        AND user_profiles.restaurant_id = reservation_tables.restaurant_id
        AND user_profiles.role IN ('host', 'waiter', 'owner', 'manager', 'server', 'staff', 'admin')
    )
    OR EXISTS (
      SELECT 1
      FROM reservations
      JOIN guests ON guests.id = reservations.guest_id
      JOIN user_profiles ON user_profiles.id = guests.user_profile_id
      WHERE reservations.id = reservation_tables.reservation_id
        AND user_profiles.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS reservation_tables_manage_staff ON reservation_tables;
CREATE POLICY reservation_tables_manage_staff
  ON reservation_tables FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM user_profiles
      WHERE user_profiles.auth_user_id = auth.uid()
        AND user_profiles.restaurant_id = reservation_tables.restaurant_id
        AND user_profiles.role IN ('host', 'waiter', 'owner', 'manager', 'server', 'staff', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM user_profiles
      WHERE user_profiles.auth_user_id = auth.uid()
        AND user_profiles.restaurant_id = reservation_tables.restaurant_id
        AND user_profiles.role IN ('host', 'waiter', 'owner', 'manager', 'server', 'staff', 'admin')
    )
  );

CREATE OR REPLACE FUNCTION find_available_table_group(
  p_restaurant_id uuid,
  p_reserved_at timestamptz,
  p_party_size integer,
  p_turn_minutes integer DEFAULT 90,
  p_exclude_reservation_id uuid DEFAULT NULL,
  p_adjacency_distance double precision DEFAULT 170
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot_end timestamptz;
  v_unavailable uuid[];
  v_group uuid[];
BEGIN
  IF p_restaurant_id IS NULL OR p_reserved_at IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  v_slot_end := p_reserved_at + make_interval(mins => COALESCE(p_turn_minutes, 90));

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
      AND r.reserved_at + make_interval(mins => COALESCE(p_turn_minutes, 90)) > p_reserved_at

    UNION

    SELECT r.table_id
    FROM reservations r
    WHERE r.restaurant_id = p_restaurant_id
      AND r.table_id IS NOT NULL
      AND (p_exclude_reservation_id IS NULL OR r.id <> p_exclude_reservation_id)
      AND r.status IN ('pending', 'confirmed', 'seated')
      AND r.reserved_at < v_slot_end
      AND r.reserved_at + make_interval(mins => COALESCE(p_turn_minutes, 90)) > p_reserved_at
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

CREATE OR REPLACE FUNCTION assign_reservation_tables(
  p_reservation_id uuid,
  p_restaurant_id uuid,
  p_reserved_at timestamptz,
  p_party_size integer,
  p_turn_minutes integer DEFAULT 90
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
BEGIN
  v_group := find_available_table_group(
    p_restaurant_id,
    p_reserved_at,
    p_party_size,
    p_turn_minutes,
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
      updated_at = now()
  WHERE id = p_reservation_id
    AND restaurant_id = p_restaurant_id;

  RETURN v_group;
END;
$$;

CREATE OR REPLACE FUNCTION mark_reservation_tables_seated(
  p_reservation_id uuid,
  p_party_size integer
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid[];
  v_table_id uuid;
  v_combined uuid[];
  v_remaining integer := GREATEST(COALESCE(p_party_size, 0), 0);
  v_capacity integer;
  v_seated integer;
BEGIN
  SELECT COALESCE(array_agg(rt.table_id ORDER BY rt.is_primary DESC, t.capacity ASC, t.table_number ASC), ARRAY[]::uuid[])
  INTO v_group
  FROM reservation_tables rt
  JOIN "tables" t ON t.id = rt.table_id
  WHERE rt.reservation_id = p_reservation_id
    AND rt.released_at IS NULL;

  IF COALESCE(array_length(v_group, 1), 0) = 0 THEN
    SELECT CASE WHEN table_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[table_id] END
    INTO v_group
    FROM reservations
    WHERE id = p_reservation_id;
  END IF;

  IF COALESCE(array_length(v_group, 1), 0) = 0 THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  FOREACH v_table_id IN ARRAY v_group LOOP
    SELECT capacity INTO v_capacity FROM "tables" WHERE id = v_table_id;
    v_seated := LEAST(GREATEST(v_remaining, 0), COALESCE(v_capacity, 0));
    v_remaining := GREATEST(v_remaining - v_seated, 0);
    SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_combined
    FROM unnest(v_group) AS id
    WHERE id <> v_table_id;

    UPDATE "tables"
    SET status = 'occupied',
        seated_count = v_seated,
        combined_with = CASE WHEN COALESCE(array_length(v_combined, 1), 0) > 0 THEN v_combined ELSE NULL END,
        updated_at = now()
    WHERE id = v_table_id;
  END LOOP;

  RETURN v_group;
END;
$$;

CREATE OR REPLACE FUNCTION release_reservation_tables(
  p_reservation_id uuid
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid[];
BEGIN
  SELECT COALESCE(array_agg(table_id), ARRAY[]::uuid[])
  INTO v_group
  FROM reservation_tables
  WHERE reservation_id = p_reservation_id
    AND released_at IS NULL;

  IF COALESCE(array_length(v_group, 1), 0) = 0 THEN
    SELECT CASE WHEN table_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[table_id] END
    INTO v_group
    FROM reservations
    WHERE id = p_reservation_id;
  END IF;

  UPDATE reservation_tables
  SET released_at = now()
  WHERE reservation_id = p_reservation_id
    AND released_at IS NULL;

  UPDATE "tables"
  SET status = 'empty',
      seated_count = 0,
      combined_with = NULL,
      updated_at = now()
  WHERE id = ANY(v_group)
    AND COALESCE(status, 'empty') <> 'blocked';

  RETURN COALESCE(v_group, ARRAY[]::uuid[]);
END;
$$;

GRANT EXECUTE ON FUNCTION find_available_table_group(uuid, timestamptz, integer, integer, uuid, double precision) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION assign_reservation_tables(uuid, uuid, timestamptz, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION mark_reservation_tables_seated(uuid, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION release_reservation_tables(uuid) TO anon, authenticated, service_role;
