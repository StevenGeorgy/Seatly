# CLAUDE.md — agent guardrails for Cenaiva (Seatly repo)

Auto-loaded by Claude Code (and via `AGENTS.md` symlink for Codex). Read
this before touching code. The durable source of truth lives in
`WORK_LOG.md`, `CONCURRENCY_PLAN.md`, and `SPEED_PLAN.md` — this file
is only the short ruleset and pointer index.

## Keep this file fresh

Update **this file in the same change** when a task adds/removes a hard
rule, renames a listed pattern, or shifts capacity/latency numbers.
Routine bug fixes do not need an update. Detailed ship notes go to
`WORK_LOG.md`, not here.

## Current state (one-liners; see WORK_LOG.md for detail)

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
  & deposits; subscription $200→$199 CAD/mo; cancellation refunds only
  the restaurant's 94.5% slice (Cenaiva keeps the 5.5% commission);
  Cenaiva absorbs Stripe processing fees out of the 5.5%. Voice
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

Pending follow-ups: hours-query routing edge cases, cancel by
confirmation code, restaurant swap mid-flow, deposit hand-off on
casual book path for parties 8+, pre-order hand-off, LLM-branch date
phrasing ("2026-05-16 at 21:00" vs "Saturday May 16 at 9 PM").
Multi-payer deposit SMS support requires `payer_phone` column.

## Hard rules — never violate

### Reservation writes
- Never bypass `book_reservation` or `modify_reservation_slot`. They
  own the advisory lock, cover-cap recheck, and diner-overlap
  pre-check. Direct INSERTs fail with opaque `23P01`; the RPCs return
  `P0006 / diner_double_book`.
- Never cache booking writes.
- Never re-introduce `COALESCE(s.max_covers, 100)` in any reservation
  RPC. NULL means "no cap"; gate with `IF v_max_covers IS NOT NULL`.
