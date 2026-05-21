# Stripe Payment System — 2026-05-21 Update

Definitive reference for the Stripe + fee architecture as of the
deposit-refund-on-arrival shipment. Supersedes any earlier pricing
notes in CLAUDE.md.

---

## TL;DR

The diner now sees and pays **three line items** at checkout:

```
Deposit / order base                $X
Platform fee (5.5%)                 $Y
Processing fee (Stripe gross-up)    $Z
────────────────────────────────────
Total charged                       $X + $Y + $Z
```

On any refund (Seated, Cancel, Mark Arrived, auto-cron, modify-shrink),
the diner gets back **exactly the base** (`$X`). Both fees are
non-refundable and disclosed at checkout.

This is "Option B" — Cenaiva keeps a constant 5.5% margin per
transaction, the restaurant always nets 100% of the deposit value,
Stripe keeps its processing fee, the diner forfeits both fees on
refund (in exchange for transparency before paying).

---

## Pricing math

For a base amount `base` (in cents):

```
cenaivaFee   = ceil(base * 0.055)             // visible "Platform fee"
subtotal     = base + cenaivaFee
dinerTotal   = ceil((subtotal + 30) / 0.971)  // grossed up for Stripe
processing   = dinerTotal − subtotal          // visible "Processing fee"
applicationFee_on_PI = cenaivaFee             // routed to platform
```

### Worked examples

| Base | Platform fee | Processing fee | Diner pays | Refund |
|---|---|---|---|---|
| $5.00 | $0.28 | $0.56 | $5.84 | $5.00 |
| $10.00 | $0.55 | $0.63 | $11.18 | $10.00 |
| $20.00 | $1.10 | $0.95 | $22.05 | $20.00 |
| $40.00 | $2.20 | $1.57 | $43.77 | $40.00 |
| $80.00 | $4.40 | $2.81 | $87.21 | $80.00 |
| $100.00 | $5.50 | $3.46 | $108.96 | $100.00 |

### Cash flow on a $20 charge

```
ORIGINAL CHARGE
  Diner card debited:           $22.05
  Stripe processing fee:        −$0.95  (off the top, non-refundable)
  Application fee → Cenaiva:    −$1.10
  Restaurant Connect receives:   $20.00  ← full base

REFUND (any path)
  Refund pulled from Connect:   −$20.00
  Diner credit:                 +$20.00
  Stripe additional fee:          $0.00  (no fee on refunds)

NET PER PARTY
  Diner:      paid $22.05, got back $20.00, net −$2.05 (= fees disclosed)
  Restaurant: $20.00 received, $20.00 refunded, net $0
  Cenaiva:    +$1.10 (kept always)
  Stripe:     +$0.95 (kept always)
```

---

## File map

### Source of truth

| File | Role |
|---|---|
| `supabase/functions/_shared/stripe-fee.ts` | `computeDinerCharge(baseCents)` — fee gross-up math |
| `supabase/functions/_shared/refund-math.ts` | `computeBreakEvenRefund(baseCents)` — refund = base |
| `apps/web/src/lib/stripe-fee.ts` | Client mirror for cart preview |

### Edge functions that charge diners

| Edge fn | What it charges | Uses `computeDinerCharge` |
|---|---|---|
| `create-public-payment-intent` | Deposits, holds, pre-orders, combined deposit+order | ✓ |
| `stripe-charge-order` | Post-meal "pay the bill" | ✓ |
| `modify-reservation` | Party-size deposit delta (charge or refund) | ✓ |
| `prepare-deposit` | Split-tender row creation | ✓ |

### Edge functions that refund diners

| Edge fn | Trigger | Uses `computeBreakEvenRefund` |
|---|---|---|
| `refund-deposit-on-arrival` | Seated click · Mark Arrived click · auto-complete cron | ✓ |
| `cancel-reservation` | Diner cancel · Owner cancel (both deposit + pre-order) | ✓ |
| `modify-reservation` | Party-size shrink delta | ✓ |
| `auto-complete-stale-reservations` | Daily 5 AM UTC sweep | Calls `refund-deposit-on-arrival` |

