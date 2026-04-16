-- Add stripe_customer_id to user_profiles (links to Stripe Customer object)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- Track which Stripe PaymentIntent was used on each order
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;

-- payments: receipt + refund ledger
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id),
  user_profile_id uuid REFERENCES user_profiles(id),
  stripe_payment_intent_id text UNIQUE,
  stripe_charge_id text,
  amount decimal(12,2) NOT NULL,
  currency text DEFAULT 'cad',
  status text NOT NULL DEFAULT 'pending',
  payment_type text,
  refunded_amount decimal(12,2) DEFAULT 0,
  refund_reason text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_restaurant ON payments(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_payments_intent ON payments(stripe_payment_intent_id);

-- Users can read their own payments
CREATE POLICY payments_select_own ON payments FOR SELECT
  USING (user_profile_id IN (
    SELECT id FROM user_profiles WHERE auth_user_id = auth.uid()
  ));

-- saved_cards: stores card metadata for both test mode (mock) and live mode (Stripe refs).
-- In test mode: rows are inserted directly with no stripe_payment_method_id.
-- In live mode: rows are inserted after a successful Stripe SetupIntent with the real pm_id.
CREATE TABLE IF NOT EXISTS saved_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_profile_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  stripe_payment_method_id text,
  brand text NOT NULL DEFAULT 'Visa',
  last4 text NOT NULL DEFAULT '0000',
  exp_month int,
  exp_year int,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE saved_cards ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_saved_cards_user ON saved_cards(user_profile_id);

-- Users can manage their own saved cards
CREATE POLICY saved_cards_select_own ON saved_cards FOR SELECT
  USING (user_profile_id IN (
    SELECT id FROM user_profiles WHERE auth_user_id = auth.uid()
  ));
CREATE POLICY saved_cards_insert_own ON saved_cards FOR INSERT
  WITH CHECK (user_profile_id IN (
    SELECT id FROM user_profiles WHERE auth_user_id = auth.uid()
  ));
CREATE POLICY saved_cards_update_own ON saved_cards FOR UPDATE
  USING (user_profile_id IN (
    SELECT id FROM user_profiles WHERE auth_user_id = auth.uid()
  ));
CREATE POLICY saved_cards_delete_own ON saved_cards FOR DELETE
  USING (user_profile_id IN (
    SELECT id FROM user_profiles WHERE auth_user_id = auth.uid()
  ));
