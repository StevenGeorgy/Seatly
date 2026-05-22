-- 2026-05-22 — Daily purge of auth_sign_in_events older than 24 months.
-- TOC_PP Privacy §9 commits: "Sign-in events, audit logs, and security
-- findings: retained for up to 24 months to investigate fraud and security
-- incidents, then deleted or further aggregated."
--
-- Runs daily at 04:30 UTC. Additive (drops existing job of the same name
-- first so re-running this migration is idempotent).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cenaiva_cron_purge_sign_in_events') THEN
    PERFORM cron.unschedule('cenaiva_cron_purge_sign_in_events');
  END IF;
END $$;

SELECT cron.schedule(
  'cenaiva_cron_purge_sign_in_events',
  '30 4 * * *',
  $$ DELETE FROM public.auth_sign_in_events WHERE occurred_at < (NOW() - INTERVAL '24 months'); $$
);
