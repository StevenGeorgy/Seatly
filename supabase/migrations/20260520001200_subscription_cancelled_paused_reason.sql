-- Extend paused_reason enum with 'subscription_cancelled' — set by the
-- stripe-webhook handler when customer.subscription.deleted fires (after
-- the cancel_at_period_end window expires). Used by the dashboard to
-- distinguish "owner cancelled their plan" from "payment failed" or
-- "owner just unpublished without cancelling".

ALTER TABLE public.restaurants
  DROP CONSTRAINT IF EXISTS restaurants_paused_reason_check;

ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_paused_reason_check
  CHECK (paused_reason IS NULL OR paused_reason IN (
    'owner_unpublished',
    'payment_failed',
    'pending_deletion',
    'subscription_cancelled'
  ));
