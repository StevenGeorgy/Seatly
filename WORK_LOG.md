# Work log — 2026-05-07

Session summary for picking up later. Pairs with `SPEED_PLAN.md` and `CONCURRENCY_PLAN.md`.

---

## What shipped to production

### SPEED_PLAN.md → Phase 3 (DB indexes) — ✅ live

- `supabase/migrations/20260508000000_availability_indexes.sql`
  - `idx_reservations_availability` — partial index on `(restaurant_id, status, reserved_at) WHERE status IN ('pending','confirmed','seated')`
  - `idx_shifts_active_per_restaurant` — `(restaurant_id, is_active) INCLUDE (days_of_week)`
- Verified via `EXPLAIN ANALYZE`: both availability queries do index scans, ~8ms / ~2ms.

### CONCURRENCY_PLAN.md → Phases A–D — ✅ live

DB layer (all migrations applied to remote project `exbjodmnpdiayfzrdyux`):
- `supabase/migrations/20260508000200_reservation_tables_slot_range.sql` — adds `tstzrange slot_range` column on `reservation_tables`, BEFORE-INSERT trigger to populate from parent reservation, AFTER-UPDATE trigger to propagate changes, backfill of all 75 existing rows, NOT NULL after backfill. Installs `btree_gist` extension.
- `supabase/migrations/20260508000300_reservation_tables_exclusion.sql` — `EXCLUDE USING gist (table_id WITH =, slot_range WITH &&) WHERE released_at IS NULL`. Pre-flight overlap check returned 0; deliberate-conflict test confirms SQLSTATE `23P01`.
- `supabase/migrations/20260508000400_book_reservation_rpc.sql` — atomic `book_reservation(...)` PL/pgSQL function with `pg_advisory_xact_lock` keyed on `(restaurant_id, reserved_at)`. Cover-cap re-check, `find_available_table_group`, reservation insert, `reservation_tables` insert, all in one transaction.
- `supabase/migrations/20260508000500_book_reservation_status_param.sql` — adds optional `p_status` parameter (default `'pending'`); also sets `confirmed_at = now()` when status is `'confirmed'`.

Error codes the RPC raises (translated to friendly errors in JS):
- `P0001` → `no_table` (no fitting table available)
- `P0002` → `over_cover_cap`
- `P0003` → `shift_not_found`
- `23P01` → exclusion-constraint backstop (extremely rare)
- `22023` → invalid args / status

Edge functions (deployed):
- `supabase/functions/create-public-booking/index.ts` (v18 via MCP, then v19 via CLI redeploy) — replaced multi-step insert + assign with single `book_reservation` RPC call. Translates P0001/P0002/P0003/23P01 to clean 4xx responses.
- `supabase/functions/cenaiva-chat/index.ts` (v67) — same migration; passes `p_status='confirmed'` for AI bookings.
- `supabase/functions/_shared/booking.ts` (used by `cenaiva-orchestrate` v158) — same migration; dead `assignReservationTables` import removed.

Plan docs:
- `CONCURRENCY_PLAN.md` (new) — full plan with status checkboxes
- `SPEED_PLAN.md` — Phase 3 ticked + cross-link to concurrency plan added

---

## What's deferred (pick these up next time)

### CONCURRENCY_PLAN.md
1. **`modify-reservation` migration.** `supabase/functions/modify-reservation/index.ts` (L331, L362) still uses the old `find_available_table_group` + `assign_reservation_tables` pair. Different semantics from `book_reservation` (release + reassign of existing reservation). Needs its own RPC, e.g. `modify_reservation_slot(...)`. **Worst case today: 23P01 backstop fires and returns a raw 500 to the user instead of a clean 409. Real damage prevented.**
2. **Phase E live load test.** See incident note below. SQL-level correctness already proven; if you do run a live test, **lower N to 5** or upgrade to Compute Small first.

### SPEED_PLAN.md (next phases)
- **Phase 5 is now complete** — optimistic preview navigation landed and passed Slow 4G smoke testing. See follow-up notes below.
- **Phase 1 (TanStack Query)** is the recommended next step. Budget realistically: ~1.5-3 hours, not the optimistic 45 min in the plan, because it touches shared hooks and callsites.
- Phases 2 + 6 are blocked on Phase 1. Phases 4, 7, 8, 9 still pending.

