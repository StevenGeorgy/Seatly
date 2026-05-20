-- Add idempotency + provenance columns to the expenses table so the Stripe
-- webhook handler can auto-populate Cenaiva subscription + booking-fee
-- entries when invoice.payment_succeeded fires.
--
-- A single Stripe invoice creates TWO expense rows (subscription line +
-- booking-fee summary), so we cannot use a simple UNIQUE on external_ref.
-- The webhook handler does a SELECT pre-check on (restaurant_id,
-- external_ref) before insert — if any rows exist for that invoice id,
-- it's been processed and we skip.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS external_ref text NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

COMMENT ON COLUMN public.expenses.external_ref IS
  'External system reference (e.g. Stripe invoice id) for auto-imported '
  'rows. Used by the webhook handler to dedupe replays.';

COMMENT ON COLUMN public.expenses.source IS
  'Provenance: "manual" (owner entry, default), "auto:cenaiva" (Cenaiva '
  'subscription/booking-fee charges from invoice.payment_succeeded webhook).';

-- Index to speed up the idempotency pre-check.
CREATE INDEX IF NOT EXISTS expenses_external_ref_idx
  ON public.expenses (restaurant_id, external_ref)
  WHERE external_ref IS NOT NULL;
