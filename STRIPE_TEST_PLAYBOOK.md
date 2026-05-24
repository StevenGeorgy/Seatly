# Stripe + Booking Test Playbook

End-to-end test plan for Cenaiva's payment flows. Designed to be re-runnable any
time you want to validate the entire Stripe wire-up before flipping to live
mode. **Default test surface is `localhost:5173`** so you exercise the latest
unshipped code without having to push.

Last updated: 2026-05-23 (after the #77 hold-sync fix + verify_jwt fixes).

---

## Why localhost (not cenaiva.com)

Both URLs hit the same backend (production Supabase + Stripe TEST mode) — the
only difference is which JavaScript bundle the browser loads:

- **`cenaiva.com`** → bundle from the last Amplify build (whatever was last
  pushed to `main`). Use this when you want to verify what real users see.
- **`localhost:5173`** → bundle freshly compiled by Vite from current source.
  Use this when you want to verify a fix that hasn't been pushed yet.

For development + pre-launch testing, **default to localhost** so unshipped
changes get exercised before they hit prod.

---

## Pre-flight setup

### 1. Verify environment

```bash
# Dev server should be running
lsof -i :5173 | head -2

# If not running, start it:
cd /Users/savyoyaqoop/Seatly-12/apps/web && npm run dev
# Note: it serves HTTPS (https://localhost:5173), not HTTP.
```

### 2. Verify Stripe keys are in TEST mode (no real money)

```bash
grep "^STRIPE_SECRET_KEY=" .env | grep -q "sk_test_" && echo "TEST MODE ✓" || echo "⚠️ LIVE MODE — STOP"
```

### 3. Verify test restaurant is healthy

```sql
-- Cenaiva Final Test is the canonical test restaurant.
select
  id, name, is_published, deleted_at,
  stripe_charges_enabled, stripe_customer_id,
  subscription_status, deposit_tiers
from public.restaurants
where id = '1bd5a237-1f92-42ad-94fc-c58f05db81ac';
```

Expected: `is_published=true`, `stripe_charges_enabled=true`, deposit tiers
include `[{min_party_size: 4, amount_per_person_cents: 300}]`.

### 4. Stripe test cards

| Card # | Brand | Behavior |
|---|---|---|
| `4242 4242 4242 4242` | Visa | Always succeeds |
| `5555 5555 5555 4444` | Mastercard | Always succeeds |
| `4000 0027 6000 3184` | Visa | Requires 3DS |
| `4000 0000 0000 9995` | Visa | Always declines (insufficient funds) |
| Any future exp date (e.g. `12/30`) + any 3-digit CVC + any postal code | — | — |

### 5. Browser session hygiene

Use a fresh incognito/private window OR run via Playwright with
`context.clearCookies()` between tests. Avoid driving as a logged-in user
unless explicitly testing the diner-auth path — logged-in state carries
forward booking conflicts, the "Rate experience" dialog, and saved-card
pickers that complicate the matrix.

---

## Test matrix

Run each scenario from a clean session. Each entry has:
- **What to do** — UI steps
- **Verify in DB** — SQL queries to confirm
- **Verify in Stripe** — API calls or Dashboard checks
- **Cleanup** — restore state for next test

### Scenario 1 — Booking, no payment

Smoke test that bookings work without deposit or pre-order.

**What to do:**
1. Open `https://localhost:5173/cenaiva-final-test` in private window
2. Party: 2 (no deposit at this size)
3. Pick any available time slot
4. Fill diner info: name `Smoke Test`, fresh email, phone `+14165550100`
5. Continue → Continue to checkout → Place Order

**Verify in DB:**
```sql
select id, confirmation_code, status, party_size, reserved_at
from public.reservations
where guest_full_name = 'Smoke Test'
order by created_at desc limit 1;
-- Expected: status='confirmed', no deposit owed
```

**Verify in Stripe:** N/A (no payment intent created — booking only).

**Cleanup:**
```sql
-- Use cancel-reservation edge fn for real cleanup (refund pipeline runs).
-- For test scenarios with no payments, you can also flag via SQL but prefer the edge fn.
```

---

### Scenario 2 — Pre-order only (no deposit)

**What to do:**
1. Party 2, any time slot
2. On Menu step, add 1-2 menu items
3. Fill diner info, proceed to checkout
4. Verify Order Summary shows `Subtotal > 0`, `Tax (HST 13%)`, `Platform fee (5.5%)`, `Processing fee`, `Total due now`
5. Enter card `4242 4242 4242 4242` → Place Order

**Verify in DB:**
```sql
select r.id, r.status, r.party_size, o.id as order_id, o.status as order_status, o.total_amount
from public.reservations r
left join public.orders o on o.reservation_id = r.id
where r.guest_full_name = 'Smoke Test'
order by r.created_at desc limit 1;
-- Expected: reservation.status='confirmed', orders.status='paid'
```

**Verify in Stripe:**
```bash
SK=$(grep "^STRIPE_SECRET_KEY=" .env | cut -d= -f2-)
# Get PI from orders.stripe_payment_intent_id then:
curl -sS "https://api.stripe.com/v1/payment_intents/PI_ID" -u "${SK}:" | python3 -c "
import sys, json; d=json.load(sys.stdin)
print('status:', d.get('status'))
print('amount:', d.get('amount')/100, d.get('currency').upper())
print('application_fee:', d.get('application_fee_amount')/100 if d.get('application_fee_amount') else None)
print('transfer_data.destination:', (d.get('transfer_data') or {}).get('destination'))
"
# Expected: status='succeeded', amount=diner_total (grossed-up), application_fee=5.5% of base
```

**Cleanup:** Cancel + refund via `cancel-reservation` edge fn.

---

### Scenario 3 — Direct deposit only (party 4+)

This is the path most affected by the #77 fix — exercises the party-size
change → hold recreate.

**What to do:**
1. Party 2 initially → page loads with hold created at party 2
2. Open party picker → select **4 seats** (triggers #77 fix's recreate)
3. Wait 1-2 seconds — UI shows `Deposit (4 × CA$3.00) = CA$12.00`
4. Pick time slot, fill diner info
5. Continue (no pre-order on Menu step) → Continue to checkout
6. **Single payment mode** (don't toggle Split tender)
7. Enter card `4242 4242 4242 4242` → Place Order

**Verify in DB (this is the #77 verification):**
```sql
select id, party_size, status from public.reservation_holds
where guest_email = 'YOUR_TEST_EMAIL' order by created_at desc limit 3;
-- Expected: most recent hold has party_size=4 (NOT 2 — that was the bug)

select id, confirmation_code, status, party_size
from public.reservations
where guest_email = 'YOUR_TEST_EMAIL' order by created_at desc limit 1;
-- Expected: party_size=4, status='confirmed'

select id, amount_cents, status, stripe_payment_intent_id
from public.reservation_deposit_payments
where reservation_id = 'RESERVATION_ID';
-- Expected: 1 row, amount_cents=1200 (CA$12.00), status='charged'
```

**Verify in Stripe:**
```bash
# PI should be a destination charge on the restaurant's connected account
curl -sS "https://api.stripe.com/v1/payment_intents/PI_ID" -u "${SK}:" | python3 -c "
import sys, json; d=json.load(sys.stdin)
print('amount:', d.get('amount'))          # 1335 = grossed-up $13.35
print('application_fee:', d.get('application_fee_amount'))  # 66 = 5.5% of $12
print('transfer_data.destination:', (d.get('transfer_data') or {}).get('destination'))  # acct_1TaF9TJYwimTX5RW
print('metadata.deposit_payment_ids:', d.get('metadata',{}).get('deposit_payment_ids'))
"
```

**Cleanup:** `cancel-reservation` edge fn (refunds via `reverse_transfer:true`).

---

### Scenario 4 — Deposit + pre-order combined

Same as #3 but add menu items on the Menu step. Total = deposit + pre-order subtotal + HST + 5.5% fee + processing fee.

**Verify in DB:** as in #3 plus check `orders` row.
**Verify in Stripe:** PI amount should equal grossed-up total of both deposit and order.

---

### Scenario 5 — Pre-order split-tender (party 4, no deposit-tier)

Tests the split-tender backend without deposit complexity. **NOTE:** the
backend was verified working via direct API calls in earlier sessions. The
full UI fill is flaky in Playwright due to cross-origin Stripe iframes;
recommend manual driving here.

**What to do:**
1. Party 4 (deposit tier kicks in BUT skip deposit by... actually, Cenaiva Final Test always charges deposit at party 4+. Use a different restaurant or pick party 2 with menu items added.)
2. Add menu items totaling ~$50
3. On Payment step, click **Split tender** → set 2 payers
4. UI shows: $X.XX per share, 2 inline card iframes
5. Fill card 1 (`4242…`), card 2 (`5555…`)
6. Place Order

**Verify in DB:**
```sql
select id, status, party_size from public.reservations where confirmation_code = 'YOUR_CODE';
-- Expected: status='confirmed' (after BOTH payers settle via trigger)

select count(*), array_agg(status), array_agg(stripe_payment_intent_id is not null) as has_pi
from public.reservation_deposit_payments where reservation_id = 'RES_ID';
-- Expected: count=2, all status='charged', both have stripe_payment_intent_id
```

**Verify in Stripe:**
- 2 distinct PaymentIntents, each for share amount
- Both on the restaurant's connected account
- Each has 5.5% of share as application_fee

**Known issue (not blocker):** Split tender UI toggle sometimes doesn't
propagate to submit handler — order falls through to single-payment path.
Catalogued; needs investigation. If this happens, you'll see 0 rows in
`reservation_deposit_payments` and only 1 PI on Stripe.

---

### Scenario 6 — Direct deposit split-tender

Same as #5 but party 4 (forces deposit), NO menu items, split into N payers.
Total per payer = $3.00 deposit + share of 5.5% fee + share of processing fee.

---

### Scenario 7 — Pre-order + deposit split-tender (the most complex path)

Party 4, add menu items, split tender N payers. Each payer pays:
`(deposit + preorder subtotal + HST + 5.5% fee + processing fee) / N`.

**Backend special handling:** `create-public-booking` accepts
`split_tender_share_cents` to override deposit-only math when pre-order is
also being split.

---

### Scenario 8 — Cancellation + refund verification

Critical: verifies `reverse_transfer: true` debits the restaurant, NOT
Cenaiva's platform balance.

**What to do:**
1. Complete any deposit booking from above (e.g. scenario 3)
2. Call `cancel-reservation` edge fn (via "My bookings" page or curl with confirmation_code + email)
3. Note the reservation ID and PI ID before cancelling

**Verify in DB:**
```sql
select status, cancellation_reason from public.reservations where id = 'RES_ID';
-- Expected: status='cancelled'

select status from public.reservation_deposit_payments where reservation_id = 'RES_ID';
-- Expected: status='refunded' (was 'charged')
```

**Verify in Stripe:**
```bash
curl -sS "https://api.stripe.com/v1/refunds?payment_intent=PI_ID" -u "${SK}:" | python3 -c "
import sys, json; d=json.load(sys.stdin)
for r in d.get('data', []):
    print('amount:', r['amount']/100, 'status:', r['status'])
"
```

**Verify in Stripe Dashboard:**
- Restaurant's connected account balance DECREASED by the refund amount
- Cenaiva's platform balance UNCHANGED (still has the 5.5% commission)
- That's the correct accounting (`reverse_transfer:true` + `refund_application_fee:false`)

---

### Scenario 9 — Modify up (party 2 → 4, deposit charged)

**What to do:**
1. Create a party-2 reservation (no deposit at this size)
2. Open "My bookings" → modify → change party to 4
3. System detects deposit now owed → charges card on file

**Verify in DB:**
```sql
-- After modify
select id, party_size from public.reservations where confirmation_code = 'CODE';
-- Expected: party_size=4

select id, amount_cents, status, stripe_payment_intent_id
from public.reservation_deposit_payments where reservation_id = 'RES_ID';
-- Expected: 1 row, amount_cents=1200, status='charged'
```

**Note:** This is the modify-reservation path, NOT the new-booking path.
Different code path from #77.

---

### Scenario 10 — Modify down (party 4 → 2, deposit refunded)

**What to do:**
1. Create a party-4 reservation with $12 deposit charged
2. Modify → change party to 2
3. System detects no deposit owed → refunds proportionally

**Verify:** as in #8, but a `refund` for the full deposit amount.

---

### Scenario 11 — Split-tender cancellation (refund ALL payers)

Verifies that when a split-tender reservation is cancelled, EVERY payer
gets their share refunded individually — not just one of them. Critical
for trust: if a 4-person split gets one refund instead of four, three
diners are out of pocket.

**Setup:** complete scenario 5, 6, or 7 first (any split-tender variant)
with at least 2 charged `reservation_deposit_payments` rows on the same
reservation.

**What to do:**
1. Note the reservation ID + confirmation code + all N `stripe_payment_intent_id` values from `reservation_deposit_payments`
2. Cancel via `cancel-reservation` edge fn (logged-in diner → My Bookings → Cancel, OR guest path with confirmation code + email)

**Verify in DB:**
```sql
select status, cancellation_reason
from public.reservations where id = 'RES_ID';
-- Expected: status='cancelled'

select id, status, stripe_payment_intent_id, amount_cents
from public.reservation_deposit_payments
where reservation_id = 'RES_ID'
order by created_at;
-- Expected: ALL N rows status='refunded' (NOT just one)
```

**Verify in Stripe** — one refund per PI:
```bash
SK=$(grep "^STRIPE_SECRET_KEY=" .env | cut -d= -f2-)
for PI in PI_1 PI_2 PI_N; do
  echo "=== $PI ==="
  curl -sS "https://api.stripe.com/v1/refunds?payment_intent=${PI}" -u "${SK}:" | python3 -c "
import sys, json; d=json.load(sys.stdin)
for r in d.get('data', []):
    print('  amount:', r['amount']/100, 'status:', r['status'])
"
done
```

**Verify in Stripe Dashboard:**
- Restaurant connected balance decreased by `N × share base` (sum of all refund base amounts)
- Cenaiva platform balance UNCHANGED (kept 5.5% of each share as commission)
- N separate refund objects exist, one per payer's card

**Known watch-out:** if any payer's PI was 3DS-pending or in `requires_action`
state at cancel time, the refund-all loop should skip that one (nothing to
refund) without erroring out the whole cancel. Verify the loop's error
handling if you see partial refunds.

---

### Scenario 12 — Split-tender modify up (delta charged to ALL payers OR primary)

**Status: uncertain — modify-reservation's split-tender behavior needs an audit.**

The `modify-reservation` edge fn was written for the single-payer case
(`delta_cents > 0` → charge the diner's saved card for the difference). It's
not clear whether it correctly handles split-tender reservations where:
- (a) the delta should be split N ways across the original payers, or
- (b) the modifier (logged-in diner) covers the full delta on their card, or
- (c) only the primary payer's card on file gets charged

**What to do (exploratory):**
1. Complete scenario 6 or 7 first (split-tender with party 4, N payers).
2. Modify the reservation: party 4 → 6 (or any increase that triggers more deposit).
3. Observe what happens.

**Verify in DB:**
```sql
select count(*), sum(amount_cents) as total_charged_cents
from public.reservation_deposit_payments
where reservation_id = 'RES_ID' and status = 'charged';
-- Expected: total_charged_cents reflects the NEW party size's deposit
-- Open question: is there ONE new row (delta charged to primary payer's card),
--                or N new rows (delta split N ways), or N updated amounts?
```

**Verify in Stripe:**
- New PI(s) created on connected account
- Application fees correct (5.5% of base delta or each new share)

**Audit checklist — answer before declaring this scenario "tested":**
- [ ] Does modify-reservation route to the single-payer delta path when a
      split-tender booking is modified? (Likely YES — that's the implemented
      path.)
- [ ] If YES: is the diner who modified covering the full delta, or is the
      original payer (different person possibly) being charged?
- [ ] What happens if the modifier has no saved card on file? (Edge fn
      returns `modify_requires_card`; user must add a card first.)
- [ ] Does the split-tender UI in "My Bookings" allow modify operations? Or
      does the booking show as locked for modify if multi-payer?

If audit reveals split-tender + modify is unsafe, file a follow-up bug and
gate the UI to prevent modify on multi-payer bookings until fixed.

---

### Scenario 13 — Split-tender modify down (delta refunded — to whom?)

Same uncertainty as #12. When a 4-payer split-tender booking modifies down
to 2 people, the deposit owed drops — but which payers' cards get the
refund? All 4 proportionally? Just the diner who modified?

**What to do (exploratory):**
1. Complete scenario 6 or 7 first.
2. Modify reservation: party 4 → 2.

**Verify in DB:**
```sql
select id, status, amount_cents, stripe_payment_intent_id
from public.reservation_deposit_payments
where reservation_id = 'RES_ID' order by created_at;
-- Open question: do existing rows get partial refunds, or new
-- 'refunded' rows get inserted, or amounts get updated in-place?
```

**Verify in Stripe:** look for refund object(s) on the original PIs.

**Audit checklist — same outcome as #12.** Document actual behavior in this
file once observed, then convert this scenario from "exploratory" to a
concrete pass/fail check.

---

## High-risk error paths (scenarios 14-19)

### Scenario 14 — Card decline

Verifies the user gets a clear error AND the reservation doesn't get stuck
in a broken state.

**What to do:**
1. Party 4 booking with deposit (or pre-order)
2. At Payment step, enter card **`4000 0000 0000 9995`** (insufficient funds)
3. Place Order

**Verify in DB:**
```sql
select status, cancellation_reason from public.reservations where confirmation_code = 'CODE';
-- Expected: status='pending' or 'cancelled' (NOT stuck at 'pending_payment' indefinitely)

select status, failure_reason from public.reservation_deposit_payments where reservation_id = 'RES_ID';
-- Expected: row exists with status='failed' OR no row at all (if booking never committed)
```

**Verify in Stripe:**
```bash
# PI should exist in 'requires_payment_method' or 'failed' state
curl -sS "https://api.stripe.com/v1/payment_intents/PI_ID" -u "${SK}:" | python3 -c "
import sys, json; d=json.load(sys.stdin)
print('status:', d.get('status'))
print('last_payment_error.code:', (d.get('last_payment_error') or {}).get('code'))
# Expected: status='requires_payment_method', code='card_declined'
"
```

**Verify in UI:** the toast/error message should be human-readable (e.g.
"Your card was declined. Try a different card."), NOT the raw Stripe error.

**Cleanup:** if a pending reservation was created, cancel it via SQL or edge fn.

---

### Scenario 15 — 3DS / SCA challenge

Most Canadian banks require Strong Customer Authentication for ~$100+
transactions. Verifies our flow handles the popup correctly.

**What to do:**
1. Bump the booking total above $100 (party 4 + several menu items)
2. At Payment step, enter card **`4000 0027 6000 3184`** (always triggers 3DS)
3. Place Order
4. Stripe iframe should open a modal asking for verification
5. Click "Complete authentication" (the test environment lets you bypass)

**Verify in DB:**
```sql
select status from public.reservations where confirmation_code = 'CODE';
-- Expected: status='confirmed' (after 3DS completes)

select status from public.reservation_deposit_payments where reservation_id = 'RES_ID';
-- Expected: status='charged'
```

**Verify in Stripe:**
- PI status went from `requires_action` → `succeeded`
- Charge object has `three_d_secure.authenticated = true`

**Watch for:**
- Diner clicks "Fail authentication" instead → graceful error message
- 3DS popup gets blocked by browser → fallback path

---

### Scenario 16 — Partial split-tender failure (3 of 4 cards decline)

Critical: if one payer's card fails mid-flow, what happens to the others'
charges? Money stuck? Auto-refunded? Reservation stuck?

**What to do:**
1. Party 4, split tender 4 payers
2. Person 1: `4242 4242 4242 4242` (succeeds)
3. Person 2: `4242 4242 4242 4242` (succeeds)
4. Person 3: `4000 0000 0000 9995` (declines)
5. Person 4: `4242 4242 4242 4242` (succeeds)
6. Place Order

**Verify in DB:**
```sql
select id, amount_cents, status, stripe_payment_intent_id
from public.reservation_deposit_payments where reservation_id = 'RES_ID' order by created_at;
-- Open question: 4 rows? 3 charged + 1 failed? OR no rows because the whole transaction reverted?

select status from public.reservations where id = 'RES_ID';
-- Open question: 'pending_payment' (waiting for retry)? 'cancelled'? 'confirmed' if 3 of 4 enough?
```

**Verify in Stripe:**
- Check each card brand on the connected account
- If 3 PIs succeeded and the booking ultimately failed: those 3 should be REFUNDED automatically (not stranded)

**Audit checklist — answer before declaring this scenario "tested":**
- [ ] Does the UI present a per-card error on the failed iframe?
- [ ] Can the user retry just the failed iframe, or do they restart all 4?
- [ ] If user abandons → are the 3 successful PIs auto-refunded?
- [ ] Is there a timeout (e.g. 30 min) after which orphan PIs get cleaned up?

**Status: exploratory.** This is the messiest split-tender edge case. The
backend probably needs explicit error-recovery logic. File a follow-up bug
based on actual observed behavior.

---

### Scenario 17 — Subscription payment failure → auto-pause + email

Verifies the auto-pause/auto-republish lifecycle works. Real money path.

**Setup:** restaurant on `active` subscription (out of trial). To simulate
without waiting 90 days, manually trigger a subscription failure in Stripe:

**What to do:**
1. In Stripe Dashboard (test mode) → Customers → find the restaurant's
   customer → click their subscription → Actions → **Update payment method
   to test fail card** (`pm_card_chargeDeclined`) → wait for next invoice
   attempt OR manually retry the invoice
2. Stripe webhook fires `customer.subscription.updated` with status `unpaid`

**Verify in DB:**
```sql
select id, subscription_status, is_published, paused_reason
from public.restaurants where stripe_customer_id = 'cus_xxx';
-- Expected: subscription_status='unpaid' OR 'past_due', is_published=false, paused_reason='payment_failed'
```

**Verify owner notification:**
```sql
select notification_type, created_at, status
from public.restaurant_notification_log
where restaurant_id = 'RES_ID' and notification_type = 'payment_failed'
order by created_at desc limit 1;
-- Expected: row exists, status='sent'
```

**Recovery path:** swap payment method back to working card, retry invoice
in Stripe Dashboard. Webhook should fire with status='active' →
`is_published` flips back to true, `payment_recovered` email fires.

---

### Scenario 18 — Post-meal pay-the-bill (`stripe-charge-order`)

Whole separate flow from booking deposits. Diner with a saved card pays
their bill via the post-meal collect flow. Tests the Connect-aware path
(clone PM to connected account → PI on connected account).

**Setup:** logged-in diner with at least one saved card on file
(`saved_cards` table).

**What to do:**
1. Diner has an `orders` row created at the restaurant (post-meal)
2. Server/owner triggers `stripe-charge-order` via the dashboard
3. (OR diner-side: "Pay your bill" button — depends on the UI surface)

**Verify in DB:**
```sql
select id, status, paid_at, stripe_payment_intent_id, payment_method, total_amount, tip_amount
from public.orders where id = 'ORDER_ID';
-- Expected: status='paid', paid_at set, stripe_payment_intent_id set, payment_method='stripe'
```

**Verify in Stripe:**
- PI exists on the **connected account** (NOT platform — it's a Connect destination charge)
- PI amount = grossed-up diner total
- `application_fee_amount` = 5.5% of base
- Idempotency key was used (race-condition protection from Race #2 fix)

**Verify the race-condition guard:**
```bash
# Send the same charge request twice quickly. Second call should return the existing PI, not create a duplicate.
# (Hard to test from the UI; do it via API if you want to be thorough.)
```

---

### Scenario 19 — Dispute lifecycle (owner notification + DB log)

Stripe's test mode supports creating disputes via Dashboard.

**Setup:** complete any successful deposit/pre-order PI (scenarios 2, 3, 4).

**What to do:**
1. Stripe Dashboard (test mode) → find the PI on the connected account →
   click "Refunds" → actually look for "Dispute this charge" option, OR use
   the Stripe CLI: `stripe charges dispute ch_xxx`
2. Wait ~30 sec for webhook to propagate

**Verify webhook hit:**
```sql
-- Search edge fn logs for the dispute event
select * from net._http_response order by created desc limit 10;
-- Or check Stripe Dashboard → Developers → Webhooks → recent deliveries → look for charge.dispute.created
```

**Verify in DB:**
```sql
select notification_type, created_at, status
from public.restaurant_notification_log
where notification_type = 'charge_dispute_created'
order by created_at desc limit 1;
-- Expected: row exists, status='sent'
```

**Verify owner email:** check the inbox of whoever owns the restaurant —
should receive a clear email with dispute amount, reason, evidence-due
date, and a link to Stripe Dashboard.

**Close the dispute** (in Stripe Dashboard) → second webhook fires
`charge.dispute.closed` → `charge_dispute_closed` notification with outcome
(`won` / `lost` / `warning_closed`).

---

## Operational lifecycle scenarios (20-26)

### Scenario 20 — Trial → active transition (first real invoice)

Validates that the first post-trial subscription invoice generates cleanly
with HST + booking-fee aggregation rolled in.

**Setup:** restaurant on `trialing` with several booking-fee rows
accumulated as `trial_skipped`.

**What to do:**
1. In Stripe Dashboard, manually advance the test clock OR end the trial
   early (Customers → subscription → Actions → End trial now)
2. Webhook fires `customer.subscription.updated` status='active' →
   `customer.subscription.trial_will_end` already fired 3 days prior
3. First invoice generates: `$199.99 + (booking fees this period) + HST`

**Verify in DB:**
```sql
select subscription_status, trial_ends_at from public.restaurants where id = 'RES_ID';
-- Expected: status='active', trial_ends_at past

-- Newly-confirmed bookings should now flow to 'pending' → 'billed' via cron
-- (not 'trial_skipped' anymore)
```

**Verify in Stripe:** the upcoming invoice preview should show all 3 line
items with HST applied per province.

---

### Scenario 21 — Trial-ending-soon notification (7 days before)

**Setup:** restaurant with `trial_ends_at` exactly 7 days from now.

**What to do:**
1. Run the cron: `select public.cenaiva_call_cron_function('notify-trial-ending');`
2. Wait ~5 sec

**Verify in DB:**
```sql
select notification_type, status from public.restaurant_notification_log
where notification_type = 'trial_ending_soon' and restaurant_id = 'RES_ID'
order by created_at desc limit 1;
-- Expected: row exists, status='sent'
```

**Verify owner email:** received with renewal date + total they'll be charged.

---

### Scenario 22 — Restaurant deletion (soft delete + 30-day grace)

**What to do:**
1. Owner clicks Delete Restaurant
2. `delete-restaurant` edge fn fires

**Verify in DB:**
```sql
select id, deleted_at, scheduled_purge_at, is_published, subscription_status
from public.restaurants where id = 'RES_ID';
-- Expected: deleted_at = now, scheduled_purge_at = now + 30d, is_published=false
```

**Verify in Stripe:** subscription has `cancel_at_period_end=true`.

**Verify owner email:** `restaurant_deletion_scheduled` notification with 30-day deadline.

---

### Scenario 23 — Restaurant recover within grace

**Setup:** scenario 22 completed.

**What to do:**
1. Owner clicks Recover Restaurant within 30 days
2. `recover-restaurant` edge fn fires

**Verify in DB:**
```sql
select id, deleted_at, scheduled_purge_at, is_published, subscription_status
from public.restaurants where id = 'RES_ID';
-- Expected: deleted_at=NULL, scheduled_purge_at=NULL, is_published=true (back to previous)
```

**Verify in Stripe:** subscription `cancel_at_period_end=false`.

**Verify owner email:** `restaurant_restored` notification.

---

### Scenario 24 — Purge cron (30-day soft-delete expiry)

**Setup:** a deleted restaurant where `scheduled_purge_at < now()`.

**What to do:**
1. Run `select public.cenaiva_call_cron_function('purge-deleted-restaurants');`

**Verify in DB:** PII fields on `restaurants` should be anonymized; payment
FK references (subscriptions, deposit payments) preserved for CRA 7-year
retention.

**Watch for:** ANY data-leaking field that wasn't anonymized.

---

### Scenario 25 — Stale-card cleanup cron

**Setup:** unpublished restaurant with `payment_method_attached_at` >90 days old.

**What to do:**
1. Run `select public.cenaiva_call_cron_function('cleanup-stale-onboarding-cards');`

**Verify in DB:**
```sql
select payment_method_attached_at from public.restaurants where id = 'RES_ID';
-- Expected: NULL (cleared by cron)
```

**Verify in Stripe:** the saved PaymentMethod was detached from the customer.

---

### Scenario 26 — Owner-initiated subscription cancellation

Different from full restaurant deletion — owner explicitly cancels their
subscription but keeps the account.

**What to do:**
1. (TBD — depends on whether there's a UI surface for this)
2. Likely flows through Stripe Billing Portal or a dedicated edge fn

**Verify in DB:**
```sql
select subscription_status from public.restaurants where id = 'RES_ID';
-- Expected: 'canceled' or 'cancelled' depending on the enum
```

**Verify owner email:** `subscription_cancelled` notification.

**Status: exploratory** — confirm the UI surface exists before turning
this into a concrete test.

---

## Edge cases (27-32)

### Scenario 27 — Concurrent booking on the same slot

Verifies advisory locks serialize same-slot bookings correctly.

**What to do:** open two browsers, both navigate to the same restaurant +
time slot + party. Click Place Order on both within ~1 second of each other.

**Verify:** exactly ONE reservation lands; the second gets a 409 with
`unavailable_reason` (slot taken).

---

### Scenario 28 — Diner double-book guard

**What to do:** same diner (same email or same phone) books 7:00 PM at
restaurant A AND tries to book 7:30 PM at restaurant A (overlapping windows).

**Verify:** second booking rejected with `unavailable_reason: diner_double_book`.

---

### Scenario 29 — Apple Pay / Google Pay (if enabled)

**What to do:**
1. On a supported device, complete a booking with Apple Pay / Google Pay button
2. Wallet flow auto-fills card data via Stripe's Payment Request API

**Verify in Stripe:** PI's `payment_method_details` shows `apple_pay` or `google_pay`.

**Status: depends on whether wallet methods are enabled in your Stripe Connect config.**

---

### Scenario 30 — Diner saved-card add/remove

**Setup:** logged-in diner.

**What to do:**
1. Navigate to Account → Payment Methods
2. Add a card via Stripe SetupIntent flow
3. Delete the card

**Verify in DB:**
```sql
select id, stripe_payment_method_id from public.saved_cards where user_profile_id = 'PROFILE_ID';
-- Expected: row exists after add, gone after delete
```

**Verify in Stripe:** the PM was detached from the customer (NOT just deleted from our DB — verify via Stripe API that the PM is no longer attached).

This was a critical fix from the 2026-05-20 security batch — Stripe detach
MUST happen before DB delete, or the PM stays orphaned on the customer.

---

### Scenario 31 — Webhook delivery + signature verification

**Setup:** any flow that triggers a webhook (subscription update, dispute, etc.).

**Verify in Stripe Dashboard:**
- Developers → Webhooks → click your endpoint → recent deliveries
- All should show 200 OK responses
- Signature verification working (no `STRIPE_WEBHOOK_SECRET` mismatch warnings)

**Verify in Supabase edge function logs:**
- `stripe-webhook` invocations all 200
- No "Signature verification failed" entries

**Simulating retry:** Stripe Dashboard → recent delivery → "Resend" → verify
the webhook handler is idempotent (doesn't double-process).

---

### Scenario 32 — Mobile diner flow (if mobile app in scope)

**Status: mobile codebase not in this repo.** Skip unless you're testing
against a separate mobile app build.

If mobile is in scope, verify the same scenarios 1-19 work on iOS/Android,
paying particular attention to:
- `deposit_payment_ids` passed correctly on `create-public-payment-intent`
- Cart gross-up math matches web's `computeDinerCharge`
- Stripe SDK version (`STRIPE_MOBILE_SDK_VERSION = "2024-06-20"`) — keep in lock-step with `@stripe/stripe-react-native`

---

## Booking-fee cron verification (separate from matrix)

The $1/booking fee is server-side only — no UI flow. Verify by:

1. **Create a confirmed reservation** (any scenario above).
2. **Confirm the trigger seeded a fee row:**
```sql
select id, amount_cents, status from public.restaurant_booking_fees
where reservation_id = 'RES_ID';
-- Expected: 1 row, amount_cents=100, status='pending'
```

3. **Force Cenaiva Final Test to bill the fee** (it's normally in trial, where
   fees get `trial_skipped`). To test the active-billing path:
```sql
update public.restaurants set subscription_status = 'active'
where id = '1bd5a237-1f92-42ad-94fc-c58f05db81ac';

select public.cenaiva_call_cron_function('bill-booking-fees');
-- Then wait ~5 seconds
```

4. **Verify aggregation:**
```sql
select id, status, stripe_invoice_item_id, amount_cents, billed_at
from public.restaurant_booking_fees where reservation_id = 'RES_ID';
-- Expected: status='billed', stripe_invoice_item_id set, billed_at set
```

5. **Verify in Stripe:**
```bash
curl -sS "https://api.stripe.com/v1/invoiceitems/INVOICE_ITEM_ID" -u "${SK}:" | python3 -c "
import sys, json; d=json.load(sys.stdin)
print('amount:', d.get('amount')/100, d.get('currency').upper())
print('description:', d.get('description'))  # 'N confirmed bookings × \$1.00 (date range)'
print('tax_behavior:', d.get('tax_behavior'))  # 'exclusive' once Stripe Tax is enabled
print('metadata:', d.get('metadata'))
"
```

6. **Cleanup:** revert subscription_status, mark fee row cancelled, delete the Stripe invoice item:
```sql
update public.restaurants set subscription_status = 'trialing'
where id = '1bd5a237-1f92-42ad-94fc-c58f05db81ac';

update public.restaurant_booking_fees set status = 'cancelled', cancelled_at = now()
where id = 'FEE_ID';
```
```bash
curl -sS -X DELETE "https://api.stripe.com/v1/invoiceitems/INVOICE_ITEM_ID" -u "${SK}:"
```

---

## Subscription mint verification (deferred to first real owner)

We have NOT exercised the full subscription-creation flow end-to-end this
session. To test:

1. Onboard a fresh restaurant through wizard steps 1-7 (drafts page)
2. Complete Stripe Connect KYC at Step 8 (`acct_…` lands in `restaurants.stripe_account_id`)
3. Save a card (`save-subscription-payment-method` → SetupIntent on the restaurant's customer)
4. Click Publish (`publish-restaurant` → `stripe.subscriptions.create` with `automatic_tax: true`)

**Verify:**
```sql
select id, name, is_published, stripe_customer_id, stripe_subscription_id,
       subscription_status, trial_ends_at
from public.restaurants where id = 'NEW_RESTAURANT_ID';
-- Expected: stripe_subscription_id starts with 'sub_', subscription_status='trialing',
-- trial_ends_at ~90 days out
```

**Verify in Stripe:** the customer should now have a `subscription` row +
`upcoming invoice` preview showing $199.99 + tax line.

---

## Bug catalog (found in the 2026-05-23 session)

Document the bugs we found so they're not re-investigated:

### #77 — Hold-update sync (FIXED, awaiting deploy)
**Symptom:** Diner changes party size or time on the booking page; UI updates
correctly but server-side hold keeps stale `party_size`/`reserved_at`. Booking
converts using stale data — diner thinks they booked party 4 with deposit,
actual reservation lands as party 2 with no deposit.

**Root cause:** `useReservationHold.ts` had no recreate-on-param-change path.
`updateDiner` covers name/email; `updateCart` covers items; nothing covered
party/time changes. The `UpdateReservationHoldSchema` doesn't even accept
those fields — design intent is cancel-then-recreate, but client never did.

**Fix:** added `useEffect` watching `(partySize, dateTime, shiftId)`. On
drift while a hold exists, debounce 400ms → `cancelHold()` → reset
idempotency key → `createHold()`. `lastSyncedInputsRef` is seeded inside
`createHold` on success.

**File:** `apps/web/src/hooks/useReservationHold.ts`

**Verified:** localhost test produced reservation `DC3DFC5E` with party=4
after a 2→4 change (vs party=2 stuck on cenaiva.com bundle without fix).

### Hold edge fn verify_jwt (FIXED + DEPLOYED)
**Symptom:** Anonymous diners hit 401 on `create-reservation-hold`,
`update-reservation-hold`, `heartbeat-reservation-hold` → couldn't book at
all.

**Root cause:** Functions had no entry in `supabase/config.toml`, defaulting
to `verify_jwt=true`. Supabase gateway rejected requests with only an
`apikey` header (no Bearer token).

**Fix:** Added all three to `config.toml` with `verify_jwt = false`,
redeployed with `--no-verify-jwt`.

**File:** `supabase/config.toml`, plus redeploys of the 3 edge fns.

### Booking-fee `trial_skipped` constraint (FIXED)
**Symptom:** `bill-booking-fees` cron returned `failed:3, skipped:8` for
trial-period restaurants. Rows stayed `pending` forever.

**Root cause:** Cron wrote `status = 'trial_skipped'` but
`restaurant_booking_fees_status_check` only allowed
`pending|billed|failed|cancelled`. Update silently failed; counter
incremented to `failed` but row stayed pending.

**Fix:** Migration adding `trial_skipped` to the constraint enum + re-ran
cron to drain stuck rows.

### Booking-fee aggregation (SHIPPED THIS SESSION)
**Improvement, not a bug.** Each booking used to create a separate Stripe
invoice item. For a busy restaurant with 500 bookings/month that's 500 line
items on their invoice. Refactored to aggregate per (restaurant, currency,
cron run) → one line item with description `"N confirmed bookings × $1.00
(date range)"`. Also added the missing `tax_behavior: "exclusive"`
(CLAUDE.md hard rule that was being violated).

### Split-tender UI form-state coordination (KNOWN, NOT FIXED)
**Symptom:** Clicking "Split tender" toggle on Payment step shows the
split-tender UI (N iframes) but the order submission can fall through to
single-payment mode (no `split_tender_payers` field in payload).

**Status:** Backend split-tender path is solid (verified earlier via API).
Frontend handler that builds the submit payload needs investigation. Not a
launch blocker (worst case: diner pays single, manually splits later) but
worth fixing for UX.

---

## Stripe architecture summary

### Connect model: destination charges

Diner pays Cenaiva's platform Stripe account. Each PI carries:
- `transfer_data.destination = restaurant's connected account` (acct_…)
- `application_fee_amount = 5.5% of base` (Cenaiva commission)

Stripe automatically transfers the remainder to the restaurant's connected
balance.

### Fee structure

| Layer | Who pays | Where it goes |
|---|---|---|
| Base price (deposit / pre-order / order total) | Diner | Restaurant's connected balance (less 5.5%) |
| 5.5% platform commission | Diner (via gross-up) | Cenaiva's platform balance |
| Stripe processing fee (~2.9% + 30¢) | Diner (via gross-up) | Stripe |

The diner's total charged = `ceil((base + 30) / 0.971)` so restaurant nets
the full base. Computed by `_shared/stripe-fee.ts` server-side and
`apps/web/src/lib/stripe-fee.ts` for client display.

### Subscription model

- **$199.99 CAD/month** recurring subscription
- **90-day free trial** anchored to publish date (not card-capture date)
- `automatic_tax: enabled` → HST/GST computed per province from customer address
- Card saved at Step 8 of wizard via `save-subscription-payment-method`
- Subscription created at publish time via `publish-restaurant`
- `create-subscription` edge fn is **deprecated** (returns 410) — only the
  ALLOW_LEGACY env-flag path opens it

### Booking-fee model ($1 per confirmed reservation)

- Trigger seeds a `restaurant_booking_fees` row on every confirmed reservation
- Hourly cron (`bill-booking-fees`) sweeps pending rows
- During free trial: rows marked `trial_skipped` (terminal, not billed)
- During active subscription: rows aggregated per restaurant → ONE Stripe
  invoice item per cron run → rolled into next monthly subscription invoice
- Cancellations: rows in 'pending' get marked 'cancelled'; rows already
  'billed' stay billed (manual refund only)

### Refund pipeline (reverse_transfer model)

Canonical path: `_shared/stripe-refund.ts`. Always passes:
- `reverse_transfer: true` → debit from restaurant's connected balance
- `refund_application_fee: false` → Cenaiva keeps the 5.5%

Effect on cancellation:
- Diner: gets full `base` refunded
- Restaurant: balance decreased by `base`
- Cenaiva: keeps the 5.5% commission

### Dispute handling

`stripe-webhook` handles `charge.dispute.created` + `charge.dispute.closed`
with owner email notifications (`charge_dispute_created`,
`charge_dispute_closed` in `restaurant_notification_log`).

### Mode separation

- **`sk_test_…` key**: All current testing. `livemode: false` on every Stripe object.
- **`sk_live_…` key**: Live mode. NOT YET CONFIGURED. See
  `STRIPE_LIVE_MODE_CHECKLIST.md` for the 8-step migration.

---

## Live mode migration

See `STRIPE_LIVE_MODE_CHECKLIST.md` for the canonical 8-step flow:
1. Swap API keys
2. Create $199.99 CAD live Price
3. Configure both webhook endpoints (platform + connected)
4. Enable Stripe Tax for Canada
5. Connect platform settings (Express, transfers only, MCC 5812)
6. Restricted keys (optional)
7. Redeploy all Stripe-touching edge fns
8. End-to-end verification recipe

After step 8, this playbook's scenarios should be re-run against live mode
with a real bank account on a throwaway restaurant before opening to real
owners.

---

## How to re-run this playbook

1. Read the Pre-flight section, verify dev server + Stripe TEST mode + test restaurant
2. Pick scenarios to run:
   - **Smoke test** (5 min): #1 (no-pay booking) + #3 (deposit) + #8 (cancel + refund)
   - **Pre-launch full** (45 min): #1-#13 (booking, payment, split-tender, cancel, modify)
   - **High-risk pass** (30 min): #14-#19 (declines, 3DS, sub failure, post-meal pay, dispute)
   - **Operational pass** (20 min): #20-#26 (trial→active, notifications, deletion, recovery, stale-card)
   - **Edge cases** (15 min): #27-#32 (concurrency, double-book, wallets, saved cards, webhook)
3. For each: follow steps, run verification queries, clean up
4. Document any unexpected results in this file's Bug Catalog
5. If shipping to live: follow `STRIPE_LIVE_MODE_CHECKLIST.md` first, then re-run with tiny amounts

---

## Cross-references

- `STRIPE_SETUP.md` — initial Stripe dashboard config + env vars
- `STRIPE_LIVE_MODE_CHECKLIST.md` — sandbox → live migration steps
- `RACE_CONDITION_AUDIT.md` — three race conditions (all resolved as of 2026-05-23)
- `MOBILE_STRIPE_GUIDE.md` — mobile-client integration notes
- `CLAUDE.md` — hard rules for Stripe-touching code paths