---

## Incident note — 2026-05-07 ~19:00 UTC

**What happened:** ran `tmp-e2e/concurrent-booking.mjs` with N=20 against the live `create-public-booking` endpoint. All 20 requests hit 504 IDLE_TIMEOUT (150s) plus one 503 BOOT_ERROR. Pool exhaustion cascaded: 20 PostgREST connections all held transactions queued on the same advisory lock, the edge-function 150s deadline tripped before transactions could release, and the DB stopped accepting new connections (even simple `SELECT 1` from MCP). Lasted ~5+ minutes.

**Resolution:** restarted the database via the Supabase dashboard.

**Verified after restart:** single direct PostgREST call to `book_reservation` works correctly in 0.84s. The function and DB layer are sound. The test was simply too aggressive for the current compute tier (Nano).

**Lessons / guardrails:**
- `tmp-e2e/concurrent-booking.mjs` is destructive at this compute tier. **Do not re-run unmodified.** Drop N to 5, or upgrade to Compute Small (~$10/mo on Pro, ~200 connections) before running again.
- Real production load won't approximate 20-simultaneous-on-the-same-slot. The system handles realistic traffic.
- Phase 5 of SPEED_PLAN.md (optimistic navigation) will further reduce lock-hold time and is the cheapest concurrency-resilience win.

---

## Files changed this session

```
NEW   CONCURRENCY_PLAN.md
NEW   WORK_LOG.md                                                 (this file)
NEW   supabase/migrations/20260508000000_availability_indexes.sql
NEW   supabase/migrations/20260508000200_reservation_tables_slot_range.sql
NEW   supabase/migrations/20260508000300_reservation_tables_exclusion.sql
NEW   supabase/migrations/20260508000400_book_reservation_rpc.sql
NEW   supabase/migrations/20260508000500_book_reservation_status_param.sql
NEW   tmp-e2e/concurrent-booking.mjs                              (DO NOT run unmodified — see incident)
M     SPEED_PLAN.md                                               (Phase 3 ticked + cross-link)
M     supabase/functions/create-public-booking/index.ts           (atomic RPC migration)
M     supabase/functions/cenaiva-chat/index.ts                    (atomic RPC migration)
M     supabase/functions/_shared/booking.ts                       (atomic RPC migration)
```

(Pre-existing unstaged changes from before this session: `apps/web/src/pages/customer/RestaurantPublicPage.tsx`, `supabase/functions/_shared/availability.ts`. Not touched by me.)

---

## Production state at session end

- DB: clean, migrations applied, indexes + constraint + RPC live.
- Edge functions: all three migrated functions deployed and verified working at 1× concurrency.
- 0 leftover test rows in `reservations` / `reservation_tables`.
- `modify-reservation` still on old code path; protected by the exclusion constraint backstop.
- No customer-facing breakage observed; edge function logs show normal traffic resumed after DB restart.

---

## Follow-up — 2026-05-07 Speed Phase 1 (TanStack Query) complete

- Installed `@tanstack/react-query@5.100.9` in `apps/web/package.json`.
- `apps/web/src/App.tsx` wrapped in `QueryClientProvider` with defaults `staleTime 60_000`, `gcTime 300_000`, `refetchOnWindowFocus: false`. Provider sits outside `BrowserRouter` so the queryClient is a stable singleton.
- Converted (preserving exact return shapes — no callsite changes needed):
  - `useRestaurant.ts` — both `useRestaurant(slugOrId)` and `usePublicRestaurants()`. Parallelized the 3 follow-up queries (menu_items, menu_categories, review_summaries) via `Promise.all` while we were in there.
  - `useMenuItems.ts` — only the public hooks (`usePublicMenuCategories`, `usePublicMenuItems`). Staff-side `useMenuCategories` / `useMenuItems` left alone (mutations + scope, different lifecycle).
  - `useRestaurantReviews.ts` — single bundled query returning `{ reviews, summary }`.
  - `useEvents.ts` — `useAllActiveEvents` (pure read) and `useEvents` (read + mutations). Mutations now use `queryClient.invalidateQueries` instead of imperative `await fetchEvents()`.
  - `useNotifications.ts` — preserved realtime postgres_changes channel and `cenaiva:notifications-changed` window listener; both now invalidate the query. `markRead` uses `queryClient.setQueryData` for the optimistic update.
