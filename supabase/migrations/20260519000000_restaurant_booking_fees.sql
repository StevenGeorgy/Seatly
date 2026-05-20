-- $1-per-confirmed-booking platform fee.
--
-- Policy (2026-05-19): every confirmed reservation incurs a $1 CAD fee
-- billed to the restaurant. Cenaiva accumulates these as Stripe
-- invoice_items on the restaurant's subscription customer, which then
-- shows up on the next monthly subscription invoice. No diner-facing
-- charge.
--
-- This migration creates:
--   - `restaurant_booking_fees` — one row per reservation; the source of
--     truth for "did we already bill the $1 for this booking?"
--   - Trigger seeds a 'pending' row when a reservation enters 'confirmed'
--     (either created as confirmed, or transitioned from pending).
--   - Trigger flips 'pending' → 'cancelled' if the reservation cancels
--     before the cron sweep bills it. 'billed' rows are left alone — once
--     invoiced, we don't auto-credit (operator can refund manually if
--     needed).
--   - RLS: owners can read their own fee rows; only service-role writes.
--
-- The `bill-booking-fees` edge function (deployed separately) sweeps
-- pending rows on a schedule, creates Stripe invoice_items against each
-- restaurant's subscription customer, and flips status to 'billed'.

CREATE TABLE IF NOT EXISTS restaurant_booking_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  amount_cents int NOT NULL DEFAULT 100,
  currency text NOT NULL DEFAULT 'cad',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'billed', 'failed', 'cancelled')),
  stripe_invoice_item_id text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  billed_at timestamptz,
  cancelled_at timestamptz,
  -- One fee row per reservation. ON CONFLICT (reservation_id) DO NOTHING
  -- is the idempotency guarantee for the trigger.
  CONSTRAINT restaurant_booking_fees_reservation_unique UNIQUE (reservation_id)
);

-- The bill-booking-fees sweeper queries pending rows grouped by
-- restaurant. Index supports the typical "find all pending fees for
-- restaurants with active subscriptions" scan.
CREATE INDEX IF NOT EXISTS restaurant_booking_fees_pending_idx
  ON restaurant_booking_fees (restaurant_id, created_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION seed_booking_fee_on_confirm()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only seed for confirmed rows. Pending/cancelled/no_show don't bill.
  IF NEW.status = 'confirmed' THEN
    INSERT INTO restaurant_booking_fees (restaurant_id, reservation_id, status)
    VALUES (NEW.restaurant_id, NEW.id, 'pending')
    ON CONFLICT (reservation_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS reservations_seed_booking_fee_ins ON reservations;
CREATE TRIGGER reservations_seed_booking_fee_ins
  AFTER INSERT ON reservations
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed')
  EXECUTE FUNCTION seed_booking_fee_on_confirm();

DROP TRIGGER IF EXISTS reservations_seed_booking_fee_upd ON reservations;
CREATE TRIGGER reservations_seed_booking_fee_upd
  AFTER UPDATE OF status ON reservations
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed')
  EXECUTE FUNCTION seed_booking_fee_on_confirm();

CREATE OR REPLACE FUNCTION cancel_booking_fee_on_cancel()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only act when status flips to cancelled and we have a pending row.
  -- Already-billed rows are left as-is; if you need a credit, do it
  -- manually via Stripe Dashboard or extend bill-booking-fees with a
  -- credit pass.
  IF NEW.status IN ('cancelled', 'no_show') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE restaurant_booking_fees
      SET status = 'cancelled',
          cancelled_at = now()
      WHERE reservation_id = NEW.id
        AND status = 'pending';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS reservations_cancel_booking_fee ON reservations;
CREATE TRIGGER reservations_cancel_booking_fee
  AFTER UPDATE OF status ON reservations
  FOR EACH ROW
  EXECUTE FUNCTION cancel_booking_fee_on_cancel();

ALTER TABLE restaurant_booking_fees ENABLE ROW LEVEL SECURITY;

-- Owners can see their fee history for transparency in the dashboard.
DROP POLICY IF EXISTS booking_fees_owner_select ON restaurant_booking_fees;
CREATE POLICY booking_fees_owner_select ON restaurant_booking_fees
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM user_restaurant_roles urr
      JOIN user_profiles up ON up.id = urr.user_id
      WHERE up.auth_user_id = auth.uid()
        AND urr.restaurant_id = restaurant_booking_fees.restaurant_id
        AND urr.role = 'owner'
    )
  );

-- No INSERT/UPDATE/DELETE policy for authenticated — writes are service
-- role only (the trigger + the bill-booking-fees edge fn).

COMMENT ON TABLE restaurant_booking_fees IS
  '$1-per-confirmed-booking platform fee tracking. One row per reservation. The bill-booking-fees edge fn sweeps pending rows into Stripe invoice_items on the restaurant subscription.';
