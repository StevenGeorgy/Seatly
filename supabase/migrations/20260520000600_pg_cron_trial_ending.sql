-- Daily 9am UTC sweep: email owners whose trial ends within 7 days.
-- Idempotent per restaurant (helper checks restaurant_notification_log before
-- sending so we don't spam them daily for the same trial end).

SELECT cron.schedule(
  'cenaiva_notify_trial_ending',
  '0 9 * * *',
  $$SELECT seatly_call_cron_function('notify-trial-ending')$$
);