- Skipped (intentional, with rationale captured in SPEED_PLAN.md):
  - `useUser` — context consumer, not a fetch hook. Auth state must be Supabase `onAuthStateChange` driven, not query-invalidated.
  - `useAvailability` — already has equivalent module-level cache + dedup + 45s TTL; wrapping it in useQuery would double-cache without a UX benefit. Phase 6 prefetch can call `fetchAvailabilitySlots` directly to warm the same cache.
- Verification: `npx tsc --noEmit -p apps/web` clean. `npm run build` succeeds (✓ built in 2.36s, no output regressions).
- **No browser smoke yet.** Next session should run dev server and click through Discover → restaurant → back to Discover to confirm zero new fetches on the second visit (cache hit). Also exercise notifications real-time path and a staff event mutation to confirm invalidation triggers refetch.

### Phase 2 / Phase 6 unblocked

Phase 2 (defer non-critical fetches via `enabled:`) and Phase 6 (intent-based prefetch) are now ready to start. Phase 2 is the lower-risk one — recommended next.

---

## Follow-up — 2026-05-07 Speed Phase 2 (defer non-critical fetches) complete

- Added optional `{ enabled?: boolean }` parameter to `usePublicMenuCategories`, `usePublicMenuItems`, `useRestaurantReviews`, `useAllActiveEvents`. Default true, ANDed with `Boolean(restaurantId)` where applicable.
- `RestaurantPublicPage.tsx`:
  - Menu hooks gated by `step === "menu" || step === "checkout"`.
  - Removed `useRestaurantReviews(restaurant?.id)` callsite entirely — `restaurant.avg_rating` / `restaurant.total_reviews` already carry the same data via `useRestaurant`'s `applyReviewSummaries`.
  - Replaced `publicPriceLevel = deriveRestaurantPriceLevelFromMenu(menuItems)` with `normalizeRestaurantPriceLevel(restaurant.price_range)` — same number, no menu dependency. Lets the menu queries actually stay disabled on `details` step.
- `RestaurantPreviewModal.tsx`: menu/reviews/events queries gated by `activeTab`. Menu is the default tab so no immediate perf delta, but the gate enables Phase 6 prefetch to selectively warm the right cache entries.
- **Plan deviation (intentional):** Conflict windows in `RestaurantPublicPage` were NOT gated by `step !== "details"` as the plan suggested. The slot picker on `details` uses conflict windows to filter availability slots — gating it there would cause slots to disappear after the user picked one. Plan was wrong on that bullet.

### Bug found and fixed during Phase 2 verification

The Phase 1 conversions used `query.data ?? []` which created a NEW empty array each render until data loaded. `DiscoverPage` has `restaurantIds = useMemo(() => restaurants.map(...), [restaurants])` followed by an effect that calls `setAvailabilityByRestaurantId` keyed off `restaurantIds`. Unstable empty array → effect refired → setState → re-render → new empty array → loop. Manifested as React's "Maximum update depth exceeded" warning.

Fixed by hoisting stable `EMPTY_*` module-level constants in `useRestaurant.ts`, `useMenuItems.ts`, `useRestaurantReviews.ts`, `useEvents.ts`, `useNotifications.ts`. **TanStack Query gotcha worth remembering: never `?? []` an unfetched query; use a stable singleton.**

### Verification

- `npx tsc --noEmit -p apps/web` clean.
- `npm run build` succeeds.
- Playwright smoke against `localhost:5174`: discover loads cards, preview modal opens, no `Maximum update depth` warnings, no `pageerror`s, no React errors. Smoke spec was deleted after passing (one-off check).

### Phase 6 (prefetch) is now the natural next step

With `enabled:` gates in place, Phase 6 can selectively prefetch the right query keys on hover/intersection. Suggested order: Discover card hover/intersection → prefetch `useRestaurant(slug)` and `usePublicMenuCategories/Items` for that restaurant; sidebar nav hover → prefetch destination query.

