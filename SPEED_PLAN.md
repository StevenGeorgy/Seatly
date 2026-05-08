# Speed plan — execution checklist

Tracks progress against `~/.claude/plans/playful-crafting-wave.md`. Ordered simplest → biggest, with foundations sequenced before the work that depends on them.

> **Companion plan:** `CONCURRENCY_PLAN.md` covers booking-insert hardening (exclusion constraint + atomic RPC) for safe concurrent users. It is independent of latency work but is a **prerequisite to Phase 5** below — optimistic navigation slightly widens the existing race window, so the integrity backstop should land first.
>
> **Status:** Phases A–D of CONCURRENCY_PLAN.md are **live** (constraint + atomic `book_reservation` RPC + JS migration deployed to `create-public-booking`, `cenaiva-chat`, `cenaiva-orchestrate`). Phase 5 is unblocked. Phase E (live load test) was deferred — see that file for context. See `WORK_LOG.md` for the most recent session summary.

---

## 🤖 Agent handoff notes (read this first)

If you are picking this plan up cold (e.g. Codex, a fresh Claude Code session, or a different agent), read this section before touching anything. Pairs with `WORK_LOG.md` — that file has the most recent session-by-session log; this section is the durable "what's still live" snapshot.

**Hard rules — do not violate:**
- **Booking rules are frozen.** Capacity math, conflict detection, table assignment via `find_available_table_group`, advance-booking-days, blackout dates, hours_json, special days, RLS policies, auth flows — none of these change. The plan is purely about latency.
- **The pre-commit re-validation must survive.** Phase 5 changes *when* the modal navigates, not whether the slot is re-checked before insert. The reservation insert path in `RestaurantPublicPage.handlePlaceOrder` is untouched.
- **`get_available_slots` is now the single source of truth for availability** for the customer flow. Any modification must keep its output byte-identical to what `_shared/availability.ts` produced (parity script `tmp-e2e/phase4-availability-parity.mjs` enforces 18 inputs). The legacy TS path under `USE_SQL_AVAILABILITY=0` is still deployed as rollback insurance for one release — do not remove it.
- **Customer browser does NOT use the edge function for availability anymore.** `apps/web/src/hooks/useAvailability.ts:fetchAvailabilityFromNetwork` calls `supabase.rpc("get_available_slots", ...)` directly. The edge function `get-availability/index.ts` is still deployed (still flag-gated, still working) but only the AI/voice flows hit it now. If you need to change customer-side availability behaviour, edit the hook *and* the SQL function in lockstep.

**Current production state (2026-05-08):**
- Phases 1, 2, 3, 4, 5, 6, 7 all shipped (✓ in their sections below).
- Phase 10 (a/b/c/d) shipped — see `CONCURRENCY_PLAN.md` for the per-phase details. Speed-relevant pieces:
  - **Phase 10a:** `availability_cache` UNLOGGED table + `get_available_slots_cached` wrapper. SQL miss 26 ms, hit 0.08 ms.
  - **Phase 10b:** `get_available_slots_for_restaurants` collapses Discover/Deals fanout into 1 RPC.
  - **Phase 10c:** `restaurant_available_dates` collapses the modal calendar's 30 day-probes into 1 server-side scan.
- **Levers 1 + 3 follow-ups shipped (post-Phase 10):**
  - Cache TTL bumped 7 s → 20 s on `get_available_slots_cached`. Higher hit rate, slightly stale-availability tradeoff (booking writes still atomic).
  - **Compact batched RPC** `get_available_slots_for_restaurants_compact` returns first 3 future slots per restaurant, strips `table_ids`. Wire payload **26 KB → 1.7 KB (15.7× reduction)** for Discover/Deals. `availabilityFilters.ts` switched to the compact variant. Real win for mobile users on 3G/4G; smaller JSON parse on the client.
