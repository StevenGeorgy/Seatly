# Stripe QA Checklist

Comprehensive manual test matrix for every Stripe-touching flow in
Cenaiva. Use after any change to `_shared/stripe-fee.ts`,
`create-public-payment-intent`, `stripe-charge-order`,
`cancel-reservation`, `refund-deposit-on-arrival`, Connect onboarding,
subscription billing, or the dashboard seat/no-show flow.

## How to use

Each test states the **action**, the **expected outcome**, and the
**verification step**. Verify every paid path against both the Stripe
dashboard AND the Supabase DB.

For every paid PaymentIntent you create:
1. Find it under Stripe → Payments → Payment Intents
2. Confirm `application_fee_amount` equals `(2% of food) + Stripe fee`
3. Confirm `on_behalf_of: null`
4. Confirm `metadata.tax_cents > 0` (when there's HST)
5. Confirm `metadata.base_amount_cents = food only`
6. Confirm `transfer_data.destination` = restaurant's `acct_...`
7. In Supabase: the `reservations` row and `orders` row both reflect
   the booking; `deposit_payment_intent_id` matches the Stripe PI.

---

## 🔴 Critical — Verify Recent Fixes

### Diner checkout flows

- [ ] **Pre-order only, party 2, logged-in, saved card**
  - Action: pick a restaurant, party 2, add menu item, use saved card
  - Expected: diner pays food + tax + 2% + Stripe gross-up
  - Verify: PI metadata shows `tax_cents > 0`, `base_amount_cents = food only`

- [ ] **Pre-order only, party 2, logged-in, one-time card**
  - Action: same as above but click "Use a different card" or enter fresh card
  - Expected: same math + "Save card for faster checkout" checkbox visible
  - Verify: card appears in `/account` payment methods after success

- [ ] **Pre-order only, party 2, GUEST (not logged in)**
  - Action: log out, place a pre-order booking
  - Expected: fresh card path, no saved-card option shown
  - Verify: no card saved after success (no `user_profile_id` to attach to)

- [ ] **Deposit only, party 3+, logged-in**
  - Action: party 3 at a restaurant with deposit tiers (nova), no menu items
  - Expected: deposit charged, no tax (deposits carry no tax)
  - Verify: PI metadata shows `tax_cents: 0`

- [ ] **Deposit only, party 3+, GUEST**
  - Action: same as above but logged out
  - Expected: works without auth
  - Verify: same as logged-in but `user_profile_id: null` on reservation

- [ ] **Pre-order + Deposit, party 3+**
  - Action: party 3+ with food selected too
  - Expected: food + tax + deposit charged together in a single PI
  - Verify: restaurant nets food + tax + deposit clean

- [ ] **Free booking** (no deposit, no preorder)
  - Action: party 2 at a restaurant with no deposit tier, no menu items
  - Expected: "No payment required" message
  - Verify: reservation created without any PI

### Cancel + refund

- [ ] **Cancel a paid booking before reservation time**
  - Action: cancel from My bookings
  - Expected: refund = food + tax only (Cenaiva 2% + Stripe fee non-refundable)
  - Verify: Stripe refund object has `reverse_transfer: true` and `refund_application_fee: false`

- [ ] **Cancel within cancel-window**
  - Expected: same as above (24h forfeit cliff was removed earlier)

- [ ] **Cancel a split-tender booking**
  - Action: cancel a booking that has 2+ deposit payers
  - Expected: all payers refunded; each gets an email
  - Verify: `notify-deposit-payers-refunded` was called; refund records on each row

### Dashboard (owner side)

- [ ] **Mark Seated within window** (1h before → 24h after `reserved_at`)
  - Action: from /dashboard/reservations, click Seated on a current reservation
  - Expected: succeeds, deposit auto-refunds to diner
  - Verify: `seated_at` stamped; `refund-deposit-on-arrival` fired

- [ ] **Mark Seated outside window**
  - Action: try to mark Seated on a reservation 2+ days in the future
  - Expected: blocked with `outside_seating_window` error
  - Verify: no `seated_at` stamp; no refund triggered

- [ ] **Force Mark Seated as owner**
  - Action: outside window, click "Force seat" on the prompt
  - Expected: succeeds + audit log entry written
  - Verify: `staff_audit_events` row with `action='reservation.seat_force_override'`

- [ ] **Force Mark Seated as host/server**
  - Action: outside window as a non-owner role
  - Expected: blocked with "Contact your manager" toast
  - Verify: no DB changes

- [ ] **Mark No-show within window**
  - Action: from reservations page, mark no-show on a current reservation
  - Expected: succeeds, deposit forfeited, **diner gets SMS + email**
  - Verify: `communication_log` row with `type='reservation_no_show'`

- [ ] **Mark No-show outside window**
  - Action: try on a future reservation
  - Expected: blocked

- [ ] **Force Mark No-show as owner**
  - Expected: succeeds + audit + diner notification
  - Verify: audit log + communication_log

- [ ] **Mark No-show twice on same reservation**
  - Action: mark no-show, then mark no-show again
  - Expected: notification does NOT re-fire (idempotent via communication_log)
  - Verify: only 1 row in communication_log with that type for that reservation

- [ ] **Mark Arrived (undo no-show)**
  - Action: click "Mark Arrived" on a no-show row
  - Expected: status flips to completed; deposit refunds to diner
  - Verify: `refund-deposit-on-arrival` fired

---

## 🟡 Modify Reservation Flows

- [ ] **Modify: increase party 2 → 4 (crosses deposit threshold)**
  - Action: modify a confirmed party-2 booking to party 4 at a restaurant where deposit kicks in at party 3
  - Expected: diner prompted to pay deposit delta; new PI for the delta only
  - Verify: only the delta charged, not full deposit

- [ ] **Modify: decrease party 4 → 2 (drops below deposit threshold)**
  - Action: modify a confirmed party-4 booking down to 2
  - Expected: partial refund of deposit slice
  - Verify: restaurant pays the refund (`reverse_transfer: true`); Cenaiva keeps proportional fee

- [ ] **Modify: increase party 4 → 6 (still over threshold, larger deposit)**
  - Action: modify party 4 to party 6
  - Expected: diner pays additional deposit ($2/person × 2 extra = $4)
  - Verify: new PI for $4 + fees

- [ ] **Modify: change date/time, same party**
  - Action: shift the reservation to a different time, party unchanged
  - Expected: NO deposit change; just slot move
  - Verify: no new PI

- [ ] **Modify: add menu items mid-flow**
  - Action: open booking, add items to cart
  - Expected: order total goes up, new PI for the delta
  - Verify: orders.total_amount reflects increase

- [ ] **Modify: remove menu items**
  - Action: remove items from order
  - Expected: partial refund of the removed items' portion
  - Verify: refund record created

---

## 🟢 Saved Card Management

- [ ] **First booking with "Save card" checked**
  - Verify: saved_cards row inserted, card visible at `/account`

- [ ] **Second booking, saved card auto-selected**
  - Verify: PI uses `saved_card_id`, off-session confirm works

- [ ] **Click "Use a different card"**
  - Verify: fresh card path, original saved card untouched

- [ ] **Delete saved card from /account**
  - Verify: Stripe detach succeeded AND DB row deleted

- [ ] **Saved card declined on retry** (e.g. card expired between bookings)
  - Verify: graceful error, prompt to add new card

---

## 🔵 Edge Cases

- [ ] **3DS card challenge**
  - Use Stripe test card `4000 0027 6000 3184`
  - Expected: `handleNextAction` modal pops up; complete challenge
  - Verify: booking succeeds after challenge

- [ ] **Card declined**
  - Use Stripe test card `4000 0000 0000 0002`
  - Expected: error message shown; no booking created
  - Verify: no reservation row; no PI succeeded

- [ ] **Apple Pay / Google Pay wallet**
  - On a supporting browser/device, use wallet on the checkout
  - Expected: works identically to card
  - Verify: same PI shape

- [ ] **Multiple rapid clicks on Place Order**
  - Action: click Place Order 5 times fast
  - Expected: only 1 PI created (dedupe guard); button shows "Processing payment..."
  - Verify: no duplicate PaymentIntents in Stripe dashboard

- [ ] **Place order → close tab during 2-5s Stripe call**
  - Expected: hold survives 15-min TTL; no orphan PI
  - Verify: no incomplete `requires_payment_method` PIs accumulating

---

## ⚪ Split Tender (multi-payer deposit)

- [ ] **Create booking with `split_tender_payers: 2`**
  - Action: invoke create-public-booking with the split flag
  - Expected: reservation in `pending_payment`, 2 `reservation_deposit_payments` rows created
  - Verify: invite emails sent to each payer

- [ ] **Both payers pay via magic links**
  - Expected: reservation flips to `confirmed` when last payment settles
  - Verify: `settle_deposit_on_charge` trigger ran

- [ ] **One payer pays, other never does**
  - Expected: reservation stays `pending_payment` until eventual cron expiry
  - Verify: paid payer's PI succeeded; unpaid one still `requires_payment_method`

- [ ] **One payer cancels mid-flow**
  - Action: cancel the reservation while only some payers have paid
  - Expected: paid payers refunded automatically
  - Verify: `notify-deposit-payers-refunded` fired with the paid payer IDs

---

## 🟣 Voice Handoff (Cenaiva AI)

- [ ] **Voice creates a hold → hands off to web**
  - Action: book via the voice assistant, follow the handoff link
  - Expected: `?hold=<id>` URL resumes the specific hold
  - Verify: same `hold_id` used through checkout

- [ ] **Voice → web → checkout completes**
  - Expected: full booking lifecycle works from voice entry

---

## 🟤 Receipt + Notification Verification

- [ ] **Confirmation SMS/email**
  - Verify: diner gets both, with confirmation code

- [ ] **No-show SMS/email**
  - Verify: diner gets both after owner marks no-show

- [ ] **Cancel refund email/SMS**
  - Verify: diner gets refund amount notification

- [ ] **Modify confirmation**
  - Verify: diner gets updated booking details

- [ ] **Stripe automatic receipt email** (compliance)
  - Verify: enabled in Stripe dashboard → Settings → Customer emails
  - If not: add receipt URL to our notification templates

---

## ❌ Not in scope yet (no UI exists)

- Post-meal pay-the-bill (`stripe-charge-order` backend ready, no UI)
- Tip handling
- International card optimization (margin shrinks; math still profits)

---

## Pending Stripe follow-ups

1. **Flip Stripe's connected-account dispute liability**
   - Today: chargebacks cost Cenaiva $15 + the disputed amount
   - Fix: flip the setting per-Connect account OR at platform level
   - Result: restaurant eats the dispute fee (industry norm)

2. **Verify subscription `automatic_tax: { enabled: true }` + `tax_behavior: "exclusive"`**
   - CLAUDE.md says these should be set on all Cenaiva-revenue Stripe operations
   - Spot-check: Stripe → Subscriptions → pick one → confirm "Automatic tax" toggle is on
   - Same check for `bill-booking-fees` invoiceItems creation

---

## Verification helpers

### Find the latest PI for a booking
```sql
SELECT
  r.confirmation_code,
  r.status,
  o.stripe_payment_intent_id,
  o.subtotal AS food,
  o.tax_amount AS tax,
  o.total_amount,
  o.status AS order_status
FROM reservations r
LEFT JOIN orders o ON o.reservation_id = r.id
WHERE r.confirmation_code = 'XXXXXXXX'
LIMIT 1;
```

### Pull the PI from Stripe
```bash
curl -s https://api.stripe.com/v1/payment_intents/pi_XXXXX \
  -u "$STRIPE_SECRET_KEY:"
```

Check:
- `amount` = diner total
- `application_fee_amount` = `cenaiva_fee + processing_fee`
- `transfer_data.destination` = restaurant's `acct_...`
- `on_behalf_of: null`
- `metadata.base_amount_cents` = food only
- `metadata.tax_cents` = tax portion (or 0 for deposits)

### Check refunds for a PI
```bash
curl -s "https://api.stripe.com/v1/refunds?payment_intent=pi_XXXXX" \
  -u "$STRIPE_SECRET_KEY:"
```

Each refund should have:
- `amount` = base only (food + tax)
- `reverse_transfer: true`
- `refund_application_fee: false`
- `metadata.cenaiva_reason` = reason string

### Audit log query (force overrides)
```sql
SELECT created_at, actor_id, action, metadata
FROM staff_audit_events
WHERE action LIKE '%force_override'
ORDER BY created_at DESC
LIMIT 20;
```

### Notification log query
```sql
SELECT sent_at, channel, type, status, restaurant_id
FROM communication_log
WHERE campaign_id = 'RESERVATION_UUID'
ORDER BY sent_at DESC;
```
