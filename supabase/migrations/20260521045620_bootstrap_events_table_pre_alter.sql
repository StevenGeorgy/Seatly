-- The events table exists in prod but was never added as a CREATE TABLE
-- migration locally. The next migration (20260417000002_create_events.sql)
-- only does ALTER TABLE events ADD COLUMN IF NOT EXISTS theme — so it
-- requires events to already exist. Bootstrap with full prod schema.
CREATE TABLE IF NOT EXISTS public.events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  date date,
  start_time time without time zone,
  end_time time without time zone,
  price_per_person numeric(12,2),
  capacity integer,
  tickets_sold integer DEFAULT 0,
  is_recurring boolean DEFAULT false,
  recurrence_rule text,
  stripe_product_id text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  cover_image_url text,
  min_age integer,
  dress_code text,
  menu_id uuid,
  is_private boolean DEFAULT false,
  updated_at timestamptz DEFAULT now(),
  theme text,
  end_date date,
  media_url text,
  media_type text,
  media_name text,
  fixed_arrival_time boolean NOT NULL DEFAULT false,
  CONSTRAINT events_pkey PRIMARY KEY (id)
);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_events_restaurant ON public.events(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_events_date ON public.events(date);
