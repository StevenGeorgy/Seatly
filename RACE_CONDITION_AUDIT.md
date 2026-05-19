# Race Condition + Double-Click Audit

**Date:** 2026-05-19
**Status:** Findings only — no fixes shipped yet
**Scope:** Web app (`apps/web/src`) + edge functions (`supabase/functions/*`)

---

## TL;DR

**Client side (the buttons):** Mostly good. Booking, cancel, modify, payment, and review buttons all have proper guards.

**Server side (the edge functions):** **Two dangerous gaps.** If a duplicate request reaches the server (slow network, retry, replay), real money damage is possible. One more soft gap that creates clutter but no money loss.

**Why we're catching this now:** zero restaurants are live in production (`stripe_charges_enabled = true` for none yet, per CLAUDE.md). Best possible time to fix — no customers affected.

---

## The three issues, ranked

### 🚨 1. `create-subscription` — duplicate $199/mo subscriptions

**File:** `supabase/functions/create-subscription/index.ts:159`

**The gap:** No check for an existing active subscription before calling Stripe's `subscription.create()`. The function checks/reuses the Stripe **customer** but not the **subscription**.

**What happens if double-fires:**
- Two subscriptions created on the same customer
- Restaurant gets billed `$199 + $199 = $398/mo`
- The UI shows only the latest one — the first stays hidden in Stripe

**Severity:** ❌ **High.** Real money + hidden from the dashboard UI.

