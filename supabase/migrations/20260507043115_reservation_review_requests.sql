-- Logged-in diners can review completed reservations after the dining window ends.
-- Browser clients use the SECURITY DEFINER RPCs below so notifications remain
-- system-created and reviews are limited to the diner's own completed bookings.

CREATE TABLE IF NOT EXISTS public.restaurant_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_reviews_restaurant_created
  ON public.restaurant_reviews (restaurant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_restaurant_reviews_user_created
  ON public.restaurant_reviews (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_restaurant_reviews_guest
  ON public.restaurant_reviews (guest_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_review_request_once
  ON public.notifications (user_id, ((data ->> 'reservation_id')))
  WHERE type = 'reservation_review_request';

ALTER TABLE public.restaurant_reviews ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'restaurant_reviews'
      AND policyname = 'restaurant_reviews_select_own'
  ) THEN
    CREATE POLICY restaurant_reviews_select_own
      ON public.restaurant_reviews FOR SELECT
      TO authenticated
      USING (user_id = public.current_profile_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'restaurant_reviews'
      AND policyname = 'restaurant_reviews_select_staff'
  ) THEN
    CREATE POLICY restaurant_reviews_select_staff
      ON public.restaurant_reviews FOR SELECT
      TO authenticated
      USING (public.staff_has_restaurant_role(restaurant_id, ARRAY['owner', 'manager']));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reservation_review_completed_at(
  p_reserved_at timestamptz,
  p_duration_minutes integer
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_reserved_at + make_interval(mins => COALESCE(NULLIF(p_duration_minutes, 0), 90));
$$;

CREATE OR REPLACE FUNCTION public.ensure_pending_reservation_review_requests()
RETURNS TABLE (
  notification_id uuid,
  reservation_id uuid,
  restaurant_id uuid,
  restaurant_name text,
  reserved_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
BEGIN
  v_profile_id := public.current_profile_id();

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  INSERT INTO public.notifications (
    user_id,
    restaurant_id,
    type,
    title,
    body,
    data,
    is_read
  )
  SELECT
    v_profile_id,
    r.restaurant_id,
    'reservation_review_request',
    'Rate your experience',
    'How was your visit at ' || rest.name || '?',
    jsonb_build_object(
      'reservation_id', r.id,
      'restaurant_id', r.restaurant_id,
      'restaurant_name', rest.name,
      'route', '/bookings/' || r.id::text || '?review=1'
    ),
    false
  FROM public.reservations r
  INNER JOIN public.guests g ON g.id = r.guest_id
  INNER JOIN public.restaurants rest ON rest.id = r.restaurant_id
  WHERE g.user_profile_id = v_profile_id
    AND COALESCE(r.status, 'pending') NOT IN ('cancelled', 'no_show')
    AND public.reservation_review_completed_at(r.reserved_at, r.duration_minutes) < now()
    AND NOT EXISTS (
      SELECT 1
      FROM public.restaurant_reviews rr
      WHERE rr.reservation_id = r.id
    )
  ON CONFLICT DO NOTHING;

  RETURN QUERY
  SELECT
    n.id,
    r.id,
    r.restaurant_id,
    rest.name,
    r.reserved_at
  FROM public.notifications n
  INNER JOIN public.reservations r ON n.data ->> 'reservation_id' = r.id::text
  INNER JOIN public.guests g ON g.id = r.guest_id
  INNER JOIN public.restaurants rest ON rest.id = r.restaurant_id
  WHERE n.user_id = v_profile_id
    AND n.type = 'reservation_review_request'
    AND g.user_profile_id = v_profile_id
    AND COALESCE(r.status, 'pending') NOT IN ('cancelled', 'no_show')
    AND public.reservation_review_completed_at(r.reserved_at, r.duration_minutes) < now()
    AND NOT EXISTS (
      SELECT 1
      FROM public.restaurant_reviews rr
      WHERE rr.reservation_id = r.id
    )
  ORDER BY r.reserved_at ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_reservation_review(
  p_reservation_id uuid,
  p_rating integer,
  p_review_text text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_reservation public.reservations%ROWTYPE;
  v_guest public.guests%ROWTYPE;
  v_review_id uuid;
BEGIN
  v_profile_id := public.current_profile_id();

  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5.';
  END IF;

  SELECT r.*
  INTO v_reservation
  FROM public.reservations r
  WHERE r.id = p_reservation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.';
  END IF;

  SELECT g.*
  INTO v_guest
  FROM public.guests g
  WHERE g.id = v_reservation.guest_id
    AND g.user_profile_id = v_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You can only review your own reservations.';
  END IF;

  IF COALESCE(v_reservation.status, 'pending') IN ('cancelled', 'no_show') THEN
    RAISE EXCEPTION 'Cancelled reservations cannot be reviewed.';
  END IF;

  IF public.reservation_review_completed_at(v_reservation.reserved_at, v_reservation.duration_minutes) >= now() THEN
    RAISE EXCEPTION 'This reservation is not ready for review yet.';
  END IF;

  INSERT INTO public.restaurant_reviews (
    reservation_id,
    restaurant_id,
    guest_id,
    user_id,
    rating,
    review_text
  )
  VALUES (
    v_reservation.id,
    v_reservation.restaurant_id,
    v_reservation.guest_id,
    v_profile_id,
    p_rating,
    NULLIF(btrim(COALESCE(p_review_text, '')), '')
  )
  ON CONFLICT (reservation_id)
  DO UPDATE SET
    rating = EXCLUDED.rating,
    review_text = EXCLUDED.review_text,
    updated_at = now()
  RETURNING id INTO v_review_id;

  DELETE FROM public.notifications
  WHERE user_id = v_profile_id
    AND type = 'reservation_review_request'
    AND data ->> 'reservation_id' = v_reservation.id::text;

  RETURN v_review_id;
END;
$$;

REVOKE ALL ON public.restaurant_reviews FROM anon, authenticated;
GRANT SELECT ON public.restaurant_reviews TO authenticated;
REVOKE ALL ON FUNCTION public.reservation_review_completed_at(timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_pending_reservation_review_requests() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_reservation_review(uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_pending_reservation_review_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_reservation_review(uuid, integer, text) TO authenticated;
