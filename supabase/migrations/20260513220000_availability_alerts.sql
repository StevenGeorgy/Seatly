-- Availability alerts ("Notify Me") — one-shot subscriptions a diner sets
-- when a restaurant/event has no slots at their preferred time. When a
-- matching slot frees up (cancel-reservation / modify-reservation), the
-- edge function calls a match_* RPC below; the RPC atomically claims any
-- matching active alerts and writes notifications via the existing
-- public.notifications table (type = 'slot_opened').
--
-- Mirrors OpenTable/Resy's "Notify Me" pattern (verified via web research):
-- restaurant never disappears from search; instead the action area gives
-- the diner a way to be told when something opens.

CREATE TABLE IF NOT EXISTS public.availability_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  date date,
  party_size integer NOT NULL CHECK (party_size BETWEEN 1 AND 40),
  preferred_time time,
  window_minutes integer NOT NULL DEFAULT 120 CHECK (window_minutes BETWEEN 15 AND 480),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','fulfilled','cancelled','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  fulfilled_at timestamptz,
  fulfilled_notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  -- Restaurant alerts and event alerts are mutually exclusive. Date and
  -- preferred_time make sense only for restaurant alerts (events already
  -- have a fixed date/time).
  CONSTRAINT availability_alerts_target_xor CHECK (
    (restaurant_id IS NOT NULL AND event_id IS NULL AND date IS NOT NULL)
    OR
    (event_id IS NOT NULL AND restaurant_id IS NULL AND date IS NULL AND preferred_time IS NULL)
  )
);

-- Hot-path indexes for the match RPCs (only active alerts matter).
CREATE INDEX IF NOT EXISTS idx_avail_alerts_rest_match
  ON public.availability_alerts (restaurant_id, date, party_size)
  WHERE status = 'active' AND restaurant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_avail_alerts_event_match
  ON public.availability_alerts (event_id)
  WHERE status = 'active' AND event_id IS NOT NULL;

-- User-facing "My alerts" listing.
CREATE INDEX IF NOT EXISTS idx_avail_alerts_user_status
  ON public.availability_alerts (user_id, status, created_at DESC);