### UI surfaces

| File | What it shows |
|---|---|
| `apps/web/src/pages/customer/RestaurantPublicPage.tsx` | Booking cart with 3 fee lines + disclosure |
| `apps/web/src/pages/customer/DepositPayPage.tsx` | Magic-link split-pay deposit checkout |
| `apps/web/src/components/booking/SplitTenderPaymentForm.tsx` | Multi-card split tender breakdown |

---

## Cart disclosure copy

Every checkout surface ends with this line (or equivalent):

> Platform and processing fees are non-refundable. Your **CA$X.XX**
> deposit is fully refundable when the restaurant marks you seated.

(Adjusted wording in DepositPayPage and SplitTenderPaymentForm for
context, but the substance is identical.)

---

## Refund policy by trigger

| Path | Trigger | Refund amount |
|---|---|---|
| Seated (owner UI) | Owner clicks "Seated" + table picker | base |
| Mark Arrived (undo no-show) | Owner clicks "Mark as arrived" on a no_show row | base |
| Auto-complete cron | Daily 5 AM UTC sweep of stale `pending`/`confirmed` past slot end | base |
| Cancel (diner) | `/find-reservation` cancel button | base |
| Cancel (owner) | Dashboard cancel button | base |
| Modify shrink (full refund) | Party size drops below deposit threshold | base × (rows that fall off) |
| Modify shrink (partial refund) | Party shrinks but still above threshold | base × (per-person rows refunded) |
| No-show | Owner clicks "No-show" | $0 — deposit forfeit |

Diner notification email (`notify-deposit-payers-refunded`) fires after
any successful deposit refund.

---

## Threshold-crossing modify behaviour (verified 2026-05-21)

| From | To | Behaviour | Verified |
|---|---|---|---|
| Party 2, no deposit | Party 4, deposit required | Charge $40 via saved card BEFORE accepting modify. If no card → 402 reject. | ✓ pi_3TZUEm... |
| Party 4, $40 charged | Party 2, no deposit | Refund full $40. | ✓ refund $40.00 |
| Party 4, $40 charged | Party 8, deposit grows | Charge delta $40 (party 4 → 8 is +4×$10). | (delta logic same as cross-threshold) |
| Party 8, $80 charged | Party 4, deposit smaller | Refund delta $40. | (delta logic same as cross-threshold) |

The pre-flight saved-card check (`modify-reservation/index.ts:369-415`)
prevents the state-mismatch bug where party size flips but charge
fails — verified 2026-05-20.

---

## Composite PI handling (deposit + pre-order in one charge)

When a hold or single-PI deposit+order is created, the PI bundles
both line items:

```
pi.amount             = deposit + preOrder + cenaivaFee + processingFee
pi.application_fee    = 5.5% of (deposit + preOrder)
```

Refunds compute the per-row refund **standalone** using
`computeBreakEvenRefund(amount_cents)`, NOT by reading `pi.amount`
or `pi.application_fee_amount` directly. This way a refund on the
deposit slice doesn't accidentally consume the pre-order budget.

---

## Auth & access patterns

| Edge fn | Caller | Auth |
|---|---|---|
| `refund-deposit-on-arrival` | Owner UI (Seated/Mark Arrived) | Bearer JWT → staff role check |
| `refund-deposit-on-arrival` | Auto-complete cron | `x-cron-secret` header |
| `cancel-reservation` | Diner via `/find-reservation` | confirmation_code match |
| `cancel-reservation` | Owner via dashboard | Bearer JWT + `actor:"owner"` + staff role |
| `modify-reservation` | Diner | confirmation_code match |
| `auto-complete-stale-reservations` | pg_cron via `cenaiva_call_cron_function` | `x-cron-secret` |

