-- Create restaurant_analytics table if not exists (nightly rollups)
CREATE TABLE IF NOT EXISTS restaurant_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  date date NOT NULL,
  total_covers int DEFAULT 0,
  total_revenue decimal(12,2) DEFAULT 0,
  total_orders int DEFAULT 0,
  avg_spend_per_cover decimal(12,2) DEFAULT 0,
  no_show_count int DEFAULT 0,
  cancellation_count int DEFAULT 0,
  walk_in_count int DEFAULT 0,
  preorder_count int DEFAULT 0,
  food_revenue decimal(12,2),
  drinks_revenue decimal(12,2),
  tip_total decimal(12,2) DEFAULT 0,
  discount_total decimal(12,2) DEFAULT 0,
  deposit_revenue decimal(12,2),
  deposit_forfeitures decimal(12,2),
  top_dishes_json jsonb,
  booking_sources_json jsonb,
  new_guests_count int DEFAULT 0,
  returning_guests_count int DEFAULT 0,
  loyalty_points_issued int,
  loyalty_points_redeemed int,
  labour_cost decimal(12,2) DEFAULT 0,
  computed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_analytics_restaurant_date_idx
  ON restaurant_analytics (restaurant_id, date);

ALTER TABLE restaurant_analytics ENABLE ROW LEVEL SECURITY;

-- Staff can read their restaurant's analytics
CREATE POLICY restaurant_analytics_select ON restaurant_analytics
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = restaurant_analytics.restaurant_id
    )
  );
