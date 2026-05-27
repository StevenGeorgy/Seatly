-- Reservation-hold race fix: client-token-based cancel + tombstone +
-- observability + shorter unfilled-hold TTL.
--
-- BACKGROUND
-- ----------
-- The existing cancel-on-unmount flow had two compounding bugs:
--
--   1. **Client race (the bug that bit us):** if a diner navigates away
--      DURING the ~500ms create_reservation_hold POST, the client never
--      learns the new hold_id. The cleanup has nothing to cancel. The
--      server-created row sits in 'active' for the full 30-min TTL,
--      blocking the diner from booking any overlapping slot elsewhere.
--
--   2. **Server opacity:** cancel_reservation_hold was RETURNS void
--      with a silent `WHERE status IN ('active','converting')` clause.
--      Zero-rows-affected is indistinguishable from success. The edge
--      fn returns `{ok:true}` regardless. Nothing logged, no metric.
--
-- FIX SHAPE
-- ---------
-- (A) **client_token**: client generates a UUID *before* the create
--     POST and persists it locally. Both create + cancel carry the
--     token. Cancel-by-token always works, even with no hold_id.
--
-- (B) **Observability**: cancel RPCs now RETURNS boolean (rows_affected
--     > 0). Edge fn returns `{ok, cancelled}` so logs surface no-ops.
--
-- (C) **Shorter unfilled TTL**: default 30 min → 5 min. Diner identity
--     attach via update_reservation_hold_diner bumps to 30 min. Caps
--     tab-kill / network-offline blast radius from 30 min → 5 min for
--     the rare cases the cancel beacon doesn't make it.
--
-- (E) **Tombstone** (`hold_cancellation_intents`): handles the
--     "cancel arrives before create" subcase. cancel_by_token always
--     inserts a tombstone row. create_reservation_hold checks the
--     tombstone before insert; if found, the new row is born
--     'cancelled' and immediately invisible to overlap checks.
--     Postgres serializes the ordering, not the browser.
--
-- All changes are additive + backward compatible:
--   - client_token column is nullable
--   - cancel_reservation_hold(uuid) keeps same arg signature
--   - create_reservation_hold gets a new trailing default param

BEGIN;

-- ── Layer A: client_token column on reservation_holds ──
ALTER TABLE public.reservation_holds
  ADD COLUMN IF NOT EXISTS client_token uuid;

-- Partial unique index — only enforce uniqueness on non-null tokens
-- (existing rows have NULL and stay valid).
CREATE UNIQUE INDEX IF NOT EXISTS reservation_holds_client_token_unique
  ON public.reservation_holds (client_token)
  WHERE client_token IS NOT NULL;

