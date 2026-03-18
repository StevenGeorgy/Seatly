-- Phase 1.4: Create shifts table
CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  days_of_week int[],
  start_time time,
  end_time time,
  slot_duration_minutes int DEFAULT 30,
  max_covers int,
  turn_time_minutes int DEFAULT 90,
  min_party_size int DEFAULT 1,
  max_party_size int DEFAULT 20,
  advance_booking_days int DEFAULT 30,
  is_active boolean DEFAULT true,
  blackout_dates date[],
  vip_early_access_hours int DEFAULT 0
);

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_shifts_restaurant_id ON shifts(restaurant_id);
