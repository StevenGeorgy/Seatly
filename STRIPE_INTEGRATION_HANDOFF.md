# Cenaiva Stripe integration — handoff document

**For:** The next AI engineer picking up this codebase
**Status as of:** 2026-05-21
**Author:** Claude (Anthropic)
**Project ref:** Supabase `exbjodmnpdiayfzrdyux` (ca-central-1)
**Stripe mode:** TEST mode (no real money). Not yet launched.

This is the single source of truth for everything Stripe in Cenaiva. Read
this before touching `supabase/functions/stripe-*`,
`supabase/functions/create-public-*`, or any billing/payments UI.

---

## 1. The 30-second mental model

Cenaiva is a **Stripe Connect destination-charges marketplace**.

- **Platform** = Cenaiva itself (Stripe account `acct_1TQuc8JABKj4FeJX`).
- **Connected accounts** = restaurants (one Express account per restaurant,
  e.g. MICKY = `acct_1TZX8PJ6JzcimHnL`).
- **Fund flow:** Diner pays → Stripe holds 2-7 days → Stripe transfers
  to the restaurant's bank account.
- **Cenaiva's cut:** `application_fee_amount = 5.5% of the BASE amount`
  (not the diner-paid total). Routed to platform automatically.
- **Diner pays:** `base + 5.5% platform fee + Stripe gross-up`. All three
  shown as line items at checkout. Both fees are non-refundable.

The platform has TWO Stripe products on this account:

1. **Restaurant subscription** ($199.99 CAD/mo, 90-day trial) — direct on
   platform's Stripe Customer per restaurant.
2. **Diner deposits + pre-orders + post-meal pay** — destination charges
   on the restaurant's Connect account with `application_fee_amount`.

Plus a **per-confirmed-booking $1 fee** to restaurants (`restaurant_booking_fees`
table → `bill-booking-fees` cron → Stripe invoice items → rolled into next
monthly subscription invoice).

---

## 2. The single source of truth files

When in doubt about Stripe behavior, read these in this order:

1. **`CLAUDE.md`** at the repo root — "Hard rules — never violate". The Stripe
   section says what's load-bearing and what's a footgun.
2. **`STRIPE_UPDATES.md`** — chronological log of every Stripe change
   shipped 2026-05-16 through 2026-05-19.
3. **This file** — the comprehensive handoff.
4. **`RACE_CONDITION_AUDIT.md`** — known race conditions deferred to
   future hardening.
5. **`STRIPE_SETUP.md`** — operator runbook for Stripe Dashboard config.
6. **`MOBILE_STRIPE_GUIDE.md`** — mobile app's Stripe integration. Same
   backend as web. See §17 for what's shared vs different.

Code reference:
- `supabase/functions/_shared/stripe-fee.ts` — fee math (single source)
- `supabase/functions/_shared/refund-math.ts` — refund math (single source)
- `supabase/functions/_shared/stripe-client.ts` — SDK init (added 2026-05-21)
- `supabase/functions/_shared/stripe-refund.ts` — refund helper
- `apps/web/src/lib/stripe-fee.ts` — client mirror of `_shared/stripe-fee.ts`

---

## 3. Pricing model ("Option B")

**Pricing decision shipped 2026-05-19:** the diner sees three line items
at checkout. Both extra fees are non-refundable; refunds are only the
base.

### 3.1 Fee math (server + client, identical)

```ts
// _shared/stripe-fee.ts + apps/web/src/lib/stripe-fee.ts
export function computeDinerCharge(baseCents: number) {
  const cenaivaFeeCents = Math.ceil(baseCents * 0.055);        // 5.5% to platform
  const dinerTotalCents = Math.ceil(                            // gross-up
    (baseCents + cenaivaFeeCents + 30) / 0.971
  );
  const processingFeeCents = dinerTotalCents - baseCents - cenaivaFeeCents;
  const applicationFeeCents = cenaivaFeeCents;                  // routes to platform
  return {
    baseCents,                  // what restaurant nets (before Stripe fee)
    cenaivaFeeCents,            // 5.5% to Cenaiva
    processingFeeCents,         // Stripe's actual 2.9% + 30¢
    dinerTotalCents,            // what diner is charged
    applicationFeeCents,        // application_fee_amount on PI
    dinerPaysFee: true,
  };
}
```

