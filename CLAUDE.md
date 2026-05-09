# CLAUDE.md — agent guardrails for Seatly

Auto-loaded by Claude Code (and `AGENTS.md` for Codex). Read this before
touching code. The longer plans (`CONCURRENCY_PLAN.md`, `SPEED_PLAN.md`,
`WORK_LOG.md`) are the durable source of truth — this file is only the
short ruleset that points to them.

## Keep this file fresh — it's part of every task

If a task you complete changes any of the headline numbers, hard rules,
existing patterns, or open follow-ups in this file, **update this file
in the same change** before reporting the task done. Same goes for
`WORK_LOG.md` and the relevant long plan (`CONCURRENCY_PLAN.md` or
`SPEED_PLAN.md`). Stale rules are worse than no rules.

Concrete triggers that require an update:
- Shipping a new phase, RPC, migration, or pattern.
- Changing the concurrent-user ceiling, latency numbers, or compute tier.
- Declining a previously-considered approach (record the decision +
  revisit criteria).
- Adding or removing a hard rule.
- Renaming or deprecating an existing pattern listed below.

If a task does NOT touch any of those, no update is needed — don't
churn the file. Codex sees this file via the `AGENTS.md` symlink, so
edits here propagate to both agents in one step.

## Headline state (2026-05-09)

- **Concurrent-user ceiling: ~2,250** active Discover/Deals browsers on
  Micro compute (Supabase ca-central-1), p95 < 1 s, 0 failures.
- **Booking writes are atomic and double-booking-proof** via
  `book_reservation` + `modify_reservation_slot` + the
  `reservation_tables_no_overlap` exclusion constraint.
- **Diner double-book is enforced at the DB layer** via three partial
  GiST exclusions on `reservations` keyed on `user_profile_id`,
  `lower(guest_email)`, and digits-only `guest_phone` against an active
  `slot_range`. Both RPCs raise `P0006 / diner_double_book` ahead of the
  exclusion as a friendlier error.
- **Every reservation must carry at least one identifier.** A CHECK
  constraint (`reservations_must_have_identifier`) enforces that
  `user_profile_id`, `guest_email`, or `guest_phone` is non-empty.
  `book_reservation` raises `missing_identifier` (P0007) up front.
  Fixed 2026-05-09 after two all-null inserts via the mobile/voice path
  bypassed every overlap check (the partial GiSTs all require at least
  one of those three fields). `guest_id` alone is NOT enough — pair it
  with email or phone.
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

## Hard rules — never violate

- Never bypass `book_reservation` or `modify_reservation_slot` for
  reservation writes. They own the advisory lock + cover-cap recheck +
  diner-overlap pre-check. Direct INSERTs also fail the partial
  exclusion constraints, but the error is opaque (`23P01`) — always go
  through the RPCs so users see `P0006 / diner_double_book` instead.
- Never cache booking writes. The atomic RPC + exclusion constraint own
  correctness; cached writes break that.
- Never create migrations or run `DROP` / `DELETE` on the live project
  without explicit instruction.
- Never run `tmp-e2e/concurrent-booking.mjs` unmodified — it jams the DB
  pool at small compute tiers. Drop N to ≤ 5 if you must.
- Never bypass git pre-commit hooks (`--no-verify`) or migration order.
- Never write Supabase queries in components. Hooks only, in
  `apps/web/src/hooks/`.
- Never call the Claude/Anthropic API from the client. Edge Functions
  only.
- TypeScript strict — never use `any`.
- Never modify `apps/web/src/hooks/useCenaivaWakeWord.ts`. The recognizer
  works perfectly; touching it has historically broken Chrome's "one
  SpeechRecognition holds the mic" rule. Verify on every PR:
  `git diff --exit-code -- apps/web/src/hooks/useCenaivaWakeWord.ts`
  must be empty.
- Never bypass `planLocalBookingTurn` for booking-collection turns. It
  owns missing-field prompts, ambiguous-time disambiguation, and
  pending-option picks. Bypassing pushes those turns into the
  orchestrator's 5–35s tool loop.
- `voice_id` goes only to `/elevenlabs-tts` and `/cenaiva-small-prompt`.
  NEVER include `voice_id` on `/cenaiva-orchestrate` requests — the
  orchestrator returns text and the client picks the voice timbre.
- `NO_AUTO_RELISTEN_STATUSES` covers 9 booking statuses
  (`offering_preorder`, `browsing_menu`, `reviewing_cart`,
  `choosing_tip_timing`, `choosing_tip_amount`, `choosing_payment_split`,
  `charging`, `paid`, `post_booking`). Don't reduce — the mic must NOT
  auto-reopen during checkout / tip / payment flows.
