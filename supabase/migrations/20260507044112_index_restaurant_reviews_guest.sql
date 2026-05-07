CREATE INDEX IF NOT EXISTS idx_restaurant_reviews_guest
  ON public.restaurant_reviews (guest_id);