-- ── Layer E: tombstone table for cancel-before-create race ──
CREATE TABLE IF NOT EXISTS public.hold_cancellation_intents (
  client_token uuid PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: service-role only. Tombstones are a server-internal mechanism.
ALTER TABLE public.hold_cancellation_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hold_cancellation_intents FROM PUBLIC;
REVOKE ALL ON public.hold_cancellation_intents FROM anon, authenticated;

-- ── Layer B: cancel_reservation_hold returns BOOLEAN ──
-- Drop old void-returning version first; signature has same args so
-- the GRANT call below restores access.
DROP FUNCTION IF EXISTS public.cancel_reservation_hold(uuid);

CREATE OR REPLACE FUNCTION public.cancel_reservation_hold(p_hold_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.reservation_holds
     SET status = 'cancelled'
   WHERE id = p_hold_id AND status IN ('active', 'converting');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_reservation_hold(uuid) TO service_role;

-- ── Layer A+E: NEW cancel_reservation_hold_by_token RPC ──
-- Always upserts a tombstone (idempotent on PK conflict). Then
-- attempts to UPDATE any existing matching hold. Order matters:
-- tombstone first means a racing create() that's still in flight
-- will see the tombstone when it checks.
CREATE OR REPLACE FUNCTION public.cancel_reservation_hold_by_token(p_client_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_client_token IS NULL THEN
    RETURN false;
  END IF;

  -- Tombstone first (cancel-before-create case). Idempotent on PK.
  INSERT INTO public.hold_cancellation_intents (client_token)
  VALUES (p_client_token)
  ON CONFLICT (client_token) DO NOTHING;

  -- Then try to flip an existing hold (cancel-after-create case).
  UPDATE public.reservation_holds
     SET status = 'cancelled'
   WHERE client_token = p_client_token
     AND status IN ('active', 'converting');
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN v_rows > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_reservation_hold_by_token(uuid) TO service_role;

-- ── Layer A+C+E: rewrite create_reservation_hold ──
-- Changes vs prior version:
--   1. New trailing param p_client_token uuid DEFAULT NULL
--   2. p_hold_minutes DEFAULT changed 30 → 5 (unfilled-hold TTL)
--   3. Tombstone check BEFORE the expensive table-assignment work:
--      if a cancel intent exists for this client_token, insert a
--      minimal 'cancelled' row and return without doing overlap
--      checks. The row never blocks anything.
--   4. Persist client_token on the row
--
-- Drop with exact signature first to allow signature change.
DROP FUNCTION IF EXISTS public.create_reservation_hold(
  uuid, uuid, timestamptz, integer, integer, text, text, uuid, uuid, text, text, text, uuid, uuid, text, integer
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
  p_hold_minutes       integer DEFAULT 5,
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

  -- ── Tombstone fast-path (race fix) ──
  -- If the client already requested cancel for this token (e.g. user
  -- navigated away during this POST and the cancel beacon arrived
  -- first), insert the row born-cancelled and return without doing
  -- any overlap/table work. The row never blocks anyone.
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
          -- Duplicate client_token: a prior call for the same token
          -- already inserted. Return the existing row's id.
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

  -- Table assignment.
  v_table_ids := public.find_available_table_group(
    p_restaurant_id,
    p_reserved_at,
    p_party_size,
    v_turn
  );
  IF COALESCE(array_length(v_table_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'no_table' USING ERRCODE = 'P0001';
  END IF;

  -- Re-check tombstone immediately before INSERT to close the race
  -- where the cancel arrived AFTER the first tombstone check but
  -- BEFORE the INSERT. Cheap query, indexed on PK.
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
      -- Same client_token already inserted (idempotent retry).
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

-- ── Layer C: update_reservation_hold_diner extends TTL to 30 min ──
-- When the diner fills in name/email/phone, they've signaled real
-- intent. Bump expires_at so they get the full 30-min checkout window.
-- Uses GREATEST so we never shorten an already-long TTL (no-op if the
-- caller already has more time than 30 min remaining).
--
-- Also: extend_reservation_hold's cap (created_at + 35 min) interacts
-- safely here — 5-min initial + 30-min bump = 35-min max, within cap.
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
  v_new_expires timestamptz;
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

  -- Extend TTL: diner has committed identity, give them 30 full mins
  -- to checkout. GREATEST so we never shorten an already-long expiry.
  v_new_expires := GREATEST(v_hold.expires_at, now() + interval '30 minutes');

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
           seating_preference = COALESCE(NULLIF(trim(COALESCE(p_seating_preference, '')), ''), seating_preference),
           expires_at         = v_new_expires
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

-- Also bump extend_reservation_hold's hard cap from created_at+35min
-- to created_at+60min so a diner who attached identity at minute 4
-- can heartbeat their way through a 30-min checkout (created+4 + 30
-- = created+34, but if they linger to created+40 they need headroom).
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

-- ── Cron: prune old tombstones (idempotent re-schedule) ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cenaiva_prune_hold_intents') THEN
    PERFORM cron.unschedule('cenaiva_prune_hold_intents');
  END IF;
END;
$$;

SELECT cron.schedule(
  'cenaiva_prune_hold_intents',
  '*/15 * * * *',
  $cron$
    DELETE FROM public.hold_cancellation_intents
    WHERE requested_at < now() - interval '1 hour'
  $cron$
);

COMMIT;
