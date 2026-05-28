# Stripe Test Session Plan

A guided, step-by-step Stripe QA session designed for the user (Savyo)
+ Claude to run **together, one test at a time**, with the user
present and confirming each step. NOT autonomous — Claude drives the
browser, the user watches and confirms before moving to the next test.

**Last updated:** 2026-05-28 after PR-K (split-tender parity). All
split-tender scenarios are now in scope and MUST be tested end-to-end.

Companion document to `STRIPE_QA_CHECKLIST.md` (the full test matrix
reference). This file is the **session protocol**: setup, order,
math, and run-of-show.

---

## Hard QA rules (added 2026-05-28 — do NOT skip these)

These four rules are mirrored from `CLAUDE.md` so they live where the
test session is run. Same intent: catch regressions and verification
gaps before they ship.

1. **No partial fixes.** A "partial pass" is a failure. If a test
   surfaces ANY bug — silent refund skip, missing notification,
   wrong amount, `paid_at` null where it should be set — the bug
   gets fixed AND the test gets re-run end-to-end against the new
   deployed code before moving to the next test. Do not write
   "works mostly", "edge case is rare", or "defer to a follow-up
   PR" in a test result.

2. **Bug found → fix → retest broken test → retest ALL previous
   tests in this session.** A shared-helper change can silently
   break a passed test (e.g. today's `hold-conversion.ts` fix
   landed in `confirm-hold-paid` but `stripe-webhook` still ran
   the stale bundle until I redeployed it). After every fix,
   re-run every test that already passed in this session before
   moving forward.

3. **Verify Stripe API directly, not just the DB row.** Every
   charge/refund test gets two checks: (a) Supabase row reflects
   the expected state (`orders.status='paid'`, `paid_at` set,
   `stripe_payment_intent_id` populated, `reservation_deposit_payments.
   status='charged'`), AND (b) Stripe API (`list_payment_intents`,
   `list_refunds`, `retrieve`) confirms the PI/charge/refund exists
   with the expected amount, status, and metadata. The DB row only
   reflects what the webhook landed — a delayed/mis-routed webhook
   can leave the DB looking correct while Stripe shows something
   else.

4. **Fan out sub-agents in parallel where possible.** When multiple
   independent verifications exist (DB query + Stripe API + edge
   function logs + console messages), launch them in PARALLEL via a
   single message with multiple tool calls, not sequentially. The
   default mistake is to chain them.

---

## Pre-session setup (user does this once, before Claude starts)

### 1. Three separate browser contexts

| Context | Account | URL to land on | Why separate |
|---|---|---|---|
| **Tab A — regular window** | savyoyaqoop2@gmail.com (diner) | `cenaiva.com/discover` | Test the diner-side booking + payment flows |
| **Tab B — incognito window** | markhabbi2@gmail.com (Nova owner) | `cenaiva.com/dashboard/reservations` | Test the owner-side seat / no-show / refund flows + verify dashboard breakdown |
| **Tab C — Stripe dashboard** | Stripe live mode | `https://dashboard.stripe.com/payments` | Watch new PaymentIntents appear in real-time |

**Why incognito for one:** the same Chrome profile shares cookies, so
two tabs would log in as the same user. Incognito has a separate
cookie jar → lets you be both diner AND owner simultaneously.

### 2. Phone + email ready

You'll receive real SMS to your phone for:
- Booking confirmation
- Modify confirmation
- No-show notification
- Cancel + refund notification
- Split-tender per-card refund summary

Keep your phone handy to verify SMS arrival. Same for email at
savyoyaqoop2@gmail.com (and `savyoyaqoop+guest@gmail.com` for guest
tests — Gmail "+" trick routes to the same inbox).

### 3. Saved cards on the diner profile

Savyo's diner account should have at least one saved card. For
split-tender tests we'll enter 2-3 fresh card numbers per test (Stripe
test cards are fine if running in test mode; in live mode use real
cards). Each test charges ~$1–8 total, refunds immediately, net cost
~$0.34–$0.84/test (Stripe fees stay).

### 4. Confirm to Claude that all 3 tabs are ready

Tell Claude: "Tabs ready, let's start with test 1."

---

## Session protocol

For EACH test:

1. **Claude states** which test we're about to run + expected outcome
2. **Claude drives** the browser via Chrome MCP (you watch)
3. **Verify together:**
   - Stripe dashboard shows the new PI(s) with expected shape
   - Supabase DB shows the right reservation + RDP row statuses
   - Your phone gets the expected SMS (if applicable)
   - Email arrives (if applicable)
   - Owner dashboard reflects the new state (badges + detail dialog)
4. **Claude shows** the queried results and computed math
5. **Confirm before moving on:** Savyo says "next" or asks questions
6. **Cleanup if needed** (cancel/refund) before next test

If anything looks off, **stop**, investigate together, fix if needed,
re-test before moving on.

### 🚨 NON-NEGOTIABLE — Stripe verification per payment

**For EVERY paid test (and EVERY refund), Claude WILL run the
following BEFORE we move to the next test. No skipping.**

1. **Pull the live PaymentIntent(s) from Stripe** via either:
   - Stripe MCP `list_payment_intents` (most recent)
   - OR direct API: `curl https://api.stripe.com/v1/payment_intents/pi_…`
   - For split-tender: pull ALL N PIs (one per card)
