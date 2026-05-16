-- Reservation-hold RPCs:
--   create_reservation_hold              — Step 1 mount; advisory lock + cover-cap + table assignment
--   update_reservation_hold_diner        — Step 1 submit; attaches name/email/phone, re-checks diner-overlap
--   update_reservation_hold_cart         — Step 2 cart change; updates cart_snapshot + total
--   extend_reservation_hold              — heartbeat; bumps expires_at up to +5 min beyond original
--   cancel_reservation_hold              — explicit cancel; flips status to 'cancelled'
--   expire_reservation_holds             — bulk expiry job (called by cron via edge fn)
--   convert_reservation_hold_to_reservation
--                                        — atomic conversion: hold → reservations row.
--                                          Idempotent. Used by both stripe-webhook and
--                                          confirm-hold-paid (browser-side).
--
-- Error codes:
--   P0001 no_table              — no fitting tables
--   P0002 over_cover_cap        — shift would exceed max_covers
--   P0003 shift_not_found       — shift_id invalid/inactive
--   P0006 diner_double_book     — overlap with reservation OR another hold
--   P0010 hold_not_found        — convert called with bad id
--   P0011 hold_expired          — convert called past expiry + grace
--   P0012 hold_not_convertible  — convert called with wrong status (already cancelled etc.)
--   22023 invalid_arguments
--   23P01 exclusion_violation   — race backstop, map to P0006

