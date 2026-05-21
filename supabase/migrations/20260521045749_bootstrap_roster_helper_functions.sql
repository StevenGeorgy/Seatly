-- These 6 helper functions exist in prod but were never added to local
-- migrations. They are referenced by RLS policies in many later
-- migrations (expenses, staff roster, etc.). Bootstrap them BEFORE
-- those migrations run.

CREATE OR REPLACE FUNCTION public.current_roster_profile_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
  SELECT up.id
  FROM public.user_profiles up
  WHERE up.auth_user_id = auth.uid()
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.current_roster_staff_role(p_restaurant_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.user_restaurant_role_row_is_mine(p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = p_profile_id
      AND up.auth_user_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.restaurant_staff_can_manage_roster(p_restaurant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.can_manage_staff_access(p_restaurant_id uuid, p_target_profile_id uuid, p_target_role text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.can_save_staff_access(p_restaurant_id uuid, p_target_profile_id uuid, p_new_role text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
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
$function$;
