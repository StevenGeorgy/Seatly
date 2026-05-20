-- Fix split-deposit reservations being marked 'confirmed' before all
-- co-payers have actually paid.
--
-- Background:
--   convert_reservation_hold_to_reservation (20260516000200) inserted the
--   reservation with status='confirmed' unconditionally. For single-payer
--   bookings this is fine — the same function also inserts the
--   reservation_deposit_payments row as 'charged'. For split-deposit
--   bookings, additional payer rows get inserted by the caller flow with
--   status='pending', but the reservation is already 'confirmed' by then,
--   contradicting the UI promise that "the reservation isn't confirmed
--   until everyone has paid."
--
-- Fix:
--   When the hold carries a deposit, insert the reservation as 'pending'
--   (with confirmed_at NULL). The existing reservation_deposit_settle
--   trigger already handles upgrading status='pending' → 'confirmed' once
--   every reservation_deposit_payments row reaches status='charged'.
--   No-deposit bookings continue to insert as 'confirmed' immediately —
--   without a deposit row the settle trigger would never fire.

CREATE OR REPLACE FUNCTION public.convert_reservation_hold_to_reservation(
  p_hold_id            uuid,
  p_payment_intent_id  text DEFAULT NULL,
  p_grace_seconds      integer DEFAULT 120
)
RETURNS TABLE (
  reservation_id    uuid,
  confirmation_code text,
  table_ids         uuid[],
  duration_minutes  integer,
  idempotent        boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold reservation_holds%ROWTYPE;
  v_new_res_id uuid;
  v_table_id uuid;
  v_index integer := 1;
  v_has_deposit boolean;
  v_initial_status text;
BEGIN
  -- Row lock — serializes against the cleanup job AND the other call path
  -- (webhook racing browser-confirm).
  SELECT * INTO v_hold FROM public.reservation_holds WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hold_not_found' USING ERRCODE = 'P0010';
  END IF;

  -- Idempotency — second caller returns the existing reservation.
  IF v_hold.status = 'converted' AND v_hold.converted_reservation_id IS NOT NULL THEN
    reservation_id    := v_hold.converted_reservation_id;
    confirmation_code := v_hold.confirmation_code;
    table_ids         := v_hold.table_ids;
    duration_minutes  := v_hold.duration_minutes;
    idempotent        := true;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Refuse if past expiry + grace.
  IF v_hold.expires_at < now() - make_interval(secs => p_grace_seconds) THEN
    RAISE EXCEPTION 'hold_expired' USING ERRCODE = 'P0011';
  END IF;

  IF v_hold.status NOT IN ('active', 'converting') THEN
    RAISE EXCEPTION 'hold_not_convertible' USING ERRCODE = 'P0012';
  END IF;

  -- Require diner identity by conversion time.
  IF v_hold.guest_email IS NULL AND v_hold.user_profile_id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023', DETAIL = 'hold missing diner identity';
  END IF;

  UPDATE public.reservation_holds SET status = 'converting' WHERE id = p_hold_id;

  -- Reservation starts 'pending' when there's a deposit so the settle
  -- trigger is responsible for the upgrade once every co-payer has been
  -- charged. No-deposit reservations skip the trigger and confirm
  -- immediately.
  v_has_deposit := COALESCE(v_hold.deposit_amount_cents, 0) > 0;
  v_initial_status := CASE WHEN v_has_deposit THEN 'pending' ELSE 'confirmed' END;

  BEGIN
    INSERT INTO public.reservations (
      restaurant_id, guest_id, user_profile_id, shift_id, party_size, reserved_at,
      duration_minutes, status, source, confirmation_code,
      special_request, dietary_notes, occasion,
      is_guest_checkout, guest_full_name, guest_email, guest_phone,
      deposit_amount_cents,
      deposit_status,
      deposit_stripe_payment_intent_id,
      confirmed_at,
      event_id, promotion_id, applied_promo_code
    ) VALUES (
      v_hold.restaurant_id, v_hold.guest_id, v_hold.user_profile_id, v_hold.shift_id,
      v_hold.party_size, v_hold.reserved_at, v_hold.duration_minutes,
      v_initial_status, v_hold.source, v_hold.confirmation_code,
      v_hold.special_request, v_hold.dietary_notes, v_hold.occasion,
      v_hold.user_profile_id IS NULL,
      v_hold.guest_full_name, v_hold.guest_email, v_hold.guest_phone,
      CASE WHEN v_has_deposit THEN v_hold.deposit_amount_cents ELSE NULL END,
      CASE WHEN v_has_deposit THEN 'pending' ELSE 'none' END,
      p_payment_intent_id,
      CASE WHEN v_has_deposit THEN NULL ELSE now() END,
      v_hold.event_id, v_hold.promotion_id, v_hold.applied_promo_code
    )
    RETURNING id INTO v_new_res_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      -- Lost the race against another diner with the same identity making
      -- an overlapping booking. Revert hold and bubble up.
      UPDATE public.reservation_holds SET status = 'active' WHERE id = p_hold_id;
      RAISE EXCEPTION 'diner_double_book' USING ERRCODE = 'P0006';
  END;

  FOREACH v_table_id IN ARRAY v_hold.table_ids LOOP
    INSERT INTO public.reservation_tables (
      restaurant_id, reservation_id, table_id, is_primary
    ) VALUES (
      v_hold.restaurant_id, v_new_res_id, v_table_id, v_index = 1
    );
    v_index := v_index + 1;
  END LOOP;

  UPDATE public.reservations
     SET table_id = v_hold.table_ids[1]
   WHERE id = v_new_res_id;

  -- Deposit payment row — pre-marked charged since the PI already succeeded.
  -- For SINGLE-payer flows the caller passes p_payment_intent_id and
  -- v_hold.deposit_amount_cents == the full charged amount; we insert one
  -- row here and the settle trigger upgrades the reservation to confirmed.
  -- For SPLIT-payer flows the caller pre-creates deposit_payments rows
  -- itself (one per co-payer with their per-share amount) and skips
  -- passing p_payment_intent_id, so this branch is a no-op and the trigger
  -- waits until every co-payer's row reaches status='charged'.
  IF v_has_deposit AND p_payment_intent_id IS NOT NULL THEN
    INSERT INTO public.reservation_deposit_payments
      (reservation_id, payer_email, payer_user_profile_id, payer_full_name,
       amount_cents, status, stripe_payment_intent_id, paid_at)
    VALUES
      (v_new_res_id, v_hold.guest_email, v_hold.user_profile_id, v_hold.guest_full_name,
       v_hold.deposit_amount_cents, 'charged', p_payment_intent_id, now());
  END IF;

  UPDATE public.reservation_holds
     SET status = 'converted', converted_reservation_id = v_new_res_id
   WHERE id = p_hold_id;

  reservation_id    := v_new_res_id;
  confirmation_code := v_hold.confirmation_code;
  table_ids         := v_hold.table_ids;
  duration_minutes  := v_hold.duration_minutes;
  idempotent        := false;
  RETURN NEXT;
END;
$$;