-- =====================================================================
-- create_reservation_hold
-- =====================================================================
CREATE OR REPLACE FUNCTION public.create_reservation_hold(
  p_restaurant_id      uuid,
  p_shift_id           uuid,
  p_reserved_at        timestamptz,
  p_party_size         integer,
  p_turn_minutes       integer DEFAULT NULL,
  p_confirmation_code  text DEFAULT NULL,
  p_source             text DEFAULT 'web',
  p_user_profile_id    uuid DEFAULT NULL,
  p_guest_id           uuid DEFAULT NULL,
  p_guest_full_name    text DEFAULT NULL,
  p_guest_email        text DEFAULT NULL,
  p_guest_phone        text DEFAULT NULL,
  p_event_id           uuid DEFAULT NULL,
  p_promotion_id       uuid DEFAULT NULL,
  p_applied_promo_code text DEFAULT NULL,
  p_hold_minutes       integer DEFAULT 30
)
RETURNS TABLE (
  hold_id              uuid,
  confirmation_code    text,
  table_ids            uuid[],
  duration_minutes     integer,
  expires_at           timestamptz,
  deposit_amount_cents integer,
  server_now           timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_turn integer;
  v_slot_end timestamptz;
  v_slot_range tstzrange;
  v_max_covers integer;
  v_total_covers integer;
  v_total_held integer;
  v_table_ids uuid[];
  v_hold_id uuid;
  v_email_norm text;
  v_phone_norm text;
  v_overlap_id uuid;
  v_confirmation_code text;
  v_deposit_cents integer;
  v_expires_at timestamptz;
BEGIN
  IF p_restaurant_id IS NULL OR p_shift_id IS NULL OR p_reserved_at IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  v_turn := COALESCE(NULLIF(p_turn_minutes, 0), public.restaurant_turn_time_minutes(p_restaurant_id, p_shift_id), 90);
  v_slot_end := p_reserved_at + (v_turn * interval '1 minute');
  v_slot_range := tstzrange(p_reserved_at, v_slot_end, '[)');

  -- Same advisory lock key as book_reservation — serializes holds AND
  -- reservations for the same (restaurant, slot).
  PERFORM pg_advisory_xact_lock(
    hashtext(p_restaurant_id::text || '|' || extract(epoch FROM p_reserved_at)::text)::bigint
  );

  -- Diner-overlap pre-check: scan BOTH reservations AND active holds.
  IF p_user_profile_id IS NOT NULL THEN
    SELECT r.id INTO v_overlap_id
    FROM public.reservations r
    WHERE r.user_profile_id = p_user_profile_id
      AND r.status IN ('pending', 'confirmed', 'seated')
      AND r.slot_range && v_slot_range
    LIMIT 1;
    IF v_overlap_id IS NOT NULL THEN
      RAISE EXCEPTION 'diner_double_book'
        USING ERRCODE = 'P0006', DETAIL = 'overlap_reservation_id=' || v_overlap_id::text;
    END IF;

    SELECT h.id INTO v_overlap_id
    FROM public.reservation_holds h
    WHERE h.user_profile_id = p_user_profile_id
      AND h.status IN ('active', 'converting')
      AND h.expires_at > now()
      AND h.slot_range && v_slot_range
    LIMIT 1;
    IF v_overlap_id IS NOT NULL THEN
      RAISE EXCEPTION 'diner_double_book'
        USING ERRCODE = 'P0006', DETAIL = 'overlap_hold_id=' || v_overlap_id::text;
    END IF;
  ELSE
    v_email_norm := lower(NULLIF(trim(COALESCE(p_guest_email, '')), ''));
    v_phone_norm := NULLIF(regexp_replace(COALESCE(p_guest_phone, ''), '\D', '', 'g'), '');

    IF v_email_norm IS NOT NULL THEN
      SELECT r.id INTO v_overlap_id
      FROM public.reservations r
      WHERE r.user_profile_id IS NULL
        AND lower(r.guest_email) = v_email_norm
        AND r.status IN ('pending', 'confirmed', 'seated')
        AND r.slot_range && v_slot_range
      LIMIT 1;
      IF v_overlap_id IS NOT NULL THEN
        RAISE EXCEPTION 'diner_double_book'
          USING ERRCODE = 'P0006', DETAIL = 'overlap_reservation_id=' || v_overlap_id::text;
      END IF;

      SELECT h.id INTO v_overlap_id
      FROM public.reservation_holds h
      WHERE h.user_profile_id IS NULL
        AND lower(h.guest_email) = v_email_norm
        AND h.status IN ('active', 'converting')
        AND h.expires_at > now()
        AND h.slot_range && v_slot_range
      LIMIT 1;
      IF v_overlap_id IS NOT NULL THEN
        RAISE EXCEPTION 'diner_double_book'
          USING ERRCODE = 'P0006', DETAIL = 'overlap_hold_id=' || v_overlap_id::text;
      END IF;
    END IF;

    IF v_phone_norm IS NOT NULL THEN
      SELECT r.id INTO v_overlap_id
      FROM public.reservations r
      WHERE r.user_profile_id IS NULL
        AND regexp_replace(COALESCE(r.guest_phone, ''), '\D', '', 'g') = v_phone_norm
        AND r.status IN ('pending', 'confirmed', 'seated')
        AND r.slot_range && v_slot_range
      LIMIT 1;
      IF v_overlap_id IS NOT NULL THEN
        RAISE EXCEPTION 'diner_double_book'
          USING ERRCODE = 'P0006', DETAIL = 'overlap_reservation_id=' || v_overlap_id::text;
      END IF;

      SELECT h.id INTO v_overlap_id
      FROM public.reservation_holds h
      WHERE h.user_profile_id IS NULL
        AND regexp_replace(COALESCE(h.guest_phone, ''), '\D', '', 'g') = v_phone_norm
        AND h.status IN ('active', 'converting')
        AND h.expires_at > now()
        AND h.slot_range && v_slot_range
      LIMIT 1;
      IF v_overlap_id IS NOT NULL THEN
        RAISE EXCEPTION 'diner_double_book'
          USING ERRCODE = 'P0006', DETAIL = 'overlap_hold_id=' || v_overlap_id::text;
      END IF;
    END IF;
  END IF;

  -- Shift sanity.
  SELECT COALESCE(s.max_covers, 100) INTO v_max_covers
  FROM public.shifts s
  WHERE s.id = p_shift_id AND s.restaurant_id = p_restaurant_id AND s.is_active;
  IF v_max_covers IS NULL THEN
    RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0003';
  END IF;

  -- Cover-cap check counts BOTH reservations AND active holds.
  SELECT COALESCE(SUM(r.party_size), 0)::integer INTO v_total_covers
  FROM public.reservations r
  WHERE r.restaurant_id = p_restaurant_id
    AND r.shift_id = p_shift_id
    AND r.status IN ('pending', 'confirmed', 'seated')
    AND r.reserved_at < v_slot_end
    AND r.reserved_at + (COALESCE(NULLIF(r.duration_minutes, 0), v_turn) * interval '1 minute') > p_reserved_at;

  SELECT COALESCE(SUM(h.party_size), 0)::integer INTO v_total_held
  FROM public.reservation_holds h
  WHERE h.restaurant_id = p_restaurant_id
    AND h.shift_id = p_shift_id
    AND h.status IN ('active', 'converting')
    AND h.expires_at > now()
    AND h.reserved_at < v_slot_end
    AND h.reserved_at + (h.duration_minutes * interval '1 minute') > p_reserved_at;

  IF v_total_covers + v_total_held + p_party_size > v_max_covers THEN
    RAISE EXCEPTION 'over_cover_cap' USING ERRCODE = 'P0002';
  END IF;

  -- Table assignment (find_available_table_group is patched below to also see holds).
  v_table_ids := public.find_available_table_group(
    p_restaurant_id,
    p_reserved_at,
    p_party_size,
    v_turn
  );
  IF COALESCE(array_length(v_table_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'no_table' USING ERRCODE = 'P0001';
  END IF;

  v_deposit_cents := COALESCE(public.compute_deposit_for_party(p_restaurant_id, p_party_size), 0);
  v_confirmation_code := COALESCE(NULLIF(trim(p_confirmation_code), ''), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));
  v_expires_at := now() + (p_hold_minutes * interval '1 minute');

  BEGIN
    INSERT INTO public.reservation_holds (
      restaurant_id, shift_id, reserved_at, duration_minutes, party_size, table_ids,
      user_profile_id, guest_id, guest_full_name, guest_email, guest_phone,
      confirmation_code, source,
      event_id, promotion_id, applied_promo_code,
      deposit_amount_cents,
      status, expires_at, last_heartbeat_at
    ) VALUES (
      p_restaurant_id, p_shift_id, p_reserved_at, v_turn, p_party_size, v_table_ids,
      p_user_profile_id, p_guest_id, p_guest_full_name, p_guest_email, p_guest_phone,
      v_confirmation_code, COALESCE(p_source, 'web'),
      p_event_id, p_promotion_id, p_applied_promo_code,
      v_deposit_cents,
      'active', v_expires_at, now()
    )
    RETURNING id INTO v_hold_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'diner_double_book' USING ERRCODE = 'P0006';
  END;

  hold_id := v_hold_id;
  confirmation_code := v_confirmation_code;
  table_ids := v_table_ids;
  duration_minutes := v_turn;
  expires_at := v_expires_at;
  deposit_amount_cents := v_deposit_cents;
  server_now := now();
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_reservation_hold(
  uuid, uuid, timestamptz, integer, integer, text, text, uuid, uuid, text, text, text, uuid, uuid, text, integer
) TO service_role;

-- =====================================================================
-- update_reservation_hold_diner — Step 1 form submit
-- =====================================================================
CREATE OR REPLACE FUNCTION public.update_reservation_hold_diner(
  p_hold_id           uuid,
  p_user_profile_id   uuid DEFAULT NULL,
  p_guest_id          uuid DEFAULT NULL,
  p_guest_full_name   text DEFAULT NULL,
  p_guest_email       text DEFAULT NULL,
  p_guest_phone       text DEFAULT NULL,
  p_special_request   text DEFAULT NULL,
  p_dietary_notes     text DEFAULT NULL,
  p_occasion          text DEFAULT NULL,
  p_seating_preference text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold reservation_holds%ROWTYPE;
  v_email_norm text;
  v_phone_norm text;
  v_overlap_id uuid;
BEGIN
  SELECT * INTO v_hold FROM public.reservation_holds WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hold_not_found' USING ERRCODE = 'P0010';
  END IF;
  IF v_hold.status <> 'active' THEN
    RAISE EXCEPTION 'hold_not_convertible' USING ERRCODE = 'P0012';
  END IF;

  -- Re-run diner-overlap check now that we have identity (was anonymous before).
  IF p_user_profile_id IS NOT NULL THEN
    SELECT r.id INTO v_overlap_id
    FROM public.reservations r
    WHERE r.user_profile_id = p_user_profile_id
      AND r.status IN ('pending', 'confirmed', 'seated')
      AND r.slot_range && v_hold.slot_range
    LIMIT 1;
    IF v_overlap_id IS NOT NULL THEN
      RAISE EXCEPTION 'diner_double_book'
        USING ERRCODE = 'P0006', DETAIL = 'overlap_reservation_id=' || v_overlap_id::text;
    END IF;

    SELECT h.id INTO v_overlap_id
    FROM public.reservation_holds h
    WHERE h.id <> p_hold_id
      AND h.user_profile_id = p_user_profile_id
      AND h.status IN ('active', 'converting')
      AND h.expires_at > now()
      AND h.slot_range && v_hold.slot_range
    LIMIT 1;
    IF v_overlap_id IS NOT NULL THEN
      RAISE EXCEPTION 'diner_double_book'
        USING ERRCODE = 'P0006', DETAIL = 'overlap_hold_id=' || v_overlap_id::text;
    END IF;
  ELSE
    v_email_norm := lower(NULLIF(trim(COALESCE(p_guest_email, '')), ''));
    v_phone_norm := NULLIF(regexp_replace(COALESCE(p_guest_phone, ''), '\D', '', 'g'), '');

    IF v_email_norm IS NOT NULL THEN
      SELECT r.id INTO v_overlap_id
      FROM public.reservations r
      WHERE r.user_profile_id IS NULL
        AND lower(r.guest_email) = v_email_norm
        AND r.status IN ('pending', 'confirmed', 'seated')
        AND r.slot_range && v_hold.slot_range
      LIMIT 1;
      IF v_overlap_id IS NOT NULL THEN
        RAISE EXCEPTION 'diner_double_book' USING ERRCODE = 'P0006';
      END IF;

      SELECT h.id INTO v_overlap_id
      FROM public.reservation_holds h
      WHERE h.id <> p_hold_id
        AND h.user_profile_id IS NULL
        AND lower(h.guest_email) = v_email_norm
        AND h.status IN ('active', 'converting')
        AND h.expires_at > now()
        AND h.slot_range && v_hold.slot_range
      LIMIT 1;
      IF v_overlap_id IS NOT NULL THEN
        RAISE EXCEPTION 'diner_double_book' USING ERRCODE = 'P0006';
      END IF;
    END IF;

    IF v_phone_norm IS NOT NULL THEN
      SELECT r.id INTO v_overlap_id
      FROM public.reservations r
      WHERE r.user_profile_id IS NULL
        AND regexp_replace(COALESCE(r.guest_phone, ''), '\D', '', 'g') = v_phone_norm
        AND r.status IN ('pending', 'confirmed', 'seated')
        AND r.slot_range && v_hold.slot_range
      LIMIT 1;
      IF v_overlap_id IS NOT NULL THEN
        RAISE EXCEPTION 'diner_double_book' USING ERRCODE = 'P0006';
      END IF;

      SELECT h.id INTO v_overlap_id
      FROM public.reservation_holds h
      WHERE h.id <> p_hold_id
        AND h.user_profile_id IS NULL
        AND regexp_replace(COALESCE(h.guest_phone, ''), '\D', '', 'g') = v_phone_norm
        AND h.status IN ('active', 'converting')
        AND h.expires_at > now()
        AND h.slot_range && v_hold.slot_range
      LIMIT 1;
      IF v_overlap_id IS NOT NULL THEN
        RAISE EXCEPTION 'diner_double_book' USING ERRCODE = 'P0006';
      END IF;
    END IF;
  END IF;

  BEGIN
    UPDATE public.reservation_holds
       SET user_profile_id    = COALESCE(p_user_profile_id, user_profile_id),
           guest_id           = COALESCE(p_guest_id, guest_id),
           guest_full_name    = COALESCE(NULLIF(trim(COALESCE(p_guest_full_name, '')), ''), guest_full_name),
           guest_email        = COALESCE(NULLIF(trim(COALESCE(p_guest_email, '')), ''), guest_email),
           guest_phone        = COALESCE(NULLIF(trim(COALESCE(p_guest_phone, '')), ''), guest_phone),
           special_request    = COALESCE(NULLIF(trim(COALESCE(p_special_request, '')), ''), special_request),
           dietary_notes      = COALESCE(NULLIF(trim(COALESCE(p_dietary_notes, '')), ''), dietary_notes),
           occasion           = COALESCE(NULLIF(trim(COALESCE(p_occasion, '')), ''), occasion),
           seating_preference = COALESCE(NULLIF(trim(COALESCE(p_seating_preference, '')), ''), seating_preference)
     WHERE id = p_hold_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'diner_double_book' USING ERRCODE = 'P0006';
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_reservation_hold_diner(
  uuid, uuid, uuid, text, text, text, text, text, text, text
) TO service_role;

-- =====================================================================
-- update_reservation_hold_cart — Step 2 cart change
-- =====================================================================
CREATE OR REPLACE FUNCTION public.update_reservation_hold_cart(
  p_hold_id            uuid,
  p_cart_snapshot      jsonb,
  p_total_amount_cents integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.reservation_holds WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hold_not_found' USING ERRCODE = 'P0010';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'hold_not_convertible' USING ERRCODE = 'P0012';
  END IF;

  UPDATE public.reservation_holds
     SET cart_snapshot      = COALESCE(p_cart_snapshot, cart_snapshot),
         total_amount_cents = COALESCE(p_total_amount_cents, total_amount_cents)
   WHERE id = p_hold_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_reservation_hold_cart(uuid, jsonb, integer) TO service_role;

-- =====================================================================
-- extend_reservation_hold — heartbeat; caps total extension at +5 min
-- =====================================================================
CREATE OR REPLACE FUNCTION public.extend_reservation_hold(
  p_hold_id        uuid,
  p_extend_seconds integer DEFAULT 120
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold reservation_holds%ROWTYPE;
  v_new_expires timestamptz;
  v_max_expires timestamptz;
BEGIN
  SELECT * INTO v_hold FROM public.reservation_holds WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_hold.status <> 'active' THEN
    RETURN NULL;
  END IF;

  -- Cap extension at created_at + 35 min (original 30 + 5 max grace).
  v_max_expires := v_hold.created_at + interval '35 minutes';
  v_new_expires := LEAST(GREATEST(v_hold.expires_at, now() + make_interval(secs => p_extend_seconds)), v_max_expires);

  UPDATE public.reservation_holds
     SET expires_at        = v_new_expires,
         last_heartbeat_at = now()
   WHERE id = p_hold_id;

  RETURN v_new_expires;
END;
$$;

GRANT EXECUTE ON FUNCTION public.extend_reservation_hold(uuid, integer) TO service_role;

-- =====================================================================
-- cancel_reservation_hold
-- =====================================================================
CREATE OR REPLACE FUNCTION public.cancel_reservation_hold(p_hold_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.reservation_holds
     SET status = 'cancelled'
   WHERE id = p_hold_id AND status IN ('active', 'converting');
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_reservation_hold(uuid) TO service_role;

-- =====================================================================
-- expire_reservation_holds — bulk job for cron
-- =====================================================================
CREATE OR REPLACE FUNCTION public.expire_reservation_holds(p_grace_seconds integer DEFAULT 120)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired integer;
BEGIN
  WITH expired AS (
    UPDATE public.reservation_holds
       SET status = 'expired'
     WHERE status = 'active'
       AND expires_at < now() - make_interval(secs => p_grace_seconds)
     RETURNING id
  )
  SELECT count(*)::integer INTO v_expired FROM expired;

  -- Housekeeping — drop terminal-state rows older than 7 days.
  DELETE FROM public.reservation_holds
   WHERE status IN ('expired', 'cancelled', 'converted')
     AND created_at < now() - interval '7 days';

  RETURN COALESCE(v_expired, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.expire_reservation_holds(integer) TO service_role;

-- =====================================================================
-- convert_reservation_hold_to_reservation — atomic, idempotent
-- =====================================================================
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
      'confirmed', v_hold.source, v_hold.confirmation_code,
      v_hold.special_request, v_hold.dietary_notes, v_hold.occasion,
      v_hold.user_profile_id IS NULL,
      v_hold.guest_full_name, v_hold.guest_email, v_hold.guest_phone,
      CASE WHEN v_hold.deposit_amount_cents > 0 THEN v_hold.deposit_amount_cents ELSE NULL END,
      CASE WHEN v_hold.deposit_amount_cents > 0 THEN 'charged' ELSE 'none' END,
      p_payment_intent_id,
      now(),
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
  IF v_hold.deposit_amount_cents > 0 AND p_payment_intent_id IS NOT NULL THEN
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

GRANT EXECUTE ON FUNCTION public.convert_reservation_hold_to_reservation(uuid, text, integer)
  TO service_role;

-- =====================================================================
-- Patch: find_available_table_group — block tables held by active holds
-- =====================================================================
CREATE OR REPLACE FUNCTION public.find_available_table_group(
  p_restaurant_id uuid,
  p_reserved_at timestamp with time zone,
  p_party_size integer,
  p_turn_minutes integer DEFAULT NULL,
  p_exclude_reservation_id uuid DEFAULT NULL,
  p_adjacency_distance double precision DEFAULT 170
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_turn_minutes integer;
  v_slot_end timestamptz;
  v_unavailable uuid[];
  v_group uuid[];
BEGIN
  IF p_restaurant_id IS NULL OR p_reserved_at IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  IF p_party_size > public.restaurant_floor_capacity(p_restaurant_id) THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  v_turn_minutes := COALESCE(p_turn_minutes, public.restaurant_turn_time_minutes(p_restaurant_id), 90);
  v_slot_end := p_reserved_at + make_interval(mins => v_turn_minutes);

  SELECT COALESCE(array_agg(DISTINCT blocked.table_id), ARRAY[]::uuid[])
  INTO v_unavailable
  FROM (
    -- Multi-table reservations.
    SELECT rt.table_id
    FROM public.reservations r
    JOIN public.reservation_tables rt
      ON rt.reservation_id = r.id
      AND rt.released_at IS NULL
    WHERE r.restaurant_id = p_restaurant_id
      AND (p_exclude_reservation_id IS NULL OR r.id <> p_exclude_reservation_id)
      AND r.status IN ('pending', 'confirmed', 'seated')
      AND r.reserved_at < v_slot_end
      AND r.reserved_at + make_interval(mins => COALESCE(r.duration_minutes, v_turn_minutes, 90)) > p_reserved_at

    UNION

    -- Legacy single-table reservations.
    SELECT r.table_id
    FROM public.reservations r
    WHERE r.restaurant_id = p_restaurant_id
      AND r.table_id IS NOT NULL
      AND (p_exclude_reservation_id IS NULL OR r.id <> p_exclude_reservation_id)
      AND r.status IN ('pending', 'confirmed', 'seated')
      AND r.reserved_at < v_slot_end
      AND r.reserved_at + make_interval(mins => COALESCE(r.duration_minutes, v_turn_minutes, 90)) > p_reserved_at

    UNION

    -- NEW: active holds — table_ids array exploded.
    SELECT unnest(h.table_ids) AS table_id
    FROM public.reservation_holds h
    WHERE h.restaurant_id = p_restaurant_id
      AND h.status IN ('active', 'converting')
      AND h.expires_at > now()
      AND h.reserved_at < v_slot_end
      AND h.reserved_at + make_interval(mins => h.duration_minutes) > p_reserved_at
  ) blocked;

  -- Smallest single-table fit (verbatim from previous version).
  SELECT ARRAY[t.id]
  INTO v_group
  FROM public."tables" t
  WHERE t.restaurant_id = p_restaurant_id
    AND COALESCE(t.is_active, true)
    AND COALESCE(t.status, 'empty') <> 'blocked'
    AND NOT (t.id = ANY(v_unavailable))
    AND COALESCE(t.min_party, 1) <= p_party_size
    AND t.capacity >= p_party_size
  ORDER BY t.capacity ASC, t.table_number ASC
  LIMIT 1;

  IF COALESCE(array_length(v_group, 1), 0) > 0 THEN
    RETURN v_group;
  END IF;

  -- Same-section combo (verbatim).
  WITH RECURSIVE candidate_tables AS (
    SELECT
      t.id,
      GREATEST(COALESCE(t.capacity, 0), 0)::integer AS capacity,
      COALESCE(t.section_id::text, t.section, '') AS section_key,
      COALESCE(t.position_x, 0)::double precision AS x,
      COALESCE(t.position_y, 0)::double precision AS y,
      COALESCE(t.label, t.table_number, t.id::text) AS sort_label
    FROM public."tables" t
    WHERE t.restaurant_id = p_restaurant_id
      AND COALESCE(t.is_active, true)
      AND COALESCE(t.status, 'empty') <> 'blocked'
      AND NOT (t.id = ANY(v_unavailable))
      AND COALESCE(t.min_party, 1) <= p_party_size
      AND GREATEST(COALESCE(t.capacity, 0), 0) > 0
    ORDER BY t.capacity ASC, t.table_number ASC
    LIMIT 36
  ),
  available AS (
    SELECT
      row_number() OVER (ORDER BY capacity ASC, sort_label ASC, id ASC)::integer AS ord,
      id, capacity, section_key, x, y, sort_label
    FROM candidate_tables
  ),
  groups AS (
    SELECT
      ARRAY[a.id] AS table_ids,
      ARRAY[a.ord] AS path,
      a.capacity AS total_capacity,
      1 AS table_count,
      a.section_key,
      ARRAY[a.sort_label] AS sort_labels
    FROM available a
    UNION ALL
    SELECT
      g.table_ids || a.id,
      g.path || a.ord,
      g.total_capacity + a.capacity,
      g.table_count + 1,
      g.section_key,
      g.sort_labels || a.sort_label
    FROM groups g
    JOIN available a
      ON a.section_key = g.section_key
      AND a.ord > g.path[array_length(g.path, 1)]
    WHERE g.total_capacity < p_party_size
      AND g.table_count < 16
      AND EXISTS (
        SELECT 1
        FROM available existing
        WHERE existing.id = ANY(g.table_ids)
          AND sqrt(power(existing.x - a.x, 2) + power(existing.y - a.y, 2)) <= COALESCE(p_adjacency_distance, 170)
      )
  )
  SELECT table_ids
  INTO v_group
  FROM groups
  WHERE total_capacity >= p_party_size
  ORDER BY table_count ASC, total_capacity ASC, sort_labels ASC
  LIMIT 1;

  IF COALESCE(array_length(v_group, 1), 0) > 0 THEN
    RETURN v_group;
  END IF;

  -- Any-section combo fallback (verbatim).
  WITH RECURSIVE candidate_tables AS (
    SELECT
      t.id,
      GREATEST(COALESCE(t.capacity, 0), 0)::integer AS capacity,
      COALESCE(t.label, t.table_number, t.id::text) AS sort_label
    FROM public."tables" t
    WHERE t.restaurant_id = p_restaurant_id
      AND COALESCE(t.is_active, true)
      AND COALESCE(t.status, 'empty') <> 'blocked'
      AND NOT (t.id = ANY(v_unavailable))
      AND COALESCE(t.min_party, 1) <= p_party_size
      AND GREATEST(COALESCE(t.capacity, 0), 0) > 0
    ORDER BY t.capacity ASC, t.table_number ASC
    LIMIT 36
  ),
  available AS (
    SELECT
      row_number() OVER (ORDER BY capacity ASC, sort_label ASC, id ASC)::integer AS ord,
      id, capacity, sort_label
    FROM candidate_tables
  ),
  groups AS (
    SELECT
      ARRAY[a.id] AS table_ids,
      ARRAY[a.ord] AS path,
      a.capacity AS total_capacity,
      1 AS table_count,
      ARRAY[a.sort_label] AS sort_labels
    FROM available a
    UNION ALL
    SELECT
      g.table_ids || a.id,
      g.path || a.ord,
      g.total_capacity + a.capacity,
      g.table_count + 1,
      g.sort_labels || a.sort_label
    FROM groups g
    JOIN available a
      ON a.ord > g.path[array_length(g.path, 1)]
    WHERE g.total_capacity < p_party_size
      AND g.table_count < 16
  )
  SELECT table_ids
  INTO v_group
  FROM groups
  WHERE total_capacity >= p_party_size
  ORDER BY table_count ASC, total_capacity ASC, sort_labels ASC
  LIMIT 1;

  RETURN COALESCE(v_group, ARRAY[]::uuid[]);
END;
$$;
