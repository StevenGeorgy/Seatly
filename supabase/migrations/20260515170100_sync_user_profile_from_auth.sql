-- Phase 1 companion: when auth.users.email or auth.users.phone changes
-- (e.g. diner adds a phone via Supabase's phone-add flow, or verifies a
-- new email), mirror the change into user_profiles IF the profile field
-- is currently NULL. We intentionally do NOT clobber non-null values —
-- the diner may have manually edited their displayed email/phone on
-- AccountPage and we must respect that.

CREATE OR REPLACE FUNCTION public.sync_user_profile_from_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_profiles
  SET
    email = COALESCE(email, NEW.email),
    phone = COALESCE(phone, NEW.phone)
  WHERE auth_user_id = NEW.id
    AND (
      (email IS NULL AND NEW.email IS NOT NULL)
      OR (phone IS NULL AND NEW.phone IS NOT NULL)
    );
  RETURN NEW;
END;
$$;

GRANT UPDATE ON public.user_profiles TO supabase_auth_admin;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE OF email, phone ON auth.users
  FOR EACH ROW
  WHEN (
    OLD.email IS DISTINCT FROM NEW.email
    OR OLD.phone IS DISTINCT FROM NEW.phone
  )
  EXECUTE FUNCTION public.sync_user_profile_from_auth();
