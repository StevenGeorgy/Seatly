-- Reservation capacity and public booking hardening.
-- Supports large parties up to physical floor capacity while keeping table
-- assignment on the backend.

ALTER TABLE public."tables"
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS min_party integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS section_id uuid,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS guest_full_name text,
  ADD COLUMN IF NOT EXISTS guest_email text,
  ADD COLUMN IF NOT EXISTS guest_phone text,
  ADD COLUMN IF NOT EXISTS dietary_notes text,
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS is_guest_checkout boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.restaurant_floor_capacity(
  p_restaurant_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT COALESCE(SUM(GREATEST(COALESCE(t.capacity, 0), 0)), 0)::integer
  FROM public."tables" t
  WHERE t.restaurant_id = p_restaurant_id
    AND COALESCE(t.is_active, true)
    AND COALESCE(t.status, 'empty') <> 'blocked';
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

  IF p_party_size > public.restaurant_floor_capacity(p_restaurant_id) THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  v_turn_minutes := COALESCE(p_turn_minutes, public.restaurant_turn_time_minutes(p_restaurant_id), 90);
  v_slot_end := p_reserved_at + make_interval(mins => v_turn_minutes);

  SELECT COALESCE(array_agg(DISTINCT blocked.table_id), ARRAY[]::uuid[])
  INTO v_unavailable
  FROM (
    SELECT rt.table_id
    FROM public.reservations r
    JOIN public.reservation_tables rt
      ON rt.reservation_id = r.id
      AND rt.released_at IS NULL
    WHERE r.restaurant_id = p_restaurant_id
      AND (p_exclude_reservation_id IS NULL OR r.id <> p_exclude_reservation_id)
      AND r.status IN ('pending', 'confirmed', 'seated')
      AND r.reserved_at < v_slot_end
      AND r.reserved_at + make_interval(mins => COALESCE(r.duration_minutes, v_turn_minutes, 90)) > p_reserved_at

    UNION

    SELECT r.table_id
    FROM public.reservations r
    WHERE r.restaurant_id = p_restaurant_id
      AND r.table_id IS NOT NULL
      AND (p_exclude_reservation_id IS NULL OR r.id <> p_exclude_reservation_id)
      AND r.status IN ('pending', 'confirmed', 'seated')
      AND r.reserved_at < v_slot_end
      AND r.reserved_at + make_interval(mins => COALESCE(r.duration_minutes, v_turn_minutes, 90)) > p_reserved_at
  ) blocked;

  -- First choice: a single table, with exact/smallest fit winning.
  SELECT ARRAY[t.id]
  INTO v_group
  FROM public."tables" t
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

  -- Large parties: build an adjacent same-section group. The recursive search
  -- keeps combinations deterministic and prefers fewer tables, then less spare
  -- capacity.
  WITH RECURSIVE available AS (
    SELECT
      t.id,
      GREATEST(COALESCE(t.capacity, 0), 0)::integer AS capacity,
      COALESCE(t.section_id::text, t.section, '') AS section_key,
      COALESCE(t.position_x, 0)::double precision AS x,
      COALESCE(t.position_y, 0)::double precision AS y,
      COALESCE(t.label, t.table_number, t.id::text) AS sort_label
    FROM public."tables" t
    WHERE t.restaurant_id = p_restaurant_id
      AND COALESCE(t.is_active, true)
      AND COALESCE(t.status, 'empty') <> 'blocked'
      AND NOT (t.id = ANY(v_unavailable))
      AND COALESCE(t.min_party, 1) <= p_party_size
      AND GREATEST(COALESCE(t.capacity, 0), 0) > 0
    ORDER BY t.capacity ASC, t.table_number ASC
    LIMIT 36
  ),
  groups AS (
    SELECT
      ARRAY[a.id] AS table_ids,
      ARRAY[a.id::text] AS path,
      a.capacity AS total_capacity,
      1 AS table_count,
      a.section_key,
      ARRAY[a.sort_label] AS sort_labels
    FROM available a

    UNION ALL

    SELECT
      g.table_ids || a.id,
      g.path || a.id::text,
      g.total_capacity + a.capacity,
      g.table_count + 1,
      g.section_key,
      g.sort_labels || a.sort_label
    FROM groups g
    JOIN available a
      ON a.section_key = g.section_key
      AND a.id::text > g.path[array_length(g.path, 1)]
    WHERE g.total_capacity < p_party_size
      AND g.table_count < 16
      AND EXISTS (
        SELECT 1
        FROM available existing
        WHERE existing.id = ANY(g.table_ids)
          AND sqrt(power(existing.x - a.x, 2) + power(existing.y - a.y, 2)) <= COALESCE(p_adjacency_distance, 170)
      )
  )
  SELECT table_ids
  INTO v_group
  FROM groups
  WHERE total_capacity >= p_party_size
  ORDER BY table_count ASC, total_capacity ASC, sort_labels ASC
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
  v_request_role text;
BEGIN
  SELECT restaurant_id
  INTO v_reservation_restaurant
  FROM public.reservations
  WHERE id = p_reservation_id;

  IF v_reservation_restaurant IS NULL OR v_reservation_restaurant <> p_restaurant_id THEN
    RAISE EXCEPTION 'Reservation not found for this restaurant.';
  END IF;

  v_request_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  IF v_request_role <> 'service_role' THEN
    PERFORM public.require_staff_role(p_restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);
  END IF;

  v_turn_minutes := COALESCE(p_turn_minutes, public.restaurant_turn_time_minutes(p_restaurant_id), 90);

  v_group := public.find_available_table_group(
    p_restaurant_id,
    p_reserved_at,
    p_party_size,
    v_turn_minutes,
    p_reservation_id
  );

  IF COALESCE(array_length(v_group, 1), 0) = 0 THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  UPDATE public.reservation_tables
  SET released_at = now()
  WHERE reservation_id = p_reservation_id
    AND released_at IS NULL;

  FOREACH v_table_id IN ARRAY v_group LOOP
    INSERT INTO public.reservation_tables (
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

  UPDATE public.reservations
  SET table_id = v_group[1],
      duration_minutes = v_turn_minutes,
      updated_at = now()
  WHERE id = p_reservation_id
    AND restaurant_id = p_restaurant_id;

  RETURN v_group;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_reservation_tables(uuid, uuid, timestamptz, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.restaurant_floor_capacity(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_available_table_group(uuid, timestamptz, integer, integer, uuid, double precision) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_reservation_tables(uuid, uuid, timestamptz, integer, integer) TO authenticated, service_role;
