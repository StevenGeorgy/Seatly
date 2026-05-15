# MOBILE_STRIPE_GUIDE.md — Wiring Stripe into the Cenaiva mobile diner app

Companion to `DINER_MOBILE_GUIDE.md` (general diner mobile handoff). This doc
covers everything money-related: how charges flow, which edge functions to
call, the schema shape of payment rows, and the cancel / refund / forfeit
rules.

Mobile is a **consumer** of the platform's payment infrastructure. It does
not modify schema, does not call Stripe's secret API directly, and does not
mint PaymentIntents itself. Every interaction with money goes through a
Cenaiva edge function that holds the Stripe secret server-side.

If anything in this doc conflicts with code, **code is the source of
truth** — re-read the file the doc points at and update this guide. The
on-disk paths in this doc are relative to repo root
`/Users/mark_habbi/Seatly-12/`.

---

## 1. Money model — who charges whom, who keeps what

Cenaiva uses Stripe Connect with **Custom** connected accounts (one per
restaurant). Every diner charge is a **destination charge**:
`transfer_data.destination = restaurant.stripe_account_id`. Result: the
money lands in the restaurant's Stripe balance the instant Stripe approves
the charge, minus a platform application fee that stays with Cenaiva.

| Charge type | Who pays | Who receives | Platform fee | Stripe fee paid by |
|---|---|---|---|---|
| Pre-ordered food + tax | Diner | Restaurant | 5% (app fee) | Restaurant |
| Booking deposit | Diner | Restaurant | 5% (app fee) | Restaurant |
| Monthly subscription ($200 CAD) | Restaurant | Cenaiva platform | n/a | Cenaiva |
| Per-reservation fee ($1) | Restaurant | Cenaiva platform | n/a (billed monthly) | Cenaiva |

**Refunds** automatically reverse the funds from the restaurant's connected
account back to the diner's card. The 5% application fee **stays** with
Cenaiva by default (`refund_application_fee: false`). Stripe's processing
fee on the original charge is never returned by Stripe — that's a small
loss the restaurant absorbs on cancellations, industry standard.

**Currency:** CAD for all diner-facing charges. Restaurants are
Canadian-only at launch.

**Mobile's only money job:** present amounts truthfully to the diner,
collect card details via the Stripe Mobile SDK, hand the resulting
PaymentMethod / PaymentIntent ids to Cenaiva edge functions, surface the
result. Never compute platform fees client-side — server is authoritative.

---

## 2. Stripe account architecture mobile needs to know

| Object | Lives on | Notes |
|---|---|---|
| Cenaiva platform account | Cenaiva's Stripe org | Owns the secret key, charges subscriptions, collects app fees |
| Connected restaurant account | Each restaurant | `stripe_account_id` stored on `restaurants` row. Diner charges destination-route here |
| Platform Customer (for sub) | Platform account | `stripe_customer_id` on `restaurants` row. Used for monthly billing only |
| Diner card | Tokenized via Stripe SDK | Never stored in Cenaiva DB. Mobile uses Stripe's PaymentSheet or CardField; gets back a `pi_*` or `pm_*` token |

Mobile does NOT need its own Stripe publishable key handling — it uses the
**Cenaiva publishable key** (one key, platform-level). The destination
account routing happens server-side when the PaymentIntent is created.

---

## 3. Stripe Mobile SDK setup

