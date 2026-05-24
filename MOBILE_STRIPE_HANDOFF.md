# Mobile Stripe Handoff — What Changed + How to Test

Companion to `STRIPE_TEST_PLAYBOOK.md` (web). Covers what mobile needs to mirror
after the 2026-05-23/24 web sandbox sweep, and how to verify mobile before
flipping the mobile app to live Stripe mode.

**Audience:** mobile dev (Cenaiva diner React Native app, separate repo).
**Backend:** ALREADY DEPLOYED to prod Supabase. No mobile action needed for
backend. Read this for frontend-side parity checks.

---

## TL;DR for mobile dev

1. **Backend is in good shape.** All edge functions you call (`create-public-booking`,
   `create-public-payment-intent`, `cancel-reservation`, `confirm-deposit-paid`,
   `stripe-webhook`, the 4 hold edge fns) are deployed with the fixes.

2. **Three mobile-side patterns might need work** — see [Mirror checklist](#mirror-checklist).
   The web app had these bugs and they were fixed this session. Mobile may have
   parallel bugs in its own code.

3. **Before live:** run the 5-scenario [Mobile sandbox test pass](#mobile-sandbox-test-pass).
   Don't ship a live mobile build without it.

4. **Live flip on mobile:** ONE thing changes — the embedded publishable key.
   See [Live mode swap](#live-mode-swap).

---

## What changed this session (web side) — backend

All backend changes are deployed to prod Supabase and benefit mobile automatically.
You don't have to do anything for these; documented for awareness.

| Change | Function | Mobile impact |
|---|---|---|
| Hold edge fns `verify_jwt=false` | `create-reservation-hold`, `update-reservation-hold`, `heartbeat-reservation-hold`, `cancel-reservation-hold` | If mobile makes anonymous (no-JWT) calls to these endpoints, they now work. Previously 401. |
| Split-tender `split_tender_share_cents` support | `create-public-booking` | If mobile has split-tender UI, you can now pass `split_tender_share_cents` to override the deposit-only split (lets pre-order get split too). |
| Hold-convert path runs deposit + split-tender logic | `create-public-booking` | When a hold gets converted via `hold_id` in the booking request, deposit + split-tender rows are now created in the same atomic flow. Mobile doesn't need to make a separate call. |
| Converted hold = benign skip | `create-public-payment-intent` | If mobile sends `hold_id` for a hold that's already converted (e.g. retry), the function falls through to the deposit_payment_ids path instead of returning 409. |
| CORS allows `x-idempotency-key` | `create-public-payment-intent` | Web needed this for preflight; mobile RN fetch doesn't care about CORS, but mobile CAN send this header for idempotency. |
| Booking fees aggregate per restaurant per cron run | `bill-booking-fees` | One invoice line item per restaurant per cron cycle instead of N. Pure backend; mobile doesn't see this. |

---

## What changed this session (web side) — frontend

These changes live in `apps/web/` only. **Mobile may have parallel bugs in its
own code** that this section flags so you can check.

### 1. Hold-recreate on param change (web fix: `useReservationHold.ts`)

**Web bug:** when a diner changed party size or time slot mid-flow, the
reservation hold's `party_size` / `reserved_at` in the DB STAYED at the
original values. The booking converted using stale hold data — diner thought
they booked party=4 with $12 deposit, actual reservation lands as party=2
with no deposit.

**Web fix:** added a `useEffect` that watches `(partySize, dateTime, shiftId)`.
On drift while a hold exists: debounce 400ms → `cancelHold()` → reset
idempotency key → `createHold()` with the new params. The
`lastSyncedInputsRef` is seeded inside `createHold` on success.

**Mobile check:** does mobile's hold-lifecycle hook (likely `useReservationHold`
or similar) handle party/time changes correctly? Specifically:

```bash
# In mobile repo:
grep -rn "createHold\|cancelHold\|updateReservationHold" src/
grep -rn "party_size\|partySize\|reserved_at\|dateTime" src/hooks/
```

Look for: when the diner changes party or time, does the hook either
recreate the hold OR call an update API that successfully updates the row?

Test: book a party 2 booking, switch to party 4 mid-flow, then submit.
Verify in DB that the reservation has `party_size=4`, not 2.

### 2. No pinned `paymentMethodTypes` (web fix: `SplitTenderPaymentForm.tsx`, `StripePaymentForm.tsx`)

**Web bug:** Stripe Elements was initialized with
`paymentMethodTypes: ["card"]` but the server's PaymentIntent was created with
`automatic_payment_methods: { enabled: true, allow_redirects: "never" }`. The
mismatch caused Stripe to reject the confirm call with 400: *"Payment details
were collected through Stripe Elements using payment_method_types and cannot
be confirmed through the API configured with automatic payment methods."*

**Web fix:** REMOVED the `paymentMethodTypes: ["card"]` line. Let Stripe
Elements read the method types from the PaymentIntent itself.

**Mobile check:** does mobile's Stripe init pin a payment method type list
that conflicts with `automatic_payment_methods`? React Native uses
PaymentSheet which is configured slightly differently, but the same root
mismatch is possible.

```bash
# In mobile repo:
grep -rn "paymentMethodTypes\|payment_method_types\|allowedPaymentMethods" src/
grep -rn "initPaymentSheet\|presentPaymentSheet" src/
```

If mobile pins method types explicitly, ensure they match what the server's
PaymentIntent allows. Safer: don't pin, let RN PaymentSheet read from the
PaymentIntent.

### 3. PI metadata binding (CLAUDE.md rule, NOT a new fix — verify mobile compliance)

Not a new bug this session, but a hard rule from the 2026-05-20 security batch
that mobile MUST follow:

**Rule:** Every call to `create-public-payment-intent` for a deposit-paying PI
**MUST** include `deposit_payment_ids: [rowId]` in the request body. The
function stamps this on the PI metadata at creation, and `confirm-deposit-paid`
verifies the matching ID before flipping the row to 'charged'.

Without it, `confirm-deposit-paid` rejects with `pi_payment_id_mismatch` and
the deposit_payment row stays 'pending' forever.

```bash
# In mobile repo:
grep -rn "deposit_payment_ids\|deposit_payment_id" src/
```

Should find at minimum:
- One reference in the mobile's PaymentIntent creation call body
- One reference in any saved-card charge path

If mobile is missing this in any PI-creation path, all deposit-paying bookings
from that path will fail silently in live mode.

### 4. Stripe fee gross-up mirror (`apps/web/src/lib/stripe-fee.ts`)

Web has a client-side mirror of `computeDinerCharge()` so the cart shows the
correct grossed-up total before the diner sees the actual Stripe charge.
Without this mirror, mobile cart could display `$50.00` but the diner gets
charged `$51.95` (with 2.9%+30¢ gross-up) — confusing UX.

```bash
# In mobile repo:
grep -rn "computeDinerCharge\|stripe-fee\|processing_fee\|grossUp" src/
```

The formula (from `_shared/stripe-fee.ts`):
```ts
function computeDinerCharge(baseCents: number) {
  const dinerTotalCents = Math.ceil((baseCents + 30) / 0.971);
  const processingFeeCents = dinerTotalCents - baseCents;
  const applicationFeeCents = Math.round(baseCents * 0.055);
  return { baseCents, dinerTotalCents, processingFeeCents, applicationFeeCents };
}
```

Mobile cart should show:
- Subtotal (base)
- Tax (HST 13% — restaurant collects this, separate from processing fee)
- Platform fee (5.5% of base)
- Processing fee (the gross-up delta)
- Total due now

### 5. `stripe-detach-method` on saved-card delete (CLAUDE.md rule)

When a diner deletes a saved card, mobile MUST call `stripe-detach-method`
edge fn BEFORE deleting the DB row. Otherwise the card stays attached to
the Stripe customer and gets orphaned.

```bash
# In mobile repo:
grep -rn "stripe-detach-method\|paymentMethods.detach\|detach" src/
```

This was a 2026-05-20 fix on web. Mobile may not have it.

---

## Mirror checklist (do these BEFORE mobile sandbox testing)

For each item, grep the mobile repo. If missing, fix before testing.

- [ ] `deposit_payment_ids` passed on every `create-public-payment-intent` call body
- [ ] No pinned `paymentMethodTypes` in PaymentSheet/Elements options (or values match server)
- [ ] Hold lifecycle recreates hold when party/time/shift changes (verify by inspecting hook + manual test)
- [ ] Cart displays grossed-up total via `computeDinerCharge` mirror
- [ ] Card-delete calls `stripe-detach-method` BEFORE DB delete
- [ ] React Native Stripe SDK version compatible with `STRIPE_MOBILE_SDK_VERSION = "2024-06-20"`
  - `@stripe/stripe-react-native` package version 0.63.0 is the verified-compatible reference

---

## Mobile sandbox test pass — comprehensive (32 scenarios mirroring web)

This is the full test matrix mapped from `STRIPE_TEST_PLAYBOOK.md` to mobile.
Run ALL applicable scenarios before flipping mobile to live. Scenarios marked
N/A (mobile) don't exercise mobile-specific code — they were verified during
web testing and the same backend serves both clients.

**Minimum pre-launch pass:** M1, M3, M8, M14, M29 (booking, deposit, cancel,
decline, wallet). Catches the most common real-customer failure modes.

**Full pass:** all "Applicable" scenarios below — roughly 18 of 32.

**Recommendation:** if mobile is going live with payments, do the full pass.
If mobile is launching as read-only (browse, no booking), only the booking-
related scenarios matter.

### Pre-flight

```bash
# 1. Confirm mobile is pointing at:
#    - sk_test_… (via Supabase secrets - already verified for backend)
#    - pk_test_51TQuc8JABKj4FeJXH5BXW83BI55Ai98AOSZmqQkVW4HZE4TTcQ8Pe5xXyeTrsj0vIzynWBTeKedbI3EkwCUVFjeK002QzZnIX1
#      (live publishable key looks like pk_live_51TQuc8…)
# 2. Confirm Cenaiva Final Test restaurant is healthy:
#    `select id, stripe_charges_enabled from public.restaurants where id = '1bd5a237-1f92-42ad-94fc-c58f05db81ac';`
# 3. Stripe test cards available:
#    4242 4242 4242 4242 — Visa success
#    5555 5555 5555 4444 — Mastercard success
#    4000 0027 6000 3184 — 3DS required
#    4000 0000 0000 9995 — Decline (insufficient funds)
```

### Scenario M1 — Booking, no payment (party 2)

1. Open mobile app at Cenaiva Final Test
2. Pick a future time slot, party = 2, fill diner info
3. Submit booking
4. **Verify in DB:**
   ```sql
   select id, confirmation_code, status, party_size from public.reservations
   where guest_full_name like 'Mobile%' order by created_at desc limit 1;
   -- Expected: status='confirmed', party_size=2
   ```
5. **Verify owner email** received via Resend

### Scenario M2 — Direct deposit (party 4, $12)

This is the most important test — verifies the hold-convert + deposit +
split-tender architecture works from mobile.

1. Open app, party = 4 (Cenaiva Final Test deposit policy = $3/person at party 4+)
2. Pick a slot, fill diner info, proceed to checkout
3. Confirm UI shows: Subtotal CA$0, Deposit CA$12, Platform fee CA$0.66, Processing fee CA$0.69, **Total CA$13.35**
4. Enter card `4242 4242 4242 4242`, submit
5. **Verify in DB:**
   ```sql
   select r.status, r.party_size,
          (select count(*) from public.reservation_deposit_payments where reservation_id = r.id) as dep_rows,
          (select array_agg(status) from public.reservation_deposit_payments where reservation_id = r.id) as dep_statuses
   from public.reservations r where r.id = 'RES_ID';
   -- Expected: status='confirmed', party_size=4, dep_rows=1, dep_statuses=['charged']
   ```
6. **Verify in Stripe:**
   ```bash
   SK=sk_test_…
   curl -sS "https://api.stripe.com/v1/payment_intents/PI_ID" -u "${SK}:" | python3 -c "
   import sys, json; d=json.load(sys.stdin)
   print('amount:', d.get('amount'), '— expected 1335')
   print('app_fee:', d.get('application_fee_amount'), '— expected 66 (5.5% of base 1200)')
   print('destination:', (d.get('transfer_data') or {}).get('destination'), '— expected acct_1TaF9TJYwimTX5RW')
   print('metadata.deposit_payment_ids:', d.get('metadata',{}).get('deposit_payment_ids'), '— must be set, not None')
   "
   ```
7. **Critical assertion**: `metadata.deposit_payment_ids` MUST NOT be None.
   If None, mobile is not passing it correctly — fix before live.

### Scenario M3 — Cancel + refund

1. From Scenario M2's reservation, cancel via mobile UI (if it has one) OR
   via API:
   ```bash
   curl -sS -X POST 'https://exbjodmnpdiayfzrdyux.supabase.co/functions/v1/cancel-reservation' \
     -H "apikey: $APIKEY" -H "Content-Type: application/json" \
     -d '{"reservation_id":"RES_ID","confirmation_code":"CODE","email":"EMAIL","actor":"diner"}'
   ```
2. **Verify in DB:**
   ```sql
   select status from public.reservations where id = 'RES_ID';
   -- Expected: 'cancelled'
   select status from public.reservation_deposit_payments where reservation_id = 'RES_ID';
   -- Expected: 'refunded'
   ```
3. **Verify in Stripe** — check connected account balance:
   ```bash
   curl -sS "https://api.stripe.com/v1/balance_transactions?limit=3" \
     -u "${SK}:" -H "Stripe-Account: acct_1TaF9TJYwimTX5RW" | python3 -c "
   import sys, json; d=json.load(sys.stdin)
   for t in d.get('data',[])[:3]:
     print(f\"{t.get('type'):20s} amount={t.get('amount'):>8d}\")
   "
   # Expected: top row should be payment_refund with amount=-1200 (restaurant absorbed)
   ```

### Scenario M4 — Card decline UX

1. Try to book with card `4000 0000 0000 9995` (declines on insufficient funds)
2. **Verify mobile UI shows a clear friendly error message** to the diner,
   NOT a raw Stripe error string
3. **Verify in DB:** no stuck reservation in `pending_payment` status

This is the most important mobile UX test. If the decline produces a
silent failure or shows raw error text, fix before live.

### Scenario M5 — Modify up (if mobile has the UI)

Skip if mobile doesn't surface a modify-reservation flow.

1. Take a party-2 reservation (from M1), modify to party-4 via mobile UI
2. **Expected behavior:** if diner has no saved card, friendly error
   "Increasing your party size needs a saved card." If saved card exists,
   deposit delta gets charged.
3. **Verify in DB:**
   ```sql
   select status, party_size from public.reservations where id = 'RES_ID';
   select count(*) from public.reservation_deposit_payments where reservation_id = 'RES_ID';
   -- Expected: party_size=4. If card on file: 1 deposit row charged.
   ```

### Scenario M6 — Modify down (party 4 → 2, deposit refunded)

Skip if mobile doesn't surface modify.

1. Start with M2's party-4 reservation (still confirmed with charged deposit)
2. Modify to party-2 via mobile UI
3. **Expected:** deposit refunded (no deposit owed at party 2 < tier minimum)
4. **Verify in DB:**
   ```sql
   select party_size from public.reservations where id = 'RES_ID';
   select status, stripe_payment_intent_id from public.reservation_deposit_payments where reservation_id = 'RES_ID';
   -- Expected: party_size=2. Deposit row status='refunded'.
   ```
5. **Verify in Stripe:** refund object on the original PI

### Scenario M7 — Pre-order only (party 2 + menu items)

Skip if mobile doesn't have menu / pre-order UI.

1. Party 2 (no deposit), add 1-2 menu items
2. Verify cart shows: Subtotal, Tax (HST 13%), Platform fee (5.5%), Processing fee, Total
3. Pay with `4242 4242 4242 4242`
4. **Verify in DB:**
   ```sql
   select r.status, o.status as order_status, o.total_amount, o.stripe_payment_intent_id
   from public.reservations r
   left join public.orders o on o.reservation_id = r.id
   where r.id = 'RES_ID';
   -- Expected: reservation status='confirmed', order status='paid', PI set
   ```
5. **Verify in Stripe:** PI on connected account, application_fee = 5.5% of base

### Scenario M8 — Deposit + pre-order combined (party 4 + menu)

Skip if mobile doesn't have menu UI.

1. Party 4, add 1-2 menu items
2. Cart should show deposit ($12) + subtotal + HST + fees → single grand total
3. Submit
4. **Verify:** ONE PI for combined deposit + pre-order. Reservation status='confirmed', 1 deposit row charged, 1 order row paid, both reference the same PI.

### Scenario M9 — Pre-order split-tender (no deposit, party 2)

Skip if mobile doesn't have split-tender UI.

1. Party 2 with menu items totaling ~$50
2. Toggle to Split tender → 2 payers → each share = (subtotal + tax + fees) / 2
3. Fill 2 cards
4. Submit
5. **Verify in DB:**
   ```sql
   select count(*), array_agg(status) from public.reservation_deposit_payments where reservation_id = 'RES_ID';
   -- Expected: count=2, all 'charged'
   select status from public.reservations where id = 'RES_ID';
   -- Expected: 'confirmed' after both rows settle
   ```
6. **Verify in Stripe:** 2 distinct PIs, each with metadata.deposit_payment_ids set

### Scenario M10 — Direct deposit split-tender (party 4, $6/payer)

Skip if mobile doesn't have split-tender UI. This is the most-tested path on web.

1. Party 4, NO menu items
2. Toggle Split tender → 2 payers → $6.83/share ($6 deposit + share of fees)
3. Fill 2 cards: `4242 4242 4242 4242` + `5555 5555 5555 4444`
4. Submit
5. **Verify** as M9, plus:
   ```sql
   select dp.stripe_payment_intent_id, dp.amount_cents
   from public.reservation_deposit_payments dp
   where dp.reservation_id = 'RES_ID';
   -- Expected: 2 rows, each amount_cents=600, each with a distinct PI
   ```
6. **Stripe API verify:** each PI has correct application_fee (33 cents = 5.5% of 600 base)

### Scenario M11 — Pre-order + deposit split-tender (party 4 + menu)

Skip if mobile doesn't have combined split-tender flow.

1. Party 4 + menu items
2. Toggle Split tender → 2 payers
3. Each share = (deposit + preorder subtotal + tax + fees) / 2
4. Fill 2 cards, submit
5. **Verify:** 2 charged rows. The settle trigger should flip BOTH the reservation
   to 'confirmed' AND the order to 'paid' when the last share settles.

### Scenario M12 — Split-tender cancellation (refund ALL payers)

Skip if mobile doesn't have cancel + split-tender flow. Critical for trust.

1. Cancel any split-tender reservation from M9-M11
2. **Verify in DB:** EVERY deposit row status='refunded', not just one
3. **Verify in Stripe:**
   ```bash
   for PI in PI_1 PI_2 ... PI_N; do
     curl -sS "https://api.stripe.com/v1/refunds?payment_intent=$PI" -u "${SK}:" \
       | python3 -c "import sys,json; d=json.load(sys.stdin); print(PI, [r['amount'] for r in d.get('data',[])])"
   done
   ```
4. **Verify on connected account:** restaurant balance decreased by sum of base refunds

### Scenarios M13-M14 — Split-tender modify up / down

Same uncertainty flagged in web playbook. The modify-reservation edge fn was
written for single-payer delta — its behavior on split-tender bookings is
exploratory. Skip unless you specifically want to audit this.

### Scenario M15 — Card decline (UX critical)

1. Use card `4000 0000 0000 9995` (insufficient funds, always declines)
2. Attempt a booking
3. **Verify mobile UI:**
   - Diner sees a clear, friendly error message (e.g. "Your card was declined. Try a different card.")
   - NOT the raw Stripe error code
   - Place Order button is re-enabled to retry
4. **Verify in DB:**
   - No reservation row stuck in `pending_payment`
   - No deposit_payment row created
5. **Critical:** if mobile shows a blank screen or raw decline code, fix BEFORE live

### Scenario M16 — 3DS / SCA challenge (mobile-specific)

1. Use card `4000 0027 6000 3184` (always triggers 3DS)
2. Attempt a booking with total >$100 (some thresholds trigger 3DS only at higher amounts)
3. **Verify mobile UI:** Stripe's 3DS challenge modal opens
4. **Test deep link return:** complete the challenge → app must receive the
   return URL and continue the booking flow
5. **If diner cancels 3DS:** error displayed, no charge, no stuck reservation

**Mobile-specific gotcha:** if your URL scheme (Expo `scheme:` or native
URL Types) isn't registered correctly, the 3DS modal opens in a browser that
can't return to the app. Diner gets stuck.

```bash
# Verify mobile has URL scheme registered
grep -rn "scheme\|URL_SCHEME" app.config.ts app.json
```

### Scenario M17 — Partial split-tender failure (1 of N declines)

Critical edge case. Skip if mobile doesn't have split-tender.

1. Party 4, split into 4 payers
2. Person 1, 2, 4: `4242 4242 4242 4242` (succeed)
3. Person 3: `4000 0000 0000 9995` (decline)
4. Submit
5. **Verify mobile UI:**
   - Person 3 shows decline error
   - Other 3 rows either succeed or get auto-refunded (depending on UX choice)
   - Reservation does NOT get stuck `pending_payment` indefinitely
6. **Verify in DB:**
   - 3 rows charged + 1 failed? OR all 4 refunded? Document actual behavior.
   - **This scenario's expected behavior was never fully specified.** Whatever
     mobile does, document it.

### Scenario M18 — Subscription failure auto-pause (N/A for mobile diner)

This affects restaurant OWNERS, not diners. Backend handles it via
`stripe-webhook` → `handleSubscriptionUpsert`. Mobile diner doesn't see this.

**Skip for mobile.**

### Scenario M19 — Post-meal pay-the-bill (if mobile has this)

Skip if mobile doesn't surface the post-meal payment flow.

1. Diner has a saved card on file
2. Diner has an existing `orders` row in 'pending' status (set up by restaurant
   staff after the meal)
3. Trigger `stripe-charge-order` from mobile UI ("Pay your bill")
4. **Verify in DB:**
   ```sql
   select status, paid_at, stripe_payment_intent_id, total_amount, tip_amount
   from public.orders where id = 'ORDER_ID';
   -- Expected: status='paid', paid_at set, PI set
   ```
5. **Verify in Stripe:** PI on connected account, idempotency key used (no double-charge on retry)

### Scenario M20 — Dispute lifecycle (N/A from mobile diner)

The diner files a chargeback through their bank, not the app. The webhook
handler is verified on the backend.

**Skip for mobile.**

### Scenarios M21-M26 — Operational lifecycle (N/A for mobile)

These are owner-facing or cron-driven (trial→active, trial-ending notification,
restaurant deletion, stale-card cleanup, owner sub cancel). Mobile diner
doesn't trigger any of these.

**Skip for mobile.**

### Scenario M27 — Concurrent booking (N/A — backend gate)

Same `book_reservation` RPC + advisory lock guards both web and mobile.
Verified on web.

**Skip for mobile.**

### Scenario M28 — Diner double-book guard

Quick test to ensure the partial unique constraint also catches mobile-initiated
overlapping bookings.

1. Book a party at 7pm
2. Try to book at 7:30pm on the same restaurant (overlapping with the 90-min turn)
3. **Verify mobile UI:** clear error message "You already have a reservation at this time"

The backend RPC will raise P0006 either way — this test verifies mobile surfaces it correctly.

### Scenario M29 — Apple Pay / Google Pay (MOBILE-CRITICAL)

If mobile enables wallets in PaymentSheet config, this MUST be tested in
BOTH test mode AND a separate live-mode dry run.

#### Test mode (sandbox)

1. Open mobile on a device with Apple Pay configured (iOS) or Google Pay (Android)
2. Add a Stripe TEST card to the wallet via Stripe's PaymentSheet (test mode
   wallets allow this)
3. Book any deposit-paying reservation, choose Apple Pay / Google Pay
4. **Verify in DB:** deposit row charged
5. **Verify in Stripe:** PI's `payment_method_details.type` = `apple_pay` or `google_pay`

#### Live mode dry run

Wallets in LIVE mode require additional Stripe Dashboard setup:
- **Apple Pay:** add the merchant domain `cenaiva.com` + your Apple Merchant ID
- **Google Pay:** verify the Google Pay merchant ID

Without these, mobile Apple/Google Pay buttons either don't appear or show
"Cannot make payment" errors.

```bash
# Stripe Dashboard → Settings → Payment methods → Apple Pay → "Domains"
# Verify cenaiva.com is added (live mode)
```

If wallets aren't worth the setup investment for v1, disable them in
PaymentSheet config and ship without. Add post-launch.

### Scenario M30 — Saved card add + remove

Skip if mobile doesn't have a saved-cards screen.

1. Logged-in diner navigates to Saved Cards
2. Add a new card via PaymentSheet's "Save" flow → calls `stripe-setup-intent`
3. **Verify in DB:**
   ```sql
   select id, stripe_payment_method_id, last4, brand from public.saved_cards
   where user_profile_id = 'PROFILE_ID' order by created_at desc limit 1;
   ```
4. Delete the card
5. **Verify** the card is detached from Stripe customer:
   ```bash
   curl -sS "https://api.stripe.com/v1/customers/$CUSTOMER_ID/payment_methods?type=card" \
     -u "${SK}:" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('data',[])))"
   # Should DECREASE by 1
   ```
6. **Critical:** if the card is gone from the DB but still attached on Stripe,
   mobile is NOT calling `stripe-detach-method` first — fix before live

### Scenario M31 — Webhook delivery (N/A from mobile)

Backend-side verification. Mobile doesn't send webhooks; it receives confirmation
from edge functions which receive webhooks.

**Skip for mobile.**

### Scenario M32 — Mobile-specific deep link verification

Test that mobile's URL scheme handles all Stripe-initiated returns:

1. **3DS challenge return** — covered by M16
2. **OAuth Connect return** — only relevant if mobile has owner-side onboarding (probably N/A for diner mobile)
3. **Apple Pay completion** — usually handled by Apple's PaymentSheet without app return
4. **Magic link sign-in** — if mobile uses Supabase magic links for diner auth, verify the deep link returns to app

```bash
# Verify deep link config
grep -rn "scheme" app.config.ts app.json
cat ios/*/Info.plist | grep -A 5 CFBundleURLTypes
cat android/app/src/main/AndroidManifest.xml | grep -A 5 intent-filter
```

---

## Mobile sandbox test pass — summary table

| # | Scenario | Mobile applicability | Priority |
|---|---|---|---|
| M1 | Booking no payment | ✅ | Required |
| M2 | Direct deposit (party 4) | ✅ | Required |
| M3 | Cancel + refund | ✅ if cancel UI | Required |
| M4 | Card decline | ✅ | Required |
| M5 | Modify up | ✅ if modify UI | Recommended |
| M6 | Modify down + refund | ✅ if modify UI | Recommended |
| M7 | Pre-order only | ✅ if menu UI | Recommended |
| M8 | Deposit + pre-order | ✅ if menu UI | Recommended |
| M9 | Pre-order split-tender | ✅ if split UI | Recommended |
| M10 | Direct deposit split-tender | ✅ if split UI | Required |
| M11 | Combined split-tender | ✅ if split UI | Recommended |
| M12 | Split-tender cancel | ✅ if split UI | Required |
| M13-M14 | Split-tender modify | ⚠️ exploratory | Skip unless auditing |
| M15 | Card decline UX | ✅ | Required |
| M16 | 3DS challenge | ✅ | Required if any deposit |
| M17 | Partial split-tender fail | ✅ if split UI | Recommended |
| M18 | Sub failure → auto-pause | ❌ owner-side | Skip |
| M19 | Post-meal pay-the-bill | ✅ if surface exists | Required if surface exists |
| M20 | Dispute lifecycle | ❌ bank-side | Skip |
| M21-M26 | Operational lifecycle | ❌ owner/backend | Skip |
| M27 | Concurrent booking | ❌ backend-only | Skip |
| M28 | Diner double-book | ✅ | Recommended |
| M29 | Apple Pay / Google Pay | ✅ if wallets enabled | Required if wallets |
| M30 | Saved card add/remove | ✅ if saved-cards UI | Required if surface exists |
| M31 | Webhook delivery | ❌ backend-only | Skip |
| M32 | Deep link verification | ✅ | Required |

**Tier-1 (minimum to ship):** M1, M2, M3, M4, M15, M16, M28, M32 — 8 scenarios.

**Tier-2 (recommended before scaling):** add M5-M11, M19, M30 — total ~17 scenarios.

**Full pass (all mobile-applicable):** add M12, M17, M29 — ~20 scenarios.

---

## Live mode swap (for mobile)

Once mobile sandbox passes, flip mobile to live:

### 1. Get live publishable key

Stripe Dashboard → live mode → Developers → API keys → Standard keys →
copy "Publishable key" (starts with `pk_live_…`).

### 2. Update mobile's config

The location depends on mobile build setup. Common locations:

- `app.config.ts` / `app.json` (Expo)
- `.env.production` (RN with `react-native-dotenv` or similar)
- Native build config: `Info.plist` (iOS) / `BuildConfig` (Android)
- Hard-coded constant somewhere in `src/lib/stripe.ts` or similar

```bash
# Find current pk_test_ in mobile codebase
grep -rn "pk_test_" .
```

Swap each occurrence to the `pk_live_…` value.

### 3. Verify the secret key is NOT in mobile

Mobile must NEVER contain `sk_live_…` or `sk_test_…`. Only the publishable
key. The secret lives in Supabase secrets only.

```bash
# This should return ZERO results
grep -rn "sk_live_\|sk_test_" .
```

If anything matches, REMOVE IMMEDIATELY and rotate the key in Stripe Dashboard.

### 4. Rebuild + test on a physical device

```bash
# iOS
npx expo run:ios --device

# Android
npx expo run:android --device
```

Or build for TestFlight / Play Internal Testing if your team uses those for
pre-release verification.

### 5. Real-charge smoke test (in live mode)

1. Open the new build on your phone
2. Book a small reservation ($5-10 if possible — or the minimum your deposit
   tier allows) at a real test restaurant (you may need to onboard one
   through the web wizard with REAL bank/ID first)
3. Pay with your own real credit card
4. **Verify in Stripe live Dashboard:**
   - PI succeeded, correct application_fee (5.5% of base)
   - Money landed on the connected account
5. **Refund yourself** by cancelling the reservation
6. **Verify in live Dashboard:**
   - Refund succeeded
   - Connected account balance went down by the base amount
   - Your card was refunded

### 6. Open to volume

If steps 1-5 pass, ship to App Store / Play Store production. Monitor
Stripe Dashboard for the first few real bookings to catch anything weird
(declines, 3DS failures, fraud blocks).

---

## Specific things to double-check before live

These are mobile gotchas that aren't web gotchas:

### Apple Pay / Google Pay

If your mobile build enables PaymentSheet's wallet options (Apple Pay,
Google Pay), verify these are tested in BOTH test mode AND live mode:

