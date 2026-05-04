-- Host/staff invitations.
-- Access is still finalized through user_restaurant_roles; this table only tracks invite delivery.

CREATE TABLE IF NOT EXISTS staff_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'host'
    CHECK (role IN ('host')),
  email text,
  phone text,
  token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired')),
  invited_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  invited_by_email text,
  message_channel text NOT NULL
    CHECK (message_channel IN ('email', 'sms')),
  delivery_status text NOT NULL DEFAULT 'created'
    CHECK (delivery_status IN ('created', 'sent', 'setup_required', 'failed')),
  delivery_error text,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (email IS NOT NULL AND btrim(email) <> '' AND phone IS NULL)
    OR (phone IS NOT NULL AND btrim(phone) <> '' AND email IS NULL)
  )
);

ALTER TABLE staff_invitations ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_invitations_token
  ON staff_invitations(token);

CREATE INDEX IF NOT EXISTS idx_staff_invitations_restaurant_id
  ON staff_invitations(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_staff_invitations_status
  ON staff_invitations(status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_invitations_pending_email
  ON staff_invitations(restaurant_id, lower(email))
  WHERE email IS NOT NULL AND status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_invitations_pending_phone
  ON staff_invitations(restaurant_id, phone)
  WHERE phone IS NOT NULL AND status = 'pending';

CREATE OR REPLACE FUNCTION staff_invitation_can_manage(p_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_restaurant_roles urr
    JOIN user_profiles up ON up.id = urr.user_id
    WHERE up.auth_user_id = auth.uid()
      AND urr.restaurant_id = p_restaurant_id
      AND urr.role IN ('owner', 'manager')
  );
$$;

CREATE POLICY staff_invitations_owner_manager_select
  ON staff_invitations FOR SELECT
  TO authenticated
  USING (staff_invitation_can_manage(restaurant_id));

CREATE POLICY staff_invitations_owner_manager_insert
  ON staff_invitations FOR INSERT
  TO authenticated
  WITH CHECK (staff_invitation_can_manage(restaurant_id));

CREATE POLICY staff_invitations_owner_manager_update
  ON staff_invitations FOR UPDATE
  TO authenticated
  USING (staff_invitation_can_manage(restaurant_id))
  WITH CHECK (staff_invitation_can_manage(restaurant_id));

GRANT EXECUTE ON FUNCTION staff_invitation_can_manage(uuid) TO authenticated, service_role;