- Mobile-shaped helpers under `apps/web/src/lib/cenaiva/` stay verbatim
  against mobile. Bridge schema drift at the call site (e.g.
  `toCollectorRestaurant` in `restaurantAdapter.ts`); editing helper
  internals to match web's snake_case breaks future mobile cherry-picks.
- **Self-service restaurant signup is open by design.**
  `signup-restaurant-owner` defaults `is_active=true`; new restaurants
  land customer-visible immediately. The activation gate WILL move to a
  Stripe paywall (planned, not built). Until that lands, do NOT add an
  admin-approval flow, `is_test` column, or any default-`false` change
  to the signup edge function. "Mark Testing"
  (`aaa5e3d3-d8f2-4bae-8615-dc4e6ea83d2c`) is an intentional live row.

## Before adding any feature with a backend call — checklist

Run through this every time. Skipping it is how the original ceiling
problems came back into the codebase.

1. **Per-row fetches in a list?** → Batch the RPC. Pattern:
   `get_available_slots_for_restaurants_compact(uuid[], …)`.
2. **Reads the same data repeatedly within seconds?** → Cache it.
   Pattern: UNLOGGED cache table + wrapper RPC, see Phase 10a.
3. **Writes something users could spam?** → Rate-limit it. Pattern:
   `enforceRateLimit(client, scope, identifier, { limit, windowSeconds })`.
4. **Queries a new column or new pattern?** → Add an index in the same
   migration that ships the feature.
5. **Opens a long-lived connection** (Supabase realtime, websockets)?
   → Reconsider. Polling is usually fine and doesn't eat the pool.
6. **Adds a new edge function?** → Identify auth (Bearer / confirmation
   code / service-role) explicitly and rate-limit it.

## Existing patterns to reuse

- **Read cache:** `availability_cache` UNLOGGED table +
  `get_available_slots_cached` (20 s TTL, opportunistic 5 min prune).
- **Batched listing:** `get_available_slots_for_restaurants_compact` —
  returns first 6 future slots per restaurant, strips `table_ids`.
- **Batched range scan:** `restaurant_available_dates(uuid, int, date,
  date) → text[]` — replaces N day-probes.
- **Rate limit:** `check_rate_limit(p_key, p_limit, p_window_seconds)` +
  `_shared/rate-limit.ts` helpers.
- **Atomic write:** advisory lock keyed on
  `(restaurant_id, reserved_at)` — same hash function for create and
  modify so they serialize against each other.
- **Diner double-book guard:** `reservations.slot_range` (trigger-set,
  not generated — `timestamptz + interval` is STABLE) +
  `reservations_user_no_overlap` /
  `reservations_guest_email_no_overlap` /
  `reservations_guest_phone_no_overlap` partial exclusions.
  `book_reservation` and `modify_reservation_slot` both pre-check and
  raise `P0006 'diner_double_book'`; edge function maps it (and the
  `23P01` backstop) to a 409 with `unavailable_reason: 'diner_double_book'`.
- **Live availability invalidation on customer pages:**
  `useAvailabilityRealtimeInvalidate(restaurantId, onInvalidate)` from
  `apps/web/src/hooks/useAvailability.ts` — single postgres_changes
  channel scoped to one restaurant, used by `RestaurantPreviewModal` and
  `RestaurantPublicPage` only. Don't use it from Discover/Deals (one
  socket per card explodes the connection count).

## Hey Cenaiva pipeline patterns (web mirror of mobile)

- **Four-stage `sendTranscript`** in `apps/web/src/components/cenaiva/AssistantProvider.tsx`:
  1. `planLocalBookingTurn` (pure TS, ~0–50ms) — missing-field prompts,
     ambiguous-time disambig, pending-option picks.
  2. `useCenaivaAvailability.check` (~200–800ms) — `cenaiva-availability`
     edge function with cached "One moment please." filler from IDB
     while the call is in flight; 20s `AbortController` timeout.
  3. `useCenaivaSmallPrompt.send` (~400–1500ms) — `cenaiva-small-prompt`
     edge function for off-topic Q&A; 8s timeout. Skipped when the turn
     is a confirmation reply or a process prompt.
  4. `useCenaivaOrchestrator.send` (~1.5–8s SSE) — full LLM tool loop,
     with `recommendation_mode` + `assistant_memory` + voice_id-less
     request body. Kill switch: `VITE_CENAIVA_FAST_PATH=false` skips
     Stages 1–3 and goes straight to Stage 4.
