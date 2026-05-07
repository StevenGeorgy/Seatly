CREATE OR REPLACE FUNCTION public.refresh_restaurant_review_stats(p_restaurant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.restaurants r
  SET
    avg_rating = stats.avg_rating,
    total_reviews = stats.total_reviews
  FROM (
    SELECT
      p_restaurant_id AS restaurant_id,
      CASE WHEN count(rr.id) = 0 THEN NULL ELSE round(avg(rr.rating)::numeric, 1) END AS avg_rating,
      count(rr.id)::integer AS total_reviews
    FROM public.restaurant_reviews rr
    WHERE rr.restaurant_id = p_restaurant_id
  ) stats
  WHERE r.id = stats.restaurant_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_restaurant_review_stats_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.refresh_restaurant_review_stats(NEW.restaurant_id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.refresh_restaurant_review_stats(NEW.restaurant_id);
    IF OLD.restaurant_id IS DISTINCT FROM NEW.restaurant_id THEN
      PERFORM public.refresh_restaurant_review_stats(OLD.restaurant_id);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_restaurant_review_stats(OLD.restaurant_id);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS restaurant_reviews_refresh_restaurant_stats ON public.restaurant_reviews;
CREATE TRIGGER restaurant_reviews_refresh_restaurant_stats
AFTER INSERT OR UPDATE OR DELETE ON public.restaurant_reviews
FOR EACH ROW
EXECUTE FUNCTION public.refresh_restaurant_review_stats_trigger();

UPDATE public.restaurants r
SET
  avg_rating = stats.avg_rating,
  total_reviews = stats.total_reviews
FROM (
  SELECT
    r_inner.id AS restaurant_id,
    CASE WHEN count(rr.id) = 0 THEN NULL ELSE round(avg(rr.rating)::numeric, 1) END AS avg_rating,
    count(rr.id)::integer AS total_reviews
  FROM public.restaurants r_inner
  LEFT JOIN public.restaurant_reviews rr ON rr.restaurant_id = r_inner.id
  GROUP BY r_inner.id
) stats
WHERE r.id = stats.restaurant_id;

REVOKE ALL ON FUNCTION public.refresh_restaurant_review_stats(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_restaurant_review_stats_trigger() FROM PUBLIC, anon, authenticated;
