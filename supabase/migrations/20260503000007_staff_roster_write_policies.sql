-- Guarded active-staff management from Staff Invites.
-- Owners can manage non-self staff. Managers can manage hosts only.

CREATE OR REPLACE FUNCTION public.current_roster_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT up.id
  FROM public.user_profiles up
  WHERE up.auth_user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_roster_staff_role(p_restaurant_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT urr.role
  FROM public.user_restaurant_roles urr
  WHERE urr.restaurant_id = p_restaurant_id
    AND urr.user_id = public.current_roster_profile_id()
  ORDER BY CASE urr.role
    WHEN 'owner' THEN 1
    WHEN 'manager' THEN 2
    WHEN 'host' THEN 3
    ELSE 9
  END
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_staff_access(
  p_restaurant_id uuid,
  p_target_profile_id uuid,
  p_target_role text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT
    public.current_roster_profile_id() IS NOT NULL
    AND p_target_profile_id <> public.current_roster_profile_id()
    AND NOT (
      p_target_role = 'owner'
      AND (
        SELECT COUNT(*)
        FROM public.user_restaurant_roles owner_role
        WHERE owner_role.restaurant_id = p_restaurant_id
          AND owner_role.role = 'owner'
      ) <= 1
    )
    AND (
      public.current_roster_staff_role(p_restaurant_id) = 'owner'
      OR (
        public.current_roster_staff_role(p_restaurant_id) = 'manager'
        AND p_target_role = 'host'
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_save_staff_access(
  p_restaurant_id uuid,
  p_target_profile_id uuid,
  p_new_role text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT
    public.current_roster_profile_id() IS NOT NULL
    AND p_target_profile_id <> public.current_roster_profile_id()
    AND p_new_role IN ('owner', 'manager', 'host')
    AND (
      public.current_roster_staff_role(p_restaurant_id) = 'owner'
      OR (
        public.current_roster_staff_role(p_restaurant_id) = 'manager'
        AND p_new_role = 'host'
      )
    );
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_restaurant_roles'
      AND policyname = 'user_restaurant_roles_owner_manager_roster_update'
  ) THEN
    CREATE POLICY user_restaurant_roles_owner_manager_roster_update
      ON public.user_restaurant_roles
      FOR UPDATE
      TO authenticated
      USING (public.can_manage_staff_access(restaurant_id, user_id, role))
      WITH CHECK (public.can_save_staff_access(restaurant_id, user_id, role));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_restaurant_roles'
      AND policyname = 'user_restaurant_roles_owner_manager_roster_delete'
  ) THEN
    CREATE POLICY user_restaurant_roles_owner_manager_roster_delete
      ON public.user_restaurant_roles
      FOR DELETE
      TO authenticated
      USING (public.can_manage_staff_access(restaurant_id, user_id, role));
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.current_roster_profile_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_roster_staff_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_staff_access(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_save_staff_access(uuid, uuid, text) TO authenticated, service_role;
