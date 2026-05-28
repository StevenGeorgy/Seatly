-- 2026-05-28 — restore create_reservation_hold default TTL from 5 → 15 min.
--
-- Regression introduced by migration 20260528220000 (PR-F): when I rewrote
-- create_reservation_hold to add exact-match reuse logic, I copied the
-- function body from migration 20260526180000 (which had `p_hold_minutes
-- DEFAULT 5`) instead of from the latest 20260527000000 (which had
-- already bumped it to 15 as part of the "account-scoped TTL" model
-- — flat 15 min, heartbeats extend up to created_at + 60 min, no
-- 5/30 phase split).
--
-- This migration changes ONLY the default; the rest of the function body
-- (including PR-F's exact-match reuse for user_profile_id / guest_email /
-- guest_phone) is preserved verbatim.

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
  p_hold_minutes       integer DEFAULT 15,
  p_client_token       uuid DEFAULT NULL
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
  v_tombstone_found boolean;
  v_reuse_id uuid;
  v_reuse_code text;
  v_reuse_tables uuid[];
  v_reuse_duration integer;
  v_reuse_expires timestamptz;
  v_reuse_deposit integer;
BEGIN
  IF p_restaurant_id IS NULL OR p_shift_id IS NULL OR p_reserved_at IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  v_turn := COALESCE(NULLIF(p_turn_minutes, 0), public.restaurant_turn_time_minutes(p_restaurant_id, p_shift_id), 90);
  v_slot_end := p_reserved_at + (v_turn * interval '1 minute');
  v_slot_range := tstzrange(p_reserved_at, v_slot_end, '[)');
  v_confirmation_code := COALESCE(NULLIF(trim(p_confirmation_code), ''), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));
  v_deposit_cents := COALESCE(public.compute_deposit_for_party(p_restaurant_id, p_party_size), 0);
  v_expires_at := now() + (p_hold_minutes * interval '1 minute');

  v_tombstone_found := false;
  IF p_client_token IS NOT NULL THEN
    SELECT TRUE INTO v_tombstone_found
    FROM public.hold_cancellation_intents
    WHERE client_token = p_client_token;
    IF v_tombstone_found THEN
      BEGIN
        INSERT INTO public.reservation_holds (
          restaurant_id, shift_id, reserved_at, duration_minutes, party_size, table_ids,
          user_profile_id, guest_id, guest_full_name, guest_email, guest_phone,
          confirmation_code, source,
          event_id, promotion_id, applied_promo_code,
          deposit_amount_cents,
          status, expires_at, last_heartbeat_at,
          client_token
        ) VALUES (
          p_restaurant_id, p_shift_id, p_reserved_at, v_turn, p_party_size, ARRAY[]::uuid[],
          p_user_profile_id, p_guest_id, p_guest_full_name, p_guest_email, p_guest_phone,
          v_confirmation_code, COALESCE(p_source, 'web'),
          p_event_id, p_promotion_id, p_applied_promo_code,
          v_deposit_cents,
          'cancelled', v_expires_at, now(),
          p_client_token
        )
        RETURNING id INTO v_hold_id;
      EXCEPTION
        WHEN unique_violation THEN
          SELECT id INTO v_hold_id
          FROM public.reservation_holds
          WHERE client_token = p_client_token
          LIMIT 1;
      END;
      hold_id := v_hold_id;
      confirmation_code := v_confirmation_code;
      table_ids := ARRAY[]::uuid[];
      duration_minutes := v_turn;
      expires_at := v_expires_at;
      deposit_amount_cents := v_deposit_cents;
      server_now := now();
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_restaurant_id::text || '|' || extract(epoch FROM p_reserved_at)::text)::bigint
  );

  -- PR-F (#F12): exact-match reuse. Before raising diner_double_book for
  -- an overlap, check if the caller already has an active hold for the
  -- EXACT same (restaurant, reserved_at, party_size). If yes, return it.
  IF p_user_profile_id IS NOT NULL THEN
    SELECT h.id, h.confirmation_code, h.table_ids, h.duration_minutes,
           h.expires_at, h.deposit_amount_cents
    INTO v_reuse_id, v_reuse_code, v_reuse_tables, v_reuse_duration,
         v_reuse_expires, v_reuse_deposit
    FROM public.reservation_holds h
    WHERE h.user_profile_id = p_user_profile_id
      AND h.restaurant_id = p_restaurant_id
      AND h.reserved_at = p_reserved_at
      AND h.party_size = p_party_size
      AND h.status IN ('active', 'converting')
      AND h.expires_at > now()
    ORDER BY h.created_at DESC
    LIMIT 1;
    IF v_reuse_id IS NOT NULL THEN
      hold_id := v_reuse_id;
      confirmation_code := v_reuse_code;
      table_ids := COALESCE(v_reuse_tables, ARRAY[]::uuid[]);
      duration_minutes := v_reuse_duration;
      expires_at := v_reuse_expires;
      deposit_amount_cents := v_reuse_deposit;
      server_now := now();
      RETURN NEXT;
      RETURN;
    END IF;

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
      SELECT h.id, h.confirmation_code, h.table_ids, h.duration_minutes,
             h.expires_at, h.deposit_amount_cents
      INTO v_reuse_id, v_reuse_code, v_reuse_tables, v_reuse_duration,
           v_reuse_expires, v_reuse_deposit
      FROM public.reservation_holds h
      WHERE h.user_profile_id IS NULL
        AND lower(h.guest_email) = v_email_norm
        AND h.restaurant_id = p_restaurant_id
        AND h.reserved_at = p_reserved_at
        AND h.party_size = p_party_size
        AND h.status IN ('active', 'converting')
        AND h.expires_at > now()
      ORDER BY h.created_at DESC
      LIMIT 1;
      IF v_reuse_id IS NOT NULL THEN
        hold_id := v_reuse_id;
        confirmation_code := v_reuse_code;
        table_ids := COALESCE(v_reuse_tables, ARRAY[]::uuid[]);
        duration_minutes := v_reuse_duration;
        expires_at := v_reuse_expires;
        deposit_amount_cents := v_reuse_deposit;
        server_now := now();
        RETURN NEXT;
        RETURN;
      END IF;

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
      SELECT h.id, h.confirmation_code, h.table_ids, h.duration_minutes,
             h.expires_at, h.deposit_amount_cents
      INTO v_reuse_id, v_reuse_code, v_reuse_tables, v_reuse_duration,
           v_reuse_expires, v_reuse_deposit
      FROM public.reservation_holds h
      WHERE h.user_profile_id IS NULL
        AND regexp_replace(COALESCE(h.guest_phone, ''), '\D', '', 'g') = v_phone_norm
        AND h.restaurant_id = p_restaurant_id
        AND h.reserved_at = p_reserved_at
        AND h.party_size = p_party_size
        AND h.status IN ('active', 'converting')
        AND h.expires_at > now()
      ORDER BY h.created_at DESC
      LIMIT 1;
      IF v_reuse_id IS NOT NULL THEN
        hold_id := v_reuse_id;
        confirmation_code := v_reuse_code;
        table_ids := COALESCE(v_reuse_tables, ARRAY[]::uuid[]);
        duration_minutes := v_reuse_duration;
        expires_at := v_reuse_expires;
        deposit_amount_cents := v_reuse_deposit;
        server_now := now();
        RETURN NEXT;
        RETURN;
      END IF;

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

  SELECT COALESCE(s.max_covers, 100) INTO v_max_covers
  FROM public.shifts s
  WHERE s.id = p_shift_id AND s.restaurant_id = p_restaurant_id AND s.is_active;
  IF v_max_covers IS NULL THEN
    RAISE EXCEPTION 'shift_not_found' USING ERRCODE = 'P0003';
  END IF;

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

  v_table_ids := public.find_available_table_group(
    p_restaurant_id,
    p_reserved_at,
    p_party_size,
    v_turn
  );
  IF COALESCE(array_length(v_table_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'no_table' USING ERRCODE = 'P0001';
  END IF;

  IF p_client_token IS NOT NULL THEN
    PERFORM 1 FROM public.hold_cancellation_intents WHERE client_token = p_client_token;
    IF FOUND THEN
      v_tombstone_found := true;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.reservation_holds (
      restaurant_id, shift_id, reserved_at, duration_minutes, party_size, table_ids,
      user_profile_id, guest_id, guest_full_name, guest_email, guest_phone,
      confirmation_code, source,
      event_id, promotion_id, applied_promo_code,
      deposit_amount_cents,
      status, expires_at, last_heartbeat_at,
      client_token
    ) VALUES (
      p_restaurant_id, p_shift_id, p_reserved_at, v_turn, p_party_size, v_table_ids,
      p_user_profile_id, p_guest_id, p_guest_full_name, p_guest_email, p_guest_phone,
      v_confirmation_code, COALESCE(p_source, 'web'),
      p_event_id, p_promotion_id, p_applied_promo_code,
      v_deposit_cents,
      CASE WHEN v_tombstone_found THEN 'cancelled' ELSE 'active' END,
      v_expires_at, now(),
      p_client_token
    )
    RETURNING id INTO v_hold_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'diner_double_book' USING ERRCODE = 'P0006';
    WHEN unique_violation THEN
      SELECT id INTO v_hold_id
      FROM public.reservation_holds
      WHERE client_token = p_client_token
      LIMIT 1;
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
  uuid, uuid, timestamptz, integer, integer, text, text, uuid, uuid, text, text, text, uuid, uuid, text, integer, uuid
) TO service_role;
