# Work log

Pairs with `SPEED_PLAN.md` and `CONCURRENCY_PLAN.md`. This file captures decisions, gotchas, and follow-ups that don't live in the code or the plans themselves. Reads top-to-bottom: current state first, history second.

---

## TL;DR — current state (2026-05-07)

**Customer booking is correct under concurrent load.** Atomic `book_reservation` RPC + DB-level exclusion constraint on `reservation_tables` prevent double-booking. Validated at the SQL level. Live load testing capped by the Nano compute tier, not by code.

**Customer-route frontend is mostly tuned.** TanStack Query cache + deferred fetches + intent prefetch + bundle splitting are all live. Real Lighthouse mobile FCP improved 6.0s → 4.0s (slow-4G simulator); production behind Vercel/CDN with brotli should land closer to ~1.5-2s.

**Three known follow-ups, in priority order:**
1. **Compute tier upgrade** to Supabase Compute Small (~$10/mo). Single biggest concurrency capacity unlock; no code change. Detail in `CONCURRENCY_PLAN.md` → "Capacity recommendation."
2. **Phase F — `modify_reservation_slot` RPC.** `modify-reservation/index.ts` is still on the old code path; exclusion constraint catches the bad case but UX returns a raw 500 instead of a clean 409. Detail in `CONCURRENCY_PLAN.md` → Phase F.
3. **Phase 4 — single-shot SQL availability function.** Collapses N+1 round trips in `get-availability` edge function; ~100-150ms per restaurant lookup. Detail in `SPEED_PLAN.md` → Phase 4.

Phase 8 (marketing prerender) is the next big *frontend* lever if marketing-page LCP matters. Phase 9 (dashboard cleanup) is staff-only, lower priority.

---

## Production state at session end

- **Migrations applied** (remote project `exbjodmnpdiayfzrdyux`):
  - `idx_reservations_availability` — partial index, `(restaurant_id, status, reserved_at) WHERE status IN ('pending','confirmed','seated')`
  - `idx_shifts_active_per_restaurant` — `(restaurant_id, is_active) INCLUDE (days_of_week)`
  - `reservation_tables.slot_range tstzrange` column + sync triggers
  - `reservation_tables_no_overlap` exclusion constraint (gist, `WHERE released_at IS NULL`)
  - `book_reservation(...)` RPC with `p_status` parameter, advisory lock keyed on `(restaurant_id, reserved_at)`
- **Edge functions migrated to atomic RPC:** `create-public-booking`, `cenaiva-chat`, `_shared/booking.ts` (used by `cenaiva-orchestrate`).
- **Edge functions still on old code path:** `modify-reservation/index.ts` (see Phase F).
- **Local migration files** (`2026050800...`) have different timestamps than the matching remote migrations (`20260507...`). Do **not** run `supabase db push` blindly — duplicate migrations may fail or drift.

---

## Shipped — chronological

### Concurrency hardening (Phases A–D, CONCURRENCY_PLAN.md)

Atomic booking + correctness backstop. The exclusion constraint physically prevents two reservations from claiming the same table at overlapping times; the atomic RPC + advisory lock serialize concurrent bookings cleanly. Phase E (live load test) was deferred — see "Incident note" below.

### SPEED_PLAN Phase 3 — DB indexes

Two indexes on the hot availability queries. `EXPLAIN ANALYZE` confirmed index scans, ~8ms / ~2ms. Cheapest real DB win on the plan.

### SPEED_PLAN Phase 5 — optimistic preview→booking navigation

`RestaurantPreviewModal` Continue button navigates immediately with the cached slot; `RestaurantPublicPage` re-validates in parallel and shows a stale-preview banner if the slot disappeared. Smoke-tested on Slow 4G throttle.

### SPEED_PLAN Phase 1 — TanStack Query foundation

Wrapped App in `QueryClientProvider`. Converted hooks: `useRestaurant`, `usePublicRestaurants`, `usePublicMenuCategories`, `usePublicMenuItems`, `useRestaurantReviews`, `useEvents`, `useAllActiveEvents`, `useNotifications`. Preserved each hook's existing return shape so callsites didn't need edits.

**Skipped intentionally:**
- `useUser` — context consumer over `AuthContext`. Auth state must be a singleton driven by Supabase's `onAuthStateChange`; query-invalidation is the wrong tool.
- `useAvailability` — has a module-level cache (45s TTL, in-flight dedup, `forceRefresh`) that's already functionally equivalent to TanStack's cache for an imperative API. Wrapping would double-cache.

### SPEED_PLAN Phase 2 — defer non-critical fetches

