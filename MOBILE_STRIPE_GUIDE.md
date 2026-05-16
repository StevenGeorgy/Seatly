# MOBILE_STRIPE_GUIDE.md — Wiring Stripe into the Cenaiva mobile diner app

Companion to `DINER_MOBILE_GUIDE.md` (general diner mobile handoff). This doc
covers everything money-related: how charges flow, which edge functions to
call, the schema shape of payment rows, the cancel / refund rules, and how
account deletion interacts with in-flight payments.

Mobile is a **consumer** of the platform's payment infrastructure. It does
not modify schema, does not call Stripe's secret API directly, and does not
mint PaymentIntents itself. Every interaction with money goes through a
Cenaiva edge function that holds the Stripe secret server-side.

If anything in this doc conflicts with code, **code is the source of
truth** — re-read the file the doc points at and update this guide. The
on-disk paths in this doc are relative to repo root
`/Users/mark_habbi/Seatly-12/`.

This guide is current as of **2026-05-16**.

---

## 1. Money model — who charges whom, who keeps what

Cenaiva uses Stripe Connect with **Custom** connected accounts (one per
restaurant). Every diner charge is a **destination charge**:
`transfer_data.destination = restaurant.stripe_account_id`. Result: the
money lands in the restaurant's Stripe balance the instant Stripe approves
the charge, minus a 5.5% platform application fee that stays with Cenaiva.

| Charge type | Who pays | Who receives | Platform fee | Stripe fee paid by |
|---|---|---|---|---|
| Pre-ordered food + tax | Diner | Restaurant | 5.5% (app fee) | Cenaiva |
| Booking deposit | Diner | Restaurant | 5.5% (app fee) | Cenaiva |
| Post-meal pay-the-bill (Phase 9) | Diner | Restaurant | 5.5% (app fee) | Cenaiva |
| Monthly subscription ($199 CAD) | Restaurant | Cenaiva platform | n/a | Cenaiva |
| Per-reservation fee ($1) | Restaurant | Cenaiva platform | n/a (billed monthly) | Cenaiva |

**Stripe processing fees** (~2.9% + 30¢ per card charge) come off Cenaiva's
platform balance per Stripe Connect's destination-charge default behavior.
Restaurants receive the full 94.5% of every diner charge — Cenaiva eats
the Stripe processing fee out of its 5.5% application fee.

**Cancellation policy** (2026-05-16, see §6): `cancel-reservation` issues
a **partial refund** of `(total − application_fee_amount)`. The diner gets
back only the restaurant's 94.5% slice; Cenaiva keeps the 5.5% as a
cancellation cost. Stripe's processing fee on the original charge is never
returned by Stripe — Cenaiva paid it and never recovers it.

**Net per cancelled $100 transaction:**
- Cenaiva: +$2.30 ($5.50 fee − $3.20 Stripe fee)
- Restaurant: $0 (took $94.50 on book, returned $94.50 on cancel via reverse-transfer)
- Diner: −$5.50 (lost the 5.5% commission as cancellation cost)
- Stripe: +$3.20 (processing fee, non-recoverable)

**Break-even** for Cenaiva: any transaction above **$11.54 CAD** is
profitable after Stripe fees. Mark Testing's 8+ deposit floor ($80) nets
+$1.78 per booking.

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
| Platform Customer (for restaurant sub) | Platform account | `stripe_customer_id` on `restaurants` row. Used for monthly billing only |
| Platform Customer (for diner card-on-file) | Platform account | `stripe_customer_id` on `user_profiles` row. Used for saved-card mode + post-meal charges |
| Diner card | Tokenized via Stripe SDK | Never stored in Cenaiva DB. Mobile uses Stripe's PaymentSheet or CardField; gets back a `pi_*` or `pm_*` token |

Mobile does NOT need its own Stripe publishable key handling — it uses the
**Cenaiva publishable key** (one key, platform-level). The destination
account routing happens server-side when the PaymentIntent is created.

### 2a. Why diners' saved cards live on the platform Customer, not the connected restaurant

A diner may book at any restaurant; storing their card on a specific
restaurant's connected account would lock them to that restaurant. Instead,
saved cards attach to a diner-owned `stripe_customer_id` on the platform.
When the diner books, two patterns apply:

- **Destination charge (pre-order + deposit, default flow):** PI is created
  on the platform with `payment_method` + `customer` + `transfer_data.destination`.
  The PM and Customer can live on platform; Stripe routes the funds.
- **Direct charge on connected account (post-meal pay-the-bill, Phase 9):**
  Server first **clones** the platform-account PM to the restaurant's
  connected account via `stripe.paymentMethods.create({ customer, payment_method }, { stripeAccount })`,
  then creates the PI on the connected account with the cloned PM. Cleaner
  refund semantics for post-meal flows. Same economics as destination charges.

Mobile never sees this distinction — both paths return the same response
shape from `create-public-payment-intent` / `stripe-charge-order`.

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
flows handled in the restaurant onboarding wizard (web, see §11).

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

### 4e. Required diner fields

`create-public-booking` requires BOTH `guest_email` AND `guest_phone`
(non-empty). The booking form on web makes the phone field required;
mobile must do the same. Email is used for confirmation emails + refund
notifications; phone is used for SMS confirmation + alerts. Normalize the
phone to E.164 on submit (`+1XXXXXXXXXX` for NA numbers — see
`apps/web/src/lib/validation/phone-schemas.ts`).

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

## 6. Cancellation flow (updated 2026-05-16)

Diner taps Cancel in the mobile booking detail screen. The mobile UI MUST
show a confirm dialog before the actual cancel fires.

