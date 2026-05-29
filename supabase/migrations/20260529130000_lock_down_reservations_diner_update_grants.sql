-- 2026-05-29 security #4: stop diners/anon from directly writing trust-boundary
-- reservation columns.
--
-- Live audit found `reservations` granted table-wide UPDATE to anon AND
-- authenticated, plus explicit per-column UPDATE on every sensitive column.
-- Combined with the customer UPDATE RLS policies (reservations_update_customer
-- / reservations_update_own, roles = public), a logged-in diner could
-- `update({ status: 'confirmed', deposit_amount_cents: 0, deposit_status:
-- 'none', confirmed_at: now() })` on their own pending_payment reservation —
-- self-confirming a deposit booking and holding the table WITHOUT paying, and
-- could forge no_show_fee_charged / timestamps or bypass modify_reservation_slot
-- via reserved_at / party_size.
--
-- All legitimate status/money/slot transitions flow through SECURITY DEFINER
-- RPCs (book_reservation, modify_reservation_slot, update_staff_reservation_status,
-- seat_staff_reservation) and service-role edge fns (create-public-booking,
-- cancel-reservation, confirm-deposit-paid) + the deposit settle trigger — none
-- of which are affected by role-level column grants. The ONLY legitimate direct
-- client writes (verified by grepping apps/web/src) are STAFF updates of
-- shift_id / table_id / duration_minutes (FloorPlanPage, useReservations).
--
-- Note on Postgres semantics: a table-wide UPDATE grant covers all columns, so
-- a per-column REVOKE alone does nothing while it stands. We therefore revoke
-- the table-wide UPDATE *and* the explicit sensitive-column grants, then
-- re-grant only the 3 operational columns to authenticated. Mirrors the
-- restaurants trust-boundary column lockdown.

BEGIN;

-- Remove the table-wide UPDATE (covers all columns) from diner-facing roles.
REVOKE UPDATE ON public.reservations FROM anon, authenticated;

-- Remove the explicit per-column UPDATE grants on the sensitive columns
-- (these survive a table-level revoke and would otherwise still allow writes).
REVOKE UPDATE (
  status,
  deposit_status,
  deposit_amount_cents,
  deposit_stripe_payment_intent_id,
  confirmed_at,
  no_show_fee_charged,
  cancelled_at,
  seated_at,
  completed_at,
  no_show_at,
  reserved_at,
  party_size
) ON public.reservations FROM anon, authenticated;

-- Re-grant ONLY the operational columns that staff legitimately update directly
-- from the dashboard. Status/slot/money transitions still flow through the
-- SECURITY DEFINER RPCs + service-role edge fns above. anon gets no direct
-- UPDATE (anon bookings go through service-role edge fns).
GRANT UPDATE (shift_id, table_id, duration_minutes) ON public.reservations TO authenticated;

-- Drop the redundant customer UPDATE policy that had NO WITH CHECK. The
-- WITH-CHECK'd reservations_update_customer remains; combined with the column
-- grant above, a diner can now only touch shift_id/table_id/duration_minutes on
-- their own row (no money/status columns).
DROP POLICY IF EXISTS reservations_update_own ON public.reservations;

COMMIT;
