# DEPOSIT_SAV.md — Deposit policy for the diner mobile app

Companion to `DINER_MOBILE_GUIDE.md` (diner-side mobile mirror) and the
`Deposit policy` headline in `CLAUDE.md`. Read those first if you haven't.

This doc covers **only** the deposit policy feature. The web app already
implements it end-to-end (verified in browser 2026-05-10 with
confirmation code `51063919`); the mobile app reuses the same backend
1:1 and just renders the UI in React Native.

---

## TL;DR — is the proposed flow efficient?

**Yes.** Three reasons:

1. **Zero new backend work.** Mobile calls the same edge functions and
   reads the same columns the web already uses. No mobile-specific RPCs,
   no shadow tables, no duplicated business logic.
2. **One round-trip per phase.** Restaurant fetch already includes
   `deposit_tiers`; booking creation already returns `deposit_required`
   + `deposit_amount_cents`; deposit charge is two HTTP calls
   (`prepare-deposit` → `confirm-deposit-stub`) — both sub-200ms. No
   polling, no extra queries to "ask if a deposit applies."
3. **Single source of truth for the math.** Highest-tier-wins logic
   lives in one place: the Postgres function `compute_deposit_for_party`.
   Mobile computes a *display* preview client-side (so the deposit shows
   up before the booking row exists), but the canonical value is always
   what the server writes onto `reservations.deposit_amount_cents`.

If a future tier rule changes (e.g. "20+ at lunch only"), it's one SQL
update — both web and mobile pick it up automatically.

---

## What's already built (don't redo)

### Database (live in prod, captured in committed migrations)

| Object | What it is | Migration |
|---|---|---|
| `restaurants.deposit_tiers JSONB` | Owner-set tiers, default `[]` | `20260510000400_deposit_policy.sql` |
| `validate_deposit_tiers(jsonb)` | Shape constraint helper | same |
| `reservations.deposit_amount_cents INTEGER` | Frozen-at-booking deposit total (nullable) | same |
| `reservations.deposit_status TEXT` | `none / pending / charged / waived / failed` | same |
| `reservation_deposit_payments` | One row per payer (split-tender support) | same |
| `compute_deposit_for_party(uuid, integer)` | Returns deposit cents for a party | same |
| `reservation_deposit_settle_trigger` | Flips reservation to `confirmed` when all payment rows are `charged` | same |

### Edge functions (deployed)

| Function | Verb | Purpose |
|---|---|---|
| `create-public-booking` | POST | Creates the reservation. Now also computes and writes `deposit_amount_cents` + `deposit_status='pending'`, and returns `{ deposit_required: bool, deposit_amount_cents: int }` in the response. |
| `prepare-deposit` | POST | Inserts `reservation_deposit_payments` rows in `pending`. Validates payer sum equals reservation deposit. RLS-safe (uses service role). |
| `confirm-deposit-stub` | POST | **Stripe stub.** Marks a payment row `charged`. Settle trigger flips reservation. Gated by `DEPOSIT_STRIPE_STUB_MODE` env (default `true`). Replace with a Stripe webhook handler when wired. |

### Owner side (web only — no mobile equivalent needed)

The owner sets tiers in the dashboard via `<DepositPolicyEditor>`
(`apps/web/src/components/dashboard/DepositPolicyEditor.tsx`). Diner
mobile is read-only on this — owners aren't on the diner app.

---

## Mobile diner flow (what to build)

The diner journey has three touchpoints with deposits:

### 1. Booking screen — preview the deposit before submitting

When the diner picks date / time / party size, the booking screen
should show a "Deposit required" pill if applicable.

**Source of truth:** the restaurant row already loaded into mobile state
(via the same SELECT pattern as `useRestaurant.ts` on web). Add
`deposit_tiers` to the SELECT.

**Computation (client-side, mobile):**

```ts
// libs/deposit/computePreview.ts
export type DepositTier = {
  min_party_size: number;
  amount_per_person_cents: number;
};

export function previewDepositCents(
  tiers: DepositTier[] | null | undefined,
  partySize: number,
): number {
  const list = Array.isArray(tiers) ? tiers : [];
  if (list.length === 0 || partySize < 1) return 0;
  const applicable = list
    .filter((t) => partySize >= t.min_party_size)
    .sort((a, b) => b.min_party_size - a.min_party_size)[0];
  return applicable ? applicable.amount_per_person_cents * partySize : 0;
}
```

Mirror this from `apps/web/src/pages/customer/RestaurantPublicPage.tsx`
where the web computes `previewDepositDollars`. Keep the implementation
verbatim against web (per the CLAUDE.md hard rule on mobile-shaped
helpers).

