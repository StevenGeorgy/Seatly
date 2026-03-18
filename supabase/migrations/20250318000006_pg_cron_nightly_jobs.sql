-- Enable pg_cron and pg_net for scheduling nightly Edge Function calls
-- pg_cron runs in UTC; adjust times if your restaurant timezone differs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Config table for cron secret (must match CRON_SECRET in Edge Function env)
-- Run: UPDATE seatly_cron_config SET cron_secret = 'your-secret' WHERE id = 1;
CREATE TABLE IF NOT EXISTS seatly_cron_config (
  id int PRIMARY KEY DEFAULT 1,
  cron_secret text,
  base_url text DEFAULT 'https://exbjodmnpdiayfzrdyux.supabase.co/functions/v1',
  updated_at timestamptz DEFAULT now()
);
INSERT INTO seatly_cron_config (id, cron_secret, base_url)
VALUES (1, NULL, 'https://exbjodmnpdiayfzrdyux.supabase.co/functions/v1')
ON CONFLICT (id) DO NOTHING;

-- Helper: call Edge Function with current cron secret (reads config at runtime)
CREATE OR REPLACE FUNCTION seatly_call_cron_function(func_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cfg record;
  hdr jsonb;
BEGIN
  SELECT base_url, COALESCE(cron_secret, '') AS cron_secret
  INTO cfg FROM seatly_cron_config WHERE id = 1;
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

-- calculate_no_show_risk at 2am daily
SELECT cron.schedule('seatly_calculate_no_show_risk', '0 2 * * *',
  $$SELECT seatly_call_cron_function('calculate-no-show-risk')$$);

-- calculate_lifetime_value at 2am daily
SELECT cron.schedule('seatly_calculate_lifetime_value', '0 2 * * *',
  $$SELECT seatly_call_cron_function('calculate-lifetime-value')$$);

-- run_auto_tagging at 3am daily
SELECT cron.schedule('seatly_run_auto_tagging', '0 3 * * *',
  $$SELECT seatly_call_cron_function('run-auto-tagging')$$);

-- compute_analytics at 4am daily
SELECT cron.schedule('seatly_compute_analytics', '0 4 * * *',
  $$SELECT seatly_call_cron_function('compute-analytics')$$);

-- generate_shift_briefing at 5am daily
SELECT cron.schedule('seatly_generate_shift_briefing', '0 5 * * *',
  $$SELECT seatly_call_cron_function('generate-shift-briefing')$$);

-- send_birthday_messages at 8am daily
SELECT cron.schedule('seatly_send_birthday_messages', '0 8 * * *',
  $$SELECT seatly_call_cron_function('send-birthday-messages')$$);

-- send_anniversary_messages at 8am daily
SELECT cron.schedule('seatly_send_anniversary_messages', '0 8 * * *',
  $$SELECT seatly_call_cron_function('send-anniversary-messages')$$);

-- expire_loyalty_points at midnight on 1st of month
SELECT cron.schedule('seatly_expire_loyalty_points', '0 0 1 * *',
  $$SELECT seatly_call_cron_function('expire-loyalty-points')$$);