**Policy (2026-05-16):** all cancels — diner, guest (confirmation-code
path), and owner — fully refund the restaurant's 94.5% slice to the diner.
Cenaiva keeps the 5.5% commission as a cancellation cost. The 24h cliff
that previously forfeited the entire amount **was removed**. There is no
longer a different code path based on time-to-reservation.

### 6a. Confirm-dialog copy

| State | Dialog body |
|---|---|
| Payments paid (orders or deposits exist) | "The restaurant will be notified, your table will be released, and $X.XX will be refunded to your original payment method (the 5.5% platform fee is non-refundable). This can't be undone." |
| No payments paid | "The restaurant will be notified and your table will be released. This can't be undone." |

The "$X.XX refunded" amount = sum of `orders.total_amount` (in paid status)
+ sum of `reservation_deposit_payments.amount_cents` (in charged status),
**minus** the 5.5% application fee on each. Mobile can preview this client-
side as `paidCents × 0.945` for display, but the server is authoritative
on the actual refund amount (uses real `application_fee_amount` from
Stripe — handles legacy 5% bookings correctly).

The "payments paid" check: SELECT `orders.status='paid'` rows +
`reservation_deposit_payments.status='charged'` rows tied to this
reservation. See §9.1 for the queries.

### 6b. On confirm

```
POST /functions/v1/cancel-reservation
Body: { reservation_id }
Auth: Bearer token (logged-in diner) or { confirmation_code } (guest-only path)
```

The server:
1. Validates ownership / confirmation code.
2. Rejects past reservations (`reserved_at < now`).
3. Flips `reservations.status='cancelled'`, sets `cancelled_at` and
   `cancellation_reason = "Cancelled by diner"`.
4. For each paid `orders` row: retrieves the PI's `application_fee_amount`
   from Stripe; issues a Stripe refund for `total − application_fee` so
   the diner gets back the restaurant's slice only; marks the order
   `refunded`.
5. Same partial-refund treatment for every `charged`
   `reservation_deposit_payments` row.
6. For multi-payer deposits, fires `notify-deposit-payers-refunded`
   fire-and-forget so non-organizer payers get an email explaining
   their refund.
7. Releases the reservation tables, fans out notify-me alerts to other
   diners watching the slot, sends a cancellation SMS/email.

### 6c. Response shape

```json
{
  "ok": true,
  "reservation_id": "...",
  "status": "cancelled",
  "refunds": [
    { "kind": "preorder"|"deposit", "ok": true,
      "payment_intent_id": "pi_...", "amount_cents": 9450 }
  ],
  "refund_total_cents": 9450,
  "actor": "diner",
  "notification_delivery": "delivered" | "skipped" | "failed"
}
```

The `refunds[].amount_cents` reflects what the diner actually got back
(post-fee). There is no longer a `forfeit_total_cents` field or
`within_24h` flag — both were removed when the cliff was removed.

### 6d. Mobile toast after success

```
if (refund_total_cents > 0 && every refund.ok)
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

### 6f. Owner-initiated cancel (Phase 6)

When a restaurant cancels a diner's reservation from the dashboard, the
diner experiences the same refund flow — but the SMS/email opener says
"…the restaurant had to cancel your reservation…" instead of the diner's
default opener. Mobile picks up the difference via `cancellation_reason`
on the reservation row (`"Cancelled by restaurant"` vs `"Cancelled by
diner"`). Diner-side mobile UX: show a different banner: "This reservation
was cancelled by {restaurant_name}. Your $X.XX has been refunded."

### 6g. Edge cases

- **Retried cancel:** the edge function is idempotent. Refunds use a
  `charge_already_refunded` backstop and the status filters
  (`'paid'`/`'charged'`) skip already-refunded rows. Safe to retry on
  network error.
- **Refund Stripe API fails:** the cancel still succeeds, the response
  carries the failure in `refunds[].error`. Mobile toasts the partial
  case.
- **PI retrieve fails (network blip / dead PI):** server falls back to a
  full refund (safe default — diner whole). This is the only path that
  refunds 100% instead of 94.5% under the new policy.
- **Cancelled booking still viewable:** mobile should let the diner open
  the booking detail page even after cancel (for at least 30 days). The
  Payment Summary section should show grey "Refunded" badges so the
  diner has a record.
- **Stub-mode deposits** (`DEPOSIT_STRIPE_STUB_MODE=true`,
  `stripe_payment_intent_id` is NULL): no Stripe refund call; the row is
  flipped to `'refunded'` in DB only. Mobile sees a "Refunded" badge
  identical to real-PI rows.
- **No-PI orders:** legacy/comped orders sometimes have `status='paid'`
  with `stripe_payment_intent_id=NULL`. `cancel-reservation` flips them
  to `'refunded'` in DB only (no Stripe call, no `refunds[]` entry, no
  toast saying money moved — just "Reservation cancelled").

---

## 7. Account deletion flow

When a diner taps "Delete account" in the mobile Account screen,
`delete-account` orchestrates the full teardown. This is type-to-confirm
and irreversible — the auth.users row is hard-deleted.

### 7a. Pre-flight

Mobile must present a typing-confirmation modal:

```
Type your email to delete your account: ___________________

This will:
  - Cancel and refund every upcoming reservation
  - Detach and delete every saved card
  - Permanently delete your profile, voice prefs, and all account data

This can't be undone.
```

The typed string is sent as `email_confirmation` to the edge function;
it must match the auth user's email exactly (case-insensitive).

### 7b. The call

```
POST /functions/v1/delete-account
Body: { email_confirmation: "diner@example.com" }
Auth: Bearer JWT
```

Rate limit: **3/hour per user**.

### 7c. What the server does (in order, on a single request)

1. **Decode JWT** → resolve `auth.users` row + `user_profiles` row.
2. **Validate `email_confirmation`** matches the auth user's email
   (case-insensitive). Mismatch → 400.
