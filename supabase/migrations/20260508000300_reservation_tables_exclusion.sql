-- Phase B (CONCURRENCY_PLAN.md): exclusion constraint that makes the DB the
-- final arbiter of "no two non-released rows for the same table can have
-- overlapping reservation windows." Two concurrent inserts that race past
-- find_available_table_group will be rejected here with SQLSTATE 23P01.
--
-- The constraint is partial (released_at IS NULL) so historical released
-- rows do not block new bookings on the same table.

ALTER TABLE public.reservation_tables
  ADD CONSTRAINT reservation_tables_no_overlap
  EXCLUDE USING gist (
    table_id WITH =,
    slot_range WITH &&
  ) WHERE (released_at IS NULL);
