-- Billing self-service columns. Powers the in-app "Edit billing details"
-- form + the Pause/Cancel subscription flows. Stripe is the source of
-- truth for tax IDs and address (we mirror locally for fast display).
--
-- Sub state flags (subscription_cancel_at_period_end, subscription_paused_at)
-- are mirrored from Stripe via the webhook's handleSubscriptionUpsert.

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS billing_legal_name text,
  ADD COLUMN IF NOT EXISTS billing_email text,
  ADD COLUMN IF NOT EXISTS billing_address_line1 text,
  ADD COLUMN IF NOT EXISTS billing_address_line2 text,
  ADD COLUMN IF NOT EXISTS billing_address_city text,
  ADD COLUMN IF NOT EXISTS billing_address_province text,
  ADD COLUMN IF NOT EXISTS billing_address_postal_code text,
  ADD COLUMN IF NOT EXISTS billing_address_country text DEFAULT 'CA',
  ADD COLUMN IF NOT EXISTS billing_tax_id_type text,
  ADD COLUMN IF NOT EXISTS billing_tax_id_value text,
  ADD COLUMN IF NOT EXISTS subscription_cancel_at_period_end boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS subscription_paused_at timestamptz;

COMMENT ON COLUMN public.restaurants.billing_legal_name IS
  'Legal entity name shown on Cenaiva invoices (e.g., "1234567 Ontario Inc."). May differ from restaurants.name.';
COMMENT ON COLUMN public.restaurants.billing_email IS
  'Recipient for monthly Cenaiva billing emails (receipts, payment failures). Defaults to restaurants.email if not set.';
COMMENT ON COLUMN public.restaurants.billing_tax_id_type IS
  'Stripe tax ID type code (e.g., "ca_gst_hst", "ca_qst", "ca_pst_bc").';
COMMENT ON COLUMN public.restaurants.billing_tax_id_value IS
  'Tax ID value as entered by the owner (e.g., "123456789 RT0001" for GST/HST).';
COMMENT ON COLUMN public.restaurants.subscription_cancel_at_period_end IS
  'Mirrors Stripe subscription.cancel_at_period_end. When true, the restaurant stays live until period_end then auto-unpublishes.';
COMMENT ON COLUMN public.restaurants.subscription_paused_at IS
  'When the owner clicked Pause subscription. Restaurant is hidden from Discover but bookings stay valid. Cleared when resume-subscription fires.';