- Direct-RPC swap (post-Phase 4 follow-up): browser bypasses the edge function for availability and now calls `get_available_slots_cached` directly.
- Modal UX defaults: today's date, party=2, closest-to-now slot auto-selected. `forceRefresh: true` on every modal fetch so the 45s cache is bypassed inside the modal. The Time tile shows "No times" and the popover renders the unavailability message when empty. Calendar uses Phase 10c batched date scan (1 RPC, was 30).
- `USE_SQL_AVAILABILITY=1` is set on the deployed function. Unset it on the dashboard to revert to the legacy TS code path with no code change.
- 18/18 byte-identical parity validated. SQL `get_available_slots` executes in ~28 ms (`EXPLAIN ANALYZE`); browser-direct cached RPC warm latency ~80–150 ms; compact batched RPC payload ~1.7 KB per Discover load.

**Already done — do not redo:**
The ✅ items in each phase section below are complete. Skipping them is correct.

**Open follow-ups (in priority order, speed-focused):**

These move per-user perceived speed, not the concurrency ceiling. For ceiling work see `CONCURRENCY_PLAN.md`.

1. **Real-user metrics (RUM) wiring** (~30 min). Today all latency claims (e.g. "~80 ms warm cached RPC") are extrapolated from k6 + benchmarks — no real production measurement. Wire up Vercel Analytics or `web-vitals` package + a small backend to record FCP/LCP/INP/TTFB from real users. Without this, every speed claim in this doc is theoretical.
2. **Phase 4.1 — cenaiva paths to SQL availability** (~1 hr). `cenaiva-orchestrate` still uses `_shared/availability.ts` (legacy 50-query path); `cenaiva-chat` has its own inline slot logic. Both should call `get_available_slots_cached` for the same 28 ms server-side win the customer flow already gets. AI prompt branches need their own validation.
3. **Phase 8 — marketing prerender** (~30 min if pages are clean). Marketing pages (home, pricing, restaurant landing) currently render client-side. Prerender them so first paint = static HTML. Biggest remaining LCP win for ad / SEO traffic. No change to booking surfaces.
4. **Lazy zod in `@cenaiva/assistant`** (~45 min). ~19 KB gzipped off the initial bundle. Cold-load FCP win.
5. **Phase 9 — dashboard cleanup** (1–2 days). Convert staff hooks (`useReservations`, `useOverviewStats`, `useStaffRoster`, `useGuests`) to TanStack Query, then wire sidebar prefetch. Customer paths unaffected.

**Concurrency follow-ups removed from this list (now done or deferred):**
- ~~Compute Small upgrade~~ — left to a single dashboard click when production traffic warrants it. See `CONCURRENCY_PLAN.md`.
- ~~Phase F (modify_reservation_slot)~~ — shipped 2026-05-08.
- ~~Phase 10 (edge-cache + batched RPCs + rate limits)~~ — shipped 2026-05-08 as Phases 10a/b/c/d.

**Environment / credentials:**
- Repo root: `/Users/mark_habbi/Seatly-12` (monorepo, web app at `apps/web`).
- Supabase CLI v2.98.1 at `/usr/local/bin/supabase`, logged in as Mark, Seatly project (`exbjodmnpdiayfzrdyux`) linked.
- Supabase MCP connected (HTTP transport). Use `mcp__supabase__apply_migration` for DDL, `mcp__supabase__execute_sql` for ad-hoc queries, `mcp__supabase__get_logs` for edge-function latency.
- Postgres migrations live in `supabase/migrations/`, timestamp-prefixed.
- Edge functions live in `supabase/functions/`. The shared availability code is in `supabase/functions/_shared/availability.ts`. `cenaiva-chat/index.ts` and `cenaiva-orchestrate/index.ts` have **their own copies** of similar logic and still use the legacy path — Phase 4.1 swaps these.
- Vite dev server: `npm run dev` from the repo root.
- Type-check before claiming any phase done: `npx tsc --noEmit -p apps/web`.
- Parity test: `SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… node tmp-e2e/phase4-availability-parity.mjs`.

