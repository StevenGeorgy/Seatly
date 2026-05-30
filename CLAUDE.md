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

**Per-PR discipline (added 2026-05-28 after a regression loop):**
Every PR that ships to prod adds a 1-2 line entry under "Current state"
(below) AND closes any matching entry in "Pending follow-ups" /
"Known follow-ups" lower in the file. The goal: a fresh Claude session
reading this file should see the CURRENT state, not a snapshot from
weeks ago. Stale entries that disagree with code caused multiple
regression bugs in the 2026-05-28 session (e.g. me copying an old
function body from migration 20260526180000 because I didn't notice
20260527000000 had updated it). When in doubt: grep the latest
migration timestamp + verify against deployed bytecode before
explaining behavior or copying code.

**No partial fixes (added 2026-05-28):**
A "partial pass" is a failure. If a test or behaviour surfaces ANY bug
— silent refund skip, missing notification, wrong amount, anything —
the bug gets fixed AND the test gets re-run end-to-end against the
new deployed code BEFORE moving on. Do NOT mark something "partial
pass / fix later", "works mostly", "this edge case is rare", or
"defer to a follow-up PR". Every fix gets verified live (DB row +
Stripe API + edge fn logs as applicable), not just compiled and
deployed. The user's words: "no partial anymore fix whatevers not
working and retest".

**Bug found → fix → retest broken test → retest ALL previous tests
in the suite BEFORE continuing (added 2026-05-28):**
The "no partial fixes" rule covers the broken test. This rule covers
regression risk in passed tests. When a fix lands mid-QA-pass, every
test that was already marked PASS in this session gets re-run against
the new deployed code before moving on to the next pending test. Why:
the fix could have silently broken something that previously worked
(e.g. a shared helper change touches an untested path). The cost of
re-running is small; the cost of shipping a regression is high. Do
NOT rationalize "test X doesn't exercise this code path, skip it" —
verify, don't guess. The user's words: "when you encounter a issue
or bug retest the mistake and retest all previous tests before
continuing to the next task".

**Verify charges against Stripe directly, not just the DB row (added 2026-05-28):**
Every test that involves a Stripe charge, refund, or PI lifecycle event
must verify the Stripe side directly — not just the Supabase row that
the webhook populated. Use `mcp__plugin_stripe_stripe__list_refunds` for
refunds and `list_payment_intents` (or `retrieve`) for charges. Why:
the DB row only reflects what the webhook landed; if the webhook is
delayed, mis-routed, or fires against the wrong customer/account, the
DB can show "charged/paid" while Stripe shows something different (or
nothing at all). The split-tender QA caught this exact pattern when
RDP rows showed `status='charged'` but the PI was on the wrong
customer. Every charge test gets two checks: (1) DB row reflects
the expected state, (2) Stripe API confirms the underlying PI/charge/
refund exists with the expected amount, status, metadata.

**Always fan out sub-agents where possible (added 2026-05-28):**
Use the Agent tool with the right subagent_type whenever the work
fits — and when multiple independent investigations or actions exist,
launch them in PARALLEL by sending a single message with multiple
Agent tool calls (not sequentially). Examples: spawn Explore agents
for codebase searches across different files, spawn parallel research
agents for "what does X do" + "what does Y do" + "what does Z do",
fan out verification agents per surface (DB schema vs RPC vs edge fn
vs client). The default mistake is doing too much sequentially in the
main context. Reserve the main context for synthesis + writes that
need to happen in order; push parallelisable read/research/verify
work to sub-agents.

## Current state (one-liners; see WORK_LOG.md for detail)

