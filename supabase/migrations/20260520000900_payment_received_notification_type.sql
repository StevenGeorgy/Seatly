-- Extend restaurant_notification_log.notification_type CHECK enum to include
-- 'payment_received' — fired when Stripe successfully charges the owner's
-- monthly subscription invoice (subscription + accumulated booking fees).
-- Triggered by the invoice.payment_succeeded webhook handler in
-- supabase/functions/stripe-webhook/index.ts.

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
    'payment_received'
  ));
