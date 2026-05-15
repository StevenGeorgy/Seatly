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

## Headline state (2026-05-15)

- **Onboarding wizard — multi-restaurant + polish (2026-05-15 evening).**
  Six issues plus drafts-as-a-product surface, all shipped:
  - **Server-side publish gate (DB trigger).** New
    `enforce_publish_gate()` trigger on `restaurants` BEFORE UPDATE blocks
    `is_published=false→true` transitions unless `is_active=true` +
    `stripe_charges_enabled=true` + `subscription_status IN
    ('trialing','active')` + `cover_photo_url` is non-empty. Raises
    `P0007` with a HINT identifying the missing gate. The client-side
    check in `Step8PaymentSetup.tsx` stays as first-line UX; the
    trigger is the trust boundary. Migration:
    `20260516000000_publish_gate_trigger.sql` (applied).
  - **30-day TTL cleanup pg_cron job.**
    `cleanup_stale_restaurant_drafts()` + cron entry
    `cleanup_restaurant_drafts` running daily at 03:00 UTC. Migration:
    `20260516000010_cleanup_old_draft_restaurants.sql`.
  - **Drafts as a real product surface.**
    - New `/drafts` page (`apps/web/src/pages/auth/DraftsPage.tsx`)
      under `<RequireAuth>`. Lists all `is_published=false` restaurants
      the user owns, each with name, location, "Draft · Step N of 8 ·
      Updated …" subtitle, [Continue setup] + trash icon.
      **Bulk-select multi-delete** via checkboxes + "Delete N" action;
      delete confirms via `Dialog` + uses RLS-permitted client-side
      DELETE with `is_published=false` guard.
    - New `restaurants_delete_owner_draft` RLS policy permits owners to
      delete their own unpublished drafts (published rows stay
      protected). Migration:
      `20260516000020_restaurants_delete_owner_draft_policy.sql`.
    - Workspace switcher (sidebar + customer account dropdown) tags
      `is_published=false` rows with "Draft — finish setup". Clicking
      a draft routes to `/setup?restaurant_id=<id>` (not `/dashboard`).
      "+ Add restaurant" / "+ Set up your restaurant" buttons now route
      to `/setup?new=1`. Sidebar has a "View all drafts" footer link
      → `/drafts`.
    - `SetupPage.tsx` reads `?new=1` (skip resume, fresh Step 1) and
      `?restaurant_id=<id>` (resume that specific draft, with ownership
      check via `user_restaurant_roles`; mismatch → redirect to
      `/drafts` with toast). `Step1Basics.tsx` passes `force_new` +
      `restaurant_id` in the edge-fn body.
    - `signup-restaurant-owner` edge fn honors `force_new=true` (always
      INSERT) and explicit `restaurant_id` (UPDATE that draft). Implicit
      fallback: most-recent unpublished draft for the user is UPDATEd.
    - Shared helper:
      `apps/web/src/lib/onboarding/computeDraftStep.ts` —
      `computeDraftStep({ hours_json, cover_photo_url, deposit_tiers,
      hasTables, hasShift, tierItemCount })` returns 2..8. Used by
      `SetupPage.tsx`'s resume effect, `DraftsPage`, and (future)
      workspace-switcher inline step display.
  - **Cuisine typeahead.** `CuisineSelect.tsx` refactored to a Combobox
    using `Popover` + `cmdk` `Command*`. Same `value` / `onValueChange`
    props — no caller changes. Headless Chrome MCP can't always render
    the popover (Radix Popper positioning relies on
    requestAnimationFrame/ResizeObserver that headless mode sometimes
    skips); works in real browsers. See `DashboardTopBar` for a
    confirmed-working sibling pattern.
  - **Finish-button feedback.** Step 8's `PublishHints` now appears in
    a prominent yellow callout *above* the Publish button (was tiny
    grey text below). Disabled-button click shows
    `toast.error("Complete the steps above first.")`. The
    disabled-attribute is gone; the click handler branches on
    `publishReady` to either toast or call `publish()`.
  - **Save & exit confirm dialog.** `WizardShell.tsx` wraps the Save
    & exit click in a confirm `Dialog`: "Save and exit?" with "Keep
    working" and "Save & exit" buttons. Steps already auto-save, so
    the dialog is pure accident guard.
  - **5 MB image size cap.** Shared
    `apps/web/src/lib/images/assertImageSize.ts` →
    `assertImageSizeOk(file): boolean` that toasts and returns false
    on >5 MB. Applied in `Step6Photos.tsx` (cover/logo/gallery),
    `usePromotions.ts`, `useEvents.ts`, `useMenuItems.ts`, and
    `SettingsPage.tsx` (any uploader writing to the `event-media`
    storage bucket).
  - **Dead inline-signup branch removed.** `Step1Basics.tsx` no longer
    carries the `isLoggedOut` / `loggedOutSchema` / email+password
    block — `/setup` is `<RequireAuth>`-gated so the path was
    unreachable. Schema is now a single `formSchema` with no
    `superRefine`.
  - **Voice mic FAB hidden on `/setup` and `/drafts`.** `App.tsx`
    `CustomerVoiceOrbFAB` early-returns on those paths.