iOS: [Stripe iOS SDK](https://stripe.com/docs/payments/accept-a-payment?platform=ios) — use **PaymentSheet** (lowest friction).
Android: [Stripe Android SDK](https://stripe.com/docs/payments/accept-a-payment?platform=android) — same, use **PaymentSheet**.
React Native: `@stripe/stripe-react-native` if the app is RN.

**Initialize once at app start** with the publishable key:

```swift
// iOS
StripeAPI.defaultPublishableKey = "pk_test_..." // or pk_live_... in prod
```

```kotlin
// Android
PaymentConfiguration.init(applicationContext, "pk_test_...")
```

Get the publishable key from a Cenaiva config endpoint (don't hardcode —
test vs live differs). Reuse the same key the web app uses; it's also a
platform-level key.

**Do not** call Stripe Connect Account Sessions, Account Onboarding, or
anything platform-side from the diner mobile app. Those are owner-side
flows handled in the restaurant onboarding wizard (web).

---

## 4. Diner pre-order payment flow

Triggered when the diner picks menu items at checkout and `totalNow > 0`.
The same PaymentIntent will cover **food + tax + (optional) deposit**, all
in one charge.

### 4a. Mount PaymentSheet (no clientSecret yet — deferred PI mode)

The web app uses Stripe's "deferred PaymentIntent" mode so Elements mounts
without a clientSecret and the PI is minted JIT on Place Order. Mobile
should follow the same pattern using `PaymentSheet.IntentConfiguration`
(iOS) or the equivalent on Android, with `mode: .payment`, currency `CAD`,
amount in cents.

Why deferred: the diner might cancel before paying. Minting a PI
immediately would create dangling Stripe records and a slot-hold problem
on the reservation side.

### 4b. On "Place Order" tap

The exact call order, mirroring `apps/web/src/pages/customer/RestaurantPublicPage.tsx`
`handlePlaceOrder` (around line 1700-2070):

```
1. Mobile calls Cenaiva: POST /functions/v1/create-public-payment-intent
   Body: { restaurant_id, amount_cents, currency: "CAD" }
   Response: { client_secret, payment_intent_id }

2. Mobile calls Stripe SDK: PaymentSheet.confirm(client_secret)
   This collects the card and confirms the charge in one shot.
   Result: succeeded | failed.

3. If succeeded — mobile calls Cenaiva: POST /functions/v1/create-public-booking
   Body: { restaurant_id, reserved_at, party_size, shift_id, guest_name,
           guest_email, guest_phone, special_request, items: [...],
           applied_promo_code, payment_intent_id }
   Response: { reservation_id, confirmation_code, deposit_required,
               deposit_amount_cents, order_id }

4. Mobile calls Cenaiva: POST /functions/v1/mark-order-paid
   Body: { order_id, payment_intent_id }
   This flips orders.status='paid' via service-role (RLS blocks
   diner-side direct UPDATEs).

5. IF deposit_required AND deposit_amount_cents > 0:
   5a. Mobile calls: POST /functions/v1/prepare-deposit
       Body: { reservation_id, payers: [{ email, full_name, amount_cents }] }
       Response: { payments: [{ id, amount_cents, status, ... }] }
   5b. Mobile calls: POST /functions/v1/confirm-deposit-paid
       Body: { payment_id: payments[0].id, payment_intent_id }
       The server re-verifies the PI with Stripe and flips the deposit
       row to 'charged' via service-role.

6. Mobile navigates to confirmation screen, shows confirmation_code.
```

### 4c. Race-window recovery (critical)

Between step 2 (Stripe charges card) and step 3 (booking write), the slot
could be taken by another diner. If `create-public-booking` returns
`error.unavailable_reason === 'slot_taken'` (or 409 + `slot_taken`):

```
Mobile calls: POST /functions/v1/refund-payment-intent
  Body: { payment_intent_id, reason: "slot_taken" }
```

Show the diner: "That table was taken right as you paid — your card has
been refunded ($X.XX). Please pick another time." Then return them to the
slot picker.

This is mandatory. Skipping it = ghost charge on the diner's card with no
reservation.

### 4d. What lands in the DB after pre-order succeeds

- `reservations` row: status starts `pending_payment`, flips to `confirmed`
  once all linked deposit rows are charged (or immediately if no deposit).
- `orders` row: status `paid`, `stripe_payment_intent_id` set, `paid_at`
  timestamp, `total_amount` matches order subtotal + tax (NOT including
  deposit — deposit is its own row).
- `order_items` rows: one per menu item.
- `reservation_deposit_payments` row (if applicable): status `charged`,
  same `stripe_payment_intent_id` as the order (single PI covers both),
  `amount_cents` matches the deposit calc.

---

## 5. Diner deposit payment flow

If the diner is NOT pre-ordering food but the booking still requires a
deposit (party size triggers the deposit policy), the flow is similar but
shorter. The PaymentIntent amount = just the deposit.

```
1. POST /functions/v1/create-public-payment-intent
   { restaurant_id, amount_cents: deposit_cents, currency: "CAD" }

2. Stripe SDK: PaymentSheet.confirm(client_secret) → succeeded

3. POST /functions/v1/create-public-booking
   { ...booking fields, payment_intent_id, items: [] }
   Returns deposit_required: true, deposit_amount_cents, reservation_id.

4. (skip mark-order-paid — no order was created since items=[])

5. POST /functions/v1/prepare-deposit
   { reservation_id, payers: [{ email, full_name, amount_cents }] }
   Returns payments: [{ id, ... }]

6. POST /functions/v1/confirm-deposit-paid
   { payment_id, payment_intent_id }
   Settle trigger flips reservation.status to 'confirmed'.
```

### 5a. How the deposit amount is computed

`restaurants.deposit_tiers` is a JSONB array: `[{min_party_size, amount_per_person_cents}, ...]`. The highest tier whose `min_party_size <=
party_size` wins (NOT additive). The RPC `compute_deposit_for_party(uuid,
integer)` returns the total cents — mobile should call this to preview the
amount before checkout:

```
Mobile: GET /rest/v1/rpc/compute_deposit_for_party
  Body: { p_restaurant_id, p_party_size }
  Response: integer (total deposit in cents)
```

Always compute server-side. Do NOT replicate the tier logic in mobile
code — owners change tiers in their dashboard and any mobile-side copy
will drift.

### 5b. Free reservation case

If `totalNow === 0` (no pre-order, no deposit), skip the entire Stripe
flow:

```
1. POST /functions/v1/create-public-booking
   { ...booking fields, payment_intent_id: null, items: [] }
   Returns reservation with status='confirmed' immediately.
```

No PaymentIntent, no deposit row, no order row. The trigger doesn't fire
because there's nothing to settle.

---

## 6. Cancellation flow

Diner taps Cancel in the mobile booking detail screen. The mobile UI MUST
show a confirm dialog before the actual cancel fires, matching the web's
two-state copy:

### 6a. Confirm-dialog copy (mirrors web)

Compute `hoursToReservation = (reserved_at - now) / 3600000`.

| State | Dialog body |
|---|---|
| `hoursToReservation >= 24` AND payments paid | "The restaurant will be notified, your table will be released, and $X.XX will be refunded to your original payment method. This can't be undone." |
| `hoursToReservation < 24` AND payments paid | "Heads up — this reservation is within 24 hours. Cancelling now will release your table, but you'll forfeit the $X.XX you paid (per our 24h cancellation policy). This can't be undone." |
| No payments paid | "The restaurant will be notified and your table will be released. This can't be undone." |

The "payments paid" check: SELECT `orders.status='paid'` rows + 
`reservation_deposit_payments.status='charged'` rows tied to this
reservation, sum the amounts. See section 9 for the queries.

### 6b. On confirm

```
POST /functions/v1/cancel-reservation
Body: { reservation_id }
Auth: Bearer token (logged-in diner) or { confirmation_code } (guest-only path)
```

The server:
1. Validates ownership / confirmation code
2. Rejects past reservations (`reserved_at < now`)
3. Flips `reservations.status='cancelled'`, sets `cancelled_at` and
   `cancellation_reason` (different reason text when within 24h)
4. **If `hoursToReservation >= 24` AND payments exist:** refunds every
   paid order via Stripe, marks orders + deposit rows `refunded`.
5. **If `hoursToReservation < 24` AND payments exist:** SKIPS the refund.
   Money stays with the restaurant. Tallies `forfeit_total_cents` for
   reporting.
6. Releases the reservation tables, fans out notify-me alerts to other
   diners watching the slot, sends cancellation SMS/email.

### 6c. Response shape

```json
{
  "ok": true,
  "reservation_id": "...",
  "status": "cancelled",
  "refunds": [
    { "kind": "preorder"|"deposit", "ok": true,
      "payment_intent_id": "pi_...", "amount_cents": 678 }
  ],
  "refund_total_cents": 678,
  "forfeit_total_cents": 0,
  "within_24h": false,
  "notification_delivery": "delivered"|"skipped"|...
}
```

### 6d. Mobile toast after success

```
if (within_24h && forfeit_total_cents > 0)
   "Reservation cancelled. $X.XX forfeited per the 24h cancellation policy."
else if (refund_total_cents > 0 && every refund.ok)
   "Reservation cancelled. $X.XX refunded to your card."
else if (any refund.ok === false)
   "Reservation cancelled. Some refunds are still processing — we'll
    email you once they complete."
else
   "Reservation cancelled."
```

### 6e. Snappy UX rule

Close the confirm dialog and show the toast **immediately** after the
edge function returns (~2-3 seconds). Don't wait for the local
reservations list to refetch — fire `void refresh()` in the background.
Web learned this the hard way (see `BookingDetailsPage.tsx` `handleCancel`
flow).

### 6f. Edge cases

- **Retried cancel:** the edge function is idempotent. Refunds use a
  `charge_already_refunded` backstop and the status filters
  (`'paid'`/`'charged'`) skip already-refunded rows. Safe to retry on
  network error.
- **Refund Stripe API fails:** the cancel still succeeds, the response
  carries the failure in `refunds[].error`. Mobile toasts the partial
  case.
- **Cancelled booking still viewable:** mobile should let the diner open
  the booking detail page even after cancel (for at least 30 days). The
  Payment Summary section should show grey "Refunded" badges (or "Paid"
  with no refund — for forfeit case) so the diner has a record.

---

## 7. Edge function API reference

All edge functions are at `https://exbjodmnpdiayfzrdyux.supabase.co/functions/v1/<name>`.
All accept JSON, return JSON, use POST except where noted.

### `create-public-payment-intent`

Mints a Stripe PaymentIntent against the restaurant's connected account.
Has TWO modes:

**Mode A — one-time card (anon, default):**
- **Body:** `{ restaurant_id, amount_cents }`
- **Returns:** `{ mode: "one_time", client_secret, payment_intent_id, amount_cents, application_fee_cents, destination }`
- Mobile mounts PaymentSheet with the `client_secret` and calls `stripe.confirmPayment`.

**Mode B — saved card (Phase 4, JWT-required):**
- **Body:** `{ restaurant_id, amount_cents, saved_card_id }`
- **Returns:** one of:
  - `{ mode: "saved_card", status: "succeeded", payment_intent_id, ... }` — done, fire onPaid.
  - `{ mode: "saved_card", status: "requires_action", payment_intent_id, client_secret }` — call `stripe.handleNextAction(clientSecret)` for SCA.
  - `{ mode: "saved_card", status: "failed", error }` — declined.
- Same destination-charge architecture (no Connect cloning needed).
- **Failure modes:** restaurant not Stripe-onboarded; saved_card_id doesn't belong to caller; Stripe declined; SCA required.

### `create-public-booking`

Atomically books the reservation (and writes the order if `items` is
non-empty). Uses an advisory lock + exclusion constraint to serialize
against other diners booking the same slot.

- **Body:** `{ restaurant_id, reserved_at, party_size, shift_id,
  guest_name, guest_email, guest_phone, special_request, items: [],
  applied_promo_code, payment_intent_id }`
- **Returns (success):** `{ reservation_id, confirmation_code,
  deposit_required, deposit_amount_cents, order_id }`
- **Returns (slot taken):** `{ error, unavailable_reason: "slot_taken" }`
  with HTTP 409. **Mobile MUST call refund-payment-intent here.**
- **Returns (diner double-book):** `{ unavailable_reason: "diner_double_book" }`
  with HTTP 409.
- **Anon-callable:** yes

### `mark-order-paid`

Flips an `orders` row from `pending` to `paid` after Stripe confirms.

- **Body:** `{ order_id, payment_intent_id }`
- **Returns:** `{ order: { id, status, paid_at } }`
- **Anon-callable:** yes; server re-verifies the PI with Stripe before
  trusting the status flip.

### `prepare-deposit`

Inserts `reservation_deposit_payments` rows (one per payer). Frontend
currently always sends 1 payer; multi-payer split is schema-supported but
not yet wired in UI.

- **Body:** `{ reservation_id, payers: [{ email, full_name, amount_cents,
  user_profile_id? }] }`
- **Returns:** `{ reservation_id, deposit_amount_cents,
  payments: [{ id, payer_email, payer_full_name, amount_cents, status,
  pay_url }] }`
- **Anon-callable:** yes

### `confirm-deposit-paid` ⭐ (the recent addition)

Flips a `reservation_deposit_payments` row to `charged` with the real PI.
Service-role write, mirrors `mark-order-paid`. Re-verifies the PI with
Stripe (status must be `succeeded` or `processing`, amount must be ≥
deposit amount).

- **Body:** `{ payment_id, payment_intent_id }`
- **Returns:** `{ deposit: { id, reservation_id, status: "charged",
  amount_cents, stripe_payment_intent_id, paid_at } }`
- **Idempotent:** retried call with same params returns
  `{ deposit, idempotent: true }`.
- **Anon-callable:** yes; security comes from re-verifying the PI.
- **Failure cases:** PI not paid → 400 with the Stripe status in error;
  PI amount < deposit → 400 (anti-fraud); bogus PI id → 500 with Stripe's
  "No such payment_intent" error.

### `cancel-reservation`

Handles diner cancels + owner cancels + refunds + 24h forfeit cliff.

- **Body (diner):** `{ reservation_id }` (Bearer auth) OR `{ reservation_id,
  confirmation_code }` (guest path)
- **Body (owner/staff, Phase 6):** `{ reservation_id, actor: "owner" }` —
  Bearer auth required, caller must have a role on the restaurant.
  Owner-cancels SKIP the 24h cliff (always refund).
- **Returns:** `{ ok, status: "cancelled", refunds: [], refund_total_cents,
  forfeit_total_cents, within_24h, actor, notification_delivery, ... }`
- **Auth:** Bearer JWT OR confirmation_code (diner). Bearer JWT required
  for `actor: "owner"`. Without auth: 401.

### `modify-reservation`

Moves a reservation to a new slot AND recalcs the deposit (Phase 8).

- **Body:** `{ reservation_id, date, time, party_size, special_request }`
- **Returns:** `{ ok, reservation_id, reserved_at, party_size,
  deposit_adjustment: { kind: "none" | "charged" | "refunded" | "failed",
  amount_cents, payment_intent_id } }`
- **Failure cases:**
  - `unavailable_reason: "modify_requires_card"` (HTTP 402) — party
    increased, deposit delta needs to be charged, but the diner has
    no saved card. Mobile prompts diner to add a card (via
    SetupIntent flow) then retries.
  - Other unavailable_reasons: `slot_taken`, `diner_double_book`,
    `closed`, `past_shift_close`, etc.
- **Auth:** Bearer JWT OR confirmation_code.

### `stripe-attach-payment-method` (Phase 4, JWT-required)

Saves a card to the diner's Stripe Customer + inserts a `saved_cards`
row. Called by the booking checkout after a one-time PI succeeds AND
the diner ticked "save card."

- **Body:** `{ payment_intent_id }`
- **Returns:** `{ saved_card: { id, brand, last4, exp_month, exp_year,
  is_default } }`
- **Idempotent:** existing row with same `pm_id` returns
  `{ saved_card, idempotent: true }`.
- **Auth:** Bearer JWT.

### `stripe-setup-intent` (existing)

Creates a Stripe Customer (if missing) + SetupIntent for AccountPage's
"add a card" flow. Mobile uses the same when surfacing a Payment
Methods management screen.

- **Returns:** `{ client_secret }` for PaymentSheet/SetupSheet to confirm.
- **Auth:** Bearer JWT.

### `stripe-list-methods` (existing)

Lists the diner's saved cards. Used to populate the saved-card picker
on booking + the Payment Methods management screen.

- **Returns:** `{ methods: [{ id, brand, last4, exp_month, exp_year, is_default }] }`
- **Auth:** Bearer JWT.

### `merge-diner-accounts` (Phase 5, JWT-required)

Merges two diner accounts (same email or phone, different auth_user_ids)
under the older one. Re-points all FK rows (reservations, saved_cards,
guests, deposits, reviews, alerts, etc.) and hard-deletes the duplicate
auth.users via `auth.admin.deleteUser`. Audit row written to
`account_merge_audit`.

- **Body:** `{ canonical_auth_user_id, archived_auth_user_id }`
- **Auth:** Bearer JWT; caller must be signed in as ONE of the two
  accounts. Defensive email/phone-match check between profiles before
  merging.
- **Returns:** `{ ok, audit_id, counts: { reservations, saved_cards,
  guests, deposits, ... } }`
- **Irreversible** — no undo. Audit log provides forensics.

### `get-deposit-payment-context` (Phase 7, anon)

Powers the public `/deposit/:id` page. Returns the data needed to
display "Hi {payer}, {organizer} booked dinner at {restaurant}, you
owe $X" plus enough to mount Stripe Elements.

- **Body:** `{ payment_id }`
- **Returns:** `{ payment, reservation, restaurant }` — see web's
  `DepositPayPage.tsx` for the shape.
- **Anon-callable:** yes. UUID is the security token.

### `dispatch-deposit-invites` (Phase 7, anon)

After a diner enables split-deposit at booking, fires after the diner's
deposit row is `charged` to email each pending payer their magic link
to `/deposit/<row_id>`. Idempotent: only emails rows with
status='pending' AND `stripe_payment_intent_id IS NULL`.

- **Body:** `{ reservation_id, app_origin?, organizer_email? }`
- **Returns:** `{ ok, total_rows, sent, skipped, failed }`
- **Anon-callable:** yes. Email-only for v1 (no SMS — schema lacks
  payer_phone).

### `refund-payment-intent`

Race-recovery only. Refunds a Stripe PI without writing any DB row. The
caller (mobile or web) is responsible for any DB bookkeeping.

- **Body:** `{ payment_intent_id, reason }`
- **Returns:** `{ refund_id, status, amount }`
- **Anon-callable:** yes. Only meant for the slot-taken race; not a
  generic refund button.

---

## 8. Database schema for payments (read-only from mobile)

Mobile reads these tables directly via Supabase REST API. RLS does the
authorization — never trust client-side filters as security boundaries.

### `orders`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `reservation_id` | uuid FK | |
| `restaurant_id` | uuid FK | |
| `guest_id` | uuid FK | Diner's guest record |
| `status` | text | `pending`, `paid`, `refunded` |
| `stripe_payment_intent_id` | text nullable | `pi_*` |
| `total_amount` | numeric | Decimal dollars, NOT cents |
| `is_preorder` | boolean | true for pre-order, false for in-person orders |
| `paid_at` | timestamptz | |

RLS: diners SELECT their own (via `guest_id` → user_profile join). UPDATE
is staff-only (the `orders_update_staff` policy) — that's why
`mark-order-paid` runs server-side with service-role.

### `order_items`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `order_id` | uuid FK | |
| `name` | text | Snapshot at order time (not joined to `menu_items`) |
| `quantity` | integer | |
| `unit_price` | numeric | Decimal dollars |
| `line_total` | numeric | |

### `reservation_deposit_payments`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `reservation_id` | uuid FK | |
| `payer_email` | text | Required (check constraint) |
| `payer_full_name` | text | |
| `payer_user_profile_id` | uuid nullable | If diner is logged in |
| `amount_cents` | integer | Cents, NOT dollars |
| `status` | text | `pending`, `charged`, `refunded`, `failed` |
| `stripe_payment_intent_id` | text nullable | `pi_*` after charge |
| `paid_at` | timestamptz | |

RLS: `rdp_diner_select` lets diners SELECT rows where they're the payer
or own the reservation. `rdp_owner_select` lets restaurant staff SELECT.
UPDATE is service-role-only — both `confirm-deposit-paid` and
`cancel-reservation` use service-role for the flip.

### `reservations` (payment-relevant columns only)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `status` | text | `pending_payment`, `confirmed`, `cancelled`, `seated`, `completed`, `no_show` |
| `deposit_status` | text | `none`, `pending`, `charged` |
| `deposit_stripe_payment_intent_id` | text | DEPRECATED on diner side. The actual PI is on `reservation_deposit_payments.stripe_payment_intent_id`. Use that. |
| `deposit_amount_cents` | integer | Snapshot of expected deposit |
| `preorder_order_id` | uuid FK | Points at the linked `orders` row if any |
| `cancellation_reason` | text | Human-readable when status='cancelled' |

### `restaurants` (payment-relevant)

| Column | Notes |
|---|---|
| `stripe_account_id` | Connected account id. `acct_*` |
| `stripe_charges_enabled` | KYC verified, can accept charges |
| `stripe_payouts_enabled` | Can receive payouts |
| `subscription_status` | `trialing`, `active`, `canceled`, etc. |
| `deposit_tiers` | JSONB `[{min_party_size, amount_per_person_cents}, ...]` |
| `currency` | `CAD` |

Mobile reads `deposit_tiers` only to display "Deposit required for
parties of N+" hints. Compute amounts via the RPC, not in client code.

---

## 9. Queries mobile needs

### "Does this reservation have any payments?" (for cancel-confirm copy)

```ts
const [orders, deposits] = await Promise.all([
  supabase.from("orders")
    .select("status, total_amount")
    .eq("reservation_id", reservationId),
  supabase.from("reservation_deposit_payments")
    .select("status, amount_cents")
    .eq("reservation_id", reservationId),
]);

const paidCents =
  orders.data.filter(o => o.status === "paid")
    .reduce((s, o) => s + Math.round(Number(o.total_amount) * 100), 0) +
  deposits.data.filter(d => d.status === "charged")
    .reduce((s, d) => s + d.amount_cents, 0);

// Use paidCents > 0 to decide which dialog copy to show.
```

### Payment summary for a single reservation (booking detail screen)

```ts
const [{ data: orders }, { data: deposits }] = await Promise.all([
  supabase.from("orders")
    .select("id, status, total_amount, stripe_payment_intent_id, is_preorder, order_items(id, name, quantity, unit_price)")
    .eq("reservation_id", reservationId),
  supabase.from("reservation_deposit_payments")
    .select("id, amount_cents, status, payer_full_name, paid_at")
    .eq("reservation_id", reservationId),
]);
```

Render badge: `paid` → green "Paid"; `refunded` → grey "Refunded" with
struck-through total; `pending` → amber "Pending"; `failed` → red
"Failed".

### Preview deposit before checkout

```ts
const { data: cents } = await supabase
  .rpc("compute_deposit_for_party", {
    p_restaurant_id: restaurantId,
    p_party_size: partySize,
  });
// cents: number | null (null = no deposit required for this party size)
```

---

## 10. Status enum reference

```
reservations.status: pending_payment | confirmed | cancelled | seated | completed | no_show
orders.status: pending | paid | refunded
order_items.status: ordered | preparing | ready | served | cancelled
reservation_deposit_payments.status: pending | charged | refunded | failed
```

Mobile should treat unknown values defensively (display the raw string)
in case a future migration adds new states.

---

## 11. Error responses & user-facing messages

| Edge fn error | Likely cause | User-facing message |
|---|---|---|
| `slot_taken` (409) | Race window after Stripe success | "That time was taken right as you paid. Your card has been refunded — pick another slot." |
| `diner_double_book` (409) | Diner already has overlapping reservation | "You have another booking at this time. Cancel that one first or pick a different slot." |
| `Past reservations cannot be cancelled` | Trying to cancel a reservation in the past | "This reservation has already happened — it can't be cancelled." |
| `PaymentIntent not paid` from `mark-order-paid` / `confirm-deposit-paid` | Stripe declined, network issue | "We couldn't confirm your payment. Please try again or use a different card." |
| `Rate limited` (429) | Too many cancel/book attempts | "You're going too fast — wait a moment and try again." |
| `Edge Function returned a non-2xx status code` | The Supabase SDK wrapper hides `body.error` | **Use raw fetch + parse body.error**. See web's `BookingDetailsPage.tsx` for the pattern. |

**Important:** when calling edge functions from mobile, use the native
HTTP client (URLSession on iOS, OkHttp on Android, fetch on RN) NOT the
Supabase SDK `functions.invoke()` — that wraps the error body as a
generic "non-2xx" message and you lose the real reason. Web hit this and
fixed it by switching to raw fetch + parsing `body.error`.

---

## 12. Test cards (Stripe test mode)

Use these only when `STRIPE_SECRET_KEY` is `sk_test_*` and the
publishable key starts with `pk_test_*`. Verify by checking the Stripe
Dashboard has the yellow "TEST DATA" banner.

| Card | Behavior |
|---|---|
| `4242 4242 4242 4242` | Generic success (most-used) |
| `4000 0025 0000 3155` | Requires 3D Secure / SCA |
| `4000 0000 0000 9995` | Insufficient funds decline |
| `4000 0000 0000 0002` | Generic decline |
| `4000 0000 0000 0119` | Charge processing error |
| `4000 0012 4000 0000` | Canadian Visa (succeeds, useful for CA testing) |

For any test card: any future expiry (`12/29`), any 3-digit CVC (`123`),
any name/postal. Amex test card `3782 822463 10005` uses a 4-digit CVC.

---

## 13. Webhooks (server-side, mobile doesn't subscribe directly)

Mobile does NOT register Stripe webhooks. The platform's `stripe-webhook`
edge function (already deployed) handles:

| Event | What the server does |
|---|---|
| `account.updated` | Mirrors `stripe_charges_enabled`, `stripe_payouts_enabled`, `stripe_details_submitted` onto `restaurants` |
| `account.application.deauthorized` | Clears `stripe_account_id` + KYC flags (restaurant disconnected) |
| `customer.subscription.created/updated` | Mirrors `subscription_status`, `trial_ends_at` |
| `customer.subscription.deleted` | Sets status canceled, flips `is_published=false` |
| `payment_intent.*` | Logged only — deposit flow already updates DB synchronously via `confirm-deposit-paid` |
| `invoice.payment_failed` | Logged only |

Mobile is notified of state changes via Supabase Realtime subscriptions
on `reservations` and `restaurants` tables — same pattern web uses. See
`DINER_MOBILE_GUIDE.md` section on realtime.

---

## 14. Security checklist

- ✅ **Never** embed the Stripe secret key in mobile. Only the
  publishable key.
- ✅ **Never** call Stripe's API directly from mobile (except via the
  Stripe SDK which uses the publishable key for tokenization only).
- ✅ All amount/fee calculations server-side. Mobile only displays.
- ✅ Card tokenization happens inside the Stripe SDK PaymentSheet — the
  app never touches raw PAN.
- ✅ Validate PI ids with `confirm-deposit-paid` / `mark-order-paid`
  server-side — never trust the mobile-provided PI without re-fetching
  from Stripe.
- ✅ Surface the real cancellation policy at booking time AND at cancel
  time. The 24h cliff is non-trivial money loss; don't surprise the
  diner.
- ✅ For diners not logged in (guest bookings), the confirmation_code is
  the security token for cancel/modify. Mobile should store it in
  Keychain/Keystore for guest sessions.

---

## 15. Implementation order (recommended)

1. **SDK setup + tokenization smoke test.** Initialize Stripe SDK, mount
   PaymentSheet against a test PI generated by your dev backend. Confirm
   a `4242...` charge end-to-end.
2. **Pre-order checkout flow** (section 4). Wire all 6 steps. Test on a
   restaurant with no deposit policy first to keep the surface small.
3. **Race-window recovery** (section 4c). Force the race by booking the
   last seat from the web, then trying to book it from mobile. Verify
   `refund-payment-intent` fires and the diner sees the recovery message.
4. **Deposit-only flow** (section 5). Test with a party of 8 at Mark
   Testing — deposit policy kicks in at `min_party_size=8`,
   `$10/person`, so an 8-person booking = $80 deposit.
5. **Combined pre-order + deposit flow.** Same as #4 but add a menu
   item. Single PaymentIntent covers both. Verify both `orders` row AND
   `reservation_deposit_payments` row land in their respective `paid` /
   `charged` states.
6. **Payment Summary on booking detail.** See section 9. Display
   pre-order line items + deposit cards with status badges.
7. **Cancel flow + 24h cliff** (section 6). Confirm dialog copy varies
   by time-to-reservation. Toast message varies by refund/forfeit
   outcome. Cancelled bookings remain viewable.
8. **Error paths.** Decline, insufficient funds, SCA required, network
   timeouts. Use the test cards in section 12.
9. **Final integration test.** Real card, real PI, full loop, verify
   restaurant's Stripe Dashboard shows the destination charge + app fee.

---

## 16. Saved cards on booking (Phase 4)

On checkout, if the diner is logged in AND has ≥1 saved card, swap the
PaymentSheet for a "Pay with •••• 4242" radio picker. Cuts repeat
bookings to one tap.

### 16a. The picker

Fetch saved cards via `stripe-list-methods` on checkout mount. If
`methods.length > 0`, render:

```
Pay with:
●  Visa •••• 4242 (Default)
○  Mastercard •••• 5555
○  + Use a different card  →  expands to PaymentSheet
```

### 16b. Charging a saved card

On submit with a saved card selected:

```
POST /functions/v1/create-public-payment-intent
{
  restaurant_id,
  amount_cents,
  saved_card_id  // <-- the saved_cards.id
}
Authorization: Bearer <jwt>
```

Server confirms the PI off-session in one call. Response:

- `status: "succeeded"` → fire onPaid, continue to `create-public-booking`.
- `status: "requires_action"` → call `stripe.handleNextAction(client_secret)`. On success, fire onPaid.
- `status: "failed"` → surface the error.

### 16c. Save-card-on-new checkbox

When the diner enters a fresh card (one-time mode), show a checkbox
"☑ Save this card for faster checkout next time" (default checked).
After the PI confirms, fire-and-forget:

```
POST /functions/v1/stripe-attach-payment-method
{ payment_intent_id }
Authorization: Bearer <jwt>
```

This attaches the PM to the diner's Stripe Customer + inserts a
`saved_cards` row. Idempotent. Never block the booking success on
this — the booking is already done.

### 16d. Guest checkouts

Anonymous diners (no JWT) skip all of the above. They use one-time
mode only, no save-card checkbox.

---

## 17. Cross-device account linking (Phase 5)

Two flows for keeping a diner from accidentally creating duplicate
accounts (Apple on iPhone + Google on laptop).

### 17a. Reactive merge prompt

After successful sign-in (any provider), query `user_profiles` for
another row with matching email OR phone but a different
`auth_user_id`. If found, show a modal: "We found another Cenaiva
account using this email. Link them together?"

On confirm, POST to `merge-diner-accounts` with both auth_user_ids.
Server re-points FK rows + hard-deletes the duplicate. After success,
force a hard reload (the diner's session may have been killed by the
auth.users delete if they were on the duplicate).

### 17b. Proactive linking

`/account/connected-accounts` page lists every identity attached to
the current auth.users (via `client.auth.getUserIdentities()`). Each
has a Disconnect button (last identity can't be removed). "Link Apple/
Google" buttons fire `client.auth.linkIdentity({ provider })` which
redirects through OAuth and attaches the new identity to the CURRENT
user — no merge needed.

Mobile equivalent on iOS/Android uses the native Apple/Google sign-in
SDK then calls `client.auth.linkIdentity` with the resulting id_token.

---

## 18. Multi-payer deposit split (Phase 7)

Diner can invite friends to chip in their share of the deposit at
booking time.

### 18a. The checkout-side toggle

When `previewDepositDollars > 0`, show "Split deposit with friends"
checkbox. When toggled, render N payer rows (name + email each), up
to `party_size - 1` friends. Equal split:
`each = totalDeposit / (1 + friends.length)`.

The diner pays only their share inline. `totalNow` becomes
`preorder + (deposit / (1 + friends.length))`.

### 18b. The booking call sequence

After the diner's Stripe payment succeeds:

```
1. create-public-booking → reservation created in pending_payment
2. prepare-deposit with payers: [diner_share, ...friend_shares]
   → returns N payment rows (diner is index 0)
3. confirm-deposit-paid with payments[0].id + diner's PI id
   → marks diner's row 'charged'
4. dispatch-deposit-invites with reservation_id + app_origin +
   organizer_email
   → server emails each friend a link to /deposit/<row_id>
```

Reservation stays `pending_payment` until ALL deposit rows are
charged. The settle trigger handles the flip to `confirmed`.

### 18c. The public `/deposit/:id` page

Mobile equivalent of the web `DepositPayPage`. Anonymous (no auth
required — UUID in URL is the security token).

```
1. POST /functions/v1/get-deposit-payment-context { payment_id }
   → returns { payment, reservation, restaurant }
2. Show "Hi {payer.full_name}, {organizer.full_name} booked dinner
   at {restaurant.name} on {reserved_at}. Pay your share of {amount}."
3. Mount Stripe PaymentSheet for that exact amount.
4. On confirm, POST /functions/v1/confirm-deposit-paid with
   payment_id + payment_intent_id.
5. Show success state.
```

Deep-link: register `cenaiva://deposit/:id` as a Universal Link
(iOS) / App Link (Android) so emailed magic links open the mobile
app directly to the pay screen instead of the browser.

### 18d. Known limitations

- Email-only invites (no SMS) — `reservation_deposit_payments`
  schema lacks `payer_phone`. Future enhancement.
- No payer-payment timeout. If a friend never pays, reservation stays
  `pending_payment` indefinitely. Organizer or restaurant must cancel
  manually.

---

## 19. Modify-reservation deposit recalc (Phase 8)

When the diner changes party size on an existing reservation, the
deposit auto-reconciles:

- Party UP → server charges the delta on the diner's default saved
  card off-session via the same destination-charge pattern.
- Party DOWN → server partial-refunds the delta via Stripe.
- No saved card on file AND charge needed → returns 402 with
  `unavailable_reason: "modify_requires_card"`. Mobile prompts the
  diner to add a card before retrying.

`modify-reservation` response carries `deposit_adjustment: { kind,
amount_cents, payment_intent_id }` so the mobile toast can be
specific:

- `kind: "charged"` → "$X added to your deposit on file"
- `kind: "refunded"` → "$X refunded to your card"
- `kind: "failed"` → "Reservation modified, but we couldn't adjust
  your deposit automatically. The restaurant will reach out."
- `kind: "none"` → "Reservation modified" (party size unchanged or
  no deposit applies)

---

## 20. Owner-side cancel with refund (Phase 6)

When a restaurant cancels a diner's reservation from the dashboard,
the diner ALWAYS gets refunded (24h cliff doesn't apply — restaurant-
initiated, diner shouldn't be punished).

Dashboard-side: pass `actor: "owner"` to `cancel-reservation`. The
edge fn verifies the caller has a role on the restaurant via
`user_restaurant_roles`. Refunds happen the same way (Stripe refund
+ DB flip to `refunded`).

Diner-side mobile UX: when the diner views a reservation that was
cancelled with `cancellation_reason = "Cancelled by restaurant"`,
show a different banner: "This reservation was cancelled by
{restaurant_name}. Your $X.XX has been refunded."

---

## Reference paths in repo (web canonical implementation)

When in doubt, mirror what the web does. The web's deferred-PI flow is
the most-tested production code path; mobile should match call ordering
and error handling closely.

- `apps/web/src/pages/customer/RestaurantPublicPage.tsx` — `handlePlaceOrder`,
  `createReservationCore`, the full checkout flow (lines ~1700-2200).
  Search for "Phase 7" in comments to find the split-deposit logic.
- `apps/web/src/components/booking/StripePaymentForm.tsx` — dual-mode
  picker (Phase 4): saved-card path + one-time path with save-card
  checkbox + SCA fallback via `handleNextAction`.
- `apps/web/src/components/booking/SavedCardPicker.tsx` — would-be
  presentational sub-component; in current impl the picker is inlined
  in `StripePaymentForm.tsx`.
- `apps/web/src/pages/customer/BookingDetailsPage.tsx` — cancel flow,
  refund/forfeit toast variants, modify dialog with deposit_adjustment
  toast variants.
- `apps/web/src/pages/customer/BookingsPage.tsx` — list-page cancel
  dialog.
- `apps/web/src/pages/customer/DepositPayPage.tsx` — public
  `/deposit/:id` page (Phase 7).
- `apps/web/src/pages/customer/ConnectedAccountsPage.tsx` — proactive
  linking (Phase 5).
- `apps/web/src/pages/auth/AuthCallbackPage.tsx` — Apple first-signin
  name capture + duplicate-account merge prompt.
- `apps/web/src/pages/auth/PhoneLoginPage.tsx` — Phone OTP UI
  (SMS + WhatsApp transports).
- `apps/web/src/pages/auth/OnboardingPage.tsx` — missing-fields gate.
- `apps/web/src/components/customer/AccountLinkPrompt.tsx` — the
  merge prompt modal.
- `apps/web/src/hooks/useReservationPayments.ts` — Payment Summary
  fetcher (the query mobile should mirror).
- `supabase/functions/confirm-deposit-paid/index.ts` — service-role
  flip after diner pays.
- `supabase/functions/cancel-reservation/index.ts` — diner + owner
  cancel, 24h cliff, refund/forfeit logic.
- `supabase/functions/modify-reservation/index.ts` — slot move +
  deposit recalc (Phase 8).
- `supabase/functions/create-public-payment-intent/index.ts` — both
  one-time and saved-card paths.
- `supabase/functions/stripe-attach-payment-method/index.ts` — Phase 4.
- `supabase/functions/merge-diner-accounts/index.ts` — Phase 5.
- `supabase/functions/get-deposit-payment-context/index.ts` — Phase 7.
- `supabase/functions/dispatch-deposit-invites/index.ts` — Phase 7.
- `supabase/functions/_shared/stripe-refund.ts` — shared refund helper
  (server-side; supports full + partial refunds).

---

## Out of scope for diner mobile

- Restaurant onboarding (Stripe Connect KYC) — owner-side web wizard only.
- Subscription billing ($200/mo) — owner-side web only.
- Payouts dashboard / fee reporting — restaurants view this in their
  Stripe Dashboard directly; Cenaiva doesn't surface it.
- Split-tender / multi-payer deposits — schema supports it, UI doesn't
  yet. When wiring, mobile will send N payers in `prepare-deposit`'s body
  and call `confirm-deposit-paid` N times with each payer's PI id.
- Owner-side dashboard cancel + refund — not yet routed through
  `cancel-reservation`. When that ships, mobile will inherit the same
  behavior automatically.
- Tip-after-meal — out of scope; no flow exists yet.

This guide is current as of 2026-05-15. If you find drift between this
doc and code, update both in the same PR.
