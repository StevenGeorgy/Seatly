-- Restaurant onboarding wizard, Phase A: publish gate + Stripe wiring columns
-- + demo_requests lead-capture table.
--
-- Today every restaurant created via signup-restaurant-owner lands on Discover
-- the moment `is_active=true` is set, but the new 8-step wizard collects data
-- across multiple sessions before the restaurant is bookable. We need a
-- separate "owner explicitly clicked Publish" gate so the row can stay
-- editable in the dashboard without leaking onto Discover.
--
-- CLAUDE.md hard rule preserved: `is_active` keeps its default of true.
-- `is_published` is the new visibility gate. Diner-side SELECTs add
-- `.eq("is_published", true)`; owner-side dashboard SELECTs do NOT, so the
-- owner can keep editing an unpublished restaurant.
--
-- Existing restaurants (Mark Testing, Jacobs, Harbour Sixty, etc.) are
-- grandfathered as `is_published = true` by the UPDATE below so the rollout
-- is invisible to current diners.
--
-- The Stripe columns (`stripe_account_id`, `stripe_customer_id`,
-- `subscription_status`, `trial_ends_at`) are added now even though the
-- Stripe integration ships in Phase D — wiring the columns in early lets
-- Phase B/C wizard steps reference them as nullable fields without another
-- migration. `stripe_account_id` already existed in the Restaurant TS type
-- but had never been added to the DB schema; this migration creates the
-- column so the type definition is finally truthful.
--
-- `menu_categories.is_pricing_tier_source` is the per-restaurant flag that
-- says "use the average price of items in this category to derive the
-- restaurant's $/$$/$$$/$$$$ price level on Discover cards". Only one
-- category per restaurant may have the flag set — enforced by the partial
-- unique index. The wizard's Step 5 forces the owner to tick exactly one
-- category.
--
-- `demo_requests` backs the new /book-a-demo marketing page (Phase D), which
-- is an anon-callable lead form. RLS: anon may INSERT; service_role may
-- SELECT for the future ops dashboard. No UPDATE/DELETE policies — those
-- happen via service_role only.

-- ───────────────────────────── restaurants ──────────────────────────────────

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS subscription_status TEXT;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- Grandfather every existing restaurant as published. CLAUDE.md notes
-- "Mark Testing" (aaa5e3d3-d8f2-4bae-8615-dc4e6ea83d2c) is an intentional
-- live row, alongside Jacobs, Harbour Sixty, etc. — they should all stay
-- visible on Discover when this migration applies.
UPDATE public.restaurants
   SET is_published = true
 WHERE created_at < NOW();

-- Hot-path index for the diner-side Discover SELECT
-- (`is_active = true AND is_published = true`). Partial index keeps it
-- small and lookup-fast — only published+active rows are ever served.
CREATE INDEX IF NOT EXISTS restaurants_published_active_idx
  ON public.restaurants (is_published, is_active)
  WHERE is_published = true AND is_active = true;

-- ─────────────────────────── menu_categories ────────────────────────────────

ALTER TABLE public.menu_categories
  ADD COLUMN IF NOT EXISTS is_pricing_tier_source BOOLEAN NOT NULL DEFAULT false;

-- Only one category per restaurant may be the pricing-tier source. The
-- partial unique index enforces that without blocking the common case
-- (a restaurant with zero tier-source categories during setup).
CREATE UNIQUE INDEX IF NOT EXISTS menu_categories_one_tier_source_per_restaurant_idx
  ON public.menu_categories (restaurant_id)
  WHERE is_pricing_tier_source = true;

-- ─────────────────────────── demo_requests ──────────────────────────────────

CREATE TABLE IF NOT EXISTS public.demo_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  restaurant_name TEXT,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  contacted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS demo_requests_created_at_idx
  ON public.demo_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS demo_requests_uncontacted_idx
  ON public.demo_requests (created_at DESC)
  WHERE contacted_at IS NULL;

ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;

-- Anon-callable INSERT — the /book-a-demo page is fully public, no auth
-- required. No SELECT/UPDATE/DELETE for anon. Rate limiting happens at
-- the edge function layer (submit-demo-request in Phase D).
DROP POLICY IF EXISTS demo_requests_anon_insert ON public.demo_requests;
CREATE POLICY demo_requests_anon_insert ON public.demo_requests
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- service_role SELECT for the future ops dashboard. No UPDATE/DELETE
-- policies — `contacted_at` updates happen via service_role only.
DROP POLICY IF EXISTS demo_requests_service_read ON public.demo_requests;
CREATE POLICY demo_requests_service_read ON public.demo_requests
  FOR SELECT
  TO service_role
  USING (true);

COMMENT ON TABLE public.demo_requests IS
  'Marketing lead capture for /book-a-demo. Anon INSERT; service_role SELECT for ops dashboard.';

COMMENT ON COLUMN public.restaurants.is_published IS
  'Owner-controlled visibility gate. Diner-side queries filter is_active=true AND is_published=true. Owner-side dashboard queries do NOT filter on is_published so unpublished restaurants stay editable.';

COMMENT ON COLUMN public.restaurants.subscription_status IS
  'Stripe Billing subscription status: trialing | active | past_due | canceled | unpaid. Null until Phase D wires up Stripe.';

COMMENT ON COLUMN public.menu_categories.is_pricing_tier_source IS
  'Exactly one category per restaurant may have this true. The average price of items in that category derives the restaurant''s $/$$/$$$/$$$$ price level on Discover cards.';
