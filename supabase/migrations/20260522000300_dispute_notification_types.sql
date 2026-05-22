-- Block 3: extend restaurant_notification_log.notification_type to include
-- charge_dispute_created + charge_dispute_closed. Also closes existing drift —
-- the constraint was missing new_reservation_owner, cancellation_owner,
-- payment_failed_diner which are already used by owner-notifications.ts.

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
    'subscription_resumed',
    'new_reservation_owner',
    'cancellation_owner',
    'payment_failed_diner',
    'charge_dispute_created',
    'charge_dispute_closed'
  ));
