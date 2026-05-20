-- Add 3 new owner notification types for the subscription-lifecycle events
-- introduced by the in-app billing self-service feature pack:
-- subscription_cancelled, subscription_paused, subscription_resumed.

ALTER TABLE public.restaurant_notification_log
  DROP CONSTRAINT IF EXISTS restaurant_notification_log_notification_type_check;

ALTER TABLE public.restaurant_notification_log
  ADD CONSTRAINT restaurant_notification_log_notification_type_check
  CHECK (notification_type IN (
    'restaurant_live',
    'restaurant_deletion_scheduled',
    'restaurant_restored',
    'payment_failed',
    'payment_recovered',
    'trial_ending_soon',
    'payment_received',
    'subscription_cancelled',
    'subscription_paused',
    'subscription_resumed'
  ));
