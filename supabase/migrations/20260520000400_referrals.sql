-- Phase 3.6 — Referral program. Each published restaurant gets a unique
-- referral_code; new restaurants enter the code at signup; both sides get a
-- $199.99 credit (one free month) when the new restaurant publishes.

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by_restaurant_id UUID
    REFERENCES public.restaurants(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.restaurants.referral_code IS
  'Unique short code (e.g., MARK7X9) auto-generated when the restaurant first publishes. Other restaurants enter this at signup to give both sides +1 month free.';
COMMENT ON COLUMN public.restaurants.referred_by_restaurant_id IS
  'Set at signup if the new owner entered a referral code. Immutable after first set. Used by apply-referral-credit to identify the beneficiary on publish.';

CREATE INDEX IF NOT EXISTS restaurants_referral_code_idx
  ON public.restaurants (referral_code) WHERE referral_code IS NOT NULL;

-- Audit trail for every referral credit applied.
CREATE TABLE IF NOT EXISTS public.referral_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiary_restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  referrer_restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  triggered_by_restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  amount_cents int NOT NULL DEFAULT 19999,
  currency text NOT NULL DEFAULT 'cad',
  stripe_coupon_id text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','applied','failed')),
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);

CREATE INDEX IF NOT EXISTS referral_credits_beneficiary_idx
  ON public.referral_credits (beneficiary_restaurant_id, status);
CREATE INDEX IF NOT EXISTS referral_credits_triggered_by_idx
  ON public.referral_credits (triggered_by_restaurant_id);

ALTER TABLE public.referral_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS referral_credits_owner_select ON public.referral_credits;
CREATE POLICY referral_credits_owner_select ON public.referral_credits
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurant_roles urr
      JOIN public.user_profiles up ON up.id = urr.user_id
      WHERE up.auth_user_id = auth.uid()
        AND urr.role = 'owner'
        AND urr.restaurant_id IN
          (referral_credits.beneficiary_restaurant_id, referral_credits.referrer_restaurant_id)
    )
  );
