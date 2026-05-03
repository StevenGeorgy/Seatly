ALTER TABLE events
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS media_type TEXT CHECK (media_type IS NULL OR media_type IN ('image', 'pdf')),
  ADD COLUMN IF NOT EXISTS media_name TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-media',
  'event-media',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read event media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'event-media');

CREATE POLICY "Owners upload event media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'event-media'
    AND (storage.foldername(name))[1] IN (
      SELECT restaurant_id::text
      FROM user_restaurant_roles
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );

CREATE POLICY "Owners update event media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'event-media'
    AND (storage.foldername(name))[1] IN (
      SELECT restaurant_id::text
      FROM user_restaurant_roles
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    bucket_id = 'event-media'
    AND (storage.foldername(name))[1] IN (
      SELECT restaurant_id::text
      FROM user_restaurant_roles
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );
