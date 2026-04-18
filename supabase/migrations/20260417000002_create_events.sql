-- events table already exists with name/date/start_time/end_time schema
-- just add the theme column used by AI suggestions
ALTER TABLE events ADD COLUMN IF NOT EXISTS theme TEXT;