- **Reservation payments — show + refund on cancel (2026-05-15 late).**
  The diner's `BookingDetailsPage` (`/bookings/:reservationId`) now
  surfaces a "Payment summary" section listing pre-ordered items (qty ×
  name × price + total) and any deposit cards, each with a coloured
  status badge: green Paid, grey Refunded (struck-through), amber
  Pending, red Failed. Section hides entirely when there are no
  payments. Data comes from new hook
  `apps/web/src/hooks/useReservationPayments.ts` which fires two
  parallel queries against `orders` (joined to `order_items`) and
  `reservation_deposit_payments` for the current reservation; RLS
  enforces diner-owns-the-row via the existing `orders_select_own` +
  `rdp_diner_select` policies. `cancel-reservation` was upgraded to
  automatically refund every associated `orders.status='paid'` (via
  `stripe.refunds.create`, marks row `'refunded'`) and every
  `reservation_deposit_payments.status='charged'` row with a real PI.
  Stub-mode deposits (`stripe_payment_intent_id` IS NULL, current state
  per `DEPOSIT_STRIPE_STUB_MODE=true`) get flipped to `'refunded'` in
  DB without a Stripe call so the UI reflects reality. New shared
  helper `supabase/functions/_shared/stripe-refund.ts` (`refundPaymentIntent`)
  is used by BOTH the upgraded `cancel-reservation` AND the existing
  `refund-payment-intent` race-recovery path — identical idempotency
  (Stripe `charge_already_refunded` treated as success). Refund
  failures NEVER block cancel; the response carries a `refunds[]`
  array + `refund_total_cents` and the diner toast surfaces either
  `"Reservation cancelled. $X.XX refunded to your card."` or
  `"Reservation cancelled. Some refunds are still processing — we'll
  email you once they complete."` Cancel-confirm dialog body text
  switches to mention the refund amount when payments exist. Refunds
  rely on destination-charge behavior (`transfer_data.destination =
  stripe_account_id`) — Stripe automatically pulls funds back from the
  connected restaurant account; Cenaiva keeps its 5% application fee
  by default (`refund_application_fee` defaults to false). Files
  touched: `supabase/functions/_shared/stripe-refund.ts` (new),
  `apps/web/src/hooks/useReservationPayments.ts` (new),
  `supabase/functions/cancel-reservation/index.ts`,
  `supabase/functions/refund-payment-intent/index.ts`,
  `apps/web/src/pages/customer/BookingDetailsPage.tsx`.

- **Deposits: real Stripe charge confirmation (2026-05-15 late).** Up
  to today the diner-side deposit flow had a subtle bug: after Stripe
  confirmed the PaymentIntent, the client tried to UPDATE
  `reservation_deposit_payments.status='charged'` directly. The table's
  RLS policies (`rdp_diner_select` + `rdp_owner_select`) permit SELECT
  for diners and staff, but UPDATE only via service-role + staff. So
  for a non-staff diner that client UPDATE silently failed — the row
  stayed `pending`, the settle trigger never fired, the reservation
  was stuck at `pending_payment` even though Stripe had charged the
  card. Mark didn't catch this in earlier tests because as owner of
  Mark Testing he hits the staff RLS branch. Fix: new edge function
  `supabase/functions/confirm-deposit-paid/index.ts` mirrors the
  `mark-order-paid` pattern — accepts `{ payment_id, payment_intent_id }`,
  re-fetches the PI from Stripe, verifies status is
  `succeeded`/`processing` AND amount >= deposit amount (anti-fraud,
  because the PI can be larger when it bundles a pre-order), then
  flips the row via service-role. Idempotent: a retried call with the
  same PI returns success without re-writing. Anon-callable (verify_jwt
  = false), security comes from re-verifying the PI with Stripe.
  Client-side: `RestaurantPublicPage.tsx` (~line 2030) now POSTs to
  `/functions/v1/confirm-deposit-paid` instead of the broken raw
  UPDATE. The deposit money itself was already real Stripe — the PI
  for `totalNow = total + previewDepositDollars` was already
  destination-charged to the restaurant's connected account; only the
  DB bookkeeping was broken. `confirm-deposit-stub` stays in the repo
  for local-dev / harness use (not called from production code paths).
  Settle trigger unchanged.

