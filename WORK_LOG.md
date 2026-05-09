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
