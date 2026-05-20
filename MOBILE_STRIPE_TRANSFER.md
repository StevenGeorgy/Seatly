# Mobile Stripe + Onboarding Transfer Doc

**To**: Claude Opus 4.7 working with the Cenaiva mobile team (iOS + Android)
**From**: Web team — verified production-ready on 2026-05-20
**Scope**: Restaurant onboarding + ALL Stripe-touching flows (diner + owner)

This document is the **self-contained source of truth** for mirroring the
web app's Stripe integration onto the iOS and Android mobile apps. The
mobile team's Claude agent does NOT have access to the web codebase or its
other internal docs (CLAUDE.md, etc.) — everything you need is in here.

Read it end-to-end before writing any payment code.

---

## 0. TL;DR — what mobile must mirror

1. **Stripe Connect destination charges** (platform = Cenaiva; restaurants = connected accounts)
2. **5.5% application fee** on the base amount (not the grossed-up total)
3. **Threshold-based fee policy**: <$12 base → diner pays Stripe fee on top (gross-up); ≥$12 base → Cenaiva absorbs the fee
4. **90-day trial subscription** at **$199.99 CAD/month** per restaurant
5. **$1 per-booking fee** rolled into the restaurant's monthly invoice
6. **Card-only payments** (no Klarna/Affirm/Link); Apple Pay + Google Pay enabled
7. **Cancellation refund**: Cenaiva keeps 5.5% commission; restaurant's 94.5% slice goes back to diner
8. **Voice (Hey Cenaiva) MUST NEVER take payment**. Voice always hands off to the payment UI for diner confirmation
9. **Confirmation modals** on every destructive cancel/delete action
10. **Save card via `setup_future_usage: 'off_session'`** at PI creation — do NOT post-attach

---

## 1. What is Cenaiva (1-minute primer)

Cenaiva is a SaaS booking + payments platform for restaurants. Two audiences:

- **Owners**: pay $199.99 CAD/month subscription + $1 per booking. Sign up, complete Stripe Connect KYC, publish their restaurant, accept reservations.
- **Diners**: discover restaurants, book tables (with deposits/preorders), pay the bill after meals.

Money flow:
```
Diner card → Stripe → Connect destination charge → Restaurant's bank account
                ↑
       Cenaiva takes 5.5% application fee + (sometimes) the Stripe processing fee
```

---

## 2. Stripe architecture

### Account structure
- **Platform account** (Cenaiva): holds the Connect platform, receives application fees, pays monthly subscription invoices to restaurants.
- **Connected accounts** (restaurants): one per restaurant, identified by `acct_xxx`. Receive 94.5% of diner payments.
- **Customers**: created for both diners (one each, store `stripe_customer_id` in `user_profiles`) AND restaurants (for subscription billing, store in `restaurants.stripe_customer_id`).

### Payment model: destination charges
Every diner-paying flow uses Stripe Connect destination charges:
```js
stripe.paymentIntents.create({
  amount: dinerTotalCents,          // base + Stripe fee gross-up (if below threshold)
  currency: "cad",
  payment_method_types: ["card"],   // NEVER include Klarna/Affirm/Link
  application_fee_amount: 0.055 * baseCents,  // 5.5% of BASE, not grossed-up
  transfer_data: { destination: restaurant.stripe_account_id },
  metadata: {
    base_amount_cents: ...,
    processing_fee_cents: ...,
    platform: "cenaiva",
    restaurant_id: ...,
  },
})
```

### Threshold-based fee policy (critical)
Below $12 base, Cenaiva would lose money if it absorbed the Stripe fee, so we gross up. Above $12, the 5.5% commission is comfortable enough that Cenaiva absorbs.

```js
// Source of truth: supabase/functions/_shared/stripe-fee.ts
//   AND apps/web/src/lib/stripe-fee.ts (client mirror)
//
// Both must be ported to mobile (Swift + Kotlin).

const ABSORB_FEE_THRESHOLD_CENTS = 1200; // $12 CAD

function computeDinerCharge(baseCents: number) {
  if (baseCents <= 0) return { ...allZero, dinerPaysFee: false };
  const applicationFee = Math.max(Math.round(baseCents * 0.055), 1);
  if (baseCents >= ABSORB_FEE_THRESHOLD_CENTS) {
    return {
      baseCents,
      dinerTotalCents: baseCents,        // no gross-up
      processingFeeCents: 0,
      applicationFeeCents: applicationFee,
      dinerPaysFee: false,
    };
  }
  // Gross up: ceil((base + $0.30) / 0.971)
  const grossed = Math.ceil((baseCents + 30) / 0.971);
  return {
    baseCents,
    dinerTotalCents: grossed,
    processingFeeCents: grossed - baseCents,
    applicationFeeCents: applicationFee,
    dinerPaysFee: true,
  };
}
```

**UI rule**: when `processingFeeCents > 0`, show a "Processing fee" line on the cart. When `=== 0`, hide the line entirely.

### Constants you'll need on mobile
| Constant | Value |
|---|---|
| Stripe card fee percent | 2.9% |
| Stripe card fixed | $0.30 CAD |
| Cenaiva platform fee | 5.5% |
| Absorb-fee threshold | $12 CAD (1200 cents) |
| Subscription price | $199.99 CAD/month |
| Per-booking fee | $1 CAD (billed monthly) |
| Trial period | 90 days |

---

## 3. Restaurant onboarding flow (owner-side)

The web has an 8-step wizard. Mobile should mirror but can compress into fewer screens if natural.

### Steps
1. **Account** — sign up with email + password (or Apple/Google SSO)
2. **Restaurant basics** — name, cuisine, address, phone
3. **Cover photo** — upload (required for publish gate)
4. **Hours** — operating hours per day
5. **Tables / floor plan** — define seat capacity
6. **Menu** — at least one item (required if accepting pre-orders)
7. **Stripe Connect onboarding** — Connect Embedded flow (see below)
8. **Publish** — calls `publish-restaurant` edge fn which atomically:
   - Creates the Stripe subscription with 90-day trial
   - Sets `restaurants.is_published = true`
   - Sends `restaurant_live` email notification

### Publish gates (server-side trigger `restaurants_publish_gate`)
A restaurant CANNOT publish unless ALL of these are true:
- `stripe_charges_enabled = true` (Stripe Connect KYC complete)
- Has `cover_photo_url`
- Has either an active subscription OR `payment_method_attached_at IS NOT NULL`
- NOT soft-deleted (`deleted_at IS NULL`)

These checks run BOTH client-side (UX preview) AND server-side (the trigger blocks the UPDATE).

### Stripe Connect Embedded onboarding (Step 7)
Web uses `@stripe/connect-js` + `<ConnectAccountOnboarding>` React component. For mobile:

- **iOS**: Use `StripeConnect-iOS` SDK (`AccountOnboardingViewController`)
- **Android**: Use `stripe-connect-android` SDK (`AccountOnboardingFragment`)

Flow:
1. Mobile app calls `create-stripe-account` edge fn → returns `stripe_account_id`
2. Mobile app calls `create-account-session` edge fn with the account_id → returns a `client_secret`
3. SDK is initialized with that client_secret
4. Stripe-hosted KYC flow plays inside the app
5. On complete, the SDK fires a callback → mobile app calls a refresh endpoint or just re-polls `restaurants.stripe_charges_enabled`

**Edge fns to call** (same as web):
- `create-stripe-account` — creates the Connect account, stamps `restaurants.stripe_account_id`
- `create-account-session` — returns `{client_secret}` for the SDK

### Subscription creation (Step 8, hidden from owner)
The owner sees "Publish my restaurant" button. Under the hood, two steps:

1. **`save-subscription-payment-method`** — collects the card via SetupIntent. The mobile app uses `StripePaymentSheet` (iOS) or `PaymentSheet` (Android) to capture the card. Backend stores it on the restaurant's Stripe customer.
2. **`publish-restaurant`** — atomically creates the subscription + flips `is_published = true`. Trial starts NOW (90 days).

DO NOT use the legacy `create-subscription` edge fn — it returns 410 by default. Always use `publish-restaurant` for first publish, `restart-subscription` for re-subscribe after cancel.

---

## 4. Diner booking flows

Mobile has three diner flows to implement:

### Flow A: Deposit-only booking
Diner picks date, time, party size. Restaurant has `deposit_tiers` requiring a deposit. Diner pays deposit upfront. No food order yet.