2. **Inspect and report ALL of:**
   - `amount` matches the diner total we calculated (per-card for split)
   - `application_fee_amount` matches `cenaiva_fee + processing_fee`
   - `on_behalf_of` is `null` (the broken setting from the morning mistake — confirm it stays gone)
   - `transfer_data.destination` matches the restaurant's `acct_…`
   - `metadata.base_amount_cents` matches the food portion (per-card share for split)
   - `metadata.tax_cents` matches the HST portion (per-card share for split)
   - `metadata.deposit_payment_ids` contains the matching RDP row ID(s)
   - `metadata.restaurant_id` matches the booked restaurant
   - `metadata.hold_id` (if applicable) matches our hold — ONLY on slot 0 for split-tender
   - `status === "succeeded"` (or `requires_action` for 3DS, etc.)
3. **For refunds:** pull `GET /v1/refunds?payment_intent=pi_…` and
   confirm per PI:
   - `amount` = food + tax (the base — fees stay non-refundable)
   - `reverse_transfer: true` (restaurant pays back, not Cenaiva)
   - `refund_application_fee: false` (Cenaiva keeps the app fee)
   - `status === "succeeded"`
   - For split-tender DOWN: per-card refund amount matches proportional share via largest-remainder split
4. **Confirm the DB matches** the Stripe state:
   - `reservations.status` is what we expect
   - `orders.stripe_payment_intent_id` matches the PI (for pre-order)
   - `reservation_deposit_payments.status` matches Stripe's (one row per card for split)
   - `reservation_deposit_payments.amount_cents` reflects partial refunds correctly
5. **Tell Savyo the verification result clearly** before moving on:
   - ✅ "Stripe shows X, matches expected Y. DB rows consistent. Safe to proceed."
   - ❌ "Mismatch — Stripe says A but expected B. Stopping to investigate."

**If we skip this even once, we don't have real evidence the test
passed.** A booking that "looks fine" on the UI but has wrong PI
metadata is a silent bug. The whole point of this session is
catching those.

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

**$3 sushi + 13% HST (Ontario), solo card:**
- food = 300, tax = 39
- cenaiva_fee = max(round(300 × 0.02), 1) = 6¢
- subtotal = 300 + 39 + 6 = 345¢
- diner_total = ceil((345 + 30) / 0.971) = 387¢ = **$3.87**
- processing_fee = 387 − 345 = 42¢
- application_fee = 6 + 42 = 48¢
- Restaurant nets: $3.39 ✓
- Cenaiva nets: $0.06 ✓

**$20 deposit only (party 3+, no preorder, no tax), solo card:**
- food = 2000, tax = 0
- cenaiva_fee = 40¢
- subtotal = 2040¢
- diner_total = ceil((2040 + 30) / 0.971) = 2133¢ = **$21.33**
- processing_fee = 93¢
- application_fee = 133¢
- Restaurant nets: $20.00
- Cenaiva nets: $0.40

### Split-tender math (NEW — added 2026-05-28 with PR-K)

For N cards splitting a deposit of `total_food` cents + `total_tax` cents:

```
per_card_food = round(total_food / N)       # client-side equal split
per_card_tax  = round(total_tax / N)
```

Then each card's PI uses the SAME `computeDinerCharge(per_card_food, per_card_tax)`
formula above. Each card sees its own diner_total, application_fee,
metadata, etc.

**Example: $6 deposit on party of 4, split 2 cards:**
- total_food = 600, per_card_food = 300
- Per card: $3.87 charged (same as solo $3 example above)
- Total charged across both cards: $7.74
- Restaurant nets: $6.00 (across both cards)
- Cenaiva nets: $0.12 (2¢ × 2 cards, since min 1¢ floor)

### Modify-UP split-tender math (proportional delta)

For a party-size increase that raises required deposit by `delta_cents`:

```python
# Server reads each charged RDP row's amount_cents → weights array
# Server applies largest-remainder split:
per_row_delta = proportionalSplitCents(delta_cents, [row.amount_cents for row in charged_rows])
```

**Example: party 4 → 6, deposit jumps $6 → $10, delta $4. Cards originally
paid $3 + $3:**
- weights = [300, 300]
- per_row_delta = proportionalSplitCents(400, [300, 300]) = [200, 200]
- Each card gets a NEW pending row for $2 → diner pays $2.32 per card
- Total diner pays for delta: $4.64
- Each card's PI metadata.deposit_payment_ids includes ONLY that card's row

### Modify-DOWN / cart-shrink split-tender math (proportional refund)

For a shrink that owes `refund_cents` back:

```python
# Server applies break-even refund formula to TOTAL first (not per-card)
total_break_even = computeBreakEvenRefund(refund_cents).refundCents
per_row_refund = proportionalSplitCents(total_break_even, [row.amount_cents for row in charged_rows])
```

**Example: party 4 → 2, deposit drops $6 → $4, delta -$2. Cards originally
charged $3 + $3:**
- total_break_even = round(200 × 0.945) = 189¢
- per_row_refund = proportionalSplitCents(189, [300, 300]) = [95, 94]
- Card A refunded $0.95, Card B refunded $0.94 (largest-remainder gives the extra penny to first)
- Restaurant pays back $1.89 total via reverse_transfer (split across the two PIs)

### On full cancel (any solo or split-tender booking)

- Each charged card refunded INDEPENDENTLY (one refund per PI)
- Per-card refund = `food + tax` for that card (the base — fees stay)
- `reverse_transfer: true` per refund
- `refund_application_fee: false` per refund
- Owner net per card: $0; Cenaiva keeps per-card app_fee
- Owner + diner emails now itemize per-card amounts when ≥2 cards

---

## What we solved today (context for what each test is verifying)

### Major fixes shipped (this session: PR #31–#41, "PR-A through PR-K")

