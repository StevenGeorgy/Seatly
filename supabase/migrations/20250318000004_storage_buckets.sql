-- Create storage buckets per BACKEND.md
-- restaurant-logos: Public read, owner write
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'restaurant-logos',
  'restaurant-logos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
) ON CONFLICT (id) DO NOTHING;

-- menu-photos: Public read, owner write
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'menu-photos',
  'menu-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
) ON CONFLICT (id) DO NOTHING;

-- user-avatars: Auth read, self write
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-avatars',
  'user-avatars',
  false,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
) ON CONFLICT (id) DO NOTHING;

-- cover-photos: Public read, owner write
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cover-photos',
  'cover-photos',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
) ON CONFLICT (id) DO NOTHING;

-- RLS policies for storage (simplified: authenticated users can upload to their bucket paths)
-- restaurant-logos: staff of restaurant can upload
-- menu-photos: staff of restaurant can upload
-- user-avatars: users can upload to their own path (auth.uid())
-- cover-photos: staff of restaurant can upload
-- Public buckets allow SELECT for all; INSERT/UPDATE/DELETE require auth
