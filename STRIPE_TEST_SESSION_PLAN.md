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

### Phase 1 — Diner-side happy paths (build confidence)

| # | Test | Approx cost |
|---|---|---|
| 1 | **Free booking** (party 2, no preorder, no deposit) — no charge | $0 |
| 2 | **Deposit only**, party 3, no menu items — verify deposit charge + metadata | ~$2 charge → refund → ~$0.36 cost |
| 3 | **Pre-order only**, party 2, $1.25 sushi — verify food + tax + commission + Stripe gross-up | ~$1.80 → refund → ~$0.36 cost |
| 4 | **Pre-order + Deposit**, party 3 with menu items — verify combined PI | ~$8 → refund → ~$0.42 cost |
| 5 | **Guest checkout (not logged in)** — fresh card, party 2 deposit only | ~$2 → refund → ~$0.36 |

After Phase 1: confirm all PIs in Stripe dashboard show
`application_fee_amount`, `on_behalf_of: null`, correct `metadata.tax_cents`.

### Phase 2 — Modify flows

| # | Test |
|---|---|
| 6 | Modify party 2 → 4 (crosses deposit threshold) — diner pays delta |
| 7 | Modify party 4 → 2 (drops below threshold) — partial refund |
| 8 | Modify date/time, same party — no money change |
| 9 | Modify cart: add menu items mid-flow — new PI for delta |

### Phase 3 — Owner dashboard (Tab B becomes active)

| # | Test |
|---|---|
| 10 | Mark Seated WITHIN window (current reservation) — deposit auto-refunds to diner |
| 11 | Mark Seated OUTSIDE window (future reservation) — should be blocked with error |
| 12 | Force Mark Seated as owner — succeeds + audit log |
| 13 | Mark No-show WITHIN window — diner gets SMS + email, deposit forfeited |
| 14 | Mark No-show OUTSIDE window — blocked |
| 15 | Force Mark No-show as owner — succeeds + audit + diner notification |
| 16 | Mark No-show TWICE on same reservation — notification does NOT re-fire (idempotency) |
| 17 | Mark Arrived (undo no-show) — deposit refunds back |

### Phase 4 — Cancel flows

| # | Test |
|---|---|
| 18 | Cancel paid booking from diner side — verify refund routing |
| 19 | Cancel free booking (no money) |

### Phase 5 — Edge cases (optional — only if time + budget)

| # | Test |
|---|---|
| 20 | Multiple rapid Place Order clicks — only 1 PI created |
| 21 | Close tab during 2-5s Stripe call — hold survives |
| 22 | Voice handoff with `?hold=<id>` URL |

### Skipped (no UI yet)

- Post-meal pay-the-bill (`stripe-charge-order` is dormant)
- Split tender (would need to invoke via API directly)
- 3DS challenge (needs Stripe test mode — not in scope today)
- International card (needs Stripe test mode)

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

- ~17 tests in Phases 1-4
- ~$5-7 real money out of pocket (all refunded, just Stripe fees stay with Stripe)
- ~1.5-2 hours of session time
- Each test takes 5-10 min including verification

If anything looks wrong mid-session, we **stop**, debug, fix, re-test
before moving on.
