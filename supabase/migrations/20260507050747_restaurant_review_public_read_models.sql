CREATE OR REPLACE FUNCTION public.restaurant_review_summaries(p_restaurant_ids uuid[])
RETURNS TABLE (
  restaurant_id uuid,
  avg_rating numeric,
  total_reviews integer
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    rr.restaurant_id,
    round(avg(rr.rating)::numeric, 1) AS avg_rating,
    count(*)::integer AS total_reviews
  FROM public.restaurant_reviews rr
  WHERE rr.restaurant_id = ANY(COALESCE(p_restaurant_ids, ARRAY[]::uuid[]))
  GROUP BY rr.restaurant_id;
$$;

CREATE OR REPLACE FUNCTION public.restaurant_public_reviews(
  p_restaurant_id uuid,
  p_limit integer DEFAULT 12
)
RETURNS TABLE (
  id uuid,
  rating integer,
  review_text text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    rr.id,
    rr.rating,
    rr.review_text,
    rr.created_at
  FROM public.restaurant_reviews rr
  WHERE rr.restaurant_id = p_restaurant_id
  ORDER BY rr.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 50);
$$;

REVOKE ALL ON FUNCTION public.restaurant_review_summaries(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restaurant_public_reviews(uuid, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.restaurant_review_summaries(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restaurant_public_reviews(uuid, integer) TO authenticated;
