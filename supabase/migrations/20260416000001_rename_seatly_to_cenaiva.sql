-- Rename all seatly_* DB objects to cenaiva_* following the Seatly → Cenaiva rebrand.
-- The original migration (20250318000006) is already applied to prod; this migration
-- renames the config table, drops/recreates the helper function, and reschedules cron jobs.

-- 1. Unschedule all existing seatly_* cron jobs
DO $$
BEGIN
  PERFORM cron.unschedule(jobname)
  FROM cron.job
  WHERE jobname LIKE 'seatly_%';
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 2. Rename config table
ALTER TABLE IF EXISTS seatly_cron_config RENAME TO cenaiva_cron_config;

-- 3. Drop old helper function
DROP FUNCTION IF EXISTS seatly_call_cron_function(text);

-- 4. Recreate helper function reading from renamed table
CREATE OR REPLACE FUNCTION cenaiva_call_cron_function(func_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cfg record;
  hdr jsonb;
BEGIN
  SELECT base_url, COALESCE(cron_secret, '') AS cron_secret
  INTO cfg FROM cenaiva_cron_config WHERE id = 1;
  hdr := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-cron-secret', cfg.cron_secret
  );
  RETURN net.http_post(
    url := cfg.base_url || '/' || func_path,
    headers := hdr,
    body := '{}'::jsonb
  );
END;
$$;

-- 5. Reschedule with cenaiva_* job names
-- calculate_no_show_risk at 2am daily
SELECT cron.schedule('cenaiva_calculate_no_show_risk', '0 2 * * *',
  $$SELECT cenaiva_call_cron_function('calculate-no-show-risk')$$);

-- calculate_lifetime_value at 2am daily
SELECT cron.schedule('cenaiva_calculate_lifetime_value', '0 2 * * *',
  $$SELECT cenaiva_call_cron_function('calculate-lifetime-value')$$);

-- run_auto_tagging at 3am daily
SELECT cron.schedule('cenaiva_run_auto_tagging', '0 3 * * *',
  $$SELECT cenaiva_call_cron_function('run-auto-tagging')$$);

-- compute_analytics at 4am daily
SELECT cron.schedule('cenaiva_compute_analytics', '0 4 * * *',
  $$SELECT cenaiva_call_cron_function('compute-analytics')$$);

-- generate_shift_briefing at 5am daily
SELECT cron.schedule('cenaiva_generate_shift_briefing', '0 5 * * *',
  $$SELECT cenaiva_call_cron_function('generate-shift-briefing')$$);

-- send_birthday_messages at 8am daily
SELECT cron.schedule('cenaiva_send_birthday_messages', '0 8 * * *',
  $$SELECT cenaiva_call_cron_function('send-birthday-messages')$$);

-- send_anniversary_messages at 8am daily
SELECT cron.schedule('cenaiva_send_anniversary_messages', '0 8 * * *',
  $$SELECT cenaiva_call_cron_function('send-anniversary-messages')$$);

-- expire_loyalty_points at midnight on 1st of month
SELECT cron.schedule('cenaiva_expire_loyalty_points', '0 0 1 * *',
  $$SELECT cenaiva_call_cron_function('expire-loyalty-points')$$);

-- 6. Update any @seatly.test email addresses in user_profiles (seed data cleanup)
UPDATE user_profiles
SET email = REPLACE(email, '@seatly.test', '@cenaiva.test')
WHERE email LIKE '%@seatly.test';
