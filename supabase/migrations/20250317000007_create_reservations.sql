-- Phase 3.2: Create reservations table
CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  table_id uuid REFERENCES "tables"(id) ON DELETE SET NULL,
  shift_id uuid NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  party_size int NOT NULL,
  reserved_at timestamptz NOT NULL,
  status text DEFAULT 'pending',
  source text DEFAULT 'app',
  special_request text,
  occasion text,
  confirmed_at timestamptz,
  checked_in_at timestamptz,
  seated_at timestamptz,
  completed_at timestamptz,
  no_show_risk_score int,
  waiter_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  deposit_amount decimal(12,2),
  deposit_status text DEFAULT 'none',
  deposit_stripe_payment_intent_id text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_reservations_restaurant_id ON reservations(restaurant_id);
CREATE INDEX idx_reservations_guest_id ON reservations(guest_id);
CREATE INDEX idx_reservations_reserved_at ON reservations(reserved_at);
CREATE INDEX idx_reservations_shift_id ON reservations(shift_id);