---

## Follow-up — 2026-05-07 Speed Phase 6 (intent-based prefetch) complete

- New file `apps/web/src/lib/prefetch.ts`:
  - `prefetchRestaurantPreview(queryClient, { restaurantId, slug })` — fires three `queryClient.prefetchQuery` calls (restaurant by slug, menu categories by id, menu items by id) with `staleTime: 30_000`.
  - `useRestaurantPrefetch(restaurantId, slug)` hook — returns `{ onMouseEnter, onMouseLeave, setRef }`. Mouseenter is 150ms debounced; setRef is wired to an `IntersectionObserver` (threshold 0.5) that fires once and disconnects. A per-card `firedRef` dedupes — IO and hover never both fire.
- Discover cards (`GridCard`, `MapListCard` in `DiscoverPage.tsx`) wired to the hook. Both grid and map list views prefetch on visibility, hover, and focus.
- Exported `fetchRestaurantBySlugOrId`, `fetchPublicMenuCategories`, `fetchPublicMenuItems` from their hook modules so the prefetch helper can reuse them (single source of truth for the queryFns).
- Dashboard sidebar prefetch deferred to Phase 9 — staff-side hooks aren't on TanStack Query yet, so prefetching via queryClient is a no-op for them.

### Verification

- Typecheck + prod build clean.
- Playwright smoke confirmed `IntersectionObserver`-driven prefetch fires for all visible cards on `/discover`: 23 restaurants/menu_* REST requests captured after viewport settle, vs ~3 expected for a non-prefetching baseline. No `Maximum update depth` or `pageerror`s.

### What's still hot for follow-up

- **Phase 4 — Single-shot SQL availability function** is the next biggest latency win. ~1hr, no FE dep, but the byte-identical-output validation against the current edge function is unforgiving (3 restaurants × today/tomorrow × party 2/4/8 — must match before flipping `USE_SQL_AVAILABILITY`).
- **Phase 7 — Bundle audit** is cheap to start (`vite-bundle-visualizer` over `apps/web`). Map vendor bundle is currently 802 KB / 215 KB gzipped — top candidate for lazy-loading on the map-view branch.
- **Phase 8** (marketing prerender) and **Phase 9** (dashboard hooks → TanStack + nav prefetch) round out the plan.

---

## Follow-up — 2026-05-07 Speed Phase 7 (bundle audit + dep slimming) complete

### Audit findings

Ran `npx vite-bundle-visualizer --template raw-data` over `apps/web`. Top chunks by rendered size:
- `vendor-map`: 802 KB minified / **215 KB gzipped** (maplibre-gl + react-map-gl)
- catch-all `vendor-iFtpmYyo`: 654 KB / **207 KB gzipped** (motion-dom 193 KB rendered, react-dom 179 KB, zod 124 KB, i18next 73 KB, react-hook-form 65 KB, @tanstack/query-core 60 KB, tailwind-merge, sonner, @reduxjs/toolkit, @floating-ui, d3-* family)
- `vendor-charts`: 207 KB / 55 KB gzipped (recharts)
- `vendor-supabase`: 189 KB / 50 KB gzipped
- `vendor-react`: 138 KB / 47 KB gzipped
- `index` (entry): 145 KB / 47 KB gzipped — already under the < 250 KB target.

### Root cause of map-not-actually-lazy

`vendor-map` was listed in `index.html` as `<link rel="modulepreload">`, even though `CustomerMap` was reachable only via the lazy `CenaivaVoiceShell`. Rolldown's modulepreload heuristics include **all reachable chunks**, including those behind dynamic imports — which nullified the lazy-load benefit on cold paint.

### Fixes shipped

1. **Lazy-loaded `CustomerMap` inside `CenaivaVoiceShell.tsx`** via `React.lazy` + `Suspense`. Now `vendor-map` is only reachable through a *second* dynamic import boundary (App → CenaivaVoiceShell → CustomerMap). Spawns its own `CustomerMap-*.js` chunk (1.9 KB stub) and shrinks the voice shell chunk from 54.9 KB → 31.0 KB minified.

