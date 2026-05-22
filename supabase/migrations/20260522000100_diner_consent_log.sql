-- 2026-05-22 — diner_consent_log: verifiable record of every diner's
-- acceptance of the Terms of Service and Privacy Policy at signup. Mirrors
-- the subscription_consent_log shape but for diner-side consent (PIPEDA /
-- Quebec Law 25 / CASL). Two rows per signup: one terms, one privacy.

CREATE TABLE IF NOT EXISTS public.diner_consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_profile_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
  consent_type text NOT NULL CHECK (consent_type IN ('terms_of_service', 'privacy_policy')),
  agreement_version text NOT NULL,
  disclosure_text text NOT NULL,
  source text,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.diner_consent_log IS
  'Per-user audit trail of Terms / Privacy acceptance at signup. ON DELETE RESTRICT against user_profiles so the audit survives account deletion (CRA-style retention).';
COMMENT ON COLUMN public.diner_consent_log.source IS
  'Where the consent was captured. Examples: ''register_email'', ''register_google'', ''register_apple'', ''register_phone''.';

CREATE INDEX IF NOT EXISTS diner_consent_log_user_idx
  ON public.diner_consent_log (user_profile_id, created_at DESC);

ALTER TABLE public.diner_consent_log ENABLE ROW LEVEL SECURITY;

-- Users can read their own consent log entries (so a "see my data" surface
-- could show them). Writes are service-role only.
DROP POLICY IF EXISTS diner_consent_log_owner_select ON public.diner_consent_log;
CREATE POLICY diner_consent_log_owner_select ON public.diner_consent_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.id = diner_consent_log.user_profile_id
        AND up.auth_user_id = auth.uid()
    )
  );
