DROP POLICY IF EXISTS "Dashboard managers upload event media" ON storage.objects;
DROP POLICY IF EXISTS "Dashboard managers update event media" ON storage.objects;

CREATE POLICY "Dashboard managers upload event media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'event-media'
    AND EXISTS (
      SELECT 1
      FROM user_restaurant_roles urr
      JOIN user_profiles up ON up.id = urr.user_id
      WHERE up.auth_user_id = auth.uid()
        AND urr.role IN ('owner', 'manager')
        AND name LIKE (urr.restaurant_id::text || '/%')
    )
  );

CREATE POLICY "Dashboard managers update event media"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'event-media'
    AND EXISTS (
      SELECT 1
      FROM user_restaurant_roles urr
      JOIN user_profiles up ON up.id = urr.user_id
      WHERE up.auth_user_id = auth.uid()
        AND urr.role IN ('owner', 'manager')
        AND name LIKE (urr.restaurant_id::text || '/%')
    )
  )
  WITH CHECK (
    bucket_id = 'event-media'
    AND EXISTS (
      SELECT 1
      FROM user_restaurant_roles urr
      JOIN user_profiles up ON up.id = urr.user_id
      WHERE up.auth_user_id = auth.uid()
        AND urr.role IN ('owner', 'manager')
        AND name LIKE (urr.restaurant_id::text || '/%')
    )
  );
