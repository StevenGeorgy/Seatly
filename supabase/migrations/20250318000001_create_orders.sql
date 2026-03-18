-- Phase 5: Create orders table
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  is_preorder boolean DEFAULT false,
  status text DEFAULT 'pending',
  subtotal decimal(12,2),
  tax_amount decimal(12,2),
  tip_amount decimal(12,2),
  total_amount decimal(12,2),
  payment_method text,
  discount_amount decimal(12,2),
  discount_reason text,
  split_type text DEFAULT 'none',
  room_number text,
  corporate_account_id uuid,
  created_at timestamptz DEFAULT now(),
  billed_at timestamptz,
  paid_at timestamptz
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_orders_restaurant_id ON orders(restaurant_id);
CREATE INDEX idx_orders_reservation_id ON orders(reservation_id);
CREATE INDEX idx_orders_guest_id ON orders(guest_id);
CREATE INDEX idx_orders_paid_at ON orders(paid_at);
