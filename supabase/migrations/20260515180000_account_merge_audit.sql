-- Phase 5 of diner auth overhaul (2026-05-15): audit log for diner-account
-- merges. When a diner signs in via Apple (after previously signing in via
-- Google) and we detect the same email/phone on a different auth.users row,
-- we offer to merge. The merge is irreversible (hard-deletes the duplicate
-- auth.users + user_profiles). This table is the forensic record so support
-- can investigate "I lost a booking" reports later.

CREATE TABLE IF NOT EXISTS public.account_merge_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Canonical (kept) account
  canonical_auth_user_id uuid NOT NULL,
  canonical_profile_id uuid NOT NULL,

  -- Duplicate (deleted) account
  archived_auth_user_id uuid NOT NULL,
  archived_profile_id uuid NOT NULL,

  -- What matched
  triggered_by_email text,
  triggered_by_phone text,

  -- Rough movement counts for forensics
  merged_count_reservations integer DEFAULT 0,
  merged_count_saved_cards integer DEFAULT 0,
  merged_count_guests integer DEFAULT 0,
  merged_count_deposits integer DEFAULT 0,
  merged_count_reviews integer DEFAULT 0,
  merged_count_alerts integer DEFAULT 0,
  merged_count_notifications integer DEFAULT 0,

  merged_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_merge_audit_canonical
  ON public.account_merge_audit (canonical_auth_user_id);
CREATE INDEX IF NOT EXISTS idx_account_merge_audit_archived
  ON public.account_merge_audit (archived_auth_user_id);

ALTER TABLE public.account_merge_audit ENABLE ROW LEVEL SECURITY;

-- Service-role-only writes. No SELECT policy = no diner-facing reads. Only
-- support / admin queries (which use service_role) can inspect.
