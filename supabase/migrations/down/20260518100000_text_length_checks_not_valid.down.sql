-- Rollback for 20260518100000_text_length_checks_not_valid.sql
-- Run by hand via supabase db push or psql if the up-migration needs reverting.

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_guest_full_name_len;
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_special_request_len;
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_dietary_notes_len;
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_internal_notes_len;
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_confirmation_code_format;

ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_name_len;
ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_description_len;
ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_address_len;

ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_name_len;
ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_description_len;

ALTER TABLE public.guests DROP CONSTRAINT IF EXISTS guests_internal_notes_len;
ALTER TABLE public.guests DROP CONSTRAINT IF EXISTS guests_email_format;
ALTER TABLE public.guests DROP CONSTRAINT IF EXISTS guests_phone_len;

ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_email_len;

ALTER TABLE public.promo_codes DROP CONSTRAINT IF EXISTS promo_codes_code_format;

ALTER TABLE public.restaurant_reviews DROP CONSTRAINT IF EXISTS restaurant_reviews_review_text_len;
