-- Phase 1 of the 2026-05-20 lifecycle rework.
-- Adds payment_method_attached_at column (card-on-file flag for pre-publish
-- restaurants) + subscription_consent_log (Canadian PIPEDA/CPA audit trail)
-- + the restaurants_publish_gate trigger (CLAUDE.md aspirational; now real).

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS payment_method_attached_at TIMESTAMPTZ NULL;
COMMENT ON COLUMN public.restaurants.payment_method_attached_at IS
  'Set when the owner attached a card during onboarding (before publish). Cleared by cleanup-stale-onboarding-cards 90 days later if still unpublished, or by publish-restaurant on successful publish. After publish, billing state is expressed by subscription_status.';

CREATE INDEX IF NOT EXISTS restaurants_pm_stale_unpublished_idx
  ON public.restaurants (payment_method_attached_at)
  WHERE is_published = false AND payment_method_attached_at IS NOT NULL;

-- Canadian consent audit log. Every card-save and publish-confirm writes a
-- row capturing the exact disclosure text shown to the owner at the moment
-- of consent. Defensible record for PIPEDA / Consumer Protection Act / Bill 64.
CREATE TABLE IF NOT EXISTS public.subscription_consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_profile_id uuid REFERENCES public.user_profiles(id),
  consent_type text NOT NULL CHECK (consent_type IN ('card_save', 'publish_trial_start')),
  disclosure_text text NOT NULL,
  amount_cents int NOT NULL DEFAULT 19999,
  currency text NOT NULL DEFAULT 'cad',
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_consent_log_restaurant_idx
  ON public.subscription_consent_log (restaurant_id, created_at DESC);

ALTER TABLE public.subscription_consent_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consent_log_owner_select ON public.subscription_consent_log;
CREATE POLICY consent_log_owner_select ON public.subscription_consent_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurant_roles urr
      JOIN public.user_profiles up ON up.id = urr.user_id
      WHERE up.auth_user_id = auth.uid()
        AND urr.restaurant_id = subscription_consent_log.restaurant_id
        AND urr.role = 'owner'
    )
  );

-- Publish-gate trigger. Fires only on the false → true transition so existing
-- published restaurants (Mark Testing, seed data, etc.) are not retroactively
-- disturbed. Accepts both old-world (subscription_status in trialing/active —
-- grandfathered restaurants) and new-world (payment_method_attached_at IS NOT
-- NULL — wizard-card-saved restaurants) so the rollout doesn't break either
-- flow.
CREATE OR REPLACE FUNCTION public.restaurants_publish_gate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stripe_charges_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'publish_gate_kyc_not_verified';
  END IF;
  IF NEW.cover_photo_url IS NULL OR NEW.cover_photo_url = '' THEN
    RAISE EXCEPTION 'publish_gate_no_cover_photo';
  END IF;
  IF NEW.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'publish_gate_not_active';
  END IF;
  IF NOT (
    NEW.subscription_status IN ('trialing','active')
    OR NEW.payment_method_attached_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'publish_gate_no_payment_method';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS restaurants_publish_gate_trg ON public.restaurants;
CREATE TRIGGER restaurants_publish_gate_trg
  BEFORE UPDATE OF is_published ON public.restaurants
  FOR EACH ROW
  WHEN (NEW.is_published = true AND OLD.is_published = false)
  EXECUTE FUNCTION public.restaurants_publish_gate();
