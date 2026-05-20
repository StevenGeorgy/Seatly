-- Daily 4am UTC sweep: detach cards from restaurants that saved a card but
-- never published within 90 days.

SELECT cron.schedule(
  'cenaiva_cleanup_stale_onboarding_cards',
  '0 4 * * *',
  $$SELECT seatly_call_cron_function('cleanup-stale-onboarding-cards')$$
);
