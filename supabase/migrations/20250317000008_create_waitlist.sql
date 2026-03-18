-- Phase 3.3: Create waitlist table
CREATE TABLE waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  guest_name text,
  phone text,
  party_size int NOT NULL,
  joined_at timestamptz DEFAULT now(),
  estimated_wait_minutes int,
  status text DEFAULT 'waiting',
  notes text,
  position int,
  remote_join boolean DEFAULT false,
  notified_at timestamptz,
  response text
);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_waitlist_restaurant_id ON waitlist(restaurant_id);
CREATE INDEX idx_waitlist_status ON waitlist(restaurant_id, status);
