-- Extend promotions with item scoping for percentage/fixed types and BOGO thresholds
ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS eligible_item_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS buy_quantity INT NOT NULL DEFAULT 1 CHECK (buy_quantity >= 1),
  ADD COLUMN IF NOT EXISTS get_quantity INT NOT NULL DEFAULT 1 CHECK (get_quantity >= 1);

-- Link orders to the promotion that was applied
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS promotion_id UUID REFERENCES promotions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_promotion_id_idx ON orders(promotion_id);
