-- Extend the reservation_deposit_payments.status enum to include 'cancelled'.
-- Used by cancel-reservation to close out 'pending' split-payer rows when
-- the reservation is cancelled before the co-payer ever paid. Distinct from
-- 'failed' (which means the charge was attempted and declined) and from
-- 'refunded' (which implies money moved).

ALTER TABLE public.reservation_deposit_payments
  DROP CONSTRAINT IF EXISTS reservation_deposit_payments_status_check;

ALTER TABLE public.reservation_deposit_payments
  ADD CONSTRAINT reservation_deposit_payments_status_check
  CHECK (status = ANY (ARRAY['pending','charged','failed','refunded','cancelled']::text[]));
