-- Phase B prerequisite for the logged-in double-book conflict filter.
--
-- 1. Add user_profile_id column to reservations (FK to user_profiles, nullable
--    because guest-checkouts have no profile).
-- 2. Backfill: link historical reservations to their guest's user_profile_id
--    so existing rows are discoverable by the conflict-detection query.
-- 3. Composite partial index for fast (user_profile_id, reserved_at) lookups
--    while leaving guest-checkout rows (user_profile_id IS NULL) out of the index.

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS user_profile_id uuid
    REFERENCES public.user_profiles(id) ON DELETE SET NULL;

UPDATE public.reservations r
SET user_profile_id = g.user_profile_id
FROM public.guests g
WHERE r.guest_id = g.id
  AND g.user_profile_id IS NOT NULL
  AND r.user_profile_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_user_profile_id_reserved_at
  ON public.reservations(user_profile_id, reserved_at)
  WHERE user_profile_id IS NOT NULL;