- **Test mode:** wallet shows up but uses test tokens
- **Live mode:** wallet requires merchant verification (Apple Pay needs your
  Apple Pay merchant ID configured in Stripe Dashboard; Google Pay needs
  your Google Pay merchant ID)

If wallets aren't critical, you can disable them initially and add them
post-launch.

### Stripe RN SDK keep-up

If you bump `@stripe/stripe-react-native` past `0.63.0`, the underlying
Stripe API version may shift. The edge function `_shared/stripe.ts`
hardcodes `STRIPE_MOBILE_SDK_VERSION = "2024-06-20"` for the
ephemeral_keys endpoint. If those drift, mobile PaymentSheet calls fail
with "Edge function returned a non-2xx status code".

Lock the SDK version in `package.json` and bump it deliberately:

```json
"@stripe/stripe-react-native": "0.63.0"
```

Don't use `^0.63.0` or `~0.63.0` — they auto-upgrade and silently break.

### Deep links / return URLs

Stripe 3DS challenges and OAuth flows return to your app via a deep link.
Verify your mobile app's URL scheme is registered correctly:

```bash
# Expo:
grep -rn "scheme" app.config.ts app.json
```

And the corresponding native config (`Info.plist` URL Types on iOS,
`AndroidManifest.xml` intent filters on Android).

