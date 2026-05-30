# Work log

Pairs with `SPEED_PLAN.md` and `CONCURRENCY_PLAN.md`. This file captures decisions, gotchas, and follow-ups that don't live in the code or the plans themselves. Reads top-to-bottom: current state first, history second.

---

## TL;DR — current state (2026-05-08)

**One-number concurrent-user ceiling: ~2250** active Discover/Deals browsers on Micro compute under `p95 < 1s`, 0 failures. Up from 24 pre-cache. Single restaurant page hot path: ~1000. Modal calendar open: ~50.

**Phase 11 (booking accuracy + diner double-book) shipped 2026-05-08.**
- Three partial GiST exclusion constraints on `reservations` keyed on `user_profile_id`, `lower(guest_email)`, and digits-only `guest_phone` against an active `slot_range`. `slot_range` is a trigger-set `tstzrange` column (not a STORED generated column — `timestamptz + interval` is STABLE, which Postgres rejects for generation expressions). Migration `20260508001400_reservations_diner_no_overlap.sql`. 9 pre-existing test-seed overlaps were auto-cancelled by the migration with `cancellation_reason='auto_resolved_double_book_2026_05_08'` so the constraint could be added cleanly.
- `book_reservation` and `modify_reservation_slot` both now pre-check the same conditions under the advisory lock and raise `P0006 'diner_double_book'` instead of letting the constraint fire as `23P01`. Migration `20260508001500_book_reservation_diner_overlap.sql`. The constraint backstop is wrapped with `EXCEPTION WHEN exclusion_violation` and re-raised as `P0006` for consistency. Edge function `create-public-booking` maps both to `unavailable_reason: 'diner_double_book'`.
- `reservations.status` CHECK constraint added so `'penidng'`-style typos can't silently disable cover-cap or diner-overlap blocking. Migration `20260508001600_reservations_status_check.sql`.
- Compact slot listing bumped 3 → 6. Migration `20260508001700_compact_slots_six.sql`. UI consumers updated: `apps/web/src/lib/customer/availabilityFilters.ts` (default `maxSlots`), `DiscoverPage.tsx`, `DealsPage.tsx`.
- Customer-side stale-availability fixes: client cache TTL 45 s → 10 s, `optimistic: true` skip removed from preview→checkout (always force-refresh), final pre-submit re-check in `RestaurantPublicPage.handlePlaceOrder`, post-booking cache invalidation, and `useAvailabilityRealtimeInvalidate` realtime hook used by `RestaurantPreviewModal` + `RestaurantPublicPage` (NEVER from Discover/Deals — one socket per card explodes the connection count).

**Booking writes are correct AND atomic for both create and modify.** `book_reservation` and `modify_reservation_slot` RPCs run inside a transaction with an advisory lock keyed on `(restaurant_id, reserved_at)`. The `reservation_tables_no_overlap` GiST exclusion constraint is the unbreakable backstop — even if every code-level guard fell, two reservations cannot end up claiming the same table at overlapping times.

**Phase 10 follow-ups shipped 2026-05-08 (Lever 1 + Lever 3):**
- Cache TTL bumped 7 s → 20 s on `get_available_slots_cached`. Migration `20260508001100_availability_cache_ttl_20s` (re-defined the function). Higher hit rate, slightly stale availability tradeoff (booking writes still atomic, so worst case is a 409 slot_taken).
- New compact batched RPC `get_available_slots_for_restaurants_compact(uuid[], text, int)` — returns first 3 future slots per restaurant, strips `table_ids`. Migration `20260508001300_batched_availability_compact.sql`. Wire-bytes per Discover load: **26 KB → 1.7 KB (15.7× reduction)**. `availabilityFilters.ts → fetchDisplayAvailabilitySlotsForRestaurants` swapped to call the compact variant.
- k6 ceiling on Micro is roughly unchanged (~600–750 VUs batched = 1800–2250 effective lookups at p95<1s) — the bottleneck at this tier is CPU/connections, not network. The wire savings benefit mobile users on slow networks, not the k6 ceiling number.
- Lever 2 (CDN cache headers) and Lever 4 (PG connection tuning) were investigated and deferred. Lever 4 isn't user-tunable on Supabase (compute-tier-managed). Lever 2 needs an HTTP layer in front of PostgREST (worker proxy or routing back through edge function), so it's a 2–4 hr lift, not 30 min — left for when concurrency demand justifies the work.

**Phase 10 (concurrency scaling) shipped 2026-05-08:**
- 10a — `availability_cache` UNLOGGED table + `get_available_slots_cached` wrapper (7s TTL). SQL miss 26 ms / hit 0.08 ms. Lifted single-RPC ceiling 24 → 750–1000 VUs.
- 10b — `get_available_slots_for_restaurants(uuid[], text, int)` collapses Discover/Deals per-card fanout into one RPC. Lifted listing ceiling to 500–750 batched VUs = 1500–2250 effective lookups.
- 10c — `restaurant_available_dates(uuid, int, date, date)` collapses the modal calendar's 30 day-probes into one server-side scan. Modal endpoint ceiling 50 VUs (heavier per-call but fired only on calendar open).
- 10d — `check_rate_limit` SQL function + edge helpers; booking endpoints rate-limited at 20/min (create) and 15/min (modify) per IP/user. 25-attempt smoke confirmed 20 allowed → 429s afterward. Supabase edge substitutes the real upstream IP for `x-forwarded-for`, so bucket identity can't be spoofed.

**Phase F (atomic modify RPC) shipped 2026-05-08.** `modify_reservation_slot` RPC + edge function rewrite. Modify path now serializes against fresh bookings on the same advisory-lock key. Errors map cleanly: P0001/23P01 → 409 slot_taken, P0002 → 409 over_cover_cap, P0003/P0004 → 400, P0005 → 404. OUT columns are `out_reservation_id`/`out_table_ids`/`out_duration` to avoid 42702 ambiguity with `reservation_tables.reservation_id`.

**Compute upgraded Nano → Micro 2026-05-08.** Free under the Pro $10 compute credit, dedicated 2-core ARM CPU instead of shared, 1 GB RAM instead of 0.5 GB. The k6 numbers above are all measured on Micro.

**Customer-route frontend is mostly tuned.** TanStack Query cache + deferred fetches + intent prefetch + bundle splitting are all live. Real Lighthouse mobile FCP improved 6.0s → 4.0s (slow-4G simulator); production behind Vercel/CDN with brotli should land closer to ~1.5–2s.

**Availability lookup is single-shot SQL.** `get_available_slots` Postgres function (compute), wrapped by `get_available_slots_cached` (Phase 10a). Customer browser calls `get_available_slots_cached` directly via PostgREST; the `get-availability` edge function does the same. Edge function output extended with `timezone` so the browser can format `display_time` without a second fetch.

**Preview modal UX is OpenTable-style.** Click a card → modal opens with today's date, party 2, and the closest-to-now slot pre-picked. Force-refresh on every date/party change. Calendar uses Phase 10c batched date scan (1 RPC, was 30).

**CDN deliberation (2026-05-08) — declined.** Cloudflare Free in front of availability reads would lift the practical ceiling to ~50,000–100,000 concurrent users on Micro at $0/mo. Declined for now because: (1) current 2,250 ceiling is 50–100× realistic near-term traffic, (2) booking-accuracy concern (CDN+PG TTLs stack to ~40 s worst-case staleness vs ~20 s today), (3) PIPEDA / Canadian data residency wrinkle on Cloudflare Free logs, (4) new trust boundary + misconfig risk + new SPOF. Compute upgrade ($5/mo Small) is a cleaner lever at this scale. Decision criteria for revisiting are documented in `CONCURRENCY_PLAN.md` → "CDN deliberation".

**Open follow-ups — speed bucket** (per-user perceived speed; do not affect the concurrency ceiling — see `SPEED_PLAN.md`):
1. **Real-user metrics (RUM) wiring** — wire up Vercel Analytics or `web-vitals` so production speed is *measured*, not extrapolated. ~30 min. Without this, every speed claim in our docs is theoretical.
2. **Phase 4.1 — extend SQL availability to `cenaiva-orchestrate` + `cenaiva-chat`.** Both still use the legacy TS slot-builder. ~1 hr.
3. **Phase 8 — marketing prerender.** Next big frontend LCP win for marketing/SEO pages. ~30 min.
4. **Lazy zod in `@cenaiva/assistant`.** ~19 KB gz off first paint. ~45 min.
5. **Phase 9 — dashboard cleanup.** Staff-only, low priority. 1–2 days.

