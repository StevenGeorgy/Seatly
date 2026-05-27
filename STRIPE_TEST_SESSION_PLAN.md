# Stripe Test Session Plan

A guided, step-by-step Stripe QA session designed for the user (Savyo)
+ Claude to run **together, one test at a time**, with the user
present and confirming each step. NOT autonomous — Claude drives the
browser, the user watches and confirms before moving to the next test.

Companion document to `STRIPE_QA_CHECKLIST.md` (the full test matrix
reference). This file is the **session protocol**: setup, order,
math, and run-of-show.

---

## Pre-session setup (user does this once, before Claude starts)

### 1. Two separate browser contexts

| Context | Account | URL to land on | Why separate |
|---|---|---|---|
| **Tab A — regular window** | savyoyaqoop2@gmail.com (diner) | `cenaiva.com/discover` | Test the diner-side booking + payment flows |
| **Tab B — incognito window** | markhabbi2@gmail.com (Nova owner) | `cenaiva.com/dashboard/reservations` | Test the owner-side seat / no-show / refund flows |

**Why incognito for one:** the same Chrome profile shares cookies, so
two tabs would log in as the same user. Incognito has a separate
cookie jar → lets you be both diner AND owner simultaneously.

### 2. Phone ready

You'll receive real SMS to your phone for:
- Booking confirmation
- No-show notification
- Refund notification

Keep your phone handy to verify SMS arrival.

### 3. Stripe dashboard open

Open https://dashboard.stripe.com/payments in a third tab so you can
watch new PaymentIntents appear in real-time as we test.

### 4. Saved card

Savyo's diner account has a saved card (id `f172f0d6-177b-456c-9527-6107bd0cbaad`).
Each test charges ~$1, refunds immediately, net cost ~$0.34/test.

### 5. Confirm to Claude that all 3 tabs are ready

Tell Claude: "Tabs ready, let's start with test 1."

---

## Session protocol

For EACH test:

1. **Claude states** which test we're about to run + expected outcome
2. **Claude drives** the browser via Chrome MCP (you watch)
3. **Verify together:**
   - Stripe dashboard shows the new PI with expected shape
   - Supabase DB shows the right reservation status
   - Your phone gets the expected SMS (if applicable)
   - Email arrives (if applicable)
4. **Claude shows** the queried results and computed math
5. **Confirm before moving on:** Savyo says "next" or asks questions
6. **Cleanup if needed** (cancel/refund) before next test

If anything looks off, **stop**, investigate together, fix if needed,
re-test before moving on.

---

## Payment math reference (so we can verify each charge)

### Formula (verified against Stripe docs)

For a charge with `food` cents + `tax` cents:

```
cenaiva_fee     = max(round(food × 0.02), 1)             # 2% on food only
subtotal        = food + tax + cenaiva_fee
diner_total     = ceil((subtotal + 30) / 0.971)          # Stripe gross-up
processing_fee  = diner_total − subtotal
application_fee = cenaiva_fee + processing_fee           # what Stripe sees as app_fee
```

### Money flow on every paid booking