If 3DS users are stuck in Stripe's browser modal with no way back to the
app, your deep link is misconfigured.

---

## Bug catalog from web that mobile should audit for

These bugs were FIXED on web this session. Mobile may have parallel bugs
in its own codebase. Audit each:

| Web bug | What happened | Mobile audit |
|---|---|---|
| **#77 Hold-sync** (`useReservationHold.ts`) | Party-size / time change didn't persist to hold row server-side | Does mobile's hold lifecycle correctly handle param changes? |
| **Split-tender backend deploy lag** | Local file had fix, deployed version didn't | Verify mobile is calling the latest deployed edge fn (no caching) |
| **`paymentMethodTypes` pin** | Web Elements config conflicted with server's `automatic_payment_methods` | Does mobile's PaymentSheet init pin method types? |
| **`x-idempotency-key` CORS** | Web couldn't preflight; RN fetch doesn't care | N/A for mobile (RN bypasses CORS) |
| **Hold-convert path bypassed deposit logic** | Backend bug — server returned deposit_amount_cents=0 | Fixed on backend; mobile inherits. Verify booking with party=4 actually charges $12 deposit. |
| **`hold_not_convertible` 409 on already-converted holds** | Backend rejected legit retry calls | Fixed on backend; mobile inherits. |

---

## Operational handoff

