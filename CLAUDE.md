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
  was never updated to match. Mark updating the secret manually via
  `supabase secrets set` (or dashboard) — pending verification.
  (E) `RACE_CONDITION_AUDIT.md` documents 3 known Stripe-adjacent
  race conditions (create-subscription duplicate, stripe-charge-order
  no idempotency key, modify-reservation duplicate deposit rows).
  Deferred to partner pickup. **Do not bundle the 3 fixes in one
  deploy** — stagger them per the audit doc's recommendation.
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
- Never compute the diner's PaymentIntent amount as the raw base
  (deposit/preorder/order total). Always run the base through
  `computeDinerCharge(baseCents)` from `_shared/stripe-fee.ts` to
  gross up for Stripe's 2.9% + 30¢ fee. Use `dinerTotalCents` as
  `amount` and `applicationFeeCents` (5.5% of BASE, not the
  grossed-up total) as `application_fee_amount`. Mirror on the
  client lives at `apps/web/src/lib/stripe-fee.ts` for cart display.
- Never charge a diner via `stripe-charge-order` (post-meal pay-the-
  bill) without the Connect-aware path: clone the platform-account PM
  to the restaurant's `stripe_account_id`, then PI on the connected
  account with `application_fee_amount = 5.5%` of **base** (not the
  grossed-up diner total). The pre-Phase-9 platform-only path was a
  silent bug.
- Never insert into `restaurant_booking_fees` outside the
  `seed_booking_fee_on_confirm` trigger. The trigger is the single
  source of truth for "this reservation owes a $1 fee." Bulk
  backfills must be paired with operator awareness — surprise
  invoices break trust.
- Never bill `restaurant_booking_fees` from any path other than the
  `bill-booking-fees` edge fn. The function holds the
  status='pending' guard that prevents double-billing across
  overlapping cron runs.
- Never create a `stripe.subscriptions.create` or `stripe.invoiceItems.create`
  call for Cenaiva's own revenue without `automatic_tax: { enabled: true }`
  (on the subscription) and `tax_behavior: "exclusive"` (on the invoice
  item). Stripe Tax computes Canadian HST/GST per province from the
  customer address. Diner-facing PaymentIntents (deposits, pre-orders,
  on-bill charges) are restaurant revenue and intentionally NOT in
  scope — restaurant remits sales tax there. Before publish, the
  restaurant address must include `postal_code`; `publish-restaurant`
  enforces this with `tax_address_incomplete`.
- Never call `stripe.refunds.create()` on a destination-charge PI
  without `reverse_transfer: true`. The default pulls from Cenaiva's
  platform balance and leaves the restaurant holding the original
  transfer — Cenaiva eats the refund. The shared helper
  `_shared/stripe-refund.ts` is the only sanctioned path.
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
- Never collapse `stripe-setup-intent`'s two branches. Branch A (when
  `restaurant_id` is present) targets the **restaurant's** Stripe
  customer for the onboarding wizard; Branch B (no `restaurant_id`)
  targets the **diner's** `user_profiles.stripe_customer_id` for the
  saved-card flow. Stripe blocks moving a PaymentMethod between
  customers, so the SetupIntent must be created on whichever customer
  will eventually be billed.
