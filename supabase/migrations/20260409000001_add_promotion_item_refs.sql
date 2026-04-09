-- Add menu item references to promotions for BOGO and free item types
ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS bogo_item_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS free_item_id  UUID REFERENCES menu_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS free_item_name TEXT;

-- free_item_name stores the display name of the free item so customers see it
-- even if the menu_items row is later deleted
