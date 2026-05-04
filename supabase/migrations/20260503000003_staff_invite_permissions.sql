-- Extend staff invitations from host-only to role-aware staff invites.
-- Base access remains user_restaurant_roles.role; overrides are optional page-level exceptions.

ALTER TABLE staff_invitations
  ADD COLUMN IF NOT EXISTS permission_overrides_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE user_restaurant_roles
  ADD COLUMN IF NOT EXISTS permission_overrides_json jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'staff_invitations'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%role%'
      AND pg_get_constraintdef(con.oid) ILIKE '%host%'
  LOOP
    EXECUTE format('ALTER TABLE public.staff_invitations DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE staff_invitations
  ADD CONSTRAINT staff_invitations_role_check
  CHECK (role IN ('owner', 'manager', 'host'));

ALTER TABLE staff_invitations
  ADD CONSTRAINT staff_invitations_permission_overrides_object_check
  CHECK (jsonb_typeof(permission_overrides_json) = 'object');

ALTER TABLE user_restaurant_roles
  ADD CONSTRAINT user_restaurant_roles_permission_overrides_object_check
  CHECK (jsonb_typeof(permission_overrides_json) = 'object');