- `STRIPE_SUBSCRIPTION_PRICE_ID` must point to a **Stripe Price ID**
  (`price_…`) — NOT a Product ID (`prod_…`). The Subscriptions API
  rejects Product IDs with `resource_missing`. Verify with
  `stripe.prices.retrieve(...)` after every env-var swap.

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
- **Cancellation refund:** `cancel-reservation` refunds `base` (the
  restaurant's slice) via `refundPaymentIntent(stripe, pi, reason,
  amountCents)`. The shared helper sets `reverse_transfer: true` so
  destination-charge refunds debit the connected restaurant (NOT
  Cenaiva's platform balance) and keeps `refund_application_fee:
  false` so the 5.5% commission stays with Cenaiva. Restaurant nets
  $0, Cenaiva keeps fee, diner gets `base` back.
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
- `RACE_CONDITION_AUDIT.md` — 3 open Stripe-adjacent race conditions
  (create-subscription duplicate sub, stripe-charge-order double-charge
  diner, modify-reservation duplicate deposit rows). Includes per-fix
  shape, risk assessment, and recommended stagger order. **Partner
  pickup task as of 2026-05-19**; do not bundle the 3 fixes into one
  deploy.
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

## Security lessons (2026-05-20/21 hardening batch + split-tender)

The 14-vuln security batch closed real exploits. The patterns below
became hard rules — apply them to every change going forward. See
`HABBI_STACK_SECURITY.md` for the portable version.

### Auth / authorization
- `_shared/auth.ts:checkAuth` is the canonical entry point. It calls
  `supabase.auth.getUser(token)` which DOES verify ES256
  signatures. Never re-introduce a hand-rolled `decodeJwtPayload`
  shim. The previous one allowed forged sub claims.
- Anon-callable edge fns that also accept a Bearer token must call
  `auth.getUser` and fall through to anon mode on failure. Never
  trust a body field claiming a user_profile_id — derive it from the
  verified session.
- `verify_jwt = false` in `config.toml` for any fn whose users send
  ES256 tokens. The gateway rejects ES256 with
  `UNSUPPORTED_TOKEN_ALGORITHM`. In-function `auth.getUser` is the
  signature check, not the gateway.

### Payment-intent metadata is the binding mechanism
- `create-public-payment-intent` stamps `deposit_payment_ids`,
  `restaurant_id`, and (when applicable) `reservation_id` /
  `hold_id` / `order_id` on PI metadata at create time.
- `confirm-deposit-paid` / `confirm-hold-paid` / `mark-order-paid`
  asserts the matching ID is in the metadata. Strict — no legacy
  fallback. Without this binding, an attacker could substitute any
  succeeded PI for any deposit/hold/order.
- `confirm-deposit-paid` also asserts `transfer_data.destination`
  matches the restaurant's `stripe_account_id`.
- Mobile + web both must pass `deposit_payment_ids: [rowId]` to
  `create-public-payment-intent` for deposit-paying PIs. Without it,
  the consumer rejects with `pi_payment_id_mismatch`.

### Split-tender path (new in 2026-05-21)
- `create-public-booking` accepts `split_tender_payers: number` (2-10).
  When set, the reservation is created in `pending_payment` status
  AND N `reservation_deposit_payments` rows are inserted atomically
  in the same fn. Returns `split_tender_deposit_row_ids: string[]`
  in the response.
- The settle trigger (`settle_deposit_on_charge`) flips the
  reservation to `'confirmed'` when the LAST row settles.
- This is now a third valid path to insert into
  `reservation_deposit_payments` (alongside `prepare-deposit` and
  the magic-link dispatch). The hard rule "never insert outside
  `prepare-deposit`" needs an exception: also valid via
  `create-public-booking` with `split_tender_payers`.

### Modify-reservation guest_id null bug (2026-05-21 fix)
- Bug: `.eq("id", reservation.guest_id)` where `guest_id IS NULL`
  → PostgREST sends literal `"null"` → Postgres rejects with
  `invalid input syntax for type uuid: 'null'`.
- Fix: ALWAYS guard `.eq("uuid_col", maybe_null_value)` with an
  `if` check. Modify-reservation lines 178+199 now guard correctly.
- The same pattern is correctly guarded in cancel-reservation.
- When implementing new fns that filter by a possibly-null UUID,
  guard the call site.

### DB structural rules
- Trust-boundary columns on `restaurants` (`stripe_charges_enabled`,
  `is_published`, `subscription_status`, `payment_method_attached_at`,
  `trial_ends_at`, etc.) are NOT in the authenticated UPDATE grant.
  Owners write them only via edge fns (publish-restaurant,
  save-subscription-payment-method, stripe-webhook). Direct
  supabase-js writes from the client → 403 permission denied.
- `cenaiva_cron_config` table: RLS enabled, all grants revoked
  from PUBLIC/anon/authenticated. Only service_role can read the
  `cron_secret`. Rotate after any incident.
- `cenaiva_call_cron_function`: REVOKE EXECUTE FROM PUBLIC, anon,
  authenticated. Whitelist `func_path` values inside the function
  body so even service-role can't dispatch arbitrary cron names.
- Audit / consent tables (`subscription_consent_log`,
  `restaurant_notification_log`, `referral_credits`) use FK
  `ON DELETE RESTRICT` to `restaurants(id)`. Customer audit logs
  outlive the parent row (CRA 7-year retention).

### Input validation
- Every edge fn uses `parseJsonBody(req, ZodSchema)` from
  `_shared/validation/parse.ts`. Never raw `req.json()`.
- Schemas live in `_shared/validation/*.ts` grouped by domain
  (`booking.ts`, `payment.ts`, `subscription.ts`, etc.).
- Primitive types from `_shared/validation/base.ts`: `Uuid`,
  `Email`, `EmailLower`, `E164Phone`, `BoundedText(N)`, `Money`,
  `ConfirmationCode`.
- Free-text fields capped at `BoundedText(200/500/2000/5000)`
  depending on context. AI prompts cap at 5000.
- Amount fields: `Money` defaults to `max(100_000)` (=$1000);
  override for higher amounts (e.g. `Money.max(10_000_000)` on
  `create-public-payment-intent.amount_cents`).

### Frontend
- `isSafeRedirectPath` in `apps/web/src/lib/auth/post-login-redirect.ts`
  is the canonical guard for any `from` / `redirect` query param
  before assigning to `window.location.href`. Used in
  `AuthCallbackPage.handleMergeDone`.
- `signup-restaurant-owner` returns uniform 200 response for the
  email-already-exists case (no enumeration oracle).

### Operational
- After any cron-affecting deploy, redeploy ALL 14 cron-validating
  fns to pick up the env var (run `supabase secrets list` to confirm
  CRON_SECRET digest matches what you expect).
- Order for any prod deploy that touches multiple layers: migrations
  → edge functions → frontend. Frontend last because it depends on
  the others.

## When in doubt

Stop and ask. Don't infer architectural decisions from old patterns
— the docs above are the source of truth, and they're updated after
every shipped phase. If code contradicts a doc, the doc is right
until proven otherwise.
