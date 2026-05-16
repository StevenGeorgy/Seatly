-- Schedule the expire-reservation-holds edge function to run every 5 minutes.
-- The edge function calls the expire_reservation_holds RPC which flips active
-- holds past their expiry (with a 2-minute grace) to 'expired' status, freeing
-- the slot for other diners. Also drops terminal-state hold rows older than 7
-- days for housekeeping.

SELECT cron.schedule(
  'cenaiva_expire_reservation_holds',
  '*/5 * * * *',
  $$SELECT seatly_call_cron_function('expire-reservation-holds')$$
);
