-- Phase 1.3: Create tables table (physical restaurant tables)
CREATE TABLE "tables" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_number text NOT NULL,
  capacity int NOT NULL,
  section text,
  position_x float DEFAULT 0,
  position_y float DEFAULT 0,
  shape text DEFAULT 'rectangle',
  status text DEFAULT 'empty',
  is_active boolean DEFAULT true,
  combined_with uuid[]
);

ALTER TABLE "tables" ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_tables_restaurant_id ON "tables"(restaurant_id);
