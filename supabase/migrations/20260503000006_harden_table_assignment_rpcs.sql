-- Ensure direct RPC calls cannot bypass the production host permission layer.
-- Public availability lookup remains available; table assignment mutations
-- require staff membership for the reservation's restaurant.

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
  v_reservation_restaurant uuid;
BEGIN
  SELECT restaurant_id
  INTO v_reservation_restaurant
  FROM reservations
  WHERE id = p_reservation_id;

  IF v_reservation_restaurant IS NULL OR v_reservation_restaurant <> p_restaurant_id THEN
    RAISE EXCEPTION 'Reservation not found for this restaurant.';
  END IF;

  PERFORM require_staff_role(p_restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);

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
  v_restaurant_id uuid;
  v_group uuid[];
  v_table_id uuid;
  v_combined uuid[];
  v_remaining integer := GREATEST(COALESCE(p_party_size, 0), 0);
  v_capacity integer;
  v_seated integer;
BEGIN
  SELECT restaurant_id
  INTO v_restaurant_id
  FROM reservations
  WHERE id = p_reservation_id;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Reservation not found.';
  END IF;

  PERFORM require_staff_role(v_restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);

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
  v_restaurant_id uuid;
  v_group uuid[];
BEGIN
  SELECT restaurant_id
  INTO v_restaurant_id
  FROM reservations
  WHERE id = p_reservation_id;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Reservation not found.';
  END IF;

  PERFORM require_staff_role(v_restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);

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

REVOKE EXECUTE ON FUNCTION assign_reservation_tables(uuid, uuid, timestamptz, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION mark_reservation_tables_seated(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION release_reservation_tables(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION assign_reservation_tables(uuid, uuid, timestamptz, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION mark_reservation_tables_seated(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION release_reservation_tables(uuid) TO authenticated, service_role;
