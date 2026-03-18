-- Add tables to Supabase Realtime publication for live UI updates
-- reservations, tables, orders, order_items, waitlist
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE reservations;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE "tables";
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE orders;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE order_items;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE waitlist;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
