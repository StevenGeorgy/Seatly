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

- **2026-05-28 Booking-time desync fix (`RestaurantPublicPage.tsx`)** —
  A diner could confirm one slot at checkout but be booked into a
  different one. Repro: change party size (or date) on a no-availability
  date, then tap the "Try <next day>" fallback WITHOUT tapping a time
  pill. The page snapped `dineIn.time` to the day's FIRST slot (e.g.
  11am) via the time-reset effect, while `AvailabilityPanel` still
  displayed/confirmed the auto-selected closest-to-now slot (e.g. 8:30pm).
  The hold + booking resolved the slot from `dineIn.time`
  (`dineInTimeMatch`), NOT the displayed pick (`pickedAvailabilitySlot`),
  so the diner paid for 8:30pm and got 11am. Fix (2 edits): (1) the
  booked slot now prefers `pickedAvailabilitySlot` (the displayed pick),
  falling back to the `display_time` match only when nothing is picked —
  the URL-pin / voice deep-link branch keeps its existing `isoSlotMatch`
  guard untouched; (2) the time-reset effect re-checks the LATEST
  `dineIn.time` inside its functional `setDineIn` so a pick that lands
  after the effect is scheduled isn't clobbered back to the first slot.
  Verified live (local dev build against prod backend): identical repro
  now holds 8:30pm where it previously held 11am.

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
  future (#F14). Both rare in production (only happen when staff
  prematurely mark a status); deferred.

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
