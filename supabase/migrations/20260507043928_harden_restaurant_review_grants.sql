REVOKE ALL ON public.restaurant_reviews FROM anon, authenticated;
GRANT SELECT ON public.restaurant_reviews TO authenticated;