**Why this is efficient:** zero network calls. The tiers are already in
restaurant state. Recompute on every party-size change is O(N) where N
is `tiers.length` (max 3-5 tiers in practice).

### 2. Checkout / Pay screen — collect the deposit

Two cases:

- **No deposit (small party):** existing flow, no change. Booking
  confirms immediately.
- **Deposit required:** the existing checkout / pay screen needs a new
  "Deposit" line item in the order summary, and the existing single /
  split-tender UI handles the combined total (cart + deposit).

The web does this by adding `previewDepositDollars` to `totalNow` and
rendering a `Deposit (N × $X)` row above the total. Mirror that.

**API contract for the booking POST:**

```http
POST /functions/v1/create-public-booking
{
  "restaurant_id": "uuid",
  "shift_id": "uuid",
  "date_time": "2026-05-11T19:00:00.000Z",
  "party_size": 8,
  "guest_name": "...",
  "guest_email": "...",
  "guest_phone": "...",
  "cart_items": [...],   // optional preorder items
  "subtotal": 0, "tax_amount": 0, "tip_amount": 0,
  "total_amount": 80.00, // cart + deposit + tip in dollars
  "payment_method": "card" | "split"
}
```

Response now includes:

```json
{
  "reservation_id": "uuid",
  "confirmation_code": "DC2D38E1",
  "duration_minutes": 90,
  "deposit_required": true,
  "deposit_amount_cents": 8000,
  ...
}
```

### 3. After booking — collect the deposit money

For the **Stripe stub** (current state), mobile does this two-step
sequence after the booking POST returns:

```ts
// 3a. Create the payment rows
const prep = await fetch(`${SUPABASE_URL}/functions/v1/prepare-deposit`, {
  method: "POST",
  headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({
    reservation_id: bookingResponse.reservation_id,
    payers: [
      { email: dinerEmail, full_name: dinerName, amount_cents: bookingResponse.deposit_amount_cents }
      // For split-tender, push N payer entries — sum must equal deposit_amount_cents.
    ],
  }),
});
const { payments } = await prep.json();

// 3b. Charge each payment row (Stripe stub for now)
for (const payment of payments) {
  await fetch(`${SUPABASE_URL}/functions/v1/confirm-deposit-stub`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ payment_id: payment.id }),
  });
}
```

The DB trigger flips the reservation to `status='confirmed'` and
`deposit_status='charged'` automatically once every row is charged. Mobile
doesn't need to send a separate "finalize" request — just re-fetch the
reservation and it'll show `confirmed`.

### 4. My Reservations screen — show deposit state

Add `deposit_amount_cents` and `deposit_status` to the SELECT for the
diner's reservation list query. Show:

- **`deposit_status = 'none'`** — no badge, normal flow.
- **`deposit_status = 'pending'`** — yellow "Deposit due" badge + tap-to-pay
  CTA that opens the deposit pay sheet (re-uses the same charge flow as
  step 3b above).
- **`deposit_status = 'charged'`** — green "Paid" badge or just hide.
- **`deposit_status = 'failed'`** — red "Payment failed" badge + retry CTA.

Note: in the current end-to-end web flow, deposits are charged
synchronously immediately after booking via the stub. In production with
real Stripe, the diner might not pay immediately (e.g. card declined →
retry later), so the `pending` state is the one to design for.

---

## Step-by-step implementation order

Mobile should ship these in dependency order. Each step is independently
shippable.

1. **Mobile schema types.** Add `DepositTier` type, extend
   `Restaurant` mobile type to include `deposit_tiers`. Extend
   `Reservation` mobile type to include `deposit_amount_cents` and
   `deposit_status`.
2. **Mobile fetch updates.** Update the `from('restaurants').select(...)`
   to include `deposit_tiers`. Update reservations list select to
   include the two new columns.
3. **Deposit preview helper.** Port `previewDepositCents()` (above) into
   mobile lib.
4. **Booking screen pill.** Show `Deposit ${$X}` next to party size when
   `previewDepositCents > 0`.
5. **Checkout screen line item.** Render the deposit row in the order
   summary. Add to the grand total.
6. **Booking POST handling.** When the response says `deposit_required`,
   call `prepare-deposit` then `confirm-deposit-stub` BEFORE navigating
   to the confirmation screen. Surface errors with retry.
7. **My Reservations badges.** Render the deposit_status badge per row.
8. **Outstanding deposit retry.** Add a "Pay deposit" CTA on a row with
   `deposit_status='pending'` that re-runs steps 3a/3b (no booking
   creation — the reservation already exists).
