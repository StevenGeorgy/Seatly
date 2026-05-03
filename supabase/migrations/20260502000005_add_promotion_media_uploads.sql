ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS media_type TEXT CHECK (media_type IS NULL OR media_type IN ('image', 'pdf')),
  ADD COLUMN IF NOT EXISTS media_name TEXT;
