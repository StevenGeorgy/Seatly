-- Schedule reservation reminders via pg_cron.
--
-- Runs every 5 minutes. The send-booking-reminder edge function picks up
-- reservations starting in ~24h or ~2h that haven't been reminded yet, sends
-- SMS via Twilio (with email fallback via Resend), and flips
-- reservations.reminder_sent_24h / reminder_sent_2h on success.
--
-- Each kind has a 10-minute window, giving the cron 2 chances per reservation
-- before the window passes; failed sends never block forever and the job stops
-- being a candidate once the booking time elapses.

SELECT cron.schedule(
  'cenaiva_send_booking_reminders',
  '*/5 * * * *',
  $$SELECT cenaiva_call_cron_function('send-booking-reminder')$$
);
