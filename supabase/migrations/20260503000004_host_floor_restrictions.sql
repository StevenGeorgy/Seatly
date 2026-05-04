-- Separate live service access from floor-plan layout editing.
-- Hosts can update constrained table service state through an RPC. Owners and
-- managers retain direct layout management for tables, floors, and sections.

CREATE OR REPLACE FUNCTION staff_has_restaurant_role(
  p_restaurant_id uuid,
  p_roles text[]
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_restaurant_roles urr
    LEFT JOIN user_profiles up ON up.id = urr.user_id
    WHERE urr.restaurant_id = p_restaurant_id
      AND urr.role = ANY(p_roles)
      AND (urr.user_id = auth.uid() OR up.auth_user_id = auth.uid())
  );
$$;

GRANT EXECUTE ON FUNCTION staff_has_restaurant_role(uuid, text[]) TO authenticated, service_role;

DROP POLICY IF EXISTS tables_select_staff ON "tables";
DROP POLICY IF EXISTS tables_insert_owner ON "tables";
DROP POLICY IF EXISTS tables_update_owner ON "tables";
DROP POLICY IF EXISTS tables_delete_owner ON "tables";
DROP POLICY IF EXISTS tables_select_staff_roles ON "tables";
DROP POLICY IF EXISTS tables_insert_layout_owner_manager ON "tables";
DROP POLICY IF EXISTS tables_update_layout_owner_manager ON "tables";
DROP POLICY IF EXISTS tables_delete_layout_owner_manager ON "tables";

CREATE POLICY tables_select_staff_roles
  ON "tables" FOR SELECT
  TO authenticated
  USING (
    staff_has_restaurant_role(
      restaurant_id,
      ARRAY['owner', 'manager', 'server', 'host', 'kitchen', 'bar', 'staff']
    )
  );

CREATE POLICY tables_insert_layout_owner_manager
  ON "tables" FOR INSERT
  TO authenticated
  WITH CHECK (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager']));

CREATE POLICY tables_update_layout_owner_manager
  ON "tables" FOR UPDATE
  TO authenticated
  USING (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager']))
  WITH CHECK (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager']));

CREATE POLICY tables_delete_layout_owner_manager
  ON "tables" FOR DELETE
  TO authenticated
  USING (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager']));

DO $$
BEGIN
  IF to_regclass('public.floor_plans') IS NOT NULL THEN
    ALTER TABLE public.floor_plans ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS floor_plans_select_staff_roles ON public.floor_plans;
    DROP POLICY IF EXISTS floor_plans_manage_layout_owner_manager ON public.floor_plans;

    EXECUTE $policy$
      CREATE POLICY floor_plans_select_staff_roles
        ON public.floor_plans FOR SELECT
        TO authenticated
        USING (
          staff_has_restaurant_role(
            restaurant_id,
            ARRAY['owner', 'manager', 'server', 'host', 'kitchen', 'bar', 'staff']
          )
        )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY floor_plans_manage_layout_owner_manager
        ON public.floor_plans FOR ALL
        TO authenticated
        USING (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager']))
        WITH CHECK (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager']))
    $policy$;
  END IF;

  IF to_regclass('public.restaurant_sections') IS NOT NULL THEN
    ALTER TABLE public.restaurant_sections ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS restaurant_sections_select_staff_roles ON public.restaurant_sections;
    DROP POLICY IF EXISTS restaurant_sections_manage_layout_owner_manager ON public.restaurant_sections;

    EXECUTE $policy$
      CREATE POLICY restaurant_sections_select_staff_roles
        ON public.restaurant_sections FOR SELECT
        TO authenticated
        USING (
          staff_has_restaurant_role(
            restaurant_id,
            ARRAY['owner', 'manager', 'server', 'host', 'kitchen', 'bar', 'staff']
          )
        )
    $policy$;

    EXECUTE $policy$
      CREATE POLICY restaurant_sections_manage_layout_owner_manager
        ON public.restaurant_sections FOR ALL
        TO authenticated
        USING (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager']))
        WITH CHECK (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager']))
    $policy$;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION update_table_service_status(
  p_table_id uuid,
  p_status text,
  p_seated_count integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table "tables"%ROWTYPE;
  v_status text;
  v_seated integer;
BEGIN
  SELECT *
  INTO v_table
  FROM "tables"
  WHERE id = p_table_id
    AND COALESCE(is_active, true);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Table not found.';
  END IF;

  IF NOT staff_has_restaurant_role(
    v_table.restaurant_id,
    ARRAY['owner', 'manager', 'server', 'host', 'staff']
  ) THEN
    RAISE EXCEPTION 'Not allowed to update table service status.';
  END IF;

  v_status := CASE p_status
    WHEN 'empty' THEN 'empty'
    WHEN 'reserved' THEN 'reserved'
    WHEN 'occupied' THEN 'occupied'
    WHEN 'cleaning' THEN 'cleaning'
    ELSE NULL
  END;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Unsupported table service status.';
  END IF;

  IF COALESCE(v_table.status, 'empty') = 'blocked'
    AND NOT staff_has_restaurant_role(v_table.restaurant_id, ARRAY['owner', 'manager']) THEN
    RAISE EXCEPTION 'Only owners and managers can update blocked tables.';
  END IF;

  v_seated := LEAST(GREATEST(COALESCE(p_seated_count, 0), 0), COALESCE(v_table.capacity, 0));

  IF v_status IN ('empty', 'cleaning') THEN
    v_seated := 0;
  END IF;

  UPDATE "tables"
  SET status = v_status,
      seated_count = v_seated,
      combined_with = CASE WHEN v_status = 'empty' THEN NULL ELSE combined_with END,
      updated_at = now()
  WHERE id = p_table_id;

  IF v_status = 'empty' AND to_regclass('public.reservation_tables') IS NOT NULL THEN
    UPDATE reservation_tables
    SET released_at = now()
    WHERE table_id = p_table_id
      AND released_at IS NULL;
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION update_table_service_status(uuid, text, integer) TO authenticated, service_role;
