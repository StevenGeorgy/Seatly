-- Add geolocation columns to restaurants for map-based discovery
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;

CREATE INDEX IF NOT EXISTS idx_restaurants_latlng
  ON restaurants (lat, lng)
  WHERE lat IS NOT NULL;