**Fix shape:**
- Before line 159, SELECT for any active subscription on the customer
- If found in status `active` or `trialing`, return the existing subscription (don't create new)
- Else proceed to create

**Alternative:** pass a deterministic `idempotencyKey` to Stripe's `subscription.create()`.

---

### 🚨 2. `stripe-charge-order` — duplicate post-meal charges

**File:** `supabase/functions/stripe-charge-order/index.ts:201–221`

**The gap:** Creates a Stripe Payment Intent without an idempotency key. The function only checks `orders.paid_at` to short-circuit — but on the very first call, `paid_at` is still null when two near-simultaneous requests arrive.

**What happens if double-fires:**
- Both requests pass the `paid_at` check (still null)
- Both call `stripe.paymentIntents.create()`
- **Diner is charged twice** for the same bill

**Severity:** ❌ **Highest in the codebase.** Real money, on the diner side.

**Fix shape:**
- Add Stripe `Idempotency-Key` header to `stripe.paymentIntents.create()` call
- Key: `order_id + total_amount_cents` (so a legitimate amount change creates a new key)
- Belt-and-suspenders: also check `orders.stripe_payment_intent_id IS NOT NULL` before creating, return the existing PI if so

---

### ⚠️ 3. `modify-reservation` — duplicate deposit adjustment rows

**File:** `supabase/functions/modify-reservation/index.ts:447–663`

**The gap:** When party size changes and a new deposit delta is needed, the function inserts a new `reservation_deposit_payments` row. If the function errors AFTER the Stripe charge succeeds but BEFORE returning a response, a retry creates a SECOND charge row.

**What happens if double-fires:**
- No double-charge of the diner (each Stripe PI is distinct, refunds are idempotent)
- BUT the database accumulates extra adjustment rows
- Audit trail / reconciliation gets confusing

**Severity:** ⚠️ **Medium.** No money risk, but ops-confusing.

**Fix shape:**
- Before inserting a new delta row, check if one already exists with the same `(reservation_id, payer_id, delta_amount)` for this modify attempt
- If found, reuse the existing row's Stripe PI instead of creating new

---

## What's properly guarded (no fix needed)

These flows have correct protection — both UI button disable + server-side idempotency:

| Flow | Client guard | Server guard |
|---|---|---|
| **Booking creation** (`book_reservation`) | `placingRef` + disabled button | Advisory lock on `(restaurant_id, reserved_at)` + diner double-book constraint + exact-match dedup |
| **Cancel reservation** | `busy` state + disabled button | Status check: returns early if already `cancelled`; refund helper has its own backstop |
| **Modify reservation slot** (time change) | `busy` state + disabled button | Same advisory lock as booking; rejects if slot taken |
| **Stripe payment** (one-time + saved card) | `submitting` state + disabled button | Stripe Elements is itself rate-limited |
| **`prepare-deposit`** | (called under booking guard) | Delete-then-insert pattern + status guard |
| **`confirm-deposit-paid`** | — | Explicit idempotent check + Stripe re-verification |
| **`signup-restaurant-owner`** | — | Draft-reuse logic + upsert on `(user_id, restaurant_id)` |
| **`create-stripe-account`** | `fetchedRef` | Returns existing account if `stripe_account_id` set |
| **`create-account-session`** | — | Stateless — Stripe issues short-lived tokens |
| **Submit review** | `submitting` state + disabled button | Standard form pattern |

## Low-stakes flows worth a flag

- **Favorite / save restaurant** (heart icon, `RestaurantPublicPage.tsx:694`) — no guard, but currently only flips local React state. Safe today. **If you ever wire it to a database call without adding `disabled={pending}`, it becomes risky.**
- **Save deal/event** (`DealsPage.tsx:1404`) — same situation. Local-only Set toggle. Currently safe.

---

## Risk of fixing these — honest assessment

### Working in our favor

1. **Zero live customers** — `stripe_charges_enabled = true` for 0 restaurants. No real users get hurt if a fix has a bug.
2. **Small surgical fixes** — each is 5–15 lines in a specific edge function. Limited blast radius.
3. **Sandbox Stripe mode** — we can verify each fix without spending real money.

### What could go wrong per fix

#### Fix 1 — `create-subscription`

- **Over-blocking risk:** If we define "active" too strictly, a restaurant whose subscription failed in some Stripe state (`incomplete`, `past_due`) can't retry.
- **Mitigation:** Block only on `active` and `trialing`. Allow `canceled`, `unpaid`, `incomplete_expired`, etc.

**Worst case if wrong:** A restaurant in some odd Stripe state can't onboard. Easy to fix (adjust status list).

#### Fix 2 — `stripe-charge-order`

- **Idempotency key design matters:** keys have 24h TTL in Stripe. If we use just `order_id`, a legitimate amount change won't create a new PI.
- **Mitigation:** key = `order_id + total_amount_cents`.
- **Existing orders unaffected:** the fix only impacts orders created AFTER deployment.

**Worst case if wrong:** A diner can't pay because Stripe keeps returning the old PI. Caught in any test checkout.

#### Fix 3 — `modify-reservation`

- **Lowest risk of the three.** No money at stake — just row dedup.
- **Multi-payer awareness:** the modify flow interacts with multi-payer deposit split. Dedupe needs to be scoped properly so different payers' rows aren't conflated.
- **Mitigation:** dedupe on `(reservation_id, payer_id, delta_amount, created_at_minute_window)`.

**Worst case if wrong:** A legitimate deposit row gets skipped, booking shows wrong total. Caught immediately in testing.

### What WON'T be affected by any of these fixes

- ✅ The booking-creation flow (`book_reservation` RPC + advisory lock)
- ✅ Cancel-reservation
- ✅ Restaurant onboarding (drafts)
- ✅ Hey Cenaiva voice booking
- ✅ Dashboard / Discover page / marketing pages
- ✅ Marketing-accuracy work shipped earlier

---

## Recommended fix order

Ship one at a time. After each, click through the affected flow in test mode and verify normal usage still works. If anything looks off, undo just that one fix.

1. **`create-subscription`** (the $199/mo bill duplicator) — worst-case dollar impact per double-click
2. **`stripe-charge-order`** (the post-meal double-charge) — affects diner-side trust, but pay-the-bill flow isn't heavily used yet
3. **`modify-reservation`** (the deposit accumulator) — soft, can wait

**Don't do all three in one deploy.** Stagger them. Each Stripe-adjacent edge function is its own surface; bundling deploys magnifies risk for no gain.

---

## Open question for later

- **Audit log clutter check:** Once Fix 3 is in, do a one-time clean-up pass on existing `reservation_deposit_payments` to remove orphan delta rows from past sessions, if any. Not urgent but good housekeeping before scale.

---

## Cross-references

- CLAUDE.md hard rules around `book_reservation`, `cancel-reservation`, and Stripe Connect-aware paths — all left intact by these fixes
- `STRIPE_SETUP.md` — operational checklist for the Stripe dashboard side
- `MOBILE_STRIPE_GUIDE.md` — mobile-side Stripe handoff doc (not affected by these fixes)