- **2026-05-30 Diner account deletion hardened** — atomic
  `delete_diner_account(uuid)` RPC (migration `20260530000000`): clears the
  non-cascade FK blockers so deletion no longer FAILS, scrubs + de-identifies
  ALL diner PII (reservations/holds/deposits/guests; consent + payment records
  kept de-identified for CRA/Law 25), cascades chat. `delete-account` calls the
  RPC (atomic, no half-delete), purges storage blobs (visit-photos/receipts/
  exports/avatar), deletes the Stripe customer LAST. **zod edge fns must deploy
  with `--import-map supabase/functions/deno.json`** (CLI doesn't auto-upload it).
- **2026-05-29 `stripe-webhook` dispute-fee recovery** — on a LOST chargeback,
  bills the restaurant the flat $15 (one-off invoice item, idempotent on
  `dispute_fee_${id}`) on top of the existing food+tax transfer reversal.
  Destination-charge dispute amounts AND fees hit Cenaiva's platform balance
  (Stripe-confirmed); not a dashboard setting.
- **2026-05-29 Stripe security + correctness batch (10 fixes)** — refund-payment-
  intent / request-refund auth-gated; confirm-deposit-stub OFF + undeployed;
  close-bill staff-only + idempotent; migration revokes diner UPDATE on
  trust-boundary `reservations` cols; stripe-charge-order atomic claim; + Tier-2
  idempotency. **Live fee model = Option B (2% of FOOD, diner-paid; restaurant
  nets food+tax 100%)** — older 5.5%/94.5% notes are stale.
- **2026-05-29 Owner dashboard** surfaces deposit + pre-order in the reservation
  detail dialog; `useReservations` MUST pin `orders!orders_reservation_id_fkey(...)`
  — a bare `orders(...)` embed returns PGRST201 and empties the owner list.
- **2026-05-29** Block no-show before `reserved_at` (`update_staff_reservation_status`
  raises `P0022`); self-heal stale/dangling `stripe_customer_id` (test→live key
  drift) in create-public-payment-intent + stripe-list-methods.
- **2026-05-28** Booking-time desync fix (slot reset defaults to closest-to-now
  slot); **split-tender FEATURE-FLAGGED OFF** (`VITE_SPLIT_TENDER_ENABLED`; server
  hard-rejects splits — editing split-tender branches is almost always
  accidental); preorder-only PI binding + cart-shrink refund fixes; PR-A–K Stripe QA.
- **2026-05-20 Subscription lifecycle rework** — card-save decoupled from sub;
  **trial anchors to PUBLISH day (90 days)**, not card capture; payment-failure
  auto-pause/unpublish; 30-day soft-delete + `recover-restaurant`; CRA-compliant
  anonymization; **owner referral program currently DISABLED in prod**.
- **2026-05-14 → 19** Stripe Connect Embedded + **$199.99 CAD/mo** subscription
  (90-day trial); diner auth (Google/Apple OAuth, phone OTP, saved cards, account
  merge); pricing → Option B (2% of food) + **$1 per-confirmed-booking fee**
  (`restaurant_booking_fees`, billed via `bill-booking-fees`).

Full detail for the above, plus all earlier entries (2026-05-12 →), is archived
in `WORK_LOG.md` ("Archived CLAUDE.md current-state entries").

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
- **FEE MODEL = Option B (2% of FOOD, visible fees) — live since the 2026-05
  pricing work; verified in `_shared/stripe-fee.ts` (its header is
  doc-verified).** The diner pays `food + tax + cenaivaFee + processingFee`.
  `cenaivaFee = max(round(food × 0.02), 1)` (2% of FOOD only, not tax/tip).
  Restaurant nets **food + tax (100%)**; Cenaiva nets exactly `cenaivaFee`;
  Stripe's fee is covered by the gross-up. `application_fee_amount =
  cenaivaFee + processingFee` (NOT 5.5% of base — that 5.5% was an EARLIER
  model; older entries below still say 5.5%/94.5% and are stale history).
  Refunds return `food + tax` (the visible platform + processing fees are
  non-refundable per the checkout disclosure); `refund_application_fee:false`.
- Never compute the diner's PaymentIntent amount as the raw base
  (deposit/preorder/order total). Always run the base through
  `computeDinerCharge(foodCents, taxCents)` from `_shared/stripe-fee.ts`.
  Use `dinerTotalCents` as `amount` and `applicationFeeCents`
  (`cenaivaFee + processingFee`) as `application_fee_amount`. Mirror on the
  client lives at `apps/web/src/lib/stripe-fee.ts` for cart display.
- Never charge a diner via `stripe-charge-order` (post-meal pay-the-
  bill) without the Connect-aware path: clone the platform-account PM
  to the restaurant's `stripe_account_id`, then PI on the connected
  account with `application_fee_amount = cenaivaFee + processingFee`
  (from `computeDinerCharge`, NOT a flat % of base). The pre-Phase-9
  platform-only path was a silent bug.
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
  `prepare-deposit`, `create-public-booking` (split-tender path with
  `split_tender_payers`), `convert_reservation_hold_to_reservation`
  (single-payer path), or `modify-reservation` (delta-UP path — seeds
  pending rows for split-tender modify; one row for solo). RLS allows
  only service-role writes; the settle trigger that flips reservations
  to 'confirmed' depends on it.
- Never refund a split-tender DOWN (modify-down or cart-shrink) by
  picking a single charged row. Always proportionally distribute
  |delta| across ALL charged rows via
  `proportionalSplitCents(totalCents, weights)` from
  `_shared/proportional-split.ts` (largest-remainder method —
  guarantees sum exactly equals total, no penny drift). `cancel-
  reservation` is unaffected (it already loops every row independently).
- For split-tender modify-UP, `modify-reservation` returns
  `is_split_tender: true` + `deposit_payment_row_ids: string[]` +
  `split_payers[]`. Clients MUST detect this and mount
  `SplitTenderPaymentForm` (NOT the solo `StripePaymentForm`).
  `confirm-modify-payment` accepts both legacy single-row + new array
  shape; arrays apply the modify exactly once after verifying ALL N
  PIs + ALL N RDP rows are charged + ALL metadata bindings hold.
  Auto-refund on rejection refunds ALL N PIs.
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
  false` so the platform fee stays with Cenaiva (Option B: Cenaiva keeps its
  2% `cenaivaFee` + the processing-fee portion; NOT a 5.5% commission).
  Restaurant nets $0, Cenaiva keeps its fee, diner gets `base` (food + tax)
  back — the visible platform + processing fees are non-refundable per the
  checkout disclosure.
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
- `RACE_CONDITION_AUDIT.md` — **CLOSED 2026-05-23.** Historical
  audit of the 3 Stripe-adjacent race conditions (create-subscription
  duplicate sub, stripe-charge-order double-charge diner,
  modify-reservation duplicate deposit rows). All three resolved per
  the doc's resolution table. Read for context on the idempotency
  patterns used (idempotencyKey shapes, paid_at/PI pre-checks).
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