- **Reservation-after-payment fix (2026-05-15).** The diner checkout used
  to eagerly create the reservation on entry to the Review & Pay step so
  Stripe Elements could mount with a `clientSecret`. That meant a diner
  who bailed mid-checkout left a `pending_payment` reservation holding
  their slot, AND the user saw an in-progress booking in My Bookings
  before they'd paid. Now the reservation is only created after the
  Stripe PaymentIntent succeeds. Card form mounts on Review & Pay
  WITHOUT a reservation existing via **Stripe deferred PaymentIntent
  mode** (`<Elements options={{ mode: "payment", amount, currency }}>`
  with no clientSecret). On Place Order: `elements.submit()` validates,
  then `create-public-payment-intent` is called JIT to mint the PI,
  `stripe.confirmPayment` charges the card, then `onPaid(piId)` calls
  `createReservationCore` to write the reservation + order, then
  `mark-order-paid` flips the order to `status='paid'` with the PI id.
  If the slot was taken in the race window after Stripe but before
  `create-public-booking` returns, `refund-payment-intent` auto-refunds
  the card and surfaces "your card has been refunded." Free reservations
  (`totalNow === 0`) skip Stripe entirely. Three edge functions
  involved: `create-public-payment-intent` (updated to v2 — accepts
  `restaurant_id` only, no `reservation_id`); `refund-payment-intent`
  and `mark-order-paid` are new. Verified end-to-end in Chrome with
  Mark's real account (Georgy Inc): three bookings created, declined
  card produces zero rows, approved cards produce `confirmed`
  reservations + `paid` orders with PI ids stored. Order RLS only
  permits restaurant staff to UPDATE rows; that's why the order
  paid-state has to go through a service-role edge function instead of
  client-side.

## Headline state (2026-05-14)

- **Phase D Stripe wire-up shipped (2026-05-14).** Restaurant onboarding
  wizard Step 8 now mounts Stripe Connect Embedded onboarding + a Stripe
  Elements SetupIntent card form for the $200 CAD/mo subscription with 90-day
  trial. Publish gate requires KYC verification (`stripe_charges_enabled`)
  AND an active `trialing`/`active` subscription before the "Publish my
  restaurant" button enables. Four new edge functions:
  - `supabase/functions/create-stripe-account` — idempotent Connect Custom
    account creation. country=CA, business_type=company, mcc=5812 (Eating
    Places), card_payments + transfers capabilities, daily payout schedule.
    If `restaurants.stripe_account_id` already set, retrieves and returns
    current state.
  - `supabase/functions/create-account-session` — short-lived Account Session
    for the embedded `ConnectAccountOnboarding` component (called every time
    the component mounts).
  - `supabase/functions/create-subscription` — creates platform-level Stripe
    Customer (NOT on the connected account), attaches the payment method,
    sets it as default, then `subscriptions.create` with
    `STRIPE_SUBSCRIPTION_PRICE_ID`, `trial_period_days=90`,
    `payment_behavior=default_incomplete`. Persists `stripe_customer_id`,
    `subscription_status`, `trial_ends_at` to the restaurant row.
  - `supabase/functions/stripe-webhook` — `constructEventAsync` signature
    verification, in-memory dedupe of recent event ids. Handles
    `account.updated` (syncs charges/payouts/details flags),
    `account.application.deauthorized` (clears stripe_account_id + flags),
    `customer.subscription.created/updated` (mirrors status + trial_end),
    `customer.subscription.deleted` (status=canceled, flips
    `is_published=false` for graceful unpublish),
    `customer.subscription.trial_will_end` + `payment_intent.*` +
    `invoice.payment_failed` (log only — deposit flow has its own
    webhook layer for those).
  - Follow-up migration `20260514213000_add_stripe_kyc_state.sql` adds three
    boolean columns `restaurants.stripe_charges_enabled /
    stripe_payouts_enabled / stripe_details_submitted` (default false)
    mirrored from Stripe via the webhook. The publish gate UI polls the
    restaurant row for ~30s after the embedded onboarding's `onExit` fires.
  - New web component `Step8PaymentSetup.tsx` replaces the interim
    `Step8InterimPublish.tsx` (deleted). It mounts
    `<ConnectComponentsProvider><ConnectAccountOnboarding /></ConnectComponentsProvider>`
    from `@stripe/react-connect-js` + `loadConnectAndInitialize` from
    `@stripe/connect-js`, plus `<Elements><PaymentElement /></Elements>` from
    `@stripe/react-stripe-js` for the subscription card. Submit flow calls
    `stripe.confirmSetup({ redirect: "if_required" })` to tokenize the card
    → passes the resulting `payment_method` id to `create-subscription`.
  - `useRestaurantSetupCompletion` now requires all four (stripe_account_id
    non-null + charges_enabled + active sub + is_published) for Step 8 to
    count as complete (previously just `is_published`).
  - `supabase/config.toml` updated with `verify_jwt = false` for all four
    new functions (JWT decode happens inside the handler for the three
    owner-auth functions; the webhook verifies via Stripe signature).
  - Legacy `/setup-legacy` route + `SetupPageLegacy.tsx` deleted. New
    `Restaurant` type fields in `useRestaurant.ts`:
    `stripe_charges_enabled`, `stripe_payouts_enabled`,
    `stripe_details_submitted` (all `boolean | null`).
  - npm packages added in `apps/web/`: `@stripe/connect-js`,
    `@stripe/react-connect-js` (runtime, NOT devDependencies).
  - Stripe SDK version pinned to `npm:stripe@17` (matches
    `stripe-setup-intent`, `stripe-charge-order`); apiVersion
    `2024-11-20.acacia`.

