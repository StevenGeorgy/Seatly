ALTER TABLE events
  ADD COLUMN IF NOT EXISTS end_date DATE;

CREATE INDEX IF NOT EXISTS events_date_range_idx
  ON events (date, end_date);