- **Backend code** lives in this repo (`Seatly-12`). Mobile dev does NOT
  modify it. If mobile needs a backend change, request it from backend dev.
- **All edge fn changes** redeploy via `supabase functions deploy <name> --project-ref exbjodmnpdiayfzrdyux --use-api`.
- **Supabase secrets** can only be changed via `supabase secrets set` or
  Dashboard. Mobile doesn't have access.
- **Stripe live keys** stay in Supabase secrets (`STRIPE_SECRET_KEY`) and
  in Amplify (`VITE_STRIPE_PUBLISHABLE_KEY`) + mobile (its own `pk_live_…`).
- **Stripe Dashboard** is shared — both web and mobile transactions show up
  there. Mobile bookings will appear alongside web bookings.

---

## Open questions for mobile dev

Things I (backend/web dev) don't have visibility into:

1. **Does mobile have a split-tender UI?** If yes, audit it against the
   `SplitTenderPaymentForm.tsx` lessons (no pinned method types, deposit_payment_ids
   passed correctly).

2. **Does mobile have a modify-reservation UI?** If yes, test scenario M5.

3. **Does mobile have a saved-card management screen?** If yes, verify it
   calls `stripe-detach-method` before DB delete.

4. **Where does mobile store `pk_test_…`?** Need to know the file path so
   the live swap is precise.

5. **What's the mobile release cadence?** TestFlight + Play Internal? Or
   straight to production stores?

---

## Cross-references

- `STRIPE_TEST_PLAYBOOK.md` — full 32-scenario web test plan (most don't apply to mobile)
- `STRIPE_LIVE_MODE_CHECKLIST.md` — live mode migration steps (applies to backend; mobile inherits)
- `RACE_CONDITION_AUDIT.md` — all 3 race conditions resolved
- `CLAUDE.md` — hard rules for Stripe-touching code (applies to backend; mobile parallels)