## Headline state (2026-05-13)

- **17-capability /goal verification pass (v304–v309, 2026-05-13 late
  evening).** End-to-end Chrome MCP run against Mark's real account
  verified every Hey Cenaiva capability. Six orchestrator deploys + two
  client-side files touched. Confirmed reservations in DB (book / modify
  / cancel; event-linked FF2155CC, promo-linked E8D045FC). New bugs
  found and fixed:
  - **v304 — Events query phrasing widened.** Old regex matched only
    "events at X". Now also matches "what events ARE at X", "events
    happening at X", "show me events at X", "what's happening at X".
    File: `cenaiva-orchestrate/index.ts:5430` (factLookupMatch events
    patterns). Test phrase "what events are at jacobs" now returns
    "Jacobs & Co. Steakhouse has 2 events coming up — Wagyu Masterclass…
    Beaune Burgundy…" instead of "Looks like Jacobs & Co. Steakhouse.
    That's the spot?".
  - **v305 — Modify regex + restaurant-name disambig.** (a) Target-word
    regex widened to allow 0-3 word adjective between "my/the" and the
    noun, so "change my jacobs reservation to 7pm" matches. File:
    `cenaiva-orchestrate/index.ts:6449`. (b) When user has multiple
    active reservations and the transcript names a restaurant, narrow
    to that restaurant before the active.length==1 branch fires.
    `cenaiva-orchestrate/index.ts:6461-6485` (filteredByName logic with
    accent-strip + token-score). (c) Client-side mirror in
    `apps/web/src/lib/cenaiva/localBookingCollector.ts:862-873` —
    Stage 1 must `pass` modify/cancel verbs to the orchestrator, else
    Stage 1's missing-fields prompt fires on "change my X reservation
    to 7pm" because "7pm" makes hasLocalBookingDetail=true.
  - **v306 — Cancel handler gated on reservationId.** Old code: cancel
    early-handler at line 6415 fired with "I can help cancel, but I
    need the reservation details first." even when no reservationId
    was present, BLOCKING the no-reservation-in-state handler at line
    6446 that does the proper active-reservation lookup. Fix: require
    `reservationId &&` so the early handler only handles the
    in-flight case. `cenaiva-orchestrate/index.ts:6415-6437`.
  - **v307 — Deposit hand-off on casual path.** The casual handler's
    early-confirm at line 6136 called `completeBooking` directly with
    no deposit check, silently booking parties≥8 at Mark Testing for
    $0 (should be $80). Fix mirrors the LLM tool branch at line 9159:
    call `compute_deposit_for_party`; if depositCents>0, navigate to
    `/<slug>?date=&time=&people=&shift_id=` + close_assistant, with
    spoken reason "Parties of N need a $X deposit at <name>. Opening
    the booking page so you can add your card."
    `cenaiva-orchestrate/index.ts:6134-6184`.
  - **v309 — Pre-order intent hand-off.** New deterministic handler at
    the top of `buildPreflightResponse` (before casual booking patterns)
    that detects "pre-order food", "order ahead", "order food in
    advance", etc. Fuzzy-resolves restaurant from transcript (or uses
    booking_state), then navigates to `/<slug>?date=&time=&people=&step=menu`
    + close_assistant. Spoken reason: "Pre-orders need the menu page
    at <name>. Opening it now so you can pick dishes." File:
    `cenaiva-orchestrate/index.ts:4640-4700`. Lives inside
    `buildPreflightResponse` so only `bookingState`, `selectedRestaurantId`,
    and `opts.timezone` are in scope (NOT `currentRestaurantId` —
    that's in the outer handler).
  - **Dev-only test bridge (does NOT ship to prod).** Two
    `import.meta.env.DEV` guards added to enable headless harness-free
    testing: (1) `apps/web/src/components/cenaiva/AssistantProvider.tsx`
    exposes `window.__cenaivaTest = { send, open, close, getState,
    getSpoken, setTextMode }`. `send(transcript)` awaits the full
    Stage 1→4 pipeline and returns the spokenText + booking state.
    (2) `apps/web/src/hooks/useCenaivaVoice.ts` `speak()` returns
    early when `window.__cenaivaSilenceTTS = true` so test turns
    don't block on ElevenLabs audio playback.
- **Voice modify cross-session fixed (v301–v303, 2026-05-13).** Three-deploy
  fix for the modify handler at `cenaiva-orchestrate/index.ts` lines
  6440-6494 (the "modify/cancel verb with NO active reservation in
  booking_state" branch). Problem: when a user closed the assistant after
  booking and reopened it, then said "change my reservation to 8pm", the
  orchestrator replied "You don't have any active reservations to change"
  even though the reservation existed in the DB.
  Root cause was three layered gaps:
  1. The target-word regex at line 6443 required `it|that|the booking|the
     reservation` but DID NOT match `my booking|my reservation|my table|
     etc`. So the deterministic handler never fired for natural phrasings
     like "change **my** reservation to 8pm". The transcript fell through
     to the LLM tool flow, which hallucinated "no reservations on file"
     instead of calling `list_my_reservations`.
  2. Even when the regex matched, the handler at line 6470 only promoted
     `reservation_id + restaurant_id + restaurant_name` into booking_state.
     It did NOT promote `date / time / party_size / shift_id` from the
     reservation row, so subsequent modify turns (`if (currentRestaurantId
     && newDate && newTime && newParty != null)`) failed because
     newParty/newDate were null and the handler fell into "What date and
     time?" — confusing, since the user already provided a time.
  3. When the user named a new time in the SAME utterance as the modify
     verb ("change my reservation to 8pm"), the handler still asked "what
     day?" and then the LLM took over via `modify_reservation` tool —
     which only updates `special_request` text, not the actual slot. The
     reservation stayed at 7pm with a stale `special_request: "Change time
     to 8 PM"` note attached.
  Fixes applied as three small deploys:
  - **v301**: widened the target-word regex to also match
    `my\s+(?:booking|reservation|table|rez|res|dinner|date|time|party|
    spot|sitting)` and `the\s+(?:booking|reservation|table|...)`. Plus
    added `make\s+it|set\s+it` to the verb regex.
  - **v302**: the handler's SELECT now pulls `party_size, shift_id,
    restaurants(name, timezone)`. It computes `reservedDate` via
    `formatISODateInTimeZone` and `reservedTime` via `Intl.DateTimeFormat
    ({ timeZone, hour: '2-digit', minute: '2-digit', hour12: false })`,
    then promotes all of `date / time / party_size / shift_id` into
    booking_state.
  - **v303**: when `parseTime(transcript)` returns a new time AND
    `partySize` is known, the handler immediately calls
    `getAvailability(restaurant_id, reservedDate, partySize)` +
    `findNearestSlot(slots, requestedTime)`. If a slot is available, it
    queues `pending_action: { type: "modify_reservation", payload: {
    reservation_id, restaurant_id, party_size, date, time:
    slot.display_time, shift_id, slot_iso } }` directly. User says
    "yes" → `confirmPendingAction` → `modify_reservation_slot` RPC.
    Single-turn modify works. Cancel verbs follow the same pattern with
    `type: "cancel_reservation"`.
  Verified end-to-end in Chrome with Mark's real account:
  - "book mark testing for 2 friday at 7pm" → "yes confirm" → "yes" →
    confirmation BEA10E83 (DB confirmed).
  - Closed assistant, reopened. "change my reservation to 8pm" → "Want
    to move your Mark Testing booking from 7:00 PM to 8:00 PM on
    2026-05-15? Say yes." → "yes" → "Done, the change is in." DB
    `reserved_at` moved from `2026-05-15 23:00 UTC` to `2026-05-16 00:00
    UTC` (= 8pm local). ✓
  - "cancel my reservation" → "Just confirming: cancel your reservation
    at Mark Testing?" → "yes" → "Got it, that booking's cancelled." DB
    status=cancelled, reason="Cancelled via Cenaiva". ✓
- **Harness safety — FIXED (2026-05-13 late evening).** The dangerous
  `harness_cleanup_test_user()` RPC was dropped (migration
  `20260513213000_drop_dangerous_harness_cleanup.sql`). It was
  SECURITY DEFINER, anon-callable, and unconditionally cancelled every
  confirmed / pending / seated / arriving reservation for Mark's
  `user_profile_id = 'de3fbe5e-...'` — 368 of them got nuked in one
  overnight cycle before this was caught. The harness now calls
  `harness_cancel_by_ids(p_ids uuid[])` which is scoped:
  `WHERE id = ANY(p_ids) AND user_profile_id = 'de3fbe5e-...'` (only
  the explicit ids the harness itself created, AND only on Mark's
  profile). The Plan agent's "B7 passes / B8 fails is a concurrency-
  race" diagnosis was actually the cleanup RPC nuking just-booked
  reservations 15–100 ms after creation. Harness is now safe to run.
  Companion RPCs `harness_cancel_by_code` (single-reservation, gated
  on test user profile) and `harness_cleanup_my_reservations` (uses
  `auth.uid()`, only touches caller's own rows) stay.
- **Voice-side flows verified working in real browser (2026-05-13).**
  Beyond book/modify/cancel above:
  - **Promos query** — "any deals at harbour sixty" → "Harbour Sixty
    Steakhouse has 2 active promos — Three-Course Tasting Menu (code:
    TASTING95); Industry Night — 20% Off (code: INDUSTRY). Want me to
    book you a table?" ✓
  - **Joke / off-topic** — "tell me a joke" → "I'm more of a dinner date
    than a joke-teller, but I promise I've got a great table waiting!
    Want to pick a spot?" ✓ (on-brand persona redirect)
- **Known voice-side gaps (carry to tomorrow, 2026-05-13):**
  - **Events handler too narrow.** "what events are at Harbour Sixty"
    returns the restaurant card with "Found Harbour Sixty Steakhouse —
    that the one?" instead of listing the 2 active events. The
    fact-lookup events branch doesn't match this phrasing. Fix in the
    events handler regex (likely `factLookupMatch` or the events fact
    branch).
  - **Deposit hand-off doesn't fire on casual booking path.** Party of
    8 at Mark Testing (deposit tier kicks in at min_party_size=8,
    $10/person → $80 deposit) routes through the casual handler →
    "yes confirm" → directly calls `completeBooking` and fails with
    `promotion_not_available` instead of redirecting to the public
    restaurant page with deposit prefill. The CLAUDE.md pattern below
    documents the hand-off as living in the LLM tool `complete_booking`
    branch (~line 6470) and the post-loop auto-finalize path (~line
    7103). The casual handler at the confirm-pending-action step needs
    the same `compute_deposit_for_party` check before calling
    `completeBooking`.
  - **Pre-order hand-off** — likely affected by the same gap as
    deposit; untested in this session but lives in the same code path.
  - **Mid-flow change-of-mind ("actually nevermind", "wait change to 5
    people")** — untested in this session.

## Headline state (2026-05-12)

- **Casual handler — single-utterance slot resolution (2026-05-12,
  orchestrator v292).** When `bookReservePattern` / `wantToGoPattern` /
  etc match AND the same utterance includes party + date + time
  ("book mark testing for 2 thursday at 7pm"), the casual handler now
  calls `getAvailability(restId, inferredDate, inferredParty)` and
  matches the requested `time` against returned `display_time` slots.
  On a match it populates `shift_id` + `slot_iso` and flips
  `booking.status` to `confirming` + `step` to `confirm`. Without
  this, the follow-up "yes confirm" turn bailed at the confirmation
  handler with "I need the reservation details again. What date and
  time?" — fixed harness Group A regression A1–A10. Logic at
  `cenaiva-orchestrate/index.ts:4720-4775`.
- **Granular missing-field phrasing in casual handler (2026-05-12,
  v290).** When only one field is missing, ask for just that field —
  not the catch-all "What date and time?": all fields + slot resolved
  → "Confirming?"; all fields, slot not resolved → "Let me check
  availability."; missing party + date + time → "How many, and when?";
  missing party only → "How many guests?"; missing date + time →
  "What date and time?"; missing date only → "What date?"; missing
  time only → "What time?". Judge finding: "Dinner for 4 at STK
  Toronto tomorrow night" extracts date but vague time, was asking
  "what date and time?" which clobbers the date the user gave.
- **Colloquial party-size words (2026-05-12, v290).** `parsePartySize`
  `peopleMatch` regex extended to `amigos|pals|peeps|mates|buddies|
  friends|dudes|guys|chicas|gals|gents|fellas` alongside the existing
  `people|guests|ppl|pax|persons|heads|of us|adults`. Judge finding:
  "book mark testing for two amigos thursday at 7pm" was returning
  party=null because "amigos" wasn't in the noun list. Also: the
  casual handler now delegates to `parsePartySize(transcript)` instead
  of an inline digit-only regex, so it picks up `couple`, `couple of
  us`, `half a dozen`, `dozen`, `me and N others`, `the both of us`,
  `myself and one other`, etc. Range 1-99 enforced.
- **Event-theme filter in fact-lookup events handler (2026-05-12,
  v291).** Old behavior: "wagyu wednesday at jacobs" returned all 3
  upcoming events at Jacobs (Wagyu Masterclass + Beaune Burgundy + …).
  New: 24 theme keywords (wagyu/wine/live music/trivia/karaoke/comedy/
  dj/prix fixe/tasting/burgundy/champagne/whiskey/rib/industry/brunch/
  happy hour/jazz/salsa/country/rock/pairing/chef) match the
  transcript; when matched, the events query is filtered with
  `.or("name.ilike.%theme%,theme.ilike.%theme%")`. Empty result
  themed: "No wagyu events scheduled at Jacobs right now."
- **Deals routing widened + scope-checked (2026-05-12, v291/v294).**
  `globalAnswerCandidate` deals pivot now catches `any deals / promos /
  promotions / specials / offers / discounts / coupons` (was only
  `any deals?`). 4 randomized spoken_text variants ("Opening the deals
  page now.", "Sure — pulling up active deals.", "Here come the
  deals.", "Taking you to the deals page."). Scope check
  `dealsHasAtRestaurant` broader to avoid hijacking restaurant-scoped
  queries: catches `at|in|near|for|from <name>`, `does <name> have`,
  `<name>'s deals`, and `promo code`. Harness V8 regression: "does
  georgy inc have any specials" was being navigated to /deals instead
  of falling to the per-restaurant fact-lookup.
- **Hours-question handler reads hours_json (2026-05-12, v293).** The
  fact-lookup handler's hours branch (`/\bopen\b|\bhours\b|\bclose[ds]?
  \b|\bwhat time/`) used to deflect with "I'd need to pull up live
  hours for X — want me to check availability for a specific date?".
  Now reads `hours_json` directly. Shape: `{ monday: {open, close}|
  null, ... }`. Day inference: weekday name from transcript → that
  day; otherwise today in restaurant tz. Replies "Restaurant is open
  11:00 AM–10:00 PM on Tuesday. Want me to book a table?" or
  "Restaurant is closed on Sunday. Want to try a different day?". Also:
  factLookupMatch's `stateRestaurantName` shortcut now matches
  `your` (in addition to `the/their/its`) and catches `what time do
  they open/close` + `are they open/closed` patterns.
- **Modify-confirm pending_action without rid — fallback resolver
  (2026-05-12, v293).** `confirmPendingAction` used to dead-end with
  "I can't update that reservation from here yet. Please open the
  reservation details." when the queued pending_action had no
  reservation_id. Now: queries the user's active future reservations.
  If exactly one → use it. If multiple → "You have a few active
  bookings — which one should I update?". If none → "You don't have
  any active reservations to change. Want to book a new one?" 3 judge
  findings tonight on bare "yes" replies landing in this branch.
- **Harness final 280/281 (99.6%, 2026-05-12, v294).** Up from 219/281
  (78%) at iter21. The single remaining "fail" is P9: a 4-turn
  multi-booking sequence (book + confirm + book again + confirm) that
  exceeds the harness's 10s/call timeout. Edge function logs show all
  200s; the orchestrator served every request — the harness gave up
  waiting. Test-infra limit, not a real bug.

## Hard rules — never violate

- Never bypass `book_reservation` or `modify_reservation_slot` for
  reservation writes. They own the advisory lock + cover-cap recheck +
  diner-overlap pre-check. Direct INSERTs also fail the partial
  exclusion constraints, but the error is opaque (`23P01`) — always go
  through the RPCs so users see `P0006 / diner_double_book` instead.
- Never cache booking writes. The atomic RPC + exclusion constraint own
  correctness; cached writes break that.
- Never re-introduce `COALESCE(s.max_covers, 100)` in any reservation
  RPC. NULL means "no cap" (2026-05-10 cover-cap removal). Gate the
  cover-cap check on `IF v_max_covers IS NOT NULL THEN ...`. The
  default-to-100 pattern silently throttled real restaurants; reverting
  it would re-introduce that bug.
- Never insert into `reservation_deposit_payments` outside of the
  `prepare-deposit` edge function. The table has RLS that allows only
  service-role writes — direct client inserts will be rejected. The
  settle trigger that flips reservations to 'confirmed' fires only on
  rows it manages, so writing rows from random places breaks the state
  machine.
- Never UPDATE `orders` from the diner-facing client. RLS policy
  `orders_update_staff` restricts UPDATE to restaurant staff only;
  diner-side calls silently fail with zero rows affected (no error
  thrown). To flip an order to `status='paid'` post-payment, use the
  `mark-order-paid` edge function which validates the Stripe
  PaymentIntent and writes with service-role.
- Never leave paid orders or charged deposits unrefunded when a diner
  cancels OUTSIDE the 24h cliff. `cancel-reservation` owns the
  diner-side refund path: when `reservedAt - now >= 24h` it
  Stripe-refunds every `orders.status='paid'` row and every
  `reservation_deposit_payments.status='charged'` row tied to the
  reservation, then marks each as `'refunded'`. Stub-mode deposits
  (null PI) get DB-only marked refunded so the UI matches reality.
  When the cancel falls **within 24h** of the reservation, the refund
  phase is SKIPPED — the diner forfeits their pre-order + deposit per
  the cancellation policy. The reservation still cancels (slot reopens
  for the next diner), `cancellation_reason` is set to "Cancelled by
  diner (within 24h — non-refundable)", and the response carries
  `forfeit_total_cents` + `within_24h: true` so the UI can toast
  "$X.XX forfeited per the 24h cancellation policy." If you add a new
  diner-cancel surface (e.g. a voice "cancel my reservation" shortcut),
  route it through `cancel-reservation` — never raw-UPDATE
  `reservations.status='cancelled'` and skip the refund/forfeit phase.
  Refund failures NEVER block the cancel; the response carries
  `refunds[]` + `refund_total_cents` so the UI can toast the
  partial-refund case. Shared helper:
  `supabase/functions/_shared/stripe-refund.ts` (`refundPaymentIntent`).
  Both confirm dialogs (BookingDetailsPage + BookingsPage) MUST show
  the 24h policy warning before the cancel fires — no surprise
  forfeits.
- Never drop or weaken the `restaurants_publish_gate` trigger. It is
  the trust boundary preventing a savvy actor from flipping
  `is_published=true` via direct supabase-js writes. The client-side
  check in `Step8PaymentSetup.tsx` is good UX; the trigger is the
  real gate. If gate conditions change, update the trigger AND the
  client gate in lock-step.
- Never bypass `assertImageSizeOk` when uploading to the `event-media`
  storage bucket. The 5 MB cap prevents diner-side page bloat and
  storage cost runaways. If a use case truly needs larger files,
  bump the constant in `apps/web/src/lib/images/assertImageSize.ts` —
  don't carve out exceptions in individual call sites.
- Never silently overwrite existing drafts in `signup-restaurant-owner`.
  Honor `body.force_new=true` (always INSERT) and `body.restaurant_id`
  (target a specific draft). Implicit fallback (no params) UPDATEs the
  most-recent unpublished draft. When in doubt, route through
  `/setup?new=1` to force a fresh row.
- Never call `confirm-deposit-stub` from production code paths. As of
  2026-05-15 the diner deposit flow runs through `confirm-deposit-paid`
  (real Stripe, service-role write, validates the PI). The stub stays
  in the repo for local dev / harness scenarios only. If you need to
  flip a deposit row to charged from anywhere else, route through
  `confirm-deposit-paid` so the Stripe re-verification happens.
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
- `NO_AUTO_RELISTEN_STATUSES` covers ONLY `paid` (since 2026-05-10).
  Voice never enters preorder/menu/checkout statuses — those are now
  hand-offs to the public restaurant page. Don't add other statuses
  back in unless you also revert the hand-off pattern. The mic also
  blocks when AI TTS is active (`voice.speak()` stops the recognizer)
  and when the user manually mutes via `voice.toggleMute()`.
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

- **Multi-table combiner:** `find_available_table_group(uuid, timestamptz,
  integer, integer, uuid, double precision)` — recursive CTE up to 16
  tables. Strategy: (1) smallest single table that fits, (2) adjacent
  same-section combo, (3) any-combo fallback. Early-returns
  `ARRAY[]::uuid[]` when party_size > `restaurant_floor_capacity()`.
  Captured in `20260510000100_capture_find_available_table_group.sql`.
  Helpers: `restaurant_floor_capacity(uuid)` (sum of active table
  capacities) and `restaurant_turn_time_minutes(uuid, uuid)`
  (settings_json.turnTimeMinutes → shift.turn_time_minutes → 90,
  clamped [15, 480]).
- **Deposit policy:** `restaurants.deposit_tiers` JSONB array of
  `{min_party_size, amount_per_person_cents}` + `compute_deposit_for_party
  (uuid, integer) RETURNS integer` (highest tier wins, NOT additive).
  `reservation_deposit_payments` (RLS: owner-staff + diner read; service-
  role write). Settle trigger flips reservation to 'confirmed' once
  every payment row is 'charged'. Owner UI:
  `<DepositPolicyEditor>` at
  `apps/web/src/components/dashboard/DepositPolicyEditor.tsx`. Customer
  UI: deposit appears as a line item on the existing checkout step in
  `RestaurantPublicPage.tsx` (no separate step) — `previewDepositDollars`
  is added to `totalNow` and surfaced in the order summary as
  `Deposit (N × $X.XX)`. The menu step's "Continue" button label
  becomes "Continue to checkout · Deposit $X" when a deposit applies,
  so deposit-required parties always reach checkout. After
  `create-public-booking` returns `deposit_required`,
  `handlePlaceOrder` calls `prepare-deposit` then `confirm-deposit-stub`
  before transitioning to `step === "confirmed"`.
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
  `apps/web/src/hooks/useAvailability.ts` — multiplexed postgres_changes
  channel scoped to one restaurant. Multiple components on the same page
  may call it for the same `restaurantId`; the hook holds a module-level
  registry keyed by id, so they share ONE socket and each gets its own
  callback. Used by `RestaurantPreviewModal`, `RestaurantPublicPage`,
  and `AvailabilityPanel` (mounted inside the first two). Don't use it
  from Discover/Deals (one entry per card still explodes the connection
  count). Naive same-name `client.channel(...)` calls used to crash the
  modal subtree with `cannot add postgres_changes callbacks ... after
  subscribe()` — fixed 2026-05-09 by the registry, after the unified
  `<AvailabilityPanel>` started subscribing alongside the modal/public
  page that already did.

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
- `DINER_MOBILE_GUIDE.md` — diner-side mobile-mirror handoff
  (2026-05-09, v1.1). Read this before building any iOS/Android/RN
  client that mirrors the web's diner surfaces. Covers every UI
  surface (Discover, Deals, Preview modal, Public page,
  AvailabilityPanel, My Reservations, Modify/Cancel, Account,
  Notifications), full table schemas for the diner-relevant subset,
  every RPC and edge function the diner consumes, the booking
  lifecycle state machine, search + auto-roll + filters, multiplexed
  realtime registry pattern, complete error-code reference
  (P0001–P0008), and a 12-step implementation order. **Hey Cenaiva
  voice assistant is intentionally OUT OF SCOPE** — mobile does NOT
  mirror the voice pipeline (no wake word, no `cenaiva-orchestrate`,
  no ElevenLabs/Deepgram, no `user_profiles.cenaiva_tts_voice`).
  Read-only directive: mobile consumes; never modifies schema.

## When in doubt

Stop and ask. Don't infer architectural decisions from old patterns —
the docs above are the source of truth, and they're updated after every
shipped phase. If something in code contradicts a doc, the doc is right
until proven otherwise.
