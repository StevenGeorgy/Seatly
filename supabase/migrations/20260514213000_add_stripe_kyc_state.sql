-- Phase D (Stripe wire-up): persist Stripe Connect KYC state flags on the
-- restaurants row. These three booleans are mirrored from Stripe via the
-- `account.updated` webhook in supabase/functions/stripe-webhook/index.ts.
--
-- The publish gate (Step 8 of the onboarding wizard) reads these to decide
-- whether the "Publish my restaurant" button is enabled:
--   stripe_charges_enabled   = can the connected account accept charges?
--   stripe_payouts_enabled   = can it receive payouts to the linked bank?
--   stripe_details_submitted = did the owner finish the embedded onboarding?
--
-- All three default false so existing grandfathered rows (set in
-- 20260514000000_add_publish_gate_and_stripe_columns.sql) read as KYC-incomplete
-- — that's fine because those rows already have `is_published = true` from the
-- grandfather UPDATE and we never re-gate them. New restaurants from the
-- wizard only get is_published=true after BOTH KYC + subscription are set up
-- in Step 8, by which point the webhook has set these to true.

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS stripe_details_submitted BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.restaurants.stripe_charges_enabled IS
  'Mirrored from Stripe via account.updated webhook. True when the connected account can accept charges.';

COMMENT ON COLUMN public.restaurants.stripe_payouts_enabled IS
  'Mirrored from Stripe via account.updated webhook. True when the connected account can receive payouts.';

COMMENT ON COLUMN public.restaurants.stripe_details_submitted IS
  'Mirrored from Stripe via account.updated webhook. True when the embedded Connect onboarding flow has been completed.';
