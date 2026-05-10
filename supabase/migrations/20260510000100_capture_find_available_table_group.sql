-- Capture the production-deployed multi-table combiner and its helper functions
-- so the repo source matches the live database.
--
-- Background: an earlier deploy upgraded `find_available_table_group` from the
-- old 1-2-3-table algorithm in 20260503000001_add_reservation_table_assignments.sql
-- to a recursive multi-table combiner that can group up to 16 tables, with two
-- strategies (adjacent-same-section first, then any combination as fallback).
-- That deploy never landed as a committed migration, so a fresh local DB or a
-- `supabase db reset` would regress to the older algorithm. This migration
-- captures the live state exactly via CREATE OR REPLACE — pure no-op for prod,
-- restores parity everywhere else.
--
-- Captures:
--   - public.restaurant_floor_capacity(uuid)         (helper)
--   - public.restaurant_turn_time_minutes(uuid,uuid) (helper)
--   - public.find_available_table_group(...)         (main combiner)

-- ---------------------------------------------------------------------------
-- Helper: total active-table seat capacity for a restaurant.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.restaurant_floor_capacity(p_restaurant_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
  SELECT COALESCE(SUM(GREATEST(COALESCE(t.capacity, 0), 0)), 0)::integer
  FROM public."tables" t
  WHERE t.restaurant_id = p_restaurant_id
    AND COALESCE(t.is_active, true)
    AND COALESCE(t.status, 'empty') <> 'blocked';
$function$;

GRANT EXECUTE ON FUNCTION public.restaurant_floor_capacity(uuid)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helper: bounded turn-time-minutes for a restaurant (or specific shift).
-- Falls back through restaurants.settings_json.turnTimeMinutes → shift row →
-- 90, clamped to [15, 480].
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.restaurant_turn_time_minutes(
  p_restaurant_id uuid,
  p_shift_id uuid DEFAULT NULL::uuid
)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION public.restaurant_turn_time_minutes(uuid, uuid)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Main: multi-table combiner for reservation table assignment.
--
-- Strategy:
--   0. Early-out if requested party > restaurant_floor_capacity.
--   1. Single table: smallest single table that fits.
--   2. Adjacent same-section combo: recursive CTE up to 16 tables, all in the
--      same section, with adjacency check (pairwise distance <= p_adjacency_distance).
--   3. Any-combo fallback: recursive CTE up to 16 tables, no section/adjacency
--      requirement, so floor-capacity bookings still resolve when sections or
--      coordinates are unset on the floor plan.
--
-- Returns a uuid[] of selected table ids (smallest count, then smallest total
-- waste, then deterministic by sort_label).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.find_available_table_group(
  p_restaurant_id uuid,
  p_reserved_at timestamp with time zone,
  p_party_size integer,
  p_turn_minutes integer DEFAULT NULL::integer,
  p_exclude_reservation_id uuid DEFAULT NULL::uuid,
  p_adjacency_distance double precision DEFAULT 170
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Second choice: adjacent same-section groups for operationally clean joins.
  WITH RECURSIVE candidate_tables AS (
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
  available AS (
    SELECT
      row_number() OVER (ORDER BY capacity ASC, sort_label ASC, id ASC)::integer AS ord,
      id,
      capacity,
      section_key,
      x,
      y,
      sort_label
    FROM candidate_tables
  ),
  groups AS (
    SELECT
      ARRAY[a.id] AS table_ids,
      ARRAY[a.ord] AS path,
      a.capacity AS total_capacity,
      1 AS table_count,
      a.section_key,
      ARRAY[a.sort_label] AS sort_labels
    FROM available a

    UNION ALL

    SELECT
      g.table_ids || a.id,
      g.path || a.ord,
      g.total_capacity + a.capacity,
      g.table_count + 1,
      g.section_key,
      g.sort_labels || a.sort_label
    FROM groups g
    JOIN available a
      ON a.section_key = g.section_key
      AND a.ord > g.path[array_length(g.path, 1)]
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

  IF COALESCE(array_length(v_group, 1), 0) > 0 THEN
    RETURN v_group;
  END IF;

  -- Final fallback: any available active tables, so floor-capacity bookings are
  -- not hidden because a floor plan lacks section/position metadata.
  WITH RECURSIVE candidate_tables AS (
    SELECT
      t.id,
      GREATEST(COALESCE(t.capacity, 0), 0)::integer AS capacity,
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
  available AS (
    SELECT
      row_number() OVER (ORDER BY capacity ASC, sort_label ASC, id ASC)::integer AS ord,
      id,
      capacity,
      sort_label
    FROM candidate_tables
  ),
  groups AS (
    SELECT
      ARRAY[a.id] AS table_ids,
      ARRAY[a.ord] AS path,
      a.capacity AS total_capacity,
      1 AS table_count,
      ARRAY[a.sort_label] AS sort_labels
    FROM available a

    UNION ALL

    SELECT
      g.table_ids || a.id,
      g.path || a.ord,
      g.total_capacity + a.capacity,
      g.table_count + 1,
      g.sort_labels || a.sort_label
    FROM groups g
    JOIN available a
      ON a.ord > g.path[array_length(g.path, 1)]
    WHERE g.total_capacity < p_party_size
      AND g.table_count < 16
  )
  SELECT table_ids
  INTO v_group
  FROM groups
  WHERE total_capacity >= p_party_size
  ORDER BY table_count ASC, total_capacity ASC, sort_labels ASC
  LIMIT 1;

  RETURN COALESCE(v_group, ARRAY[]::uuid[]);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.find_available_table_group(uuid, timestamptz, integer, integer, uuid, double precision)
  TO anon, authenticated, service_role;
