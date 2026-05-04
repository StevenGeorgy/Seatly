-- Campaign-only offers stay active/bookable without appearing in public discovery.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS events_public_active_idx
  ON events (is_active, is_private, date, end_date);

CREATE INDEX IF NOT EXISTS promotions_public_active_idx
  ON promotions (is_active, is_private, ends_at);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'promotions'
      AND policyname = 'Public read active promotions'
  ) THEN
    ALTER POLICY "Public read active promotions"
      ON promotions
      USING (
        is_active = TRUE
        AND COALESCE(is_private, FALSE) = FALSE
        AND (max_uses IS NULL OR current_uses < max_uses)
        AND (
          (is_recurring = FALSE AND (ends_at IS NULL OR ends_at > NOW()))
          OR
          (is_recurring = TRUE AND (recurrence_end_at IS NULL OR recurrence_end_at > NOW()))
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'events'
      AND policyname = 'events_public_read_active_non_private'
  ) THEN
    CREATE POLICY events_public_read_active_non_private
      ON events FOR SELECT
      USING (
        is_active = TRUE
        AND COALESCE(is_private, FALSE) = FALSE
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'events'
      AND policyname = 'events_owner_manager_manage'
  ) THEN
    CREATE POLICY events_owner_manager_manage
      ON events FOR ALL
      TO authenticated
      USING (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager']))
      WITH CHECK (staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager']));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'events'
      AND policyname = 'events_campaign_recipients_read'
  ) THEN
    CREATE POLICY events_campaign_recipients_read
      ON events FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM crm_campaign_recipients recipient
          JOIN crm_campaigns campaign ON campaign.id = recipient.campaign_id
          WHERE recipient.user_id = current_profile_id()
            AND recipient.status = 'sent'
            AND campaign.source_type = 'event'
            AND campaign.source_id = events.id
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'promotions'
      AND policyname = 'promotions_campaign_recipients_read'
  ) THEN
    CREATE POLICY promotions_campaign_recipients_read
      ON promotions FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM crm_campaign_recipients recipient
          JOIN crm_campaigns campaign ON campaign.id = recipient.campaign_id
          WHERE recipient.user_id = current_profile_id()
            AND recipient.status = 'sent'
            AND campaign.source_type = 'promotion'
            AND campaign.source_id = promotions.id
        )
      );
  END IF;
END $$;
