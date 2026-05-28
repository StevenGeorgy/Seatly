-- 2026-05-28 — settle trigger: skip cancelled / no_show / completed parents
--
-- Pre-existing edge case made more reachable by the new
-- sweep_abandoned_split_tender_reservations cron (migration
-- 20260528200000): a reservation can land in 'cancelled' state while its
-- RDP rows are still 'pending'. If a late-arriving Stripe webhook then
-- flips an RDP to 'charged', the existing trigger would update the
-- parent's deposit_status='charged' even though the parent is cancelled.
--
-- That leaves the row in a self-contradictory state:
--   status = 'cancelled', deposit_status = 'charged'
--
-- This patch adds `AND status NOT IN ('cancelled', 'no_show', 'completed')`
-- to every UPDATE in the trigger. Terminal-state reservations are now
-- ignored — the RDP row's status still flips (factual record of the money
-- on Stripe's side), but the parent doesn't get a misleading status update.
--
-- Money side: if the parent is cancelled but a charge still settles,
-- that money is on the connected account. The diner-facing /find-reservation
-- flow shows 'cancelled' (so they know to ask for a refund) and the owner
-- dashboard surfaces the RDP row separately. Future PR-C-next: have
-- confirm-deposit-paid refund the charge proactively when it detects the
-- parent is no longer active.

CREATE OR REPLACE FUNCTION public.reservation_deposit_settle_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer;
  v_charged integer;
  v_failed integer;
  v_refunded integer;
  v_reservation_id uuid;
BEGIN
  v_reservation_id := COALESCE(NEW.reservation_id, OLD.reservation_id);
  IF v_reservation_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE status = 'charged')::int,
    COUNT(*) FILTER (WHERE status = 'failed')::int,
    COUNT(*) FILTER (WHERE status = 'refunded')::int
  INTO v_total, v_charged, v_failed, v_refunded
  FROM public.reservation_deposit_payments
  WHERE reservation_id = v_reservation_id;

  IF v_total = 0 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_charged = v_total THEN
    UPDATE public.reservations
    SET deposit_status = 'charged',
        status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
        confirmed_at = COALESCE(confirmed_at, now()),
        updated_at = now()
    WHERE id = v_reservation_id
      AND deposit_status <> 'charged'
      AND status NOT IN ('cancelled', 'no_show', 'completed');

    UPDATE public.orders
    SET status = 'paid',
        paid_at = COALESCE(paid_at, now())
    WHERE reservation_id = v_reservation_id
      AND status = 'pending';
  ELSIF v_failed > 0 AND v_failed = v_total THEN
    UPDATE public.reservations
    SET deposit_status = 'failed',
        updated_at = now()
    WHERE id = v_reservation_id
      AND deposit_status <> 'failed'
      AND status NOT IN ('cancelled', 'no_show', 'completed');
  ELSIF v_refunded = v_total THEN
    UPDATE public.reservations
    SET deposit_status = 'none',
        deposit_amount_cents = NULL,
        updated_at = now()
    WHERE id = v_reservation_id
      AND deposit_status <> 'none'
      AND status NOT IN ('cancelled', 'no_show', 'completed');
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;