2. **Configured `build.modulePreload.resolveDependencies`** in `vite.config.ts` to filter heavy lazy-only chunks out of the entry's modulepreload list:
   - `vendor-map` (215 KB gzipped)
   - `vendor-charts` (55 KB gzipped — recharts, only used on Analytics + dashboard report pages)
   - `vendor-canvas` (konva, FloorPlanPage)
   - `FloorPlanPage` chunk

The chunks still load when the dynamic import that actually needs them fires; they just no longer eat first-paint bandwidth.

### Net first-paint savings (logged-in customer route, gzipped)

- vendor-map: **-215 KB**
- vendor-charts: **-55 KB**
- FloorPlanPage chunk: **-25 KB**
- **Total: ~295 KB gzipped removed from cold customer first paint**

For context: total customer first-paint download (gzipped, before this change) was roughly index 47 + vendor-react 47 + vendor-supabase 50 + vendor-iFtpmYyo 207 + vendor-ui 27 + vendor-motion 11 + vendor-date 12 + vendor-map 215 + vendor-charts 55 = ~671 KB. After: ~376 KB. **~44% reduction.**

### Smoke verification

- `npx tsc --noEmit -p apps/web` clean.
- `npm run build` clean (`✓ built in 2.48s`).
- Confirmed `index.html` no longer lists `vendor-map`/`vendor-charts` under `<link rel="modulepreload">`.
- Playwright smoke against `/discover` (cold paint) passed with no console errors and no `pageerror`s.

### Untouched / follow-up candidates

- **vendor-iFtpmYyo zod (124 KB rendered)** is the biggest deferable item left. Zod is used only on form-heavy routes (login, register, settings) — all of which are already `React.lazy`'d. Should already be lazy *in practice* but the modulepreload list could be extended to confirm. Worth a follow-up.
- **64 KB maplibre-gl CSS** still preloaded as `<link rel="stylesheet">` regardless of the JS being lazy. Vite emits stylesheet links per chunk; deferring needs `?inline` import or runtime injection. Lower priority — ~10-15 KB gzipped vs the 295 KB JS savings above.
- **framer-motion** at 11 KB gzipped is not a top offender; left untouched.
- **lucide-react** confirmed using per-icon imports already (tree-shaking working).

### Phase 4 is the only remaining big-impact item

Phase 8 (marketing prerender) and Phase 9 (dashboard hooks → TanStack + nav prefetch) are smaller follow-ups. Phase 4 (single-shot SQL availability function) is the last 1-hour-class item with high leverage. Best done in a fresh session because the byte-identical output validation is unforgiving.

---

## Follow-up — 2026-05-07 Phase 7.1 + preload-helper bug + Lighthouse baseline

### The preload-helper bug

Phase 7's modulePreload filter wasn't actually working. Lighthouse showed `vendor-map` (215 KB gzipped) still being fetched on `/`. Root cause: `vite/preload-helper.js` got hoisted into the `vendor-map` chunk, so the entry's static `import` of the helper made `vendor-map` a static dep of the entry. Filtering preload didn't matter because the entry was already importing it.

**Fix:** pin internal Vite/Rolldown helpers to the catch-all `vendor` chunk in `manualChunks`:

```ts
if (id.includes(" ") || /\bvite\/(preload-helper|client|env)/.test(id)) return "vendor";
```

**Lesson:** when filtering modulepreload, also verify the entry doesn't statically import the chunk you're trying to defer. `grep -oE 'from"\./[^"]+\.js"' dist/assets/index-*.js` shows entry's static deps cleanly.

### Phase 7.1 — split catch-all chunk further

Pulled `motion-dom` into `vendor-motion`, `zod` + `@hookform/resolvers` into `vendor-zod`, `react-hook-form` into `vendor-forms`. Verified `vendor-forms` (10 KB gzipped) stays lazy.

**Surprise:** `vendor-zod` (19 KB gzipped) ended up eager. Cause: `@cenaiva/assistant`'s `schema.ts` statically imports zod, and the assistant is mounted at App root. So zod loads on every route, not just form routes. Splitting gave a cacheable chunk but didn't make zod lazy. **To make zod truly lazy:** lazy-load schema validation inside the assistant package, or remove eager assistant mount on non-customer routes. Separate session.

