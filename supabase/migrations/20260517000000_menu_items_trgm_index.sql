-- Menu-item keyword search support.
-- Powers the cenaiva-orchestrate `search_restaurants(menu_item_keyword=...)`
-- tool, which scans every restaurant's active+available menu_items.name /
-- menu_items.description for the user's dish phrase ("I want a burger",
-- "anywhere serving ramen") and intersects the result set against the
-- main restaurants query.
--
-- Without these indexes, `name ILIKE '%kw%'` is a full sequential scan over
-- menu_items every search — fine at 100 rows, painful at 100k. GIN trigram
-- indexes turn substring ILIKE into an index lookup. The partial WHERE
-- clauses keep the index small (only active/available rows) and match the
-- exact filter the handler uses, so the planner stays on the trigram path.

create extension if not exists pg_trgm;

create index if not exists idx_menu_items_name_trgm
  on menu_items using gin (name gin_trgm_ops)
  where is_active = true and is_available = true;

create index if not exists idx_menu_items_description_trgm
  on menu_items using gin (description gin_trgm_ops)
  where is_active = true and is_available = true;
