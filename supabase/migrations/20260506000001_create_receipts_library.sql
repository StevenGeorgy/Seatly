-- Receipts library: upload PDFs and images, optionally link to an expense or income entry.

CREATE TABLE IF NOT EXISTS receipts (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id      UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  uploaded_by        UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  expense_id         UUID REFERENCES expenses(id) ON DELETE SET NULL,
  transaction_type   TEXT CHECK (transaction_type IS NULL OR transaction_type IN ('expense','income')),
  file_path          TEXT NOT NULL,
  file_name          TEXT NOT NULL,
  file_type          TEXT NOT NULL CHECK (file_type IN ('image','pdf')),
  file_size          BIGINT,
  description        TEXT,
  receipt_date       DATE,
  amount             NUMERIC CHECK (amount IS NULL OR amount >= 0),
  currency           TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS receipts_restaurant_idx
  ON receipts (restaurant_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS receipts_expense_idx
  ON receipts (expense_id)
  WHERE deleted_at IS NULL;

ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners and managers manage receipts" ON receipts;
CREATE POLICY "Owners and managers manage receipts"
  ON receipts FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM user_restaurant_roles urr
      WHERE urr.restaurant_id = receipts.restaurant_id
        AND urr.role IN ('owner','manager')
        AND user_restaurant_role_row_is_mine(urr.user_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM user_restaurant_roles urr
      WHERE urr.restaurant_id = receipts.restaurant_id
        AND urr.role IN ('owner','manager')
        AND user_restaurant_role_row_is_mine(urr.user_id)
    )
  );

CREATE OR REPLACE FUNCTION update_receipts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS receipts_set_updated_at ON receipts;
CREATE TRIGGER receipts_set_updated_at
  BEFORE UPDATE ON receipts
  FOR EACH ROW EXECUTE FUNCTION update_receipts_updated_at();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'receipts',
  'receipts',
  false,
  10485760,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'image/avif',
    'application/pdf'
  ]
) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Dashboard managers read receipts" ON storage.objects;
CREATE POLICY "Dashboard managers read receipts"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND EXISTS (
      SELECT 1
      FROM user_restaurant_roles urr
      JOIN user_profiles up ON up.id = urr.user_id
      WHERE up.auth_user_id = auth.uid()
        AND urr.role IN ('owner','manager')
        AND name LIKE (urr.restaurant_id::text || '/%')
    )
  );

DROP POLICY IF EXISTS "Dashboard managers upload receipts" ON storage.objects;
CREATE POLICY "Dashboard managers upload receipts"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'receipts'
    AND EXISTS (
      SELECT 1
      FROM user_restaurant_roles urr
      JOIN user_profiles up ON up.id = urr.user_id
      WHERE up.auth_user_id = auth.uid()
        AND urr.role IN ('owner','manager')
        AND name LIKE (urr.restaurant_id::text || '/%')
    )
  );

DROP POLICY IF EXISTS "Dashboard managers update receipts" ON storage.objects;
CREATE POLICY "Dashboard managers update receipts"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND EXISTS (
      SELECT 1
      FROM user_restaurant_roles urr
      JOIN user_profiles up ON up.id = urr.user_id
      WHERE up.auth_user_id = auth.uid()
        AND urr.role IN ('owner','manager')
        AND name LIKE (urr.restaurant_id::text || '/%')
    )
  )
  WITH CHECK (
    bucket_id = 'receipts'
    AND EXISTS (
      SELECT 1
      FROM user_restaurant_roles urr
      JOIN user_profiles up ON up.id = urr.user_id
      WHERE up.auth_user_id = auth.uid()
        AND urr.role IN ('owner','manager')
        AND name LIKE (urr.restaurant_id::text || '/%')
    )
  );

DROP POLICY IF EXISTS "Dashboard managers delete receipts" ON storage.objects;
CREATE POLICY "Dashboard managers delete receipts"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND EXISTS (
      SELECT 1
      FROM user_restaurant_roles urr
      JOIN user_profiles up ON up.id = urr.user_id
      WHERE up.auth_user_id = auth.uid()
        AND urr.role IN ('owner','manager')
        AND name LIKE (urr.restaurant_id::text || '/%')
    )
  );
