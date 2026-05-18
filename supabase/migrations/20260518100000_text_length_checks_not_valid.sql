-- Phase 7 (input validation rollout, 2026-05-18): defense-in-depth length
-- and format CHECKs on user-facing text columns. ALL NOT VALID — they
-- enforce against NEW writes only and skip the table scan, so they're safe
-- on multi-million-row tables and won't reject legacy rows that exceed the
-- cap. A follow-up migration runs VALIDATE CONSTRAINT once edge fn
-- enforcement has been live long enough that no new violators have been
-- written and any legacy outliers have been backfilled.
--
-- Survey (2026-05-18) confirmed zero existing rows would violate ANY of the
-- caps below. See WORK_LOG / plan file for details.
--
-- Rollback: see supabase/migrations/down/20260518100000_text_length_checks_not_valid.down.sql

-- ── reservations ──────────────────────────────────────────────────────────
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_guest_full_name_len
  CHECK (guest_full_name IS NULL OR char_length(guest_full_name) <= 120) NOT VALID;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_special_request_len
  CHECK (special_request IS NULL OR char_length(special_request) <= 500) NOT VALID;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_dietary_notes_len
  CHECK (dietary_notes IS NULL OR char_length(dietary_notes) <= 1000) NOT VALID;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_internal_notes_len
  CHECK (internal_notes IS NULL OR char_length(internal_notes) <= 2000) NOT VALID;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_confirmation_code_format
  CHECK (confirmation_code IS NULL OR confirmation_code ~ '^[A-Za-z0-9-]{4,20}$') NOT VALID;

-- ── restaurants ───────────────────────────────────────────────────────────
ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_name_len
  CHECK (char_length(name) <= 120) NOT VALID;

ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_description_len
  CHECK (description IS NULL OR char_length(description) <= 2000) NOT VALID;

ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_address_len
  CHECK (address IS NULL OR char_length(address) <= 300) NOT VALID;

-- ── menu_items ────────────────────────────────────────────────────────────
ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_name_len
  CHECK (char_length(name) <= 200) NOT VALID;

ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_description_len
  CHECK (description IS NULL OR char_length(description) <= 1000) NOT VALID;

-- ── guests ────────────────────────────────────────────────────────────────
ALTER TABLE public.guests
  ADD CONSTRAINT guests_internal_notes_len
  CHECK (internal_notes IS NULL OR char_length(internal_notes) <= 2000) NOT VALID;

ALTER TABLE public.guests
  ADD CONSTRAINT guests_email_format
  CHECK (email IS NULL OR (char_length(email) <= 254 AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')) NOT VALID;

ALTER TABLE public.guests
  ADD CONSTRAINT guests_phone_len
  CHECK (phone IS NULL OR char_length(phone) <= 20) NOT VALID;

-- ── user_profiles ─────────────────────────────────────────────────────────
-- Length-only cap. Apple Sign-In private relay returns 43-char base64url
-- hashes that aren't email-shaped, so a regex check would reject future
-- Apple-private signups.
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_email_len
  CHECK (email IS NULL OR char_length(email) <= 254) NOT VALID;

-- ── promo_codes ───────────────────────────────────────────────────────────
ALTER TABLE public.promo_codes
  ADD CONSTRAINT promo_codes_code_format
  CHECK (code ~ '^[A-Z0-9_-]{3,32}$') NOT VALID;

-- ── restaurant_reviews ────────────────────────────────────────────────────
ALTER TABLE public.restaurant_reviews
  ADD CONSTRAINT restaurant_reviews_review_text_len
  CHECK (review_text IS NULL OR char_length(review_text) <= 3000) NOT VALID;
