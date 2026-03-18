-- Phase 3.1: Create guests table (required for reservations)
CREATE TABLE guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  user_profile_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  full_name text,
  email text,
  phone text,
  birthday date,
  anniversary date,
  preferred_language text,
  tags text[],
  dietary_restrictions text[],
  allergies text[],
  seating_preference text,
  noise_preference text,
  favourite_dishes text[],
  favourite_drinks text[],
  internal_notes text,
  total_visits int DEFAULT 0,
  total_spend decimal(12,2) DEFAULT 0,
  average_spend_per_visit decimal(12,2),
  highest_single_bill decimal(12,2),
  no_show_count int DEFAULT 0,
  cancellation_count int DEFAULT 0,
  last_visit_at timestamptz,
  first_visit_at timestamptz,
  no_show_risk_score int,
  lifetime_value_score int,
  is_vip boolean DEFAULT false,
  is_blocked boolean DEFAULT false,
  loyalty_points_balance int DEFAULT 0,
  loyalty_points_earned_total int DEFAULT 0,
  loyalty_points_redeemed_total int DEFAULT 0,
  loyalty_tier text,
  sms_opt_in boolean DEFAULT true,
  email_opt_in boolean DEFAULT true,
  preferred_payment_method text,
  car_details_json jsonb,
  stripe_payment_method_id text,
  total_deposits_paid decimal(12,2) DEFAULT 0,
  total_deposits_forfeited decimal(12,2) DEFAULT 0,
  food_spend_total decimal(12,2) DEFAULT 0,
  drinks_spend_total decimal(12,2) DEFAULT 0,
  duplicate_of uuid REFERENCES guests(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE guests ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_guests_restaurant_id ON guests(restaurant_id);
CREATE INDEX idx_guests_user_profile_id ON guests(user_profile_id);
CREATE INDEX idx_guests_email ON guests(restaurant_id, email);
CREATE INDEX idx_guests_phone ON guests(restaurant_id, phone);
