# Floor Plan — Supabase Migration (TODO)

## Current State
The floor plan editor currently saves and loads data from **localStorage** only.

- **Storage key:** `seatly-floor-plan`
- **Functions:** `loadFloorPlanData()`, `saveFloorPlanData()` in `apps/web/lib/floor-plan.ts`
- **Data structure:** `FloorPlanData` (levels, tables, walls, interior)

## Required Change
Floor plan data should be persisted to **Supabase tables** instead of localStorage so that:

1. Data is shared across devices and sessions
2. Data is backed up and recoverable
3. Multi-restaurant isolation is enforced via RLS

## Next Steps
1. Check `BACKEND.md` for existing floor plan / tables schema
2. If no schema exists, design tables for: levels, tables, walls, interior
3. Add `restaurant_id` to all tables for multi-tenant isolation
4. Implement Supabase load/save in `floor-plan.ts`
5. Migrate existing localStorage data on first load (optional)
6. Remove or deprecate localStorage usage

## Files to Update
- `apps/web/lib/floor-plan.ts` — replace localStorage with Supabase client
- `BACKEND.md` — document new tables if created
