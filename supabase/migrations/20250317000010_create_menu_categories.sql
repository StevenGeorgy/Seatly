-- Phase 4.1: Create menu_categories table
CREATE TABLE menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int DEFAULT 0,
  is_active boolean DEFAULT true
);

ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_menu_categories_restaurant_id ON menu_categories(restaurant_id);