3. **Block if the user owns a restaurant.** If `user_restaurant_roles`
   has any row where `role='owner'`, the response is 409:
   `{ error: "Delete your restaurants first.", blockers: { owns_restaurants: true } }`.
   The diner must wind their restaurants down first via
   `/dashboard/settings` (Danger zone, `delete-restaurant` flow).
4. **Auto-cancel upcoming reservations.** For each row where
   `user_profile_id = profile.id`, `status IN ('confirmed',
   'pending_payment')`, and `reserved_at > NOW()`:
   - Server POSTs to `cancel-reservation` with the diner's bearer token
     and `actor: "diner"`. This triggers the full refund pipeline (partial
     refunds, notify-deposit-payers-refunded, table release, etc).
   - If any cancel fails, the entire account-delete aborts at this point.
     Already-cancelled reservations stay cancelled; nothing else is
     touched. Mobile surfaces the error and the diner can retry.
5. **Detach in-flight reservations** (`status IN ('seated', 'arriving')`):
   server runs an UPDATE setting `user_profile_id = NULL` so these rows
   survive the user_profiles cascade. The restaurant still has to close
   the meal out — we just remove the diner's identity. **These are NOT
   refunded** (the diner ate the food / is at the table).
6. **Detach Stripe saved cards.** For each row in `saved_cards` with a
   non-null `stripe_payment_method_id`: call
   `stripe.paymentMethods.detach(pm_id)`. Failures are logged-and-skipped
   (best-effort).
7. **Delete the Stripe Customer.** If `user_profiles.stripe_customer_id`
   is set: call `stripe.customers.del(cust_id)`. Failures are logged-and-
   skipped.
8. **Delete `loyalty_waitlist` row** (no FK cascade from user_profiles).
9. **Delete `user_profiles` row.** Cascades through FK chains for:
   `saved_cards` (gone), `notifications` (gone), `availability_alerts`
   (gone), `reviews`/`snaps` (per FK config), etc.
10. **Delete `auth.users` row** via `supabaseAdmin.auth.admin.deleteUser`.
    This hard-deletes the auth identity and all OAuth links.
11. **Delete avatar storage object** (best-effort).

### 7d. Response

Success:
```json
{
  "ok": true,
  "cancelled_reservation_ids": ["...", "..."],
  "refund_total_cents": 18900
}
```

Block (owns a restaurant):
```json
{
  "error": "Delete your restaurants first.",
  "blockers": { "owns_restaurants": true }
}
```

Partial failure mid-cancel (502): the response carries the offending
reservation id and Stripe error. Mobile shows: "Some refunds couldn't
process — please try again or contact support. Your account is still
active."

### 7e. Mobile toast after success

```
if (refund_total_cents > 0)
   "Account deleted. $X.XX refunded to your card."
else if (cancelled_reservation_ids.length > 0)
   "Account deleted. {N} upcoming reservation(s) cancelled."
else
   "Account deleted."
```

Then immediately sign the diner out and route to the sign-in screen.

### 7f. What's NOT deleted on the diner's side

- **Past completed/seated reservations with `user_profile_id` nulled.**
  These rows persist for restaurant analytics + accounting, with the
  diner's identity removed.
- **`guests` rows** linked to past reservations. The guest table is
  restaurant-side history.
- **Stripe charges / refunds.** Stripe retains its own ledger; deleting
  the Customer doesn't erase historical PaymentIntents on Stripe's side.
- **Voice transcripts.** Conversation logs scoped to the user_profiles
  cascade get deleted; longer-term Deepgram/ElevenLabs logs on their
  platforms are not touched.

### 7g. What if the diner has friends mid-payment on a split deposit?

If the diner ran a split-deposit (Phase 7) and friends haven't paid yet:
- Their `reservation_deposit_payments` rows are owned by the reservation,
  not the diner profile.
- Cancelling the diner's reservation in step 4 cascades the partial-refund
  logic for any *charged* friend rows; *pending* friend rows are just
  abandoned in DB (no Stripe call needed — those friends never paid).
- `notify-deposit-payers-refunded` emails friends whose charged shares
  got refunded.

### 7h. What if the diner is a co-payer on someone else's reservation?

If the deleting diner paid a share on someone else's split-deposit
reservation, their `reservation_deposit_payments` row is NOT cancelled
by step 4 (that step only handles reservations where they're the
organizer). The row's `payer_user_profile_id` becomes a stale reference,
but FK behavior (currently `ON DELETE SET NULL` per
`reservation_deposit_payments`) preserves the row so the restaurant still
sees the payment. The reservation organizer is unaffected.

---

## 8. Post-meal pay-the-bill flow (Phase 9)

When the meal is done and the restaurant generates the final bill, the
diner can pay through the mobile app using a saved card. This flow is
DIFFERENT from booking-time pre-orders:

- Booking-time pre-order uses a **destination charge** (PI on platform,
  funds transferred to restaurant).