**PR-A through PR-J** (split-tender plumbing fixes from the QA session):

1. **PR #31 (A): Place Order IntegrationError** — `fields.billingDetails.address.*='never'` requires matching empty strings in `confirmParams.payment_method_data`. Was breaking 100% of split-tender payments.
2. **PR #32 (B): Modify-reservation dedup + abandoned-sweep** — party + cart delta both dedupe pending RDP rows; gate `notifyOwnerNewReservation` for split-tender (fires post-settle); 10-min cron sweeps `pending_payment > 30 min` with no charged RDPs.
3. **PR #33 (C): Hold-conversion owner-notif gate + settle trigger guard** — twin code path missed in PR-B; settle trigger now skips parents in `cancelled/no_show/completed`.
4. **PR #34 (D): Stripe-webhook owner notifications + orphan-refund** — webhook fires owner+diner emails when it beats confirm-deposit-paid; orphan-refund safety net for late charges on terminated parents.
5. **PR #35 (E): Step8PaymentSetup publish guard** — early-exit on rapid double-click.
6. **PR #36 (F): create_reservation_hold exact-match reuse** — returns caller's own active hold on page reload instead of `diner_double_book`.
7. **PR #37 (G): Orphan sweep releases tables** — abandoned split-tender bookings were leaving `reservation_tables` rows that blocked re-booking the same slot.
8. **PR #38 (H): SplitTenderPaymentForm stale-state fixes** — read `failedCount` from latest setSlots snapshot (not stale closure); useEffect safety net fires `onAllPaid` when slots eventually flip to "paid".
9. **PR #39 (I): Restore 15-min hold TTL** — PR-F accidentally reverted DEFAULT to 5; restored.
10. **PR #40 (J): Split-tender spinner + atomic owner-notif dedup** — outer "Place Order" spins during multi-card loop; `restaurant_notification_log` gained `reservation_id` column + partial unique index so dedup is atomic via INSERT-with-23505-guard.

**PR-K** (split-tender parity — this is the big one this session is testing):

11. **PR #41 (K): Split-tender modify + cancel + dashboard parity** — closes 10 gaps in one push:
    - **Modify-up (party + cart)**: `modify-reservation` detects ≥2 charged RDP rows → seeds N pending rows proportional to each payer's original share → returns `is_split_tender: true` + `deposit_payment_row_ids[]` + `split_payers[]`. Frontend mounts `SplitTenderPaymentForm` for the delta.
    - **Modify-down + cart-shrink**: refund distributed across ALL charged rows via `_shared/proportional-split.ts` (largest-remainder). Was refunding ONE row only — N-1 payers got nothing back.
    - **confirm-modify-payment**: schema accepts both legacy single-row + new array shape. Verifies ALL N PIs + RDP rows + metadata bindings; applies modify exactly once; auto-refunds ALL N PIs on rejection.
    - **Cancel notifications**: `cancel-reservation` passes per-payer `refund_breakdown` to owner email (bullet list with payer names + amounts); diner email body splits refund line by card.
    - **Owner dashboard**: `useReservations` joins `reservation_deposit_payments`; new `ReservationDepositBreakdown` component renders per-payer status in the detail dialog; list-view badge swaps "Deposit" → "Split N/M paid".
    - **SplitTenderPaymentForm.onAllPaid**: now passes `paymentIntentIds[]` + `depositRowIds[]` back so modify-flow consumers can call confirm-modify-payment with the array shape.

### Lessons that inform our testing

- **Stripe docs are authoritative.** Claude has been confidently wrong before (e.g. `on_behalf_of`). Cross-check Stripe behavior against docs every time.
- **Destination charges always make platform pay Stripe fees.** Only way to clean profit is `application_fee_amount = cenaiva + processing`.
- **2% commission is on food only, not (food + tax).** Tax is government money.
- **Hold survives navigation now.** 15-min server-side TTL, multi-tab syncs via P0006 recovery, page-reload returns caller's own hold.
- **Owner can't no-show outside window** without force override (audit-logged).
- **Split-tender is now first-class.** Every flow that works for solo must work identically for split.
- **N RDP rows per split-tender booking.** The settle trigger waits for ALL N to settle before flipping the reservation to `confirmed`.

---

## Test execution order (escalate complexity)

We'll go in this order — simplest → most complex. Each row is one
test session. **Don't skip ahead.** Each test should be cleaned up
(cancel/refund) before moving to the next to keep the database tidy.

### Phase 1 — Solo diner-side happy paths (LOGGED IN — savyoyaqoop2)

| # | Test | Approx cost |
|---|---|---|
| 1 | **Free booking** (party 2, no preorder, no deposit) — no charge | $0 |
| 2 | **Deposit only**, party 3, no menu items — verify deposit charge + metadata | ~$2 → refund → ~$0.36 |
| 3 | **Pre-order only**, party 2, $1.25 sushi — verify food + tax + commission + Stripe gross-up | ~$1.80 → refund → ~$0.36 |
| 4 | **Pre-order + Deposit**, party 3 with menu items — verify combined PI | ~$8 → refund → ~$0.42 |

**Per-test checks**: Stripe PI has `application_fee_amount`,
`on_behalf_of: null`, correct `metadata.tax_cents`, RDP row exists
with `status: 'charged'`. SMS + email arrive. After cleanup, RDP row
is `refunded` and the reservation is `cancelled`.

### Phase 1B — Solo guest checkout (NOT logged in)

