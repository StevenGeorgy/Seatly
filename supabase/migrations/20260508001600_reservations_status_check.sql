-- Phase 11 hardening: lock down reservations.status to a fixed allow-list.
-- Without this, a typo (e.g. 'penidng') silently disables the cover-cap and
-- diner-overlap blocking logic that filters on
--   status IN ('pending','confirmed','seated').
--
-- Existing distinct values in production: pending, confirmed, seated,
-- completed, cancelled, no_show. The CHECK matches that exact set.

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_status_valid;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_status_valid
  CHECK (status IN ('pending','confirmed','seated','completed','cancelled','no_show'));
