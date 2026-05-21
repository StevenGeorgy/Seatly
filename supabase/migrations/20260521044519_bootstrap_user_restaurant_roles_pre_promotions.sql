-- This table exists in prod but was never added to the local migrations
-- folder (probably created manually via SQL editor early on). Bootstrap
-- it on the new sandbox project BEFORE the 2026-04-08 promotions
-- migration runs, since promotions and 9 other migrations reference it.
-- Later migrations (20260503*) add the RLS policies + helper functions.
CREATE TABLE IF NOT EXISTS public.user_restaurant_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  role text NOT NULL,
  is_primary boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  hourly_rate numeric DEFAULT 0.00,
  employment_type text,
  permission_overrides_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT user_restaurant_roles_pkey PRIMARY KEY (id),
  CONSTRAINT user_restaurant_roles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE CASCADE,
  CONSTRAINT user_restaurant_roles_restaurant_id_fkey
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
  CONSTRAINT user_restaurant_roles_role_check
    CHECK (role IN ('owner','manager','server','host','kitchen','bar','staff')),
  CONSTRAINT user_restaurant_roles_employment_type_check
    CHECK (employment_type IS NULL OR employment_type IN ('full_time','part_time','casual')),
  CONSTRAINT user_restaurant_roles_permission_overrides_object_check
    CHECK (jsonb_typeof(permission_overrides_json) = 'object'),
  CONSTRAINT user_restaurant_roles_user_id_restaurant_id_key
    UNIQUE (user_id, restaurant_id)
);
ALTER TABLE public.user_restaurant_roles ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_urr_user ON public.user_restaurant_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_urr_restaurant ON public.user_restaurant_roles(restaurant_id);
