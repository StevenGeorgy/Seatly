-- Account-scoped 15-min reservation hold (Model B).
--
-- BACKGROUND
-- ----------
-- Earlier today we shipped a chain of fixes (page-scoped hydrate gate,
-- unmount cancel beacon, client_token tombstone race fix, post-INSERT
-- recheck, grabAgain pre-cancel) to enforce "leave the page = cancel
-- the hold." That model broke multi-tab UX: closing tab A killed
-- tab B's hold for the same diner.
--
-- New model matches OpenTable / Resy / Tock:
--   - Single 15-min TTL from hold creation.
--   - Heartbeats from any open tab extend up to created_at + 60 min.
--   - Closing a tab is a no-op server-side; the hold survives.
--   - Two tabs of the same logged-in diner on the same slot share ONE
--     hold via the recovery branch in create-reservation-hold:216-262
--     (returns existing hold_id on P0006).
--
-- This migration changes three RPCs. CREATE OR REPLACE used throughout
-- so re-running migrations from scratch in CI lands OUR definitive
-- version (the earlier 20260526180000 / 20260526190000 redefined them).
--
-- Voice path (supabase/functions/_shared/booking.ts:276) explicitly
-- passes p_hold_minutes: 30 for phone→web handoff and is unaffected.

BEGIN;

-- ── create_reservation_hold: default TTL 5 → 15 ──
-- Body is identical to 20260526190000 (preserves tombstone-race-fix +
-- post-INSERT recheck). ONLY change: p_hold_minutes DEFAULT 15.

DROP FUNCTION IF EXISTS public.create_reservation_hold(
  uuid, uuid, timestamptz, integer, integer, text, text, uuid, uuid, text, text, text, uuid, uuid, text, integer, uuid
);

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

  IF p_client_token IS NOT NULL AND NOT v_tombstone_found THEN
    PERFORM 1 FROM public.hold_cancellation_intents WHERE client_token = p_client_token;
    IF FOUND THEN
      UPDATE public.reservation_holds
         SET status = 'cancelled'
       WHERE id = v_hold_id AND status = 'active';
    END IF;
  END IF;

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

-- ── update_reservation_hold_diner: drop the 30-min TTL bump ──
-- Single 15-min TTL. Diners who fill in their identity don't get a
-- fresh window — heartbeats handle "active session" extension naturally.

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

-- ── extend_reservation_hold: cap at created_at + 60 min ──
-- 15-min initial TTL + heartbeat headroom = 60 min max on active
-- session. Idle tabs that stop heartbeating expire at ~15 min.
-- Re-declared here only to land OUR definitive version in CI rebuilds.

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

  v_max_expires := v_hold.created_at + interval '60 minutes';
  v_new_expires := LEAST(GREATEST(v_hold.expires_at, now() + make_interval(secs => p_extend_seconds)), v_max_expires);

  UPDATE public.reservation_holds
     SET expires_at        = v_new_expires,
         last_heartbeat_at = now()
   WHERE id = p_hold_id;

  RETURN v_new_expires;
END;
$$;

GRANT EXECUTE ON FUNCTION public.extend_reservation_hold(uuid, integer) TO service_role;

COMMIT;