| Who | Gets |
|---|---|
| **Diner pays** | `diner_total` |
| **Restaurant nets** | `food + tax` (the "base") |
| **Cenaiva nets** | `cenaiva_fee` (after Stripe debit absorbed by app_fee) |
| **Stripe nets** | `processing_fee` (debited from Cenaiva's platform balance) |

### Worked examples

**$3 sushi + 13% HST (Ontario):**
- food = 300, tax = 39
- cenaiva_fee = max(round(300 × 0.02), 1) = 6¢
- subtotal = 300 + 39 + 6 = 345¢
- diner_total = ceil((345 + 30) / 0.971) = 387¢ = **$3.87**
- processing_fee = 387 − 345 = 42¢
- application_fee = 6 + 42 = 48¢
- Restaurant nets: $3.39 ✓
- Cenaiva nets: $0.06 ✓

**$20 deposit only (party 3+, no preorder, no tax):**
- food = 2000, tax = 0
- cenaiva_fee = 40¢
- subtotal = 2040¢
- diner_total = ceil((2040 + 30) / 0.971) = 2133¢ = **$21.33**
- processing_fee = 93¢
- application_fee = 133¢
- Restaurant nets: $20.00
- Cenaiva nets: $0.40

### On refund (cancel / mark seated)

- Diner gets back: `food + tax` (the base)
- Cenaiva keeps: `application_fee` ($0.48 in the $3 example) — the disclosed-non-refundable fees
- Restaurant pays back: `food + tax` via `reverse_transfer: true`
- Stripe doesn't refund its processing fee
- Net Cenaiva: +`cenaiva_fee` (the commission portion of app_fee stays with platform)

---

## What we solved today (context for what each test is verifying)

### Major fixes shipped (12 PRs)

1. **PR #9: Hold race fix** — `client_token` + tombstone, no more false-positive diner_double_book
2. **PR #10: Grab-again pre-cancel** — stale expired hold no longer blocks re-attempts
3. **PR #11: Place Order Stripe billing-fields** — silent IntegrationError fixed, Place Order actually charges now
4. **PR #12: Dedupe Place Order clicks** — 5 rapid clicks no longer creates 5 PaymentIntents
5. **PR #13: Processing spinner** — button greys out + shows "Processing payment..."
6. **PR #14: Initial fee fix attempt (WRONG)** — added `on_behalf_of`, broke Nova checkout
7. **PR #15: Account-scoped 15-min hold** — multi-tab sync, refresh preserves hold, no more cancel-on-unmount
8. **PR #16: Pick-different-time button** — was dead, now wired to slot picker
9. **PR #17: Correct fee fix** — removed `on_behalf_of`, 2% on food only, `application_fee_amount = cenaiva + processing`
10. **PR #18: amount_mismatch hotfix** — server validates `(food + tax) === total` instead of strict equality
11. **PR #19: Seat/no-show time-window guard + diner notification** — 1h-before/24h-after window, force override for owner/manager, no-show SMS+email to diner
12. **PR #20: This QA checklist** (`STRIPE_QA_CHECKLIST.md`)

### Lessons learned (will inform our testing)

- **Stripe docs are authoritative.** Claude was confidently wrong about `on_behalf_of` shifting fee responsibility. Verified later: it doesn't. **Rule: always cross-check Stripe behavior against docs.**
- **Destination charges always make platform pay Stripe fees.** The only way to make Cenaiva profit cleanly is `application_fee_amount = cenaiva + processing` (absorbs the debit).
- **2% commission is on food only, not (food + tax).** Tax is government money, not restaurant revenue.
- **Hold survives navigation now.** 15-min server-side TTL, multi-tab syncs via P0006 recovery.
- **Owner can't no-show outside window** without force override (audit-logged).

---

## Test execution order (escalate complexity)

We'll go in this order — simplest → most complex. Each row is one
test session. **Don't skip ahead.**

### Phase 1 — Diner-side happy paths (LOGGED IN — savyoyaqoop2)

| # | Test | Approx cost |
|---|---|---|
| 1 | **Free booking** (party 2, no preorder, no deposit) — no charge | $0 |
| 2 | **Deposit only**, party 3, no menu items — verify deposit charge + metadata | ~$2 charge → refund → ~$0.36 cost |
| 3 | **Pre-order only**, party 2, $1.25 sushi — verify food + tax + commission + Stripe gross-up | ~$1.80 → refund → ~$0.36 cost |
| 4 | **Pre-order + Deposit**, party 3 with menu items — verify combined PI | ~$8 → refund → ~$0.42 cost |

After Phase 1: confirm all PIs in Stripe dashboard show
`application_fee_amount`, `on_behalf_of: null`, correct `metadata.tax_cents`.
Also confirm SMS + email arrived for each (see Notification Verification section below).

### Phase 1B — Guest checkout (NOT logged in)

Sign out of savyoyaqoop2 OR open a fresh incognito window with no
session. Test the SAME 4 scenarios as guest — different code paths
(no saved-card option, no user_profile_id, identity attached via
email/phone only).

| # | Test | What's different from logged-in |
|---|---|---|
| 5 | **Guest free booking** | No "save card" anything; reservation has `user_profile_id: null`, identity via guest_email/guest_phone |
| 6 | **Guest deposit only**, party 3 | Fresh card path mandatory (no saved-card picker shown). Reservation row uses guest_email. |
| 7 | **Guest pre-order only**, party 2 | Same — verify metadata.tax_cents still works for guests |
| 8 | **Guest pre-order + deposit**, party 3 | Combined PI, identity via guest fields |

Per-test verification specific to guest paths:
- ✓ The booking page does NOT show the "Use saved card" picker
- ✓ The "Save card for faster checkout" checkbox is HIDDEN (only shown to logged-in diners)
- ✓ DB: `reservations.user_profile_id IS NULL`, `guest_email` + `guest_phone` populated
- ✓ Stripe PI: `customer: null` (no Stripe customer created for guests)
- ✓ Confirmation SMS + email still arrive to the guest's contact info
- ✓ The guest can find/manage their booking via `/find-reservation` (confirmation code lookup)

### Phase 2 — Modify flows (mix of logged-in + guest)

| # | Test | Mode |
|---|---|---|
| 9 | Modify party 2 → 4 (crosses deposit threshold) — diner pays delta | Logged-in |
| 10 | Modify party 4 → 2 (drops below threshold) — partial refund | Logged-in |
| 11 | Modify date/time, same party — no money change | Logged-in |
| 12 | Modify cart: add menu items mid-flow — new PI for delta | Logged-in |
| 13 | Guest modify via /find-reservation lookup — same as #9 but as guest | **Guest** |

### Phase 3 — Owner dashboard (Tab B becomes active)

| # | Test |
|---|---|
| 14 | Mark Seated WITHIN window (current reservation) — deposit auto-refunds to diner |
| 15 | Mark Seated OUTSIDE window (future reservation) — should be blocked with error |
| 16 | Force Mark Seated as owner — succeeds + audit log |
| 17 | Mark No-show WITHIN window for LOGGED-IN diner — SMS + email arrive, deposit forfeited |
| 18 | Mark No-show WITHIN window for **GUEST** diner — SMS + email arrive at guest contact info |
| 19 | Mark No-show OUTSIDE window — blocked |
| 20 | Force Mark No-show as owner — succeeds + audit + diner notification |
| 21 | Mark No-show TWICE on same reservation — notification does NOT re-fire (idempotency) |
| 22 | Mark Arrived (undo no-show) — deposit refunds back |

### Phase 4 — Cancel flows

| # | Test | Mode |
|---|---|---|
| 23 | Cancel paid booking from diner side — verify refund routing | Logged-in |
| 24 | Cancel paid GUEST booking via /find-reservation — verify refund + notification | **Guest** |
| 25 | Cancel free booking (no money) | Either |

### Phase 5 — Edge cases (optional — only if time + budget)

| # | Test |
|---|---|
| 26 | Multiple rapid Place Order clicks — only 1 PI created |
| 27 | Close tab during 2-5s Stripe call — hold survives |
| 28 | Voice handoff with `?hold=<id>` URL |

### Phase 6 — Stripe dashboard configuration checks (settle the standing reminders)

These are dashboard-only — no real money moved, no diner involved. Tab C in your Stripe dashboard.

#### Test 29 — Verify subscription `automatic_tax` enabled
**Action:**
1. Stripe dashboard → **Billing → Subscriptions**
2. Pick any active restaurant subscription (e.g. nova ristorante or Mark Testing at $199.99/mo)
3. Look in the right sidebar / details panel for "Automatic tax"
4. Confirm toggle is **ON**

**Expected:** Toggle shows "Stripe Tax — Enabled". HST/GST line itemized on the invoice.

**If OFF:**
- Click toggle to enable + customer address must include postal code
- Code follow-up needed: edit `publish-restaurant` edge fn to pass `automatic_tax: { enabled: true }` on `stripe.subscriptions.create()` so all FUTURE subscriptions get it automatically
- For existing subs: each one needs the toggle flipped manually (Stripe API supports batch update if many)

**Verify same on `bill-booking-fees` invoice items:**
- Stripe → Billing → Invoices → open any monthly invoice for a restaurant with booking fees
- Click into a `Booking fee` line item
- Look at "Tax behavior" — should show `exclusive`
- If shows `unspecified` or `inclusive`: update `bill-booking-fees` edge fn to add `tax_behavior: "exclusive"` to `stripe.invoiceItems.create()`

#### Test 30 — Flip dispute liability onto restaurants (the big chargeback fix)
**Action:**
1. Stripe dashboard → **Connect** → **Settings** → **Risk & disputes** (path may vary by Stripe version)
2. Look for "Dispute liability" — currently shows **Platform** (Cenaiva)
3. Decide if you're ready to flip (industry norm: yes — restaurants control the experience that causes disputes)
4. If flipping: toggle to **Connected account** → save

**Verify it works:**
1. Find any recent successful PI from a Connect account (e.g. one of today's test charges to nova)
2. Stripe dashboard → that PI → click **⋯** (more menu) → **Simulate dispute** (test mode only — in live mode you'd need to wait for a real dispute)
3. Confirm the $15 dispute fee shows up on the **connected account's balance**, NOT Cenaiva's platform balance

**Expected:** Dispute reverses the original transfer from the restaurant + debits $15 from the restaurant's pending balance. Cenaiva's platform balance untouched.

**If flipping breaks something:**
- Most likely scenario: restaurants need to acknowledge the new dispute liability in their onboarding terms. Update Stripe Connect application terms to disclose this clearly.
- Worst-case: revert the toggle (Stripe lets you flip it back); Cenaiva absorbs disputes until terms are updated.

**Why this matters (math):** Every dispute = $15 to whoever's liable. If you process 1,000 bookings/month with 1% dispute rate = 10 disputes/month. On Cenaiva: −$150/mo loss. On restaurants: each restaurant only sees disputes from their own diners (typically 0-2/mo), so it's a small cost-of-business they accept.

### Skipped (no UI yet)

- Post-meal pay-the-bill (`stripe-charge-order` is dormant)
- Split tender (would need to invoke via API directly)
- 3DS challenge (needs Stripe test mode — not in scope today)
- International card (needs Stripe test mode)

---

## Notification verification (SMS + email content checks)

**For EVERY test that triggers a notification, we will verify all of:**
1. The SMS actually arrives on your phone (within 30 sec typically)
2. The email actually arrives in the inbox (within 1-2 min)
3. The CONTENT shows the correct figures + restaurant + confirmation code
4. The `communication_log` table has the row with `status='sent'`

### What each notification should say

#### 📩 Booking confirmation (every successful paid or free booking)

**Trigger:** reservation created (paid or free)

**SMS content to verify:**
- Restaurant name matches the one booked (e.g. "nova ristorante")
- Date + time matches the booked slot (in restaurant's timezone)
- Party size matches
- Confirmation code (8 hex chars) appears
- If deposit paid: "Deposit paid: $X.XX" line shows the BASE amount (food + tax for preorder, OR just deposit value for deposit-only)

**Email content to verify:**
- Subject includes restaurant name
- All the above details
- "Manage reservation" link works (clicking opens `/find-reservation` or `/booking/:code`)

**Where it sends:**
- Logged-in: `user_profiles.email` + `user_profiles.phone`
- Guest: the email + phone the diner typed in the booking form

---

#### 🚫 No-show notification (NEW — shipped today)

**Trigger:** owner marks reservation as no-show

**SMS content to verify (under 160 chars):**
> "Hi {firstName}, your reservation at {restaurantName} was marked no-show. Deposit was kept per restaurant policy. If incorrect, contact {restaurantPhone}."

Verify:
- First name matches diner's name from booking
- Restaurant name correct
- Restaurant phone is the actual contact phone (not a Cenaiva number)
- Message arrives within 60 sec of owner clicking No-show

**Email content to verify:**
- Subject: "Your {restaurantName} reservation"
- States the date/time of the marked-no-show reservation
- Shows the deposit amount that was kept (e.g. "$6.00")
- Confirmation code present
- Instructs to contact restaurant within 48 hours if incorrect
- Restaurant address + phone

**Idempotency check (Test #21):**
- Mark no-show → SMS + email arrive → record in `communication_log`
- Click No-show again on same reservation → NO new SMS, NO new email
- `communication_log` should still have only ONE row per channel for that reservation

---

#### 💸 Cancel / refund notification

**Trigger:** diner cancels reservation (or owner cancels)

**SMS content to verify:**
- Restaurant name
- Reservation date/time
- Refund amount shown = food + tax (the "base" — NOT the diner total, since fees are non-refundable)
- Confirmation code

**Email content to verify:**
- Subject mentions cancellation
- Refund breakdown: "Refunded: $X.XX (Cenaiva 2% fee + Stripe processing fee are non-refundable, as disclosed at checkout)"
- If split-tender: each payer gets their own email with their share

---

#### 🔄 Modify notification

**Trigger:** diner modifies reservation (party / time / cart)

**SMS/email content to verify:**
- New date/time/party (updated values)
- If payment changed: "You were charged an additional $X" or "Refund of $X issued"
- Confirmation code unchanged

---

#### 🪑 Mark-seated notification

**Trigger:** owner marks reservation as seated

**Diner-facing:** No SMS or email currently fires on seated (the deposit refund is silent — diner sees the refund on their card statement only).

**This is by design** — seating is a positive event; we don't spam diners with "you've been seated" messages. The refund hits their card with the standard Stripe descriptor.

---

### How to verify content during the session

For each test that involves a notification:

1. **Run the test** (e.g. mark no-show)
2. **Check your phone** — does the SMS arrive? Is the content correct?
3. **Check the email inbox** for savyoyaqoop2@gmail.com — does the email arrive?
4. **Claude queries communication_log** to confirm both rows inserted with `status='sent'`
5. **Read the message back to Claude** if anything looks off, so we can spot bugs in the template

For GUEST tests, the SMS/email goes to whatever contact info you typed into the booking form. Use a contact info you can also check (e.g. same phone, different fake guest email like savyo+guest@gmail.com).

---

## Verification commands (Claude will run these for each test)

### Find the latest PI for a confirmation code
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
WHERE r.confirmation_code = 'XXXXXXXX';
```

### Pull the PI from Stripe
```bash
curl -s https://api.stripe.com/v1/payment_intents/pi_XXXXX -u "$STRIPE_SECRET_KEY:"
```

Check each PI for:
- ✓ `amount` matches calculated `diner_total`
- ✓ `application_fee_amount` matches calculated `cenaiva_fee + processing_fee`
- ✓ `on_behalf_of: null`
- ✓ `transfer_data.destination` = restaurant's `acct_...`
- ✓ `metadata.base_amount_cents` = food (NOT food + tax)
- ✓ `metadata.tax_cents` = tax portion (0 for deposit-only)

### Find refunds for a PI
```bash
curl -s "https://api.stripe.com/v1/refunds?payment_intent=pi_XXXXX" -u "$STRIPE_SECRET_KEY:"
```

Each refund should have:
- ✓ `amount` = food + tax (the "base")
- ✓ `reverse_transfer: true`
- ✓ `refund_application_fee: false`

### Audit log (for force overrides)
```sql
SELECT created_at, actor_id, action, metadata
FROM staff_audit_events
WHERE action LIKE '%force_override%'
ORDER BY created_at DESC LIMIT 10;
```

### Notification log (for no-show notification idempotency)
```sql
SELECT sent_at, channel, type, status
FROM communication_log
WHERE campaign_id = 'RESERVATION_UUID'
ORDER BY sent_at DESC;
```

---

## Pending reminders (still nagging — DO NOT STOP)

1. **Flip Stripe's connected-account dispute liability**
   - Today: chargebacks cost Cenaiva $15 + the disputed amount
   - Fix: one Stripe dashboard toggle per Connect account OR at platform level
   - Result: restaurant eats the $15 dispute fee
   - Industry norm (DoorDash, Uber Eats, Airbnb)

2. **Verify subscription `automatic_tax: { enabled: true }` + `tax_behavior: "exclusive"`**
   - CLAUDE.md says these should be set on all Cenaiva-revenue Stripe operations
   - Spot-check: Stripe → Subscriptions → pick one → confirm "Automatic tax" toggle is on
   - Same check for `bill-booking-fees` invoiceItems creation

---

## Total session estimate

- **27 tests** across Phases 1–6 (25 booking flows + 2 Stripe dashboard configs)
- **~$8–12** real money out of pocket (all refunded; Stripe processing fees stay)
- **~2.5–3 hours** of session time
- Each booking test takes 5–10 min; dashboard checks ~5 min each
- Phase 6 (dashboard configs) is dashboard-only, $0 cost

If anything looks wrong mid-session, we **stop**, debug, fix, re-test
before moving on.

### Guest-test contact info suggestion

For guest tests, use a contact you can also check:
- **Email:** `savyoyaqoop+guest@gmail.com` (Gmail "+" trick — same inbox)
- **Phone:** your number — works for verifying SMS delivery

This way you can see notifications arrive at the "guest" contact while
also being able to read them.
