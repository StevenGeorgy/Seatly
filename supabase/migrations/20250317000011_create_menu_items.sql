-- Phase 4.2: Create menu_items table
CREATE TABLE menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price decimal(12,2) NOT NULL,
  category text,
  photo_url text,
  allergens text[],
  dietary_flags text[],
  preparation_time_minutes int,
  is_available boolean DEFAULT true,
  is_preorderable boolean DEFAULT false,
  is_active boolean DEFAULT true,
  sort_order int DEFAULT 0,
  spice_level text,
  pairing_suggestions text,
  loyalty_points_value int DEFAULT 0,
  cost_price decimal(12,2),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_menu_items_restaurant_id ON menu_items(restaurant_id);
CREATE INDEX idx_menu_items_category ON menu_items(restaurant_id, category);
