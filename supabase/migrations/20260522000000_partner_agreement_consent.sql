-- 2026-05-22 — Extend subscription_consent_log to cover Partner Agreement
-- acceptance at publish time. Adds 'partner_agreement' to the consent_type
-- CHECK enum and an optional agreement_version column to capture which
-- version (e.g. '2.1') the owner accepted.
--
-- Driven by the new checkbox in Step8PaymentSetup.tsx + publish-restaurant
-- edge fn refusal path. Additive only.

ALTER TABLE public.subscription_consent_log
  DROP CONSTRAINT IF EXISTS subscription_consent_log_consent_type_check;

ALTER TABLE public.subscription_consent_log
  ADD CONSTRAINT subscription_consent_log_consent_type_check
  CHECK (consent_type IN ('card_save', 'publish_trial_start', 'partner_agreement'));

ALTER TABLE public.subscription_consent_log
  ADD COLUMN IF NOT EXISTS agreement_version text;

COMMENT ON COLUMN public.subscription_consent_log.agreement_version IS
  'For consent_type = ''partner_agreement'', captures the Restaurant Partner Agreement version accepted (e.g. ''2.1''). NULL for other consent types.';