-- Block duplicate active alerts for the same (user, target, date, party).
-- The sentinel UUIDs/date make COALESCE work cleanly inside a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_avail_alerts_active_per_target
  ON public.availability_alerts (
    user_id,
    COALESCE(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(event_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(date, '1900-01-01'::date),
    party_size
  )
  WHERE status = 'active';

-- ───────────────────────────── RLS ─────────────────────────────────────────

ALTER TABLE public.availability_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS avail_alerts_select_own ON public.availability_alerts;
CREATE POLICY avail_alerts_select_own ON public.availability_alerts
  FOR SELECT TO authenticated
  USING (user_id = public.current_profile_id());

DROP POLICY IF EXISTS avail_alerts_update_own ON public.availability_alerts;
CREATE POLICY avail_alerts_update_own ON public.availability_alerts
  FOR UPDATE TO authenticated
  USING (user_id = public.current_profile_id())
  WITH CHECK (user_id = public.current_profile_id() AND status IN ('active','cancelled'));

-- No INSERT policy on purpose — INSERTs go through the SECURITY DEFINER
-- RPC `create_availability_alert` below. service_role bypasses RLS so the
-- match_* RPCs (called from edge functions) can write `status='fulfilled'`.

-- Add to realtime publication so the "My alerts" tab updates live as the
-- backend fan-out flips alerts to fulfilled.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'availability_alerts'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.availability_alerts';
  END IF;
END $$;

-- ─────────────────────────── RPCs ──────────────────────────────────────────

-- `create_availability_alert` — called from the customer's NotifyMeButton.
-- Two argument shapes; exactly one of p_restaurant_id / p_event_id must be
-- non-null. Returns { ok, alert_id, error }. Friendly duplicate error rather
-- than an unhandled 23505 the UI would have to introspect.
CREATE OR REPLACE FUNCTION public.create_availability_alert(
  p_restaurant_id uuid,
  p_event_id      uuid,
  p_date          date,
  p_party_size    integer,
  p_preferred_time time,
  p_window_minutes integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid := public.current_profile_id();
  v_now        timestamptz := now();
  v_tz         text;
  v_expires_at timestamptz;
  v_event_row  public.events%ROWTYPE;
  v_new_id     uuid;
  v_window     integer := COALESCE(p_window_minutes, 120);
BEGIN
  IF v_profile_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF p_party_size IS NULL OR p_party_size < 1 OR p_party_size > 40 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_party_size');
  END IF;

  IF v_window < 15 OR v_window > 480 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_window');
  END IF;

  -- Validate XOR(restaurant, event) and compute expires_at.
  IF p_restaurant_id IS NOT NULL AND p_event_id IS NULL THEN
    IF p_date IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'date_required');
    END IF;
    -- Pull restaurant timezone for an accurate expiry boundary.
    SELECT COALESCE(timezone, 'America/Toronto') INTO v_tz
      FROM public.restaurants WHERE id = p_restaurant_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'restaurant_not_found');
    END IF;
    -- Reject past dates (in restaurant tz).
    IF p_date < (v_now AT TIME ZONE v_tz)::date THEN
      RETURN jsonb_build_object('ok', false, 'error', 'date_in_past');
    END IF;
    -- Expire at end-of-day on the watched date (restaurant local).
    v_expires_at := ((p_date + INTERVAL '1 day')::text || ' 00:00:00')::timestamp AT TIME ZONE v_tz;

  ELSIF p_event_id IS NOT NULL AND p_restaurant_id IS NULL THEN
    SELECT * INTO v_event_row FROM public.events WHERE id = p_event_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'event_not_found');
    END IF;
    -- Use the event's last day + a small buffer.
    SELECT COALESCE(r.timezone, 'America/Toronto') INTO v_tz
      FROM public.restaurants r WHERE r.id = v_event_row.restaurant_id;
    v_expires_at := (
      (COALESCE(v_event_row.end_date, v_event_row.date) + INTERVAL '1 day')::text || ' 00:00:00'
    )::timestamp AT TIME ZONE COALESCE(v_tz, 'America/Toronto');
    IF v_expires_at <= v_now THEN
      RETURN jsonb_build_object('ok', false, 'error', 'event_in_past');
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_target');
  END IF;

  BEGIN
    INSERT INTO public.availability_alerts (
      user_id, restaurant_id, event_id, date, party_size, preferred_time,
      window_minutes, expires_at
    )
    VALUES (
      v_profile_id, p_restaurant_id, p_event_id,
      CASE WHEN p_event_id IS NOT NULL THEN NULL ELSE p_date END,
      p_party_size,
      CASE WHEN p_event_id IS NOT NULL THEN NULL ELSE p_preferred_time END,
      v_window, v_expires_at
    )
    RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'duplicate');
  END;

  RETURN jsonb_build_object('ok', true, 'alert_id', v_new_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_availability_alert(uuid, uuid, date, integer, time, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_availability_alert(uuid, uuid, date, integer, time, integer) TO authenticated, service_role;

-- `match_availability_alerts_for_restaurant` — called from the
-- cancel-reservation and modify-reservation edge functions whenever a slot
-- frees up. Atomically claims matching alerts (sets status='fulfilled' via
-- a row-locked UPDATE), then inserts notifications. The atomic claim
-- guarantees one-shot semantics under concurrent cancellations.
--
-- Matching rule: same date in restaurant timezone, party_size <= freed
-- party + small headroom (we accept smaller-party alerts on bigger-table
-- freed slots), preferred_time within ±window_minutes of the freed time
-- (NULL preferred_time matches anything that day).
CREATE OR REPLACE FUNCTION public.match_availability_alerts_for_restaurant(
  p_restaurant_id      uuid,
  p_freed_at           timestamptz,
  p_freed_party_size   integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz          text;
  v_freed_date  date;
  v_freed_time  time;
  v_count       integer := 0;
BEGIN
  SELECT COALESCE(timezone, 'America/Toronto') INTO v_tz
    FROM public.restaurants WHERE id = p_restaurant_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_freed_date := (p_freed_at AT TIME ZONE v_tz)::date;
  v_freed_time := (p_freed_at AT TIME ZONE v_tz)::time;

  WITH candidates AS (
    SELECT aa.*
    FROM public.availability_alerts aa
    WHERE aa.status = 'active'
      AND aa.restaurant_id = p_restaurant_id
      AND aa.date = v_freed_date
      AND aa.party_size <= COALESCE(p_freed_party_size, aa.party_size) + 2
      AND (aa.expires_at IS NULL OR aa.expires_at > now())
      AND (
        aa.preferred_time IS NULL
        OR ABS(EXTRACT(EPOCH FROM (v_freed_time - aa.preferred_time))) <= aa.window_minutes * 60
      )
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.availability_alerts aa
       SET status = 'fulfilled', fulfilled_at = now()
      FROM candidates c
     WHERE aa.id = c.id
       AND aa.status = 'active'
    RETURNING aa.*
  ),
  inserted AS (
    INSERT INTO public.notifications (user_id, restaurant_id, type, title, body, data)
    SELECT
      c.user_id,
      c.restaurant_id,
      'slot_opened',
      'Table just opened at ' || r.name,
      to_char(c.date, 'Mon DD') ||
        ' for ' || c.party_size ||
        COALESCE(' near ' || to_char(c.preferred_time, 'HH12:MIam'), '') ||
        '. Tap to book.',
      jsonb_build_object(
        'restaurant_id', c.restaurant_id,
        'slug', r.slug,
        'date', c.date,
        'preferred_time', c.preferred_time,
        'window_minutes', c.window_minutes,
        'party_size', c.party_size,
        'alert_id', c.id,
        'route', '/' || r.slug ||
                 '?date=' || c.date::text ||
                 COALESCE('&time=' || to_char(c.preferred_time, 'HH24:MI'), '') ||
                 '&party=' || c.party_size::text
      )
    FROM claimed c
    JOIN public.restaurants r ON r.id = c.restaurant_id
    RETURNING id, (SELECT id FROM claimed cc WHERE cc.user_id = notifications.user_id LIMIT 1) AS alert_id
  )
  SELECT count(*) INTO v_count FROM inserted;

  -- Best-effort backfill of fulfilled_notification_id. We pair each
  -- inserted notification to a single fulfilled alert; for v1 the one-shot
  -- semantic + same-user matching is sufficient. (If a user has multiple
  -- alerts that fulfill simultaneously, the link is approximate; the
  -- notification itself carries `data.alert_id` exactly.)
  UPDATE public.availability_alerts aa
     SET fulfilled_notification_id = n.id
    FROM public.notifications n
   WHERE aa.fulfilled_at IS NOT NULL
     AND aa.fulfilled_notification_id IS NULL
     AND n.type = 'slot_opened'
     AND (n.data->>'alert_id')::uuid = aa.id
     AND n.created_at > now() - INTERVAL '30 seconds';

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.match_availability_alerts_for_restaurant(uuid, timestamptz, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_availability_alerts_for_restaurant(uuid, timestamptz, integer) TO service_role;

-- `match_availability_alerts_for_event` — same shape, simpler matching
-- (events have fixed time so we just look at active alerts for the
-- event_id). Called when an event-linked reservation is cancelled (which
-- decrements events.tickets_sold via the trigger in the next migration).
CREATE OR REPLACE FUNCTION public.match_availability_alerts_for_event(
  p_event_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH candidates AS (
    SELECT aa.*
    FROM public.availability_alerts aa
    WHERE aa.status = 'active'
      AND aa.event_id = p_event_id
      AND (aa.expires_at IS NULL OR aa.expires_at > now())
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.availability_alerts aa
       SET status = 'fulfilled', fulfilled_at = now()
      FROM candidates c
     WHERE aa.id = c.id AND aa.status = 'active'
    RETURNING aa.*
  ),
  inserted AS (
    INSERT INTO public.notifications (user_id, restaurant_id, type, title, body, data)
    SELECT
      c.user_id,
      e.restaurant_id,
      'slot_opened',
      'Seats just opened at ' || e.name,
      c.party_size || ' seat' ||
        CASE WHEN c.party_size = 1 THEN '' ELSE 's' END ||
        ' on ' || to_char(e.date, 'Mon DD') || '. Tap to book.',
      jsonb_build_object(
        'event_id', c.event_id,
        'restaurant_id', e.restaurant_id,
        'party_size', c.party_size,
        'alert_id', c.id,
        'route', '/deals?event=' || c.event_id::text ||
                 '&party=' || c.party_size::text
      )
    FROM claimed c
    JOIN public.events e ON e.id = c.event_id
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM inserted;

  UPDATE public.availability_alerts aa
     SET fulfilled_notification_id = n.id
    FROM public.notifications n
   WHERE aa.fulfilled_at IS NOT NULL
     AND aa.fulfilled_notification_id IS NULL
     AND n.type = 'slot_opened'
     AND (n.data->>'alert_id')::uuid = aa.id
     AND n.created_at > now() - INTERVAL '30 seconds';

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.match_availability_alerts_for_event(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_availability_alerts_for_event(uuid) TO service_role;

-- `cancel_availability_alert` — diner-side dismiss from "My alerts" tab.
CREATE OR REPLACE FUNCTION public.cancel_availability_alert(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid := public.current_profile_id();
  v_rows       integer;
BEGIN
  IF v_profile_id IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.availability_alerts
     SET status = 'cancelled'
   WHERE id = p_id
     AND user_id = v_profile_id
     AND status = 'active';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_availability_alert(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_availability_alert(uuid) TO authenticated, service_role;

COMMENT ON TABLE public.availability_alerts IS
  'Notify Me — one-shot availability subscriptions. Active rows are matched by match_availability_alerts_for_restaurant/event RPCs called from cancel-reservation and modify-reservation edge functions when a slot frees up.';