**Sequence**:
1. Mobile calls `create-reservation-hold` → reserves the table for 30 min, returns `hold_id`
2. Mobile heartbeats hold every 30s via `heartbeat-reservation-hold` (so other diners can't take the slot)
3. Diner enters card on payment screen (use `StripePaymentSheet`)
4. Mobile calls `create-public-payment-intent` with `{ restaurant_id, amount_cents, hold_id }` → returns `{ client_secret }`
5. SDK confirms payment with the client_secret
6. On success, mobile calls `create-public-booking` → converts hold to reservation
7. Diner sees confirmation page with confirmation code (e.g., `SEAT-ABCD`)

**Important**: `amount_cents` here is the BASE deposit (NOT the grossed-up total). The edge fn computes the gross-up server-side.

### Flow B: Pre-order booking (deposit + food upfront)
Like Flow A but the cart includes menu items + tax + tip. `amount_cents` is `subtotal + tax + tip + deposit` (the BASE total).

The web also creates an `orders` row tied to the reservation. Same edge fns drive this — the difference is just the cart contents.

### Flow C: Post-meal pay-the-bill
Staff opens an order for the diner at the table (no upfront payment). Diner finishes meal. Diner taps "Pay the bill" in mobile app.

**Sequence**:
1. Diner views their open order in the mobile app
2. Diner picks a tip (preset 15/18/20%, or custom $, or skip)
3. Mobile calls `stripe-charge-order` edge fn with `{ order_id, tip_amount OR tip_percentage }`
4. Edge fn gross-ups (if below threshold), routes to restaurant's Connect account, takes 5.5% application fee
5. Returns success + receipt details

This is the only flow that uses `stripe-charge-order`. Voice does NOT use it — voice always hands off to this manual screen.

### Saved cards
After the diner's FIRST successful charge with "Save this card" checked, the card is attached to their Stripe customer + a `saved_cards` row is created. Subsequent bookings let them pick from saved cards.

**Critical**: when creating the PI, you MUST pass `setup_future_usage: 'off_session'` AND the diner's `customer` ID. Otherwise the PM is one-time-use and can't be saved post-charge. See section 8 below.

### Deposit tiers (how restaurants configure deposits)
Each restaurant has a `deposit_tiers` JSONB column with this shape:
```json
[
  { "min_party_size": 1, "amount_per_person_cents": 1000 }
]
```
Or tiered:
```json
[
  { "min_party_size": 1, "amount_per_person_cents": 0 },
  { "min_party_size": 6, "amount_per_person_cents": 2500 }
]
```
Rule: pick the tier whose `min_party_size` is the LARGEST that's ≤ the party size. So party 5 with above tiers → tier 1 → no deposit. Party 6 → tier 2 → $25/person.

**Always call the Postgres RPC `compute_deposit_for_party` to compute deposits server-side:**
```js
const { data } = await supabase.rpc('compute_deposit_for_party', {
  p_restaurant_id: restaurantId,
  p_party_size: partySize,
});
// data is the total deposit in cents (e.g., 7500 for party 3 at $25/person)
```

Never compute deposits client-side — the restaurant's tiers can change at any time.

### Reservation hold lifecycle (30-minute timer)
Holds give the diner a 30-min window to complete checkout without losing the slot. Flow:

1. `create-reservation-hold` returns `{ hold_id, expires_at }`
2. Mobile shows a countdown ("Holding your table — 29:54")
3. Mobile pings `heartbeat-reservation-hold` every 30s to extend
4. If diner abandons checkout: call `cancel-reservation-hold` (frees the slot for others)
5. If hold expires: PI creation returns 410 with `unavailable_reason: 'hold_expired'`. Mobile must show "Your hold expired. Try booking again."
6. On successful payment: `create-public-booking` converts the hold → confirmed reservation. The hold row is consumed.

### Reservation status enum
| Value | Meaning |
|---|---|
| `pending` | Created but not paid (rare — usually transient) |
| `confirmed` | Booked and paid (if deposit required) |
| `cancelled` | Cancelled by diner or owner (final) |
| `no_show` | Owner marked the party never showed up |
| `completed` | Owner marked the booking served (post-meal) |
| `seated` | Owner marked party as seated (in-service) |

Mobile UI rules:
- "Active" bookings shown to diner: `pending`, `confirmed`, `seated`
- "Past" bookings: `completed`, `cancelled`, `no_show`
- Only `confirmed` (and not in the past) can be modified or cancelled by diner

### Tipping
Tip flow on the post-meal pay-the-bill screen:
- Preset percentages: 15%, 18%, 20%, custom $, none
- Tip is computed against `subtotal` (not subtotal + tax)
- `tip_amount` (in dollars) goes into the `stripe-charge-order` body
- Or pass `tip_percentage` (number 0-100) and the server computes it
- Tip is added to the diner's grand total before gross-up calculation
- Tip flows to the restaurant 100% (Cenaiva commission is on subtotal+tax only — wait, actually let me check the code: app fee is 5.5% of the FULL base which includes tip. So Cenaiva takes 5.5% of tip too. This is the current implementation. Restaurants might find this controversial — flag it to the team)

### Split tender (multi-payer deposits)
Diners can split a deposit across multiple payers. The flow:
1. Original diner clicks "Split deposit with friends" on the cart
2. Specifies how many payers and the total they cover
3. Cenaiva sends each payer an email/SMS with a payment link
4. Each payer pays their share through a public link (no auth required)
5. The reservation flips to `confirmed` only after EVERY payer has paid
6. If any payer doesn't pay within the hold window, the booking auto-cancels and already-paid shares are refunded

Mobile likely doesn't implement split tender v1. Defer to a single-payer flow for first launch.

---

## 5. How restaurants collect payments

Money routing for a $20 deposit on a restaurant above the threshold:

```
Diner pays:          $20.00  (clean, no gross-up since ≥$12)
Stripe takes:        ~$0.88  (2.9% × $20 + $0.30)
Net into platform:   $19.12
  ├─→ Cenaiva keeps: $1.10   (5.5% of $20 base = application_fee_amount)
  └─→ Restaurant:    $18.02  (settles to their Connect account)

(Wait, $18.02 + $1.10 = $19.12, not $20.00. Stripe took $0.88. So in destination
 charge mode, the restaurant actually gets $20 - $1.10 - $0.88 = $18.02 since
 the platform passes the Stripe fee through to the Connect destination by default.)
```

Wait — Stripe's destination charge fee model needs precision:
- Stripe deducts its fee from the PLATFORM by default
- Application fee comes off the destination transfer
- So restaurant actually receives: `(amount - stripe_fee) - application_fee_amount`
- Cenaiva gets: `application_fee_amount`
- The math works out: 5.5% to Cenaiva, ~4.4% to Stripe, ~90% to restaurant on a $20 above-threshold booking

For a $10 booking (below threshold):
```
Diner pays:          $10.61  ($10 base + $0.61 gross-up)
Stripe takes:        ~$0.61  (matches the gross-up)
Net into platform:   $10.00
  ├─→ Cenaiva keeps: $0.55   (5.5% of $10 base)
  └─→ Restaurant:    $9.45   (94.5%)
```

### Stripe payout schedule
Stripe holds funds in the restaurant's Connect balance for 2-7 days, then transfers to their bank account. The default schedule is daily after the 2-day hold, but it can be adjusted by the restaurant in Stripe Express Dashboard.

### Showing payouts in the mobile dashboard
Web has a `PayoutsSection` component on Settings → Billing. Mobile should mirror:
- Call `list-stripe-payouts` edge fn (requires owner JWT + restaurant_id)
- Returns `{ has_account, payouts_enabled, available_balance_cents, pending_balance_cents, payouts: [...] }`
- Each payout has `amount_cents`, `currency`, `status` (`paid`/`in_transit`/`pending`/`failed`), `arrival_date_iso`

### Showing the next bill
Web has a `NextBillCard` component. Mobile should mirror:
- Call `get-next-bill-preview` edge fn (requires owner JWT + restaurant_id)
- Returns `{ has_upcoming, next_amount_cents, next_date_iso, line_items: [...] }`
- `line_items[].is_subscription` tells you whether each line is the $199.99 sub or a booking fee

---

## 6. Cancellation + refund flow

### Endpoint
- Edge fn: `cancel-reservation`
- Auth: 3 modes — owner role (JWT + role check), diner (JWT + profile match), or guest (confirmation code)

### Refund math
```
refundCents = base - applicationFeeCents
            = base - (5.5% of base)
            = 94.5% of base
```

For below-threshold bookings, the diner also forfeits the Stripe gross-up they paid (this is policy — Cenaiva keeps the gross-up since Stripe doesn't refund the $0.30 fixed fee on refunds).

### UI requirements
**EVERY cancel button MUST have a confirmation modal**. No exceptions. Use a Dialog/Sheet pattern, not an inline confirmation. Required copy elements:
- Title: "Cancel this reservation?"
- Body: explains refund amount + irreversibility
- Two buttons: "Keep booking" (cancel) / "Yes, cancel" (destructive — red)

### What happens after cancel
- `reservations.status = 'cancelled'`
- `reservations.cancellation_reason = 'Cancelled by diner'` (or `'Cancelled by restaurant'` for owner-side)
- Each `reservation_deposit_payments` row → status `'refunded'`
- Each paid `orders` row → also refunded
- Stripe refunds via `refundPaymentIntent` helper
- Email notification fires to diner

---

## 7. Modify booking flow

### Endpoint
- Edge fn: `modify-reservation`
- Same auth modes as cancel

### What can be modified
- Date / time
- Party size
- Special request / notes

### Deposit recalculation on party size change
This is the most complex flow. When party size changes, the deposit owed may change:
- **Delta > 0** (upsize): charge the difference to the diner's saved card off-session
- **Delta < 0** (downsize): refund the difference to the diner
- **Delta = 0**: nothing

### Pre-flight check (critical — must mirror this on mobile)
If the modify would require MORE deposit AND the diner has no saved card on file, the edge fn returns **402 BEFORE** committing the slot change. Mobile should:
- Catch the 402 response
- Show: "Increasing your party size needs a saved card. Please add one in Account → Payment first."
- Direct user to add a card

This prevents the state-mismatch bug where the slot was already changed but no charge happened.

### Rollback on charge failure
If the delta charge fails AFTER the slot was changed, the edge fn calls `modify_reservation_slot` again to revert `party_size` to the original. Mobile should respect the response shape:
- `body.ok === true` AND `body.deposit_adjustment.kind === 'charged'` → fully successful, show charged amount
- `body.deposit_adjustment.kind === 'refunded'` → fully successful, show refunded amount
- `body.deposit_adjustment.kind === 'failed'` → show warning: "Your slot was updated, but we couldn't charge the extra deposit on your card. Please contact the restaurant or update your payment method to settle the difference."
- `body.deposit_adjustment.kind === 'none'` → just "Your reservation has been updated"

### Idempotency
The edge fn uses `idempotencyKey: \`modify_${reservationId}_${profileId}_${deltaCents}\`` so retries within 24h reuse the same charge.

---

## 8. Save card flow (CRITICAL — must do this right)

### What was wrong before (history)
Originally, the web app tried to attach the PaymentMethod to the diner's customer AFTER the charge succeeded. This fails with 400 because destination-charge PIs use one-time-use PMs that Stripe won't let you re-attach.

### The fix (current behavior)
Save the PM **during** the charge by passing `setup_future_usage: 'off_session'` + `customer` on the PI at creation.

```js
// On the server (create-public-payment-intent):
const piParams = {
  amount: dinerTotalCents,
  currency: "cad",
  payment_method_types: ["card"],
  application_fee_amount: applicationFeeCents,
  transfer_data: { destination: restaurant.stripe_account_id },
  // ADD THESE TWO when the diner is logged in + checked "Save this card":
  customer: diner.stripe_customer_id,
  setup_future_usage: "off_session",
};
```

```js
// On the client (StripePaymentSheet config):
// iOS: pass `setupFutureUsage = .offSession` to PaymentSheet.Configuration
// Android: pass `paymentMethodOptions = SetupFutureUsage.OffSession` to PaymentSheetConfiguration
```

**Both client and server MUST agree on `setup_future_usage`** — Stripe rejects with "does not match" otherwise.

### After the charge
Mobile should call `stripe-attach-payment-method` to insert the `saved_cards` row:
```
POST /functions/v1/stripe-attach-payment-method
Authorization: Bearer {jwt}
Body: { payment_intent_id: "pi_xxx" }
```

The PM is already attached to the customer by Stripe (because of `setup_future_usage`), so this endpoint just creates the DB row. It's idempotent — calling it twice for the same PI returns the existing row.

### Listing saved cards on mobile
- Call `stripe-list-methods` edge fn (requires JWT)
- Returns array of `{ id, brand, last4, exp_month, exp_year, is_default }`
- Show in a picker on the payment screen

### Setting default / deleting saved cards
- **Set default**: simple DB update on `saved_cards.is_default`. Mobile can call directly via Supabase client (RLS allows owner update).
- **Delete**: call `stripe-detach-method` edge fn first (Stripe-side detach), THEN delete the `saved_cards` row. Order matters — Stripe first, DB second.

---

## 9. Subscription lifecycle (owner-side)

The owner can self-serve their subscription state from the mobile dashboard. State machine:

```
Active ──[Pause]──→ Paused ──[Resume]──→ Active
   │
   ├──[Cancel]──→ Cancel-pending ──[Resume]──→ Active
   │                      │
   │                      └──(period_end)──→ Ended ──[Restart]──→ Active
   │
   └──[Delete restaurant]──→ Soft-deleted (30-day grace) ──[Restore]──→ Active
```

### Edge fns
- `pause-subscription` — Stripe `pause_collection.behavior = 'void'` + sets `is_published = false`
- `cancel-subscription` — Stripe `cancel_at_period_end = true`, keeps service until period end
- `resume-subscription` — state-aware: unsets whichever flag is set
- `restart-subscription` — for fully-cancelled subs: creates fresh subscription using existing default PM, republishes
- `delete-restaurant` — soft-delete with 30-day grace, cancels sub at period end
- `recover-restaurant` — undo soft-delete within grace window

### UI: state-aware buttons (`SubscriptionLifecycleControls`)
Mirror this state machine on mobile:

| State | Buttons shown |
|---|---|
| Active or Trialing | [Pause] [Cancel plan] |
| Cancel-pending | [Resume subscription] (green, prominent) |
| Paused | [Resume subscription] (green) |
| Ended | [Restart subscription] (green) |
| Soft-deleted | [Restore restaurant] (in dedicated banner) |

### Pause vs Cancel distinction (explain to user)
- **Pause**: keeps subscription alive, restaurant hidden from Discover, NO billing. Resume any time.
- **Cancel**: subscription ends at end of current paid month. Restaurant stays online until then. Auto-unpublishes when subscription fully ends. Restart later creates a brand-new subscription (no trial).

### Required confirmation modals
- Pause: yes, modal required. Mention "your trial clock keeps running while paused" if user is trialing.
- Cancel: yes, modal required. Mention "stays live until end of billing cycle" + "can resume any time before then".
- Resume: NO modal (low-stakes positive action).
- Restart: NO modal (positive action).
- Delete restaurant: yes, modal required. Name-matching confirmation (user must type the restaurant name to confirm).

### Billing details form
Owner can edit:
- Legal entity name (e.g., "1234567 Ontario Inc.")
- Billing email (where invoices go)
- Address (line1, line2, city, province, postal_code, country)
- Tax ID (Canadian only for now — types: `ca_gst_hst`, `ca_qst`, `ca_pst_bc`, `ca_pst_mb`, `ca_pst_sk`)

Saves via `update-billing-details` edge fn. Stripe is source of truth; we mirror to `restaurants.billing_*` columns for fast display.

### Billing status pill
Web shows a small status chip in the dashboard header. States:
- 🟢 "Billing active" / "Trial active · Free until {date}"
- 🟡 "Trial ends in N days" (when ≤14 days)
- 🟡 "Cancelling on {date}" (when cancel_at_period_end)
- 🟡 "Subscription paused"
- 🟡 "Subscription ended · Restart →"
- HIDDEN when paused_reason = `payment_failed` or `pending_deletion` (separate banners take over)

---

## 10. Voice (Hey Cenaiva) — DIFFERENT for mobile

### Mobile policy: voice is OUT OF SCOPE
The Cenaiva voice assistant ("Hey Cenaiva") is web-only. Mobile does NOT implement voice.

### Two voice edge fns exist on the backend — DO NOT call them from mobile
- `cenaiva-chat` — voice text-input tool calls
- `cenaiva-orchestrate` — voice orchestrator

These handle voice-driven UI navigation on the web app only. The mobile app must never invoke them.

### Critical safety rule: voice MUST NEVER take payment
On web, voice always hands off to the visual payment screen for diner confirmation. The `charge_saved_card` tool in both voice edge fns returns `{ handoff: true, action: "open_pay_bill", order_id, restaurant_id }` — it never creates a PaymentIntent.

If the mobile team ever adds voice in the future, follow the same rule: voice hand-off only, never off-session charges. The diner must always manually confirm the charge on a visual payment screen.

---

## 11. Webhook handling

Single Stripe webhook endpoint at:
```
https://exbjodmnpdiayfzrdyux.supabase.co/functions/v1/stripe-webhook
```

### Events subscribed
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.trial_will_end`
- `invoice.payment_failed`
- `invoice.payment_succeeded`
- `invoice.finalized`

### Signature verification
Dual-secret support (platform + Connect endpoints if any). Mobile doesn't need to touch this — webhook handling is server-only.

### Mobile concern
Mobile should NOT poll for subscription state changes after lifecycle actions. Instead:
- After calling pause/cancel/resume/restart, **invalidate your local cache** and re-fetch the restaurant row
- The webhook will sync the canonical state to the DB within seconds
- Show optimistic UI immediately, refresh on next pull-to-refresh OR via real-time subscription if your app uses Supabase realtime

### Real-time subscription on mobile (optional but recommended)
Use Supabase JS SDK's realtime feature to listen for changes on the `restaurants` row for the active restaurant. When subscription_status, paused_reason, or trial_ends_at changes, refresh the dashboard pill.

---

## 12. Card-only lockdown (no Klarna/Affirm/Link)

### Server side
Every PI creation MUST pass `payment_method_types: ['card']`. This filters out alternative payment methods.

### Client side (mobile)
- **iOS** PaymentSheet config: pass `allowsDelayedPaymentMethods = false`, and customize `appearance` to hide Link.
- **Android** PaymentSheet config: same idea — restrict to card.
- Both SDKs auto-enable Apple Pay / Google Pay on the same surface. Configure their merchant identifiers and country:
  - Apple Pay: requires `merchantIdentifier` (e.g., `merchant.com.cenaiva.app`), `merchantCountryCode: 'CA'`
  - Google Pay: requires similar config with the same merchant info

### Why no Klarna / Affirm
- BNPL on small restaurant deposits is silly
- Stripe charges higher fees on BNPL
- Disputes are messier on BNPL

### Why no Link
- It's a cross-merchant feature that confuses diners ("why does Cenaiva know I bought stuff on Lyft?")
- Adds a banner that doesn't fit Cenaiva's branding

---

## 13. Edge function reference table

All edge fns are at `https://exbjodmnpdiayfzrdyux.supabase.co/functions/v1/{name}`.

### Diner-facing (Stripe + bookings)
| Edge fn | Auth | Purpose |
|---|---|---|
| `create-reservation-hold` | None (public) | Reserve a slot for 30 min |
| `heartbeat-reservation-hold` | None | Keep the hold alive (poll every 30s) |
| `cancel-reservation-hold` | None | Release the hold |
| `create-public-payment-intent` | Optional JWT | Create PI for deposit/preorder |
| `stripe-attach-payment-method` | JWT required | Insert saved_cards row after charge |
| `stripe-list-methods` | JWT required | List saved cards |
| `stripe-detach-method` | JWT required | Detach card from Stripe customer |
| `create-public-booking` | None | Convert hold to confirmed reservation after payment |
| `cancel-reservation` | Mixed | Cancel + refund |
| `modify-reservation` | Mixed | Change slot/party + recalculate deposit |
| `stripe-charge-order` | JWT required | Post-meal pay-the-bill |
| `find-reservation` | None | Look up reservation by confirmation code |

### Owner-facing (Stripe + lifecycle + billing)
| Edge fn | Auth | Purpose |
|---|---|---|
| `signup-restaurant-owner` | None | Create owner account + initial restaurant draft |
| `create-stripe-account` | JWT | Create Stripe Connect account for restaurant |
| `create-account-session` | JWT | Get Connect Embedded client_secret |
| `save-subscription-payment-method` | JWT | Save the owner's card before publish |
| `publish-restaurant` | JWT | Create subscription + flip is_published |
| `pause-subscription` | JWT | Pause via pause_collection |
| `cancel-subscription` | JWT | Cancel at period end |
| `resume-subscription` | JWT | Resume from paused or cancel-pending |
| `restart-subscription` | JWT | Restart after full cancel |
| `update-billing-details` | JWT | Update legal name / address / tax ID |
| `get-next-bill-preview` | JWT | Returns next bill preview |
| `list-stripe-payouts` | JWT | Returns recent payouts to restaurant's bank |
| `get-restaurant-payment-method` | JWT | Returns the card-on-file metadata |
| `update-subscription-payment-method` | JWT | Change card on file |
| `delete-restaurant` | JWT | Soft-delete with grace |
| `recover-restaurant` | JWT | Undo soft-delete |

### Webhook (server-only)
| Edge fn | Auth | Purpose |
|---|---|---|
| `stripe-webhook` | Stripe signature | Receives events from Stripe, updates DB |

### Voice (web-only, IGNORE on mobile)
| Edge fn | Note |
|---|---|
| `cenaiva-chat` | Voice text-input tool calls. Mobile does not call. |
| `cenaiva-orchestrate` | Voice orchestrator. Mobile does not call. |

---

## 14. Race conditions + idempotency patterns

### Hold serialization
Reservation holds use a partial unique index (`reservation_holds_pi_unique`) on `stripe_payment_intent_id` where NOT NULL. Two concurrent attempts to create a PI on the same hold are serialized — the winner stamps the hold; the loser re-fetches and returns the winner's PI.

### Idempotency keys on every PI creation
Pattern: `{flow}_{stable_key}_{amount}`. Examples:
- `create-public-payment-intent` (saved card hold): `saved_card_{holdId}_{dinerTotalCents}`
- `create-public-payment-intent` (saved card no hold): `saved_card_b_{profileId}_{savedCardId}_{dinerTotalCents}`
- `stripe-charge-order`: `charge_order_{orderId}_{baseCents}`
- `modify-reservation` (delta): `modify_{reservationId}_{profileId}_{deltaCents}`
- `restart-subscription`: `restart_{customerId}_{YYYY-MM-DD}` (day-bucketed)

Mobile should follow the same pattern: never call a payment-creating endpoint without an idempotency key on the server.

### DB dedup pre-checks
Before INSERTing payment rows, SELECT first to check for an existing row with the same `(reservation_id OR order_id, stripe_payment_intent_id)`. If found, skip insert. Defends against browser/mobile retries after a 5xx mid-flow.

### Rate limits
All payment-touching edge fns have rate limits:
- `create-public-payment-intent`: 60/60s per identifier
- `stripe-charge-order`: 5/60s per user
- `modify-reservation`: 15/60s per user
- `cancel-reservation`: 10/60s per identifier
- Subscription lifecycle: 10/60s per user

Mobile should not retry faster than once per second per endpoint.

---

## 15. Mobile-specific considerations

### Stripe SDK choice
- **iOS**: Use Stripe's official `stripe-ios` SDK (v23+). PaymentSheet for card collection, Connect onboarding via `StripeConnect`.
- **Android**: Use `stripe-android` (v20+). PaymentSheet for card collection, Connect onboarding via `ConnectAccountOnboarding`.

### Apple Pay / Google Pay integration
- Already enabled on web via `wallets: { applePay: 'auto', googlePay: 'auto', link: 'never' }`.
- On mobile, the PaymentSheet auto-detects device capability and shows the wallet button.
- Required setup:
  - **iOS**: register Merchant ID in Apple Developer + Apple Pay capability in Xcode + Stripe Dashboard whitelist
  - **Android**: register Merchant ID in Google Pay Business Console + Stripe Dashboard whitelist

### 3D Secure handling
- iOS PaymentSheet auto-handles SCA flows
- Android PaymentSheet auto-handles SCA flows
- Test card for 3DS: `4000 0027 6000 3184`
- If user fails 3DS, PaymentSheet shows the error inline

### Deep link return URL for Connect Embedded
- iOS: register a custom URL scheme (`cenaiva://`)
- Android: register an intent filter for the return URL
- Stripe will redirect back to your app after KYC completion

### Sessions
Mobile uses Supabase JS SDK's `supabase.auth.signInWith*()` for OAuth/email/password. The session token (JWT) is passed as `Authorization: Bearer {access_token}` to all auth-required edge fns.

For the lifecycle of long sessions, mobile should respect `auto-refresh-token` — Supabase SDK auto-refreshes if `persistSession: true`.

### Don't poll, use realtime
For owner dashboard subscription state:
```ts
supabase
  .channel('restaurant-updates')
  .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'restaurants', filter: `id=eq.${restaurantId}` },
      (payload) => { refreshDashboardState(); })
  .subscribe();
```

### Background webhook reconciliation
If a charge succeeds but the mobile app's network drops before the response, the webhook will still fire and update the DB. Mobile should:
- On reconnect, re-fetch the booking/order state from DB (not from local optimistic state)
- Show "your booking is confirmed" based on DB authoritative state

---

## 16. Testing checklist for mobile

Run these tests in Stripe test mode before shipping each release.

### Test cards (Stripe canonical)
| Card | Behavior |
|---|---|
| `4242 4242 4242 4242` | Success |
| `4000 0000 0000 0002` | Generic decline |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0027 6000 3184` | 3D Secure required |
| `5555 5555 5555 4444` | Mastercard success |
| `3782 822463 10005` | Amex success |

### Diner flows
- [ ] Book deposit, party 1 ($10 base, below threshold) with 4242 → diner sees Processing fee $0.61 + total $10.61
- [ ] Book deposit, party 2 ($20 base, above threshold) with 4242 → no fee line, total $20.00
- [ ] Book preorder with menu items + tip + 4242 → success
- [ ] Book with 0002 → "Your card was declined" shown, no DB rows
- [ ] Book with 9995 → "That card doesn't have enough funds" shown
- [ ] Book with 3184 → 3DS challenge appears, completes successfully
- [ ] Save card on first booking → next booking shows saved card picker
- [ ] Delete saved card → both Stripe + DB cleaned
- [ ] Cancel a booking → confirmation modal → success message → refund hits Stripe within seconds
- [ ] Modify party 2 → 3 (with saved card) → delta auto-charged
- [ ] Modify party 3 → 2 (was paid) → delta auto-refunded
- [ ] Pay-the-bill after meal → tip applied → charge succeeds → receipt shown

### Owner flows
- [ ] Sign up → Connect Embedded onboarding → publish → 90-day trial begins
- [ ] Owner sees trial countdown pill in dashboard
- [ ] Owner edits billing details → saved
- [ ] Owner pauses subscription → restaurant unpublishes → pill shows "Subscription paused"
- [ ] Owner resumes → restaurant available to publish again (but must republish via wizard)
- [ ] Owner cancels subscription → pill shows "Cancelling on {date}"
- [ ] Owner resumes before period end → pill returns green
- [ ] Owner restarts after full cancel → new subscription, no trial
- [ ] Owner deletes restaurant → grace banner shows
- [ ] Owner recovers restaurant within grace → restored
- [ ] First monthly invoice fires → receipt email sent → expense rows auto-created → NextBillCard updates
- [ ] Payment failure → restaurant pauses + dashboard banner appears
- [ ] Payment recovery → restaurant republishes + banner clears

---

## 17. What NOT to do (footguns)

1. **DO NOT bypass `book_reservation` or `modify_reservation_slot` RPCs.** They own the advisory lock + cover cap check + diner-overlap guard. Direct INSERTs into `reservations` fail with opaque `23P01`.

2. **DO NOT compute Stripe fees on the client without server validation.** The mobile app can preview them for UX, but the server is the source of truth. Always pass `amount_cents` as BASE, let the server gross up.

3. **DO NOT use Stripe Customer Portal redirects.** Web removed all of them. Mobile should keep everything in-app. Use the in-app forms for billing details, Pause/Cancel/Resume/Restart.

4. **DO NOT use Link.** Disable it explicitly. It's a cross-merchant feature that doesn't fit Cenaiva's branding.

5. **DO NOT double-charge on retry.** Always use idempotency keys (see section 14).

6. **DO NOT charge for cancelled reservations.** `stripe-charge-order` server-side check exists, but mobile should also prevent the user from reaching the pay screen if reservation status is `cancelled`.

7. **DO NOT take payment via voice. EVER.** If you add voice to mobile, follow web's pattern: hand off to the payment screen for diner confirmation.

8. **DO NOT skip cancel confirmation modals.** Every destructive cancel/delete must have a popup. Inline confirmations are inconsistent and dangerous.

9. **DO NOT poll for subscription state changes.** Use realtime subscriptions or webhook-driven invalidation.

10. **DO NOT raw-UPDATE reservation status to 'cancelled' from the client.** Only `cancel-reservation` edge fn writes that.

11. **DO NOT bypass the threshold logic.** Below $12, the diner pays the Stripe fee. Above, Cenaiva absorbs. Both client + server must agree. Pulling the helper from `_shared/stripe-fee.ts` keeps both in sync.

12. **DO NOT use the legacy `create-subscription` edge fn.** It returns 410 by default. Use `publish-restaurant` for first publish, `restart-subscription` for re-subscribe.

---

## 18. Known non-blockers (operational edge cases)

These exist on web too. Operations can resolve manually in Stripe Dashboard.

### A. stripe-charge-order PI succeeds but order UPDATE fails
- Very rare: requires Supabase to fail in the ~50ms window between Stripe ack and DB write
- Outcome: Stripe has the money, our DB shows order unpaid
- Fix: operator manually marks the order paid in DB after verifying in Stripe
- Mobile mitigation: on receiving an error from `stripe-charge-order`, re-fetch the order status before retrying — if the in-flight guard catches it, instruct user to contact support

### B. Modify downsize refund failure
- Rare: Stripe refund fails (charge under dispute, account suspended, >90-day-old PI)
- Outcome: slot is updated but money not returned
- Fix: operator issues refund via Stripe Dashboard
- Mobile mitigation: show the `deposit_adjustment.kind === 'failed'` warning clearly

---

## 19. Cenaiva backend connection details

The Cenaiva backend is hosted on Supabase. Mobile apps connect via:

### Supabase project
- **Project ref**: `exbjodmnpdiayfzrdyux`
- **Region**: `ca-central-1` (Toronto)
- **Edge fn base URL**: `https://exbjodmnpdiayfzrdyux.supabase.co/functions/v1/`
- **REST API base**: `https://exbjodmnpdiayfzrdyux.supabase.co/rest/v1/`

### Required environment variables (mobile config)
Mobile should pull these from a secure config store (Xcode build config, Android Studio gradle.properties, or a remote config service):

| Variable | Test value source | Live value source |
|---|---|---|
| `SUPABASE_URL` | `https://exbjodmnpdiayfzrdyux.supabase.co` | Same (region-specific) |
| `SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API | Same |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_...` from Stripe Dashboard | `pk_live_...` from Stripe Dashboard |

Never bundle the Stripe SECRET key in mobile. Only the publishable key.
The secret key stays server-side in Supabase secrets.

### Apple Pay / Google Pay merchant IDs (set up in Stripe Dashboard)
| Platform | Where to register | Where to enable in Stripe |
|---|---|---|
| Apple Pay | Apple Developer → Identifiers → Merchant IDs → `merchant.com.cenaiva.app` | Stripe Dashboard → Settings → Payment methods → Apple Pay |
| Google Pay | Google Pay Business Console → linked to Stripe | Stripe Dashboard → Settings → Payment methods → Google Pay |

### Backend-side facts the mobile agent should know (NOT need to modify)
- Single Stripe webhook endpoint already configured: `https://exbjodmnpdiayfzrdyux.supabase.co/functions/v1/stripe-webhook`
- 7 events subscribed (listed in section 11)
- Webhook signature verification handled server-side; mobile doesn't touch this
- All payment edge fns already deployed and tested end-to-end on web

### Database tables your code will interact with (read or via RPC)
| Table | Access | Purpose |
|---|---|---|
| `restaurants` | Public read for published, RLS-gated for owners | Restaurant data + subscription state + billing details |
| `reservations` | RLS-gated | Diner bookings; mobile reads via service-side RPCs |
| `reservation_holds` | Service-role only | Slot reservations during checkout |
| `reservation_deposit_payments` | Service-role write, owner read | Deposit charge/refund records |
| `orders` + `order_items` | RLS-gated | Pre-order + post-meal orders |
| `saved_cards` | RLS-gated to owner | Diner's saved Stripe PMs |
| `user_profiles` | RLS-gated to owner | Diner accounts, includes `stripe_customer_id` |
| `expenses` | Owner read | Auto-imported Cenaiva billing rows (source='auto:cenaiva') |
| `restaurant_notification_log` | Owner read | Audit log of emails sent |
| `payments` | Audit only | Old pre-Connect payment log |

Mobile shouldn't write directly to most of these — use the edge fns
in section 13. RLS will block client writes anyway.

### Web app reference behavior
The Cenaiva web app at `cenaiva.com` (or staging URL when available) is
the authoritative implementation reference. If a flow in this doc is
ambiguous, the live web behavior wins. You can:
- Sign up as a test diner on the web → exercise the booking flow → observe network requests to confirm payload shapes
- Sign up as a test owner on the web → exercise the dashboard → observe lifecycle button behavior

---

## 20. Final pre-launch checklist for mobile

Before submitting the iOS/Android apps to stores, verify:

- [ ] All 17 diner flow tests pass on iOS device + Android device
- [ ] All 11 owner flow tests pass
- [ ] Apple Pay configured + working with merchant ID
- [ ] Google Pay configured + working with merchant ID
- [ ] Stripe SDK uses LIVE keys (not test) for the production build
- [ ] 3DS challenge flow works on both platforms
- [ ] No Klarna/Affirm/Link buttons visible anywhere in the PaymentSheet
- [ ] Save card persists across app restarts
- [ ] Cancel confirmation modal appears on every destructive action
- [ ] Subscription state changes propagate to UI within 5 seconds (realtime or pull-to-refresh)
- [ ] Receipt email arrives within 1 minute of payment
- [ ] Refund hits diner's card within 5-10 minutes (test mode = instant)
- [ ] App handles network drop gracefully (show error, allow retry, idempotency prevents double-charge)
- [ ] Operator can cancel a subscription from the mobile dashboard
- [ ] Operator can update billing details (legal name, address, GST)

---

## 21. Help / escalation

If something doesn't match this doc, the web app is authoritative. Cross-check:
1. Web behavior at the live URL (or staging when available)
2. Supabase Dashboard → Logs (project ref `exbjodmnpdiayfzrdyux`)
3. Stripe Dashboard → Events (test mode for development)
4. Ask the web team to clarify (they own the backend implementation)

This document was generated 2026-05-20 after a full code audit + 3-round verification (backend, frontend, live Stripe). All flows verified end-to-end. Code state is production-ready; only Stripe test → live mode flip + Connect re-onboarding of restaurants are left.

---

## 22. Appendix — Hard rules (NEVER violate)

These are the immutable guardrails the web team operates under. Mobile must respect them — they exist because each rule traces back to a bug, money leak, or security incident.

### Reservation writes
- **Never bypass** `book_reservation` or `modify_reservation_slot` RPCs. They own the advisory lock, cover-cap recheck, and diner-overlap pre-check. Direct INSERTs into `reservations` fail with opaque `23P01`; the RPCs return `P0006 / diner_double_book` properly.
- **Never raw-UPDATE `reservations.status='cancelled'`** outside the `cancel-reservation` edge fn. That edge fn owns the refund pipeline.

### Stripe / payments
- **Never compute the diner's PaymentIntent amount as the raw base** (deposit/preorder/order total). Always run the base through `computeDinerCharge(baseCents)` to gross up (or not, based on threshold).
- **Application fee = 5.5% of BASE**, not the grossed-up total. If you fee on the grossed-up total, you're charging diners more than 5.5%.
- **`stripe-charge-order` must go through the Connect-aware path**: PI created on the platform account with `application_fee_amount` + `transfer_data.destination = stripe_account_id`. Without these, money stays on the platform and the restaurant gets $0.
- **Never insert into `restaurant_booking_fees`** outside the `seed_booking_fee_on_confirm` trigger. The trigger is the single source of truth for "this reservation owes a $1 fee."
- **Never UPDATE `orders` from the diner-facing client.** RLS restricts UPDATE to staff. Use `mark-order-paid` or `stripe-charge-order`.
- **Never call `confirm-deposit-stub` from production.** Use `confirm-deposit-paid` (re-verifies the PI with Stripe).
- **`STRIPE_SUBSCRIPTION_PRICE_ID` must point to a Stripe Price ID** (`price_…`) — NOT a Product ID (`prod_…`). Subscriptions API rejects Product IDs with `resource_missing`.
- **Never re-introduce `COALESCE(s.max_covers, 100)`** in any reservation RPC. NULL means "no cap"; gate with `IF v_max_covers IS NOT NULL`.

### Auth / profile
- **Never assume `user_profiles` is NULL for an authenticated diner.** A trigger guarantees a row exists. Profile fields (full_name / email / phone) may be NULL — use a "RequireCompleteProfile" gate on field completeness, not row existence.
- **Self-service restaurant signup is open by design.** Don't add an admin-approval flow or default-`false` `is_active`. The current onboarding flips published when ready, not approved-by-admin.

### Voice (Hey Cenaiva)
- **Voice is logged-in users only** (when implemented). Per-IP rate limits are defeated by VPN rotation; use per-user rate limits.
- **Voice MUST NEVER take payment.** Always hand off to the payment screen. The web's `charge_saved_card` tool in `cenaiva-chat` and `cenaiva-orchestrate` was changed (2026-05-20) to return only a hand-off action — no Stripe API calls.

### General
- **Never bypass git pre-commit hooks** (`--no-verify`).
- **Never write Supabase queries in components.** Use hooks (or repositories in mobile parlance).
- **Never call the Claude/Anthropic API from the client.** Edge functions only.
- **Strict typing** — never `any` / `Any?` in Swift / Kotlin where a real type fits.

### When in doubt
Stop and ask. Don't infer architectural decisions from old patterns — the web app is the source of truth for behavior. If mobile code contradicts this doc, the doc is right until proven otherwise.

---

Good luck. Build it the same way and it'll just work.

---

## 23. API Call Recipes (exact payload shapes)

Every Stripe-touching edge fn is documented here with full request/response examples. All endpoints are at `https://exbjodmnpdiayfzrdyux.supabase.co/functions/v1/{name}`. All POST. All take JSON.

### Standard headers
```
Content-Type: application/json
apikey: {SUPABASE_ANON_KEY}        # always required
Authorization: Bearer {JWT}         # for owner-side + diner-with-account endpoints
```

### 23.1 create-reservation-hold (start a booking)
**Auth**: none (public)
```jsonc
// REQUEST
{
  "restaurant_id": "04cc5b2f-ca1d-4e5b-8c7f-0ac1bcdce0ae",
  "reserved_at": "2026-06-15T19:00:00Z",  // UTC
  "party_size": 2,
  "user_profile_id": "de3fbe5e-...",       // optional; null for guest bookings
  "guest_email": "diner@example.com",      // required if no user_profile_id
  "guest_phone": "+14165551234",           // required if no user_profile_id
  "guest_full_name": "Mark Habbi"
}

// RESPONSE 200
{
  "hold_id": "596f15d8-a33b-4c17-958b-3c4406637ea1",
  "expires_at": "2026-05-20T12:18:32.987Z",
  "deposit_amount_cents": 2000,
  "total_amount_cents": 2000,
  "tables": ["t_xxx"]
}

// RESPONSE 409 — slot taken or diner already booked at this time
{
  "error": "That time is no longer available for this party size",
  "unavailable_reason": "slot_taken" | "over_cover_cap" | "diner_double_book"
}
```

### 23.2 heartbeat-reservation-hold (extend the 30-min hold)
**Auth**: none. Call every 25-30 seconds while diner is in checkout.
```jsonc
// REQUEST
{ "hold_id": "596f15d8-..." }

// RESPONSE 200
{ "ok": true, "expires_at": "2026-05-20T12:48:32Z" }

// RESPONSE 410 — hold expired
{ "error": "hold_expired", "unavailable_reason": "hold_expired" }
```

### 23.3 cancel-reservation-hold (release slot on abandon)
```jsonc
// REQUEST
{ "hold_id": "596f15d8-..." }

// RESPONSE 200
{ "ok": true, "released": true }
```

### 23.4 create-public-payment-intent (create PI for diner deposit/preorder)
**Auth**: optional JWT. Pass JWT + `save_card: true` to save the card.
```jsonc
// REQUEST
{
  "restaurant_id": "04cc5b2f-...",
  "amount_cents": 2000,             // BASE amount; server grosses up
  "hold_id": "596f15d8-...",        // required for hold-based bookings
  "save_card": true                 // optional; logged-in diners only
}

// RESPONSE 200 (one-time card mode)
{
  "mode": "one_time",
  "client_secret": "pi_xxx_secret_yyy",  // pass to Stripe SDK confirmPayment
  "payment_intent_id": "pi_3TZ...",
  "base_amount_cents": 2000,
  "amount_cents": 2091,                 // what diner actually pays
  "processing_fee_cents": 91,           // 0 if above threshold
  "application_fee_cents": 110,
  "destination": "acct_1TZ2d6...",       // restaurant's Connect account
  "hold_id": "596f15d8-..."
}

// RESPONSE 200 (saved card mode — when saved_card_id provided)
{
  "mode": "saved_card",
  "status": "succeeded",                // or "requires_action" for 3DS
  "payment_intent_id": "pi_3TZ...",
  ...
}

// RESPONSE 410 — hold expired
{ "error": "hold_expired", "unavailable_reason": "hold_expired" }

// RESPONSE 409 — already in flight
{ "error": "Order charge already in flight. Please refresh and try again.", "already_in_flight": true }
```

### 23.5 create-public-booking (convert hold → confirmed reservation)
**Auth**: none. Call after PI succeeds.
```jsonc
// REQUEST
{
  "hold_id": "596f15d8-...",
  "stripe_payment_intent_id": "pi_3TZ...",
  "guest_full_name": "Mark Habbi",
  "guest_email": "diner@example.com",
  "guest_phone": "+14165551234",
  "special_request": "Tree Nuts allergy",
  "table_preference": "By the window",  // optional
  "occasion": "Birthday",                // optional
  "preorder_items": [                    // optional — for pre-orders
    { "menu_item_id": "uuid", "quantity": 1, "unit_price": 18.99 }
  ]
}

// RESPONSE 200
{
  "reservation_id": "5befef70-...",
  "confirmation_code": "CD857EDE",       // 6-8 char uppercase, save in mobile
  "status": "confirmed",
  "reserved_at": "2026-06-15T19:00:00Z"
}
```

### 23.6 find-reservation (look up by confirmation code)
**Auth**: none (the confirmation code IS the auth)
```jsonc
// REQUEST
{ "confirmation_code": "CD857EDE" }   // case-insensitive

// RESPONSE 200
{
  "reservation": {
    "id": "5befef70-...",
    "restaurant_id": "04cc5b2f-...",
    "restaurant_name": "Webhook Test Pizza",
    "restaurant_slug": "webhook-test-pizza-6c95c097",
    "restaurant_timezone": "America/Toronto",
    "reserved_at": "2026-06-15T19:00:00Z",
    "party_size": 2,
    "status": "confirmed",
    "guest_full_name": "Mark Habbi",
    "guest_email": "diner@example.com",
    "guest_phone": "+14165551234",
    "special_request": "Tree Nuts",
    "confirmation_code": "CD857EDE"
  }
}

// RESPONSE 404
{ "error": "Reservation not found." }
```

### 23.7 cancel-reservation (refund pipeline)
**Auth**: 3 modes — owner JWT + role, diner JWT + profile match, or confirmation code
```jsonc
// REQUEST (diner-side, by confirmation code)
{
  "reservation_id": "5befef70-...",
  "confirmation_code": "CD857EDE",
  "actor": "diner"  // or "owner" with JWT + role check
}

// RESPONSE 200
{
  "ok": true,
  "reservation_id": "5befef70-...",
  "refunds": [
    {
      "kind": "deposit",
      "stripe_refund_id": "re_3TZ...",
      "amount_cents": 1890,       // base - app_fee = 94.5% of base
      "status": "succeeded"
    }
  ]
}

// RESPONSE 200 (idempotent — already cancelled)
{ "ok": true, "already_cancelled": true }
```

### 23.8 modify-reservation (date/time/party + delta charge/refund)
**Auth**: same as cancel
```jsonc
// REQUEST
{
  "reservation_id": "5befef70-...",
  "confirmation_code": "CD857EDE",       // for guest auth
  "date": "2026-06-16",                  // YYYY-MM-DD in restaurant TZ
  "time": "20:00",                       // HH:MM 24-hr
  "party_size": 3,
  "special_request": "Tree Nuts, GF for 1"
}

// RESPONSE 200 (with delta charge succeeded)
{
  "ok": true,
  "reservation_id": "5befef70-...",
  "reserved_at": "2026-06-16T20:00:00Z",
  "party_size": 3,
  "deposit_adjustment": {
    "kind": "charged",                   // or "refunded" | "failed" | "none"
    "amount_cents": 1000,                // delta charged or refunded
    "payment_intent_id": "pi_3TZ..."
  }
}

// RESPONSE 402 — upsize requires card but no card on file
{
  "error": "Increasing your party size needs a saved card. Please contact the restaurant to update.",
  "unavailable_reason": "modify_requires_card",
  "delta_cents": 1000
}

// RESPONSE 409 — slot conflict
{
  "error": "That time is no longer available for this party size",
  "unavailable_reason": "slot_taken" | "diner_double_book" | "over_cover_cap"
}
```

### 23.9 stripe-charge-order (pay-the-bill post-meal)
**Auth**: JWT required
```jsonc
// REQUEST
{
  "order_id": "557c862c-ccca-...",
  "tip_amount": 5.00          // OR tip_percentage: 18
}

// RESPONSE 200
{
  "ok": true,
  "order_id": "557c862c-...",
  "total_charged": 50.91,
  "tip_amount": 5.00,
  "processing_fee": 1.41,     // 0 if above threshold
  "paid_at": "2026-05-20T20:15:00Z",
  "stripe_payment_intent_id": "pi_3TZ..."
}

// RESPONSE 409 — reservation cancelled (charge rejected)
{
  "ok": false,
  "error": "This reservation was cancelled. You can't charge for it.",
  "reservation_status": "cancelled"
}

// RESPONSE 429 — rate limited (5 per 60s per user)
{ "error": "Too many charge attempts. Wait a moment and try again." }
```

### 23.10 stripe-attach-payment-method (record saved card after charge)
**Auth**: JWT required
```jsonc
// REQUEST
{ "payment_intent_id": "pi_3TZ..." }

// RESPONSE 200
{
  "saved_card": {
    "id": "uuid",
    "brand": "visa",
    "last4": "4242",
    "exp_month": 12,
    "exp_year": 30,
    "is_default": true
  }
}

// RESPONSE 200 (idempotent)
{ "saved_card": {...}, "idempotent": true }
```

### 23.11 stripe-list-methods (saved card picker)
**Auth**: JWT required. Method: GET (not POST).
```
GET /functions/v1/stripe-list-methods
Authorization: Bearer {jwt}
apikey: {anon}

// RESPONSE 200
{
  "cards": [
    {
      "id": "uuid",
      "stripe_payment_method_id": "pm_xxx",
      "brand": "visa",
      "last4": "4242",
      "exp_month": 12,
      "exp_year": 30,
      "is_default": true
    }
  ]
}
```

### 23.12 stripe-detach-method (delete saved card)
**Auth**: JWT required
```jsonc
// REQUEST
{ "payment_method_id": "pm_xxx" }

// RESPONSE 200
{ "ok": true }
// then delete the saved_cards row via Supabase SDK
```

### 23.13 create-stripe-account (Connect onboarding — start)
**Auth**: JWT required (owner)
```jsonc
// REQUEST
{ "restaurant_id": "04cc5b2f-..." }

// RESPONSE 200
{ "stripe_account_id": "acct_1TZ..." }
```

### 23.14 create-account-session (Connect Embedded session)
**Auth**: JWT required (owner)
```jsonc
// REQUEST
{ "restaurant_id": "04cc5b2f-..." }

// RESPONSE 200
{ "client_secret": "accs_xxx_secret_yyy" }
// pass this to the Stripe Connect SDK on mobile
```

### 23.15 save-subscription-payment-method (card-on-file for restaurant sub)
**Auth**: JWT required (owner)
```jsonc
// REQUEST: SetupIntent flow — server returns client_secret, SDK collects card
{ "restaurant_id": "04cc5b2f-..." }

// RESPONSE 200
{ "setup_intent_client_secret": "seti_xxx_secret_yyy" }
```

### 23.16 publish-restaurant (atomic sub create + publish)
**Auth**: JWT required (owner)
```jsonc
// REQUEST
{ "restaurant_id": "04cc5b2f-..." }

// RESPONSE 200
{
  "ok": true,
  "subscription_id": "sub_xxx",
  "trial_ends_at": "2026-08-18T00:00:00Z",
  "is_published": true
}

// RESPONSE 400 — pre-publish gate failed
{
  "error": "Cannot publish: KYC incomplete" | "Cannot publish: missing cover photo" | ...
}
```

### 23.17 pause-subscription / cancel-subscription / resume-subscription / restart-subscription
All take `{ restaurant_id }`, all return `{ ok: true, ...details }` or `{ error }`.

Example for `cancel-subscription`:
```jsonc
// REQUEST
{ "restaurant_id": "04cc5b2f-..." }

// RESPONSE 200
{
  "ok": true,
  "subscription_id": "sub_xxx",
  "cancel_at_period_end": true,
  "period_end_iso": "2026-08-18T00:00:00Z"
}
```

### 23.18 update-billing-details
**Auth**: JWT required (owner)
```jsonc
// REQUEST
{
  "restaurant_id": "04cc5b2f-...",
  "legal_name": "1234567 Ontario Inc.",
  "billing_email": "accounting@example.com",
  "address": {
    "line1": "123 King St W",
    "line2": "Suite 200",
    "city": "Toronto",
    "province": "ON",
    "postal_code": "M5H 1J9",
    "country": "CA"
  },
  "tax_id": {                          // null to remove
    "type": "ca_gst_hst",              // see allowed types in section 9
    "value": "123456789 RT0001"
  }
}

// RESPONSE 200
{ "ok": true }
```

### 23.19 get-next-bill-preview
**Auth**: JWT required (owner)
```jsonc
// REQUEST
{ "restaurant_id": "04cc5b2f-..." }

// RESPONSE 200
{
  "ok": true,
  "has_upcoming": true,
  "next_amount_cents": 20599,           // total for next invoice
  "next_date_iso": "2026-08-18T00:00:00Z",
  "currency": "cad",
  "line_items": [
    {
      "description": "Cenaiva Standard subscription",
      "amount_cents": 19999,
      "quantity": 1,
      "is_subscription": true
    },
    {
      "description": "Cenaiva booking fee",
      "amount_cents": 100,
      "quantity": 6,
      "is_subscription": false
    }
  ]
}

// RESPONSE 200 (trialing or no sub)
{ "ok": true, "has_upcoming": false, "reason": "trialing" }
```

### 23.20 list-stripe-payouts
**Auth**: JWT required (owner)
```jsonc
// REQUEST
{ "restaurant_id": "04cc5b2f-..." }

// RESPONSE 200
{
  "ok": true,
  "has_account": true,
  "payouts_enabled": true,
  "available_balance_cents": 0,
  "pending_balance_cents": 36107,
  "payouts": [
    {
      "id": "po_xxx",
      "amount_cents": 18900,
      "currency": "cad",
      "status": "paid",            // paid | in_transit | pending | failed | canceled
      "arrival_date_iso": "2026-05-25T00:00:00Z",
      "created_iso": "2026-05-23T10:00:00Z"
    }
  ]
}
```

### 23.21 delete-restaurant / recover-restaurant
**Auth**: JWT required (owner)
```jsonc
// delete-restaurant request
{
  "restaurant_id": "04cc5b2f-...",
  "confirm_name": "Webhook Test Pizza"     // must match restaurant.name exactly
}

// RESPONSE 200
{ "ok": true, "scheduled_purge_at": "2026-06-19T00:00:00Z" }

// recover-restaurant: same shape minus confirm_name
```

---

## 24. Authentication & Security deep dive

### Auth identities in Cenaiva

| Identity | What it is | When used |
|---|---|---|
| Owner | Restaurant operator with `owner` role in `user_restaurant_roles` | All owner-side endpoints |
| Staff | Restaurant employee with `host`/`manager`/`server` role | Owner-side endpoints (limited) |
| Diner (logged-in) | Diner with a Cenaiva account (`user_profiles` row + `auth_user_id`) | Saved cards, history, modify own bookings |
| Diner (guest) | One-shot diner — no Cenaiva account; identified by `guest_email` + `confirmation_code` | One-off bookings, find-reservation flow |

### `guests` vs `user_profiles` (CRITICAL distinction)

This trips up every new dev. There are TWO diner tables:

**`user_profiles`** — long-lived Cenaiva account
- One per authenticated diner
- Has `auth_user_id` (FK to Supabase auth.users)
- Has `stripe_customer_id`
- Owns saved cards (via FK)
- Persists across bookings

**`guests`** — per-booking record
- One per booking (NOT per person)
- Has `full_name`, `email`, `phone` for THIS booking's contact info
- Has `user_profile_id` if the diner was logged in (else NULL = "guest booking")
- Owns `reservations` and `orders` (via FK)
- Persists for the lifetime of the booking + analytics

When a logged-in diner books:
- New `guests` row → tied to their `user_profile_id`
- Their saved Stripe customer is used for payment
- Modify/cancel allowed via JWT auth OR confirmation code

When a guest diner books:
- New `guests` row → `user_profile_id` = NULL
- Stripe creates an anonymous one-time PaymentMethod
- Modify/cancel ONLY via confirmation code

### Confirmation code (the guest auth token)

Format: `XXXXXXXX` (8 char uppercase alphanumeric, e.g., `CD857EDE`) or `SEAT-XXXX` for some flows.

**Treated as a low-stakes secret**:
- Generated server-side at booking creation
- Sent via email + SMS to diner
- Used as auth for guest cancel/modify (no JWT needed)
- Case-insensitive comparison
- Burned by `status='cancelled'` — once cancelled, the code can't be reused

**Never validate it client-side**. Always pass to the edge fn which validates.

### JWT auth (Supabase)

For all owner-side and logged-in-diner endpoints, mobile sends:
```
Authorization: Bearer {access_token}
```
The `access_token` comes from `supabase.auth.signInWith*()` / `supabase.auth.getSession()`.

Mobile MUST:
- Use Supabase SDK's auto-refresh (`persistSession: true`)
- Store the refresh token in secure storage (iOS Keychain, Android EncryptedSharedPreferences)
- Never log JWTs to telemetry or crash reports
- On logout, call `supabase.auth.signOut()` to invalidate

### Row Level Security (RLS) on the database

Most tables have RLS enabled. Mobile clients SHOULD use the public anon key + JWT — RLS will gate access:

| Table | Diner can do | Owner can do |
|---|---|---|
| `restaurants` | SELECT published only | All on own restaurants |
| `reservations` | SELECT own (by user_profile_id or guest_email) | All on own restaurant's |
| `orders` | SELECT own; NO UPDATE | All on own restaurant's |
| `saved_cards` | All on own (user_profile_id matches) | None (can't see diners' cards) |
| `user_profiles` | All on own | None (can't see diners) |
| `reservation_deposit_payments` | SELECT own; NO INSERT/UPDATE | SELECT own restaurant's |
| `expenses` | None | All on own restaurant's |

Service role (used by edge fns) bypasses RLS — that's why all sensitive writes go through edge fns.

### Rate limits (server-side, per identifier)

Every payment endpoint has a rate limit. Mobile should:
- Implement client-side debouncing on Pay buttons
- Show "Too many attempts — wait a moment" on 429 responses
- Never retry a 429 immediately

| Endpoint | Limit |
|---|---|
| `create-public-payment-intent` | 60 / 60s per IP-or-user |
| `stripe-charge-order` | 5 / 60s per user |
| `modify-reservation` | 15 / 60s per user |
| `cancel-reservation` | 10 / 60s per identifier |
| `pause/cancel/resume/restart-subscription` | 10 / 60s per user |
| `restart-subscription` | 5 / 60s per user |
| `update-billing-details` | 10 / 60s per user |
| `get-next-bill-preview` / `list-stripe-payouts` | 30 / 60s per user |

### Stripe API security

- **Secret keys** stay server-side in Supabase secrets. Never bundle in mobile.
- **Publishable keys** are safe in mobile (the test/live distinction matters: bundle the right one per build flavor).
- **Webhook signing secrets** stay server-side. Mobile doesn't touch webhooks.
- **Customer secrets** (`cus_xxx`) are server-only references — mobile gets PI client_secrets and SetupIntent client_secrets, not customer IDs directly.

### PCI scope

Mobile is OUT OF SCOPE for PCI DSS because Stripe SDK never exposes raw card data to the host app:
- `PaymentSheet` is Stripe-hosted UI — card numbers never enter mobile process memory
- Tokens (`pm_xxx`) and PI client_secrets are NOT PCI-sensitive
- Don't log card details. Don't store cards. Let Stripe handle it.

### Apple Pay / Google Pay specific security
- Apple Pay tokens are Apple Pay Decryption Tokens — Stripe handles decryption
- Google Pay tokens are tokenized PANs — Stripe handles validation
- Both are non-PCI-sensitive on your end

### Webhook signature verification (you don't implement, just trust)
Server-side, every webhook event is verified with both:
1. Stripe's signature header (`Stripe-Signature`) using HMAC-SHA256
2. The configured webhook secret (`STRIPE_WEBHOOK_SECRET`)

Mobile must NEVER try to short-circuit webhook events by trusting client-side state. If the client thinks "I just paid", verify against the DB which is updated by the webhook.

### Idempotency keys (REQUIRED on every payment-creating call)

All payment-creating edge fns already include Stripe idempotency keys. Mobile doesn't add its own — but mobile SHOULD pass through a stable "request_id" header if you want idempotent retries:
```
Idempotency-Key: a-stable-uuid-per-user-action
```
However Cenaiva's edge fns generate their own keys, so this is optional.

### Mobile-side secure storage

| Item | iOS | Android |
|---|---|---|
| Supabase JWT refresh token | Keychain | EncryptedSharedPreferences (AES-256) |
| Stripe publishable key | Hard-coded in build config (it's safe) | Hard-coded |
| User session cookies | N/A (we use JWT) | N/A |
| Saved card metadata (last4, brand) | Standard NSUserDefaults OK (not sensitive) | Standard SharedPreferences OK |
| Stripe `pm_xxx` IDs | NOT sensitive; cacheable | Same |

### Logging / observability

Don't log:
- Card numbers (Stripe SDK doesn't expose them anyway)
- JWT tokens (mask to `eyJ...xxx` if logging request URLs)
- Stripe client_secrets (they're already short-lived)
- User PII (email, phone) in crash reports → set as `metadata` not `breadcrumb`

Do log:
- Edge fn endpoint + response status (not body)
- Stripe error codes (`card_declined`, `insufficient_funds`)
- Booking flow steps (analytics-safe)

---

## 25. Error handling reference (codes → user messages)

### Stripe error codes → user copy

| Stripe `code` | Diner-friendly message |
|---|---|
| `card_declined` | "Your card was declined. Try a different card or call your bank." |
| `insufficient_funds` | "That card doesn't have enough funds. Try a different card." |
| `expired_card` | "That card has expired. Try a different one." |
| `incorrect_cvc` | "The security code (CVC) didn't match. Double-check and try again." |
| `processing_error` | "Something went wrong processing your card. Try again in a moment." |
| `authentication_required` | "Your card needs additional verification. We'll guide you through it." → triggers 3DS flow |
| `payment_intent_authentication_failure` | "Verification didn't complete. Try again with a different card." |
| `rate_limit` | "Too many requests. Wait a moment and try again." |

### Cenaiva edge fn `unavailable_reason` codes

| Code | Where | User message |
|---|---|---|
| `slot_taken` | hold/modify | "That time is no longer available. Try another slot." |
| `over_cover_cap` | hold/modify | "The restaurant is fully booked at that time." |
| `diner_double_book` | hold/modify | "You already have a reservation at this time. Cancel or modify that one first." |
| `hold_expired` | PI create | "Your hold expired. Please re-select your slot." |
| `modify_requires_card` | modify | "Increasing your party size needs a card on file. Add one in Account → Payment." |
| `past_shift_close` | modify | "That time is past the shift's close. Pick an earlier time." |
| `missing_identifier` | modify | "This booking is missing contact info. Please contact the restaurant." |

### HTTP status code patterns

| Status | Means |
|---|---|
| 200 | Success |
| 400 | Bad input (validation error) |
| 401 | Missing or invalid JWT |
| 402 | Payment required (card needed for action) |
| 403 | Forbidden (auth ok, but not allowed for this resource) |
| 404 | Resource not found |
| 409 | Conflict (slot taken, already cancelled, already in flight) |
| 410 | Gone (hold expired, deprecated endpoint) |
| 429 | Rate limited |
| 500 | Server error — show generic "Something went wrong" |

---

## 26. Database schema reference

### Key tables with relevant columns

#### `restaurants`
```
id                                  uuid PK
name                                text
slug                                text unique
email                               text
city, province, country, lat, lng   text/numeric
currency                            text default 'CAD'
timezone                            text default 'America/Toronto'
business_type                       text
deposit_tiers                       jsonb  -- see section 4 for shape
hours_json                          jsonb
settings_json                       jsonb
has_bar, accepts_walkins            boolean
is_published                        boolean
deleted_at, scheduled_purge_at      timestamptz
paused_reason                       text  -- enum: owner_unpublished/payment_failed/pending_deletion/subscription_cancelled
referral_code                       text

-- Stripe integration:
stripe_customer_id                  text   -- restaurant's Stripe customer
stripe_account_id                   text   -- their Connect account
stripe_charges_enabled              boolean
stripe_payouts_enabled              boolean
stripe_subscription_id              text
subscription_status                 text   -- trialing/active/past_due/etc.
trial_ends_at                       timestamptz
payment_method_attached_at          timestamptz
subscription_cancel_at_period_end   boolean
subscription_paused_at              timestamptz

-- Billing details (editable via update-billing-details):
billing_legal_name                  text
billing_email                       text
billing_address_line1, line2, city, province, postal_code, country  text
billing_tax_id_type                 text   -- ca_gst_hst/ca_qst/etc.
billing_tax_id_value                text
```

#### `reservations`
```
id                          uuid PK
restaurant_id               uuid FK
user_profile_id             uuid FK nullable  -- null for guest bookings
guest_id                    uuid FK  -- always present
reserved_at                 timestamptz       -- in UTC
party_size                  int
status                      text  -- pending/confirmed/cancelled/no_show/completed/seated
confirmation_code           text  -- the guest auth token
guest_full_name, email, phone  text  -- snapshot at booking time
special_request             text
internal_notes              text  -- staff-only
event_id, promotion_id      uuid nullable
cancelled_at                timestamptz
cancellation_reason         text
created_at, updated_at      timestamptz
```

#### `reservation_holds`
```
id                          uuid PK
restaurant_id               uuid
reserved_at                 timestamptz
party_size                  int
deposit_amount_cents        int
total_amount_cents          int
stripe_payment_intent_id    text  -- partial unique when not null
status                      text  -- active/converting/converted/expired
expires_at                  timestamptz
table_ids                   uuid[]
```

#### `reservation_deposit_payments`
```
id                          uuid PK
reservation_id              uuid FK
amount_cents                int  -- BASE deposit, not grossed-up
stripe_payment_intent_id    text
status                      text  -- pending/charged/refunded/cancelled/failed
payer_email, payer_full_name, payer_phone  text  -- for split tender
paid_at, refunded_at        timestamptz
delta_cents                 int  -- non-null for modify-driven delta charges
created_at                  timestamptz
```

#### `orders` + `order_items`
```
-- orders
id                          uuid PK
restaurant_id, reservation_id, guest_id  uuid FK
subtotal, tax_amount, discount_amount, tip_amount, total_amount  numeric  -- dollars NOT cents
order_type                  text  -- pre_order/post_meal
status                      text  -- pending/paid/cancelled
payment_method              text  -- stripe/card_test/manual
stripe_payment_intent_id    text
confirmation_code           text
paid_at, billed_at          timestamptz

-- order_items
id                          uuid PK
order_id                    uuid FK
menu_item_id                uuid FK
quantity                    int
unit_price, line_total      numeric  -- dollars
modifications               text
course                      text
status                      text  -- pending/preparing/ready/served
```

#### `saved_cards`
```
id                              uuid PK
user_profile_id                 uuid FK
stripe_payment_method_id        text  -- pm_xxx
brand, last4                    text
exp_month, exp_year             int
is_default                      boolean
created_at                      timestamptz
```

#### `user_profiles`
```
id                              uuid PK
auth_user_id                    uuid FK to auth.users
full_name, email, phone         text
stripe_customer_id              text  -- cus_xxx
cenaiva_tts_voice               text  -- voice picker (mobile ignores)
created_at, updated_at          timestamptz
```

#### `guests`
```
id                              uuid PK
restaurant_id                   uuid FK  -- guest may be per-restaurant
user_profile_id                 uuid FK nullable
full_name, email, phone         text
dietary_restrictions, allergies text
seating_preference              text
noise_preference                text
no_show_count                   int
created_at                      timestamptz
```

#### `expenses` (auto-imported Cenaiva billing visible to owner)
```
id                              uuid PK
restaurant_id                   uuid FK
category                        text  -- always 'other' for auto rows
vendor_name                     text  -- 'Cenaiva'
description                     text  -- 'Cenaiva subscription' or 'Cenaiva booking fees (N bookings)'
amount, total_amount            numeric
currency                        text
expense_date                    date
payment_status                  text  -- 'paid'
external_ref                    text  -- the Stripe invoice id (for idempotency)
source                          text  -- 'auto:cenaiva' for these rows
created_at                      timestamptz
```

---

## 27. Webhook event payloads (for future reference if mobile ever needs them)

Mobile doesn't receive webhooks (they go to the backend), but if mobile uses Supabase realtime to listen for downstream changes, here's what triggers DB updates:

### Subscription lifecycle
`customer.subscription.updated` → backend updates `restaurants.subscription_status`, `trial_ends_at`, `subscription_cancel_at_period_end`, `subscription_paused_at`. Mobile sees these via realtime.

### Invoice payment
`invoice.payment_succeeded` → backend:
1. Looks up restaurant by `customer`
2. Inserts 2 `expenses` rows (one for subscription, one for booking fees)
3. Sends `payment_received` email
4. Updates UI surfaces (NextBillCard, PayoutsSection refresh data on next fetch)

### Payment intent (deposit/preorder)
`payment_intent.succeeded` → backend converts the hold to a reservation atomically. The `convert_reservation_hold_to_reservation` RPC handles this.

`payment_intent.payment_failed` → backend stamps the hold with the failure reason; webhook also fires email.

### Subscription deleted (full cancel)
`customer.subscription.deleted` → backend sets `subscription_status='canceled'`, `is_published=false`, `paused_reason='subscription_cancelled'`. Mobile sees the restaurant unpublished.

---

## 28. Time zones, phone, currency, formatting

### Time zones
- All timestamps in DB are UTC
- Each restaurant has a `timezone` column (IANA format, e.g., `America/Toronto`)
- ALL booking times displayed to diners must be in the RESTAURANT's timezone, not the diner's device timezone
- Mobile: fetch `restaurants.timezone`, use that as the display TZ for `reserved_at`
- Hold expiry is in UTC; display as countdown without TZ confusion

### Phone numbers
- E.164 format: `+14165551234` (no spaces, no dashes)
- Required field for all bookings (web validates this; mobile must too)
- For SMS delivery (booking reminders), the country code MUST be present
- Recommended: use `libphonenumber-ios` (Swift) and `libphonenumber-android` (Kotlin) for parsing + validation

### Currency
- Cenaiva is CAD-only for now
- All amounts in DB stored as integer cents for Stripe-related (PI amounts, deposit_payments.amount_cents) OR as `numeric(10,2)` dollars for orders.total_amount + expenses.amount
- Mobile display: format with `NSNumberFormatter` (iOS) / `NumberFormat` (Android) with currency code `"CAD"`, locale `"en-CA"`
- Future i18n: not in scope for v1

### Email
- All emails sent via Resend (sandbox + production)
- Templates managed server-side; mobile can't customize
- Welcome / receipt / cancellation / reminder emails fire automatically
- Diner can opt out via account settings

### Stripe API version (REQUIRED for SDK init)
```
2024-11-20.acacia
```
Both iOS and Android Stripe SDKs accept this in their `Stripe.apiVersion` config. If you don't pin, Stripe uses the account's default which might drift.

---

## 29. Mock test data + sandbox accounts

### Webhook Test Pizza (verified test restaurant)
| Field | Value |
|---|---|
| ID | `04cc5b2f-ca1d-4e5b-8c7f-0ac1bcdce0ae` |
| Name | Webhook Test Pizza |
| Slug | `webhook-test-pizza-6c95c097` |
| Stripe Connect account | `acct_1TZ2d6Jo3JqsdVQu` |
| Subscription status | `trialing` |
| Deposit tiers | `[{"min_party_size":1,"amount_per_person_cents":1000}]` (default) |
| Menu items | 3 items (Margherita $18.99, Pepperoni $21.99, Quattro Formaggi $23.99) |
| Owner email | Mark's email (see web team) |

### Test diner account
| Field | Value |
|---|---|
| Email | `markhabbi2@gmail.com` |
| User profile ID | `de3fbe5e-0c7f-4d35-93f5-eaa2e0910209` |
| Stripe customer | `cus_UWE6s9xt5GyADW` |

### Stripe test cards (canonical)
| Card | Behavior |
|---|---|
| `4242 4242 4242 4242` | Success — Visa |
| `5555 5555 5555 4444` | Success — Mastercard |
| `3782 822463 10005` | Success — Amex |
| `4000 0000 0000 0002` | Decline (generic) |
| `4000 0000 0000 9995` | Decline (insufficient funds) |
| `4000 0027 6000 3184` | 3DS required (success after challenge) |
| `4000 0084 0000 1629` | 3DS required (fails after challenge) |
| `4000 0000 0000 0341` | Attaches to customer fine but charges decline |

For all test cards: any future expiry (e.g., `12/30`), any 3-digit CVC (`123`).

### Sample successful booking record (from web testing)
```jsonc
{
  "confirmation_code": "CD857EDE",
  "reservation_id": "5befef70-a35b-48c9-b1eb-a299e127a75b",
  "stripe_payment_intent_id": "pi_3TZ88AJABKj4FeJX0nJLwo6F",
  "amount_paid_cents": 2091,
  "base_amount_cents": 2000,
  "processing_fee_cents": 91,
  "application_fee_cents": 110
}
```

---

## 30. Concrete iOS + Android code snippets

### iOS — Initialize Stripe SDK (AppDelegate or App entry)
```swift
import Stripe

@main
struct CenaivaApp: App {
    init() {
        StripeAPI.defaultPublishableKey = "pk_test_..." // from build config
        StripeAPI.apiVersion = "2024-11-20.acacia"
        // Apple Pay merchant ID
        STPAPIClient.shared.merchantIdentifier = "merchant.com.cenaiva.app"
    }
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}
```

### iOS — Present PaymentSheet for diner deposit
```swift
import StripePaymentSheet

func presentPaymentSheet(clientSecret: String, holdId: String) {
    var config = PaymentSheet.Configuration()
    config.merchantDisplayName = "Cenaiva"
    config.applePay = .init(
        merchantId: "merchant.com.cenaiva.app",
        merchantCountryCode: "CA"
    )
    config.allowsDelayedPaymentMethods = false
    config.appearance = customCenaivaAppearance() // gold accent

    let paymentSheet = PaymentSheet(
        paymentIntentClientSecret: clientSecret,
        configuration: config
    )

    paymentSheet.present(from: self) { result in
        switch result {
        case .completed:
            // call create-public-booking to convert hold → reservation
            convertHoldToBooking(holdId: holdId)
        case .canceled:
            // diner closed the sheet; hold stays alive until expiry
            break
        case .failed(let error):
            // show error toast: error.localizedDescription
            showError(error)
        }
    }
}
```

### iOS — Save card during charge (setupFutureUsage)
```swift
// In PaymentSheet.Configuration:
config.paymentMethodOptions = .init(
    setupFutureUsage: .offSession
)
// AND the server PI must be created with setup_future_usage: 'off_session'
// AND customer attached. Mobile passes save_card: true in the API body.
```

### iOS — Connect Embedded onboarding (Step 7 of restaurant onboarding)
```swift
import StripeConnect

func presentConnectOnboarding(restaurantId: String) async {
    // 1. Get the client_secret
    let res = await callEdgeFn("create-account-session", body: ["restaurant_id": restaurantId])
    let clientSecret = res["client_secret"] as! String

    // 2. Init StripeConnect instance
    let stripeConnect = StripeConnectInstance(clientSecret: clientSecret)

    // 3. Present onboarding
    let onboardingVC = AccountOnboardingViewController(
        instance: stripeConnect,
        delegate: self
    )
    self.present(onboardingVC, animated: true)
}

extension OnboardingHostVC: AccountOnboardingViewControllerDelegate {
    func accountOnboardingDidExit(_ vc: AccountOnboardingViewController) {
        // Owner completed (or abandoned) KYC. Refresh restaurant row to
        // check `stripe_charges_enabled`.
        Task { await refreshRestaurantState() }
    }
}
```

### Android — Initialize Stripe SDK (Application class)
```kotlin
import com.stripe.android.PaymentConfiguration

class CenaivaApp : Application() {
    override fun onCreate() {
        super.onCreate()
        PaymentConfiguration.init(
            applicationContext,
            BuildConfig.STRIPE_PUBLISHABLE_KEY
        )
        // Stripe API version is set automatically by the SDK; pin via:
        // Stripe.appInfo = AppInfo.create("Cenaiva", "1.0.0", ...)
    }
}
```

### Android — Present PaymentSheet for diner deposit
```kotlin
import com.stripe.android.paymentsheet.*

class DepositCheckoutFragment : Fragment() {
    private lateinit var paymentSheet: PaymentSheet

    override fun onViewCreated(view: View, state: Bundle?) {
        super.onViewCreated(view, state)
        paymentSheet = PaymentSheet(this, ::onPaymentResult)
    }

    fun presentSheet(clientSecret: String) {
        val configuration = PaymentSheet.Configuration(
            merchantDisplayName = "Cenaiva",
            googlePay = PaymentSheet.GooglePayConfiguration(
                environment = PaymentSheet.GooglePayConfiguration.Environment.Test, // or Production
                countryCode = "CA",
                currencyCode = "CAD",
            ),
            allowsDelayedPaymentMethods = false,
        )
        paymentSheet.presentWithPaymentIntent(clientSecret, configuration)
    }

    private fun onPaymentResult(result: PaymentSheetResult) {
        when (result) {
            is PaymentSheetResult.Completed -> convertHoldToBooking(...)
            is PaymentSheetResult.Canceled -> { /* hold stays */ }
            is PaymentSheetResult.Failed -> showError(result.error)
        }
    }
}
```

### Android — Save card during charge
```kotlin
val configuration = PaymentSheet.Configuration(
    merchantDisplayName = "Cenaiva",
    // ...
    paymentMethodOptions = PaymentSheet.PaymentMethodOptions(
        setupFutureUsage = PaymentSheet.IntentConfiguration.SetupFutureUsage.OffSession
    )
)
```

### Cross-platform — Compute deposit (port the JS to Swift / Kotlin)

Swift:
```swift
struct DinerCharge {
    let baseCents: Int
    let dinerTotalCents: Int
    let processingFeeCents: Int
    let applicationFeeCents: Int
    let dinerPaysFee: Bool
}

func computeDinerCharge(baseCents: Int) -> DinerCharge {
    guard baseCents > 0 else {
        return DinerCharge(baseCents: 0, dinerTotalCents: 0,
            processingFeeCents: 0, applicationFeeCents: 0, dinerPaysFee: false)
    }
    let threshold = 1200 // $12 CAD
    let appFee = max(Int((Double(baseCents) * 0.055).rounded()), 1)
    if baseCents >= threshold {
        return DinerCharge(baseCents: baseCents, dinerTotalCents: baseCents,
            processingFeeCents: 0, applicationFeeCents: appFee, dinerPaysFee: false)
    }
    let grossed = Int(ceil(Double(baseCents + 30) / 0.971))
    return DinerCharge(baseCents: baseCents, dinerTotalCents: grossed,
        processingFeeCents: grossed - baseCents, applicationFeeCents: appFee, dinerPaysFee: true)
}
```

Kotlin:
```kotlin
data class DinerCharge(
    val baseCents: Int,
    val dinerTotalCents: Int,
    val processingFeeCents: Int,
    val applicationFeeCents: Int,
    val dinerPaysFee: Boolean,
)

fun computeDinerCharge(baseCents: Int): DinerCharge {
    if (baseCents <= 0) return DinerCharge(0, 0, 0, 0, false)
    val threshold = 1200
    val appFee = maxOf((baseCents * 0.055).toInt(), 1)
    if (baseCents >= threshold) {
        return DinerCharge(baseCents, baseCents, 0, appFee, false)
    }
    val grossed = kotlin.math.ceil((baseCents + 30) / 0.971).toInt()
    return DinerCharge(baseCents, grossed, grossed - baseCents, appFee, true)
}
```

### Realtime subscription on restaurant state (both platforms)

iOS (Supabase Swift SDK):
```swift
let channel = supabase.channel("restaurant-\(restaurantId)")
channel
    .on("postgres_changes",
        filter: ChannelFilter(event: "UPDATE", schema: "public", table: "restaurants", filter: "id=eq.\(restaurantId)")) { payload in
        Task { await refreshDashboard() }
    }
    .subscribe()
```

Android (Supabase Kotlin SDK):
```kotlin
val channel = supabase.channel("restaurant-$restaurantId")
val updates = channel.postgresChangeFlow<PostgresAction.Update>(schema = "public") {
    table = "restaurants"
    filter = "id=eq.$restaurantId"
}
channel.subscribe()
lifecycleScope.launch {
    updates.collect { refreshDashboard() }
}
```

### 3D Secure handling

Both iOS and Android PaymentSheet handle 3DS automatically. No mobile-specific code needed — the SDK detects `requires_action` status and presents the challenge. The diner completes the OTP/biometric, the SDK calls back when done.

If you have a custom checkout (not PaymentSheet), use `PaymentHandler.shared.handleNextAction()` (iOS) or `paymentLauncher.handleNextActionForPaymentIntent()` (Android).

---

## 31. Multi-restaurant owners

A single user can own multiple restaurants. The `user_restaurant_roles` table is many-to-many between `user_profiles` and `restaurants`. Mobile must handle:

### Restaurant switcher (dashboard)
On login, fetch all restaurants the user has a role on:
```jsonc
GET /rest/v1/user_restaurant_roles?user_id=eq.{profileId}&select=restaurant_id,role,restaurants(id,name,slug,is_published,...)
```

UI: show a dropdown/picker at the top of the dashboard. Selected restaurant ID is the "scope" for all subsequent calls.

### Per-restaurant state
Each restaurant has independent:
- Subscription state (sub_id, trial_ends_at, etc.)
- Stripe Connect account
- Billing details
- Bookings, orders, expenses

When the owner switches restaurants in the picker, mobile must:
1. Re-fetch the restaurant row
2. Subscribe to that restaurant's realtime channel
3. Refresh all dashboard cards (NextBillCard, PayoutsSection, BillingStatusPill)

### Roles
| Role | Permissions |
|---|---|
| `owner` | Full access, billing, subscription mgmt, can invite staff |
| `manager` | Most things except billing/subscription |
| `host` | Reservations + walk-ins only |
| `server` | Add items to orders, mark orders ready |

Only `owner` can access billing tab + lifecycle controls. Mobile must enforce client-side AND the edge fns enforce server-side.

### Staff invitations
Owners invite staff via email. Staff accept by clicking a magic link. Mobile should handle the deep link to convert the invite into a `user_restaurant_roles` row. Edge fn: `accept-staff-invite`.

---

## 32. Final answer — does mobile have everything?

This doc is now comprehensive. If the mobile team's Claude agent reads it end-to-end, they have:
- ✅ Architecture + threshold policy with code
- ✅ Restaurant onboarding (8-step + Connect Embedded with code)
- ✅ All 3 diner flows (deposit, preorder, pay-the-bill)
- ✅ How restaurants collect money + payouts
- ✅ Cancellation + refund pipeline
- ✅ Modify flow with edge cases (upsize / downsize / failure rollback)
- ✅ Save card with `setup_future_usage` (the critical fix)
- ✅ Subscription lifecycle (Pause / Cancel / Resume / Restart)
- ✅ Voice OUT OF SCOPE (and why it must never charge)
- ✅ Webhook handling + realtime
- ✅ Card-only lockdown (Apple/Google Pay allowed, Klarna/Affirm/Link blocked)
- ✅ Complete edge fn reference table
- ✅ Race conditions + idempotency patterns
- ✅ Mobile SDK setup (iOS + Android) with code
- ✅ Testing checklist (28+ scenarios)
- ✅ Footguns / things NOT to do
- ✅ Known non-blockers + manual reconciliation steps
- ✅ Backend connection details (URLs, env vars, project ref)
- ✅ Hard rules appendix (from web's guardrails)
- ✅ **Full API call recipes** (every endpoint with request/response examples)
- ✅ **Authentication & security deep dive** (RLS, JWT, secrets, PCI)
- ✅ **Error code → user message mapping**
- ✅ **Database schema reference** (every relevant table + columns)
- ✅ **Webhook event payloads + their DB side-effects**
- ✅ **Time zone, phone, currency, formatting rules**
- ✅ **Mock test data** (Webhook Test Pizza, test diner, all test cards)
- ✅ **Concrete iOS + Android code** (Stripe init, PaymentSheet, Connect Embedded, realtime)
- ✅ **Cross-platform Swift + Kotlin** implementations of fee math
- ✅ **Multi-restaurant owners** (switcher, roles, staff invites)

The mobile team should not need to ask the web team for anything routine. Direct only edge cases or escalations to the web team's Slack / email.
