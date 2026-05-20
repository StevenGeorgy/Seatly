-- Daily 5am UTC sweep: anonymize restaurants whose 30-day deletion grace
-- has expired. Anonymizes PII columns but keeps the restaurant row (and all
-- payment-history FKs) intact for CRA 7-year retention.

SELECT cron.schedule(
  'cenaiva_purge_deleted_restaurants',
  '0 5 * * *',
  $$SELECT seatly_call_cron_function('purge-deleted-restaurants')$$
);