- Never raw-UPDATE `reservations.status='cancelled'` outside
  `cancel-reservation`. That edge fn owns the refund pipeline. Owner
  cancels must pass `actor:"owner"` (verified against
  `user_restaurant_roles`); the dashboard's `updateStatus(id,
  "cancelled")` in `useReservations.ts` is the canonical owner call
  site. The legacy `update_staff_reservation_status` RPC must NOT be
  used to flip to cancelled.
- Never call `cancel-reservation` from owner-side surfaces without
  `actor:"owner"`. Owner cancels set `cancellation_reason =
  "Cancelled by restaurant"`.

### Stripe / payments
- Never charge a diner via `stripe-charge-order` (post-meal pay-the-
  bill) without the Connect-aware path: clone the platform-account PM
  to the restaurant's `stripe_account_id`, then PI on the connected
  account with `application_fee_amount = 5.5%` of total. The pre-
  Phase-9 platform-only path was a silent bug.
- Never UPDATE `orders` from the diner-facing client. RLS restricts
  UPDATE to staff; diner calls silently fail. Use `mark-order-paid`.
- Never insert into `reservation_deposit_payments` outside
  `prepare-deposit`. RLS allows only service-role writes; the settle
  trigger that flips reservations to 'confirmed' depends on it.
- Never call `confirm-deposit-stub` from production code paths. Use
  `confirm-deposit-paid` (re-verifies the PI with Stripe).
- Never drop or weaken the `restaurants_publish_gate` trigger — it's
  the trust boundary on `is_published`. Client-side check in
  `Step8PaymentSetup.tsx` is good UX; the trigger is the real gate.

### Auth / profile
- Never assume `user_profiles` is NULL for an authenticated diner. The
  `on_auth_user_created` trigger guarantees a row. Profile *fields*
  (full_name / email / phone) may be NULL — use
  `RequireCompleteProfile` to gate on field completeness.
- Self-service restaurant signup is open by design.
  `signup-restaurant-owner` defaults `is_active=true`. Do NOT add an
  admin-approval flow, `is_test` column, or any default-`false` change.
  "Mark Testing" (`aaa5e3d3-d8f2-4bae-8615-dc4e6ea83d2c`) is an
  intentional live row.
- Never silently overwrite existing drafts in `signup-restaurant-owner`.
  Honor `body.force_new=true` and `body.restaurant_id`. Implicit
  fallback UPDATEs the most-recent unpublished draft.

### Voice (Hey Cenaiva)
- Never modify `apps/web/src/hooks/useCenaivaWakeWord.ts`. Verify on
  every PR: `git diff --exit-code -- apps/web/src/hooks/useCenaivaWakeWord.ts`
  must be empty.
- Hey Cenaiva is **logged-in users only**. Mic FAB, wake word, and all
  4 stages of `sendTranscript` gate on `user` non-null. Voice edge fns
  (`cenaiva-orchestrate`, `cenaiva-small-prompt`, `elevenlabs-tts`,
  `deepgram-live-token`) require JWT and rate-limit per-user (30–60/min,
  bucket `user:{auth_user_id}`). `AssistantInner` returns a passthrough
  when `!user`. Per-IP rate limits are defeated by VPN rotation; never
  switch to them.
- Never bypass `planLocalBookingTurn` for booking-collection turns. It
  owns missing-field prompts, ambiguous-time disambig, and pending-
  option picks.
- `voice_id` goes only to `/elevenlabs-tts` and `/cenaiva-small-prompt`.
  NEVER include on `/cenaiva-orchestrate`.
- `NO_AUTO_RELISTEN_STATUSES` covers ONLY `paid`. Preorder/menu/
  checkout are hand-offs to the public restaurant page; don't add
  statuses back without reverting the hand-off pattern. Mic also blocks
  during AI TTS playback and user mute.
- Mobile-shaped helpers under `apps/web/src/lib/cenaiva/` stay
  verbatim against mobile. Bridge schema drift at the call site (e.g.
  `toCollectorRestaurant` in `restaurantAdapter.ts`).

### Storage / uploads
- Never bypass `assertImageSizeOk` (5 MB cap) on the `event-media`
  bucket. Bump the constant in
  `apps/web/src/lib/images/assertImageSize.ts` if you truly need more.

### General
- Never create migrations or run `DROP` / `DELETE` on the live project
  without explicit instruction.
- Never run `tmp-e2e/concurrent-booking.mjs` unmodified. Drop N to ≤ 5.
- Never bypass git pre-commit hooks (`--no-verify`).
- Never write Supabase queries in components. Hooks only, in
  `apps/web/src/hooks/`.
- Never call the Claude/Anthropic API from the client. Edge Functions
  only.
- TypeScript strict — never use `any`.

## Before adding any feature with a backend call — checklist

1. **Per-row fetches in a list?** → Batch the RPC. See
   `get_available_slots_for_restaurants_compact(uuid[], …)`.
2. **Reads the same data repeatedly within seconds?** → Cache it
   (UNLOGGED table + wrapper RPC pattern; see Phase 10a).
3. **Writes something users could spam?** → Rate-limit
   (`enforceRateLimit` helper).
4. **Queries a new column/pattern?** → Add an index in the same
   migration.
5. **Long-lived connection (realtime, websockets)?** → Reconsider;
   polling rarely eats the pool.
6. **New edge function?** → Identify auth (Bearer / confirmation code /
   service-role) explicitly and rate-limit.

## Existing patterns to reuse

- **Multi-table combiner:** `find_available_table_group(uuid,
  timestamptz, int, int, uuid, double)` — recursive CTE up to 16
  tables (smallest single → adjacent same-section combo → any combo).
  Helpers `restaurant_floor_capacity(uuid)` +
  `restaurant_turn_time_minutes(uuid, uuid)`.
- **Deposit policy:** `restaurants.deposit_tiers` JSONB +
  `compute_deposit_for_party(uuid, int)` (highest tier wins, not
  additive). `reservation_deposit_payments` table with settle trigger
  that flips reservation to 'confirmed' once every payment row is
  'charged'. Customer UI: deposit is a line item on the existing
  checkout step in `RestaurantPublicPage.tsx`.
- **Read cache:** `availability_cache` UNLOGGED +
  `get_available_slots_cached` (20s TTL, 5min prune).
- **Batched listing:** `get_available_slots_for_restaurants_compact` —
  first 6 future slots per restaurant.
- **Batched date scan:** `restaurant_available_dates(uuid, int, date,
  date) → text[]`.
- **Rate limit:** `check_rate_limit(p_key, p_limit, p_window_seconds)`
  + `_shared/rate-limit.ts`.
- **Atomic write:** advisory lock keyed on `(restaurant_id,
  reserved_at)` — same hash for create + modify.
- **Diner double-book guard:** `reservations.slot_range` (trigger-set)
  + three partial exclusion constraints (user / guest_email /
  guest_phone). RPCs raise `P0006 'diner_double_book'`; edge fns map
  it (and `23P01` backstop) to 409 with `unavailable_reason:
  'diner_double_book'`.
- **Live availability invalidation:**
  `useAvailabilityRealtimeInvalidate(restaurantId, onInvalidate)` —
  multiplexed postgres_changes channel with module-level registry so
  multiple components share one socket. Used by RestaurantPreviewModal,
  RestaurantPublicPage, AvailabilityPanel. Don't use from Discover/
  Deals (one entry per card explodes the connection count).
- **Cancellation refund:** `cancel-reservation` retrieves
  `application_fee_amount` from Stripe per row, refunds `total −
  applicationFee` via `refundPaymentIntent(stripe, pi, reason,
  amountCents)`. Falls back to full refund on retrieve failure.
- **Owner publish gate:** four conditions in lock-step — client-side
  check in `Step8PaymentSetup.tsx` AND server-side
  `restaurants_publish_gate` trigger (is_active + stripe_charges_enabled
  + active subscription + cover_photo_url).

## Hey Cenaiva pipeline patterns

- **Four-stage `sendTranscript`** in
  `apps/web/src/components/cenaiva/AssistantProvider.tsx`:
  1. `planLocalBookingTurn` (~0–50ms) — missing-field prompts.
  2. `useCenaivaAvailability.check` (~200–800ms,
     `cenaiva-availability` edge fn, "One moment please." IDB filler,
     20s timeout).
  3. `useCenaivaSmallPrompt.send` (~400–1500ms, 8s timeout). Skipped
     on confirmation/process turns.
  4. `useCenaivaOrchestrator.send` (~1.5–8s SSE). Kill switch:
     `VITE_CENAIVA_FAST_PATH=false` skips Stages 1–3.
- **Wake greeting:** `buildWakeGreeting(user)` → time-of-day + first
  name. Wired into `onWake` → `open(..., { autoListen: true,
  greetingText })`.
- **Persistent TTS cache:** IndexedDB store `cenaivaTtsCache`, keyed
  `flash25-mp3-44100-128-v1-${djb2('${voiceId}:${normalizedText}')}`.
  Warmed on `voice.primeTTS()` for `COMMON_TTS_CACHE_TEXTS`. Bump
  version suffix when upstream codec/bitrate/sampling changes.
- **Per-user voice picker:** `useCenaivaVoicePreference()` persists to
  localStorage AND `user_profiles.cenaiva_tts_voice`. UI at
  `/account/voice`.
- **Latency observability:** `useCenaivaLatencyBudget()` gated by
  `VITE_CENAIVA_VOICE_DEBUG=true`. Zero-overhead when off.
- **Recommendation capping:** `getCenaivaRecommendationMode(transcript)`
  → `'single' | 'list' | null`. Single mode wraps with
  `normalizeSingleRestaurantRecommendationResponse`;
  `applyClientDiscoveryMemory` keeps the ranked list for follow-ups.
- **Confirmation routing:**
  `shouldRouteAsCenaivaBookingConfirmation` rewrites "yes" → "yes,
  confirm booking" when booking is in `confirming` status.
- **Restaurant adapter:**
  `apps/web/src/lib/cenaiva/restaurantAdapter.ts` →
  `toCollectorRestaurant(webRestaurant)` for ported mobile helpers.
- **Voice-shell map = Google Maps**
  (`apps/web/src/components/cenaiva/CustomerMap.tsx` +
  `loadGoogleMaps()` from `apps/web/src/lib/google-maps.ts`).
  MapLibre no longer used inside the assistant. Markers are
  imperative `new maps.Marker(...)` synced from
  `state.map.marker_restaurant_ids`.
- **Deepgram STT retry:** `useDeepgramTranscription.ts` retries
  transient 5xx with backoff `[0, 200, 600]ms`. Surfaces "Voice
  transcription is unavailable" toast only after 3 failed attempts.
- **Booking widget = `<AvailabilityPanel>`**
  (`apps/web/src/components/booking/AvailabilityPanel.tsx`).
  Defaults: today / closest slot to now / 2 guests. Auto-refetches
  `get_available_slots_cached` on date/party change; time change
  re-windows via `centerSlotsAround` without a fetch. Used on
  RestaurantPublicPage, RestaurantPreviewModal, ModifyBookingFields
  (modify passes `excludeReservationId`).
- **Conflict UX never silently filters.** `useDinerConflictWindows`
  → conflicting slot pills rendered DISABLED with tooltip, not
  dropped.
- **Restaurant seat capacity:** `useRestaurantSeatTotal(restaurantId)`
  = sum of active table capacities. Read-only in SettingsPage.
- **Advance booking window = 3650 days** (effectively unlimited). All
  active shifts set; UI caps match. For seasonal closes, use
  `shifts.blackout_dates`, not the global cap.
- **Calendar empty-set vs null:** `fetchAvailableDateSet` returns
  `Set<string> | null`. **Empty Set** = grey out every date. **null**
  = fetch failed/incomplete; calendar stays permissive. Predicates
  must handle null.
- **Calendar day-button contrast:** `text-foreground` is on the day
  button base in `apps/web/src/components/ui/calendar.tsx` so enabled
  days don't inherit `text-muted-foreground` from Button ghost variant.

## Stack reminders

- Vite + React 18 + TypeScript strict + Tailwind + shadcn/ui. NOT
  Next.js, NOT App Router, NOT server components.
- Monorepo root: `/Users/mark_habbi/Seatly-12`. Web:
  `apps/web/`. Edge fns: `supabase/functions/`.
- Supabase project ref: `exbjodmnpdiayfzrdyux` (ca-central-1).
- Type-check before claiming done:
  `npx tsc --noEmit -p apps/web/tsconfig.app.json`.
- Tests (Vitest), from `apps/web/`: `npm run test:run` (CI) or
  `npm test` (watch). 98 cenaiva tests under
  `apps/web/src/lib/cenaiva/__tests__/`.

## Pointers (read these for the why)

- `WORK_LOG.md` — chronological decisions, gotchas, current
  production state, agent transfer notes.
- `CONCURRENCY_PLAN.md` — capacity ceiling, scaling, CDN deliberation,
  Phase 10/F entries.
- `SPEED_PLAN.md` — per-user latency phases (1–9), frontend perf.
- `PERFORMANCE_PATTERNS.md` — portable patterns for future projects.
- `STRIPE_SETUP.md` — Stripe dashboard + env var setup checklist.
- `MOBILE_STRIPE_GUIDE.md` — mobile-client Stripe integration guide
  (account deletion, business-side Connect, post-meal pay-the-bill,
  cancellation policy with $100 examples).
- `DINER_AUTH_SPEC.md` — 10-phase diner auth plan (Phases 1/3/4/5/6/7/
  8/9 shipped; 2/5/7/8 pending or partial).
- `DINER_MOBILE_GUIDE.md` — diner-side mobile mirror handoff.
  **Voice is OUT OF SCOPE for mobile.**
- `cenaiva-database.md` — schema/RPC/edge-fn reference (~5k words)
  for new Cenaiva clients.
- `jolly-prancing-clover.md` — full Hey Cenaiva mobile→web mirror
  spec (2,575 lines).
- `step2-source-handoff.md` — verbatim mobile source for ported
  helpers (`recommendationIntent`, `filterRestaurants`,
  `localBookingCollector`).

## When in doubt

Stop and ask. Don't infer architectural decisions from old patterns
— the docs above are the source of truth, and they're updated after
every shipped phase. If code contradicts a doc, the doc is right
until proven otherwise.
