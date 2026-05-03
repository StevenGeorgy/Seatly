INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-media',
  'event-media',
  true,
  20971520,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/heic',
    'image/heif',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Dashboard managers upload event media'
  ) THEN
    CREATE POLICY "Dashboard managers upload event media"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'event-media'
        AND EXISTS (
          SELECT 1
          FROM user_restaurant_roles urr
          WHERE urr.user_id = auth.uid()
            AND urr.role IN ('owner', 'manager')
            AND name LIKE (urr.restaurant_id::text || '/%')
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Dashboard managers update event media'
  ) THEN
    CREATE POLICY "Dashboard managers update event media"
      ON storage.objects FOR UPDATE
      TO authenticated
      USING (
        bucket_id = 'event-media'
        AND EXISTS (
          SELECT 1
          FROM user_restaurant_roles urr
          WHERE urr.user_id = auth.uid()
            AND urr.role IN ('owner', 'manager')
            AND name LIKE (urr.restaurant_id::text || '/%')
        )
      )
      WITH CHECK (
        bucket_id = 'event-media'
        AND EXISTS (
          SELECT 1
          FROM user_restaurant_roles urr
          WHERE urr.user_id = auth.uid()
            AND urr.role IN ('owner', 'manager')
            AND name LIKE (urr.restaurant_id::text || '/%')
        )
      );
  END IF;
END $$;