- Post-meal pay-the-bill uses a **direct charge on the connected
  account** (PI on restaurant's account; PM cloned from platform).

### 8a. The call

```
POST /functions/v1/stripe-charge-order
Body: { order_id }
Auth: Bearer JWT
```

The server resolves the order → restaurant → connected account, clones
the diner's default `saved_cards.stripe_payment_method_id` to the
connected account, then creates + confirms a PaymentIntent directly on
that account with `application_fee_amount = round(totalCents * 0.055)`.

### 8b. Response

```json
{
  "ok": true,
  "total_charged": 78.50,
  "tip_amount": 12.00,
  "paid_at": "2026-05-16T18:42:11Z",
  "payment_intent_id": "pi_..."
}
```

Or, for SCA:
```json
{
  "ok": false,
  "requires_action": true,
  "client_secret": "...",
  "stripe_account_id": "acct_..."
}
```

When `requires_action`, mobile calls
`stripe.handleNextAction(clientSecret)` with the right account context
(the SDK needs to know the PI lives on the connected account, not the
platform — pass the `stripe_account_id` to the SDK call).

### 8c. Pre-flight guards

If the restaurant has no `stripe_account_id` or `stripe_charges_enabled
= false`, the server rejects with:
`{ ok: false, error: "This restaurant cannot accept payments right now. Please contact them directly." }` (HTTP 400).

If the diner has no saved card on file, the server rejects with:
`{ ok: false, error: "No saved card. Please add one in Account > Payment." }` (HTTP 400).

Mobile should pre-check `useSavedCards()` and route to the
"Add a card" flow (SetupIntent) before letting the diner tap "Pay bill."

---

## 9. Edge function API reference

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
- **Validation:** `guest_email` AND `guest_phone` both required.

### `mark-order-paid`

Flips an `orders` row from `pending` to `paid` after Stripe confirms.

- **Body:** `{ order_id, payment_intent_id }`
- **Returns:** `{ order: { id, status, paid_at } }`
- **Anon-callable:** yes; server re-verifies the PI with Stripe before
  trusting the status flip.

### `prepare-deposit`

Inserts `reservation_deposit_payments` rows (one per payer). Frontend
supports multi-payer split (Phase 7) — see §10.

- **Body:** `{ reservation_id, payers: [{ email, full_name, amount_cents,
  user_profile_id? }] }`
- **Returns:** `{ reservation_id, deposit_amount_cents,
  payments: [{ id, payer_email, payer_full_name, amount_cents, status,
  pay_url }] }`
- **Anon-callable:** yes

### `confirm-deposit-paid`

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

### `confirm-deposit-stub`

Local/dev-only: flips a deposit row to `charged` without minting a real
PI. Anon-callable. **Do not call from production mobile** — production
path is `confirm-deposit-paid` (real Stripe re-verification).

### `cancel-reservation`

Handles diner cancels + owner cancels. Always refunds the restaurant's
94.5% slice; Cenaiva keeps the 5.5% commission.

- **Body (diner):** `{ reservation_id }` (Bearer auth) OR `{ reservation_id,
  confirmation_code }` (guest path)
- **Body (owner/staff, Phase 6):** `{ reservation_id, actor: "owner" }` —
  Bearer auth required, caller must have a role on the restaurant via
  `user_restaurant_roles`.
- **Returns:** `{ ok, status: "cancelled", refunds: [], refund_total_cents,
  actor, notification_delivery, ... }`
- **Auth:** Bearer JWT OR confirmation_code (diner). Bearer JWT required
  for `actor: "owner"`. Without auth: 401.
- **Side effects:** Stripe partial refunds (94.5% of each paid order +
  charged deposit), DB row flips, table release, notify-me fan-out,
  notify-deposit-payers-refunded for non-organizer split-payers,
  cancellation SMS/email.

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

### `stripe-charge-order` (Phase 9)

Charges the diner's default saved card for a post-meal order on the
restaurant's connected account. See §8.

- **Body:** `{ order_id }`
- **Returns:** `{ ok, total_charged, tip_amount, paid_at, payment_intent_id }`
  or `{ ok: false, requires_action: true, client_secret, stripe_account_id }`
  for SCA.
- **Auth:** Bearer JWT.

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

### `stripe-setup-intent`

Creates a Stripe Customer (if missing) + SetupIntent for AccountPage's
"add a card" flow. Mobile uses the same when surfacing a Payment
Methods management screen.

- **Returns:** `{ client_secret }` for PaymentSheet/SetupSheet to confirm.
- **Auth:** Bearer JWT.

### `stripe-list-methods`

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
- **Stripe limitation:** the duplicate's `stripe_customer_id` is NOT
  merged. Cards on it become orphaned (visible in `saved_cards` but
  uncharge-able because Stripe won't charge a PM attached to a different
  Customer). Workaround: re-add the card after merging.

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

### `notify-deposit-payers-refunded` (Phase 6+)

Fired by `cancel-reservation` after each charged-deposit refund loop.
Sends a Resend email to each non-organizer payer whose row was just
refunded: "Your $X refund — {organizer}'s {restaurant} reservation was
cancelled."

- **Body:** `{ reservation_id, refunded_payer_ids: [...] }`
- **Returns:** `{ ok, sent, skipped, failed }`
- **Anon-callable:** yes; service-role internally. Rate limit 30/60s.
- **Mobile never calls this directly** — it's an internal fan-out from
  cancel-reservation.

### `find-reservation`

Anon-callable lookup for guests who lost their confirmation email. Two
modes (discriminated by `lookup_type`):

**Mode A — by confirmation code:**
- **Body:** `{ lookup_type: "code", code: "SEAT-ABCD" }` (or bare `"ABCD"`)
- **Returns:** `{ ok, reservation: { restaurant_slug, ... } }` on match;
  generic error on miss.
- **Rate limit:** 10/IP/hour.

**Mode B — by contact:**
- **Body:** `{ lookup_type: "contact", email, last_name }`
- **Returns:** ALWAYS the same generic toast — re-sends the original
  confirmation email/SMS if a match is found. Never reveals existence
  of a row to the caller.
- **Rate limit:** 5/IP/hour.

Mobile use case: an in-app "Find my reservation" screen for guests not
signed in, mirroring web's `/find-reservation`.

### `refund-payment-intent`

Race-recovery only. Refunds a Stripe PI without writing any DB row. The
caller (mobile or web) is responsible for any DB bookkeeping.

- **Body:** `{ payment_intent_id, reason }`
- **Returns:** `{ refund_id, status, amount }`
- **Anon-callable:** yes. Only meant for the slot-taken race; not a
  generic refund button.

### `delete-account`

Permanent diner account deletion. See §7 for the full flow.

- **Body:** `{ email_confirmation: <auth.users.email> }`
- **Returns:** `{ ok, cancelled_reservation_ids, refund_total_cents }`
- **Auth:** Bearer JWT.
- **Rate limit:** 3/hour per user.
- **Blockers:** owns a restaurant → 409 with
  `{ blockers: { owns_restaurants: true } }`.

---

## 10. Multi-payer deposit split (Phase 7)

Diner can invite friends to chip in their share of the deposit at
booking time.

### 10a. The checkout-side toggle

When `previewDepositDollars > 0`, show "Split deposit with friends"
checkbox. When toggled, render N payer rows (name + email each), up
to `party_size - 1` friends. Equal split:
`each = totalDeposit / (1 + friends.length)`.

The diner pays only their share inline. `totalNow` becomes
`preorder + (deposit / (1 + friends.length))`.

### 10b. The booking call sequence

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

### 10c. The public `/deposit/:id` page

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

### 10d. Known limitations

- Email-only invites (no SMS) — `reservation_deposit_payments`
  schema lacks `payer_phone`. Future enhancement.
- No payer-payment timeout. If a friend never pays, reservation stays
  `pending_payment` indefinitely. Organizer or restaurant must cancel
  manually.

---

## 11. Restaurant Stripe Connect (business side — out-of-scope but context)

Mobile diners don't onboard restaurants — that's a web-only wizard. But
to understand the data model, here's what restaurants go through at
signup. **Mobile must never trigger any of these flows** — diner mobile
should refuse to render a restaurant-side flow even if instructed.

### 11a. The 8-step onboarding wizard

The owner signs up via `/setup` (gated by `<RequireAuth>`). The wizard
saves to `restaurants` row across 8 steps:

1. Basics (name, slug, cuisine, owner contact)
2. Location (address geocoded + Google Place id)
3. Hours (per-day open/close)
4. Tables (floor plan)
5. Photos (cover, logo, gallery — 5MB cap via `assertImageSizeOk`)
6. Menu (categories + items + prices)
7. Deposit policy (tiers JSONB)
8. Payment setup (THE STRIPE STEP — see below)

The publish-gate trigger `enforce_publish_gate()` on `restaurants` BEFORE
UPDATE blocks `is_published=false→true` transitions unless ALL of:
- `is_active = true`
- `stripe_charges_enabled = true` (from `account.updated` webhook)
- `subscription_status IN ('trialing', 'active')`
- `cover_photo_url IS NOT NULL`

The client-side check in Step 8 is for UX; the trigger is the trust
boundary (savvy actor can't bypass via direct supabase-js writes).

### 11b. Step 8 — what Stripe wire-up looks like

Step 8 mounts two Stripe components side-by-side:

**Part A — Stripe Connect Embedded Onboarding (KYC):**
- Edge fn `create-stripe-account` creates a Connect Custom account
  (country=CA, business_type=company, mcc=5812 Eating Places,
  card_payments + transfers capabilities, daily payout schedule).
  Idempotent — re-running just retrieves the current state.
- Edge fn `create-account-session` mints a short-lived Account Session
  for the embedded onboarding component.
- Web component `<ConnectAccountOnboarding />` from `@stripe/react-connect-js`
  renders Stripe's hosted KYC flow inline (business details, beneficial
  owners, banking, identity verification).
- On the `onExit` callback, the page polls the restaurant row for ~30s
  waiting for `stripe_charges_enabled` to flip true via webhook.

**Part B — Subscription card (Stripe Billing):**
- Edge fn `create-subscription` creates a platform-level Stripe Customer
  (NOT on the connected account), attaches the payment method, sets it
  as default, then `stripe.subscriptions.create` with:
  - `STRIPE_SUBSCRIPTION_PRICE_ID` (the $199 CAD/mo recurring Price)
  - `trial_period_days: 90`
  - `payment_behavior: "default_incomplete"`
- Persists `stripe_customer_id`, `subscription_status`, `trial_ends_at`
  to the restaurant row.

### 11c. The publish gate UI

The "Publish my restaurant" button is gated client-side on all four
publish-gate conditions. When all green, the button enables. When the
diner taps publish, an UPDATE on `restaurants` sets `is_published=true`;
the DB trigger re-verifies all four gates before allowing the write.

### 11d. stripe-webhook event mapping

The platform's webhook handler maps Stripe events to DB updates:

| Event | DB effect |
|---|---|
| `account.updated` | Mirrors `stripe_charges_enabled`, `stripe_payouts_enabled`, `stripe_details_submitted` onto `restaurants` |
| `account.application.deauthorized` | Clears `stripe_account_id` + KYC flags (restaurant disconnected from Cenaiva platform) |
| `customer.subscription.created/updated` | Mirrors `subscription_status`, `trial_ends_at` |
| `customer.subscription.deleted` | Status=canceled, flips `is_published=false` (graceful unpublish) |
| `customer.subscription.trial_will_end` | Logged only (notification to owner is owner-side concern) |
| `payment_intent.*` | Logged only — deposit flow updates DB synchronously via `confirm-deposit-paid`, not via webhook |
| `invoice.payment_failed` | Logged only |

In-memory dedupe of recent event IDs (prevents reprocessing on retries).
Signature verification via `constructEventAsync`.

### 11e. Drafts as a product surface

Restaurants in the middle of the wizard (`is_published=false`) live at
`/drafts`. Mobile is not expected to render this — it's owner-side only.
A `cleanup_stale_restaurant_drafts()` pg_cron job runs daily at 03:00
UTC, deleting unpublished drafts older than 30 days.

### 11f. Operational notes for the platform team

- **Stripe Price for $199/mo subscription:** Stripe doesn't allow editing
  existing Price amounts. To change the subscription price, create a NEW
  Price on the Cenaiva subscription Product, copy the new `price_…` id,
  and update env var `STRIPE_SUBSCRIPTION_PRICE_ID` in Supabase project
  settings. The old Price stays in Stripe but is unused for new
  subscriptions.
- **Existing subscribers** are not auto-migrated to new Prices — that
  requires individual Stripe API calls. As of 2026-05-16 there are zero
  live subscribers so no migration is needed.

---

## 12. Database schema for payments (read-only from mobile)

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

### `saved_cards`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | references `user_profiles.id` |
| `stripe_payment_method_id` | text | `pm_*` on platform Customer |
| `brand` | text | "visa", "mastercard", "amex", ... |
| `last4` | text | |
| `exp_month` | int | |
| `exp_year` | int | |
| `is_default` | boolean | |
| `created_at` | timestamptz | |

RLS: diner SELECT/INSERT/DELETE their own. Server-side cleanup on
`delete-account` (Stripe PM detach + Customer delete).

### `user_profiles` (payment-relevant)

| Column | Notes |
|---|---|
| `id` | uuid PK |
| `auth_user_id` | FK to `auth.users` |
| `stripe_customer_id` | text nullable. `cus_*` on platform |
| `email`, `phone`, `full_name` | Profile completeness gate uses all three |

The `on_auth_user_created` trigger guarantees a row exists for every
`auth.users` row, but fields may be NULL. `RequireCompleteProfile` gates
on all three being non-empty.

### `reservations` (payment-relevant columns only)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_profile_id` | uuid nullable | Nulled on diner delete-account for `seated`/`arriving` rows |
| `status` | text | `pending_payment`, `confirmed`, `cancelled`, `arriving`, `seated`, `completed`, `no_show` |
| `deposit_status` | text | `none`, `pending`, `charged` |
| `deposit_stripe_payment_intent_id` | text | DEPRECATED on diner side. The actual PI is on `reservation_deposit_payments.stripe_payment_intent_id`. Use that. |
| `deposit_amount_cents` | integer | Snapshot of expected deposit |
| `preorder_order_id` | uuid FK | Points at the linked `orders` row if any |
| `cancellation_reason` | text | Human-readable when status='cancelled'. Values: `"Cancelled by diner"`, `"Cancelled by restaurant"`, `"Cancelled via Cenaiva"` |

### `restaurants` (payment-relevant)

| Column | Notes |
|---|---|
| `stripe_account_id` | Connected account id. `acct_*` |
| `stripe_customer_id` | Platform-account customer for subscription billing. `cus_*` |
| `stripe_charges_enabled` | KYC verified, can accept charges (mirrored by webhook) |
| `stripe_payouts_enabled` | Can receive payouts |
| `stripe_details_submitted` | Onboarding complete |
| `subscription_status` | `trialing`, `active`, `past_due`, `canceled`, etc. |
| `trial_ends_at` | timestamptz |
| `deposit_tiers` | JSONB `[{min_party_size, amount_per_person_cents}, ...]` |
| `currency` | `CAD` |
| `is_active` | bool — owner can publish |
| `is_published` | bool — gated by trigger on all 4 publish conditions |

Mobile reads `deposit_tiers` only to display "Deposit required for
parties of N+" hints. Compute amounts via the RPC, not in client code.

### `account_merge_audit`

Audit trail for `merge-diner-accounts`. RLS denies all SELECT — only
service-role / support can read. Records canonical+archived ids, matched
contact field, and counts of moved rows.

---

## 13. Queries mobile needs

### 13.1 "Does this reservation have any payments?" (for cancel-confirm copy)

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

// paidCents > 0 → use "$X.XX will be refunded (5.5% non-refundable)" copy
// paidCents === 0 → use plain "Cancel?" copy
// Estimate the refund preview client-side as paidCents * 0.945 (server
// is authoritative on the actual refund amount).
```

### 13.2 Payment summary for a single reservation (booking detail screen)

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

### 13.3 Preview deposit before checkout

```ts
const { data: cents } = await supabase
  .rpc("compute_deposit_for_party", {
    p_restaurant_id: restaurantId,
    p_party_size: partySize,
  });
// cents: number | null (null = no deposit required for this party size)
```

### 13.4 List saved cards

```ts
// Direct DB read — RLS scopes to current user automatically.
const { data: cards } = await supabase
  .from("saved_cards")
  .select("id, brand, last4, exp_month, exp_year, is_default")
  .order("created_at", { ascending: false });
```

Or call `stripe-list-methods` if you want Stripe's authoritative state
(includes cards added via OAuth flows that bypassed the saved_cards
insert).

---

## 14. Status enum reference

```
reservations.status: pending_payment | confirmed | cancelled | arriving | seated | completed | no_show
orders.status: pending | paid | refunded
order_items.status: ordered | preparing | ready | served | cancelled
reservation_deposit_payments.status: pending | charged | refunded | failed
restaurants.subscription_status: trialing | active | past_due | canceled | incomplete | incomplete_expired | unpaid
```

Mobile should treat unknown values defensively (display the raw string)
in case a future migration adds new states.

---

## 15. Error responses & user-facing messages

| Edge fn error | Likely cause | User-facing message |
|---|---|---|
| `slot_taken` (409) | Race window after Stripe success | "That time was taken right as you paid. Your card has been refunded — pick another slot." |
| `diner_double_book` (409) | Diner already has overlapping reservation | "You have another booking at this time. Cancel that one first or pick a different slot." |
| `Past reservations cannot be cancelled` | Trying to cancel a reservation in the past | "This reservation has already happened — it can't be cancelled." |
| `modify_requires_card` (402) | Party-size increase, no saved card on file | "Adding to your party size needs a card on file. Add one in Account → Payment and try again." |
| `PaymentIntent not paid` from `mark-order-paid` / `confirm-deposit-paid` | Stripe declined, network issue | "We couldn't confirm your payment. Please try again or use a different card." |
| `Rate limited` (429) | Too many cancel/book attempts | "You're going too fast — wait a moment and try again." |
| `Delete your restaurants first` (409, `delete-account`) | Diner owns ≥1 restaurant | "You own a restaurant on Cenaiva — please delete it from the dashboard before deleting your diner account." |
| `Email confirmation does not match` (400, `delete-account`) | Typed email differs from auth.users.email | "The email you typed doesn't match. Please retype your account email." |
| `Edge Function returned a non-2xx status code` | The Supabase SDK wrapper hides `body.error` | **Use raw fetch + parse body.error**. See web's `BookingDetailsPage.tsx` for the pattern. |

**Important:** when calling edge functions from mobile, use the native
HTTP client (URLSession on iOS, OkHttp on Android, fetch on RN) NOT the
Supabase SDK `functions.invoke()` — that wraps the error body as a
generic "non-2xx" message and you lose the real reason. Web hit this and
fixed it by switching to raw fetch + parsing `body.error`.

---

## 16. Test cards (Stripe test mode)

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

## 17. Webhooks (server-side, mobile doesn't subscribe directly)

Mobile does NOT register Stripe webhooks. The platform's `stripe-webhook`
edge function (deployed) handles every Stripe event. See §11d for the
event-to-DB mapping.

Mobile is notified of state changes via Supabase Realtime subscriptions
on `reservations` and `restaurants` tables — same pattern web uses. See
`DINER_MOBILE_GUIDE.md` section on realtime.

---

## 18. Security checklist

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
- ✅ Surface the partial-refund (5.5% non-refundable) policy at booking
  time AND at cancel time. Don't surprise the diner.
- ✅ For diners not logged in (guest bookings), the confirmation_code is
  the security token for cancel/modify. Mobile should store it in
  Keychain/Keystore for guest sessions, and offer `/find-reservation`
  recovery via email + last name if lost.
- ✅ Account deletion is a typing-to-confirm + bearer-JWT gated flow.
  Mobile must show the destructive copy ("Cancel and refund every
  upcoming reservation, detach saved cards, permanently delete profile")
  before letting the user confirm.
- ✅ Owner-cancel surfaces (if mobile ever shows a restaurant dashboard
  in-app, which is currently out of scope) MUST pass `actor: "owner"`
  and require the user to have a `user_restaurant_roles` row.

---

## 19. Implementation order (recommended)

1. **SDK setup + tokenization smoke test.** Initialize Stripe SDK, mount
   PaymentSheet against a test PI generated by your dev backend. Confirm
   a `4242...` charge end-to-end.
2. **Pre-order checkout flow** (§4). Wire all 6 steps. Test on a
   restaurant with no deposit policy first to keep the surface small.
3. **Race-window recovery** (§4c). Force the race by booking the
   last seat from the web, then trying to book it from mobile. Verify
   `refund-payment-intent` fires and the diner sees the recovery message.
4. **Deposit-only flow** (§5). Test with a party of 8 at Mark
   Testing — deposit policy kicks in at `min_party_size=8`,
   `$10/person`, so an 8-person booking = $80 deposit.
5. **Combined pre-order + deposit flow.** Same as #4 but add a menu
   item. Single PaymentIntent covers both. Verify both `orders` row AND
   `reservation_deposit_payments` row land in their respective `paid` /
   `charged` states.
6. **Payment Summary on booking detail** (§13.2). Display pre-order line
   items + deposit cards with status badges.
7. **Cancel flow with partial refund** (§6). Confirm dialog copy mentions
   the 5.5% non-refundable. Toast message varies by refund outcome.
   Cancelled bookings remain viewable.
8. **Saved-card picker** (§9 — `create-public-payment-intent` Mode B,
   `stripe-attach-payment-method`).
9. **Modify with deposit recalc** (§9 — `modify-reservation`).
   `modify_requires_card` failure case branches to "Add a card" UI.
10. **Multi-payer split deposit** (§10). Universal Link / App Link
    setup for `cenaiva://deposit/:id`.
11. **Account deletion** (§7). The typing-to-confirm modal + the toast
    + sign-out + route-to-login.
12. **Post-meal pay-the-bill** (§8 — `stripe-charge-order`). Includes
    SCA handling on the connected account.
13. **Find-reservation** (§9 — `find-reservation`). For guests who lost
    their confirmation.
14. **Error paths.** Decline, insufficient funds, SCA required, network
    timeouts. Use the test cards in §16.
15. **Final integration test.** Real card, real PI, full loop, verify
    restaurant's Stripe Dashboard shows the destination charge + app fee.

---

## 20. Reference paths in repo (web canonical implementation)

When in doubt, mirror what the web does. The web's deferred-PI flow is
the most-tested production code path; mobile should match call ordering
and error handling closely.

### Diner UI

- `apps/web/src/pages/customer/RestaurantPublicPage.tsx` — `handlePlaceOrder`,
  `createReservationCore`, the full checkout flow. Search "Phase 7" for
  split-deposit logic.
- `apps/web/src/components/booking/StripePaymentForm.tsx` — dual-mode
  picker (Phase 4): saved-card path + one-time path with save-card
  checkbox + SCA fallback via `handleNextAction`.
- `apps/web/src/pages/customer/BookingDetailsPage.tsx` — cancel flow,
  refund toast variants, modify dialog with deposit_adjustment
  toast variants.
- `apps/web/src/pages/customer/BookingsPage.tsx` — list-page cancel
  dialog.
- `apps/web/src/pages/customer/DepositPayPage.tsx` — public
  `/deposit/:id` page (Phase 7).
- `apps/web/src/pages/customer/FindReservationPage.tsx` — anon
  `/find-reservation` page (code + contact paths).
- `apps/web/src/pages/customer/ConnectedAccountsPage.tsx` — proactive
  linking (Phase 5).
- `apps/web/src/pages/customer/AccountPage.tsx` — payment methods
  management + delete-account UI.
- `apps/web/src/pages/auth/AuthCallbackPage.tsx` — Apple first-signin
  name capture + duplicate-account merge prompt.
- `apps/web/src/pages/auth/PhoneLoginPage.tsx` — Phone OTP UI
  (SMS + WhatsApp transports).
- `apps/web/src/pages/auth/OnboardingPage.tsx` — missing-fields gate.
- `apps/web/src/components/customer/AccountLinkPrompt.tsx` — the
  merge prompt modal.
- `apps/web/src/hooks/useReservationPayments.ts` — Payment Summary
  fetcher (the query mobile should mirror).
- `apps/web/src/lib/validation/phone-schemas.ts` — E.164 normalization +
  display formatting (mobile should mirror).

### Owner UI (out-of-scope for mobile diner, kept for context)

- `apps/web/src/components/onboarding/Step8PaymentSetup.tsx` — Stripe
  Connect Embedded + subscription card setup.
- `apps/web/src/pages/dashboard/SettingsPage.tsx` — billing summary,
  plan price constants ($199 CAD, 5.5%).
- `apps/web/src/pages/auth/SetupPage.tsx` — wizard shell.
- `apps/web/src/pages/auth/DraftsPage.tsx` — unpublished restaurants.

### Edge functions

- `supabase/functions/create-public-payment-intent/index.ts` — both
  one-time and saved-card paths. `PLATFORM_FEE_PERCENT = 0.055`.
- `supabase/functions/create-public-booking/index.ts` — atomic booking
  RPC wrapper.
- `supabase/functions/mark-order-paid/index.ts` — service-role flip
  after diner pays.
- `supabase/functions/confirm-deposit-paid/index.ts` — service-role
  flip after deposit charge.
- `supabase/functions/prepare-deposit/index.ts` — multi-payer row insert.
- `supabase/functions/dispatch-deposit-invites/index.ts` — email fan-out
  to non-organizer payers (Phase 7).
- `supabase/functions/get-deposit-payment-context/index.ts` — anon page
  data for `/deposit/:id`.
- `supabase/functions/cancel-reservation/index.ts` — diner + owner
  cancel, partial-refund pipeline (94.5% to diner, 5.5% to Cenaiva).
- `supabase/functions/notify-deposit-payers-refunded/index.ts` —
  Resend email to non-organizer payers on cancel.
- `supabase/functions/modify-reservation/index.ts` — slot move +
  deposit recalc (Phase 8). Charges 5.5% app fee on party-up delta.
- `supabase/functions/stripe-charge-order/index.ts` — post-meal
  pay-the-bill (Phase 9). Direct charge on connected account.
- `supabase/functions/refund-payment-intent/index.ts` — race-recovery
  refund (slot-taken).
- `supabase/functions/stripe-attach-payment-method/index.ts` — Phase 4
  card-save after one-time PI.
- `supabase/functions/stripe-setup-intent/index.ts` — Phase 4
  add-a-card flow.
- `supabase/functions/stripe-list-methods/index.ts` — list saved cards.
- `supabase/functions/merge-diner-accounts/index.ts` — Phase 5 merge.
- `supabase/functions/find-reservation/index.ts` — anon lookup by code
  or contact.
- `supabase/functions/delete-account/index.ts` — full account teardown.
- `supabase/functions/create-stripe-account/index.ts` — owner-side
  Connect Custom account creation.
- `supabase/functions/create-account-session/index.ts` — owner-side
  Account Session for embedded onboarding.
- `supabase/functions/create-subscription/index.ts` — owner-side $199/mo
  subscription mount.
- `supabase/functions/stripe-webhook/index.ts` — event handler.
- `supabase/functions/_shared/stripe-refund.ts` — shared refund helper
  (full + partial via `amountCents` param).

---

## 21. Out of scope for diner mobile

- **Restaurant onboarding** (Stripe Connect KYC, subscription setup,
  Step 8 of wizard) — owner-side web only. See §11 for context.
- **Subscription billing** ($199/mo) — owner-side web only.
- **Payouts dashboard / fee reporting** — restaurants view this in their
  Stripe Dashboard directly; Cenaiva doesn't surface it.
- **Owner-side dashboard cancel** — routed through `cancel-reservation`
  with `actor: "owner"`. Diner mobile inherits the diner-side messaging
  automatically.
- **Tip-after-meal flow** as a standalone — current `stripe-charge-order`
  bundles tip into the bill at close time. No separate add-a-tip UI yet.
- **Stripe webhook subscriptions** — server-side only.
- **Restaurant subscription management** — owner-side `/dashboard/settings`.
- **Stripe Customer merge across diner accounts** — `merge-diner-accounts`
  doesn't migrate Stripe Customer ids; orphaned cards on the duplicate
  Customer become uncharge-able. Workaround: re-add the card. Document
  for diner support.

---

This guide is current as of **2026-05-16** (pricing overhaul: 5.5% / $199 /
Cenaiva absorbs Stripe / cancel keeps 5.5%). If you find drift between
this doc and code, update both in the same PR.