**Open follow-ups — concurrency bucket** (only one item, and it isn't engineering):
1. **Compute upgrade when traffic warrants it.** Micro holds ~2,250 concurrent. Small (~$5/mo) → ~5,000. Large (~$100/mo) → ~30,000. Five-minute dashboard click each step. Detail in `CONCURRENCY_PLAN.md`.

There are no further code-level concurrency levers worth shipping at this scale. The ceiling work is done.

---

## Agent transfer — latest handoff (2026-05-08, post Phase 10)

Use this if another Codex/Opus session picks up the work.

Current user-facing answer:
- One-number current capacity: **~2250 concurrent active Discover/Deals browsers** on the live project (Micro compute), measured by k6 against `get_available_slots_for_restaurants` at p95 < 1s.
- Single restaurant page ceiling: **~1000 VUs**. Modal calendar open ceiling: **~50 VUs**.
- Phase 10 (cache + batched listing + batched dates + rate limits) is fully shipped. Phase F (atomic modify RPC) is fully shipped. Compute is on Micro (was Nano).

Latest k6 numbers (live, Micro compute):
- Listing batched RPC (`get_available_slots_for_restaurants`, 3 restaurants/call):
  - 250 VUs / 30 s: p95 394 ms, 208 rps, 0 failures.
  - 500 VUs / 30 s: p95 568 ms, 399 rps, 0 failures.
  - 750 VUs / 30 s: p95 1.30 s, 465 rps, 0 failures (just over threshold).
- Single-RPC cached (`get_available_slots_cached`):
  - 750 VUs / 30 s: p95 304 ms, 612 rps, 0 failures.
  - 1000 VUs / 30 s: p95 1.12 s, 681 rps, 0 failures.
- Date-range RPC (`restaurant_available_dates`, 31-day cold scan):
  - 50 VUs / 30 s: p95 891 ms, 40 rps, 0.24% errors.

Latest files / migrations added this session:
- Migrations: `20260508000800_modify_reservation_rpc.sql`, `20260508000900_availability_cache.sql`, `20260508001000_batched_availability_rpc.sql`, `20260508001100_restaurant_available_dates.sql`, `20260508001200_rate_limit.sql`.
- Edge functions touched: `modify-reservation`, `create-public-booking`, `get-availability`. New helper: `supabase/functions/_shared/rate-limit.ts`.
- TS edits: `apps/web/src/hooks/useAvailability.ts` (cached RPC + `fetchAvailableDateSet`), `apps/web/src/lib/customer/availabilityFilters.ts` (`fetchDisplayAvailabilitySlotsForRestaurants`), `apps/web/src/pages/customer/DiscoverPage.tsx`, `apps/web/src/pages/customer/DealsPage.tsx`, `apps/web/src/components/customer/RestaurantPreviewModal.tsx`.
- New k6 scripts: `tmp-e2e/availability-batched.k6.js`, `tmp-e2e/availability-dates.k6.js`. Existing `tmp-e2e/availability-read.k6.js` updated to call the cached RPC.

Important guardrails (still apply):
- Do **not** re-run `tmp-e2e/concurrent-booking.mjs` unmodified, even on Micro. It does N=20 hot-slot bookings against the same advisory lock — pathological for the connection pool. Drop N to ≤5 if you must run it.
- The safe load tests are the three `availability-*.k6.js` scripts; all read-only.
- Supabase project ref is `exbjodmnpdiayfzrdyux`.
- Rate limits: booking endpoints rate-limit at 20/min (create) and 15/min (modify) per IP. If an automated test hammers them, expect 429s after the threshold.

Recommended next implementation order (none affect the concurrency ceiling):
1. Phase 4.1 — extend SQL availability into `cenaiva-orchestrate` + `cenaiva-chat`.
2. Phase 8 — marketing prerender for marketing-page LCP.
3. Lazy zod in `@cenaiva/assistant` (~19 KB gz off first paint).
4. Phase 9 — dashboard cleanup (TanStack Query for staff hooks + sidebar prefetch).
5. Compute upgrade only when launch traffic justifies it (Small for headroom; Large for the 30,000-user target).

---

## Production state at session end

- **Migrations applied** (remote project `exbjodmnpdiayfzrdyux`):
  - `idx_reservations_availability` — partial index, `(restaurant_id, status, reserved_at) WHERE status IN ('pending','confirmed','seated')`
  - `idx_shifts_active_per_restaurant` — `(restaurant_id, is_active) INCLUDE (days_of_week)`
  - `reservation_tables.slot_range tstzrange` column + sync triggers
  - `reservation_tables_no_overlap` exclusion constraint (gist, `WHERE released_at IS NULL`)
  - `book_reservation(...)` RPC with `p_status` parameter, advisory lock keyed on `(restaurant_id, reserved_at)`
  - `get_available_slots(p_restaurant_id, p_date, p_party_size)` RPC + 3 plpgsql helpers (`_availability_parse_time_to_minutes`, `_availability_read_hours_pair`, `_availability_find_special_day`). Returns the full HTTP-shaped jsonb response; minus display_time which is formatted in TS to preserve V8/ICU NARROW-NO-BREAK-SPACE byte-identity.
- **Edge function secrets:** `USE_SQL_AVAILABILITY=1` is set on `exbjodmnpdiayfzrdyux`. Unset it to roll back to the legacy TS path (no code change required).
- **Edge functions migrated to atomic RPC:** `create-public-booking`, `cenaiva-chat`, `_shared/booking.ts` (used by `cenaiva-orchestrate`).
- **Edge functions migrated to atomic modify RPC (Phase F, 2026-05-08):** `modify-reservation/index.ts` now goes through `modify_reservation_slot`. Migration `20260508000800_modify_reservation_rpc.sql`. OUT columns prefixed `out_` to avoid PG 42702 ambiguity with `reservation_tables.reservation_id`.
- **Edge functions on legacy availability TS code path:** `cenaiva-orchestrate` (uses `_shared/availability.ts`) and `cenaiva-chat` (own inline logic). Deferred follow-up — see SPEED_PLAN.md.
- **Local migration files** (`2026050800...`) have different timestamps than the matching remote migrations (`20260507...`). Do **not** run `supabase db push` blindly — duplicate migrations may fail or drift.

---

## Shipped — chronological

### CDN deliberation — Cloudflare evaluated and declined (2026-05-08)

After Levers 1 + 3 shipped, talked through whether to put Cloudflare Free in front of availability reads. Concrete picture worked through:

- **Architecture sketch:** `Browser → Cloudflare edge (Toronto POP) → Supabase (Toronto)` with explicit allow-list page rules — cache `/rest/v1/rpc/get_available_slots*`, bypass everything else.
- **Capacity math:** 95%+ cache hit rate at 20 s TTL × 2,250 concurrent users → ~11 rps reaching Supabase. Practical ceiling on Micro would jump from ~2,250 to ~50,000–100,000 concurrent. Free tier covers it ($0/mo).
- **Latency tradeoff:** Toronto user → Toronto Supabase is already ~30–50 ms, so CDN's HIT path saves ~10–20 ms (small win) and MISS path adds ~10–30 ms (extra hop).
- **Booking impact analysis:** booking POSTs would bypass cache entirely — booking latency unchanged, booking *correctness* unchanged regardless (atomic RPCs + exclusion constraint own that). Worst case visible-availability staleness goes from ~20 s (PG cache) to ~40 s (PG + CDN TTLs stack).
- **Security tradeoff:** new TLS-termination trust boundary (Cloudflare sees plaintext); misconfig footgun (caching booking POSTs would leak across users — mitigation is explicit allow-list rules); PIPEDA wrinkle on Cloudflare Free logs landing in US infra (residency control needs Enterprise ~$5–15k/yr); new SPOF (Cloudflare outages); origin URL still resolvable directly.
- **Real benefits:** DDoS absorption + basic WAF on free tier. Useful but not currently needed (no abuse signal observed).

Decision: **declined for now.** Compute upgrade ($5/mo Small) is a cleaner lever at this scale — moves the ceiling without the trust-boundary, misconfig, residency, or staleness tradeoffs. Documented decision criteria for future revisit in `CONCURRENCY_PLAN.md` → "CDN deliberation" (revisit when traffic regularly hits 1,500+ concurrent, when abuse appears in logs, or when expanding outside Canada).

Files touched: `WORK_LOG.md`, `CONCURRENCY_PLAN.md`, `SPEED_PLAN.md`. No code changed.

### Levers 1 + 3 — TTL bump + compact batched RPC (2026-05-08)

Speed/concurrency follow-ups after Phase 10:
- **Lever 1:** `get_available_slots_cached` TTL bumped 7 s → 20 s. Migration recreated the function in place.
- **Lever 3:** New `get_available_slots_for_restaurants_compact(uuid[], text, int)` returns first 3 future slots per restaurant and strips `table_ids`. Wire payload: **26 KB → 1.7 KB (15.7× smaller)**. `availabilityFilters.ts → fetchDisplayAvailabilitySlotsForRestaurants` switched to the compact variant. Migration `20260508001300_batched_availability_compact.sql`.
- **k6 finding (honest):** ceiling on Micro is roughly unchanged (~600–750 batched VUs at p95 < 1 s). At this compute tier the bottleneck is CPU/connections, not network — so the 16× wire reduction doesn't move k6 numbers. The wins are real for mobile users on slow networks (less to download + parse) and for cache hit rate over the 20 s window, but they don't show in k6.
- **Levers 2 (CDN) and 4 (PG connection tuning) deferred.** Lever 4 isn't user-tunable on Supabase. Lever 2 was evaluated separately (see CDN deliberation above) and declined for now.

### Modal UX defaults — OpenTable-style time/date/party (post-Phase 4 follow-up)

User-driven UX iteration on `RestaurantPreviewModal.tsx` after the direct-RPC swap. Goal: clicking a restaurant card should land the user on a usable booking state immediately and re-check the database on every interaction.

What's live:
- **Defaults on open:** today's date, party = 2 (or last-selected if persisted), and the closest-to-now slot in the future is auto-picked. The Time tile shows that picked time, never `Pick a time`, never disabled.
- **Loading feedback:** Time tile reads `Loading…` while a fetch is in flight, the picked time when slots arrive, or `No times` if the date/party combo genuinely has nothing.
- **Force-refresh on every modal fetch.** The modal's effect now passes `{ forceRefresh: true }` to `fetchSlots`, bypassing the 45s in-memory cache. The cache still serves Discover's background prefetch and repeat opens of unchanged Discover state, but inside the modal every change to date or party hits the DB. Cost is ~80–150ms per change; benefit is consistent feedback and freshness — which is what the user explicitly asked for.
- **Full time list in popover.** `TimeWheel` renders all available times for the day (scrollable, capped by SQL function's 48-slot output). Earlier this session a 6-slot window was tried and reverted — it hid evening times when the closest-to-now slot was at lunch.
- **No auto-roll-forward.** Earlier draft had the modal silently advance to the next available date when today returned zero slots. Reverted — it was confusing and felt like the system was overriding user intent. If the picked date has no slots, the modal stays on it and shows the no-slots message; user picks another date manually.

Files touched:
- `apps/web/src/components/customer/RestaurantPreviewModal.tsx` only.

Things explicitly NOT changed:
- Time-change does not trigger a re-fetch. Picking from the loaded list is instant; re-fetching would return the same list. Slot freshness at booking time is already handled by Phase 5's optimistic-navigation re-validation in `RestaurantPublicPage.handlePlaceOrder`.
- The 45s cache is still there for Discover's prefetch path. Only the modal's effect passes `forceRefresh: true`.
- `RestaurantPublicPage.tsx` (the booking page itself) was not edited — its time picker is a different component and still uses the cached path.

### Direct-RPC swap (post-Phase 4 follow-up)

After Phase 4 made the SQL function the bottleneck no longer, the next biggest lever was the edge function itself. Customer browser now skips the edge function for availability and calls `get_available_slots` via PostgREST directly. Two changes:

- Migration `20260508000700_get_available_slots_timezone.sql`: recreated the function so its returned jsonb includes `timezone`. The edge function (which still goes through this RPC when the flag is on) ignores the extra key.
- `apps/web/src/hooks/useAvailability.ts`: `fetchAvailabilityFromNetwork` now uses `supabase.rpc("get_available_slots", ...)` instead of `fetch("/functions/v1/get-availability", ...)`. `display_time` is still formatted with V8's en-US `toLocaleTimeString` for visual parity. Past-slot filtering and 45s in-memory cache behavior unchanged.

Latency math: edge function execution_time_ms was ~150–500ms warm + 1–5s on cold start (per `mcp__supabase__get_logs`); the SQL RPC alone is ~28ms (per `EXPLAIN ANALYZE`). Direct RPC eliminates the Deno hop entirely. Real-world warm browser latency should drop from ~500ms to ~80–150ms (region-dependent), with the cold-start variance gone.

Edge function `get-availability/index.ts` stays deployed unchanged as a rollback path. Only `useAvailability.ts` was edited; all callers that consume the hook's output are unaffected.

Parity: ran `tmp-e2e/phase4-availability-parity.mjs` again after the swap. The script still uses the HTTP edge function as one side of the comparison, so it validates the edge function path; the browser side is exercised only by manual smoke. 18/18 still pass.

### SPEED_PLAN Phase 4 — single-shot SQL availability function

Migration `20260508000600_get_available_slots.sql` ports the canonical slot-builder from `_shared/availability.ts:60-308` into Postgres. The edge function `get-availability/index.ts` is gated by `USE_SQL_AVAILABILITY=1`: when on, it makes a single RPC call to `get_available_slots(restaurant_id, date, party_size)` and formats `display_time` + the slot-derived `hours_window` fallback in TS (kept in TS to match V8/ICU's NARROW NO-BREAK SPACE between time and AM/PM that PG's `to_char` would not emit byte-for-byte).

Validated byte-identical via `tmp-e2e/phase4-availability-parity.mjs`: 3 restaurants × today/tomorrow × party {2,4,8} = 18 inputs, all `assert.deepStrictEqual` clean. Ran the script BEFORE flipping the flag (legacy TS HTTP vs RPC+post-process) and AFTER (still passes — both sides exercise the SQL path now).

Server-side latency: SQL function executes in **28.5ms** (`EXPLAIN ANALYZE`). Edge function logs: legacy v56 deployment showed 1.5–9.0s execution_time_ms; post-flip v58 shows 130–900ms with most calls 150–500ms. The remaining time is edge cold start + JSON encoding + TLS — same on both paths.

**Subtle ports worth flagging:**
- `restaurant_floor_capacity()` RPC (excludes `status='blocked'`) is used for the party-size guard; `SUM(capacity) WHERE is_active=true` is used for the top-level `floor_capacity` field. Both replicated to match the wrapper's exact production output even when these two values disagree.
- `duration_minutes` per slot uses `shift.turn_time_minutes ?? 90` (NOT `restaurant.settings_json.turnTimeMinutes`). The TS wrapper overrides the inner availability.ts value, so we match the wrapper.
- `find_available_table_group` is called once per slot (not twice as in TS). The TS wrapper's redundant second pass was removable since under non-concurrent conditions it returns the same table set; under concurrent conditions, the exclusion constraint + atomic `book_reservation` RPC are the actual correctness guard, not the redundant pass.
- Order: shifts iterated `ORDER BY id ASC` for deterministic slot output across runs (and parity test).

Scope deferred: `cenaiva-orchestrate` (still calls `getAvailability()` from `_shared/availability.ts`) and `cenaiva-chat` (its own inline slot logic). Both are on the AI/voice path and need separate validation. Customer flow only in this PR.

**Rollback:** `supabase secrets unset USE_SQL_AVAILABILITY --project-ref exbjodmnpdiayfzrdyux` flips back to the TS path on cold start (or re-deploy to force). The SQL function stays installed; safe to re-flip.

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
- Date / Time / Party size filters now apply through the shared availability-filter logic used by Discover, so promotions/deals respect availability instead of only updating UI state.
- promotion type and price filters use the same chip styling inside that panel;
- map view now uses the same styled Google Map, custom price markers, clusters, zoom controls, user-location marker, sticky edge transition, hover/selection behavior, and bottom-left preview card pattern as Discover;
- the old placeholder promotion map with manually positioned pins was removed.

Verified with `npx tsc --noEmit -p apps/web`. Browser smoke verified Discover and Deals empty-state behavior for impossible filters. Production build remains worth rerunning before deploy.

### Doc updates

- `CONCURRENCY_PLAN.md` — added Phase F (`modify_reservation_slot` RPC), the measured 24-active-user availability ceiling, the 30,000-user code+compute path, k6 results, and Supabase infra cost estimates.
- `PERFORMANCE_PATTERNS.md` — created. Portable playbook of speed/perf patterns for future projects (web + mobile + backend + deploy).

---

## Incident note — 2026-05-07 ~19:00 UTC

**What happened:** ran `tmp-e2e/concurrent-booking.mjs` with N=20 against the live `create-public-booking` endpoint. All 20 requests hit 504 IDLE_TIMEOUT (150s) plus one 503 BOOT_ERROR. Cascade: 20 PostgREST connections held transactions queued on the same advisory lock → pool exhausted → edge-function 150s deadline tripped before transactions released → DB stopped accepting new connections (even simple `SELECT 1`). Lasted ~5 min.

**Resolution:** restarted the database via the Supabase dashboard.

**Verified after restart:** single direct PostgREST call to `book_reservation` works correctly in 0.84s. Function and DB layer are sound. The test was simply too aggressive for Compute Nano.

**Guardrail:** `tmp-e2e/concurrent-booking.mjs` is destructive at this compute tier. Do not re-run unmodified. Drop N to 5, or upgrade to Compute Small (~200 connections) before running again.

---

## Hey Cenaiva web↔mobile parity — shipped 2026-05-09

**What:** web's `AssistantProvider.sendTranscript` rewritten to mirror mobile's four-stage pipeline. Most utterances now skip the LLM entirely.

**Pipeline:**
1. `planLocalBookingTurn` (pure TS, ~0–50ms) — missing-field prompts, ambiguous-time disambig, pending-option pick.
2. `useCenaivaAvailability.check` (~200–800ms) — `cenaiva-availability` edge function with cached "One moment please." filler. 20s `AbortController` timeout.
3. `useCenaivaSmallPrompt.send` (~400–1500ms) — `cenaiva-small-prompt` edge function for off-topic Q&A. 8s timeout. Skipped on confirmation replies / process prompts.
4. `useCenaivaOrchestrator.send` (~1.5–8s SSE) — full LLM tool loop, augmented with `recommendation_mode` + `assistant_memory`. `voice_id` deliberately omitted.

Kill switch: `VITE_CENAIVA_FAST_PATH=false` skips Stages 1–3.

**Files shipped (12 PRs' worth, executed as one body of work):**
- `packages/assistant/src/{types,schema,index}.ts` — `AssistantMemory`, `recommendation_mode`, `assistant_memory` on `OrchestratorRequest` + `AssistantResponse`.
- `apps/web/src/lib/cenaiva/` — 8 helpers (verbatim ports + 1 web-side `restaurantAdapter`):
  `confirmationIntent`, `simplePromptIntent`, `recommendationIntent` (297 lines),
  `filterRestaurants` (135 lines), `localBookingCollector` (1,200 lines),
  `buildWakeGreeting`, `voicePreference`, `restaurantAdapter`.
- `apps/web/src/lib/cenaiva/__tests__/*.test.ts` × 6 — **98 tests, all passing**.
- `apps/web/src/components/cenaiva/AssistantStore.tsx` — added `memory` field, `RESET_ASSISTANT_CONTEXT`, `mergeAssistantMemory`, `bookingProcessMemoryFromState`. Constants moved to `assistantStoreConstants.ts` (avoids `react-refresh/only-export-components`).
- `apps/web/src/components/cenaiva/AssistantProvider.tsx` — four-stage `sendTranscript`, `finishLocalResponse` helper, `open(greetingText)`, `onWake → buildWakeGreeting(user)`. Preserved: anti-double-speak, `sayGoodbyeAndClose`, `forceStopWakeWord`, `MAX_EMPTY_RELISTENS = 3`, paid-auto-close.
- `apps/web/src/hooks/` — `useCenaivaSmallPrompt`, `useCenaivaAvailability`, `useCenaivaLatencyBudget`, `useCenaivaVoicePreference` (split from provider for HMR). `useCenaivaOrchestrator` gained `prewarm()` + `onTransport`. `useElevenLabsTTS` gained IndexedDB cache `cenaivaTtsCache` (version `flash25-mp3-44100-128-v1`, djb2-hashed) for `COMMON_TTS_CACHE_TEXTS` (9 phrases). `useCenaivaVoice` threads `voicePref.voiceId`.
- `apps/web/src/contexts/CenaivaVoicePreferenceProvider.tsx` + `cenaiva-voice-preference-context.ts` — `localStorage['@cenaiva/tts-voice/${authUserId}']` + `user_profiles.cenaiva_tts_voice` (text col, nullable, deployed).
- `apps/web/src/pages/customer/AccountVoicePage.tsx` + `/account/voice` route + link from `AccountPage` Preferences section.
- `apps/web/{vitest.config.ts,vitest.setup.ts}` + `package.json` scripts — added Vitest infra (the project had no test runner).
- `.env.example` — `VITE_CENAIVA_TTS_VOICE_FEMALE_ID`, `VITE_CENAIVA_TTS_VOICE_MALE_ID`, `VITE_CENAIVA_VOICE_DEBUG`, `VITE_CENAIVA_FAST_PATH`.

**Hard rule preserved:** `apps/web/src/hooks/useCenaivaWakeWord.ts` — zero diff vs `main`. The recognizer works perfectly on web; touching it has historically broken Chrome's "one SpeechRecognition holds the mic" rule.

**Backend audit (Supabase MCP):**
- `cenaiva-availability` v8 ACTIVE
- `cenaiva-small-prompt` v4 ACTIVE
- `cenaiva-orchestrate` v161 ACTIVE
- `elevenlabs-tts` v34 ACTIVE
- `user_profiles.cenaiva_tts_voice` column exists (text, nullable)

The two fast-path edge functions live deployed in the project but are NOT committed to `supabase/functions/` in this repo — mobile owns them.

**Verification:**
- `npm run test:run` (apps/web): 98/98 passing across 6 test files.
- `npx tsc --noEmit -p apps/web/tsconfig.app.json`: clean for all new code (5 pre-existing errors in `RestaurantPublicPage.tsx` exist on `main`, unrelated).
- `npm run lint`: 127 problems = exact `main` baseline. Zero new lint errors.
- `git diff -- apps/web/src/hooks/useCenaivaWakeWord.ts`: empty.

**Source plans:**
- `jolly-prancing-clover.md` — full 2,575-line spec.
- `step2-source-handoff.md` — verbatim mobile source for the 3 large helpers + 3 test files. Kept for future cherry-picks.
- `/Users/mark_habbi/.claude/plans/make-a-detailed-plan-floating-sky.md` — execution sequencing.

---

## Booking-flow QA bug fixes — shipped 2026-05-09 (post-rebuild)

QA caught two real bugs the same day the AvailabilityPanel rebuild shipped. Both fixed.

**Bug 1 — Same-diner double-booking.** Two confirmed reservations on Mark Testing at `2026-05-09 16:00 UTC` (party 2 + party 3) landed under one user. Both rows had `user_profile_id=null`, `guest_email=null`, `guest_phone=null`. Their `guest_id` was set but the three partial GiST exclusions (`reservations_user_no_overlap` / `reservations_guest_email_no_overlap` / `reservations_guest_phone_no_overlap`) all WHERE-clause-require at least one of those three; with all three null, the exclusions never fire. The `book_reservation` overlap pre-check has the same gap. Source `'app'` — likely the mobile/voice path that creates a `guest_id` but doesn't ever capture email/phone for an unauthenticated diner.

Fix shipped via `apply_migration` on project `exbjodmnpdiayfzrdyux`:

1. `update reservations set status='cancelled'` for the two visible bad rows.
2. `alter table reservations add constraint reservations_must_have_identifier check (user_profile_id is not null or (guest_email is not null and length(trim(guest_email)) > 0) or (guest_phone is not null and regexp_replace(guest_phone, '\D', '', 'g') <> '')) not valid;` — NOT VALID so historical all-null rows aren't blocked from being read or re-saved; only NEW writes pay the check.
3. `book_reservation` updated: explicit `IF p_user_profile_id IS NULL AND v_email_norm IS NULL AND v_phone_norm IS NULL THEN RAISE EXCEPTION 'missing_identifier' USING ERRCODE='P0007'`. Plus the `INSERT` block now traps `check_violation` and re-raises as `missing_identifier` so the front-end sees a friendly P0007 instead of a 23514.

Verified: `do $$ ... insert all-null ... exception when check_violation ... $$;` correctly catches.

**Bug 2 — Calendar marked all future dates as disabled.** `restaurant_available_dates` was returning the right 16 dates for May 9–31 (party 2), but the panel was rendering them as greyed out. Root cause: `fetchAvailableDateSet` previously returned an empty `Set` on RPC error, indistinguishable from a legitimate "no openings this month." The panel's predicate then disabled every date.

Fix in `apps/web/src/hooks/useAvailability.ts`: `fetchAvailableDateSet` now returns `Set<string> | null`. `null` signals fetch failure (logs a `console.warn` for observability); empty Set retains its meaning of "we asked, no openings." Updated three callers (`AvailabilityPanel`, `ModifyBookingFields`, `RestaurantPreviewModal`) to treat `null` as permissive — predicate falls through and dates remain clickable. Also updated `fetchNextAvailableDate` to treat null as no-result.

**Files modified:**
- (DB) Migration `reservations_require_identifier` — CHECK + RPC update.
- `apps/web/src/hooks/useAvailability.ts` — return type + null-error semantics on `fetchAvailableDateSet`; `fetchNextAvailableDate` checks for null.
- `apps/web/src/components/booking/AvailabilityPanel.tsx` — `.catch` sets `null` (was empty Set); `.then` passes through whatever the helper returns.
- `apps/web/src/components/booking/ModifyBookingFields.tsx` — same pattern.
- `apps/web/src/components/customer/RestaurantPreviewModal.tsx` — state widened to `Set<string> | null`; predicate gates on null; same null-on-error catch.

**Verification:**
- TypeScript: clean.
- Tests: 98/98.
- Lint: 127 problems = exact `main` baseline (zero new errors / warnings).
- `git diff -- apps/web/src/hooks/useCenaivaWakeWord.ts`: empty.
- DB constraint smoke: `do $$ ... insert all-nulls ... $$` correctly raises `check_violation`.

---

## OpenTable-style booking flow rebuild — shipped 2026-05-09

**What:** customer booking widget on `RestaurantPublicPage` rebuilt to OpenTable's pattern. Defaults on cold load (today / closest time to "now" / 2 guests / 6 centered slot pills). Any change to date / time / guests refetches and re-windows. Diner-conflict UX surfaces conflicting slots as DISABLED pills with tooltips instead of silently filtering. Owner dashboard reservations list already auto-refreshes via existing `postgres_changes` subscription on `useReservations.ts:188-207`.

**Phase 3 (deposits) deferred** behind a Stripe test-card smoke run. `PreviewModal` + `ModifyBookingFields` widget unification also deferred — both already work with their existing TimeWheel/SeatWheel UX; only the PublicPage was the surfaced pain point.

**Files shipped:**
- `apps/web/src/components/booking/AvailabilityPanel.tsx` — NEW unified widget (~360 lines). Calendar + TimeWheel popover (30-min target-time picks) + SeatWheel popover + horizontal 6-pill grid + conflict notices. Centered windowing via inline `centerSlotsAround(slots, time, 6)`.
- `apps/web/src/hooks/useAvailability.ts` — added `fetchNextAvailableDate` (today short-circuit, then 60-day `restaurant_available_dates` scan) + `closestSlotTimeToNow` helpers.
- `apps/web/src/pages/customer/RestaurantPublicPage.tsx` — replaced ~170 lines of date/time/party UI with `<AvailabilityPanel>`. Deleted `dateAvailabilityLoading` state, `displayedTimeOptions` memo, `dineInDatePopoverOpen` state, `dinerConflictNotices` memo (panel renders its own), the dead `selectedSlot.booking_date ?? null` fallback, and the unused `bookingFieldsLocked` derived. **All 5 pre-existing TS errors cleared as a side effect.**
- `apps/web/src/hooks/useRestaurantSeatTotal.ts` — NEW (~50 lines). `sum(tables.capacity) where is_active=true`.
- `apps/web/src/pages/dashboard/SettingsPage.tsx` — added "Seat capacity" FieldRow next to turn-time. Owners now see their physical-seat ceiling, with a hint about raising `shifts.max_covers` for whole-restaurant bookings.
- `cenaiva-database.md` — NEW, repo root, ~656 lines / ~5,000 words. Two-mode design: 12 sections of context (schema, RPCs, edge functions, status enums, realtime, RLS, performance rules, error codes, migration ledger), then an actionable 30-item checklist at the bottom for the mobile Claude agent.

**Hard rules preserved:**
- `apps/web/src/hooks/useCenaivaWakeWord.ts` zero diff.
- All atomic write RPCs untouched (`book_reservation`, `modify_reservation_slot`).
- No DDL — Phase 1 / 2 / 4 of the plan are pure client + helper code; Phase 3 (deposits) is the only piece that requires a migration and was deferred.

**Verification:**
- `npx tsc --noEmit -p apps/web/tsconfig.app.json`: **clean** (was 5 errors on `main`, now 0).
- `npm run test:run` (apps/web): 98/98 passing.
- `npm run lint`: 127 problems = exact `main` baseline. **Zero new lint errors.**
- `git diff -- apps/web/src/hooks/useCenaivaWakeWord.ts`: empty.

**Manual smoke (ready for user QA):**
1. Open Mark Testing on Discover → page lands with today / 2 guests / closest time / 6 pills.
2. Bump party to 4 → fresh `get_available_slots_cached` POST, pills update.
3. Pick a pill → contact form auto-fills date+time+party from the slot.
4. Complete booking → confirmation_code returned; row appears on `/dashboard/reservations` within ~1 s without manual refresh.

**Open follow-ups (queued separately):**
- **Phase 3 — Deposits.** Schema (`compute_deposit_cents` SQL fn, `pending_deposit` status, `deposit_due_by` column, `pg_cron` expiry sweep) + dashboard UI for party-size thresholds + `stripe-charge-deposit` edge function + atomic SetupIntent → `book_reservation(pending_deposit)` → charge sequence. Gated by Stripe test-card round-trip in the Supabase project.
- **PreviewModal + ModifyBookingFields visual unification** with `<AvailabilityPanel>`. Both work today with their existing TimeWheel/SeatWheel widgets; only PublicPage was painful enough to fix this round.

---

## Voice-shell production-config fixes — shipped 2026-05-09

Three issues a customer hit on the live voice shell, all fixed in one body of work.

**Issue 1 — Voice-shell map was MapLibre demo tiles.** Refactored `apps/web/src/components/cenaiva/CustomerMap.tsx` from `react-map-gl/maplibre` to Google Maps via `loadGoogleMaps()`. Centralized `CENAIVA_MAP_STYLES` to `apps/web/src/lib/google-maps.ts` (was inlined at `DiscoverPage.tsx:561`); `DiscoverPage` now imports it. Markers are imperative `new maps.Marker(...)` synced against `state.map.marker_restaurant_ids`; click → `dispatch({ type: 'highlight_restaurant', ... })`. Fallback message renders when `VITE_GOOGLE_MAPS_API_KEY` is absent. `maplibre-gl` / `react-map-gl` deps stay in `package.json` for now — separate cleanup if no other consumer is found.

**Issue 2 — Two test restaurants leaked to customers (then policy clarified).** "Mark Testing" (`aaa5e3d3-d8f2-4bae-8615-dc4e6ea83d2c`, Guelph, 2026-03-18) and "Cenaiva Reservation Capacity Test" (`82277919-f810-48df-8898-84895a72c280`, Toronto, 2026-05-05) were both `is_active=true` and surfaced through `usePublicRestaurants()` and the orchestrator's `search_restaurants` tool. Initial response: `UPDATE restaurants SET is_active=false WHERE id IN (…)` via Supabase MCP. **Policy correction (same day):** user clarified self-service signup is intentionally open and the activation gate will be a future Stripe paywall — do NOT change the `is_active=true` signup default and do NOT add an admin approval flow. Reactivated "Mark Testing" (`is_active=true` again); "Cenaiva Reservation Capacity Test" stays deactivated because it's a destructive QA target referenced by `tmp-e2e/concurrent-booking.mjs` (see Incident note 2026-05-07). Open follow-up: Stripe paywall on signup.

**Issue 3 — ElevenLabs disabled in `.env`.** Local `/Users/mark_habbi/Seatly-12/.env` line 61 was `VITE_ELEVENLABS_ENABLED=false`, forcing every TTS call into Web Speech. Flipped to `true`. Vite restart required to pick up. `elevenlabs-tts` v34 is ACTIVE on the Supabase project; if `voicePref.voiceId` is null (user hasn't picked a voice), the edge function falls back to server-side `ELEVENLABS_VOICE_ID` (`8vf2Pg7VZD0Piv8GA8v9` default).

**Files modified:**
- `apps/web/src/components/cenaiva/CustomerMap.tsx` — full rewrite (107→235 lines).
- `apps/web/src/lib/google-maps.ts` — added `CENAIVA_MAP_STYLES` named export (~52 lines).
- `apps/web/src/pages/customer/DiscoverPage.tsx` — replaced inline styles array with import.
- `/Users/mark_habbi/Seatly-12/.env` — line 61 `VITE_ELEVENLABS_ENABLED=true`.
- Live DB: 2 `restaurants` rows updated.

**Verification:**
- Tests: 98/98 passing (no test surface for the map; manual verification only).
- Typecheck: clean for new code (5 pre-existing `RestaurantPublicPage.tsx` errors unchanged).
- Lint: 127 problems = exact `main` baseline. Zero new errors or warnings.
- `git diff -- apps/web/src/hooks/useCenaivaWakeWord.ts`: empty.

**Manual test plan (after Vite restart):**
1. `npm run dev`; sign in; open the voice orb.
2. Map renders with Cenaiva dark theme + restaurant pins (no purple gradient).
3. Network panel: `POST /functions/v1/elevenlabs-tts` returns 200 + `audio/mpeg`.
4. Ask "find restaurants near me" or "find restaurants in Guelph" — neither test restaurant appears.
5. Click a pin → marker turns gold, assistant store updates.

---

## Open follow-ups

**Concurrency:** ceiling work is done — see `CONCURRENCY_PLAN.md`. The only remaining lever is **compute upgrade** (Small ~$5/mo when traffic regularly hits 1,500+ concurrent; Large ~$100/mo for the 30k-user launch target). CDN was evaluated and declined for now; revisit criteria in `CONCURRENCY_PLAN.md` → "CDN deliberation".

**Speed (per-user perceived speed; doesn't affect ceiling):**
1. **Real-user metrics (RUM) wiring** — Vercel Analytics or `web-vitals` so production speed is measured, not extrapolated. ~30 min.
2. **Phase 4.1 — extend SQL availability to `cenaiva-orchestrate` + `cenaiva-chat`** — both still on legacy 50-query path. ~1 hr.
3. **Phase 8 — marketing prerender** — biggest remaining LCP win for marketing/SEO traffic. ~30 min.
4. **Lazy zod in `@cenaiva/assistant`** — ~19 KB gz off first paint. ~45 min.
5. **Phase 9 — dashboard cleanup** — TanStack Query for staff hooks + sidebar prefetch. Staff-only, lower priority. 1–2 days.

**Onboarding / monetization:**
- **Stripe paywall on `signup-restaurant-owner`** — paid tier required to flip `is_active=true` (or to show the restaurant in customer Discover / Deals / voice-shell). Today every signup lands `is_active=true` for free, which is intentional pending this work but has obvious abuse risk. Touch points: edge function (charge → activate), `/account/billing` page, webhook for renewal/cancellation that toggles `is_active`. Defer until the product team scopes pricing tiers.

---

## Lessons / gotchas worth remembering

- **TanStack Query empty-array trap.** `query.data ?? []` creates a new empty array every render until data loads. Downstream `useMemo`s re-fire → effects re-fire → setState → re-render → "Maximum update depth exceeded." Always use a stable singleton (`const EMPTY: Foo[] = []` outside the hook). Caught this during Phase 2 verification when DiscoverPage's `restaurantIds` useMemo went infinite.
- **Lazy-load preload trap.** Lazy-loading a component doesn't help if its chunk is in the entry's `<link rel="modulepreload">`. Verify by `grep -oE 'from"\./[^"]+\.js"' dist/assets/index-*.js` — the entry's static deps must not include any chunk you're trying to defer.
- **Internal helpers can break chunk strategies.** Vite's `vite/preload-helper.js` got hoisted into `vendor-map`; the entry imported the helper, transitively pulling vendor-map. Always pin `vite/(preload-helper|client|env)` and similar internals to a chunk the entry already loads.
- **Lighthouse single-run variance.** Desktop runs can swing 800ms ↔ 2500ms LCP. Always average 3+ runs before claiming a delta.
- **`vite preview` doesn't gzip.** Real-world numbers behind a CDN with brotli are ~3× faster on transfer. Don't take preview Lighthouse numbers as production reality.
- **`react-refresh/only-export-components`** fires on any non-component export from a `.tsx` file. Constants → sibling `*Constants.ts`. Provider + hook + context value → split into `Provider.tsx` + `*-context.ts` (`createContext` + value type) + `useX.ts`. Mirrors the existing `auth-context*` triad. Caught when adding `NO_AUTO_RELISTEN_STATUSES` to `AssistantStore.tsx` (already a "components" file with non-component exports — adding more bumped the lint count).
- **Refs assigned during render trigger `Cannot access refs during render`.** `voiceIdRef.current = options?.voiceId ?? null` outside `useEffect` is illegal. Wrap in `useEffect` keyed on the source dep. Caught when threading `voiceId` from `useCenaivaVoicePreference` into `useElevenLabsTTS`.
- **Backend functions can be deployed but uncommitted.** Mobile owned `cenaiva-availability` + `cenaiva-small-prompt` — ACTIVE in the live project but absent from `supabase/functions/`. `ls supabase/functions/` alone misled the initial audit; verified live via `mcp__plugin_supabase_supabase__list_edge_functions(project_id='exbjodmnpdiayfzrdyux')`.
- **Vitest config: explicit imports + `globals: false`.** `import { describe, it, expect } from 'vitest'` per file. Avoids needing `vitest/globals` in `tsconfig.app.json` `types`, which would force re-listing every `@types/*` we still want auto-included. Also skips the global-namespace TS noise.
- **Pre-existing build/lint baseline.** `npm run build` was already failing on `main` due to 5 errors in `RestaurantPublicPage.tsx` (unrelated to Cenaiva). `npm run lint` had 127 problems on `main`. Always capture baseline first via `git stash --include-untracked` then re-run, so you don't conflate pre-existing breakage with new work. CI/automation that fails the whole pipeline on any lint error is misleading until the baseline is cleaned.
- **Schema drift adapters live at parse boundaries, not in ported helpers.** Mobile's `FiltersDelta.cuisine` is `string`; web's is `string[]`. Resolved with a `firstCuisine()` helper at the parse site inside `recommendationIntent.ts`, NOT by editing the port's input shape. Keeps mobile cherry-picks clean.
- **Restaurant-shape divergence ditto.** Mobile `Restaurant` is camelCase + `area`/`tags`; web is snake_case + neither. `apps/web/src/lib/cenaiva/restaurantAdapter.ts` maps web → mobile shape at every call site that feeds restaurants into a ported helper. Never edit `filterRestaurants.ts` / `localBookingCollector.ts` to match web.
- **Self-service restaurant signup is intentionally open.** `signup-restaurant-owner` defaults `is_active=true`; new restaurants land customer-visible immediately. The future activation gate is a Stripe paywall (planned, not built). Don't add an admin-approval flow or change the signup default — both were considered and rejected on 2026-05-09. Caveat: destructively-named QA targets (e.g. "Cenaiva Reservation Capacity Test") are an exception — they stay deactivated to keep them out of customer search.
- **`VITE_*` flags require a Vite restart.** Local `.env` `VITE_ELEVENLABS_ENABLED=false` forced Web Speech fallback for an unknown stretch. Editing `.env` doesn't auto-reload the dev server; always restart after env changes. Always grep the local `.env` for unexpected `=false` overrides before chasing client-side TTS / feature bugs.
- **MapLibre demo tiles look like a designed background.** The purple/blue gradient + diagonal line is the signature of `https://demotiles.maplibre.org/style.json`. If a map area shows that pattern, the style URL is unset (or pointed at the demo) — not a styling intent. Voice shell shipped this way for an unknown stretch until 2026-05-09 because `VITE_MAPLIBRE_STYLE_URL` was never set and there was no fallback message. Switched the voice shell to Google Maps (which DOES have a "key missing" fallback message) to avoid this trap.
- **Conflict UX should explain itself.** Silently filtering a diner's overlapping slot just makes the UI look broken — they don't know why the time they wanted is missing. Render the conflict pill as DISABLED with a tooltip naming the conflicting reservation's restaurant + window. The data is already available via `useDinerConflictWindows` + `formatConflictWindow`; the bug was the UI choice to filter instead of disabling.
- **Risk profiles are wildly different across phases of a feature.** OpenTable-style booking has 4 phases on this codebase: widget rewrite (data-layer reuse, low risk), seat-cap hint (pure UI, trivial), deposits (Stripe + cron + migrations, medium risk), mobile-agent doc (zero risk). The first three look related but have completely different ship gates. Don't bundle the medium-risk one with the low-risk ones — split the PR.
- **OpenTable's pattern is exactly the AvailabilityPanel design.** Their docs (Booking Policies, Availability Controls, Deposits, Resolve Table Conflicts) describe defaults + 6 pills + auto-refetch + per-restaurant deposit thresholds — and our existing data layer already supports the first three out of the box. The only NEW capability we needed for parity (besides UI polish) is the deposit flow.
- **Partial GiST exclusions only fire when the WHERE clause matches.** Three exclusions on `reservations` (user_profile_id, guest_email, guest_phone) collectively cover every legitimate diner-identifier path BUT silently allow writes where ALL THREE are null. The book_reservation overlap pre-check had the same gap. Pair partial exclusions with a CHECK constraint that requires at least one of the keyed columns to be non-null — otherwise an all-null row is invisible to every uniqueness/overlap check.
- **Empty-set vs null is a critical UX distinction in calendar predicates.** `fetchAvailableDateSet` returning empty Set on RPC error meant "no openings" and "fetch failed" rendered identically: a calendar full of greyed-out dates. Switched the helper to return `null` on error and made predicates treat null as permissive (don't disable). Lesson: any "loading/error/no-results" tristate must pick three distinct return values, not collapse to one of the three meanings.
- **`source='app'` is undocumented but in production.** The reservations table has source values `'web' | 'cenaiva' | 'staff' | 'dashboard' | 'app' | 'qa-test'`. The `'app'` source is likely the mobile or voice path; it was the source of both all-null rows that bypassed identifier checks. Audit any new edge function that writes reservations to confirm it sets `source` to a known enum value AND captures at least one identifier.
- **Imperative Marker management with React.** `react-map-gl/maplibre` has React `<Marker>` JSX; raw Google Maps JS API does not — markers are `new maps.Marker(...)` and must be tracked in a ref `Map<id, { marker, listener }>`. On marker-set diff: remove markers no longer in the visible set, update icons/labels for ones that are, create new ones for newcomers. Always copy `markersRef.current` to a local var inside the init effect so the cleanup runs against the right Map instance (caught a `react-hooks/exhaustive-deps` warning the first try).


---

## Migrated from CLAUDE.md headline state (moved 2026-05-13)

_The following entries lived in CLAUDE.md's "Headline state" sections during active iteration. Moved here once the behavior was stable to keep CLAUDE.md focused on hard rules + current-week state. Preserved verbatim for traceability — see the migration date on each entry for chronology._

## Headline state (2026-05-11)

- **Casual booking intent — "I want to go to X" deterministic handler
  (2026-05-11, orchestrator v270).** User reported: "I want to go to
  harbour sixty because a friend recommended me it and I want to take
  my girlfriend there" returned `"Which menu do you want to see?"` —
  the LLM misclassified a clear booking intent as a menu/discovery
  question. Root cause: `clearlySmallPromptIntent` flagged the
  transcript as small-prompt (no "menu"/"modify"/etc. exclusion words),
  `bookingProcessIntent` didn't recognize "I want to go to X" /
  "take my girlfriend to Y" / "let's go to Z" / "hit up X" / "i'd like
  to try X" as booking intents, so isSmallPromptTurn=true and the LLM
  small-prompt path ran without a deterministic guardrail.
  Fix in two layers:
  1. `directBookingIntent` (line 2420) extended with two new regex
     groups: first-person casual intent (`i want to go to X`,
     `let's go to X`, `wanna hit up X`, `i'd like to try X`,
     `i'm going to dine at X`) AND companion-take (`take my girlfriend
     to X`, `bring the family to Y`, `treat my date at Z`).
     With these in `bookingProcessIntent`, the small-prompt classifier
     no longer intercepts.
  2. New deterministic handler in `buildPreflightResponse` (before
     menu Q&A + LLM tool loop): same regex extracts the restaurant
     name candidate, fuzzy-matches against `fetchActiveRestaurants()`
     with accent-strip + spelling-variant (harbor↔harbour) +
     number-word variant (60↔sixty) expansion, requires a strong
     match (every token of candidate found in name), infers party
     from "take my <companion> to X" → 2 OR "for N" pattern, and
     returns `{ status: collecting_minimum_fields, restaurant_id,
     restaurant_name, party_size }` with start_booking +
     highlight_restaurant ui_actions. Spoken: "Got it — <name>{ for N}.
     {What date and time?|How many guests?}".
  Verified end-to-end against the user's exact phrasing + 3 variants:
  all resolve correctly to the named restaurant. No more "which menu"
  hijack.
- **Concierge click auto-starts mic with greeting (2026-05-11).** The
  Concierge button in `CustomerNav.tsx` was calling
  `assistant.open(undefined, undefined, { autoListen: false })` — so
  clicking it opened the drawer silently with no greeting and no mic.
  Users had to tap the orb to start talking. Changed to call
  `buildWakeGreeting(user)` and pass `{ autoListen: true, greetingText }`
  so the click flow mirrors the wake-word flow: AI greets ("Hey, Mark!
  How can I help?") and the mic auto-opens for the user's first reply.
- **search_restaurants spelling + number variants (2026-05-11).** User
  said "Harbour 60" / "Harbour Sixty" → Deepgram transcribed as "harbor
  60" (US spelling) → orchestrator's ILIKE `name.ilike.%harbor%` MISSED
  "Harbour Sixty Steakhouse" (Canadian "u" spelling) → zero-result
  fallback ranked by distance and returned Georgy Inc (Milton, closer
  to user) instead of the actual restaurant the user named. Added
  spelling-variant expansion in the query splitter:
  `harbor↔harbour, center↔centre, theater↔theatre, flavor↔flavour,
  color↔colour, meter↔metre, liter↔litre, traveler↔traveller,
  honor↔honour`. Plus number-word variants for 10/20/.../100 so
  "Harbour 60" and "Harbour Sixty" both match. Short numeric tokens
  (length < 3) are kept when they map to a NUMBER_WORDS entry. Without
  this fix, even the LLM's fallback "did you mean" suggestion was
  ranking the wrong restaurant.
- **Mic-turn tightening + idle auto-close + wake debounce (2026-05-11).**
  Three voice-shell behavior changes shipped together to stop mic burn
  when the user has stepped away.
  - **`MAX_EMPTY_RELISTENS = 20`** in `AssistantProvider.tsx`. Briefly
    tried `1` on 2026-05-11 evening (~5s of patience) — that was too
    aggressive: users got their mic closed mid-thought after the AI
    asked a question. Bumped to 20 (≈100s of patient mic-on) — the
    IDLE_AUTO_CLOSE_MS timer (120s) is the real "user gave up" signal,
    so this cap is just a safety net against a stuck recognizer
    looping forever.
  - **`IDLE_AUTO_CLOSE_MS = 120_000`**. Two-minute idle timer that
    runs while assistant is open AND `voiceStatus === "idle"`. Resets
    automatically via a `useEffect([state.isOpen, state.voiceStatus])`
    whenever voice flips back to idle (after AI speaks, after empty
    turn). When timer fires, closes the assistant gracefully (which
    also stops the mic + wake-word recognizer). Skipped if voice is
    mid-flow (listening / processing / speaking).
  - **`WAKE_DEBOUNCE_MS = 3_000`**. The wake recognizer's fuzzy phrase
    matcher occasionally bursts onWake calls in quick succession
    ("hey sanibel", "hey son iv", "hey soniva" all matching as Hey
    Cenaiva). `lastWakeFireMsRef` blocks consecutive fires within 3s
    so the open-greeting flow doesn't stack on top of itself.
  None of these touch `useCenaivaWakeWord.ts` (the recognizer file
  remains under the existing "no modifications" hard rule). All three
  knobs live in `AssistantProvider.tsx`.
- **Direct "book me for [event-name] at [restaurant] for [N]" voice
  handler (2026-05-11, orchestrator v266).** New deterministic handler
  inside `buildPreflightResponse` (after menu Q&A, before
  `confirmPendingAction`). Catches phrasings like "book me for chef
  tasting menu at mark testing for 2" / "reserve a table for live music
  friday at baton rouge". Resolution:
  1. Regex extracts `event_name_candidate` + optional `at <restaurant>`
     + optional `for <N>` (digits).
  2. Restaurant resolved via accent-stripped token-score against
     `fetchActiveRestaurants()`; falls back to `bookingState.restaurant_id`.
  3. Event resolved via accent-stripped token-score against
     `events` (active, non-private, future, scoped to restaurant_id when
     present); requires score ≥ floor(tokens/2).
  4. Event capacity sanity-check — if `partyHint > seatsLeft`, voice
     replies "Event only has N seats left — too few for partyHint" and
     stays in collecting_minimum_fields.
  5. Resolves `shift_id` + `slot_iso` by calling
     `getAvailability(restaurant_id, event.date, partyHint)` and matching
     the slot whose `display_time` maps to `event.start_time`. Without
     this, the turn-2 confirmation handler at line 5414 bounces with
     "I need the reservation details again."
  6. Patches `booking_state` with: `status: "confirming"` (when party +
     shift_id + slot_iso resolved), `restaurant_id`, `restaurant_name`,
     `date`, `time`, `party_size`, `offered_events: [{id, name, date,
     start_time, end_time}]`, `shift_id`, `slot_iso`.
  7. Spoken text: "Got it — <event.name> at <restaurant_name> on <date>
     at <time> for <N> guests. Confirming?".
  Guarded by `isBookingUtterance` — only fires when transcript contains
  `book|reserve|table|seat` + `me|us|a table`. Required parallel changes:
  - **`@cenaiva/assistant` schema + types** — added `offered_events` /
    `offered_promotion` to `BookingDeltaSchema`, `BookingState`,
    `BookingDelta`. Without these, the client's `OrchestratorRequest`
    serialiser dropped `offered_events` on turn 2 and the orchestrator
    couldn't resolve which event the user was confirming.
  - **`AssistantProvider.tsx` booking_state payload** — added
    `restaurant_name`, `offered_events`, `offered_promotion` to the
    fields forwarded to `/cenaiva-orchestrate` on every turn.
  - **`AssistantStore.tsx` initialBooking** — added
    `offered_events: null`, `offered_promotion: null`.
  Verified end-to-end on 2026-05-11: confirmation code `EC7C3346`,
  status='confirmed', event_id linked, SMS body contains "Event: Chef
  Tasting Menu.". The post-search auto-attach path (`any events at X`
  → `book it for 2`) still works via the existing `resolveEventAttachment`
  helper since `offered_events` now round-trips properly.
- **Voice menu Q&A always answers (2026-05-11, orchestrator v262).**
  Pre-`buildPreflightResponse` has a new menu Q&A handler before
  `confirmPendingAction`. Pattern catches `what's on the menu` /
  `appetizers` / `entrees` / `mains` / `starters` / `desserts` /
  `kids menu` / `drink|wine|beer|cocktail (list|menu)` / `specials`
  (without "tonight") / `do they have (vegan|vegetarian|gluten|halal|
  kosher|fish|seafood|steak|pasta|burger|pizza|salad|brunch)` / bare
  `any desserts` / `got starters` etc. Guarded by an `isBookingUtterance`
  check so "book me for chef tasting menu at mark testing for 2" (where
  the event happens to be named ending in "Menu") doesn't get hijacked
  as a menu question. Resolves restaurant via "menu at <name>" /
  "<name>'s menu" patterns OR `bookingState.restaurant_id` (mid-booking
  + post_booking). Queries `menu_items` ordered `is_featured DESC,
  sort_order ASC`, filters by category keyword in transcript (vegan /
  drinks / appetizer / main / dessert / kids), returns spoken text
  listing 3-4 items with prices + "Want a table?". Verified via direct
  edge-function probes 2026-05-11: "what's on the menu at mark testing"
  → "On the menu at Mark Testing: Lamb Kofta ($22), Wood-Fired Whole
  Branzino ($58), Lamb Shank Tagine ($46), Stevie sandwich ($100), and
  11 more. Want a table?". `menuQuestionIntent` (line 2591) extended
  with category-only + possessive + "any vegan options" patterns so the
  orchestrator's small-prompt gate doesn't strip these utterances before
  preflight runs. The PREORDER hand-off (line 4142) narrowed to ACTIONS
  only: `pre[- ]?order|prepay|order ahead|skip the line|order now|
  add (?:it )?to (?:my )?(?:cart|order)|checkout|pay (?:now|for)|
  charge my card`. Menu words no longer trigger hand-off. Per user
  2026-05-11: voice should always answer menu questions; only true
  card-required actions hand off.
- **SMS event/promo enrichment on modify + cancel (2026-05-11).** Both the
  voice path (`cenaiva-orchestrate` modify + cancel branches) and the web
  edge functions (`modify-reservation`, `cancel-reservation`) now look up
  the event/promotion linked to the reservation and append one of these
  lines to the SMS body:
  - ` Event: <event.name>.` (when event_id is set)
  - ` Promo: <promotion.title> (code <promo_code>).` (when promotion_id is
    set and the joined row has a promo_code)
  - ` Promo code: <applied_promo_code>.` (bare code, no joined promo row)
  The reservation row's SELECT clause was extended in all three places to
  include `event_id, promotion_id, applied_promo_code` so the lookup has
  something to work with. Edge functions are at versions modify-reservation
  v15 and cancel-reservation v11 (2026-05-11). Verified end-to-end via
  `communication_log` table: event modify + cancel SMS contain `Event:
  Chef Tasting Menu.`; promo modify + cancel SMS contain `Promo: Weekday
  Lunch Deal — 20% Off (code WEEKDAY20).`.
- **`useMyReservations` split-query (2026-05-11).** Diners with thousands of
  duplicate-submit cancellations (Mark Habbi had 2,323 guest rows / 2,172
  reservations from test runs) had their /bookings page show 0 upcoming
  because the old hook did `guests.select.in("guest_id", […2300 ids])` which
  414'd or sorted later cancellations ahead of active rows when limit hit.
  Hook now (a) queries `reservations` directly by
  `user_profile_id.eq.X,guest_email.eq.Y,guest_phone.eq.Z` OR filter, (b)
  splits into two parallel queries — non-cancelled (no date floor, limit
  500) + cancelled (last 90 days, limit 200). Active bookings always visible
  regardless of cancellation backlog.
- **BookingDetailsPage event/promo rows (2026-05-11).** /bookings/:id page
  now renders three new DetailRows below the existing date/time/party block:
  `Event` (with per-person price when set), `Promotion` (with promo_code in
  parens), bare `Promo code` (when only `applied_promo_code` set). Diners
  can see exactly which event/promo their booking was made for.
- **`/deals` no longer gated by `<RequireCustomer>` (2026-05-11).** Same as
  the `/bookings` fix in the prior cycle — owners can also be diners (they
  book at OTHER restaurants), so the customer-only redirect was wrong.
  Auth-gated only now.
- **`bookingLockedFromPreview` requires `slot=<ISO>` (2026-05-11).** Was
  `Boolean(slot || time || date || people)` which hid the AvailabilityPanel
  for /deals → public-page navigations that only carried `date/time/people`
  (no real ISO slot to lock onto). Continue button was unreachable. Now
  `Boolean(searchParams.get("slot"))` — only locks when the preview modal
  / pill-click flow passed an exact ISO slot. /deals → bookItem flow shows
  the panel with `date/people` pre-filled so the diner picks a real slot.
- **EventPromotionDetailCard rebuilt with chip popovers (2026-05-11).**
  DATE/TIME/PARTY controls now use the same `<Popover>` + `<Calendar>` +
  `<TimeWheel>` + `<SeatWheel>` pattern as `<AvailabilityPanel>`. Constraint
  rules:
  - Single-day event/promo (rawEndDate null or = rawDate) → DATE chip
    disabled, calendar disable-predicate blocks every other date.
  - Multi-day → calendar bounded to `[rawDate, rawEndDate]`.
  - `events.fixed_arrival_time = true` OR no `end_time` → TIME chip disabled,
    pinned to start_time.
  - `promotions.start_time_of_day`/`end_time_of_day` → TimeWheel options
    generated at 30-min steps from start to end (inclusive).
  - PARTY SeatWheel capped at `min(seatsLeft, 20)`.
  Chips stack vertically (`grid-cols-1`) inside the 300px aside so values
  ("Mon, May 11", "10:00 AM", "2 guests") render in full instead of
  truncating to "Fr…" / "8:…" / "2 …".


## Headline state (2026-05-10)

- **Voice mic always-on + manual mute (2026-05-10).** Mic now auto-resumes
  in EVERY booking status except `paid` (which auto-closes 1.5s later).
  Previously gated 8 statuses (preorder/menu/checkout/tip/charging) — those
  paths are now hand-offs to the public restaurant page, so the mic
  never enters them via voice. Added a manual mute toggle on
  `<CenaivaVoiceShell>` (top-right, next to close X). When muted: mic
  off across turns, AI TTS still plays. `useCenaivaVoice.toggleMute`
  flips `isMuted` state; `AssistantProvider.muteRef` mirrors it for
  setTimeout-based auto-resume callbacks. Files:
  `assistantStoreConstants.ts` (set reduced to `{paid}`),
  `useCenaivaVoice.ts` (isMuted + toggleMute), `AssistantProvider.tsx`
  (muteRef + every auto-resume gate), `CenaivaVoiceShell.tsx` (mic
  toggle button using lucide Mic/MicOff icons).
- **Post-action "Anything else?" close prompt (2026-05-10).** After
  every successful book / modify / cancel, the orchestrator appends a
  randomized "Anything else?" pool to the spoken_text and queues
  `pending_action: { type: "session_end_check" }`. On the next turn,
  `confirmPendingAction` checks `session_end_check` BEFORE the standard
  affirmative/negative classifier (semantics flipped: "no" = end session).
  - "no" / "nope" / "I'm good" / "that's it" / "nothing else" / "all done"
    / "no thanks" → emit `ui_actions: [{ type: "close_assistant" }]` +
    goodbye line ("Anytime — talk soon!" / "Take care!" / etc.), pendingaction null, status idle.
  - Anything else → mutate `bookingState.pending_action = null` and
    return null so the caller falls through to the normal preflight/LLM
    flow. This lets pivots ("show me deals", "different restaurant")
    or new requests work without manually clearing the pending action.
- **Session-pivot intents — map / deals / different-restaurant
  (2026-05-10).** New block at the top of `buildPreflightResponse`,
  gated on `status in {idle, confirmed, post_booking}` so it only fires
  AFTER a successful action. Patterns:
  - `\b(?:show me|take me to|go to|back to|see)\s+(?:the\s+)?map\b` or
    `\b(?:back to|return to)\s+discover\b` → `ui_actions: [{ navigate
    "/discover" }, { close_assistant }]`.
  - `\b(?:show me|any|see|got)\s+(?:the\s+)?deals?\b` or `\b(?:are
    there|do you have)\s+any\s+deals?\b` → `navigate "/deals" + close`.
  - `\b(?:different|another|new)\s+restaurant\b` → resets booking,
    keeps assistant open, prompts "Sure — where to?".
  Client-side `simplePromptIntent.ts` adds `SESSION_PIVOT_PATTERN` so
  these phrases also short-circuit Stage 3 small-prompt and route to
  the orchestrator.
- **Voice declines preorder + deposit (hand-off pattern, 2026-05-10).**
  Voice no longer enters `offering_preorder` / `browsing_menu` /
  `reviewing_cart` / checkout / tipping / payment statuses. Those are
  HAND-OFFS to the public restaurant page (`/{slug}?...`).
  - **Preorder hand-off** (`buildPreflightResponse`, after session
    pivot, before `confirmPendingAction`): catches
    `pre[- ]?order|prepay|order ahead|skip the line|order now|menu|
    appetizers?|entrees?|mains?|kids?\s+menu|drink list|wine list|beer
    list` AND requires `bookingState.reservation_id` + `restaurant_id`.
    Looks up the slug, navigates to `/{slug}?confirmation={code}` and
    emits `close_assistant`. Spoken: "Pre-orders need the menu screen
    — I'll take you there to finish." (3 random variants).
  - **Deposit hand-off**: in the LLM-tool `complete_booking` branch
    (~line 6470) AND the post-loop auto-finalize path (~line 7103),
    BEFORE `completeBooking` runs, query `compute_deposit_for_party
    (restaurant_id, party_size)`. If > 0: don't book, push `navigate`
    + `close_assistant`, set `bookingDelta.handoff_reason =
    "deposit_required"`. The hard-override (~line 7270) replaces
    spoken_text with "This booking needs a $X-per-guest deposit — I
    can't process card details by voice. Sending you to the page with
    everything pre-filled.". URL prefill uses the existing public-page
    params: `?date=YYYY-MM-DD&time=HH:mm&people=N&shift_id=...`.
  - **System prompt updated** to tell the LLM: do NOT call
    `offer_preorder`, `get_menu`, `create_preorder_order`,
    `set_tip_choice`, `set_tip`, `set_payment_split`, or
    `charge_saved_card`. The orchestrator's preflight handles all
    those flows via hand-off.
  - **Client-side**: `AssistantStore.applyUIAction("show_confirmation")`
    now sets `status: "post_booking"` (was `offering_preorder`). The
    safety-net at line 567 (in `APPLY_RESPONSE`) also forces
    `post_booking` instead of `offering_preorder`. **Removed** the
    `AssistantProvider.tsx:572-579` preorder-prompt appender — the
    "Anything else?" block in the orchestrator owns the follow-up now.
- **Concurrent-user ceiling: ~2,250** active Discover/Deals browsers on
  Micro compute (Supabase ca-central-1), p95 < 1 s, 0 failures.
- **SMS confirmations wired into voice book/modify/cancel
  (2026-05-10).** The voice flow bypasses the public edge functions
  (`create-public-booking`, `modify-reservation`,
  `cancel-reservation`) where SMS sending lived, so users got SMS
  for web bookings but NOT for voice-assistant bookings. Fixed:
  - `_shared/reservation-notifications.ts`'s
    `sendReservationNotification` now also accepts
    `type: "reservation_confirmation"` (was modify/cancel only).
  - `_shared/booking.ts` `completeBooking` calls
    `sendReservationNotification` after the `book_reservation` RPC
    succeeds. Builds the SMS body inline (mirrors create-public-
    booking's wording) including manage link.
  - `cenaiva-orchestrate/index.ts` `confirmPendingAction` now
    sends SMS in BOTH the cancel branch (after
    `release_reservation_tables`) and the modify branch (after
    `modify_reservation_slot` + optional special_request update).
    Each fetches the latest reservation row + guest record and
    builds a body with the new/updated/cancelled time.
  All three calls wrapped in try/catch — notification failure
  must NOT block the booking response. Verified end-to-end via
  computer-use: book → SMS, modify → SMS, cancel → SMS, all
  visible in `communication_log` with `channel='sms'`,
  `status='sent'`. Twilio env vars (`TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`) already configured;
  user phone is normalized to `+1<10 digits>` before sending.
- **Stale `reservation_tables` cleanup pattern.** When a cancel
  fails to call `release_reservation_tables` (orphaned by an old
  bug, manual SQL update, etc.), `reservation_tables.released_at`
  stays NULL and the partial-exclusion `reservation_tables_no_overlap`
  blocks new bookings at that slot — surfacing as 23P01. Recovery
  query (safe — only releases tables for already-cancelled rows):
  ```sql
  UPDATE reservation_tables SET released_at = now()
  WHERE released_at IS NULL
    AND reservation_id IN (
      SELECT id FROM reservations WHERE status = 'cancelled'
    );
  ```
- **Cancelled-only reservation history → safe state (2026-05-10).**
  When `singleReservationKind` / list handlers picked a CANCELLED row
  (no active rows exist), they used to promote
  `reservation_id` + `status="post_booking"` into booking_state. Result:
  the UI rendered "You're booked!" for a cancelled row, AND a follow-up
  "modify it" / "cancel it" tried to act on the cancelled rid, surfacing
  errors. Both handlers now check `isActive = status !== "cancelled"
  && !isPastActive(row)` and return `booking: { status: "idle" }` for
  cancelled/past picks. The spoken text still describes the cancelled
  reservation ("Most recent on file: X — but it's cancelled") so the
  user knows what happened.
- **Modify/cancel referencing prior context with no rid → helpful
  fallback (2026-05-10).** When the user says "modify it" / "cancel
  it" / "change that" but `booking_state` has NO active reservation
  (because the most-recent was cancelled), the orchestrator now runs
  a deterministic check that:
  1. Queries the user's active future reservations.
  2. Returns "You don't have any active reservations to change. Want
     to book a new one?" if none.
  3. Promotes the only active row + asks for confirmation if exactly
     one exists.
  4. Asks the user to pick if multiple.
  Without this, the request fell through to the LLM tool flow which
  responded with the generic "What restaurant or area should I book?"
  — confusing because the user clearly meant to act on an existing
  reservation.
- **AssistantProvider Stage 1 skip for modify/cancel/list intents
  (2026-05-10).** `planLocalBookingTurn` was parsing "5pm" out of
  "modify it to 5pm" as a new booking time and emitting the local
  collector's "What restaurant or area should I book?" prompt. Added
  `isModifyOrCancelRef` and `isReservationListQuery` regex guards so
  these requests skip Stage 1 entirely and reach the orchestrator's
  modify / cancel / list handlers (which know how to look up the
  reservation).
- **Mic auto-resumes on `post_booking` (2026-05-10).** Removed
  `post_booking` from `NO_AUTO_RELISTEN_STATUSES`. After the assistant
  shows a reservation card (whether from "what's my next reservation"
  or after a fresh book), the mic auto-reopens so the user can say
  "modify it" / "cancel it" / "show me my next one" hands-free. The
  previous gate forced the user to click the mic — broke the
  voice-first flow. Checkout / payment / menu statuses still gate the
  mic because button taps are faster there and the mic could pick up
  card-entry chatter.
- **Party-size parsing — colloquial coverage (2026-05-10).** Added
  patterns for "the both of us" / "both of us" / "us two" → 2;
  "myself and one other" / "me and another" → 2; "a couple" /
  "a duo" / "a pair" → 2; "half a dozen" → 6; "dozen" → 12;
  "me and N others/friends/people" → 1+N; "just the (two|three|four)
  of us" → that number. Added validation: `peopleMatch` rejects 0 or
  >99 (so "0 people" / "200 people" route back to "How many guests?"
  instead of accepting nonsense). Reordered "couple" check to run
  BEFORE the older `(party of|table for|for|...)\s+(...|a|couple|...)`
  pattern so "for a couple" doesn't get captured as bare "a" → 1.
- **Modify-verb expansion + parser robustness pass (2026-05-10).**
  The orchestrator's deterministic modify branch and the upstream
  routing both failed on "modify it to 5pm" because **`modify`
  itself wasn't in the verb regex** (only `change|move|switch|update|
  make it|add|reschedule`). Added `modify|push|bump|shift|adjust|
  edit` everywhere a modify-verb regex appears (modify branch first
  test, `bookingProcessIntent` fallback, client `simplePromptIntent`).
  Same pass also extended:
  - **`parsePartySize`**: catches `2 ppl` / `party 2` / `couple of us` /
    `two of us` / `me and a friend` / `me and 2 others`. Reordered so
    "me and a friend" wins over "just me" — was returning party=1 for
    "just me and a friend" before.
  - **`parseDateInTimeZone`**: catches abbreviations `weds`/`wed`/
    `thurs`/`fri`/etc (table maps each weekday to its short forms).
  - **`parseTime`**: catches "saturday eight pm" / "tomorrow nine pm"
    (DAY-name as preposition before bare-word time), and bare-word
    time `eight pm` anywhere when followed by explicit am/pm.
- **AssistantStore reducer full-reset on transition to idle from
  cancel (2026-05-10).** The reducer used to keep `time`/`date`/
  `party_size`/`restaurant_id` after cancel-success transitioned
  `status=post_booking → idle`. Result: "book mark testing for 2
  thursday at 6pm" right after a cancel inherited the cancelled
  reservation's 4PM time. Now resets the booking to `initialBooking`
  with only the patch overlaid (and preserves `restaurant_id` only
  if the patch explicitly set it — fact-lookup still highlights
  the Q'd restaurant). Verified end-to-end via UI: cancel → "book
  X for N day at TIME" picks up the new TIME correctly.
- **Mic auto-resume already wired (Option A).** After a turn,
  `voice.startListening` is called via `setTimeout` (260ms delay,
  `RELISTEN_AFTER_RESPONSE_MS`) **unless** booking_state.status is
  in `NO_AUTO_RELISTEN_STATUSES` (offering_preorder, browsing_menu,
  reviewing_cart, choosing_tip_*, charging, paid, post_booking) OR
  the user is in text input mode. Voice mode → mic auto-reopens
  after AI speaks. Text mode → mic stays off (user is typing).
  Don't change this; matches mobile behavior + the user's
  preference.
- **Voice-assistant fact/global question routing — 4-stage skip
  (2026-05-10).** The `simplePromptIntent` client classifier now catches
  the wider fact-lookup vocabulary (`about`, `like`, `kind`, `type`,
  `sort`, `reviews?`, `rating`, plus vibe words: `quiet`, `loud`,
  `trendy`, `hip`, `cozy`, `kid-friendly`, `family-friendly`) AND a
  new `GLOBAL_DISCOVERY_QUERY_PATTERN` for `closest`/`nearest`/
  `near me`/`nearby`/`best cuisines`/`promotions`/`deals`/`events`.
  Without these, "what is X about" / "any deals tonight" / "best
  cuisines" routed to Stage 3 small-prompt LLM (no DB access) and
  the user got generic "I'm not sure" replies instead of the
  orchestrator's deterministic answers. **AssistantProvider Stage 1
  also skips `planLocalBookingTurn` for these queries via
  `isFactOrGlobalQuery` regex** — otherwise the local collector
  parses "tonight" as a date in "any deals tonight" and routes to
  Stage 2 availability check, which returns the restaurant's HOURS
  instead of the deals message. The guard is in
  `AssistantProvider.tsx` right next to `isPureGreeting`. Don't
  remove it.
- **AssistantStore reducer auto-clears post_booking on transition
  to idle (2026-05-10).** When a fact-lookup or global-question
  response patches `booking.status === "idle"` AND the prior state
  was `post_booking` / `paid` / `confirmed`, the reducer now
  explicitly nulls `reservation_id`, `confirmation_code`,
  `slot_iso`, `shift_id`, `pending_action`, `special_request`, and
  resets `customerAccepted = false`. Without this, the previous
  reservation's "You're booked!" success card stayed on screen
  even after the user asked an unrelated question — the new
  patch only added new fields, never cleared the rid that drove
  the card. The check is in `AssistantStore.tsx:497-525`. Apply
  it any time the new orchestrator response intent is
  question-shaped (general_question, answer_restaurant_question)
  rather than booking-progressing.
- **Cancel success response now sets `status: "idle"` (2026-05-10).**
  Was setting `status: "confirmed"` after a successful cancel,
  which kept the cancelled reservation visible as "You're booked!"
  on the post_booking card. Changed to `"idle"` so the new reducer
  trigger above clears the card. The cancelled DB row still has
  `status="cancelled"`; this is just the client-side booking_state
  status the orchestrator reports back.
- **Global question handlers in orchestrator return
  `booking: { status: "idle" }` (2026-05-10).** Without an explicit
  booking patch, the orchestrator's globalAnswerCandidate response
  left booking_state untouched — so the prior reservation_id and
  status="post_booking" persisted through fact-lookup turns. Now
  every global-question return path includes `booking: { status:
  "idle" }` to trigger the AssistantStore's transition-to-idle
  cleanup.
- **Live deposit flow verified end-to-end (2026-05-10).** Browser-
  tested party of 8 at Mark Testing → /echoria-3 public page →
  party picker → 5:30PM slot → details → menu step shows
  "Continue to checkout · Deposit CA$80.00" → checkout step shows
  `Deposit (8 × CA$10.00) CA$80.00` line item + total CA$80.00 →
  Place Order (test card 4242…) → Table Booked + confirmation code
  0DB9423E. DB verified: `reservations.deposit_amount_cents=8000`,
  `deposit_status='charged'`, `status='confirmed'`. The Stripe stub
  (`confirm-deposit-stub`) flips deposit rows to 'charged' on click,
  and the `reservation_deposit_payments` settle trigger flips the
  parent reservation to 'confirmed' once all rows hit 'charged'.
- **Booking caps removed (2026-05-10).** Per-shift `max_covers` cap is now
  optional: when `shifts.max_covers IS NULL`, the cover-cap check is
  skipped entirely. The only ceiling is `restaurant_floor_capacity()`
  (sum of active table capacities), enforced via the multi-table combiner
  early-return. All four booking RPCs (`book_reservation`,
  `modify_reservation_slot`, `create_staff_reservation`,
  `get_available_slots`) gate the cover-cap check on `IS NOT NULL`. A
  one-time `UPDATE shifts SET max_covers = NULL` ran on 2026-05-10 so
  every existing shift benefits. `SettingsPage.tsx:1111` no longer seeds
  `max_covers: 100` on new shifts (NULL instead). Owners who want a
  kitchen/staff throttle can set a number directly on `shifts.max_covers`
  until a future dashboard control exposes it. Migration:
  `20260510000200_remove_max_covers_cap.sql`. Don't reintroduce the
  `COALESCE(s.max_covers, 100)` pattern — NULL means "no cap" now.
- **Multi-table combiner captured as a migration (2026-05-10).** The
  deployed `find_available_table_group` was a sophisticated multi-table
  combiner (recursive CTE up to 16 tables, two strategies: adjacent
  same-section first, then any-combo fallback) but the local migration
  at `20260503000001_add_reservation_table_assignments.sql` was the OLD
  1-2-3-table version. Migration drift was caught while debugging "47
  people fails at Georgy Inc". Captured as
  `20260510000100_capture_find_available_table_group.sql` along with
  the `restaurant_floor_capacity(uuid)` and
  `restaurant_turn_time_minutes(uuid, uuid)` helpers. CREATE OR REPLACE
  → no-op for prod; restores parity for fresh local DBs. Lesson: when
  investigating "this should be broken but seems to work", grab
  `pg_get_functiondef(p.oid)` from prod before assuming the local file
  represents the live state. Local migration files can lag behind prod.
- **Deposit policy with Stripe-stubbed UI (2026-05-10).** Owners can set
  per-tier deposits keyed on party-size threshold via the new
  `<DepositPolicyEditor>` card on Settings → Restaurant info. Schema:
  `restaurants.deposit_tiers JSONB` (array of
  `{min_party_size, amount_per_person_cents}`),
  `reservations.deposit_amount_cents` + `deposit_status`
  (`none|pending|charged|waived|failed`), and
  `reservation_deposit_payments` (split-tender support, RLS-protected).
  `compute_deposit_for_party(uuid, integer) RETURNS integer` computes
  the deposit using the **highest applicable tier × party size** — NOT
  additive (a party of 25 at the 20+ tier of $20/person pays $500, not
  $750). **Deposit is collected on the existing checkout step (Step 3
  Payment)** as a line item alongside the preorder cart and tip — there
  is no separate "deposit" step. The single/split-tender card UI in
  `RestaurantPublicPage.tsx` handles the combined total. Client-side
  `previewDepositDollars` is computed from `restaurant.deposit_tiers` ×
  party size for display before the booking is created; the server
  re-computes and writes the canonical value via
  `compute_deposit_for_party()` inside `create-public-booking`. The
  menu step's "Continue" button reads "Continue to checkout · Deposit
  $X" instead of "Skip preorder · Confirm booking" when a deposit
  applies, so the customer always reaches the checkout step. Two new
  edge functions: `prepare-deposit` (creates payment rows in 'pending')
  and `confirm-deposit-stub` (STRIPE STUB — flips rows to 'charged' on
  click; **gated behind `DEPOSIT_STRIPE_STUB_MODE` env, default true,
  set to `false` in prod once Stripe is wired**). After booking
  creation, `handlePlaceOrder` calls both functions sequentially when
  `deposit_required`; the settle trigger on
  `reservation_deposit_payments` flips the parent reservation to
  `confirmed` once every row hits 'charged'. Migration:
  `20260510000400_deposit_policy.sql`. End-to-end verified in browser
  on 2026-05-10: party of 8 at Mark Testing → menu shows "Continue to
  checkout · Deposit CA$80.00" → checkout shows deposit line item +
  total CA$80.00 → Place Order → confirmation code 51063919,
  status='confirmed', deposit_status='charged'. Search `// STRIPE STUB`
  to find every spot the future Stripe wiring needs to touch. Don't
  re-introduce a separate "deposit" step or a `<DepositStep>` component
  — the user explicitly asked for the deposit to live inside checkout
  using the existing single/split-tender UI (2026-05-10).
- **Turn-time consistency fix (2026-05-10).** `get_available_slots` was
  reading `v_shift.turn_time_minutes` directly while every other booking
  RPC used `restaurant_turn_time_minutes()` (which prefers
  `settings_json.turnTimeMinutes`). Fixed in
  `20260510000300_get_available_slots_canonical_turn_time.sql` —
  `get_available_slots` now also calls the helper. SettingsPage's save
  handler (line ~820) additionally syncs `turn_time_minutes` to every
  active shift on save, so the column stays aligned with
  `settings_json.turnTimeMinutes`. Caught at Georgy Inc lunch where
  dashboard said 90 but the lunch shift's column was a stale 60.
- **Single Cherry Inc → service shift (2026-05-10, data fix).** Georgy
  Inc had a manually-created lunch (12-3) + dinner (5-9) two-shift
  setup, with a dead 3-5pm gap and 11am hours_json open never reaching
  the booking grid. Collapsed to a single `service` shift covering
  11:00-22:00 (matches `restaurants.hours_json`), turn=90. The
  SettingsPage "Save Hours" flow already creates one shift per day
  matching hours_json — only existing manual setups drift. If a future
  agent finds another restaurant with the same drift, the fix is the
  same: deactivate extra shifts and broaden one to cover the
  hours_json window.
- **Single-reservation-lookup deterministic handler (2026-05-10).** Added
  to `cenaiva-orchestrate/index.ts` `buildPreflightResponse` BEFORE the
  list handler. Catches "what's my most recent / latest / newest / last
  / next / first / current / active reservation" — singular queries
  expecting ONE row, not a list. Distinguishes 4 kinds: `most_recent`
  (prefer future-active, then past-active, then most recent cancelled);
  `next` (future-active only); `last_past` (past-active or past-cancelled);
  `first` (oldest non-cancelled). Sub-1s, no LLM round-trip. Without
  this, "what's my most recent reservation" hit the list handler and
  returned 3 rows + "And N more" — burying the answer. Promotes the
  picked row's `reservation_id` / `restaurant_id` / etc. into
  `booking_state` so the next turn ("change to 8pm" / "cancel it")
  works without re-naming the booking.
- **Restaurant fact-lookup widened to about/kind/type/drinks/reviews/
  events/price/vibe (2026-05-10).** The deterministic fact-lookup
  handler now covers:
  - "tell me about X" / "what is X about" / "what's X like" — describes
    the row using cuisine + business_type + price tier
  - "what kind/type/sort of food/place is X" — answers from `cuisine_type`
    + `business_type`
  - "what drinks does X serve" — answers if `business_type` is bar /
    brewery / pub / lounge / izakaya, otherwise defers to menu
  - "is X expensive / cheap / pricey / how much" — uses `price_range`
    column (1-4 → budget-friendly / moderate / upscale / fine dining)
  - "is X a cafe / bar / brewery / pub / bistro / lounge" — yes/no on
    `business_type` match
  - "is X fancy / romantic / quiet / cozy / casual / kid-friendly /
    family / good for a date" — defers to vibe-judgment; surfaces
    cuisine + price tier as context
  - "any reviews of X" — gracefully says reviews aren't surfaced
  - "any events at X" — defers to restaurant phone
  Pattern order matters: specific patterns FIRST, catch-all
  `what {city|state|...} {of|...} X` LAST. Otherwise the catch-all
  swallows "what kind of place is X" with name="place is X" — bad
  fuzzy match → falls through to LLM. Same for "what type of food
  does X serve". Restaurant SELECT now includes `price_range` (was
  missing earlier so price answers always returned "no tier on file").
- **Global-question handlers — closest / best / promotions / events
  (2026-05-10).** New `globalAnswerCandidate` block in
  `buildPreflightResponse` (after fact-lookup, before small-prompt
  short-circuit) catches questions NOT tied to a specific restaurant:
  - "closest / nearest / near me / nearby / walking distance" → asks
    for city/area
  - "best / top / popular / favorite cuisines / foods" → asks for
    mood instead
  - "best / top / popular restaurants" → asks for city + cuisine
  - "promotions / deals / discounts / specials / offers / coupons"
    → routes to `/deals` page
  - "events / live music / trivia (without a restaurant name)" → says
    not tracked, redirects to booking
  All sub-1s, no LLM. Without these, the LLM either declined ("I'm
  not sure...") or wandered into a tool loop.
- **Cancel + modify deterministic verbs widened (2026-05-10).** The
  deterministic cancel branch now matches `(cancel|scrap|drop|kill|
  nuke|trash|abort|nix|delete|remove)` + a noun, OR "I need/want/
  wanna/gotta to cancel" without a noun, OR bare "cancel". The modify
  branch first regex matches `(change|move|switch|update|make it|add|
  reschedule)` and the time keyword regex was rewritten as
  `\b\d{1,2}(:\d{2})?\s*(am|pm|...)?\b` (the old `\d{1,2}:?\d{0,2}`
  required a `\b` after digits and so didn't match "7pm" — `\b`
  doesn't fire between a digit and a letter). `bookingProcessIntent`
  fallback regex was extended to include `switch|update|reschedule|
  make it|drop|scrap|kill` and a standalone `\d+(am|pm)` pattern so
  these phrases reach the orchestrator preflight instead of the
  small-prompt LLM. `parseTime` now also accepts `to/for/by` as a
  preposition before `noon`/`midnight`/etc, and matches bare
  `noon`/`midnight` anywhere — so "change it to noon" works.
- **`reservation_tables_no_overlap`-aware modify routing.** Modify
  flows route through `modify_reservation_slot` (not direct UPDATE)
  per the existing CLAUDE.md hard rule. The deterministic handler
  sets up `pending_action.type = "modify_reservation"` with the new
  slot, and `confirmPendingAction` calls the RPC on user "yes". Same
  pattern as cancel.
- **Cenaiva voice persona is now warm + varied (2026-05-10).** The
  small-prompt edge function and the orchestrator's internal small-prompt
  path were both rewritten with a human persona ("You are Cenaiva — a warm,
  witty restaurant booking assistant who talks like a friend who knows
  every great spot in town."). The reply shape is 1-2 short sentences,
  reacts specifically to the user's message, and only adds a follow-up
  nudge when it makes sense — NOT a hard-coded "What restaurant or area
  should I book?" suffix on every reply (which made every off-topic
  response sound identical). Both prompts include explicit examples for
  greetings, status checks, off-topic, frustration, hesitation,
  inappropriate/flirty, and identity questions about the user vs about
  Cenaiva. Temperature on cenaiva-small-prompt was bumped from 0.1 → 0.7
  for variety. Don't drop the persona examples from either system prompt;
  the LLM defaults back to robotic if they're absent.
- **Hardcoded fallback prompts are randomized (2026-05-10).** Every
  deterministic spoken_text in the orchestrator that could repeat across
  turns (`buildOptionsPrompt`, `buildSingleCandidatePrompt`,
  `buildRecommendationPrompt`, `nextSmallPromptBookingQuestion`,
  `fallbackSpokenTextForContext`, `scrubGenericLookupPrompt`, the cancel
  success message, the modify success message, the reservation-list
  intro/follow-up) now picks from a 2-4 phrasing pool. Without that, the
  same exact closing line appeared on EVERY reply and the assistant
  felt like a phone tree. If you add a new deterministic spoken_text, use
  the local `pick`/`pickRand` pattern rather than a single literal string.
- **Restaurant fact-lookup deterministic handler (2026-05-10).** The
  orchestrator's `buildPreflightResponse` now has a fact-lookup early-return
  (right after `confirmPendingAction`, before the
  reservation-list handler). It catches "is X in Y", "where is X",
  "what city/cuisine/hours/address is X", "is X halal/vegan/kosher",
  "does X have/serve Y", "tell me about X" patterns, runs a fuzzy token
  lookup against `restaurants`, and answers using the row's actual
  `city` / `address` / `cuisine_type` / `business_type` / `phone`. Sub-1s
  response, no LLM round-trip. Without this, the LLM's single-result
  auto-confirm template ("Found Mark Testing — that the one?") was
  hijacking the response and the user's actual factual question went
  unanswered. Examples that now work: "Yep, Mark Testing is in Guelph",
  "Mark Testing is in Guelph — 64 Clairfields Drive East", "Actually,
  Mark Testing is in Guelph, not milton", "I don't have halal
  certification on file… they're at +1-416-555-0333."
- **Pure-greeting guard skips Stage 1 client-side (2026-05-10).**
  `apps/web/src/components/cenaiva/AssistantProvider.tsx` now checks an
  `isPureGreeting` regex BEFORE calling `planLocalBookingTurn`. Without
  that, "how are you doing today" / "good morning" / "what's up tonight"
  had the local booking collector parse "today" / "morning" / "tonight"
  out as a date and falsely emit "What restaurant or area should I book?"
  — overriding the warm small-prompt LLM reply that came later. The
  guard requires a leading greeting word AND no booking verb in the same
  message, so "hi can you book me at X" still flows through Stage 1
  normally. Don't remove the guard.
- **`SPECIFIC_PLACE_FACT_PATTERN` widens client-side process-prompt
  routing (2026-05-10).**
  `apps/web/src/lib/cenaiva/simplePromptIntent.ts` adds a second
  fact-lookup pattern alongside the original `SPECIFIC_PLACE_LOOKUP_PATTERN`
  ("is X in Y..."). The new pattern catches "where is X", "what
  city/state/cuisine is X in", "how much/expensive/busy is X", "does X
  have/serve", "tell me about X" — so they ALL route to the orchestrator
  and hit the deterministic fact-lookup handler. Pre-2026-05-10 these
  fell through to the small-prompt LLM which has no DB access and would
  say "I'm not sure about Mark Testing — sounds like a name I haven't
  heard of."
- **Booking writes are atomic and double-booking-proof** via
  `book_reservation` + `modify_reservation_slot` + the
  `reservation_tables_no_overlap` exclusion constraint.
- **Cenaiva voice booking is now `book_reservation`-backed end-to-end
  (2026-05-10).** `_shared/booking.ts` `completeBooking` used to do a
  direct `INSERT INTO reservations` with status `'confirmed'`, bypassing
  the advisory lock + cover-cap recheck + diner-overlap pre-check +
  close-time guard + table assignment. Direct INSERTs ALSO tripped the
  `reservation_tables_no_overlap` partial-exclusion constraint with the
  opaque 23P01 — so `cenaiva-orchestrate` returned
  `"I couldn't confirm that booking. Want another time?"` while no row
  was created. Fixed by routing through `book_reservation` RPC (same
  contract as `create-public-booking` and `cenaiva-chat`). The RPC also
  returns the trigger-persisted `confirmation_code`, so the value the
  client sees now matches the row that was actually persisted. Don't
  re-introduce direct `reservations.insert(...)` writes from any
  Cenaiva path.
- **`pending_action` is fully wired client→server (2026-05-10).** The
  voice modify and cancel flows depend on `confirmPendingAction` in
  the orchestrator (`cenaiva-orchestrate/index.ts:2536`). For that
  handler to fire, three things must all be true:
  1. The orchestrator emits `booking.pending_action = { type, payload,
     confirmation_text }` on the first turn (it does).
  2. The client merges that into `state.booking.pending_action` via
     `APPLY_RESPONSE` (it does).
  3. The client echoes `pending_action` back in the next request's
     `booking_state` — `AssistantProvider.tsx:400-420`. **This was
     missing pre-2026-05-10**, so modify and cancel sat in an infinite
     "Just confirming…" loop. Don't drop `pending_action` from the
     `booking_state` field list. Also: when `pending_action` is set,
     the client MUST skip Stage 3 small-prompt (`AssistantProvider.tsx`
     `hasPendingAction` flag) — otherwise bare "yes" replies hit the
     small-prompt LLM and never reach the orchestrator.
- **`isSmallPromptTurn` (orchestrator) is gated on `pending_action`
  (2026-05-10).** Even when the client sends `pending_action`, the
  orchestrator's `isSmallPromptTurn` check at line 4357 used to flip
  TRUE for bare "yes" / "no" because none of the standard intent
  matchers (booking-process, booking-field-reply) catch a single
  affirmative word. That skipped `buildPreflightResponse` and so
  `confirmPendingAction` never ran. Now the gate reads
  `hasPendingActionInState` and stays FALSE whenever `pending_action`
  is queued. Don't remove that check.
- **`confirmPendingAction` strips action-topic words before classifying
  (2026-05-10).** `isAffirmativeText("yes cancel it")` previously
  returned FALSE because `isNegativeText` matched the word "cancel"
  (a generic "you want to abort" signal). For a queued
  `cancel_reservation`, the word "cancel" IS the topic — strip it
  before evaluating. Same for `change|modify|update|switch|move|
  reschedule` (modify), `late|running late|delay` (late note),
  `remember|save|prefer` (save preference). Don't undo this.
- **`list_my_reservations` exists as both an LLM tool AND a deterministic
  early-return (2026-05-10).** The orchestrator now exposes a
  `list_my_reservations` tool with `status_filter` of
  `active|past|cancelled|all`. There's also a deterministic handler in
  `buildPreflightResponse` (after `confirmPendingAction`, before the
  small-prompt short-circuit) that bypasses the LLM, queries
  `reservations` directly, names 1-3 rows in `spoken_text`, and
  promotes the first active row's `reservation_id`,
  `confirmation_code`, `restaurant_id`, `date`, `time`, `slot_iso`,
  `party_size` into `booking_state`. That last bit is what lets the
  next turn ("change to 8:30 PM" / "cancel it") work without the user
  re-naming the booking. The intent matcher requires a leading
  list-verb (`show|list|see|view|review|tell me|pull up|bring up|
  give me|read out|what are|what's`) — DON'T loosen it to bare
  `\bmy\b reservation`, that misclassifies `change my reservation`
  and `cancel my reservation` as list intents.
- **Client + orchestrator process-prompt regexes match plurals
  (2026-05-10).** Both `apps/web/src/lib/cenaiva/simplePromptIntent.ts`
  `BOOKING_PROCESS_DETAIL_PATTERN` and the orchestrator's
  `bookingProcessIntent` fallthrough now use `reservations?` /
  `bookings?` so `"show me my reservations"` (plural) routes to the
  orchestrator instead of the small-prompt LLM. Pre-2026-05-10 the
  pattern was `\breservation\b` which only matched the singular —
  plural-form requests fell through to small-prompt and got the
  refusal `"I can't see your reservations right now"`.
- **`restaurantFactLookupIntent` covers more interrogatives
  (2026-05-10).** The original v174 regex only matched `"is X in/at/
  near/halal Y"` patterns. Extended on 2026-05-10 to also catch
  `"where is X"` / `"where's X"`, `"what city/state/area/
  neighborhood/address/cuisine/hours/price"`, `"how
  much/expensive/busy/popular/far"`, `"does X have/serve/allow"`,
  `"tell me about X (restaurant|cafe|bar)"`. Routed BEFORE
  `clearlySmallPromptIntent` in `bookingProcessIntent` so the
  `^(what|who|why|how)…` short-circuit can't reject restaurant fact
  questions. Don't reorder.
- **Diner double-book is enforced at the DB layer** via three partial
  GiST exclusions on `reservations` keyed on `user_profile_id`,
  `lower(guest_email)`, and digits-only `guest_phone` against an active
  `slot_range`. Both RPCs raise `P0006 / diner_double_book` ahead of the
  exclusion as a friendlier error.
- **Every reservation must carry at least one identifier.** A CHECK
  constraint (`reservations_must_have_identifier`) enforces that
  `user_profile_id`, `guest_email`, or `guest_phone` is non-empty.
  All three reservation writers raise `missing_identifier` (P0007)
  up front: `book_reservation`, `create_staff_reservation` (staff
  path — at least email or phone since there's no profile), and
  `modify_reservation_slot` (defensive — reads the existing row's
  identifiers, only fires for pre-CHECK grandfathered rows). Fixed
  2026-05-09 after two all-null inserts via the mobile/voice path
  bypassed every overlap check (the partial GiSTs all require at least
  one of those three fields). `guest_id` alone is NOT enough — pair it
  with email or phone. Dashboard staff forms (`ReservationsPage`
  drawer, `FloorPlanPage` host quick-add + floor service form) also
  validate "email or phone required" client-side so users see a form
  message instead of a raw RPC error.
- **No booking can run past its shift's close time.** All three
  reservation writers raise `past_shift_close` (P0008) when
  `reserved_at + turn_minutes` would exceed the shift's `end_time`,
  or when `reserved_at` is before `start_time`. Same-day shifts only
  (`start <= end`); overnight shifts are not yet enforced. Edge
  functions `create-public-booking` and `modify-reservation` map P0008
  to 409 with `unavailable_reason: 'past_shift_close'`. Fixed
  2026-05-09 after a smoke test showed a 22:45 start at an 11pm-close
  shift booking successfully via direct `date_time` POST, bypassing
  the slot-grid validation that lived only in `get_available_slots`.
- **`book_reservation` returns the trigger-persisted
  `confirmation_code`.** A BEFORE INSERT trigger
  (`reservations_confirmation_code`) unconditionally overrides
  `NEW.confirmation_code` with a generated 8-hex value. The RPC now
  captures that via `RETURNING id, confirmation_code INTO …` so the
  function output matches what the row actually has. Without this,
  callers (edge function, SMS, email, customer self-serve modify)
  received the input placeholder and customers couldn't manage their
  bookings via confirmation code. Fixed 2026-05-09 in the same
  migration as the close-time guard.
- **Voice modify and cancel route through the safe RPCs.**
  `cenaiva-orchestrate` (the voice assistant) used to handle modify
  and cancel intents with direct `reservations.update(...)` calls,
  bypassing the advisory lock, diner-overlap guard, cover-cap recheck,
  close-time guard, and `find_available_table_group` table
  reassignment. As of v169 (deployed 2026-05-09): voice modify routes
  through `modify_reservation_slot` RPC; voice cancel does the
  status flip + `release_reservation_tables` RPC (mirrors
  `cancel-reservation/index.ts`). Voice now has the same safety
  invariants as the public web flow. Don't reintroduce direct
  `reservations.update(...)` writes for slot/party/shift fields in
  the orchestrator — always go through the RPC.
- **Voice deploy hygiene.** `cenaiva-orchestrate` v168 had drift:
  `verify_jwt: true` deployed while `supabase/config.toml` had
  `verify_jwt: false`. Per the config.toml header note, voice
  functions must be `false` because they decode JWTs themselves
  (otherwise the gateway rejects ES256 tokens with
  `UNSUPPORTED_TOKEN_ALGORITHM`). The 2026-05-09 redeploy aligned
  prod with config. If a future deploy resets it to `true`, voice
  users on ES256 sessions will silently break.
- **Voice search query splitter strips stop words.** The
  `search_restaurants` SQL implementation in `cenaiva-orchestrate`
  builds an OR of `name.ilike.%w%, cuisine_type.ilike.%w%,
  city.ilike.%w%` for every word in `toolInput.query`. Without
  filtering, words like "in"/"of"/"to" matched anything containing
  them — e.g. "restaurants in guelph" returned **Georgy Inc** because
  `name.ilike.%in%` matches "Georgy Inc" (contains "in"). v172
  (2026-05-09) introduced `QUERY_STOP_WORDS` (60+ items including
  "in", "is", "the", "and", "restaurants", "near", common
  prepositions) plus a length≥3 floor. Stop-word filter MUST stay —
  removing it reintroduces the off-city pollution. Also: the
  system prompt's PARAMETER USAGE section explicitly tells the LLM
  to put cities in `city`, venue styles in `business_type`, cuisines
  in `cuisine_type`, and NEVER dump sentence fragments into `query`.
  Don't relax that guidance.
- **Factual restaurant questions are NOT identity questions.** The
  system prompt's "personal/identity question" rule used to say
  "if the user asks you to determine something, give a respectful
  one-sentence answer such as you cannot determine that" — the LLM
  generalised that to "Isn't Georgy Inc in Milton?" and refused
  with "I can't determine that for you." v172 splits the rule:
  identity questions ABOUT THE USER (their sexuality, looks, etc.)
  are off-limits; factual questions ABOUT A RESTAURANT (city,
  hours, business_type) ARE answerable via search_restaurants.
  Don't merge these two categories again.
- **Voice search supports `business_type` AND any city.** As of
  `cenaiva-orchestrate` v170 (2026-05-09) extended in v173 (also
  2026-05-09): the `search_restaurants` tool has both `cuisine_type`
  (food, e.g. Italian) AND `business_type` (venue style, e.g. cafe,
  bar, brewery, bistro, bakery, lounge, pub) parameters. The system
  prompt explicitly lists smaller Canadian cities (Guelph, Milton,
  Oakville, Burlington, Cambridge, Hamilton, Kitchener, Kingston,
  Saskatoon, etc.) as valid `city` values so the LLM doesn't drop
  them as transcription noise. The SQL query SELECTs + ILIKE-filters
  both columns. The zero-result fallback in `searchFallback.ts` no
  longer hard-returns `[]` when an explicit `city` has no matches —
  it soft-falls-back to nearby and the orchestrator's spoken text
  frames it honestly ("I don't see any in {city} — I'd recommend
  {fallback_name} instead"). Don't drop this fallback; the
  silent-empty UX was the bug. Adding new cities to the list is
  always safe — the LLM treats them as optional hints, not a
  whitelist.
- **Wake-word auto-listen workaround.** When `Hey Cenaiva` fires,
  `AssistantProvider.open(..., { autoListen: true, greetingText })`
  runs the greeting then opens the mic. Two safety nets in the
  greeting-then-listen block (`AssistantProvider.tsx:745–800`):
  (1) defensive `voice.stopListening()` before `startListening()`
  to clear any half-released session, (2) 200ms `setTimeout` between
  greeting end and `startListening()` so Chrome can release the mic
  from the wake recognizer. If `startListening()` rejects we surface
  it via a TTS prompt ("Tap the mic to start when ready.") instead
  of failing silently. `useCenaivaWakeWord.ts` is still off-limits
  per the existing hard rule — these workarounds avoid touching it.
- **ElevenLabs disable is a 60-second cooldown, never session-permanent.**
  `useCenaivaVoice.ts` tracks ElevenLabs availability as React state
  (`elevenAvailable`, default true). After two consecutive
  `elevenlabs.speak()` failures we set it to `false` AND schedule a
  `setTimeout(..., 60_000)` that flips it back to `true`. The previous
  behaviour — `elevenDisabledRef.current = true` set permanently for
  the session — was the root cause of the 2026-05-09 TTS regression:
  a single transient 429 / network blip silently disabled ElevenLabs
  for the rest of the browser session, dropping the user back to the
  browser Web Speech voice with no UI signal until they hard-refreshed.
  The cooldown self-heals. Never reintroduce a session-permanent
  disable. The `console.warn("[Cenaiva TTS] ElevenLabs failed twice
  — falling back to Web Speech for 60s")` MUST stay so the fallback
  path is visible in DevTools. `useElevenLabsTTS.ts` also rate-limits
  status-code-keyed warnings (`warnedStatuses` set) so a long outage
  doesn't spam the console.
- **Map load errors must surface in UI, not be swallowed.**
  `apps/web/src/lib/google-maps.ts` installs a `window.gm_authFailure`
  global handler on first `loadGoogleMaps()` call. It writes to a
  module-scoped `cenaivaMapsLoadError` and dispatches a
  `cenaiva:google-maps-error` window event. `<CustomerMap>` listens
  via `useEffect` and renders "Map unavailable" + the captured
  reason instead of an empty div. Do NOT reintroduce a silent
  `.catch(() => undefined)` on `loadGoogleMaps()` — auth errors
  (referrer restriction, billing not enabled, key invalid) MUST
  show up in the UI. This was caught 2026-05-09 after the user
  reported "the map system does not work it still says it has no
  access" and the silent error swallow gave no signal to debug.
- **"is X in Y" queries must reach the FULL orchestrator system prompt,
  not the small-prompt short-circuit.** Two parallel classifiers control
  this:
  1. Client `simplePromptIntent.ts` `SPECIFIC_PLACE_LOOKUP_PATTERN` ensures
     Stage 3 (cenaiva-small-prompt) is skipped — but this only handles
     the client-side fast path.
  2. Orchestrator `cenaiva-orchestrate/index.ts:1997-2030`
     `clearlySmallPromptIntent` + `bookingProcessIntent` (line 2040)
     decide whether `isSmallPromptTurn` (line 4137-4144) routes the
     LLM call to `buildSmallPromptSystemPrompt` (line 4197) or to the
     full system prompt with the v172 "factual restaurant questions are
     NEVER personal" rule.
  v174 (2026-05-09) fixed a hijack: "is mark testing in guelph" was
  being classified as a small prompt because no intent in the disjunction
  recognized "is X in Y" patterns, so `isSmallPromptTurn = true` and
  the LLM saw the small-prompt system prompt — which has the legacy
  "if personal identity/self-judgment, say you can't determine that
  for them" rule. The LLM over-generalized that to restaurant facts
  and the user heard "I can't determine that for you. What restaurant
  or area should I book?" — the EXACT small-prompt response shape.
  Fix: added `restaurantFactLookupIntent(transcript)` to
  `bookingProcessIntent` so "is X in/at/open/closed/popular Y" patterns
  flag as a booking-process turn → `isSmallPromptTurn = false` →
  full orchestrator path runs → v172 system prompt is the one the LLM
  reads → search_restaurants is called → row's city is read → answer
  is produced. **Never trust that a system prompt fix runs unless you
  trace which prompt actually reaches the LLM for that turn.** The
  small-prompt path is silent — it doesn't log "I picked the small
  prompt" — so check `isSmallPromptTurn` in DevTools or grep the
  Postgres `assistant_logs` for `metadata.fast_small_prompt = true`.
- **Customer-facing price meter is menu-derived only.**
  `apps/web/src/lib/restaurant-price-level.ts` `deriveRestaurantPriceLevel`
  computes the price level **solely from the median price of items in a
  "Mains/Entrées" category** (`PRICE_LEVEL_CATEGORY_NAMES` =
  `{main, mains, entree, entrees}`). The owner-set `restaurants.price_range`
  column is **not consulted for the meter**; it remains a hint for the
  voice orchestrator's `price_range_max` filter and for promotion/event
  metadata, but never overrides the meter. Reason: previously owner-set
  was authoritative, which let stale or accidentally-set values (e.g.
  `price_range=2` on a restaurant whose menu has no Mains category)
  override the actual menu-derived signal — surprising customers who
  expected the meter to reflect what they'll actually pay. When no
  Mains/Entrées items exist, the meter renders as 3 outlined `$` (empty
  placeholder) via `RestaurantPriceMeter` — owners populate it by
  categorizing items under "Mains" or "Entrées" in the dashboard.
- **Vapi-style per-tool filler is wired in the orchestrator.** Don't
  reinvent. `cenaiva-orchestrate/index.ts:215-222` defines `TOOL_FILLERS`
  mapping `search_restaurants`, `check_availability`, `complete_booking`,
  `patch_post_booking`, `get_menu`, `create_preorder_order`,
  `charge_saved_card` to "One moment please." The instant the LLM
  emits a `tool_calls` finish_reason (line 4787-4799), the orchestrator
  picks the filler for the FIRST tool and sends it as a `speech_chunk`
  SSE event. Lines 4801-4809 add a 2.5s watchdog that fires a SECOND
  filler if the tool round drags on (DB cold start, Stripe, OSM).
  This is the same pattern the user described from their Vapi voice
  agents — the architecture already matches. If a filler isn't
  audible, the bug is downstream (ElevenLabs disabled, streaming TTS
  guard, etc.), not in the orchestrator. Do NOT add a parallel
  filler-emit path on the client; one source of truth.
- **Concurrency engineering is done.** The only remaining ceiling lever
  is compute upgrade (Small ~$5/mo) — only do that when production
  traffic regularly approaches 1,500+ concurrent.
- **CDN was evaluated and declined.** Revisit criteria are documented in
  `CONCURRENCY_PLAN.md` → "CDN deliberation".
- **Hey Cenaiva web↔mobile parity shipped (2026-05-09).** Web's
  `AssistantProvider.sendTranscript` now mirrors mobile's four-stage
  pipeline (local collector → availability → small-prompt →
  orchestrator). Most utterances skip the LLM; only Stage 4 hits
  `cenaiva-orchestrate`. `useCenaivaWakeWord.ts` left untouched per
  user direction. 98 helper tests under `apps/web/src/lib/cenaiva/__tests__/`.
- **`get_available_slots` close-time bound fixed (2026-05-09).** The
  inner loop checked `v_slot_min + v_slot_inc <= v_end_min` (15-min
  slot increment) instead of `v_slot_min + v_turn_mins <= v_end_min`
  (90-min turn time), so a 23:00 close emitted 22:45 starts whose
  bookings ran to 00:15 the next day. Migration
  `20260509100000_get_available_slots_close_time_turn.sql`. Last
  bookable Saturday slot for a 23:00 / 90-turn shift is now 21:30
  (verified against Mark Testing / 2026-05-09 / party=2 → 43 slots,
  first 11:00, last 21:30).
- **Dashboard reservation date filter is restaurant-tz aware
  (2026-05-09).** `useReservations({ date | dateFrom | dateTo })` now
  takes an optional `timezone` and uses `localDayBoundsUtcIso(date,
  tz)` (`apps/web/src/lib/utils/time.ts`) to convert local-date strings
  to UTC bounds. Without this, `T00:00:00` strings got interpreted as
  UTC by PostgREST and Sat-night bookings (22:45 Toronto = 02:45 UTC)
  spilled onto Sunday's reservations view. `ReservationsPage` and
  `OverviewPage` pass `selectedRestaurant.timezone`.


---

## Lessons from the mobile→web mirror (2026-05-09)

- **`react-refresh/only-export-components`** fires on any non-component
  export from a `.tsx` file. Constants → move to a sibling
  `*Constants.ts` (e.g. `assistantStoreConstants.ts`). Provider + hook +
  context value → split into `Provider.tsx` (component) +
  `*-context.ts` (`createContext` + value type) + `useX.ts` (consumer
  hook). Mirrors the existing `auth-context*` / `useUser` triad.
- **Never assign refs in render.** `voiceIdRef.current = props.voiceId ??
  null` outside `useEffect` trips
  `react-hooks/Cannot access refs during render`. Wrap in `useEffect`
  keyed on the source dep.
- **Backend functions can be deployed but uncommitted.** Mobile owned
  `cenaiva-availability` + `cenaiva-small-prompt` — ACTIVE in the live
  project but absent from `supabase/functions/`. Don't conclude
  "missing" from `ls` alone; verify with
  `mcp__plugin_supabase_supabase__list_edge_functions(project_id=…)`.
- **Deployed edge functions can drift from local source.** Caught
  2026-05-09: `create-public-booking` v29 was an old hand-rewrite that
  did `INSERT INTO reservations` directly, bypassing `book_reservation`
  and surfacing raw 23514 CHECK violations to users. Local `index.ts`
  had been correct for weeks but never deployed. **Always cross-check
  the deployed source** with `mcp__plugin_supabase_supabase__get_edge_function`
  when investigating "the path I'm reading doesn't match the error
  signature." Postgres logs alone are not enough — the function ID +
  version in edge-function logs tells you which deployed code ran.
  After any edit to a booking/reservation edge function, redeploy
  before reporting fixed.
- **Vitest config:** explicit imports (`import { describe, it, expect }
  from 'vitest'`) with `globals: false` avoids needing `vitest/globals`
  in `tsconfig.app.json` `types`. Keeps strict TS clean without having
  to re-list every `@types/*` we still want auto-included.
- **Pre-existing build/lint baseline.** `npm run build` was already
  failing on `main` due to 5 errors in `RestaurantPublicPage.tsx`;
  `npm run lint` had 127 problems. Always capture baseline first via
  `git stash --include-untracked` then re-run, so you don't conflate
  pre-existing breakage with new work.
- **Schema drift adapters live at parse boundaries, not in ported
  helpers.** Mobile's `FiltersDelta.cuisine` is `string`; web's is
  `string[]`. Adapted with a `firstCuisine()` helper at the parse site
  inside `recommendationIntent.ts`, not by changing the port's input
  type.
- **Plan files belong outside CLAUDE.md.** When the user provides a
  large source-handoff doc (e.g. `step2-source-handoff.md`,
  `jolly-prancing-clover.md`), keep it as a sibling pointer — don't try
  to inline 1,200-line helper bodies into this file. Reference it from
  the Pointers section.
- **`VITE_*` flags are baked at Vite startup.** Editing `.env` requires
  killing and restarting `npm run dev`. The Cenaiva voice fell back to
  Web Speech for an unknown stretch because the local `.env` had
  `VITE_ELEVENLABS_ENABLED=false`. Always check `.env` for unexpected
  `false` overrides before chasing client-side bugs.
- **Two map libraries shipped concurrently is a smell.** The web app
  loaded both `maplibre-gl` (voice shell) and the Google Maps JS API
  (Discover / Deals) until 2026-05-09. The voice-shell migration to
  Google Maps unifies them; track removal of `maplibre-gl` /
  `react-map-gl` from `package.json` if no other consumer surfaces.


---

## Environment

- Repo root: `/Users/mark_habbi/Seatly-12` (monorepo, web app at `apps/web`).
- Supabase CLI v2.98.1 at `/usr/local/bin/supabase`, logged in, Seatly project (`exbjodmnpdiayfzrdyux`) linked.
- Supabase MCP connected (HTTP transport).
- Vite 8.x with Rolldown.
- Type-check: `npx tsc --noEmit -p apps/web/tsconfig.app.json` (run from repo root, or omit `tsconfig.app.json` if you want both app + node refs).
- Build: `npm --prefix apps/web run build` (run from repo root). Note: 5 pre-existing errors in `RestaurantPublicPage.tsx` block `tsc -b` on `main`; track separately.
- Dev server: `npm run dev` from repo root, or `npm --prefix apps/web run dev`. Uses port 5174 if 5173 is taken.
- Tests: `npm --prefix apps/web run test:run` (Vitest, CI-friendly with `--passWithNoTests`). `npm --prefix apps/web test` for watch mode. 98 cenaiva tests under `apps/web/src/lib/cenaiva/__tests__/`.
- Playwright is available locally via `npm install --no-save @playwright/test` + `npx playwright install chromium`. Smoke specs live in `tmp-e2e/`; the existing `speed-phase5-smoke.spec.cjs` and `concurrent-booking.mjs` are kept around but the latter is destructive at Nano tier (see Incident note).
- Test login: `cenaiva.e2e.customer@test.local` / `TestPassword123!`. Visible-slot test restaurant: `Cenaiva Reservation Capacity Test`.


---

## Archived CLAUDE.md current-state entries (moved 2026-05-30 to keep CLAUDE.md under the context-size limit)

- **2026-05-30 Diner account-deletion hardened — succeeds + erases all PII
  (`delete-account` + migration `20260530000000_diner_account_deletion`)** — Two
  bugs fixed. (1) Deletion FAILED for real diners: non-cascade FKs into
  `user_profiles` (`diner_consent_log`=RESTRICT, written at every signup; plus
  `payments`/`waitlist`/`subscription_consent_log`/`ai_conversations`=NO ACTION)
  made the `user_profiles` DELETE throw — after the fn had already cancelled/
  refunded reservations + deleted the Stripe customer (no rollback). (2) Residual
  PII survived: denormalized `reservations`/`reservation_holds`/
  `reservation_deposit_payments` contact fields, the `guests` CRM row, and
  visit-photo/receipt/export storage blobs. Fix: new SECURITY DEFINER RPC
  `delete_diner_account(uuid)` (service_role only) runs the whole erasure in ONE
  transaction — scrubs all denormalized PII, **de-identifies** legally-retained
  records (consent logs keep proof-of-consent but null user_profile_id/ip/ua;
  `payments` unlink; CRA/Law-25 retention), hard-deletes legacy AI + loyalty
  rows, then deletes `user_profiles` (cascading chat/notifications/reviews/
  cards). `delete-account` now calls the RPC (atomic → no half-delete), purges
  the diner's storage objects (`visit-photos`/`receipts`/`user-data-exports` +
  avatar), and deletes the Stripe customer LAST. Only nullability change needed
  was `diner_consent_log.user_profile_id` (others already nullable). Verified
  live on a synthetic test diner: deletion succeeded (was the failing path),
  consent retained+de-identified, guest PII nulled, chat cascade-deleted; test
  rows cleaned up. Deploy note: zod-using fns must deploy with
  `--import-map supabase/functions/deno.json` (the CLI doesn't auto-upload it).
  Remaining edge case (rare): a non-owner staff member who is also a diner could
  still hit a staff-table NO ACTION FK; owners are already blocked from self-delete.

- **2026-05-29 Dispute-fee recovery on lost chargebacks (`stripe-webhook`
  `handleChargeDispute`)** — On `charge.dispute.closed` + `lost`, in addition to
  the existing food+tax transfer-reversal clawback, Cenaiva now recovers the flat
  CAD $15 Stripe dispute fee from the restaurant via a one-off
  `stripe.invoiceItems.create` on its subscription customer (idempotent on
  `dispute_fee_${dispute.id}`, `tax_behavior:"exclusive"`, rides the next monthly
  invoice — same plumbing as the $1 booking fee). Skips + logs when no
  `stripe_customer_id` / paused / soft-deleted. Rationale (Stripe-doc-confirmed):
  destination-charge dispute amounts AND fees are debited from Cenaiva's platform
  balance and are NOT auto-routed to the connected account, and a transfer
  reversal can only recover up to the transferred amount — so the flat fee needs
  its own invoice item. Implements Partner Agreement §5.7 (previously unenforced —
  Cenaiva absorbed the $15). Not a Stripe-dashboard setting. Deployed
  `stripe-webhook`. (Legal-doc redline for the broader 2026-05-29 audit is staged
  in `LEGAL_REDLINE.md`, pending review — not yet applied.)

- **2026-05-29 Stripe security + correctness batch (10 fixes from a read-only
  multi-agent audit; each doc-checked + reviewed + verified live)** — Tier 1
  (critical/high, exploitable): (1) `refund-payment-intent` was anon + refunded
  ANY pi_ → now requires `metadata.restaurant_id` + (anon) orphan-only (no
  charged deposit / paid order / materialized reservation bound) + <60min
  freshness; internal service-role caller bypasses. (2) `request-refund`
  auto-refund now requires caller-owns-reservation + PI bound to it + a genuine
  duplicate (≥2 charged PIs). (3) `confirm-deposit-stub` default-OFF + UNDEPLOYED
  from prod (was anon + default-ON payment-bypass; prod uses
  `confirm-deposit-paid`). (4) `close-bill` now `checkAuth` + staff-role +
  restaurant-scoped + rate-limited + idempotent (was anon $0-close + tip
  injection; added `[functions.close-bill] verify_jwt=false`). (5) migration
  `20260529130000` revokes diner/anon UPDATE on trust-boundary `reservations`
  columns (status/deposit_*/timestamps/reserved_at/party_size) — re-grants only
  `shift_id/table_id/duration_minutes` to authenticated; dropped
  `reservations_update_own`. (6) `stripe-charge-order` atomic claim
  (`__charging__` sentinel) + tip-free idempotency key + release-on-failure.
  Tier 2 (medium): bill-booking-fees idempotency key + skip paused/deleted;
  confirm-modify-payment refunds the delta on cart-replay failure; mark-order-paid
  also binds via reservation_id (deferred pre-order PIs); stripe-webhook
  retry-on-throw (delete dedup row + 500) + split recovery republish from the
  status mirror. Tier 3 (latent, NOT yet done): post-meal Connect charge-model +
  `card_payments` capability, dispute clawback on destination charges,
  `charge.refund.updated` async-failure handling, refund-deposit-on-arrival
  idempotency. **Doc reconciliation:** corrected the fee-model in this file —
  live model is **Option B (2% of food)**, not the older 5.5%/94.5% (see the
  Stripe hard rules above; historical entries below are stale on this point).

- **2026-05-29 Owner dashboard: surface deposit + pre-order in the
  reservation detail dialog (`ReservationsPage.tsx` + `useReservations.ts`
  + new `ReservationPreorderSummary.tsx`)** — The detail dialog
  (`ReservationDetailsDialog`) now shows what the diner paid at booking.
  (1) Deposit: the deposit section was wrongly gated behind
  `SPLIT_TENDER_ENABLED` (off in prod) so solo deposits rendered nothing;
  dropped the flag from the condition so any booking with a
  `reservation_deposit_payments` row shows amount + status via the
  existing `ReservationDepositBreakdown` (its 1-row branch already
  handles solo). NOT a split-tender revival — the server still rejects
  split bookings, so only solo 1-row deposits exist; this just un-hides a
  deposit the diner already paid. (2) Pre-order: `useReservations`
  `.select` now embeds `orders!orders_reservation_id_fkey(... order_items(...))`
  (FKs + `orders_select_staff`/`order_items_select_staff` RLS already allow
  the owner read — no RPC/RLS/migration needed; `order_items.name` is
  denormalized so no `menu_items` join). **The `!orders_reservation_id_fkey`
  disambiguation is REQUIRED:** `reservations` relates to `orders` via TWO
  FKs — `orders.reservation_id` (one-to-many, what we want) AND
  `reservations.preorder_order_id` (many-to-one). A bare `orders(...)` embed
  returns PGRST201 ("more than one relationship found") and fails the whole
  reservations fetch → empty owner list. Hotfixed in f2f96e6 after the bare
  embed shipped in aa677a2. Lesson: when embedding `orders` from
  `reservations`, always pin the FK. New `ReservationPreorderSummary`
  lists `qty × name — line_total`, a food subtotal (sum of `line_total`,
  NOT `orders.total_amount` which bundles the deposit on combined PIs),
  tax if any, and a Paid/Refunded/Pending badge. Both sections render
  only when data exists (no empty boxes). Display-only — no
  payment/booking logic touched. tsc + minified build clean; data layer
  verified (986BCC4D shows $1.50 deposit; pre-ordered bookings carry
  order_items).

- **2026-05-29 Block no-show before reservation time + soft cancel
  message (`update_staff_reservation_status` RPC + `useReservations.ts`
  + `ReservationsPage.tsx` + `cancel-reservation`)** — A no-show is now
  hard-rejected when `now() < reserved_at`, raised as `P0022`
  (`no_show_before_reservation`). This applies to EVERYONE incl.
  owner/manager **force** — force now only relaxes the LATE (+24h)
  bound, never reaches back before the booked time. The old "1 hour
  before" non-force grace for no-show is removed (the seat RPC is
  unchanged — early seating still allowed). Dashboard maps `P0022`
  to a dedicated friendly toast (no force dialog, since force can't
  bypass it). Separately, `cancel-reservation`'s terminal-status
  rejection message softened from "already started or completed" to
  "This reservation can no longer be changed online — please contact
  the restaurant." Root cause of the #F13/#F14 surface: staff could
  mark a still-future booking no-show, which then showed to the diner
  as a stuck "Upcoming" booking they couldn't cancel. That trigger is
  now closed at the source. Deployed: migration applied live + RPC
  verified (`pg_get_functiondef` contains the P0022 block, old
  1h-grace gone, gate fires for the future booking that prompted this);
  `cancel-reservation` redeployed; frontend on `main` (Amplify).

- **2026-05-29 Checkout 500 from stale `stripe_customer_id`
  (`create-public-payment-intent` + `stripe-list-methods`)** — A
  profile whose `user_profiles.stripe_customer_id` points at a Stripe
  customer that no longer exists in the live account (test→live key
  drift, or a churned/deleted customer) 500'd the whole checkout:
  `paymentMethods.list` / save-card threw "No such customer". Both fns
  now verify the stored customer via `customers.retrieve` and, on
  `resource_missing` or `deleted`, self-heal — `stripe-list-methods`
  nulls the dangling ref and returns `{ methods: [] }`;
  `create-public-payment-intent` nulls it and creates a fresh customer
  for the save-card path. Verified live: fresh customer minted, card
  saved, PIs succeeded. Both fns redeployed.

- **2026-05-28 Booking-time desync fix (`RestaurantPublicPage.tsx` +
  `useAvailability.ts`)** — A diner could confirm one slot at checkout
  but be booked into a different one. Repro: change party size (or date)
  on a no-availability date, then tap the "Try <next day>" fallback
  WITHOUT tapping a time pill. The time-reset effect snapped `dineIn.time`
  to the day's FIRST slot (`availableTimeOptions[0]`, e.g. 11am) while
  `AvailabilityPanel` displayed/confirmed the auto-selected closest-to-now
  slot (e.g. 8:30pm). The reservation HOLD auto-creates from
  `selectedBookingSlot.date_time` the instant it's valid; if `dineIn.time`
  is 11am at that moment, the hold is created at 11am, and the booking
  converts that hold — so the diner paid for 8:30pm and got 11am.
  **Root cause = the reset defaulting to the first slot, NOT a
  resolution-layer issue.** It's a cross-component effect-ordering race
  (page reset vs `AvailabilityPanel` onSelectSlot), so it's INTERMITTENT
  and does NOT reproduce on the unminified dev server — it only surfaces
  on minified prod builds. The real fix: the reset now defaults
  `dineIn.time` to the CLOSEST-TO-NOW slot — the exact slot the panel
  shows — via new `closestSlotToNow()` (refactored out of
  `closestSlotTimeToNow`), so the hold can never capture 11am regardless
  of effect ordering. Belt-and-suspenders kept: `selectedAvailabilitySlot`
  also prefers `pickedAvailabilitySlot` (displayed pick) over the
  `display_time` match; reset re-checks the latest `dineIn.time` inside
  its functional `setDineIn`. URL-pin / voice deep-link branch left on its
  `isoSlotMatch` guard. **Verification lesson:** an earlier patch that
  only changed the resolution layer (`pickedAvailabilitySlot` preference)
  was wrongly declared fixed after a dev-server test — the dev server
  gave a FALSE POSITIVE because the race didn't reproduce there. Verify
  timing-sensitive frontend fixes against a `vite preview` MINIFIED build,
  not `npm run dev`. This fix was verified by: (a) building the unfixed
  version → minified preview reproduced 11am, then (b) building the fix →
  3/3 independent fresh holds (party 3/4/5) all landed at 8:30pm.

- **2026-05-28 Solo Stripe-QA fixes (2 bugs)** — Caught during the solo
  (split-tender-off) Phase-1 QA pass and fixed live:
  (1) **Missing diner confirmation on the paid-hold path.** Logged-in
  diners' reservations/holds frequently have `guest_email`/`guest_phone`
  NULL (identity lives in `user_profiles`), so `runPostHoldConversion`
  in `_shared/hold-conversion.ts` skipped BOTH SMS + email → diner got
  no booking confirmation (pure-preorder + deposit paid-hold bookings).
  Fix: resolve notification contact with a fallback chain
  `reservation.guest_email/phone` → `guests` row (via `guest_id`) →
  `user_profiles` (via `user_profile_id`). Redeployed `confirm-hold-paid`,
  `stripe-webhook`, `create-public-booking`. Verified: confirmation now
  fires exactly once.
  (2) **Deposit RDP row stuck `charged` after combined-booking cancel.**
  Combined pre-order+deposit bookings share ONE PI and store the full
  base (preorder+tax+deposit) on `orders.total_amount`; `cancel-reservation`
  refunded the whole base via the order loop, then the deposit loop
  re-hit the same already-refunded PI (exceeds remaining) and left the
  RDP row `charged`. Fix: track PIs refunded by the order loop
  (`refundedViaOrderPiIds`); for any charged deposit sharing such a PI,
  reconcile the row to `refunded` without a second Stripe call.
  Redeployed `cancel-reservation`. Verified: one $2.91 refund, RDP →
  `refunded`. Money flow was always correct in both bugs; these were a
  notification gap and a DB-state gap respectively.

- **2026-05-28 Split-tender FEATURE-FLAGGED OFF** — Multi-card-at-booking
  (PR-K) is disabled, not deleted. Frontend gated behind
  `VITE_SPLIT_TENDER_ENABLED` (helper: `apps/web/src/lib/featureFlags.ts`);
  diner never sees the "Split tender" toggle and the owner dashboard
  never shows split badges/breakdown. Server hard-rejects any split
  request: `create-public-booking` returns 400 `split_tender_disabled`
  when `SPLIT_TENDER_ENABLED!=="true"`; `modify-reservation` refuses
  (400) if a pre-flag split booking (≥2 charged RDP rows) is modified.
  The shared `reservation_deposit_payments` table / settle trigger /
  `convert_reservation_hold_to_reservation` RPC are UNCHANGED — solo
  deposit bookings still write 1 RDP row there exactly as before. All
  split-tender components, helpers (`proportional-split.ts`), and
  branches stay compiled + dormant. **To revive:** set
  `VITE_SPLIT_TENDER_ENABLED=true` (Amplify) + `SPLIT_TENDER_ENABLED=true`
  (Supabase secrets), redeploy `create-public-booking` +
  `modify-reservation`, rebuild web. **While off: any PR that EDITS
  (vs merely compiles) split-tender branches is suspect — the feature
  is dormant, so changes to it are almost certainly accidental.**

- **2026-05-28 Preorder-only PI binding + cart-shrink refund fix** —
  Two bugs surfaced in PR-K Phase 6 cart-shrink QA, both fixed and
  re-verified live: (1) Pure preorder bookings (no deposit) had
  `orders.stripe_payment_intent_id = NULL` because `create-public-
  booking` never accepted the PI ID from the client — Mode B PI (saved
  card, no hold) doesn't put `reservation_id` on PI metadata so
  stripe-webhook can't back-fill. Fix: `BookingInputSchema` gained
  optional `payment_intent_id` field; `create-public-booking` stamps
  it onto `orders.stripe_payment_intent_id` + sets `status='paid'` /
  `paid_at=now()` when present; `RestaurantPublicPage.tsx` passes
  the succeeded PI ID alongside booking payload. (2) Even with PI
  binding present, cart-shrink silently skipped the refund because
  the in-place order wipe at lines 1654-1663 flipped `status='paid'
  → pending` and `total_amount → $0` BEFORE the refund logic ran;
  the fallback query at line 1745+ then filtered by `status='paid'`
  (zero matches) and `total_amount > 0` (zero matches). Fix: capture
  `existingOrder.stripe_payment_intent_id` + `total_amount` snapshot
  in section (4) BEFORE the wipe; refund-path fallback uses the
  snapshot directly (no re-query). Verified: refund
  `re_3Tc1s4JABKj4FeJX0hTH8cKp` posted for $1.41 with
  `metadata.cenaiva_reason='cart_shrink'` after a Nova sushi-only
  booking → add → shrink test. Deployed: `create-public-booking` +
  `modify-reservation` v137 + `apps/web` (RestaurantPublicPage).

- **2026-05-28 confirm-hold-paid owner notification gap** —
  Solo deposit+hold bookings were never emailing the restaurant
  owner because `confirm-hold-paid` calls `runPostHoldConversion`
  which fired diner email but NOT owner email. Fix:
  `_shared/hold-conversion.ts` imports `notifyOwnerNewReservation`
  and calls it after `sendReservationNotification`. Idempotent via
  `restaurant_notification_log` partial unique index.

- **2026-05-28 PR-K Split-tender parity (all 10 gaps in one push)** —
  Split-tender bookings now behave identically to solo bookings on
  modify + cancel + dashboard surfaces. Server changes: `modify-reservation`
  detects ≥2 charged RDP rows and (a) for UP deltas seeds N pending rows
  proportional to each original payer's share, returns
  `is_split_tender: true` + `deposit_payment_row_ids[]` + `split_payers[]`
  (party_delta + cart_delta both); (b) for DOWN deltas distributes the
  refund across ALL charged rows via `proportional-split.ts` largest-
  remainder helper (was refunding ONE row only). `confirm-modify-payment`
  schema accepts both legacy single-row shape AND new arrays — verifies
  all N PIs succeeded + all N RDP rows charged + all metadata bindings
  before applying `modify_reservation_slot` exactly once; auto-refunds
  ALL N PIs on rejection. `cancel-reservation` (already refunds per-row)
  now passes per-payer `refund_breakdown` array to
  `notifyOwnerCancellation`; owner email body renders bullet list when
  ≥2 cards; diner email body splits the refund line by card. Frontend:
  `BookingDetailsPage`, `ManageBookingView`, `EditPreorderModal` all
  detect `is_split_tender` and mount `SplitTenderPaymentForm` (vs solo
  `StripePaymentForm`) with the N pre-seeded row IDs as `onPreCheckout`
  result; `SplitTenderPaymentForm.onAllPaid` now passes
  `paymentIntentIds[]` + `depositRowIds[]` back so consumers can call
  `confirm-modify-payment` with the array shape. Owner dashboard:
  `useReservations` joins `reservation_deposit_payments`; new
  `ReservationDepositBreakdown` component renders per-payer status in
  the detail dialog; list-view badge swaps "Deposit" → "Split N/M paid".
  Gap 12 (`update_reservation_hold_diner` RDP sync) analyzed-and-skipped:
  RDP rows for split-tender are seeded in `create-public-booking` AFTER
  hold-update completes, so the booker's contact data can never drift
  between hold-update and RDP creation — no migration needed.
  Deployed: `modify-reservation`, `confirm-modify-payment`,
  `cancel-reservation`.

- **2026-05-28 Comprehensive QA session (PR-A through PR-J)** — 10 PRs
  shipped end-to-end after a full Stripe-flow QA pass. Highlights:
  - PR #31 (A): Fix Stripe IntegrationError that broke 100% of
    split-tender payments (`fields.billingDetails.address.*='never'`
    requires matching empty-strings in `confirmParams.payment_method_data`)
  - PR #32 (B): Comprehensive — modify-reservation pending-row dedup
    (party-delta + cart-delta), gate `notifyOwnerNewReservation` for
    split-tender (fires post-settle from confirm-deposit-paid, not at
    creation), add ReservationsPage staff-action double-click guards,
    `sweep_abandoned_split_tender_reservations` cron (every 10 min,
    cancels pending_payment > 30 min with no charged RDPs), drop
    `restaurants.cancellation_hours` column + UX copy update
  - PR #33 (C): Hold-conversion path also needed the owner-notif gate
    (twin code path missed in PR-B); settle trigger now skips parents
    in `cancelled/no_show/completed` (defensive guard against late
    webhook racing with orphan sweep)
  - PR #34 (D): Move owner+diner post-settle notifications into
    stripe-webhook as well as confirm-deposit-paid (race fix — webhook
    sometimes beats client confirm); orphan-refund safety net (if
    parent is terminal when charge lands, refund via
    `refundPaymentIntent('orphan_split_tender_after_sweep')`);
    hold-conversion split-tender dedup
  - PR #35 (E): Step8PaymentSetup `publish()` early-exit guard for
    rapid double-click
  - PR #36 (F): `create_reservation_hold` returns caller's own exact-
    match active hold instead of raising diner_double_book on
    page reload (#F12) — prevents 15-min lockout after browser refresh
  - PR #37 (G): `sweep_abandoned_split_tender_reservations` now calls
    `release_reservation_tables` (was leaving stale reservation_tables
    rows that blocked re-booking the same slot via
    reservation_tables_no_overlap exclusion)
  - PR #38 (H): SplitTenderPaymentForm — read `failedCount` from latest
    state instead of stale closure (was showing "0 cards couldn't be
    charged" even when all paid); useEffect safety net fires onAllPaid
    when slots eventually flip to "paid" (was leaving parent stuck on
    cart screen)
  - PR #39 (I): Restore `create_reservation_hold p_hold_minutes DEFAULT
    15` — PR-F's rewrite accidentally reverted to 5 (copied from older
    migration 20260526180000 instead of latest 20260527000000)
  - PR #40 (J): SplitTenderPaymentForm now calls `onProcessingChange`
    so outer Place Order button shows Loader2 spinner during split-
    tender payment loop (parity with single-payment StripePaymentForm);
    add `reservation_id` column + partial unique index to
    `restaurant_notification_log` so owner-notification dedup is atomic
    via INSERT-with-23505-guard instead of SELECT-then-INSERT
    (was double-emailing Mark when confirm-deposit-paid and
    stripe-webhook raced within ~87ms)

  Net: split-tender works end-to-end; owner notifications dedupe
  atomically; hold UX no longer breaks on page reload; orphan-sweep
  side effects cleaned up. Outstanding follow-ups: `cancel-reservation`
  defensive gate refuses to cancel `seated`/`completed`/`no_show` even
  when reserved_at is still future (#F13); diner-side BookingsPage
  shows terminal-state reservations as "Upcoming" when reserved_at is
  future (#F14). **Update 2026-05-29:** the dominant trigger — staff
  marking a *future* booking `no_show` — is now blocked at the RPC
  (see the 2026-05-29 entry above), and #F13's message is softened.
  The defensive gate + #F14 bucketing are intentionally KEPT: a
  future-but-`seated` booking (early seating) can still reach this
  state, so the gate stays as a backstop. Remaining surface is now
  much rarer; still deferred.

- **2026-05-20 Subscription lifecycle rework (full overhaul)** —
  Decoupled card-save from subscription creation. Trial clock now anchors
  to publish day, not card capture. Plus: payment-failure auto-pause,
  30-day soft-delete grace, CRA-compliant anonymization, referral
  program, Canadian consent audit log, email notifications.
  - **New flow:** wizard `save-subscription-payment-method` saves card
    only (no sub); `publish-restaurant` atomically creates the sub +
    flips `is_published=true` (with `restaurant_live` email). Modal
    confirms "Your 90-day trial starts now" before publish.
  - **New publish-gate trigger** at the DB level (`restaurants_publish_gate`).
    Accepts both old-world (`subscription_status` in trialing/active —
    grandfathered) and new-world (`payment_method_attached_at IS NOT
    NULL`) paths. Blocks publishing soft-deleted restaurants.
  - **`create-subscription` deprecated.** Returns 410 by default;
    `ALLOW_LEGACY_CREATE_SUBSCRIPTION=true` env flips it back on for
    emergency operator use.
  - **Payment failure:** `stripe-webhook` `handleSubscriptionUpsert`
    now drives `is_published`. On `unpaid`/`canceled` → unpublish +
    `paused_reason='payment_failed'` + `payment_failed` email. On
    recovery to `trialing`/`active` while previously failed → republish +
    `payment_recovered` email. Skips entirely if `deleted_at IS NOT
    NULL` (deletion state protected).
  - **Restaurant deletion:** `delete-restaurant` rewritten — soft-delete
    + `cancel_at_period_end=true` on Stripe sub. 30-day grace with
    `deleted_at` + `scheduled_purge_at`. `recover-restaurant` undoes
    within grace. `purge-deleted-restaurants` cron (daily 5am UTC)
    anonymizes PII while keeping payment FKs intact for CRA 7-year
    retention.
  - **Referral program:** every published restaurant gets a unique
    `referral_code` (auto-generated on first publish). New restaurants
    pass `referral_code` at signup. `apply-referral-credit` fires from
    `publish-restaurant` — creates a $199.99 CAD Stripe coupon applied
    to BOTH subscriptions (`max_redemptions=2`). `referral_credits`
    audit table. `validate-referral-code` for live wizard validation.
  - **Canadian consent:** every card-save + publish-confirm writes to
    `subscription_consent_log` capturing disclosure text + IP + UA.
    Inline disclosure rendered above the Save card button.
  - **Owner notifications:** `_shared/owner-notifications.ts` helper
    (Resend-based, mirrors reservation-notifications). 6 templates:
    restaurant_live, restaurant_deletion_scheduled, restaurant_restored,
    payment_failed, payment_recovered, trial_ending_soon.
    `restaurant_notification_log` table for idempotency + audit.
    `notify-trial-ending` cron (daily 9am UTC) emails 7 days before
    trial end.
  - **Stale-card cleanup:** `cleanup-stale-onboarding-cards` cron
    (daily 4am UTC) detaches saved cards from unpublished restaurants
    after 90 days. First-attach timestamp wins (re-saving doesn't
    reset the clock).
  - **Diner delete-card bug fixed.** New `stripe-detach-method` edge
    fn. PaymentMethodsSection reorder: Stripe detach first, then DB
    delete (recoverable on transient Stripe errors).
  - **Existing trialing restaurants untouched.** Mark Testing +
    Onboarding Test Pizza continue on their old-world subs. Publish
    gate accepts them via the OR clause.
- **2026-05-19 Pricing overhaul (in same day, after the debug session)** —
  (A) Subscription bumped **$199 → $199.99 CAD/mo** across marketing
  pages (HomePage, RestaurantsPage, BookDemoPage), onboarding wizard
  (Step8PaymentSetup), `SettingsPage` PLAN_PRICE_CENTS (now 19999),
  and `create-subscription` header. Marketing $200 typo fixed.
  STRIPE_SUBSCRIPTION_PRICE_ID still points at the old $199 Price —
  Mark must create a new $199.99 CAD Price under the existing product
  + swap the secret. Existing trials/subs stay on old Price until
  renewal unless manually migrated per-customer.
  (B) **Diner pays Stripe processing fee on top** (~2.9% + 30¢).
  New `_shared/stripe-fee.ts` helper `computeDinerCharge(baseCents)`
  returns `{ baseCents, dinerTotalCents, processingFeeCents,
  applicationFeeCents }` via gross-up formula `ceil((base + 30) /
  0.971)`. Applied in `create-public-payment-intent` (Mode A + Mode
  B + hold path), `stripe-charge-order` (post-meal pay), and
  `modify-reservation` (party-size deposit delta). PI metadata
  carries `base_amount_cents` + `processing_fee_cents` for
  reconciliation. `application_fee_amount` stays 5.5% of BASE (we
  don't take commission on the pass-through Stripe fee). Restaurant
  nets 94.5% of base after Stripe's fee and our 5.5%. Client mirror
  at `apps/web/src/lib/stripe-fee.ts` powers the cart "Processing
  fee" line on `RestaurantPublicPage` + `DepositPayPage`.
  (C) **$1 per-confirmed-booking fee** to restaurants. New
  `restaurant_booking_fees` table (one row per reservation,
  idempotent on `reservation_id`). Triggers seed 'pending' rows on
  reservation INSERT/UPDATE where status='confirmed', and flip
  'pending' → 'cancelled' on cancellation. New edge fn
  `bill-booking-fees` (cron-driven hourly via pg_cron job
  `cenaiva_bill_booking_fees`) sweeps pending rows into Stripe
  `invoiceItems.create` on the restaurant's subscription customer;
  rolls into next monthly subscription invoice. Already-billed rows
  are NOT auto-credited on later cancellation (manual refund only).
  Restaurants without an active subscription are skipped (status
  must be in `trialing|active|past_due|incomplete`). 500-row batch
  per run; failures flip to 'failed' with `failure_reason` and
  require manual intervention. RLS: owners can SELECT their own
  fee rows; writes are service-role only.
  Operational TODOs (Mark): see STRIPE_SETUP.md §10. Must (a) create
  $199.99 Price, (b) swap STRIPE_SUBSCRIPTION_PRICE_ID secret, (c)
  set CRON_SECRET, (d) `supabase db push`, (e) deploy
  `bill-booking-fees`, (f) re-deploy the 3 modified edge fns.
- **2026-05-19 Stripe wire-up debugging + handoff state** —
  (A) SetupIntent customer-mismatch fix shipped to `stripe-setup-intent`
  v68: function now accepts `restaurant_id` and creates the SetupIntent
  on the **restaurant's** Stripe customer (Branch A) vs the diner's
  user_profiles customer (Branch B, original saved-card flow). Stripe
  blocks moving a PaymentMethod between customers; before this fix the
  wizard's PM ended up on the wrong customer and `create-subscription`
  failed silently. `Step8PaymentSetup.tsx` updated to pass
  `restaurant_id` + recovery path for SetupIntent already-succeeded
  state (when create-subscription fails downstream and user retries
  without refresh).
  (B) **`create-subscription` resolved 2026-05-23.** Function is now
  deprecation-gated to HTTP 410 by default (v76 deployed). Production
  publish flow runs through `publish-restaurant` instead, which keeps
  the enhanced Stripe error surface (`stripe_code` / `stripe_type` /
  `stripe_param` / `attempted_price_id` / `attempted_customer_id`) —
  these only reach the authenticated owner about their own restaurant,
  and `Step8PaymentSetup.tsx` maps them through `toUserFacingError`
  before any toast surface so users never see raw Stripe text. The
  legacy create-subscription escape hatch is gated by
  `ALLOW_LEGACY_CREATE_SUBSCRIPTION=true`; leave OFF in prod.
  (C) `Step7DepositPolicy.tsx` — removed the "Cancellation window"
  UI section (`cancellation_hours` field + state + validation + save).
  Consistent with 2026-05-15 policy that all cancels fully refund.
  Column `restaurants.cancellation_hours` still exists in DB but is
  no longer read or written by the wizard. Safe to drop in a future
  migration; don't drop without verifying no other code path reads
  it.
  (D) **Operational discovery: `STRIPE_SUBSCRIPTION_PRICE_ID` in
  Supabase secrets was set to `prod_USX4rqMU6E7f4V`** — a Stripe
  Product ID, not a Price ID. Subscriptions API requires a Price ID
  (`price_…`). Local `.env` had the correct Price ID
  (`price_1TTc0YJABKj4FeJXsR18YzVw`) but the Supabase secret store
  was never updated to match. Mark updated the secret. **Verified
  2026-05-27:** active Nova subscription uses
  `price_1TYgOeJABKj4FeJXcwrIHG5f` ($199.99 CAD) — secret is now a
  valid Price ID.
  (E) `RACE_CONDITION_AUDIT.md` — **CLOSED 2026-05-23.** All three
  race conditions shipped (create-subscription 410-gated,
  publish-restaurant has `idempotencyKey:
  publish_${restaurantId}_${ymd()}_tax_v1`, stripe-charge-order has
  `idempotencyKey: charge_order_${order_id}_${foodCents}_${taxCents}`
  + paid_at/PI pre-checks, modify-reservation refund path is dedupe
  -safe). See audit doc for the full resolution table.
- **2026-05-17 ROUND 4 (Hey Cenaiva polish)** — All 5 deterministic
  upstream layers shipped to `cenaiva-orchestrate`:
  (P1) direction-change reset + mid-flow restaurant pivot + exclusion
  memory + `soft_reset` UI action;
  (P2) info-query soft-deflect (parking, dress code, accessibility,
  kid-friendly, payment) + robot-date fix on modify path;
  (P3) pronoun resolution via `discovery.last_offered_restaurant_ids`
  + multi-intent + vibe honest deflect;
  (P4) profile + session dietary auto-apply to search_restaurants;
  (P5) frustration recovery + talk-to-human + joke counter (3-pool +
  refuse-after-2) + off-topic acks + misleading-fallback rewrite in
  `searchFallback.ts`. AssistantMemory extensions: `excluded`,
  `last_offered_restaurant_ids`, `session_dietary`,
  `conversation_state.{joke_count,frustration_count}` — all optional
  with sensible defaults. Schema mirrored in `@cenaiva/assistant`.
  Client `mergeAssistantMemory` made identity-stable to prevent a
  Phase-1 useEffect loop (`AssistantStore.tsx`). Prompt net growth
  vs Phase 0 baseline: +2 lines / +62 words / +786 chars (see
  PROMPT_SIZE_LOG.md). Full 85-test Chrome E2E (Phase 6) NOT yet
  run — assistant FAB-open path in Chrome MCP context blocked on
  mic permission flow; Mark to verify in real browser.
- **2026-05-16** — Pricing overhaul: platform fee 5%→5.5% on pre-orders
  & deposits; subscription $200→$199 CAD/mo (later bumped to $199.99
  on 2026-05-19); cancellation refunds only the restaurant's 94.5%
  slice (Cenaiva keeps the 5.5% commission). Voice
  hand-off destination-page fixes (time URL param, deposit banner,
  step=menu) on `RestaurantPublicPage.tsx`.
- **2026-05-16 OPERATIONAL (Mark)** — Create new $199 CAD/mo recurring
  Stripe Price + update `STRIPE_SUBSCRIPTION_PRICE_ID` env var in
  Supabase. Until then new subscriptions will charge $200.
- **2026-05-17 OPERATIONAL (Mark)** — ZERO restaurants currently have
  `stripe_charges_enabled = true`. Onboard at least one through the
  Connect Embedded flow so Phase 6 Section O (Stripe + payments) can
  run end-to-end. Without this, deposit + post-meal pay flows can be
  developed but not E2E-verified.
- **2026-05-15** — Cancellation policy: 24h forfeit cliff REMOVED, all
  cancels fully refund (within new keep-fee policy). New page
  `/find-reservation`. Phone+email both required everywhere. Diner
  auth Phases 1/3/4/5/6/7/8/9 shipped (auto user_profiles trigger,
  onboarding page, saved-card picker, cross-device account linking,
  owner-cancel routes through `cancel-reservation` with `actor:"owner"`,
  multi-payer deposit split, modify-reservation deposit recalc,
  `stripe-charge-order` Connect-aware). Apple Sign-In + Phone OTP
  (SMS/WhatsApp). Onboarding wizard polish + drafts as a product
  surface (`/drafts`, server-side publish gate trigger).
  Reservation-after-payment fix (deferred PI mode, reservation created
  only after Stripe succeeds).
- **2026-05-14** — Phase D Stripe wire-up: Connect Embedded + $199
  CAD/mo subscription with 90-day trial. Edge fns
  `create-stripe-account`, `create-account-session`,
  `create-subscription`, `stripe-webhook`. KYC publish gate.
- **2026-05-13** — 17-capability /goal verification pass (orchestrator
  v304–v309). Voice modify cross-session fixed. Dangerous
  `harness_cleanup_test_user` RPC dropped; replaced with scoped
  `harness_cancel_by_ids`.
- **2026-05-12** — Casual handler single-utterance slot resolution.
  Colloquial party-size words. Event-theme filter. Deals routing.
  Hours-question handler reads `hours_json`. Harness 280/281 (99.6%).