Sign out OR open a fresh incognito tab. Test the same 4 scenarios as
guest — different code paths (no saved-card option, no
user_profile_id, identity attached via email/phone only).

| # | Test | What's different from logged-in |
|---|---|---|
| 5 | **Guest free booking** | No "save card" anything; reservation has `user_profile_id: null`, identity via guest_email/guest_phone |
| 6 | **Guest deposit only**, party 3 | Fresh card path mandatory (no saved-card picker). |
| 7 | **Guest pre-order only**, party 2 | Verify `metadata.tax_cents` still works for guests |
| 8 | **Guest pre-order + deposit**, party 3 | Combined PI, identity via guest fields |

**Per-test checks**: booking page does NOT show saved-card picker;
"Save card" checkbox HIDDEN; DB has `user_profile_id IS NULL` +
guest contact fields populated; Stripe PI has `customer: null`;
confirmation SMS + email arrive to guest contact; guest can find/manage
via `/find-reservation`.

### Phase 2 — Solo modify flows (mix of logged-in + guest)

| # | Test | Mode |
|---|---|---|
| 9 | Modify party 2 → 4 (crosses deposit threshold) — diner pays delta via single StripePaymentForm | Logged-in |
| 10 | Modify party 4 → 2 (drops below threshold) — partial refund to single card | Logged-in |
| 11 | Modify date/time, same party — no money change | Logged-in |
| 12 | Modify cart: add $1.50 menu item — single-card payment for delta | Logged-in |
| 13 | Modify cart: remove $1.50 menu item — single-card refund | Logged-in |
| 14 | Guest modify-up via /find-reservation lookup — same as #9 but as guest | **Guest** |
| 15 | Guest modify-down via /find-reservation — same as #10 but as guest | **Guest** |
| 16 | Guest modify cart via /find-reservation — same as #12 but as guest | **Guest** |

**Per-test checks for modify-up:**
- modify-reservation returns `is_split_tender: false` + `deposit_payment_row_ids: [oneId]` + `requires_payment: true`
- Frontend mounts solo `StripePaymentForm` (NOT SplitTenderPaymentForm)
- Single new PI charges for the delta
- confirm-modify-payment applies the slot change after PI succeeds
- Reservation's `party_size` / cart updates
- DB has ONE new RDP row with the delta amount + `status: 'charged'`
- Diner gets modify SMS + email with new details
- Owner sees the updated reservation in dashboard (party size / time / cart updated)

**Per-test checks for modify-down:**
- No payment screen
- One refund on the existing RDP row's PI (proportional split with N=1 = full refund)
- RDP row's `amount_cents` reduced (or `status: 'refunded'` if remaining = 0)
- Diner gets modify SMS + email mentioning the refund

### Phase 3 — Owner dashboard (Tab B becomes active) — solo only

Split-tender owner-dashboard tests live in **Phase S**.

| # | Test |
|---|---|
| 17 | Mark Seated WITHIN window — deposit auto-refunds to diner (solo) |
| 18 | Mark Seated OUTSIDE window — blocked with error |
| 19 | Force Mark Seated as owner — succeeds + audit log |
| 20 | Mark No-show WITHIN window for LOGGED-IN diner — SMS + email arrive, deposit forfeited |
| 21 | Mark No-show WITHIN window for **GUEST** diner — SMS + email arrive at guest contact info |
| 22 | Mark No-show OUTSIDE window — blocked |
| 23 | Force Mark No-show as owner — succeeds + audit + diner notification |
| 24 | Mark No-show TWICE on same reservation — notification does NOT re-fire (idempotency) |
| 25 | Mark Arrived (undo no-show) — deposit refunds back |

### Phase 4 — Cancel flows — solo only

Split-tender cancel tests live in **Phase S**.

| # | Test | Mode |
|---|---|---|
| 26 | Cancel paid solo booking from diner side — verify refund routing | Logged-in |
| 27 | Cancel paid GUEST solo booking via /find-reservation — verify refund + notification | **Guest** |
| 28 | Cancel free booking (no money) | Either |

### Phase 5 — Edge cases + race conditions — solo only

Split-tender edge cases live in **Phase S**.

| # | Test |
|---|---|
| 29 | Multiple rapid Place Order clicks (solo) — only 1 PI created |
| 30 | Close tab during 2-5s Stripe call — hold survives, reservation completes via webhook |
| 31 | Page reload mid-checkout — same hold returned to caller (PR-F), no `diner_double_book` error |
| 32 | Voice handoff with `?hold=<id>` URL |
| 33 | Webhook beats client confirm — owner notification deduplicated atomically (PR-J), no double email |

---

## Phase S — Split-tender end-to-end (NEW with PR-K, 2026-05-28)

**Everything split-tender lives here.** Booking, modify, owner ops,
cancel, edge cases — all consolidated so you can run the entire
split-tender test suite in a focused session. Solo equivalents are
back in Phases 1–5 above.

Use 2-3 cards per test. In live mode use real cards; in test mode the
Stripe test card `4242424242424242` (success) and `4000000000000002`
(generic decline) cover the happy + sad paths.

**Why a dedicated section:** PR-K is the brand-new functionality from
this session. Most likely to regress, most worth focused testing.
Owner + diner notification copy is new across the board. The owner
dashboard split-tender display is brand new. The modify-up/modify-down
proportional refund logic has never existed before.

### S — Bookings (initial split-tender flow)

These verify the initial split-tender booking flow still works
end-to-end. PR-A through PR-J shipped fixes here; PR-K didn't touch
this path but it's the foundation for everything else.

