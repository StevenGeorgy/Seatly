-- Phase 3.5 — Restaurant lifecycle (soft-delete with 30-day grace, payment-
-- failure pause reason tracking). Extends publish-gate to block re-publishing
-- a soft-deleted restaurant.

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS scheduled_purge_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS paused_reason TEXT NULL
    CHECK (paused_reason IS NULL OR paused_reason IN
      ('owner_unpublished', 'payment_failed', 'pending_deletion'));

COMMENT ON COLUMN public.restaurants.deleted_at IS
  'Soft-delete marker. Set by delete-restaurant edge fn. Cleared by recover-restaurant within 30 days; otherwise the purge-deleted-restaurants cron anonymizes PII at day 30.';
COMMENT ON COLUMN public.restaurants.scheduled_purge_at IS
  'When hard-purge (anonymization) runs (= deleted_at + 30 days). Indexed for the daily cron.';
COMMENT ON COLUMN public.restaurants.paused_reason IS
  'Why is_published=false. Drives the dashboard banner shown to the owner.';

CREATE INDEX IF NOT EXISTS restaurants_pending_purge_idx
  ON public.restaurants (scheduled_purge_at)
  WHERE deleted_at IS NOT NULL AND scheduled_purge_at IS NOT NULL;

-- Re-define the publish-gate function to also reject publishing a deleted
-- restaurant. CREATE OR REPLACE keeps the trigger binding intact.
CREATE OR REPLACE FUNCTION public.restaurants_publish_gate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'publish_gate_restaurant_deleted';
  END IF;
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