All three refund/cancel/modify fns deploy with `--no-verify-jwt`
because they accept anon-callable paths (confirmation_code) AND
authenticated paths (JWT) — gateway JWT check would block the
public flows. Per-fn auth gates are the real security boundary.

---

## Test coverage (verified 2026-05-21 against prod test mode)

| Test | Result | Stripe ref |
|---|---|---|
| **1. Pre-order only** (party 2, cart $18.99) | Cart shows 3 lines, total $23.63 | (UI) |
| **2. Deposit only** (party 4, no cart) | Cart shows 3 lines, total $43.77 | (UI) |
| **3. Pre-order + deposit** (party 4, cart $18.99) | Cart shows 3 lines, total $67.09 | (UI) |
| **4. Modify UP cross-threshold** (party 2 → 4) | Charged $43.77, $40 base, $2.20 app fee | pi_3TZUEmJABKj4FeJX0vVtNLG3 |
| **5. Modify DOWN cross-threshold** (party 4 → 2) | Refunded full $40 | re_... on pi_3TZUEm... |
| **6. Cancel** (party 2, $20 deposit) | Refunded $20 base | pi_3TZMLDJABKj4FeJX0BKfWBxy |

All math matched expected values. All Stripe API calls returned
`status: succeeded`.

---

## Mobile parity

The Cenaiva mobile app **shares this backend entirely** — every
edge function above runs against the same Supabase project
(`exbjodmnpdiayfzrdyux`). So:

- ✅ Mobile diners get the new fee structure automatically (next
  time they hit checkout, the edge fn returns the new amount).
- ✅ Mobile cancel/modify/refund flows behave identically to web.

What mobile must replicate when its checkout UI is built:

- ❌ Client-side fee preview (`apps/web/src/lib/stripe-fee.ts` mirror)
- ❌ Cart UI showing 3 line items (Deposit · Platform fee · Processing fee)
- ❌ Disclosure copy ("Platform and processing fees are non-refundable…")

Mobile is currently dormant per CLAUDE.md, so no action is needed
right now. When mobile checkout is built, port the math + UI from
the web files listed in the "UI surfaces" table above.

---

## Pricing model rejected alternatives (for future reference)

We considered and rejected:

- **Option A** (hidden Cenaiva fee, only Stripe gross-up shown) —
  diner gets refund haircut they weren't warned about → chargeback
  risk + customer trust issue.
- **Option C** (Cenaiva absorbs both fees, diner sees clean total) —
  Cenaiva margin shrinks to $0.19 per $20 deposit → not viable at
  scale, and Cenaiva loses money on small-deposit refunds.

Option B (current) was chosen for:
- Clean math at every step
- Constant 5.5% Cenaiva margin
- Restaurant always nets 100% of deposit
- Diner sees every fee upfront — no surprises on refund
- Aligns with marketplace pattern (Airbnb, Eventbrite, StubHub)

---

## What still needs building (post-launch follow-ups)

1. **Refund Policy page** (`/refund-policy`) — currently only an
   inline disclosure at checkout. Needs a standalone legal page
   linked from cart copy and footer.
2. **Terms of Service** (`/terms`) — required by Ontario CPA before
   collecting payment from real customers.
3. **Privacy Policy** (`/privacy`) — required by PIPEDA.
4. **Refund email breakdown** — when a refund fires, the diner
   notification should show: "You paid $22.05. Refunded $20.00.
   Platform fee $1.10 + Processing fee $0.95 retained."
5. **Subscription tax (HST)** — the $199.99/mo restaurant
   subscription isn't yet adding HST. Stripe Tax setup recommended
   before crossing the $30K annual revenue small-supplier threshold.
6. **Frontend Amplify deploy** — the cart UI + disclosure copy
   changes are local only. Push to main when ready.

---

*Last verified 2026-05-21 against prod project `exbjodmnpdiayfzrdyux`
(Stripe test-mode PIs).*
