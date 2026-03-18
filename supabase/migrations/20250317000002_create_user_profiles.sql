-- Phase 1.2: Create user_profiles table
CREATE TABLE user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone text,
  email text,
  avatar_url text,
  role text NOT NULL DEFAULT 'customer',
  restaurant_id uuid REFERENCES restaurants(id) ON DELETE SET NULL,
  birthday date,
  dietary_restrictions text[],
  allergies text[],
  seating_preference text,
  noise_preference text,
  preferred_language text,
  notification_preferences_json jsonb,
  car_details_json jsonb,
  stripe_payment_method_id text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_user_profiles_auth_user_id ON user_profiles(auth_user_id);
CREATE INDEX idx_user_profiles_restaurant_id ON user_profiles(restaurant_id);
