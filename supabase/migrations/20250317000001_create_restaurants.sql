-- Phase 1.1: Create restaurants table
CREATE TABLE restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  slug text UNIQUE NOT NULL,
  logo_url text,
  cover_photo_url text,
  cuisine_type text,
  description text,
  address text,
  city text,
  province text,
  country text,
  phone text,
  email text,
  hours_json jsonb,
  settings_json jsonb,
  stripe_customer_id text,
  plan text DEFAULT 'free',
  is_active boolean DEFAULT true,
  business_type text,
  timezone text DEFAULT 'America/Toronto',
  currency text DEFAULT 'CAD',
  tax_rate decimal(5,4) DEFAULT 0.13,
  deposit_policy_json jsonb,
  loyalty_config_json jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