9. **Realtime confirmation (optional).** Subscribe to
   `reservations` postgres_changes filtered by the diner's
   `user_profile_id` so the screen auto-updates from `pending` →
   `confirmed` after payment. Skip if you'd rather poll.

---

## Why this is efficient (the question the user asked)

| Concern | How this design addresses it |
|---|---|
| Network round-trips | 1 (booking POST) + 1 (prepare) + N (charge per payer; usually 1). Three calls for the entire deposit dance. No "is there a deposit?" preflight needed. |
| Duplicated logic between web/mobile | Tier math is **also** computed server-side. If client and server disagree, server wins (canonical write to `deposit_amount_cents`). Tiers can change without re-shipping mobile. |
| Stale tier data | Tiers live on `restaurants` row. Mobile already invalidates restaurant cache on edits via the existing realtime channel pattern (`useAvailabilityRealtimeInvalidate`). No new realtime work needed for tier changes. |
| Race: two diners booking at the same shift cap, one with deposit | Existing advisory lock + cover-cap check + diner-overlap guards apply. Deposit doesn't change concurrency semantics — it's written AFTER the reservation row exists, so the booking succeeds before payment is required. |
| Refund semantics | Out of scope until real Stripe is wired. Today: modifications that lower deposits are blocked (see CLAUDE.md "Deposit refunds" risk callout). Mobile should surface "to reduce party size, please cancel and rebook" matching web. |
| Stripe wiring later | Replace `confirm-deposit-stub` with a webhook handler. The schema, RLS, and trigger don't change. Mobile's three-call sequence stays identical — just the second call's response changes from "instant success" to "PaymentIntent client_secret to confirm with the Stripe SDK." |

---

## Stripe stub → real Stripe migration (for the future task)

When real Stripe lands, the mobile changes are minimal:

1. `prepare-deposit` will return a Stripe `client_secret` per payment
   row instead of the current `pay_url` mock.
2. Mobile drops `confirm-deposit-stub` and instead calls
   `stripe.confirmPayment(client_secret)` with collected card details
   using the Stripe React Native SDK.
3. The Stripe webhook server-side flips the row to `charged`; the
   trigger flips the reservation. Same flow, no schema change.
4. Set `DEPOSIT_STRIPE_STUB_MODE=false` on prod (web also stops
   auto-charging in `RestaurantPublicPage.handlePlaceOrder`).
5. Search `// STRIPE STUB` in the codebase to find every mobile/web
   spot that needs swapping out.

---

## Hard rules (mirror of the CLAUDE.md ones)

- Never insert directly into `reservation_deposit_payments` from the
  mobile client. RLS allows only service-role writes; use
  `prepare-deposit`.
- Never set `reservations.deposit_status='charged'` from mobile. The
  trigger owns that flip; manual writes break the state machine.
- Never deploy mobile with the Stripe stub still pretending to charge
  in prod. Gate behind a build-time env flag identical to the web's
  `DEPOSIT_STRIPE_STUB_MODE`.
- Match web's "no separate deposit step" UX. Deposit lives inside the
  existing checkout / pay screen as a line item — there is no
  standalone `<DepositStep>` component on either platform (deleted from
  web on 2026-05-10).

---

## Verification checklist (mobile QA)

- [ ] Restaurant fetch includes `deposit_tiers`; absent column returns
      `null` and gets normalized to `[]`.
- [ ] Booking screen with party 4 (no tier match) → no deposit pill, no
      checkout deposit row.
- [ ] Booking screen with party 8 at a restaurant with `8+ = $10/person`
      → `$80.00` pill + checkout line item.
- [ ] Booking screen with party 25 at `8+ = $10, 20+ = $20` → `$500`
      (highest tier wins, NOT $750).
- [ ] Booking POST returns `deposit_required: true` for party 8.
- [ ] After Place Order → `prepare-deposit` succeeds, then
      `confirm-deposit-stub` succeeds, reservation row goes `confirmed`.
- [ ] My Reservations shows the new booking with no "Deposit due" badge
      (it's already paid via the stub).
- [ ] Manually setting a reservation's `deposit_status='pending'` in DB
      → My Reservations shows the badge + retry CTA. Tap → completes
      the charge.
- [ ] Split tender (3 payers, $80 deposit) → 3 rows in
      `reservation_deposit_payments`, sum = 8000 cents, all charged
      individually flips reservation to confirmed once the last one
      hits 'charged'.
- [ ] Network error during `prepare-deposit` → user-facing retry, no
      duplicate rows on retry (the function deletes existing 'pending'
      rows for that reservation before re-inserting).
