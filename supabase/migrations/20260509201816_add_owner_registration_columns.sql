-- Owner-registration flow needs to track who owns a restaurant, what
-- their Stripe subscription / payment method are, and when their trial
-- ends. The base `restaurants` table (shared with the web app) doesn't
-- have these fields, so add them as nullable so existing rows aren't
-- affected and the web app continues to ignore them.

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_method_id text,
  ADD COLUMN IF NOT EXISTS billing_card_brand text,
  ADD COLUMN IF NOT EXISTS billing_card_last4 text,
  ADD COLUMN IF NOT EXISTS billing_card_exp_month int,
  ADD COLUMN IF NOT EXISTS billing_card_exp_year int,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

CREATE INDEX IF NOT EXISTS restaurants_owner_user_id_idx
  ON public.restaurants(owner_user_id);
