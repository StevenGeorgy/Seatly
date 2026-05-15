-- Phase 1 of diner auth overhaul (2026-05-15): every auth.users INSERT
-- must produce a matching user_profiles row, populated from whatever
-- claims the provider gave us (full_name / email / phone). Eliminates
-- the "NULL profile" state that the booking-form pre-fill, conflict
-- detection, and Hey Cenaiva personalization all silently miss today.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (
    auth_user_id,
    email,
    phone,
    full_name,
    role
  ) VALUES (
    NEW.id,
    NEW.email,
    NEW.phone,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name'
    ),
    'customer'
  )
  ON CONFLICT (auth_user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- supabase_auth_admin is the role that fires triggers on auth.users.
-- It needs INSERT (for the trigger) and SELECT (for ON CONFLICT to
-- read the existing row's auth_user_id index).
GRANT INSERT, SELECT ON public.user_profiles TO supabase_auth_admin;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- One-shot backfill: any existing auth.users without a user_profiles
-- row gets one created retroactively. Today there are 17 auth users
-- (all owner-signup); they already have profiles, so this is a no-op
-- for now. Defends against future divergence.
INSERT INTO public.user_profiles (auth_user_id, email, phone, full_name, role)
SELECT
  au.id,
  au.email,
  au.phone,
  COALESCE(
    au.raw_user_meta_data->>'full_name',
    au.raw_user_meta_data->>'name'
  ),
  'customer'
FROM auth.users au
LEFT JOIN public.user_profiles up ON up.auth_user_id = au.id
WHERE up.id IS NULL
ON CONFLICT (auth_user_id) DO NOTHING;
