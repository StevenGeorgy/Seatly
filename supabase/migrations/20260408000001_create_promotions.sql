-- Promotions / Deals table
-- Allows restaurant owners/managers to create time-limited offers (BOGO, %, fixed, free item)
-- that appear on the customer-facing Deals discovery page.

CREATE TABLE IF NOT EXISTS promotions (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id    UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  description      TEXT,
  promo_type       TEXT NOT NULL CHECK (promo_type IN ('bogo', 'percentage', 'fixed', 'free_item')),
  discount_value   NUMERIC,
  discount_unit    TEXT CHECK (discount_unit IN ('percent', 'dollar')),
  applies_to       TEXT NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all', 'dine_in', 'pickup', 'delivery')),
  min_order_amount NUMERIC,
  starts_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at          TIMESTAMPTZ,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  promo_code       TEXT,
  max_uses         INTEGER,
  current_uses     INTEGER NOT NULL DEFAULT 0,
  badge_color      TEXT NOT NULL DEFAULT 'amber' CHECK (badge_color IN ('amber', 'green', 'red', 'blue')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS promotions_restaurant_id_idx ON promotions (restaurant_id);
CREATE INDEX IF NOT EXISTS promotions_active_idx ON promotions (is_active, ends_at);

ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

-- Customers (and unauthenticated): read active, non-expired promotions with their restaurant info
CREATE POLICY "Public read active promotions"
  ON promotions FOR SELECT
  USING (
    is_active = TRUE
    AND (ends_at IS NULL OR ends_at > NOW())
    AND (max_uses IS NULL OR current_uses < max_uses)
  );

-- Owners and managers: full CRUD on their restaurant's promotions
CREATE POLICY "Owners manage promotions"
  ON promotions FOR ALL
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM user_restaurant_roles
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM user_restaurant_roles
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );
