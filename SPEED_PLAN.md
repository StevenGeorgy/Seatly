# Speed plan — execution checklist

Tracks progress against `~/.claude/plans/playful-crafting-wave.md`. Ordered simplest → biggest, with foundations sequenced before the work that depends on them.

> **Companion plan:** `CONCURRENCY_PLAN.md` covers booking-insert hardening (exclusion constraint + atomic RPC) for safe concurrent users. It is independent of latency work but is a **prerequisite to Phase 5** below — optimistic navigation slightly widens the existing race window, so the integrity backstop should land first.
>
> **Status:** Phases A–D of CONCURRENCY_PLAN.md are **live** (constraint + atomic `book_reservation` RPC + JS migration deployed to `create-public-booking`, `cenaiva-chat`, `cenaiva-orchestrate`). Phase 5 is unblocked. Phase E (live load test) was deferred — see that file for context. See `WORK_LOG.md` for the most recent session summary.

---

## 🤖 Agent handoff notes (read this first)

If you are picking this plan up cold (e.g. Codex, a fresh Claude Code session, or a different agent), read this section before touching anything.

**Hard rules — do not violate:**
- **Booking rules are frozen.** Capacity math, conflict detection, table assignment via `find_available_table_group`, advance-booking-days, blackout dates, hours_json, special days, RLS policies, auth flows — none of these change. The plan is purely about latency.
- **The pre-commit re-validation must survive.** Phase 5 changes *when* the modal navigates, not whether the slot is re-checked before insert. The reservation insert path in `RestaurantPublicPage.handlePlaceOrder` is untouched.
- **Phase 4's SQL function must produce byte-identical output to the current edge function** for the same `(restaurant_id, date, party_size)`. Verify with a side-by-side test on at least 3 real restaurants × today/tomorrow × party 2/4/8 *before* flipping `USE_SQL_AVAILABILITY`. The old edge-function path stays in place behind the flag for one release as a rollback safety net.

**Already done — do not redo:**
The four ✅ items in the section below are complete. Skipping them is correct; redoing them risks reintroducing the time-field bug we already fixed.

**Environment / credentials:**
- Repo root: `/Users/mark_habbi/Seatly-12` (monorepo, web app at `apps/web`).
- Supabase CLI v2.98.1 is installed at `/usr/local/bin/supabase`. You may not have a logged-in session — `supabase migration up` and `supabase functions deploy` will fail without it. If unauthenticated, hand the deploy step back to the user instead of trying to work around it.
- Postgres migrations live in `supabase/migrations/` and are timestamp-prefixed.
- Edge functions live in `supabase/functions/`. The shared availability code is in `supabase/functions/_shared/availability.ts`. `cenaiva-chat/index.ts` and possibly `cenaiva-orchestrate/index.ts` have **their own copies** of similar logic — when you change Phase 4, swap them too.
- Vite dev server: `npm run dev` from the repo root (delegates to `apps/web`).
- Type-check before claiming a phase is done: `npx tsc --noEmit -p apps/web`.

**Riskiest moments:**
- **Phase 1 (TanStack Query migration)** is the largest mechanical change — touches ~10 hooks plus their callsites. Run the dev server and click through Discover → modal → booking → confirm after *each* hook conversion, not just at the end. Preserve each hook's existing return shape exactly so callers don't need edits.
- **Phase 4 (SQL availability function)** is the biggest correctness risk. The fallback flag (`USE_SQL_AVAILABILITY`) is non-negotiable. Do not delete the old edge-function code path in the same PR as the cutover.
- **Phase 5 (optimistic navigation)** has a rare race window. Make sure the existing "preview time no longer available" warning in `RestaurantPublicPage.tsx` still fires when the in-flight re-validation comes back negative.

**Testing surface (run before marking any phase done):**
- `npx tsc --noEmit -p apps/web` — must pass.
- Manual customer flow: Discover → click restaurant card → preview modal opens → pick non-default time → Continue → booking page shows the picked time/date/party → step through Menu and Checkout. Then a real reservation insert in a test restaurant.
- For Phase 3 (indexes): `EXPLAIN ANALYZE` the two queries the availability function runs (the `reservations` predicate and the `shifts` predicate) — should switch from seq scan to index scan.
- For Phase 4: side-by-side comparison test described above.

**When stuck or uncertain, stop and surface the question** rather than guess at booking semantics. Speed is the only goal; integrity is the line.

---

## ✅ Already done (from earlier in the session)

- [x] Parallelize `find_available_table_group` calls in `supabase/functions/_shared/availability.ts`
- [x] Drop `forceRefresh` on booking-page slot fetch (cache reuse from preview modal)
- [x] Time-field bug fix: don't auto-clear `dineIn.time` on initial mount when URL pinned a slot
- [x] Time-field renders directly from `dineIn.time` when locked from preview (no `<select>` dependency)

---

## Phase 3 — Database indexes  ·  ~10 min  ·  no dependencies

Single migration. Cheapest, real DB speedup.

- [x] Create `supabase/migrations/20260508000000_availability_indexes.sql`
- [x] Add `idx_reservations_availability` on `(restaurant_id, status, reserved_at) WHERE status IN ('pending','confirmed','seated')`
- [x] Add `idx_shifts_active_per_restaurant` on `(restaurant_id, is_active) INCLUDE (days_of_week)`
- [x] Apply migration + verify with `EXPLAIN ANALYZE` (both queries: index scan, ~8ms / ~2ms)
- [x] Push to remote Supabase (applied via MCP `apply_migration`)

---

## Phase 5 — Optimistic navigation on Continue  ·  ~15 min  ·  no dependencies

Make the modal's "Continue" button feel instant.

- [x] In `RestaurantPreviewModal.tsx`, change `reserveSelectedSlot` to navigate first, then re-validate in parallel
- [x] Pipe the re-validation result to a router-state banner so a stale slot still surfaces
- [x] Confirm `RestaurantPublicPage`'s existing "preview time no longer available" warning still triggers when the parallel re-validation fails
- [x] Smoke test on Slow 4G throttle

---

## Phase 1 — TanStack Query (foundation)  ·  ~45 min  ·  unblocks 2 + 6

Adds the shared cache layer everything else builds on.

- [x] Add `@tanstack/react-query` to `apps/web/package.json`
- [x] Wrap tree in `<QueryClientProvider>` in `apps/web/src/App.tsx` with defaults: `staleTime: 60_000`, `gcTime: 5*60_000`, `refetchOnWindowFocus: false`
- [x] Convert hooks to `useQuery` (preserve existing return shape):
  - [x] `useRestaurant`
  - [x] `usePublicRestaurants`
  - [x] `usePublicMenuCategories`
  - [x] `usePublicMenuItems`
  - [x] `useRestaurantReviews`
  - [x] `useEvents` / `useAllActiveEvents`
  - [x] `useNotifications`
  - [x] `useUser` — **skipped (intentional)**: context consumer over `AuthContext`, not a fetch hook. Auth state must be a singleton driven by Supabase's `onAuthStateChange` subscription; useQuery is the wrong tool.
- [x] Wrap `useAvailability` — **skipped (intentional)**: existing module-level cache (`availabilityCache`, 45s TTL, in-flight dedup, `forceRefresh`) is already functionally equivalent to TanStack Query's cache for this imperative API. Phase 6 prefetch can call `fetchAvailabilitySlots` directly to warm the same cache.
- [x] Verify: typecheck + prod build both pass after each conversion

---

## Phase 2 — Defer non-critical fetches  ·  ~20 min  ·  needs Phase 1

Booking page step 1 should only fetch what step 1 renders.

- [x] `RestaurantPublicPage.tsx` — gate via `enabled: ...` on the relevant queries:
  - [x] Menu categories + items: `step === "menu" || step === "checkout"`
  - [x] Reviews: removed entirely — `restaurant.avg_rating` / `restaurant.total_reviews` already carry this info from `useRestaurant`
  - [x] Events: confirmed not used in the booking-page component (only in the staff-side `RestaurantStaffPreview` sub-component, which is a different render path)
  - [ ] ~~Conflict windows: `step !== "details"`~~ — **plan was wrong**: conflict windows must be loaded in `details` since that's where the slot picker uses them to filter availability. Leaving as-is.
- [x] `RestaurantPreviewModal.tsx` — gate by `activeTab`:
  - [x] Menu: `activeTab === "menu"` (default tab — same as before, no perf delta but enables prefetch later)
  - [x] Reviews: `activeTab === "reviews"`
  - [x] Events: `activeTab === "events"`
- [x] Verify: tsc + prod build clean; smoke test confirmed no render loops or console errors when loading discover and opening the preview modal

**Side note: empty-array stability.** The Phase 1 hook conversions used `query.data ?? []` which created a NEW empty array on every render until data loaded. This caused infinite render loops in `DiscoverPage` (downstream `useMemo` re-ran → effect re-ran → setState → re-render). Fixed by hoisting stable `EMPTY_*` constants in each public hook. Worth remembering as a TanStack Query gotcha.

---

## Phase 6 — Intent-based prefetch  ·  ~30 min  ·  needs Phase 1

Make clicks feel instant by warming the cache during browse.

- [x] Discover restaurant cards: `IntersectionObserver` (50% threshold) → prefetch restaurant detail + menu categories + menu items when card is in viewport
- [x] Card `onMouseEnter` (150ms debounce) + `onFocus` → same prefetch (deduped via a per-card `firedRef`, only fires once)
- [ ] ~~Dashboard sidebar nav links: `onMouseEnter` prefetch~~ — **deferred to Phase 9.** Staff-side hooks (`useReservations`, `useOverviewStats`, `useStaffRoster`, `useGuests`) are still on the original `useState`/`useEffect` pattern — they don't read from the TanStack cache, so prefetching via `queryClient.prefetchQuery` wouldn't help. Wire when those hooks are converted in Phase 9.
- [x] Verify: smoke confirmed 23+ restaurants/menu_* requests after viewport settle (vs ~3 baseline) — IO-driven prefetch fires for all visible cards. Availability is already prefetched by the existing `fetchDisplayAvailabilitySlots` effect on `/discover`, so the in-memory availability cache is also warm by the time the modal opens.

---

## Phase 4 — Single-shot SQL availability function  ·  ~1 hr  ·  no FE dependency

Collapse N+1 round trips in the edge function to a single RPC.

- [ ] New migration `supabase/migrations/20260508000100_get_available_slots.sql`
- [ ] Port slot-building logic from `supabase/functions/_shared/availability.ts`:
  - [ ] Timezone resolution + hours_json lookup
  - [ ] Special-day / blackout handling
  - [ ] Slot enumeration + capacity rollup
  - [ ] Reuse existing `find_available_table_group` SQL function
- [ ] Edge function `get-availability/index.ts` becomes thin wrapper, gated by `USE_SQL_AVAILABILITY` env flag (keep old path as fallback for one release)
- [ ] Side-by-side comparison test: 3 real restaurants × today/tomorrow × party 2/4/8 → byte-identical slot lists
- [ ] Same swap for `cenaiva-chat/index.ts` and any duplicates in `cenaiva-orchestrate`
- [ ] Deploy both functions + verify wall-time delta in logs

---

## Phase 7 — Bundle audit & dep slimming  ·  ~30 min audit + ~30 min per fix

- [x] Ran `npx vite-bundle-visualizer` (raw-data mode) on `apps/web`. Catch-all `vendor` chunk is 654 KB minified / 207 KB gzipped, dominated by motion-dom (193 KB rendered), react-dom (179 KB), zod (124 KB), i18next (73 KB), react-hook-form (65 KB), @tanstack/query-core (60 KB), tailwind-merge, sonner, @reduxjs/toolkit. The biggest single chunk on disk is `vendor-map` at 802 KB / 215 KB gzipped.
- [x] Identified that `vendor-map` was being preloaded eagerly via `<link rel="modulepreload">` in `index.html` despite being reachable only through dynamic imports — Rolldown's modulepreload heuristics include all reachable chunks, which nullified the lazy-loading benefit.
- [x] Lazy-loaded `CustomerMap` inside `CenaivaVoiceShell.tsx` via `React.lazy` + `Suspense`. Spawned its own `CustomerMap-*.js` chunk (1.9 KB). Voice shell chunk shrank from 54.9 KB → 31.0 KB minified.
- [x] Configured `build.modulePreload.resolveDependencies` in `vite.config.ts` to filter `vendor-map`, `vendor-canvas`, `vendor-charts`, and `FloorPlanPage` out of the entry's modulepreload list. They still load when the dynamic import that needs them fires.
- [x] Net first-paint download savings (logged-in customer route, gzipped):
  - vendor-map: -215 KB
  - vendor-charts: -55 KB (recharts only used in Analytics + dashboard report routes)
  - FloorPlanPage chunk: -25 KB
  - Total: **~295 KB gzipped removed from cold customer first paint**
