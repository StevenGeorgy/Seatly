-- Seed user_profiles for the 4 test users created in Supabase Auth dashboard.
-- Run this in the Supabase SQL Editor.
-- Uses auth.users (by email) and restaurants (by slug) to link correctly.
-- Safe to re-run: skips users that already have a profile.

INSERT INTO user_profiles (auth_user_id, full_name, email, role, restaurant_id)
SELECT u.id, 'La Maison Owner', 'owner1@seatly.test', 'owner', r.id
FROM auth.users u
CROSS JOIN restaurants r
WHERE u.email = 'owner1@seatly.test' AND r.slug = 'la-maison'
ON CONFLICT (auth_user_id) DO NOTHING;

INSERT INTO user_profiles (auth_user_id, full_name, email, role, restaurant_id)
SELECT u.id, 'La Maison Host', 'host1@seatly.test', 'host', r.id
FROM auth.users u
CROSS JOIN restaurants r
WHERE u.email = 'host1@seatly.test' AND r.slug = 'la-maison'
ON CONFLICT (auth_user_id) DO NOTHING;

INSERT INTO user_profiles (auth_user_id, full_name, email, role, restaurant_id)
SELECT u.id, 'The Local Owner', 'owner2@seatly.test', 'owner', r.id
FROM auth.users u
CROSS JOIN restaurants r
WHERE u.email = 'owner2@seatly.test' AND r.slug = 'the-local'
ON CONFLICT (auth_user_id) DO NOTHING;

INSERT INTO user_profiles (auth_user_id, full_name, email, role, restaurant_id)
SELECT u.id, 'The Local Host', 'host2@seatly.test', 'host', r.id
FROM auth.users u
CROSS JOIN restaurants r
WHERE u.email = 'host2@seatly.test' AND r.slug = 'the-local'
ON CONFLICT (auth_user_id) DO NOTHING;