- **Wake greeting:** `buildWakeGreeting(user)` returns
  `"Good {morning|afternoon|evening}{, FirstName}. How may I help with
  your reservation?"`. Wired into `onWake` → `open(undefined, undefined,
  { autoListen: true, greetingText })`. The provider speaks the greeting,
  *then* opens the command recognizer.
- **Persistent TTS cache:** IndexedDB store `cenaivaTtsCache` keyed by
  `flash25-mp3-44100-128-v1-${djb2('${voiceId}:${normalizedText}')}`.
  Warmed on first `voice.primeTTS()` for `COMMON_TTS_CACHE_TEXTS`
  (9 phrases). Live-fetch fallback on IDB quota / private-mode /
  unavailable. Bumps the version suffix when the upstream codec / bitrate
  / sampling rate changes.
- **Per-user voice picker:** `useCenaivaVoicePreference()` returns
  `{ voicePreference, voiceId, isLoading, isSaving, needsSelection,
  refresh, setVoicePreference }`. Persists to
  `localStorage['@cenaiva/tts-voice/${authUserId}']` and
  `user_profiles.cenaiva_tts_voice` (text col, nullable). Provider mounts
  between `AuthProvider` and `AssistantProvider` in `App.tsx`. UI:
  `/account/voice` route + link from the Preferences section of
  `AccountPage`.
- **Latency observability:** `useCenaivaLatencyBudget()` is gated by
  `VITE_CENAIVA_VOICE_DEBUG=true`. Zero-overhead when off. Per-turn
  console summary: `t→firstSpeech / t→final / t→firstAudio / transport`.
  Wired into all four stages of `sendTranscript`.
- **Recommendation capping:** `getCenaivaRecommendationMode(transcript)`
  → `'single' | 'list' | null`. When `single`, Stage 4 wraps response
  with `normalizeSingleRestaurantRecommendationResponse` (one card +
  `"I'd go with X."`) and `applyClientDiscoveryMemory` keeps the full
  ranked list in `state.memory.discovery` so "show me more" follow-ups
  don't repeat already-shown cards.
- **Confirmation routing:** `shouldRouteAsCenaivaBookingConfirmation` +
  `transcriptForCenaivaBookingConfirmation` rewrite "yes" → "yes,
  confirm booking" before sending to the orchestrator when the booking
  is in `confirming` status.
- **Restaurant adapter:** `apps/web/src/lib/cenaiva/restaurantAdapter.ts`
  → `toCollectorRestaurant(webRestaurant)` maps web's snake_case
  `Restaurant` to mobile's camelCase `CollectorRestaurant`. Use at every
  call site that feeds restaurants into a ported helper.
- **Voice-shell map is Google Maps.** `apps/web/src/components/cenaiva/CustomerMap.tsx`
  uses `loadGoogleMaps()` + `CENAIVA_MAP_STYLES` from
  `apps/web/src/lib/google-maps.ts` (single source of truth — same styles
  on `DiscoverPage`). MapLibre is no longer used inside the assistant.
  Falls back to a "Add `VITE_GOOGLE_MAPS_API_KEY`…" message when the key
  is missing. Markers are imperative `new maps.Marker(...)` synced from
  `state.map.marker_restaurant_ids`.
- **Booking widget is `<AvailabilityPanel>`.**
  `apps/web/src/components/booking/AvailabilityPanel.tsx` is the unified
  date / time / party + 6-pill grid for the customer booking flow.
  Defaults on cold load: today (or `fetchNextAvailableDate`) / closest
  slot to "now" / 2 guests. Auto-refetches `get_available_slots_cached`
  on date or party change; time change re-windows the cached slot list
  via `centerSlotsAround(slots, time, 6)` without a fetch. Used on
  `RestaurantPublicPage`, `RestaurantPreviewModal`, AND
  `ModifyBookingFields` (unified 2026-05-09). All three sites pass the
  same shape (`restaurantId`, `restaurantTimezone`, `userProfileId`,
  `initial*`, `onSelectSlot`, `onStateChange`); modify additionally
  passes `excludeReservationId` so conflict windows skip the row being
  edited.