Added `{ enabled?: boolean }` parameter to public hooks. Booking page menu queries gated by `step in {menu, checkout}`. Modal menu/reviews/events gated by `activeTab`. Removed redundant `useRestaurantReviews` callsite from `RestaurantPublicPage` — `restaurant.avg_rating` / `restaurant.total_reviews` already carry the same data via `useRestaurant`'s `applyReviewSummaries`.

**Plan deviation:** Conflict windows on `RestaurantPublicPage` were NOT gated by `step !== "details"`. The slot picker on `details` uses conflict windows to filter availability — gating it there would make slots disappear after the user picks one. Plan was wrong on that bullet.

### SPEED_PLAN Phase 6 — intent-based prefetch

New `apps/web/src/lib/prefetch.ts`:
- `prefetchRestaurantPreview(queryClient, { restaurantId, slug })` — fires three `prefetchQuery` calls (restaurant by slug, menu categories, menu items) with `staleTime: 30s`.
- `useRestaurantPrefetch` hook — returns `{ onMouseEnter (150ms debounce), onMouseLeave, setRef }`. setRef is wired to an IntersectionObserver (50% threshold) that fires once and disconnects. A per-card `firedRef` dedupes hover and IO firing.

`GridCard` and `MapListCard` in DiscoverPage wired to the hook. Smoke verified 23+ prefetch requests after viewport settle vs ~3 baseline.

**Deferred:** Dashboard sidebar prefetch — staff hooks (`useReservations`, `useOverviewStats`, `useStaffRoster`, `useGuests`) are still on `useState`/`useEffect`, so `queryClient.prefetchQuery` is a no-op for them. Belongs to Phase 9.

### SPEED_PLAN Phase 7 — bundle audit + lazy CustomerMap

Audit finding: `vendor-map` (802 KB / 215 KB gzipped) was preloaded eagerly via `<link rel="modulepreload">` despite being reachable only through dynamic imports. Rolldown's preload heuristics include all reachable chunks, which nullified the lazy benefit.

Fixes:
1. Lazy-loaded `CustomerMap` inside `CenaivaVoiceShell.tsx` via `React.lazy` + `Suspense`. New 1.9 KB stub chunk.
2. Configured `build.modulePreload.resolveDependencies` in `vite.config.ts` to drop `vendor-map`, `vendor-charts`, `vendor-canvas`, `FloorPlanPage` from the entry's preload list.

### SPEED_PLAN Phase 7.1 — chunk split + preload-helper bug

Phase 7's preload filter looked correct but didn't actually defer `vendor-map`. Root cause discovered via Lighthouse: `vite/preload-helper.js` (a 2 KB Vite internal) had been hoisted into the `vendor-map` chunk, so the entry's static import of the helper made `vendor-map` a static dep of the entry. The filter was never going to work.

**Fix in `vite.config.ts` `manualChunks`:** pin Vite/Rolldown internals to the catch-all `vendor` chunk:

```ts
if (id.includes(" ") || /\bvite\/(preload-helper|client|env)/.test(id)) return "vendor";
```

Also split the catch-all further:
- `motion-dom` → `vendor-motion` (paired with `framer-motion`)
- `zod` + `@hookform/resolvers` → `vendor-zod`
- `react-hook-form` → `vendor-forms`

`vendor-forms` (10 KB gzipped) properly stays lazy. `vendor-zod` (19 KB gzipped) ended up eager because `@cenaiva/assistant`'s `schema.ts` statically imports zod and the assistant is mounted at App root. Splitting gave a cacheable chunk but didn't make zod lazy.

**Real Lighthouse impact (3-run averages, mobile slow-4G simulator):**
- FCP **6.0s → 4.0s** (-2.0s, consistent)
- LCP 8.5s → ~7.5s
- TBT 2.3s → ~1.3s
- Score 32 → ~42

Desktop too noisy to call (single-run variance ~1s on fiber). Both before and after sat in the 1.5-2.5s LCP / 86-92 score range. The earlier "98 / 896 ms" desktop baseline was a single fortunate run.

**Caveat on all numbers:** `vite preview` doesn't gzip. Production behind Vercel/Netlify with brotli is ~3× faster on transfer. Real-world mobile FCP in production is probably ~1.5-2s.

### Promotions page filter/map parity with Discover

Updated the customer promotions/deals page to match the Discover page interaction model:
- filter bar now uses the same Date / Time / Party size / Radius picker pattern, with the same animated panel and Done/Clear flow;
- promotion type and price filters use the same chip styling inside that panel;
- map view now uses the same styled Google Map, custom price markers, clusters, zoom controls, user-location marker, sticky edge transition, hover/selection behavior, and bottom-left preview card pattern as Discover;
- the old placeholder promotion map with manually positioned pins was removed.

Verified with `npx tsc --noEmit -p apps/web`. Production build and authenticated browser smoke remain worth rerunning after this change.

### Doc updates