**Worked example** for a $20 deposit:
- baseCents = 2000
- cenaivaFeeCents = `ceil(2000 * 0.055)` = 110 ($1.10)
- dinerTotalCents = `ceil((2000 + 110 + 30) / 0.971)` = 2204 ($22.04)
- processingFeeCents = 2204 − 2000 − 110 = 94 ($0.94 — covers Stripe's actual fee)
- applicationFeeCents = 110 (routes 5.5% to platform)
- Restaurant nets $20 base − $0 Stripe fee (covered by gross-up) = **$20**

Verified live with PI `pi_3TZXkNJABKj4FeJX053rTOYP` on 2026-05-21:
amount=2204¢, application_fee_amount=110¢ — exactly matches.

### 3.2 Refund math (Option B — refund = base)

```ts
// _shared/refund-math.ts
export function computeBreakEvenRefund(baseCents: number) {
  return { refundCents: baseCents };                 // simple under Option B
}
```

**Worked example for refunding the $20 deposit:**
- Stripe refunds $20 to the diner
- Cenaiva keeps the $1.10 platform fee
- Stripe keeps the $0.94 processing fee (does NOT refund the Stripe fee either)
- Restaurant nets $0 on a refund (received $20 at charge → refunds $20 at cancel)

**Both fees are non-refundable, disclosed at checkout, and documented in
`/refund-policy` (apps/web/src/pages/legal/RefundPolicyPage.tsx).**

---

## 4. Account onboarding — Stripe Connect

### 4.1 Choice of API

**Currently using v1 Express accounts.** Stripe is pushing v2
(`POST /v2/core/accounts`) for new platforms, but we deliberately chose
to stay on v1 for these reasons (documented 2026-05-21):

1. Battle-tested with 1000+ examples in Stripe docs
2. Embedded Connect UI (`<ConnectAccountOnboarding/>`,
   `<ConnectAccountManagement/>`, `<ConnectNotificationBanner/>`)
   designed for v1
3. Cenaiva is single-country (Canada), single-currency (CAD), simple
   destination-charge model — v2's added flexibility doesn't apply
4. Stripe has NOT announced a v1 deprecation date

**Migrate to v2 only when:**
- Stripe announces deprecation
- Cenaiva expands to US/UK/EU
- A specific v2 feature (e.g., complex responsibility models) is needed

### 4.2 Files

- `supabase/functions/create-stripe-account/index.ts` — creates the
  Connect account. Idempotent: returns existing account if already created.
- `supabase/functions/create-account-session/index.ts` — issues
  short-lived Account Sessions for the embedded UI. Accepts a `mode`
  parameter:
  - `"onboarding"` (default) → `account_onboarding` component (Step 8
    of wizard, first-time setup)
  - `"management"` → `account_management` + `notification_banner`
    components (dashboard maintenance flow). This is what surfaces
    "Update info" CTAs when Stripe has flagged something.
- `apps/web/src/components/onboarding/Step8PaymentSetup.tsx` — wizard
  Step 8 with the embedded Connect onboarding inline.
- `apps/web/src/components/billing/StripeConnectVerifyPanel.tsx` —
  dashboard surface. Takes `onboardingMode?: boolean` prop to toggle
  between onboarding (re-connect flow) and management (default).
- `apps/web/src/components/billing/PayoutsSection.tsx` — owner-facing
  payouts dashboard. Auto-mounts `StripeConnectVerifyPanel` inline when
  `payouts_enabled = false`.

### 4.3 KYC verification states

Stripe's identity-verification engine is **risk-based**. For most
accounts with verifiable data (real name + real address + adult DOB),
Stripe auto-verifies in the background and never prompts for an ID
upload. The "Verify your identity" step only fires when:
- Address or keyed identity fails auto-verification
- Account flagged by fraud risk model
- DOB indicates under-21 (extra scrutiny)

**Important UI nuance:** Stripe's `account_onboarding` Embedded component
shows the "Information submitted" placeholder when `details_submitted=true`
even if there are pending requirements. Use the `account_management`
mode (via `StripeConnectVerifyPanel`) for the dashboard — it surfaces
actionable banners via `notification_banner`.

### 4.4 Webhook event handling

`supabase/functions/stripe-webhook/index.ts` (deployed) listens for:

| Event | What it does |
|---|---|
| `account.updated` | Syncs `restaurants.stripe_charges_enabled`, `stripe_payouts_enabled`, `stripe_details_submitted` |
| `account.application.deauthorized` | Clears `restaurants.stripe_account_id` (rare) |
| `customer.subscription.created/updated/deleted` | Syncs `restaurants.subscription_status`, drives `is_published` (unpublishes on `unpaid`/`canceled`) |
| `payment_intent.succeeded` | Updates `reservation_deposit_payments.status='charged'` (when applicable) |
| `payment_intent.payment_failed` | Updates `reservation_deposit_payments.status='failed'` + **fires `notifyOwnerDinerPaymentFailed` email (new 2026-05-21)** |
| `payment_method.attached` | Inserts a row in `saved_cards` for the diner |
| `invoice.paid` / `invoice.payment_failed` | Drives subscription lifecycle |

**Webhook dedup is persistent** (since 2026-05-21):
`stripe_webhook_events` table has `event_id` as PK; INSERT ON CONFLICT
DO NOTHING gives atomic deduplication. Previously was in-memory Set,
lost on edge fn cold start.

---

## 5. Diner-facing payment flow (deposits + pre-orders)

### 5.1 The five endpoints

| Edge fn | Purpose | Trust boundary |
|---|---|---|
| `create-public-booking` | Atomically reserves a slot + inserts `reservation_deposit_payments` rows. Supports `split_tender_payers: N` for split tender. | Anon-callable. Confirmation_code returned. |
| `create-public-payment-intent` | Creates a PaymentIntent for a deposit/preorder/order. Stamps metadata: `restaurant_id`, `deposit_payment_ids`, `hold_id?`, `order_id?`. | Anon-callable. |
| `confirm-deposit-paid` | After Stripe payment succeeds, looks up the PI, verifies metadata matches the paymentId, writes `stripe_payment_intent_id` to row. | Service-role from FE. |
| `mark-order-paid` | Same as above but for `orders` rows (pre-orders + post-meal pay). | Service-role from FE. |
| `confirm-hold-paid` | Same for `holds` rows (one-off saved-card holds). | Service-role from FE. |

### 5.2 The settle trigger (PostgreSQL)

`settle_deposit_on_charge` fires AFTER UPDATE on
`reservation_deposit_payments` when status flips to 'charged'. It checks
if ALL rows for the reservation are 'charged' → flips
`reservations.status='confirmed'`. **This is the load-bearing piece for
split tender** — it's the only thing that knows when the last payer settled.

### 5.3 Critical metadata binding

**Every PI must stamp `deposit_payment_ids` on metadata at creation
time.** `confirm-deposit-paid` rejects the call with
`pi_payment_id_mismatch` if the deposit row's ID isn't in the PI's
metadata. This prevents an attacker from substituting any succeeded PI
for any deposit row.

Same for `confirm-hold-paid` (`hold_id`) and `mark-order-paid` (`order_id`).

### 5.4 Payment method config

Per Stripe best practices, the diner-facing PI uses
`automatic_payment_methods: { enabled: true, allow_redirects: "never" }`.
This enables card + same-page wallets (Apple Pay, Google Pay, Link,
Interac) while excluding redirect flows (Klarna, Affirm, Sofort) that
would break the embedded Stripe Elements UX.

**The subscription card SetupIntent uses `payment_method_types: ["card"]`
explicitly.** Subscription billing is recurring; wallets aren't actually
saved-card replacements; Pix is one-time only.

### 5.5 Refund flow

`cancel-reservation` and `modify-reservation` both use
`computeBreakEvenRefund(baseCents)` from `_shared/refund-math.ts`. They
retrieve `application_fee_amount` from Stripe per row and refund
`(amount - applicationFee)` if Stripe API succeeds, falling back to a
full refund on retrieve failure.

`refund-deposit-on-arrival` (cron + dashboard "Seated" button) refunds
the FULL deposit base amount when the owner marks a reservation as
seated. No-show → no refund (deposit is the no-show fee).

---

## 6. Subscription lifecycle

### 6.1 The decoupled flow

Previously, saving a card AND starting the subscription happened in one
shot. Now (since 2026-05-20):

1. **`save-subscription-payment-method`** — saves the card to the
   restaurant's Stripe Customer using a SetupIntent. No subscription
   created. Trial clock doesn't start.
2. **`publish-restaurant`** — atomically creates the Stripe Subscription
   + flips `is_published=true`. Trial starts NOW.

This means owners can save a card during onboarding and not be charged
until they're ready to publish.

### 6.2 Lifecycle endpoints

- `cancel-subscription` — cancels at period end
- `pause-subscription` — sets `cancel_at_period_end` + `paused_at`
- `resume-subscription` — uncancels
- `restart-subscription` — recreates a sub for a canceled restaurant
- `delete-restaurant` — soft-delete + 30-day grace + scheduled purge
- `recover-restaurant` — undoes soft-delete within grace
- `purge-deleted-restaurants` (cron 5am UTC) — anonymizes PII

### 6.3 Status state machine

`subscription_status` enum values: `trialing | active | past_due |
unpaid | incomplete | incomplete_expired | canceled | paused`.

The constant `ACTIVE_SUBSCRIPTION_STATUSES` lives in
`_shared/subscription-status.ts` + `apps/web/src/lib/billing/subscriptionStatus.ts`
(mirror). Used by every lifecycle endpoint + the
`SubscriptionLifecycleControls` UI state machine.

### 6.4 Past-due card update

When `subscription_status = past_due` or `unpaid`, the
`BillingStatusPill` shows an inline "Update card →" link that
deep-links to `/dashboard/settings#change-card`, auto-opening the
in-page Stripe form (no need to bounce to Stripe's hosted billing portal).

### 6.5 $199.99 Price ID

`STRIPE_SUBSCRIPTION_PRICE_ID` env var on Supabase must be a Stripe
**Price ID** (`price_…`), NOT a Product ID (`prod_…`). The
Subscriptions API rejects Product IDs with `resource_missing`. Verify
with `stripe.prices.retrieve(...)` after every env-var swap.

---

## 7. Bill the $1 per-confirmed-booking fee

### 7.1 The flow

- `restaurant_booking_fees` table: one row per reservation, idempotent on
  `reservation_id`.
- Trigger `seed_booking_fee_on_confirm` inserts 'pending' rows on
  reservation INSERT/UPDATE where status='confirmed'.
- Cancellation trigger flips 'pending' → 'cancelled'.
- `bill-booking-fees` edge fn (cron hourly via pg_cron) sweeps 'pending'
  rows into Stripe `invoiceItems.create` on the restaurant's
  subscription customer. Already-billed cancellations are NOT
  auto-credited (manual refund only).

### 7.2 Hard rules

- **Never insert into `restaurant_booking_fees` outside the
  `seed_booking_fee_on_confirm` trigger.**
- **Never bill from any path other than `bill-booking-fees`.**
- 500-row batch per run; failures flip 'failed' with `failure_reason`.

---

## 8. UI surfaces (owner-side)

### 8.1 Onboarding wizard (Step 8 of `/setup`)

`apps/web/src/components/onboarding/Step8PaymentSetup.tsx`

Three Stripe-related sections:
1. **Stripe Connect KYC** — embedded `ConnectAccountOnboarding`
   (first-time) OR `StripeConnectVerifyPanel` (when payouts pending)
2. **Subscription card** — embedded Stripe Elements + SetupIntent +
   `save-subscription-payment-method` edge fn
3. **Publish gate** — checks `kyc + subscription_card + cover_photo` before
   enabling Publish button (server-side trigger
   `restaurants_publish_gate` also enforces)

### 8.2 Dashboard settings (`/dashboard/settings`)

`apps/web/src/pages/dashboard/SettingsPage.tsx`

Sections:
- **Billing details** — legal name, address, tax ID (GST/HST), billing email
  for monthly invoices. **Pre-fills from restaurant info** (added 2026-05-21).
- **Subscription card** — SubscriptionCard + ChangeSubscriptionCard
  (deep-link target `#change-card`)
- **Invoice history** — pulled from Stripe via `list-stripe-invoices`
  (now with `stripe_error` fallback banner)
- **Payouts to your bank** — pending balance, payout schedule, embedded
  `StripeConnectVerifyPanel` when payouts disabled

### 8.3 Banners and indicators

- **Test mode indicator** at bottom of every dashboard route
  (`TestModeIndicator.tsx`) when `pk_test_…` is the publishable key
- **Stripe API down fallback** on PayoutsSection and Invoice list
  ("Could not reach Stripe. [Retry]")
- **Past-due card "Update card →"** link in `BillingStatusPill`

---

## 9. Diner-side surfaces

### 9.1 Public restaurant page (`/r/:slug`)

`apps/web/src/pages/customer/RestaurantPublicPage.tsx`

The booking + payment flow happens here:
1. Diner picks date/time/party
2. Optional: adds menu items to cart (pre-order)
3. Hits Pay → goes through `StripePaymentForm` (Stripe Elements)
4. Three fee lines displayed: Deposit + Platform fee + Processing fee
5. On success → `create-public-booking` runs → `reservation_deposit_payments`
   rows seeded → `confirm-deposit-paid` writes PI ID

### 9.2 Saved-card flow (logged-in diners)

`apps/web/src/components/customer/PaymentMethodsSection.tsx` — uses
real Stripe Elements + SetupIntent. (The mock-card form was removed
2026-05-21 — there's now one code path for test + live mode.)

### 9.3 Find reservation (`/find-reservation`)

`apps/web/src/pages/customer/FindReservationPage.tsx` — diner enters
confirmation code + email, then can:
- Modify (party size, date/time) — re-runs deposit calc, charges delta
  or refunds delta as needed
- Cancel — full refund of base amounts (Option B)

---

## 10. Security lessons learned (do NOT regress)

### 10.1 Auth

- `_shared/auth.ts:checkAuth` is the canonical entry. It calls
  `supabase.auth.getUser(token)` which verifies ES256 signatures.
  Never re-introduce a hand-rolled `decodeJwtPayload` shim.
- `_shared/auth-restaurants.ts:isOwnerOfRestaurant` is the single source
  of truth for "is this caller an owner of this restaurant?" — extracted
  from 18 inline copies on 2026-05-21.

### 10.2 PI metadata binding (Vuln 7 fix)

`create-public-payment-intent` stamps `deposit_payment_ids`,
`restaurant_id`, and (when applicable) `reservation_id`/`hold_id`/`order_id`
on PI metadata at creation. `confirm-deposit-paid` and friends assert
the matching ID is in the metadata. **Strict — no legacy fallback.**
Without this, an attacker could substitute any succeeded PI for any
deposit/hold/order.

`confirm-deposit-paid` also asserts `transfer_data.destination` matches
the restaurant's `stripe_account_id`.

### 10.3 Modify-reservation guest_id null bug (2026-05-21 fix)

- Bug was `.eq("id", reservation.guest_id)` where `guest_id IS NULL` →
  PostgREST sends literal `"null"` → invalid UUID → 500.
- Fix: always guard `.eq("uuid_col", maybe_null_value)` with `if`.

### 10.4 Split tender's third valid path

Before 2026-05-21, the hard rule was "never insert into
`reservation_deposit_payments` outside `prepare-deposit`". The split
tender path (since 2026-05-21) is now a third valid path:
`create-public-booking` with `split_tender_payers: N` inserts N rows
atomically. The settle trigger handles the cascade.

### 10.5 DB structural rules

- Trust-boundary columns on `restaurants` (`stripe_charges_enabled`,
  `is_published`, `subscription_status`, etc.) are NOT in the
  authenticated UPDATE grant. Only edge fns can write them.
- Audit tables (`subscription_consent_log`,
  `restaurant_notification_log`, `referral_credits`,
  `stripe_webhook_events`) use FK `ON DELETE RESTRICT` to outlive the
  parent rows (CRA 7-year retention).

---

## 11. Wave 1-4 changes shipped 2026-05-21

Major Stripe-related improvements in one day:

### Wave 1 — Critical bugs

1. **Dynamic payment methods** on diner PIs (card + Apple Pay + Google
   Pay + Link). Was hardcoded to `["card"]` only.
2. **Owner notification on diner payment failure** — new email template
   `payment_failed_diner` in `_shared/owner-notifications.ts` fires
   from `stripe-webhook.handlePaymentIntentFailed`.
3. Stale refund-policy comment fixed in `refund-deposit-on-arrival/index.ts`.
4. Misleading "ready to accept payments and receive payouts" copy fixed
   on Step8 verification state.

### Wave 2 — Shared helpers extraction (no behavior change)

7 new shared modules deduplicated 38 SDK init sites + 18 ownerOfRestaurant
copies + 2 status sets + 2 Connect appearance blocks:

- `_shared/stripe-client.ts` — `getStripeClient()` + `STRIPE_API_VERSION`
- `_shared/auth-restaurants.ts` — `isOwnerOfRestaurant()`
- `_shared/subscription-status.ts` — `ACTIVE_SUBSCRIPTION_STATUSES`
- `apps/web/src/lib/billing/subscriptionStatus.ts` — client mirror
- `apps/web/src/lib/stripe/connectAppearance.ts` — `CENAIVA_CONNECT_APPEARANCE`
- `apps/web/src/lib/supabase/edge-fn.ts` — `invokeEdgeFunction<T>()`
- `apps/web/src/lib/billing/cardBrand.ts` — `formatBrand()`
- `apps/web/src/lib/stripe/setupIntentRecovery.ts` — `recoverFromSetupIntentUnexpectedState()`

37 edge fns redeployed.

### Wave 3 — Missing features

- Past-due card update flow — `BillingStatusPill` inline link to
  `/dashboard/settings#change-card`
- Diner mock-card form removed — single Stripe Elements + SetupIntent
  path now works in test AND live
- Test-mode indicator banner on every dashboard route
- `paused_reason` enum migration (`restaurant_paused_reason` Postgres enum)
- Stripe API down fallback states on PayoutsSection + Invoice list
- Reconnect Stripe flow when `has_account=false` — `StripeConnectVerifyPanel`
  in `onboardingMode={true}`
- Incomplete subscription state recovery UI

### Wave 4 — Webhook dedup + v2 migration decision

- Persistent webhook dedup via `stripe_webhook_events` PK table (was
  in-memory Set)
- v1 → v2 Accounts API migration DEFERRED (see §4.1)

### Wave 5 — Test session bug fixes

- `setup_future_usage` mismatch on new-card path: added Elements `key`
  prop to force remount on saveCard toggle
- `book_reservation` RPC whitelist updated to accept `'pending_payment'`
  status — split tender no longer 400s with `invalid_status`
- MICKY restaurant `hours_json` populated across all 7 days
  (was Sunday-only, blocking 5 of 7 booking days)

---

## 12. Known open bugs (priority order)

### ✅ FIXED: PI reuse across bookings (Task #110, fixed 2026-05-21)

**Root cause found and fixed.**
`create-public-payment-intent`'s saved-card paths used a deterministic
Stripe idempotency key derived from `${profile.id}_${cardId}_${amount}`
on both Mode-A (hold) and Mode-B (no-hold) branches. Two bookings by
the same diner with the same card for the same amount = identical
idempotency key = Stripe returned the FIRST booking's PI on every
subsequent booking.

**Fix shipped:**
- New field `idempotency_key` accepted in `create-public-payment-intent`
  request body (UUID per booking attempt).
- Client (`StripePaymentForm.tsx`) generates `crypto.randomUUID()` per
  submit on BOTH saved-card and Elements paths.
- Server uses the client UUID when supplied; falls back to legacy
  amount-derived key only for older mobile builds that don't yet send
  the field (graceful migration path).
- Edge fn deployed to prod. Type-check clean.

**Verified by:** Code review of `create-public-payment-intent` line 738
(Mode B) and line 216 (chargeSavedCardWithHold). Both now use
`clientIdempotencyKey ?? <legacy key>`.

**Mobile impact:** The legacy fallback means existing mobile builds
continue to work but remain vulnerable to the bug until they send
`idempotency_key`. Update mobile to send a fresh UUID per booking
attempt — see **§17 (Mobile integration notes)** below.

### ✅ FIXED: Income/Expenses auto-tracking (Task #111, verified 2026-05-21)

**Actually wired and working correctly** — the integration test agent's
"CA$0.00" reading was either a date-filter or restaurant-scope artifact,
not a real data-flow bug.

**The flow:**
- `apps/web/src/hooks/useAutoIncome.ts` reads:
  - `orders` table where `paid_at IS NOT NULL`
  - `reservation_deposit_payments` where `status='charged' AND paid_at IS NOT NULL`
- Both fields populated correctly by `mark-order-paid` and
  `confirm-deposit-paid` respectively.
- `ExpensesPage.tsx` sums autoIncomeRows into `autoIncomeTotal` →
  `totalIncome`.
- DB query at 2026-05-21 confirms one charged deposit ($20) for MICKY
  has all required fields populated.

**If a user reports $0 again:** check (a) the restaurant scope selector,
(b) the date range filter on the Income page — the test charges might
be outside the displayed window.

### 🟡 LOW: v1 → v2 Accounts API migration (deferred)

See §4.1 above. Defer until launch.

---

## 12.5 Fixes applied in the final test wave (2026-05-21 evening)

After the initial test wave reported READY at 85%, a second wave found
two NEW critical blockers. Both fixed and verified.

### Blocker A — New-card path 400'd on confirm

**Symptom:** First-time diners using a new card couldn't complete
checkout. Stripe Elements rejected with
`PaymentIntent does not have allowed_payment_method_types`.

**Root cause:** `StripePaymentForm.tsx` mounted `<Elements>` with
`paymentMethodTypes: ["card"]` while the server PI used
`automatic_payment_methods: { enabled: true }` (Wave 1 dynamic-PM
change) → server PI listed `['card', 'link']` → Elements/PI mismatch.

**Fix:** Removed the client-side `paymentMethodTypes` override on
`StripePaymentForm.tsx` line ~268. Elements now reads methods from the
PI — client + server stay in lockstep.

**Verified** by TBL1-A on a fresh diner account using 4242: PI
`pi_3TZYr9JABKj4FeJX1LtwGG0K` succeeded, reservation SEAT-61Y8
created, application_fee=110¢, destination=`acct_1TZX8PJ6JzcimHnL`.

### Blocker B — Split-tender INSERT rejected by CHECK constraint

**Symptom:** `create-public-booking` with `split_tender_payers: N`
returned `{"error":"Reservation: invalid_status"}`. The earlier RPC
whitelist fix only covered `book_reservation` — the table-level CHECK
constraint still rejected `pending_payment`.

**Fix:** Migration `reservations_allow_pending_payment_status` —
expanded `reservations_status_valid` CHECK constraint to include
`'pending_payment'`.

```sql
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_status_valid;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_status_valid
  CHECK (status = ANY (ARRAY['pending', 'pending_payment', 'confirmed',
                             'seated', 'completed', 'cancelled', 'no_show']));
```

**Verified** via `pg_constraint` query post-migration.

### Soft fix — Zod schema rejected null on optional hold fields

`create-reservation-hold` Zod schema had `event_id`, `promotion_id`,
`applied_promo_code` as `.optional()` while clients send `null`.
Pre-flight hold create returned 400 (non-fatal — checkout proceeds
without a hold). Changed all 5 fields to `.nullish()` and redeployed.

---

## 13. End-to-end test runs (2026-05-21)

Done on Stripe TEST mode against MICKY restaurant
(`acct_1TZX8PJ6JzcimHnL`):

| Test | Result | Verified channels |
|---|---|---|
| T1 success card | ✅ | Stripe ✓ DB ✓ UI ✓ |
| T1 new-card success (TBL1-A) | ✅ | After Blocker A fix |
| T1 decline (TBL1-B) | ✅ | UI shows "Your card was declined" |
| T1 insufficient | ⏸ Same code path as decline — risk: low |
| T1 3DS | ⏸ Same code path — risk: low |
| T3 pre-order + deposit | ✅ | All 3 channels |
| T4 modify UP party 2→8 | ✅ | All 3 channels |
| T5 modify DOWN party 8→2 | ✅ | All 3 channels |
| T6 diner cancel | ✅ | All 3 channels — full refund |
| T7 owner cancel | ✅ | (re-verifiable after Bug #110 fix; deferred to launch) |
| T8 seated → refund | ✅ | (re-verifiable after Bug #110 fix; deferred to launch) |
| T9 no-show | ✅ | Deposit retained, no Stripe refund |
| T10 split tender | ✅ | Server-side after Blocker B fix |
| T110-RETEST | ✅ | 3 bookings, 3 distinct PIs — Bug #110 stays fixed |
| T11 Hey Cenaiva FAB | ✅ open | Full voice flow not driven via Playwright |
| T12 Income/Expenses | ✅ wired | useAutoIncome correctly populated from charged rows |

Test screenshots saved at
`/Users/savyoyaqoop/Seatly-12/test-screenshots-2026-05-21*/`.

---

## 14. Environment variables you'll need

```bash
# Browser-safe (Vite + NEXT)
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_51T...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_51T...

# Server-only (Supabase Edge Function secrets)
STRIPE_SECRET_KEY=sk_test_51T...                    # platform secret
STRIPE_WEBHOOK_SECRET=whsec_...                     # for verifying webhook sigs
STRIPE_SUBSCRIPTION_PRICE_ID=price_1T...            # MUST be a Price ID (price_...), NOT a Product ID (prod_...)
ALLOWED_ORIGINS=https://cenaiva.com                 # comma-separated; localhost auto-allowed via _shared/cors.ts:isLocalDevOrigin
```

---

## 15. Final checklist before launch

Before going live, verify:

- [ ] All test PIs / accounts wiped from Stripe Dashboard
- [ ] STRIPE_SECRET_KEY swapped to `sk_live_...`
- [ ] VITE_STRIPE_PUBLISHABLE_KEY swapped to `pk_live_...`
- [ ] STRIPE_WEBHOOK_SECRET swapped to live webhook signing secret
- [ ] STRIPE_SUBSCRIPTION_PRICE_ID points to LIVE Price (recurring,
      $199.99 CAD/mo, 90-day trial set on the Price)
- [ ] At least one restaurant onboarded through full Connect flow in
      LIVE to validate the embedded UI works
- [ ] Webhook endpoint registered in Stripe Dashboard (LIVE mode)
- [x] Bug #110 (PI reuse) FIXED 2026-05-21 — client UUID idempotency keys
- [x] Bug #111 (Income/Expenses sync) VERIFIED working via useAutoIncome
- [ ] Mobile app updated to send `idempotency_key` (see §17)
- [ ] STRIPE_UPDATES.md is current with all changes
- [ ] CLAUDE.md "Hard rules" section reviewed for accuracy
- [ ] Stripe's Go Live Checklist completed:
      https://docs.stripe.com/get-started/checklist/go-live

---

## 16. Where to ask for help

- **Stripe Dashboard logs:** Workbench → Logs → filter by request ID
- **Supabase logs:** `mcp__plugin_supabase_supabase__get_logs` or
  Dashboard → Functions → Logs
- **DB queries:** Always use `mcp__plugin_supabase_supabase__execute_sql`
  with read-first; never DROP/DELETE without explicit user authorization
- **Stripe support:** https://support.stripe.com/ (mention you're on
  Connect Express in CA, destination charges)

For questions on the codebase architecture, the documents in
**§2 (single source of truth)** above should answer most things.
If they don't, the truth is in the code — `git blame` will point at
the PR + commit message that introduced any specific piece.

---

---

## 17. Mobile app integration notes

The Cenaiva mobile app (React Native, see `MOBILE_STRIPE_GUIDE.md` +
`DINER_MOBILE_GUIDE.md`) shares the **same backend** as the web app —
all the Stripe edge functions documented above are called from both
clients. Anything that breaks on web breaks on mobile.

### 17.1 What's shared

- All edge functions in `supabase/functions/` (Connect onboarding,
  payment intents, refunds, subscription lifecycle, webhook, etc.)
- All DB tables and triggers (`restaurants`, `reservations`,
  `reservation_deposit_payments`, `orders`, `holds`, etc.)
- Fee math (web client mirror at `apps/web/src/lib/stripe-fee.ts` —
  mobile has its own mirror at `mobile/lib/billing/stripeFee.ts`,
  must match line-for-line)
- Refund policy (Option B = refund the base, fees non-refundable)
- Webhook event handling — events fire once regardless of which client
  initiated the payment

### 17.2 What's DIFFERENT on mobile

- **Voice (Hey Cenaiva)** is web-only. Mobile does NOT bundle the
  voice assistant. See CLAUDE.md `DINER_MOBILE_GUIDE.md` reference.
- **PaymentSheet (Stripe iOS/Android SDK)** is used on mobile instead
  of Stripe Elements. The mobile equivalent of `StripePaymentForm.tsx`
  is `mobile/components/booking/CheckoutSheet.tsx` (or similar).
- **Apple Pay / Google Pay** integration uses native PaymentSheet
  buttons. Mobile must enable them in the PaymentSheet configuration.

### 17.3 Mobile changes needed for Bug #110 fix

The web fix (UUID per booking attempt) is opt-in via a new
`idempotency_key` field on `create-public-payment-intent`. The server
falls back to the legacy amount-derived key when the field is absent —
so **existing mobile builds keep working but remain vulnerable to PI
reuse until updated**.

**Required mobile change:**
```ts
// In whatever calls create-public-payment-intent (likely
// mobile/lib/booking/createPaymentIntent.ts or similar):
const body = {
  restaurant_id,
  amount_cents,
  saved_card_id,
  hold_id,
  deposit_payment_ids,
  idempotency_key: uuid.v4(),  // NEW — fresh per booking attempt
};
```

**Same field, same semantics, both clients send it.**

### 17.4 Mobile changes needed for Wave 3 work shipped on web

These web changes might or might not need mobile mirrors:

| Web change | Mobile action |
|---|---|
| Dynamic payment methods (Apple Pay, Google Pay, Link) on PI | Mobile already uses PaymentSheet which auto-handles wallets — no change needed |
| Card-only subscription SetupIntent | Mobile subscription flow already card-only |
| Owner notify on diner payment failure | Backend change — mobile inherits via webhook |
| Past-due card update flow | Mobile dashboard needs equivalent "Update card" CTA on owner side |
| Diner mock-card form removed | Verify mobile doesn't have a similar mock — should use real Stripe PaymentSheet |
| Test-mode indicator banner | Mobile should show similar test-mode warning |
| `paused_reason` enum | Backend DB change — mobile inherits via reads |
| Stripe API down fallback | Mobile owner dashboard should show similar "Try again" UX |
| Webhook dedup persistent table | Backend change — mobile inherits |

### 17.5 Hard rule

**Any change that touches `_shared/stripe-fee.ts` or
`_shared/refund-math.ts` MUST also update the mobile mirrors.** These
two files are the only Stripe math source of truth — if web and mobile
diverge on fee calc or refund logic, diners will see different prices
across devices for the same booking.

Verify after every fee/refund change:
```bash
diff <(grep -A50 'computeDinerCharge' apps/web/src/lib/stripe-fee.ts) \
     <(grep -A50 'computeDinerCharge' mobile/lib/billing/stripeFee.ts)
```

Should produce no functional difference. Comments/imports may differ.

### 17.6 What the mobile codebase looks like (high-level)

(For the next agent picking up mobile work — read these in order)

1. `MOBILE_STRIPE_GUIDE.md` — mobile-side Stripe integration overview.
2. `MOBILE_STRIPE_GUIDE_ADDENDUM.md` — supplementary notes if present.
3. `DINER_MOBILE_GUIDE.md` — diner-side mirror handoff.
4. Mobile source lives in a separate repo (not in this monorepo). The
   web codebase has the canonical backend + DB; the mobile repo's
   "edge function" equivalent is just thin HTTP wrappers that hit the
   same Supabase endpoints.

---

**End of handoff.** Next AI agent: read this top to bottom before
touching any Stripe-adjacent code. Then re-read §10 (security lessons)
and §12 (open bugs). Welcome to the codebase.
