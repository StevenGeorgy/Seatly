-- CRM campaigns deliver event/promotion notifications to linked customer profiles.
-- Staff call the SECURITY DEFINER RPC; browser clients cannot insert arbitrary notifications.

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  restaurant_id uuid REFERENCES restaurants(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  data jsonb DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  sent_push boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_restaurant_created
  ON notifications (restaurant_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'notifications_select_own'
  ) THEN
    CREATE POLICY notifications_select_own
      ON notifications FOR SELECT
      TO authenticated
      USING (user_id = current_profile_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'notifications_mark_read_own'
  ) THEN
    CREATE POLICY notifications_mark_read_own
      ON notifications FOR UPDATE
      TO authenticated
      USING (user_id = current_profile_id())
      WITH CHECK (user_id = current_profile_id());
  END IF;
END $$;

GRANT SELECT ON notifications TO authenticated;
GRANT UPDATE (is_read) ON notifications TO authenticated;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS crm_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  created_by uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
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
  ON crm_campaigns (restaurant_id, created_at DESC);

ALTER TABLE crm_campaigns ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'crm_campaigns'
      AND policyname = 'crm_campaigns_select_owner_manager'
  ) THEN
    CREATE POLICY crm_campaigns_select_owner_manager
      ON crm_campaigns FOR SELECT
      TO authenticated
      USING (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager']));
  END IF;
END $$;

GRANT SELECT ON crm_campaigns TO authenticated;

CREATE TABLE IF NOT EXISTS crm_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES crm_campaigns(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  user_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('sent', 'skipped')),
  skip_reason text,
  notification_id uuid REFERENCES notifications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_campaign_recipients_campaign
  ON crm_campaign_recipients (campaign_id);

CREATE INDEX IF NOT EXISTS idx_crm_campaign_recipients_guest
  ON crm_campaign_recipients (restaurant_id, guest_id);

ALTER TABLE crm_campaign_recipients ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'crm_campaign_recipients'
      AND policyname = 'crm_campaign_recipients_select_owner_manager'
  ) THEN
    CREATE POLICY crm_campaign_recipients_select_owner_manager
      ON crm_campaign_recipients FOR SELECT
      TO authenticated
      USING (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager']));
  END IF;
END $$;

GRANT SELECT ON crm_campaign_recipients TO authenticated;

CREATE OR REPLACE FUNCTION crm_segment_for_guest(
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

CREATE OR REPLACE FUNCTION send_crm_campaign(
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
  PERFORM require_staff_role(p_restaurant_id, ARRAY['owner', 'manager']);

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
      FROM events
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
      FROM promotions
      WHERE id = p_source_id
        AND restaurant_id = p_restaurant_id
        AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Promotion not found for this restaurant.';
    END IF;
    v_route := '/deals?detail=promotion-' || p_source_id::text;
  END IF;

  v_created_by := current_profile_id();

  INSERT INTO crm_campaigns (
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
      crm_segment_for_guest(g.is_blocked, g.total_visits) AS segment
    FROM guests g
    WHERE g.restaurant_id = p_restaurant_id
      AND crm_segment_for_guest(g.is_blocked, g.total_visits) = ANY(v_target_segments)
  LOOP
    v_target_count := v_target_count + 1;

    IF v_guest.user_profile_id IS NULL THEN
      v_skipped_count := v_skipped_count + 1;
      INSERT INTO crm_campaign_recipients (
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
      INSERT INTO notifications (
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
      INSERT INTO crm_campaign_recipients (
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

  UPDATE crm_campaigns
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

GRANT EXECUTE ON FUNCTION crm_segment_for_guest(boolean, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION send_crm_campaign(uuid, text, uuid, text[], text, text) TO authenticated, service_role;