- `CONCURRENCY_PLAN.md` — added Phase F (`modify_reservation_slot` RPC) section with concrete steps, plus a capacity recommendation for upgrading to Compute Small.
- `PERFORMANCE_PATTERNS.md` — created. Portable playbook of speed/perf patterns for future projects (web + mobile + backend + deploy).

---

## Incident note — 2026-05-07 ~19:00 UTC

**What happened:** ran `tmp-e2e/concurrent-booking.mjs` with N=20 against the live `create-public-booking` endpoint. All 20 requests hit 504 IDLE_TIMEOUT (150s) plus one 503 BOOT_ERROR. Cascade: 20 PostgREST connections held transactions queued on the same advisory lock → pool exhausted → edge-function 150s deadline tripped before transactions released → DB stopped accepting new connections (even simple `SELECT 1`). Lasted ~5 min.

**Resolution:** restarted the database via the Supabase dashboard.

**Verified after restart:** single direct PostgREST call to `book_reservation` works correctly in 0.84s. Function and DB layer are sound. The test was simply too aggressive for Compute Nano.

**Guardrail:** `tmp-e2e/concurrent-booking.mjs` is destructive at this compute tier. Do not re-run unmodified. Drop N to 5, or upgrade to Compute Small (~200 connections) before running again.

---

## Open follow-ups

1. **Upgrade to Supabase Compute Small** — single dashboard click. Removes the practical concurrency ceiling. Detail in `CONCURRENCY_PLAN.md`.
2. **Phase F — `modify_reservation_slot` RPC** — ~30-45 min, low risk. Detail in `CONCURRENCY_PLAN.md`.
3. **Phase 4 — single-shot SQL availability function** — ~1hr, high correctness risk (byte-identical-output validation). Best done in a fresh session. Detail in `SPEED_PLAN.md`.
4. **Phase 8 — marketing prerender** — ~30 min if pages are clean, biggest remaining frontend LCP win. Detail in `SPEED_PLAN.md`.
5. **Phase 9 — dashboard cleanup** — convert staff hooks to TanStack Query, then wire sidebar nav prefetch. Customer paths unaffected; lower priority.
6. **Lazy zod in `@cenaiva/assistant`** — ~19 KB gzipped saved on first paint. Refactor to lazy-load `schema.ts`, or remove the eager assistant mount on routes that don't need it.

---

## Lessons / gotchas worth remembering

- **TanStack Query empty-array trap.** `query.data ?? []` creates a new empty array every render until data loads. Downstream `useMemo`s re-fire → effects re-fire → setState → re-render → "Maximum update depth exceeded." Always use a stable singleton (`const EMPTY: Foo[] = []` outside the hook). Caught this during Phase 2 verification when DiscoverPage's `restaurantIds` useMemo went infinite.
- **Lazy-load preload trap.** Lazy-loading a component doesn't help if its chunk is in the entry's `<link rel="modulepreload">`. Verify by `grep -oE 'from"\./[^"]+\.js"' dist/assets/index-*.js` — the entry's static deps must not include any chunk you're trying to defer.
- **Internal helpers can break chunk strategies.** Vite's `vite/preload-helper.js` got hoisted into `vendor-map`; the entry imported the helper, transitively pulling vendor-map. Always pin `vite/(preload-helper|client|env)` and similar internals to a chunk the entry already loads.
- **Lighthouse single-run variance.** Desktop runs can swing 800ms ↔ 2500ms LCP. Always average 3+ runs before claiming a delta.
- **`vite preview` doesn't gzip.** Real-world numbers behind a CDN with brotli are ~3× faster on transfer. Don't take preview Lighthouse numbers as production reality.

---

## Environment

- Repo root: `/Users/mark_habbi/Seatly-12` (monorepo, web app at `apps/web`).
- Supabase CLI v2.98.1 at `/usr/local/bin/supabase`, logged in, Seatly project (`exbjodmnpdiayfzrdyux`) linked.
- Supabase MCP connected (HTTP transport).
- Vite 8.x with Rolldown.
- Type-check: `npx tsc --noEmit -p apps/web` (run from repo root).
- Build: `npm --prefix apps/web run build` (run from repo root).
- Dev server: `npm run dev` from repo root, or `npm --prefix apps/web run dev`. Uses port 5174 if 5173 is taken.
- Playwright is available locally via `npm install --no-save @playwright/test` + `npx playwright install chromium`. Smoke specs live in `tmp-e2e/`; the existing `speed-phase5-smoke.spec.cjs` and `concurrent-booking.mjs` are kept around but the latter is destructive at Nano tier (see Incident note).
- Test login: `cenaiva.e2e.customer@test.local` / `TestPassword123!`. Visible-slot test restaurant: `Cenaiva Reservation Capacity Test`.