**Riskiest moments:**
- **Any change to `get_available_slots`** must be re-validated by the parity script before deploying. The byte-identical contract holds today and must keep holding.
- **Any change to `useAvailability.ts`** affects every customer flow that lists times. Smoke through Discover → preview modal → booking page → confirm after each edit.
- **Phase 4.1 (cenaiva swap)** has its own validation surface — the AI consumes slot text in prompt branches. Don't assume parity from the customer-side test covers it.
- **The modal's calendar probe** fires ~30 parallel RPC calls per modal open (one per day of the visible month, to dot-mark bookable dates). On Compute Nano this is fine but noticeable; if you're chasing further speed, batch this into a single SQL function (`restaurant_available_dates(restaurant_id, party_size, start_date, end_date)` returning a date[]).

**Testing surface (run before marking any phase done):**
- `npx tsc --noEmit -p apps/web` — must pass.
- Manual customer flow: Discover → click card → modal opens with today's date, party 2, closest-to-now time pre-picked; popover shows full available time list; change date/party → "Loading…" appears, then list updates; Continue → booking page shows the picked slot → step through Menu and Checkout; complete a real reservation insert in a test restaurant.
- Parity: `node tmp-e2e/phase4-availability-parity.mjs` — must show 18/18 pass.
- DB latency: `EXPLAIN ANALYZE SELECT public.get_available_slots(...)` — should be ~25–35ms.
- Edge function latency: `mcp__supabase__get_logs --service edge-function` — used by AI flows, should still be 150–500ms.

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

Collapse N+1 round trips in the edge function to a single RPC. **Customer endpoint shipped; cenaiva-* deferred to Phase 4.1.**

- [x] New migration `supabase/migrations/20260508000600_get_available_slots.sql` (plus 3 plpgsql helpers).
- [x] Ported slot-building logic from `supabase/functions/_shared/availability.ts:60-308`:
  - [x] Timezone resolution + hours_json lookup (special-day precedence)
  - [x] Closure-day early-return with `closureUnavailableMessage` parity
  - [x] Slot enumeration + capacity rollup (per-shift, capped at 48)
  - [x] Reuse existing `find_available_table_group` SQL function (one pass)
- [x] Edge function `get-availability/index.ts` flag-gated by `USE_SQL_AVAILABILITY` env. Old path stays for rollback (one release).
- [x] Side-by-side parity script `tmp-e2e/phase4-availability-parity.mjs` — 3 restaurants × today/tomorrow × party 2/4/8 = 18/18 byte-identical (`assert.deepStrictEqual`). Ran with flag OFF (legacy HTTP vs RPC) and again post-flip (both sides on SQL).
- [x] Deployed + flag flipped (`supabase secrets set USE_SQL_AVAILABILITY=1`). Server-side SQL execution: **28.5ms** via `EXPLAIN ANALYZE`. Edge function execution_time_ms in logs: ~150–500ms (down from 1.5–9.0s on legacy v56 deployment).
- [ ] **Phase 4.1 (deferred):** Same swap for `cenaiva-orchestrate` (uses `_shared/availability.ts` directly) and `cenaiva-chat/index.ts` (its own inline slot logic). AI/voice paths — separate validation surface; wait for Phase 4 to bake before doing.

**Subtle ports for the byte-identical contract** (notes for Phase 4.1 to match):
- `display_time` is formatted in TS (`toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true })`) because V8/ICU emits a NARROW NO-BREAK SPACE (U+202F) between time and AM/PM that PG's `to_char` would replace with a regular space.
- Top-level `floor_capacity` uses `SUM(capacity) WHERE is_active=true` (matching the wrapper's `getFloorCapacity`). The party-size guard message uses `restaurant_floor_capacity()` RPC (matching inner availability.ts). They usually agree but can diverge when tables are `status='blocked'`.
- `duration_minutes` per slot is `shift.turn_time_minutes ?? 90` (the wrapper overrides `settings_json.turnTimeMinutes`).
- Shifts iterated `ORDER BY id ASC` for deterministic ordering.

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
