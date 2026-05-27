-- Cart-delta replay snapshot column.
-- Stamped by modify-reservation cart branch when delta > 0; cleared by
-- confirm-modify-payment after replay. NULL for non-cart deposit rows.

ALTER TABLE public.reservation_deposit_payments
  ADD COLUMN IF NOT EXISTS pending_cart_snapshot jsonb NULL;

COMMENT ON COLUMN public.reservation_deposit_payments.pending_cart_snapshot IS
  'Cart-delta replay snapshot (items + food_cents + tax_cents + discount_cents + applied_promo_code + special_request). Stamped by modify-reservation cart branch when delta>0; cleared by confirm-modify-payment after replay. NULL for non-cart deposit rows.';
