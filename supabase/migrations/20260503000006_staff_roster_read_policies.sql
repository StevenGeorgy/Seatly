-- Allow owners and managers to view active workspace staff for their restaurant.
-- Staff membership still comes from user_restaurant_roles; this only opens
-- read access for roster displays such as Staff Invites > Active staff.

CREATE OR REPLACE FUNCTION public.restaurant_staff_can_manage_roster(p_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_restaurant_roles manager_role
    JOIN public.user_profiles manager_profile
      ON manager_profile.id = manager_role.user_id
    WHERE manager_role.restaurant_id = p_restaurant_id
      AND manager_role.role IN ('owner', 'manager')
      AND (
        manager_role.user_id = auth.uid()
        OR manager_profile.auth_user_id = auth.uid()
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.profile_belongs_to_managed_restaurant(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_restaurant_roles staff_role
    WHERE staff_role.user_id = p_profile_id
      AND public.restaurant_staff_can_manage_roster(staff_role.restaurant_id)
  );
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_restaurant_roles'
      AND policyname = 'user_restaurant_roles_owner_manager_roster_select'
  ) THEN
    CREATE POLICY user_restaurant_roles_owner_manager_roster_select
      ON public.user_restaurant_roles
      FOR SELECT
      TO authenticated
      USING (public.restaurant_staff_can_manage_roster(restaurant_id));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_profiles'
      AND policyname = 'user_profiles_owner_manager_roster_select'
  ) THEN
    CREATE POLICY user_profiles_owner_manager_roster_select
      ON public.user_profiles
      FOR SELECT
      TO authenticated
      USING (public.profile_belongs_to_managed_restaurant(id));
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.restaurant_staff_can_manage_roster(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_belongs_to_managed_restaurant(uuid) TO authenticated, service_role;
