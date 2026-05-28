-- 2026-05-27 — settle trigger: handle "all refunded" case
--
-- The settle trigger flips reservations.deposit_status to 'charged' once
-- every deposit row is charged, and to 'failed' if all rows fail. It had
-- no branch for "all rows refunded" — so a modify-down that drops a
-- diner below the deposit threshold left the parent reservation showing
-- deposit_status='charged' even though every deposit row had been
-- refunded (UI is now misleading).
--
-- Fix: add a third branch. When all rows are refunded AND there's at
-- least one row, flip deposit_status back to 'none' and clear
-- deposit_amount_cents. The deposit rows themselves stay (audit trail),
-- so the diner / restaurant can still see "this reservation HAD a
-- deposit that was refunded."

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
      AND deposit_status <> 'charged';

    -- 2026-05-23: mark linked pre-orders as paid when split-tender finishes.
    -- For single-pay flows orders are flipped by mark-order-paid; for
    -- split-tender there's no single PI to verify, so the trigger handles it
    -- once all N rows settle. Idempotent via status<>'paid' guard.
    -- NOTE: orders table has `paid_at` (NOT `updated_at`).
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
      AND deposit_status <> 'failed';
  ELSIF v_refunded = v_total THEN
    -- 2026-05-27: all deposit rows refunded. Treat as "no deposit on file."
    -- Deposit rows stay (audit trail); the reservation's headline state
    -- reflects the fact that no money is currently held. Most common
    -- trigger: modify-down dropping below the deposit threshold.
    UPDATE public.reservations
    SET deposit_status = 'none',
        deposit_amount_cents = NULL,
        updated_at = now()
    WHERE id = v_reservation_id
      AND deposit_status <> 'none';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;
