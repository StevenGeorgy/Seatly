CREATE TABLE IF NOT EXISTS ai_suggestions (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id     UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  suggestion_type   TEXT NOT NULL CHECK (suggestion_type IN ('menu_item', 'menu_item_update', 'promotion', 'event')),
  target_entity_id  UUID,
  title             TEXT NOT NULL,
  summary           TEXT,
  rationale         TEXT,
  payload           JSONB NOT NULL DEFAULT '{}',
  applied_at        TIMESTAMPTZ,
  applied_entity_id UUID,
  dismissed_at      TIMESTAMPTZ,
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_suggestions_restaurant_open_idx
  ON ai_suggestions (restaurant_id)
  WHERE applied_at IS NULL AND dismissed_at IS NULL;

ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage ai_suggestions"
  ON ai_suggestions FOR ALL
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM user_restaurant_roles
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM user_restaurant_roles
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );
