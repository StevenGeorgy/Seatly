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

REVOKE ALL ON FUNCTION public.reservation_review_completed_at(timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_pending_reservation_review_requests() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_reservation_review(uuid, integer, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ensure_pending_reservation_review_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_reservation_review(uuid, integer, text) TO authenticated;
