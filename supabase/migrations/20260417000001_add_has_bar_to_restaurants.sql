-- Add has_bar flag to restaurants.
-- Controls whether the Bar Only filter is shown in the Orders / KDS view.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS has_bar boolean NOT NULL DEFAULT false;
