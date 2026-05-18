-- Phase 8 (input validation rollout, 2026-05-18): VALIDATE the CHECK
-- constraints added in Phase 7. Run ONLY after re-surveying with the same
-- queries used in the Phase 1 survey, confirming zero rows violate any of
-- the constraints. Otherwise VALIDATE will fail with 23514.
--
-- Per CLAUDE.md guardrails: Mark approves manually before applying.

ALTER TABLE public.reservations VALIDATE CONSTRAINT reservations_guest_full_name_len;
ALTER TABLE public.reservations VALIDATE CONSTRAINT reservations_special_request_len;
ALTER TABLE public.reservations VALIDATE CONSTRAINT reservations_dietary_notes_len;
ALTER TABLE public.reservations VALIDATE CONSTRAINT reservations_internal_notes_len;
ALTER TABLE public.reservations VALIDATE CONSTRAINT reservations_confirmation_code_format;

ALTER TABLE public.restaurants VALIDATE CONSTRAINT restaurants_name_len;
ALTER TABLE public.restaurants VALIDATE CONSTRAINT restaurants_description_len;
ALTER TABLE public.restaurants VALIDATE CONSTRAINT restaurants_address_len;

ALTER TABLE public.menu_items VALIDATE CONSTRAINT menu_items_name_len;
ALTER TABLE public.menu_items VALIDATE CONSTRAINT menu_items_description_len;

ALTER TABLE public.guests VALIDATE CONSTRAINT guests_internal_notes_len;
ALTER TABLE public.guests VALIDATE CONSTRAINT guests_email_format;
ALTER TABLE public.guests VALIDATE CONSTRAINT guests_phone_len;

ALTER TABLE public.user_profiles VALIDATE CONSTRAINT user_profiles_email_len;

ALTER TABLE public.promo_codes VALIDATE CONSTRAINT promo_codes_code_format;

ALTER TABLE public.restaurant_reviews VALIDATE CONSTRAINT restaurant_reviews_review_text_len;