- [x] Smoke test confirmed Discover loads cleanly with no console errors after the change.
- [x] **Phase 7.1 (catch-all chunk split):** Followed up by splitting the catch-all `vendor` further — `motion-dom` paired with `vendor-motion`, `zod` + `@hookform/resolvers` into `vendor-zod`, `react-hook-form` into `vendor-forms`. Verified `vendor-forms` (10 KB gzipped) stays lazy, but `vendor-zod` (19 KB gzipped) ended up eager because `@cenaiva/assistant`'s `schema.ts` statically imports zod and the assistant is mounted at App root. Net: catch-all dropped 207 → 148 KB gzipped, eager zod added 19 KB. **3-run mobile slow-4G average: FCP 6.0s → 4.0s (-2.0s), score 32 → 42 (+10).** Desktop too noisy to call (variance within Lighthouse single-run noise — both before and after were in 1.5-2.5s LCP range).
- [ ] **Audit:** Initial "98/100, LCP 896ms" desktop number was a single lucky Lighthouse run. Real desktop performance is closer to 88-92 / LCP 1.5-2.5s on `vite preview` without compression. Production behind a CDN with brotli should be ~3× faster.
- [ ] Untouched (next stages):
  - framer-motion: now properly chunked with motion-dom (40 KB gzipped vendor-motion).
  - lucide-react: per-icon imports already in use (tree-shaking working).
  - **`@cenaiva/assistant` zod usage**: this is what makes zod eager on every route. Lazy-loading `schema.ts` validation in the assistant package would let vendor-zod become truly lazy — saves ~19 KB gzipped on first paint. Bigger refactor, separate session.
  - 64 KB maplibre-gl CSS still preloaded as `<link rel="stylesheet">` — Vite emits stylesheet links per chunk regardless of whether the JS is lazy. Possible to defer with `?inline` or runtime injection, but ~10-15 KB gzipped is small relative to the JS savings above.
- Customer entry target was &lt; 250 KB gzipped: `index-*.js` is 145 KB / 47 KB gzipped, well under. Dominant entry-time chunks are still the catch-all vendor (207 KB gzip) and vendor-supabase (50 KB gzip).

---

## Phase 8 — Marketing pages: prerender  ·  ~30 min if clean

- [ ] Audit marketing pages for client-only state
- [ ] Add `vike` (or similar) to `apps/web/vite.config.ts` for marketing routes only
- [ ] Verify: `curl <deploy>/` returns non-empty HTML body
- [ ] Lighthouse FCP delta on home + pricing

---

## Phase 9 — Dashboard cleanup  ·  ~30 min after Phase 1 lands

- [ ] Floor plan + reservations list: gate by route segment
- [ ] Realtime subscriptions: lazy-mount per active tab
- [ ] Verify dashboard navigations are instant for cached data

---

## End-to-end verification (run after each phase's checkboxes are green)

- [ ] Cold load Discover: filters render < 500ms; cards visible immediately
- [ ] Card click: modal opens with availability already populated (post-Phase 6)
- [ ] Continue: booking page paints instantly with picked time/date/party (post-Phase 5)
- [ ] Back to Discover: instant (post-Phase 1)
- [ ] DB: `EXPLAIN ANALYZE` confirms index usage (post-Phase 3)
- [ ] SQL function output matches edge-function output (post-Phase 4)
- [ ] Booking integrity: book → cancel → modify → re-book runs clean
- [ ] Lighthouse target: 50%+ LCP improvement on Discover and booking page
