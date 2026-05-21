CREATE OR REPLACE FUNCTION public.user_has_restaurant_staff_access(p_restaurant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET row_security TO 'off'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_restaurant_roles urr
    INNER JOIN public.user_profiles up ON up.id = urr.user_id
    WHERE up.auth_user_id = auth.uid()
      AND urr.restaurant_id = p_restaurant_id
  );
$function$;
