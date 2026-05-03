ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS recurrence_frequency TEXT CHECK (
    recurrence_frequency IS NULL OR recurrence_frequency IN ('daily', 'weekly', 'monthly')
  ),
  ADD COLUMN IF NOT EXISTS recurrence_interval INTEGER NOT NULL DEFAULT 1 CHECK (recurrence_interval >= 1),
  ADD COLUMN IF NOT EXISTS recurrence_days INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS recurrence_end_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS promotions_recurrence_idx
  ON promotions (is_recurring, recurrence_end_at);

DROP POLICY IF EXISTS "Public read active promotions" ON promotions;

CREATE POLICY "Public read active promotions"
  ON promotions FOR SELECT
  USING (
    is_active = TRUE
    AND (max_uses IS NULL OR current_uses < max_uses)
    AND (
      (is_recurring = FALSE AND (ends_at IS NULL OR ends_at > NOW()))
      OR
      (is_recurring = TRUE AND (recurrence_end_at IS NULL OR recurrence_end_at > NOW()))
    )
  );