| # | Test | Cards | Approx cost |
|---|---|---|---|
| S1 | **2-card split, deposit only**, party 4, $6 deposit | 2 | ~$8 total → refund → ~$0.84 |
| S2 | **3-card split, deposit only**, party 6, $9 deposit | 3 | ~$11 total → refund → ~$1.26 |
| S3 | **2-card split, deposit + pre-order**, party 4, $3 sushi + $6 deposit | 2 | ~$11 total → refund → ~$0.84 |
| S4 | **3-card split with guest checkout**, party 6, $9 deposit, NOT logged in | 3 | ~$11 → refund → ~$1.26 |

**Per-test checks (in addition to all Phase 1 checks):**
- N separate PIs in Stripe, one per card
- Each PI's `metadata.deposit_payment_ids` contains ONLY that card's row ID
- Each PI's `transfer_data.destination` matches restaurant's `acct_…`
- Each PI's `metadata.hold_id` is set ONLY on slot 0 (others null) — slot 0 is the converter
- N `reservation_deposit_payments` rows, all eventually `status: 'charged'`
- Reservation transitions: `pending_payment` → `confirmed` ONLY after all N rows settle
- Owner gets EXACTLY ONE confirmation email (no duplicates from race) — PR-J atomic dedup
- Diner gets one confirmation SMS + email
- After all cards settle, owner dashboard shows the reservation with new "Split 3/3 paid" badge
- Owner dashboard detail dialog shows the new `ReservationDepositBreakdown` panel listing each payer + amount + Paid badge

### S — Modify flows (PR-K core — most critical tests)

**This is the brand-new functionality from PR-K — highest priority.**

| # | Test | Mode |
|---|---|---|
| S5 | **2-card modify-up**: party 4 → 6, deposit $6 → $10 (delta $4) — both cards charged $2 each | Logged-in |
| S6 | **2-card modify-down**: party 4 → 2, deposit $6 → $4 (delta -$2) — both cards proportionally refunded | Logged-in |
| S7 | **3-card modify-up**: party 6 → 9, deposit $9 → $13.50 (delta $4.50) — three cards split delta proportionally | Logged-in |
| S8 | **3-card modify-down**: party 6 → 3, deposit $9 → $4.50 (delta -$4.50) — three cards each refunded their share | Logged-in |
| S9 | **2-card cart-up**: pre-order, add $3 sushi (delta $3.39 with tax) — both cards split delta | Logged-in |
| S10 | **2-card cart-down**: pre-order, remove $3 sushi (delta -$3.39) — both cards split refund | Logged-in |
| S11 | **Guest 2-card modify-up** via /find-reservation — same as S5 but as guest | **Guest** |
| S12 | **Guest 2-card modify-down** via /find-reservation — same as S6 but as guest | **Guest** |

**Per-test checks for modify-up (S5, S7, S9, S11):**
- modify-reservation returns `is_split_tender: true` + `deposit_payment_row_ids: [N IDs]` + `split_payers: [...]` + `requires_payment: true`
- Frontend mounts `SplitTenderPaymentForm` (NOT solo StripePaymentForm)
- Payment dialog shows per-payer line items with names + amounts
- N new PIs created (one per card), each metadata-bound to one RDP row
- Per-card amounts sum to exactly the delta (proportional via largest-remainder — no penny drift)
- "Place Order" button spins (PR-J) while all cards process
- After all N cards succeed: SplitTenderPaymentForm.onAllPaid fires with `paymentIntentIds[]` + `depositRowIds[]`
- confirm-modify-payment called ONCE with arrays; verifies all N PIs + applies modify_reservation_slot exactly once
- Reservation party_size updates; new N RDP rows all `status: 'charged'`
- Diner gets ONE modify confirmation (not N)
- Owner dashboard: badge updates to reflect new card count if applicable; detail dialog shows the new RDP rows alongside originals

**Per-test checks for modify-down (S6, S8, S10, S12):**
- No payment screen
- N refunds — ONE per charged RDP row's PI
- Per-card refund amount = proportional share via largest-remainder (verify sums match)
- All N RDP rows have `amount_cents` reduced (or `status: 'refunded'`)
- Stripe shows N refund objects, each with `reverse_transfer: true`
- Diner email body splits the refund line per card (e.g. "Card 1: $0.95 · Card 2: $0.94")
- Owner dashboard refreshes to show updated per-card amounts in detail dialog

### S — Owner dashboard (split-tender display + ops)

| # | Test |
|---|---|
| S13 | Mark Seated on a SPLIT-TENDER reservation — all N cards refunded proportionally |
| S14 | Mark No-show on a SPLIT-TENDER reservation — all N deposits FORFEITED (no refund); audit log captures all card IDs |
| S15 | Owner dashboard LIST view shows split-tender badge — "Split N/M paid" for any in-progress or settled split booking |
| S16 | Owner dashboard DETAIL dialog — `ReservationDepositBreakdown` panel shows payer name, amount, status badge per card |

**Per-test checks:**
- Mark seated → all N RDP rows refunded; Stripe has N refund objects
- Mark no-show → all N RDP rows stay `charged` (kept by restaurant); owner email notes split-tender if applicable
- List badge format: "Split 2/3 paid" while in progress, "Split 3/3 paid" once settled
- Detail dialog lists each payer's name (from RDP `payer_full_name`), amount (formatted), status badge (Paid/Pending/Refunded/Failed)

### S — Cancel flows

