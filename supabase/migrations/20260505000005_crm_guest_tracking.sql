-- CRM guest tracking uses one canonical diner profile per restaurant and
-- calculates visits from attended reservations whose dining window has ended.

CREATE OR REPLACE FUNCTION public.crm_normalized_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(lower(btrim(COALESCE(p_email, ''))), '');
$$;

CREATE OR REPLACE FUNCTION public.crm_normalized_phone(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH digits AS (
    SELECT regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g') AS value
  )
  SELECT CASE
    WHEN value = '' THEN NULL
    WHEN length(value) = 11 AND left(value, 1) = '1' THEN substring(value FROM 2)
    ELSE value
  END
  FROM digits;
$$;

CREATE INDEX IF NOT EXISTS idx_guests_restaurant_profile_canonical
  ON public.guests (restaurant_id, user_profile_id)
  WHERE user_profile_id IS NOT NULL AND duplicate_of IS NULL;

CREATE INDEX IF NOT EXISTS idx_guests_restaurant_normalized_email
  ON public.guests (restaurant_id, public.crm_normalized_email(email))
  WHERE public.crm_normalized_email(email) IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_guests_restaurant_normalized_phone
  ON public.guests (restaurant_id, public.crm_normalized_phone(phone))
  WHERE public.crm_normalized_phone(phone) IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_segment_for_guest(
  p_is_blocked boolean,
  p_total_visits integer
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_is_blocked, false) THEN 'blocked'
    WHEN COALESCE(p_total_visits, 0) >= 20 THEN 'vip'
    WHEN COALESCE(p_total_visits, 0) >= 8 THEN 'loyalty'
    WHEN COALESCE(p_total_visits, 0) >= 2 THEN 'returning'
    ELSE 'new'
  END;
$$;

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  data jsonb DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  sent_push boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_restaurant_created
  ON public.notifications (restaurant_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'notifications_select_own'
  ) THEN
    CREATE POLICY notifications_select_own
      ON public.notifications FOR SELECT
      TO authenticated
      USING (user_id = public.current_profile_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'notifications_mark_read_own'
  ) THEN
    CREATE POLICY notifications_mark_read_own
      ON public.notifications FOR UPDATE
      TO authenticated
      USING (user_id = public.current_profile_id())
      WITH CHECK (user_id = public.current_profile_id());
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.crm_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  source_type text NOT NULL CHECK (source_type IN ('event', 'promotion')),
  source_id uuid NOT NULL,
  target_segments text[] NOT NULL,
  title text NOT NULL,
  body text,
  route text NOT NULL,
  target_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_campaigns_restaurant_created
  ON public.crm_campaigns (restaurant_id, created_at DESC);

ALTER TABLE public.crm_campaigns ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'crm_campaigns'
      AND policyname = 'crm_campaigns_select_owner_manager'
  ) THEN
    CREATE POLICY crm_campaigns_select_owner_manager
      ON public.crm_campaigns FOR SELECT
      TO authenticated
      USING (public.staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager']));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.crm_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.crm_campaigns(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('sent', 'skipped')),
  skip_reason text,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_campaign_recipients_campaign
  ON public.crm_campaign_recipients (campaign_id);

CREATE INDEX IF NOT EXISTS idx_crm_campaign_recipients_guest
  ON public.crm_campaign_recipients (restaurant_id, guest_id);

ALTER TABLE public.crm_campaign_recipients ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'crm_campaign_recipients'
      AND policyname = 'crm_campaign_recipients_select_owner_manager'
  ) THEN
    CREATE POLICY crm_campaign_recipients_select_owner_manager
      ON public.crm_campaign_recipients FOR SELECT
      TO authenticated
      USING (public.staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager']));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.canonical_guest_id(
  p_restaurant_id uuid,
  p_user_profile_id uuid DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := public.crm_normalized_email(p_email);
  v_phone text := public.crm_normalized_phone(p_phone);
  v_guest_id uuid;
BEGIN
  IF p_restaurant_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_user_profile_id IS NOT NULL THEN
    SELECT COALESCE(g.duplicate_of, g.id)
    INTO v_guest_id
    FROM public.guests g
    WHERE g.restaurant_id = p_restaurant_id
      AND g.user_profile_id = p_user_profile_id
    ORDER BY (g.duplicate_of IS NULL) DESC, g.created_at ASC, g.id ASC
    LIMIT 1;

    IF v_guest_id IS NOT NULL THEN
      RETURN v_guest_id;
    END IF;
  END IF;

  IF v_email IS NOT NULL THEN
    SELECT COALESCE(g.duplicate_of, g.id)
    INTO v_guest_id
    FROM public.guests g
    WHERE g.restaurant_id = p_restaurant_id
      AND public.crm_normalized_email(g.email) = v_email
    ORDER BY
      (p_user_profile_id IS NOT NULL AND g.user_profile_id = p_user_profile_id) DESC,
      (g.user_profile_id IS NOT NULL) DESC,
      (g.duplicate_of IS NULL) DESC,
      g.created_at ASC,
      g.id ASC
    LIMIT 1;

    IF v_guest_id IS NOT NULL THEN
      RETURN v_guest_id;
    END IF;
  END IF;

  IF v_phone IS NOT NULL THEN
    SELECT COALESCE(g.duplicate_of, g.id)
    INTO v_guest_id
    FROM public.guests g
    WHERE g.restaurant_id = p_restaurant_id
      AND public.crm_normalized_phone(g.phone) = v_phone
    ORDER BY
      (p_user_profile_id IS NOT NULL AND g.user_profile_id = p_user_profile_id) DESC,
      (g.user_profile_id IS NOT NULL) DESC,
      (g.duplicate_of IS NULL) DESC,
      g.created_at ASC,
      g.id ASC
    LIMIT 1;
  END IF;

  RETURN v_guest_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_guest_rows(p_restaurant_id uuid)
RETURNS TABLE (
  id uuid,
  restaurant_id uuid,
  user_profile_id uuid,
  full_name text,
  email text,
  phone text,
  birthday date,
  anniversary date,
  tags text[],
  dietary_restrictions text[],
  allergies text[],
  seating_preference text,
  noise_preference text,
  favourite_dishes text[],
  favourite_drinks text[],
  internal_notes text,
  total_visits integer,
  total_spend numeric,
  average_spend_per_visit numeric,
  no_show_count integer,
  cancellation_count integer,
  is_vip boolean,
  is_blocked boolean,
  loyalty_points_balance integer,
  loyalty_tier text,
  email_opt_in boolean,
  sms_opt_in boolean,
  acquisition_source text,
  last_contacted_at timestamptz,
  last_visit_at timestamptz,
  first_visit_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_staff_role(p_restaurant_id, ARRAY['owner', 'manager']);

  RETURN QUERY
  WITH canonicalized AS (
    SELECT
      g.*,
      COALESCE(g.duplicate_of, match_guest.id, g.id) AS canonical_id
    FROM public.guests g
    LEFT JOIN LATERAL (
      SELECT candidate.id
      FROM public.guests candidate
      WHERE candidate.restaurant_id = g.restaurant_id
        AND candidate.duplicate_of IS NULL
        AND (
          (g.user_profile_id IS NOT NULL AND candidate.user_profile_id = g.user_profile_id)
          OR (
            public.crm_normalized_email(g.email) IS NOT NULL
            AND public.crm_normalized_email(candidate.email) = public.crm_normalized_email(g.email)
          )
          OR (
            public.crm_normalized_phone(g.phone) IS NOT NULL
            AND public.crm_normalized_phone(candidate.phone) = public.crm_normalized_phone(g.phone)
          )
        )
      ORDER BY
        (g.user_profile_id IS NOT NULL AND candidate.user_profile_id = g.user_profile_id) DESC,
        (candidate.user_profile_id IS NOT NULL) DESC,
        candidate.created_at ASC,
        candidate.id ASC
      LIMIT 1
    ) match_guest ON true
    WHERE g.restaurant_id = p_restaurant_id
  ),
  member_stats AS (
    SELECT
      cg.canonical_id,
      (array_agg(cg.user_profile_id ORDER BY cg.created_at ASC, cg.id ASC) FILTER (WHERE cg.user_profile_id IS NOT NULL))[1] AS linked_user_profile_id,
      bool_or(COALESCE(cg.is_vip, false)) AS stored_is_vip,
      bool_or(COALESCE(cg.is_blocked, false)) AS stored_is_blocked,
      COALESCE(sum(COALESCE(cg.loyalty_points_balance, 0)), 0)::integer AS loyalty_points_balance
    FROM canonicalized cg
    GROUP BY cg.canonical_id
  ),
  reservation_stats AS (
    SELECT
      cg.canonical_id,
      count(*) FILTER (
        WHERE r.status IN ('seated', 'completed')
          AND r.reserved_at + make_interval(mins => COALESCE(r.duration_minutes, public.restaurant_turn_time_minutes(r.restaurant_id, r.shift_id), 90)) <= now()
      )::integer AS total_visits,
      min(r.reserved_at) FILTER (
        WHERE r.status IN ('seated', 'completed')
          AND r.reserved_at + make_interval(mins => COALESCE(r.duration_minutes, public.restaurant_turn_time_minutes(r.restaurant_id, r.shift_id), 90)) <= now()
      ) AS first_visit_at,
      max(r.reserved_at) FILTER (
        WHERE r.status IN ('seated', 'completed')
          AND r.reserved_at + make_interval(mins => COALESCE(r.duration_minutes, public.restaurant_turn_time_minutes(r.restaurant_id, r.shift_id), 90)) <= now()
      ) AS last_visit_at,
      count(*) FILTER (WHERE r.status = 'no_show')::integer AS no_show_count,
      count(*) FILTER (WHERE r.status = 'cancelled')::integer AS cancellation_count
    FROM canonicalized cg
    JOIN public.reservations r
      ON r.guest_id = cg.id
      AND r.restaurant_id = p_restaurant_id
    GROUP BY cg.canonical_id
  ),
  order_stats AS (
    SELECT
      cg.canonical_id,
      COALESCE(sum(COALESCE(o.total_amount, o.subtotal, 0)) FILTER (
        WHERE COALESCE(o.status, '') <> 'cancelled'
      ), 0)::numeric AS total_spend
    FROM canonicalized cg
    JOIN public.orders o
      ON o.guest_id = cg.id
      AND o.restaurant_id = p_restaurant_id
    GROUP BY cg.canonical_id
  )
  SELECT
    c.id,
    c.restaurant_id,
    COALESCE(c.user_profile_id, ms.linked_user_profile_id) AS user_profile_id,
    c.full_name,
    c.email,
    c.phone,
    c.birthday,
    c.anniversary,
    c.tags,
    c.dietary_restrictions,
    c.allergies,
    c.seating_preference,
    c.noise_preference,
    c.favourite_dishes,
    c.favourite_drinks,
    c.internal_notes,
    COALESCE(rs.total_visits, 0) AS total_visits,
    COALESCE(os.total_spend, 0)::numeric AS total_spend,
    CASE
      WHEN COALESCE(rs.total_visits, 0) > 0
        THEN round((COALESCE(os.total_spend, 0) / COALESCE(rs.total_visits, 1))::numeric, 2)
      ELSE NULL
    END AS average_spend_per_visit,
    COALESCE(rs.no_show_count, 0) AS no_show_count,
    COALESCE(rs.cancellation_count, 0) AS cancellation_count,
    COALESCE(ms.stored_is_vip, false) OR COALESCE(rs.total_visits, 0) >= 20 AS is_vip,
    COALESCE(ms.stored_is_blocked, false) AS is_blocked,
    COALESCE(ms.loyalty_points_balance, 0) AS loyalty_points_balance,
    c.loyalty_tier,
    c.email_opt_in,
    c.sms_opt_in,
    NULL::text AS acquisition_source,
    NULL::timestamptz AS last_contacted_at,
    rs.last_visit_at,
    rs.first_visit_at,
    c.created_at
  FROM member_stats ms
  JOIN public.guests c
    ON c.id = ms.canonical_id
  LEFT JOIN reservation_stats rs
    ON rs.canonical_id = ms.canonical_id
  LEFT JOIN order_stats os
    ON os.canonical_id = ms.canonical_id
  ORDER BY
    COALESCE(rs.total_visits, 0) DESC,
    rs.last_visit_at DESC NULLS LAST,
    c.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_staff_reservation(
  p_restaurant_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_party_size integer,
  p_reserved_at timestamptz,
  p_special_request text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_guest_id uuid;
  v_reservation_id uuid;
  v_table_ids uuid[];
  v_turn_minutes integer;
BEGIN
  v_role := public.require_staff_role(p_restaurant_id, ARRAY['owner', 'manager', 'server', 'host', 'staff']);
  v_turn_minutes := COALESCE(public.restaurant_turn_time_minutes(p_restaurant_id), 90);

  IF p_party_size IS NULL OR p_party_size < 1 THEN
    RAISE EXCEPTION 'Party size must be at least 1.';
  END IF;

  v_guest_id := public.canonical_guest_id(p_restaurant_id, NULL, p_guest_email, p_guest_phone);

  IF v_guest_id IS NULL THEN
    INSERT INTO public.guests (restaurant_id, full_name, phone, email)
    VALUES (
      p_restaurant_id,
      NULLIF(btrim(COALESCE(p_guest_name, '')), ''),
      NULLIF(btrim(COALESCE(p_guest_phone, '')), ''),
      public.crm_normalized_email(p_guest_email)
    )
    RETURNING id INTO v_guest_id;
  ELSE
    UPDATE public.guests
    SET
      full_name = COALESCE(NULLIF(btrim(COALESCE(p_guest_name, '')), ''), full_name),
      phone = COALESCE(NULLIF(btrim(COALESCE(p_guest_phone, '')), ''), phone),
      email = COALESCE(public.crm_normalized_email(p_guest_email), email)
    WHERE id = v_guest_id;
  END IF;

  INSERT INTO public.reservations (
    restaurant_id,
    guest_id,
    guest_full_name,
    guest_email,
    guest_phone,
    party_size,
    reserved_at,
    duration_minutes,
    special_request,
    status,
    confirmation_code,
    source,
    is_guest_checkout
  )
  VALUES (
    p_restaurant_id,
    v_guest_id,
    NULLIF(btrim(COALESCE(p_guest_name, '')), ''),
    public.crm_normalized_email(p_guest_email),
    NULLIF(btrim(COALESCE(p_guest_phone, '')), ''),
    p_party_size,
    p_reserved_at,
    v_turn_minutes,
    NULLIF(btrim(COALESCE(p_special_request, '')), ''),
    'confirmed',
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
    'dashboard',
    true
  )
  RETURNING id INTO v_reservation_id;

  v_table_ids := public.assign_reservation_tables(v_reservation_id, p_restaurant_id, p_reserved_at, p_party_size, v_turn_minutes);
  IF COALESCE(array_length(v_table_ids, 1), 0) = 0 THEN
    UPDATE public.reservations
    SET status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = 'No available table for party size.'
    WHERE id = v_reservation_id;
    RAISE EXCEPTION 'No available table can fit this party at that time.';
  END IF;

  PERFORM public.write_staff_audit_event(
    p_restaurant_id,
    'reservation.create',
    'reservation',
    v_reservation_id,
    '{}'::jsonb,
    jsonb_build_object(
      'party_size', p_party_size,
      'reserved_at', p_reserved_at,
      'duration_minutes', v_turn_minutes,
      'role', v_role
    )
  );

  RETURN v_reservation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_crm_campaign(
  p_restaurant_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_target_segments text[],
  p_title text,
  p_body text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id uuid;
  v_created_by uuid;
  v_route text;
  v_title text;
  v_body text;
  v_target_segments text[];
  v_target_count integer := 0;
  v_sent_count integer := 0;
  v_skipped_count integer := 0;
  v_guest record;
  v_notification_id uuid;
BEGIN
  PERFORM public.require_staff_role(p_restaurant_id, ARRAY['owner', 'manager']);

  IF p_source_type NOT IN ('event', 'promotion') THEN
    RAISE EXCEPTION 'Campaign source must be event or promotion.';
  END IF;

  v_target_segments := (
    SELECT ARRAY(
      SELECT DISTINCT segment
      FROM unnest(COALESCE(p_target_segments, ARRAY[]::text[])) AS selected_segments(segment)
      WHERE segment IN ('vip', 'loyalty', 'returning')
    )
  );

  IF COALESCE(array_length(v_target_segments, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Choose at least one target segment.';
  END IF;

  v_title := NULLIF(trim(p_title), '');
  v_body := NULLIF(trim(COALESCE(p_body, '')), '');

  IF v_title IS NULL THEN
    RAISE EXCEPTION 'Campaign title is required.';
  END IF;

  IF p_source_type = 'event' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.events
      WHERE id = p_source_id
        AND restaurant_id = p_restaurant_id
        AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Event not found for this restaurant.';
    END IF;
    v_route := '/deals?detail=event-' || p_source_id::text;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.promotions
      WHERE id = p_source_id
        AND restaurant_id = p_restaurant_id
        AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Promotion not found for this restaurant.';
    END IF;
    v_route := '/deals?detail=promotion-' || p_source_id::text;
  END IF;

  v_created_by := public.current_profile_id();

  INSERT INTO public.crm_campaigns (
    restaurant_id,
    created_by,
    source_type,
    source_id,
    target_segments,
    title,
    body,
    route
  )
  VALUES (
    p_restaurant_id,
    v_created_by,
    p_source_type,
    p_source_id,
    v_target_segments,
    v_title,
    v_body,
    v_route
  )
  RETURNING id INTO v_campaign_id;

  FOR v_guest IN
    SELECT
      g.id,
      g.user_profile_id,
      public.crm_segment_for_guest(g.is_blocked, g.total_visits) AS segment
    FROM public.crm_guest_rows(p_restaurant_id) g
    WHERE public.crm_segment_for_guest(g.is_blocked, g.total_visits) = ANY(v_target_segments)
  LOOP
    v_target_count := v_target_count + 1;

    IF v_guest.user_profile_id IS NULL THEN
      v_skipped_count := v_skipped_count + 1;
      INSERT INTO public.crm_campaign_recipients (
        campaign_id,
        restaurant_id,
        guest_id,
        user_id,
        status,
        skip_reason
      )
      VALUES (
        v_campaign_id,
        p_restaurant_id,
        v_guest.id,
        NULL,
        'skipped',
        'missing_user_profile'
      );
    ELSE
      INSERT INTO public.notifications (
        user_id,
        restaurant_id,
        type,
        title,
        body,
        data,
        sent_push
      )
      VALUES (
        v_guest.user_profile_id,
        p_restaurant_id,
        'crm_campaign',
        v_title,
        v_body,
        jsonb_build_object(
          'route', v_route,
          'campaignId', v_campaign_id,
          'sourceType', p_source_type,
          'sourceId', p_source_id,
          'segment', v_guest.segment
        ),
        false
      )
      RETURNING id INTO v_notification_id;

      v_sent_count := v_sent_count + 1;
      INSERT INTO public.crm_campaign_recipients (
        campaign_id,
        restaurant_id,
        guest_id,
        user_id,
        status,
        notification_id
      )
      VALUES (
        v_campaign_id,
        p_restaurant_id,
        v_guest.id,
        v_guest.user_profile_id,
        'sent',
        v_notification_id
      );
    END IF;
  END LOOP;

  UPDATE public.crm_campaigns
  SET
    target_count = v_target_count,
    sent_count = v_sent_count,
    skipped_count = v_skipped_count
  WHERE id = v_campaign_id;

  RETURN jsonb_build_object(
    'campaign_id', v_campaign_id,
    'target_count', v_target_count,
    'sent_count', v_sent_count,
    'skipped_count', v_skipped_count
  );
END;
$$;

DO $$
DECLARE
  v_duplicate record;
BEGIN
  FOR v_duplicate IN
    WITH mark_guests AS (
      SELECT g.*
      FROM public.guests g
      JOIN public.restaurants r
        ON r.id = g.restaurant_id
      WHERE public.crm_normalized_email(g.email) = 'markhabbi2@gmail.com'
        AND lower(r.name) = 'echoria'
    ),
    canonical AS (
      SELECT restaurant_id, id AS canonical_id
      FROM (
        SELECT
          mg.*,
          row_number() OVER (
            PARTITION BY mg.restaurant_id
            ORDER BY
              (mg.user_profile_id IS NOT NULL) DESC,
              (mg.duplicate_of IS NULL) DESC,
              mg.created_at ASC,
              mg.id ASC
          ) AS rn
        FROM mark_guests mg
      ) ranked
      WHERE rn = 1
    )
    SELECT
      mg.restaurant_id,
      mg.id AS duplicate_id,
      c.canonical_id
    FROM mark_guests mg
    JOIN canonical c
      ON c.restaurant_id = mg.restaurant_id
    WHERE mg.id <> c.canonical_id
  LOOP
    UPDATE public.reservations
    SET guest_id = v_duplicate.canonical_id
    WHERE restaurant_id = v_duplicate.restaurant_id
      AND guest_id = v_duplicate.duplicate_id;

    UPDATE public.orders
    SET guest_id = v_duplicate.canonical_id
    WHERE restaurant_id = v_duplicate.restaurant_id
      AND guest_id = v_duplicate.duplicate_id;

    IF to_regclass('public.crm_campaign_recipients') IS NOT NULL THEN
      UPDATE public.crm_campaign_recipients
      SET guest_id = v_duplicate.canonical_id
      WHERE restaurant_id = v_duplicate.restaurant_id
        AND guest_id = v_duplicate.duplicate_id;
    END IF;

    IF to_regclass('public.communication_log') IS NOT NULL THEN
      EXECUTE
        'UPDATE public.communication_log SET guest_id = $1 WHERE restaurant_id = $2 AND guest_id = $3'
      USING v_duplicate.canonical_id, v_duplicate.restaurant_id, v_duplicate.duplicate_id;
    END IF;

    UPDATE public.guests
    SET duplicate_of = v_duplicate.canonical_id
    WHERE id = v_duplicate.duplicate_id
      AND duplicate_of IS DISTINCT FROM v_duplicate.canonical_id;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.crm_normalized_email(text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_normalized_phone(text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_segment_for_guest(boolean, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.canonical_guest_id(uuid, uuid, text, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_guest_rows(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_staff_reservation(uuid, text, text, text, integer, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.send_crm_campaign(uuid, text, uuid, text[], text, text) TO authenticated, service_role;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;
GRANT SELECT ON public.crm_campaigns TO authenticated;
GRANT SELECT ON public.crm_campaign_recipients TO authenticated;