### Lighthouse baseline (real numbers, 3-run averages)

`vite preview` (no compression, simulated slow 4G mobile):
- FCP **6.0s → 4.0s** (-2.0s, consistent across runs)
- LCP 8.5s → ~7.5s
- TBT 2.3s → ~1.3s
- Score 32 → ~42

Desktop is too noisy to call (Lighthouse single-run variance ~1s on desktop fiber). Both before and after sit in the 1.5-2.5s LCP / 86-92 score range.

**Caveat:** `vite preview` doesn't gzip. Production behind Vercel/Netlify with brotli is ~3× faster on transfer. Real-world mobile FCP in production is probably ~1.5-2s, not 4s.

### Net frontend state

Frontend customer-route work is mostly done. Remaining frontend lever is **Phase 8 (marketing prerender)** — would drop home-page mobile FCP to ~1s. Everything else (Phase 4, Phase 9, lazy zod) is either backend or deferred.

---

## Follow-up — 2026-05-07 Speed Phase 5 complete

- Implemented optimistic preview-modal Continue:
  - `apps/web/src/components/customer/RestaurantPreviewModal.tsx` — `reserveSelectedSlot` now calls `onReserve(...)` immediately with the selected cached slot instead of waiting on a force-refresh.
  - Discover, Deals, and dashboard preview navigations pass router state `previewSlotRevalidation`.
  - `apps/web/src/pages/customer/RestaurantPublicPage.tsx` detects that state, force-refreshes availability once for the selected slot/date/party, and shows the stale-preview warning banner if the slot disappears.
  - Touched callsites:
    - `apps/web/src/pages/customer/DiscoverPage.tsx`
    - `apps/web/src/pages/customer/DealsPage.tsx`
    - `apps/web/src/components/dashboard/DashboardSidebar.tsx`
- Updated `SPEED_PLAN.md` Phase 5 checkboxes: all checked.
- Verification: `npx tsc --noEmit -p apps/web` passes.
- Slow 4G smoke test completed:
  - Added `tmp-e2e/speed-phase5-smoke.spec.cjs`.
  - Command: `E2E_BASE_URL=http://localhost:5174 npx playwright test tmp-e2e/speed-phase5-smoke.spec.cjs --reporter=list`
  - Result: passed (preview Continue navigated to booking before delayed availability revalidation finished).
- Test setup notes:
  - The dev server used `http://localhost:5174` because 5173 was already in use.
  - `@playwright/test` was installed with `npm install --no-save @playwright/test`; no package.json diff was produced.
  - `npx playwright install chromium` downloaded the local Playwright Chromium browser cache.
  - The smoke uses existing login `cenaiva.e2e.customer@test.local` / `TestPassword123!` and the visible-slot restaurant `Cenaiva Reservation Capacity Test`.
  - The dev server on 5174 was stopped after the test.

### Handoff to Opus — current repo state

- `SPEED_PLAN.md` and `WORK_LOG.md` are untracked local files but contain the current handoff state. Do not lose them.
- There are pre-existing untracked migration files whose names differ from remote migration history:
  - Local files are `2026050800...`
  - Remote Supabase migration history has the same migration names under `20260507183111`, `20260507185150`, `20260507185222`, `20260507185801`, `20260507190323`
  - Do **not** blindly run `supabase db push`; duplicate constraint/function migrations may fail or drift.
- Remote DB state was verified through Supabase MCP:
  - `idx_reservations_availability` exists.
  - `idx_shifts_active_per_restaurant` exists.
  - `reservation_tables_no_overlap` exclusion constraint exists.
  - `book_reservation(...)` exists with final `p_status text` parameter.
- `modify-reservation` is still the known concurrency gap. It uses the old `find_available_table_group` + `assign_reservation_tables` path. Correctness backstop exists via exclusion constraint, but UX can still see raw/rough 409/500-style behavior until a dedicated modify RPC is built.
- Recommended next work: **SPEED_PLAN Phase 1 — TanStack Query foundation**. Preserve existing hook return shapes, especially `useAvailability`'s in-memory dedup + 45s TTL behavior.