- **Conflict UX never silently filters.** `useDinerConflictWindows`
  returns the diner's overlapping reservations; render conflicting
  slot pills as DISABLED with a tooltip ("hidden — you have a 7:30
  booking at Mark Testing"), don't drop them. `formatConflictWindow`
  produces the tooltip label.
- **Restaurant total seat capacity** is `sum(tables.capacity) where
  is_active=true`. Use the `useRestaurantSeatTotal(restaurantId)` hook
  (`apps/web/src/hooks/useRestaurantSeatTotal.ts`). Surfaced in the
  dashboard SettingsPage as a read-only field next to turn-time, so
  owners know what `shifts.max_covers` could safely be raised to for
  whole-restaurant bookings.
- **Advance booking window is effectively unlimited (3650 days / 10
  years).** `shifts.advance_booking_days` is the per-shift cap that
  `get_available_slots` applies via `v_today + v_advance_days`. All
  active shifts are set to **3650**; the dashboard fallback for new
  shifts (`SettingsPage.tsx`) and the `<AvailabilityPanel>` calendar
  cap (`addDays(today, 3650)`) match. If you ever need to gate further-
  out bookings (e.g. owner-driven seasonal close), use
  `shifts.blackout_dates` rather than dropping the global cap — that
  preserves the calendar's "open by default" UX. Set 2026-05-09 in
  response to the user wanting unlimited lead time pending a Stripe
  paywall + per-shift dashboard control.
- **Calendar empty-set vs null distinction.** `fetchAvailableDateSet`
  returns `Set<string> | null`. **Empty Set** = "we asked, no openings
  this month" → grey out every date. **null** = fetch failed or hasn't
  completed → calendar stays permissive (predicate returns false).
  `unavailableDate` predicates must always handle null; without that,
  any RPC blip blanks the entire calendar and looks identical to "fully
  booked." Caught 2026-05-09 after a user reported all future dates
  appeared disabled.
- **Calendar day-button text contrast.** The shadcn `Button` ghost
  variant defaults to `text-muted-foreground` (#666666). `CalendarDayButton`
  uses ghost, so non-selected days inherit that color and become
  visually indistinguishable from `disabled` days (which only add
  `opacity-50` on top). The fix lives in `apps/web/src/components/ui/calendar.tsx`:
  `text-foreground` is added to the day button base className so enabled
  days render in foreground white, with `disabled:text-muted-foreground`
  + the inherited `disabled:opacity-50` (from Button base) handling the
  dim state. Caught 2026-05-09 after a screenshot showed every future
  date looking greyed-out even when the RPC returned 16 valid dates.

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

## Stack reminders

- Vite + React 18 + TypeScript strict + Tailwind + shadcn/ui.
- NOT Next.js, NOT App Router, NOT server components.
- Monorepo root: `/Users/mark_habbi/Seatly-12`. Web app:
  `apps/web/`. Edge functions: `supabase/functions/`.
- Supabase project ref: `exbjodmnpdiayfzrdyux` (ca-central-1).
- Type-check before claiming any task done:
  `npx tsc --noEmit -p apps/web/tsconfig.app.json`.
- Test runner: Vitest. Run from `apps/web/`:
  `npm run test:run` (CI-friendly, `--passWithNoTests`) or `npm test`
  (watch). 98 cenaiva tests under
  `apps/web/src/lib/cenaiva/__tests__/`.

## Pointers (read these for the why)

- `CONCURRENCY_PLAN.md` — capacity ceiling, scaling decisions, CDN
  deliberation, all ten Phase 10 + Phase F entries.
- `SPEED_PLAN.md` — per-user latency phases (1–9), frontend perf,
  remaining speed-only follow-ups.
- `WORK_LOG.md` — chronological decisions, gotchas, current production
  state, agent transfer notes.
- `PERFORMANCE_PATTERNS.md` — portable patterns for future projects.
- `jolly-prancing-clover.md` — full Hey Cenaiva mobile→web mirror spec
  (2,575 lines: pipeline architecture, gap matrix, edge-case behavior
  matrix, verification, perf targets, browser compat, PR conventions).
- `step2-source-handoff.md` — verbatim mobile source for the 3 large
  helpers (`recommendationIntent`, `filterRestaurants`,
  `localBookingCollector`) + their 3 test files. Kept for future
  cherry-picks from mobile when the upstream files change.
- `cenaiva-database.md` — single-context reference (~5,000 words) for
  any Claude agent working on a NEW Cenaiva client (mobile, internal
  tools, future SDKs). Schema, RPCs, edge functions, status enums,
  realtime publication, RLS layout, performance rules, error codes,
  migration ledger — plus an actionable checklist at the bottom.

## When in doubt

Stop and ask. Don't infer architectural decisions from old patterns —
the docs above are the source of truth, and they're updated after every
shipped phase. If something in code contradicts a doc, the doc is right
until proven otherwise.