| # | Test | Mode |
|---|---|---|
| S17 | Cancel 2-card split-tender booking — both cards independently refunded; owner email lists 2 cards; diner email lists 2 cards | Logged-in |
| S18 | Cancel 3-card split-tender booking as guest — all 3 cards independently refunded; emails list all 3 | **Guest** |
| S19 | Owner cancels a split-tender booking from dashboard — `actor: "owner"` path; same per-card refund + notification breakdown | Owner (Tab B) |

**Per-test checks:**
- Stripe shows N refund objects (one per card), each with `reverse_transfer: true`
- DB: all N RDP rows have `status: 'refunded'`, `amount_cents: 0`
- Owner email body renders:
  ```
  Split-tender refunds (N cards):
    • Payer 1 name: $X.XX
    • Payer 2 name: $X.XX
    ...
  ```
- Diner email body renders:
  ```
  Deposit refunded across N cards (total $X.XX):
    • Card 1 name: $X.XX
    • Card 2 name: $X.XX
  Refunds typically appear within 5–10 business days.
  ```
- communication_log has the row(s) with `status='sent'`

### S — Edge cases + failure modes

| # | Test |
|---|---|
| S20 | Multiple rapid Place Order clicks (split-tender) — only N PIs created (no duplicates per card) |
| S21 | **Decline 1 of 3 cards mid-split** (during initial booking) — other 2 charges succeed, failed card surfaces per-slot error, retry path works; PR-H useEffect safety net fires once retry passes |
| S22 | **Decline 1 of 2 cards mid-modify-up** — form shows per-slot error for that card; modify does NOT apply; other card's charge auto-refunded by confirm-modify-payment if it reached the server |
| S23 | Modify a split-tender within 30 seconds of initial book — old pending rows cleared before modify can seed new ones (PR-B dedup) |
| S24 | Abandoned split-tender (start checkout, don't complete) — auto-cancelled within 30 min by orphan-sweep cron (PR-B + PR-G); tables released |

**Failure-mode notes:**
- S21 and S22 are the most important sad-path tests. Run them at least once per session.
- For S22, the partial-failure handling is brand-new in PR-K — without it, a diner could end up with 1 card charged and the modify never applied. Verify carefully.

---

### Phase 6 — Stripe dashboard configuration checks (settle the standing reminders)

These are dashboard-only — no real money moved, no diner involved. Tab C in your Stripe dashboard.

#### Test 34 — Verify subscription `automatic_tax` enabled
**Action:**
1. Stripe dashboard → **Billing → Subscriptions**
2. Pick any active restaurant subscription (e.g. nova ristorante or Mark Testing at $199.99/mo)
3. Look in the right sidebar / details panel for "Automatic tax"
4. Confirm toggle is **ON**

**Expected:** Toggle shows "Stripe Tax — Enabled". HST/GST line itemized on the invoice.

**If OFF:**
- Click toggle to enable + customer address must include postal code
- Code follow-up needed: edit `publish-restaurant` edge fn to pass `automatic_tax: { enabled: true }` on `stripe.subscriptions.create()` so all FUTURE subscriptions get it automatically
- For existing subs: each one needs the toggle flipped manually

**Verify same on `bill-booking-fees` invoice items:**
- Stripe → Billing → Invoices → open any monthly invoice for a restaurant with booking fees
- Click into a `Booking fee` line item
- "Tax behavior" should show `exclusive`
- If `unspecified` or `inclusive`: update `bill-booking-fees` edge fn to add `tax_behavior: "exclusive"`

#### Test 35 — Flip dispute liability onto restaurants (the chargeback fix)
**Action:**
1. Stripe dashboard → **Connect** → **Settings** → **Risk & disputes** (path may vary by Stripe version)
2. Look for "Dispute liability" — currently shows **Platform** (Cenaiva)
3. Decide if you're ready to flip (industry norm: yes — restaurants control the experience that causes disputes)
4. If flipping: toggle to **Connected account** → save

**Verify it works:**
1. Find any recent successful PI from a Connect account
2. Stripe dashboard → that PI → click **⋯** (more menu) → **Simulate dispute** (test mode only)
3. Confirm the $15 dispute fee shows up on the **connected account's balance**, NOT Cenaiva's platform balance

**Expected:** Dispute reverses the original transfer from the restaurant + debits $15 from the restaurant's pending balance. Cenaiva's platform balance untouched.

**Why this matters (math):** Every dispute = $15 to whoever's liable. If you process 1,000 bookings/month with 1% dispute rate = 10 disputes/month. On Cenaiva: −$150/mo loss. On restaurants: each restaurant only sees disputes from their own diners (typically 0-2/mo).

### Skipped (no UI yet)

- Post-meal pay-the-bill (`stripe-charge-order` is dormant)
- 3DS challenge (needs Stripe test mode — not in scope today)
- International card (needs Stripe test mode)

---

## Notification verification (SMS + email content checks)

**For EVERY test that triggers a notification, verify all of:**
1. The SMS actually arrives on your phone (within 30 sec typically)
2. The email actually arrives in the inbox (within 1-2 min)
3. The CONTENT shows the correct figures + restaurant + confirmation code
4. The `communication_log` table has the row with `status='sent'`
5. For split-tender: the body itemizes per card (NEW with PR-K)

### What each notification should say

#### 📩 Booking confirmation (every successful paid or free booking)

**SMS content to verify:**
- Restaurant name matches the one booked
- Date + time matches the booked slot (restaurant's timezone)
- Party size matches
- Confirmation code (8 hex chars) appears
- If deposit paid: "Deposit paid: $X.XX" line shows the BASE amount

**Email content to verify:**
- Subject includes restaurant name
- All the above details
- "Manage reservation" link works (opens `/find-reservation` or `/booking/:code`)

**Where it sends:**
- Logged-in: `user_profiles.email` + `user_profiles.phone`
- Guest: the email + phone the diner typed in the booking form
- Split-tender: ONE notification to the booker only (other payers receive separate magic-link emails for their share, dispatched at hold-conversion time)

---

#### 🔄 Modify confirmation (paid delta OR refund)

**Trigger:** `confirm-modify-payment` succeeds (modify-up) OR `modify-reservation` applies a modify-down

**SMS/email content to verify:**
- New date/time/party (updated values)
- If payment changed:
  - Solo: "You were charged an additional $X" or "Refund of $X issued"
  - Split-tender: "You were charged across N cards" or "Refund of $X issued across N cards" — PR-K adds the split context line
- Confirmation code unchanged
- For split-tender modify, body mentions "(split across N cards)"

---

#### 💸 Cancel / refund notification (heavily enhanced by PR-K for split)

**Trigger:** diner cancels reservation (or owner cancels)

**Diner SMS content to verify:**
- Restaurant name
- Reservation date/time
- Refund amount shown = food + tax (the "base" — NOT the diner total, since fees are non-refundable)
- Confirmation code

**Diner email content to verify (solo, unchanged):**
- Subject mentions cancellation
- "Deposit refunded: $X.XX to your card. Refunds typically appear within 5–10 business days."

**Diner email content to verify (SPLIT-TENDER, NEW with PR-K):**
- "Deposit refunded across N cards (total $X.XX):"
- Bullet list per card with payer name + amount
- "Refunds typically appear within 5–10 business days."

**Owner email content to verify (solo, ENHANCED by PR-K):**
- Was: "Any deposit or pre-order paid will be refunded to the diner's card."
- Now: "Refunded $X.XX to the diner's card." (shows actual amount)

**Owner email content to verify (SPLIT-TENDER, NEW with PR-K):**
- "Split-tender refunds (N cards):"
- Bullet list per card with payer name + amount
- If any card's refund FAILED: "— refund FAILED, manual follow-up needed" appended to that line

---

#### 🚫 No-show notification

**Trigger:** owner marks reservation as no-show

**SMS content to verify (under 160 chars):**
> "Hi {firstName}, your reservation at {restaurantName} was marked no-show. Deposit was kept per restaurant policy. If incorrect, contact {restaurantPhone}."

**Email content to verify:**
- Subject: "Your {restaurantName} reservation"
- States the date/time of the marked-no-show reservation
- Shows the deposit amount that was kept (e.g. "$6.00")
- Confirmation code present
- Instructs to contact restaurant within 48 hours if incorrect
- Restaurant address + phone
- For split-tender no-show: the body should mention "deposits across N cards were kept" (verify this — may need a copy update if missing)

**Idempotency check (Test #36):**
- Mark no-show → SMS + email arrive → record in `communication_log`
- Click No-show again on same reservation → NO new SMS, NO new email
- `communication_log` should still have only ONE row per channel for that reservation

---

#### 🪑 Mark-seated notification

**Trigger:** owner marks reservation as seated

**Diner-facing:** No SMS or email currently fires on seated (by design — refund is silent, diner sees it on card statement).

For split-tender seated: all N cards refunded silently. No diner email change.

---

### How to verify content during the session

For each test that involves a notification:

1. **Run the test** (e.g. mark no-show, cancel split-tender)
2. **Check your phone** — does the SMS arrive? Is the content correct?
3. **Check the email inbox** for savyoyaqoop2@gmail.com — does the email arrive? Does it have the per-card breakdown for split?
4. **Claude queries communication_log** to confirm both rows inserted with `status='sent'`
5. **Read the message back to Claude** if anything looks off, so we can spot bugs in the template
6. **For split-tender**: confirm the email body matches the PR-K format exactly (bullet list, per-card)

For GUEST tests, the SMS/email goes to the contact info typed into the booking form. Use `savyoyaqoop+guest@gmail.com` (Gmail "+" trick — same inbox).

---

## Verification commands (Claude will run these for each test)

### Find the latest reservation + PIs for a confirmation code (solo)
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

### Find ALL RDP rows for a split-tender reservation (NEW with PR-K)
```sql
SELECT
  rdp.id,
  rdp.amount_cents,
  rdp.status,
  rdp.payer_full_name,
  rdp.payer_email,
  rdp.stripe_payment_intent_id,
  rdp.paid_at,
  rdp.created_at
FROM reservation_deposit_payments rdp
JOIN reservations r ON r.id = rdp.reservation_id
WHERE r.confirmation_code = 'XXXXXXXX'
ORDER BY rdp.created_at;
```

### Pull a PI from Stripe
```bash
curl -s https://api.stripe.com/v1/payment_intents/pi_XXXXX -u "$STRIPE_SECRET_KEY:"
```

Check each PI for:
- ✓ `amount` matches calculated diner_total (per-card for split)
- ✓ `application_fee_amount` matches cenaiva_fee + processing_fee
- ✓ `on_behalf_of: null`
- ✓ `transfer_data.destination` = restaurant's `acct_...`
- ✓ `metadata.base_amount_cents` = food (NOT food + tax)
- ✓ `metadata.tax_cents` = tax portion (0 for deposit-only)
- ✓ `metadata.deposit_payment_ids` contains the matching RDP row ID

### Find refunds for a PI
```bash
curl -s "https://api.stripe.com/v1/refunds?payment_intent=pi_XXXXX" -u "$STRIPE_SECRET_KEY:"
```

Each refund should have:
- ✓ `amount` = food + tax (the "base") — or proportional share for split-tender DOWN
- ✓ `reverse_transfer: true`
- ✓ `refund_application_fee: false`

### Audit log (for force overrides)
```sql
SELECT created_at, actor_id, action, metadata
FROM staff_audit_events
WHERE action LIKE '%force_override%'
ORDER BY created_at DESC LIMIT 10;
```

### Notification log (for no-show + split-tender idempotency)
```sql
SELECT sent_at, channel, type, status, reservation_id
FROM communication_log
WHERE reservation_id = 'RESERVATION_UUID'
ORDER BY sent_at DESC;
```

### Owner notification log (for booking + cancel dedup, PR-J)
```sql
SELECT created_at, notification_type, restaurant_id, reservation_id, status, message
FROM restaurant_notification_log
WHERE reservation_id = 'RESERVATION_UUID'
ORDER BY created_at DESC;
```

Expect EXACTLY ONE row per `(restaurant_id, notification_type, reservation_id)` with `status='sent'` — the partial unique index from PR-J enforces this.

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

3. **(NEW — added 2026-05-28) Split-tender no-show copy**
   - When owner marks a SPLIT-TENDER reservation as no-show, does the diner email mention all N cards were kept?
   - Current template was written pre-PR-K and likely says "your deposit was kept" (singular). Verify and update if needed.

4. **(NEW — added 2026-05-28) Card brand + last4 on RDP rows**
   - To make owner + diner breakdown emails truly useful, RDP rows would ideally show "Visa •••• 4242" instead of just payer name. Requires denormalizing card_brand + card_last4 onto RDP from stripe-webhook on PI succeeded.
   - Currently emails show payer_full_name only. Add as a follow-up if desired.

---

## Total session estimate

- **59 tests** total: 35 solo (Phases 1–6) + 24 split-tender (Phase S)
- **~$25–40** real money out of pocket (all refunded; Stripe processing fees + Cenaiva fee stay)
- **~5–7 hours** of session time
- Each solo booking test takes 5–10 min; split-tender tests 10–15 min; dashboard checks ~5 min each

If anything looks wrong mid-session, we **stop**, debug, fix, re-test
before moving on.

### Suggested split if running across multiple sessions

**Solo first (verifies no regression), then split-tender (the new functionality):**

- **Session 1 (1.5 hr)** — Solo bookings: Phases 1 + 1B (tests 1–8)
- **Session 2 (2 hr)** — Solo modify: Phase 2 (tests 9–16)
- **Session 3 (1.5 hr)** — Solo owner ops + cancel + edge: Phases 3 + 4 + 5 (tests 17–33)
- **Session 4 (0.5 hr)** — Stripe dashboard configs: Phase 6 (tests 34–35)
- **Session 5 (1.5 hr)** — Split-tender bookings + owner dashboard: Phase S1–S4 + S13–S16
- **Session 6 (2 hr)** — Split-tender modify (PR-K core, highest priority): Phase S5–S12
- **Session 7 (1 hr)** — Split-tender cancel + edge cases: Phase S17–S24

If short on time, **prioritize Sessions 1 + 6** — they cover the
highest-risk regression (solo nothing-broken) and the highest-risk new
functionality (split-tender modify, the brand-new PR-K code).

### Guest-test contact info suggestion

For guest tests, use a contact you can also check:
- **Email:** `savyoyaqoop+guest@gmail.com` (Gmail "+" trick — same inbox)
- **Phone:** your number — works for verifying SMS delivery

This way you can see notifications arrive at the "guest" contact while
also being able to read them.

---

## What "done" looks like for this session

We are confident PR-K is solid when:

### Solo regression check (Phases 1–5, tests 1–33)
1. ✓ All 8 solo Phase 1/1B booking tests pass with no regressions vs pre-PR-K behavior
2. ✓ All 8 solo Phase 2 modify tests pass (no regressions in solo modify)
3. ✓ All 9 Phase 3 owner dashboard tests pass for solo bookings
4. ✓ All 3 Phase 4 solo cancel tests pass
5. ✓ All 5 Phase 5 solo edge-case tests pass

### Split-tender end-to-end (Phase S, tests S1–S24)
6. ✓ All 4 Phase S booking tests (S1–S4) confirm initial split-tender booking still works
7. ✓ All 8 Phase S modify tests (S5–S12) work end-to-end:
   - Multi-card payment dialog renders correctly
   - Per-card amounts sum exactly to delta (no penny drift)
   - All cards charge / refund proportionally
   - confirm-modify-payment applies modify exactly once
8. ✓ All 4 Phase S owner-dashboard tests (S13–S16) confirm the new UI:
   - List badge "Split N/M paid"
   - Detail dialog `ReservationDepositBreakdown` panel
   - Owner ops (seated, no-show) work for split-tender
9. ✓ All 3 Phase S cancel tests (S17–S19) confirm:
   - All N cards refunded independently
   - Owner email has per-card bullet list
   - Diner email has per-card breakdown
10. ✓ All 5 Phase S edge-case tests (S20–S24) pass:
    - Decline 1 of N cards handled (S21, S22 — most important)
    - Dedup on rapid clicks works
    - Abandoned bookings auto-cancelled

### Infrastructure (Phase 6)
11. ✓ Subscription `automatic_tax` is on; `bill-booking-fees` invoice items use `tax_behavior: exclusive`
12. ✓ Dispute liability decision made (flipped to restaurants OR explicitly deferred)

If even ONE of these fails, we stop, fix, re-test before moving on.
