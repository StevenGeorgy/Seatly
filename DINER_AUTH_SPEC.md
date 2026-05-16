# DINER_AUTH_SPEC.md — Diner identity, onboarding, and saved payment

Canonical design doc for the diner-side auth + profile + saved-cards
overhaul (planned 2026-05-15). Style is prose-heavy — this captures WHY
the decisions were made, not just WHAT to build. The implementation plan
lives separately; this is the document to read when you join the project
later and wonder "why did they design it this way?"

If anything in this doc contradicts code, code is the source of truth.
Update both in the same PR.

---

## 1. Why we built it this way

The diner experience today has too much repetitive friction. Specifically:

- A diner who signed up with Google still has to type their name and
  email on every booking, even though Google already gave us both.
- Phone number is never collected at signup, so SMS booking
  confirmations either fail or get re-asked at every checkout.
- Saved cards exist on the AccountPage but are not wired into the
  booking flow — so the diner re-enters their card on every booking.
- Apple, phone OTP, and WhatsApp signup are not wired at all.
- A diner using Apple on their iPhone and Google on their laptop ends
  up with two separate Cenaiva accounts, splitting their bookings and
  saved cards across both.

The fix is one coherent shift: **collect identity once via the lowest-
friction path the diner picks, auto-populate everything we can from
the provider's claims, and ask for missing fields only at the moment
the diner actually needs them (i.e., booking).**

Industry context: every modern booking and ecommerce app works this
way. Uber, DoorDash, Amazon, OpenTable — sign in fast, browse freely,
collect data at checkout, save card for next time. Cenaiva should not
be the exception.

The result: a returning diner's flow looks like:

```
1. Open app → already logged in (Apple Sign-In on iPhone)
2. Tap restaurant → menu loads, pre-filled with their dietary prefs
3. Pick slot → date/party/time pre-populated
4. Continue to checkout → name/email/phone already filled (from profile)
5. Payment step → "Pay with Visa •••• 4242 — $80"
6. Place Order → booked in 2 seconds
```

Six taps from open to confirmed. Today it's 20+.

---

## 2. Provider matrix (and why each)

We support four primary sign-in methods, each chosen for a specific
audience:

| Provider | Why we support it |
|---|---|
| **Apple Sign-In** | iOS App Store rule: any app offering third-party login MUST also offer Apple. Also the lowest-friction option for iPhone users (one tap, FaceID). Diners associate Apple = privacy = premium dining vibe. |
| **Google OAuth** | Default for desktop / Android users. Lowest friction for the office-worker booking lunch on Chrome. |
| **Phone OTP (SMS or WhatsApp)** | Universal — works without a Big Tech account. Best for diners who care about not linking identities. WhatsApp is the natural alternative for international diners (cheaper for them, no carrier fees). |
| **Email/password** | Legacy. Some diners insist. Demoted to a small text link at the bottom of the login screen. Not removed because of habit + the password-reset flow's predictability. |

Apple gets top placement for two reasons. First, Apple's HIG mandates
prominent placement when supported. Second, conditioning: iOS users
look for the Apple button first; if they don't see it, they assume
the app is older or sketchy.

We do NOT support: Facebook (low Cenaiva user overlap, privacy concerns),
GitHub (developer-only), magic-link email (slow, friction-equivalent to
password). If a partner asks for one of these later, this list should be
revisited.

---

## 3. Login button order (and why)

The login and register screens render buttons in this order, top to
bottom:

1. **Continue with Apple** — black-on-white per Apple HIG.
2. **Continue with Google** — Google-branded ID button.
3. **Continue with phone number** — opens phone-OTP page.
4. (divider)
5. **Sign in with email** — small text link, no button affordance.

This ordering optimizes for the most-likely click first. Apple is the
fastest path for iOS, which is ~60% of Cenaiva's expected mobile
traffic. Google is next-fastest for desktop. Phone is universal but
slower (waiting for an SMS). Email is the slowest and lowest-trust;
intentionally hard to find.

A future A/B test should validate Apple vs. Google ordering once we have
real signup data. Until then, follow Apple HIG.

---

## 4. Profile lifecycle (DB triggers, backfill, sync)

### 4a. Auto-create on signup

A `BEFORE INSERT` would be problematic (race against `auth.users`
constraints) so we use `AFTER INSERT ON auth.users` running as
`SECURITY DEFINER` under the `supabase_auth_admin` role. The trigger
function `public.handle_new_auth_user()` inserts a `user_profiles` row
with:

- `auth_user_id` = NEW.id
- `email` = NEW.email
- `phone` = NEW.phone (populated for phone-OTP signups; null otherwise)
- `full_name` = `COALESCE(NEW.raw_user_meta_data->>'full_name',
  NEW.raw_user_meta_data->>'name')`
- `role` = `'customer'`

`ON CONFLICT (auth_user_id) DO NOTHING` makes it idempotent — the
existing owner-signup edge function already inserts profile rows;
re-running them through the trigger is a no-op.

### 4b. Backfill at migration time

A one-shot block in the migration inserts profile rows for any
`auth.users` rows that don't already have one. As of 2026-05-15 there
are 17 such rows (all from owner signup, profile already exists, so
the backfill is a no-op for them — but defends against future
divergence).

### 4c. SECURITY DEFINER and grants

The function MUST use `SECURITY DEFINER` because the trigger runs as
`supabase_auth_admin`, which has very limited permissions by default.
We `GRANT INSERT, SELECT ON user_profiles TO supabase_auth_admin;` so
the trigger can write the row. SECURITY DEFINER means the function
runs with the owner's permissions (the migration creator's), which
means we should be careful what the function does — but here the
function ONLY inserts a single row with safe inputs, no user-supplied
SQL.

The function also sets `search_path = public` to prevent search-path
hijacking attacks (a classic Postgres trigger pitfall).

### 4d. Update sync (mirror auth.users → user_profiles)

A second trigger `AFTER UPDATE ON auth.users` mirrors `email` and
`phone` into `user_profiles` IF the `user_profiles` column is
currently NULL. We deliberately do NOT mirror `full_name` on update,
because the diner may have edited their displayed name on AccountPage
and we shouldn't clobber that. The NULL-coalesce rule preserves edits.

This handles cases like: diner first signs in with Google (gets
email), then later adds phone to their auth.users via Supabase's
phone-add flow. The phone shows up on the profile automatically.

---

## 5. Onboarding UX

### 5a. Soft gate on /discover, hard gate on booking

The onboarding screen is intentionally NOT shown immediately after
signup. The diner lands on `/discover` and can browse freely, look at
restaurants, read menus. The screen fires only when they click
"Continue to Checkout" on a specific restaurant — at that point we
know they're committed, and asking for missing fields feels natural
rather than presumptuous.

A `<RequireCompleteProfile>` route guard wraps just the checkout step.
If `full_name`, `email`, or `phone` is missing, the diner is bounced
to `/onboarding?from=<original-url>`. The onboarding page reads the
profile, shows ONLY the missing fields, and on submit writes them back
to `user_profiles` then redirects to the `from` param.

This is the "soft gate, hard gate" pattern: free to look around, hard
requirement at the action moment.

### 5b. Why we don't gate on birthday, dietary, etc.

Birthday, dietary restrictions, seating preferences, allergies — all
exist on the profile schema but are NOT required. Gating on them would
be invasive (most diners don't have allergies and would resent being
asked). They surface as optional fields on the booking form and on the
AccountPage Preferences section. Pre-filled if present, omitted from
the gate otherwise.

### 5c. Profile write-back at booking

After every successful booking, if any of the form fields differ from
the profile, we update the profile. Fire-and-forget — the booking
success path doesn't block on the profile write.

This means the first booking is also the last time the diner has to
type their name/email/phone. The second booking, the form is fully
pre-filled.

### 5d. Last-write-wins on conflict

Edge case: the diner edits their profile on AccountPage in one tab
while filling out a booking form in another. Whichever write lands
last wins. Acceptable, because the diner is the only writer — there's
no two-author conflict.

---

## 6. Apple privacy-relay email handling

Apple's "Hide my email" feature returns a relay address like
`xyz123@privaterelay.appleid.com`. Apple forwards email to the
diner's real address as long as we send from a domain Apple has
approved.

We treat the relay as a fully valid email — booking confirmations are
sent to it, password resets go to it, the profile's `email` field
stores it. The diner doesn't see anything different.

On the onboarding page, IF the email matches the relay pattern
(`/@privaterelay\.appleid\.com$/i`), we surface an optional field:
*"Want to add a real email for receipts? (You can skip this.)"*

- If they fill it in → we write it to `user_profiles.email` (NOT to
  `auth.users.email`; the auth-side relay stays untouched because Apple
  won't re-issue the user's real email anyway).
- If they skip → the relay stays as the email of record. Receipts go
  through Apple's forwarder.

The phrasing is intentional: "for receipts" frames the request around
transactional benefit, not marketing capture. Privacy-conscious users
who picked hide-my-email respect the boundary; the rest happily give
us the real one for convenience.

We never gate booking on this question.

---

## 7. Phone OTP cost model (Twilio + WhatsApp)

### 7a. Twilio SMS

We reuse the existing Twilio account that already sends booking
confirmations. The auth flow calls
`supabase.auth.signInWithOtp({ phone, channel: 'sms' })` which routes
through Supabase's built-in SMS provider integration. Supabase calls
Twilio with our existing `TWILIO_ACCOUNT_SID` /
`TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` env vars.

Cost: ~$0.0075 per SMS in Canada. At 10,000 new signups/month, that's
$75/month. At 100,000 signups/month, $750. Negligible relative to the
$199 CAD/mo restaurant subscription revenue.

### 7b. WhatsApp Business

Some diners prefer WhatsApp — international travellers, anyone
without a reliable carrier-SMS plan. We register a WhatsApp Business
sender in Twilio (one-time setup), then expose a "Send code via
WhatsApp instead" link on the phone-OTP page. Same Twilio account,
different transport.

WhatsApp Business cost: ~$0.005 per auth message in Canada, often
cheaper internationally. The toggle is free for us to support — same
Supabase auth call, just `{ channel: 'whatsapp' }`.

### 7c. Rate limiting

Supabase has built-in OTP rate limiting (configurable in Dashboard).
We set: 5 OTP requests per phone per hour, 20 per IP per day. Prevents
abuse without blocking legitimate "I didn't get the code, resend"
flows.

### 7d. CASL compliance (Canada)

Canadian anti-spam law (CASL) requires consent for commercial messages.
Auth-only messages ("Your Cenaiva code is 384921") are explicitly
exempted under CASL because they're transactional. We're fine
without explicit consent for OTP messages, but we cannot pivot the same
phone number to marketing without explicit opt-in.

### 7e. When to revisit

At >10,000 diners/month or expansion outside Canada, evaluate WhatsApp
Business as the primary channel (cheaper, more reliable, no carrier
issues). At >100,000/month, evaluate self-hosted OTP via Twilio's
Verify API (faster, slightly cheaper at scale).

---

## 8. Saved-card flow (Stripe Customer on platform, JIT cloning)

### 8a. Why Stripe Customer lives on the platform

Each diner has ONE `stripe_customer_id` on the Cenaiva platform Stripe
account (stored on `user_profiles.stripe_customer_id`). Their saved
cards live on that Customer.

This is deliberately NOT one Customer per restaurant. A diner roams
across restaurants (book at Mark Testing on Monday, book at Georgy Inc
on Tuesday). Their saved card should follow them. The platform
Customer is the canonical, restaurant-agnostic identity.

The implication: when we charge their card at a restaurant, we need to
get the card *to* the restaurant's connected Stripe account. Stripe's
official pattern for this is "Cloning Payment Methods to Connected
Accounts":

https://stripe.com/docs/connect/cloning-saved-payment-methods

### 8b. JIT (just-in-time) cloning at charge

The flow:

1. Diner clicks Place Order on a booking.
2. Server calls `stripe.paymentMethods.create({ customer: cus_xxx,
   payment_method: pm_yyy }, { stripeAccount: acct_zzz })`. This
   creates a NEW `pm_*` id scoped to the connected restaurant account.
   The clone is single-use; we don't store its id.
3. Server creates the PaymentIntent directly on the connected account
   (`{ stripeAccount: acct_zzz }` option), passes the cloned
   `payment_method`, sets `confirm: true`, `off_session: true`,
   `application_fee_amount` = 5.5%.
4. Charge succeeds → 94.5% lands in restaurant's account, 5.5% in
   Cenaiva's. Same economics as destination charges.

### 8c. Why we charge "as the connected account" instead of
destination-charge + clone

There are two valid patterns:
- **Pattern A (chosen):** clone the PM to connected account, charge
  directly on connected account with application fee. One PI,
  scoped to the connected account.
- **Pattern B (rejected):** clone the PM, then create a PI on the
  platform account with `transfer_data.destination` pointing to the
  connected account. Two ledger entries to reconcile, doubles the
  Stripe API surface for refunds.

Pattern A wins on simplicity. The refund / forfeit / cancel logic we
already have for destination charges applies identically; Stripe
handles both the same way from the refund API's perspective.

### 8d. Save-card default = checked

When a diner pays with a new card, the form has a "☑ Save this card
for faster checkout" checkbox, default-checked. After the PI confirms,
a fire-and-forget call to `stripe-attach-payment-method` attaches the
PM to the platform Customer and inserts a `saved_cards` row.

Industry data (Optimizely studies, Stripe's own conversion data): 73%
of users opt to save when defaulted-checked, vs. 24% when
defaulted-unchecked. The diner has full control to uncheck if they
don't want it. We default to the option that benefits the next-time
experience.

### 8e. SCA fallback (handleNextAction)

Some saved-card charges trigger 3D Secure / Strong Customer
Authentication re-prompts, especially for international cards. When
the off-session PI confirm returns `requires_action`, the server
returns the `client_secret` to the frontend, which calls
`stripe.handleNextAction(clientSecret)`. This opens an inline auth
prompt; once approved, the booking completes.

Without this fallback, `requires_action` would silently fail and the
diner wouldn't understand why. Critical to ship.

### 8f. Card expiry handling

Stripe automatically attempts to refresh expired cards via the card
networks' "account updater" service. Many issuers participate. When a
diner's card is auto-updated, Stripe fires a webhook (handled by our
existing `stripe-webhook`). We update the `saved_cards` row with the
new `exp_month` / `exp_year` (and last4 if it changed).

When the auto-updater doesn't work (rare), Stripe fires
`payment_method.detached` and we mark the `saved_cards` row archived.
On next login the diner sees a banner: "Your Visa ending 4242
expired — update your card to keep bookings working."

---

## 9. Account linking across devices/providers

### 9a. The problem

A diner using Apple on iPhone and Google on a laptop ends up with two
separate Cenaiva accounts. Each has its own profile, own saved cards,
own reservation history. Bad experience.

### 9b. The trigger

On successful OAuth or phone sign-in, after `loadUserContext`, we
query `user_profiles` for any OTHER row with matching `email` OR
`phone` linked to a DIFFERENT `auth_user_id`. If found, we surface a
modal:

> "Welcome back — we found another Cenaiva account using this email.
>  Link them together?"
>  [Yes, merge] [No, keep separate]

### 9c. The merge

"Yes, merge" calls the `merge-diner-accounts` edge function:

1. Pick the older `auth.users` row (lower `created_at`) as canonical.
2. Re-point `user_profiles`, `saved_cards`, `reservations`, `guests`,
   `user_restaurant_roles` from the new auth_user_id to the canonical
   one (UPDATEs by FK).
3. Add the new identity to the canonical auth.users via
   `supabase.auth.admin.linkIdentity` — so the same `auth.users` row
   now has both Apple AND Google identities attached.
4. Mark the duplicate auth.users + user_profiles rows as
   `archived_at = NOW()`.

We do NOT hard-delete immediately. A 7-day undo window protects
against mistakes: a daily `pg_cron` job hard-deletes rows where
`archived_at < NOW() - INTERVAL '7 days'`. Within that window, support
can run a reverse-merge if a diner reports a mistake.

### 9d. Auto-merge: never

We never auto-merge without explicit consent, even with high-confidence
matches. Some diners deliberately keep work and personal accounts
separate. Always ask; respect the answer.

### 9e. /account/connected-accounts page

A new dashboard tab shows all linked sign-in methods (Apple icon +
Apple ID email, Google icon + Google email, phone icon + phone
number). The diner can add another method ("Connect Apple to this
account") or disconnect one (with a confirmation: "You'll still be
able to sign in with the other methods").

Cannot disconnect the LAST method — that would lock the diner out.

---

## 10. Owner-side cancel + refund

### 10a. The problem

The restaurant dashboard's "Cancel this reservation" button today
bypasses our `cancel-reservation` edge function. It does a direct
`UPDATE reservations SET status='cancelled'`. That means:

- Paid pre-orders stay paid → restaurant keeps the money, diner gets
  nothing back, but doesn't get the meal either.
- Charged deposits stay charged → same.
- No SMS/email goes out to the diner.

This is a bug. Fix: route the dashboard cancel through
`cancel-reservation` like the diner-side does.

### 10b. The `actor` parameter

`cancel-reservation` accepts `actor: "diner" | "owner"` (default
`"diner"`). When `actor === "owner"`:

- We require staff JWT auth (the caller must have `owner` or `staff`
  role on the restaurant in question).
- We SKIP the 24-hour forfeit cliff entirely. Owner-initiated cancels
  always refund, regardless of how close to the reservation time. The
  diner shouldn't be punished for the restaurant's decision.
- `cancellation_reason = "Cancelled by restaurant"`.
- The toast on the diner's next view of `/bookings/<id>` reflects
  "Cancelled by the restaurant" instead of "Cancelled by you."

### 10c. Owner-cancel notifications

Owner-cancel sends a different SMS/email body: explanatory tone, an
apology, an offer to rebook. The exact copy is owner-configurable
later; for v1, a neutral default.

---

## 11. Multi-payer deposit split

### 11a. The problem

Party of 8 with a deposit policy ($10/person = $80) currently makes
one diner foot the entire $80. The booking shouldn't burden one
person.

### 11b. The UI

On the checkout page, when a deposit applies, show a toggle:
"☐ Split deposit across the table". If toggled, render N payer rows
(capped at `party_size`), each with name, email, optional phone, and
an amount field (default: total / N, but editable per-payer for
uneven splits).

The booking diner is always payer #1 — they pay their share inline as
part of the booking flow. The other N-1 payers get sent an SMS + email
with a magic link to `/deposit/<payment_id>`.

### 11c. The /deposit/<id> public page

Anyone with the link can pay that share — no auth required. The page
shows the reservation summary (restaurant, date, party, organizer
name), the amount due, and a Stripe Elements PaymentSheet for that
specific amount. On confirm, calls `confirm-deposit-paid` with the
payment_id + PI id.

### 11d. Reservation state

`reservations.status` stays at `pending_payment` until ALL deposit
rows for the reservation are charged. The existing settle trigger on
`reservation_deposit_payments` handles this — it flips the parent
reservation to `confirmed` when every row hits `charged`. No new
trigger logic needed.

### 11e. What if a payer doesn't pay?

The reservation never confirms. The slot stays held in
`pending_payment` until the booking diner gets a reminder (via cron
job — TBD) or manually cancels. Cancelling refunds everyone who DID
pay so far.

### 11f. SMS + email invite copy

The invite is short and on-brand:

> "Hey [name], [organizer] booked dinner at [restaurant] on [date]
>  and asked you to chip in $[amount] for the deposit. Pay your share:
>  https://cenaiva.com/deposit/<id>. (Takes 30 seconds.)"

No login, no app download, just a payment page. Designed for the
friend who doesn't have Cenaiva yet.

---

## 12. Modify-reservation deposit recalc

### 12a. The problem

Party of 8 ($80 deposit). Diner modifies to party of 12 ($120
deposit). Today, modify-reservation just changes the party size;
deposit amount stays at $80. Restaurant under-collects.

Going the other direction (8 → 4) is worse — the diner already paid
$80, but their deposit obligation is only $40. We owe them $40 back.

### 12b. The fix

`modify-reservation` recomputes the deposit on every party-size
change. If new > old, we charge the delta on the diner's default
saved card via the same Connect-clone-then-charge-on-connected-account
flow used for repeat bookings. If new < old, we issue a Stripe refund
for the delta via the existing `_shared/stripe-refund.ts` helper.

### 12c. What if the diner has no saved card?

We return `error: "modify_requires_card"` from the edge function and
the frontend prompts the diner to add a card before retrying. Better
than silently allowing a modify that under-collects.

### 12d. SCA on the delta charge

Same as Phase 4's saved-card flow — if Stripe returns
`requires_action`, the diner gets an inline 3DS prompt.

### 12e. What about modify-time, modify-restaurant?

Out of scope here. Only party-size changes trigger deposit recalc.
Time and date changes don't affect deposit amount.

---

## 13. stripe-charge-order Connect-awareness

### 13a. The problem (pre-fix)

`stripe-charge-order` was written before the Connect destination-charge
architecture was settled. It charges to the PLATFORM account, with no
`application_fee_amount` and no `transfer_data.destination`. So if it
gets used for, say, a post-meal pay-the-bill flow, the restaurant
doesn't get paid out at all.

### 13b. The fix

Refactor `stripe-charge-order` to mirror Phase 4's pattern: resolve
the order's restaurant → `stripe_account_id`, clone the saved PM to
the connected account, charge directly on the connected account with
`application_fee_amount` = 5.5%. Same SCA fallback.

After the fix, post-meal pay-the-bill flows pay the restaurant
correctly with Cenaiva's 5.5% fee deducted.

### 13c. Why this is separate from the booking flow

The booking flow uses `create-public-payment-intent`. The post-meal
order flow uses `stripe-charge-order`. They're different code paths
because they have different auth requirements (booking can be
anonymous, order-charge needs the order to exist and the diner to be
authenticated). Keeping them separate is the right architecture; we
just need both to be Connect-aware.

---

## 14. Edge function inventory

Existing functions (reused as-is):
- `stripe-setup-intent` — creates Stripe Customer + SetupIntent for a
  diner to attach a card. Already handles the Customer creation
  pattern.
- `stripe-list-methods` — lists a diner's saved cards.
- `stripe-detach-method` — removes a saved card.
- `confirm-deposit-paid` — flips a deposit row to `charged` after a PI
  succeeds.
- `cancel-reservation` — handles diner-side cancel + refund + 24h
  cliff.
- `prepare-deposit` — inserts N deposit rows (supports multi-payer
  natively).
- `create-public-booking` — atomic booking + order writes.
- `create-public-payment-intent` — creates the booking PI.
- `refund-payment-intent` — race-recovery refund.
- `mark-order-paid` — flips an order to `paid` after Stripe.

Existing functions (modified):
- `cancel-reservation` — adds `actor: "diner" | "owner"` param.
- `modify-reservation` — recalcs deposit on party-size change.
- `create-public-payment-intent` — accepts `saved_card_id`, clones PM,
  charges on connected account.
- `create-public-booking` — returns multi-payer shape in response.
- `stripe-charge-order` — Connect-aware refactor.

New functions:
- `stripe-clone-payment-method` — clones a saved PM to a connected
  account JIT.
- `stripe-attach-payment-method` — saves a PM to the diner's platform
  Customer after a one-time PI.
- `merge-diner-accounts` — merges two duplicate diner accounts.
- `dispatch-deposit-invites` — sends SMS + email to non-diner deposit
  payers.

---

## 15. Security implications

### 15a. SECURITY DEFINER triggers

`handle_new_auth_user` and `sync_user_profile_from_auth` both run as
`supabase_auth_admin`. Their SQL is fixed (no user input), search_path
is locked to `public`, and they only insert / update fields with
predictable shapes. Safe.

### 15b. RLS scoping on user_profiles

The trigger creates rows that the diner CAN'T directly read without
RLS recognizing them as the owner. We use the existing
`user_profiles_own_select` policy: `auth_user_id = auth.uid()`. The
trigger writes the row; the diner reads it via their own session.

### 15c. Cloned PaymentMethod scope

When we clone a `pm_*` to a connected account, the cloned id is
scoped to that account only. It can't be charged on a different
restaurant's connected account. The original `pm_*` on the platform
stays intact. This means a leaked cloned id is useless — at worst, it
could be used to charge the diner at the SAME restaurant where the
clone was made, and even then only if the attacker can also forge a
Stripe webhook. Acceptable risk.

### 15d. Account-merge destructive operation

Merging two accounts is irreversible after the 7-day undo window.
Within the window, support can run a reverse-merge via SQL on the
archived rows. After, the duplicate auth.users row is hard-deleted by
the daily cron job. We log every merge to a `account_merge_audit`
table for forensics.

### 15e. Owner cancel auth check

When `actor === "owner"` is passed to `cancel-reservation`, the
function MUST verify the JWT belongs to a user with `owner` or
`staff` role on the specific `restaurants.id` of the reservation
being cancelled. A diner-side caller passing `actor: "owner"` to dodge
the 24h cliff gets a 403.

### 15f. Multi-payer deposit links

`/deposit/<id>` is a public page with no auth. The id is a UUID
(infeasible to guess). If a link is shared accidentally, the only
damage is a stranger paying the deposit for someone they don't know
— low harm. We do not include reservation details (like the diner's
phone number) on the page beyond what's needed to confirm the
context.

---

## 16. Mobile parity

Mobile (iOS/Android) uses the same Supabase edge functions and the
same `user_profiles` / `saved_cards` schema. No new server endpoints
are needed for mobile to support all of this.

### 16a. Apple Sign-In on iOS

Mobile uses the native `ASAuthorizationController` instead of the web
OAuth dance. The resulting `id_token` is passed to
`supabase.auth.signInWithIdToken({ provider: 'apple', token })`. Same
trigger fires, same profile gets auto-created.

### 16b. Phone OTP

Native SMS reading on iOS (autofill from Messages) and Android
(SMS Retriever API) makes phone OTP nearly seamless. Same Supabase
auth call.

### 16c. Saved-card picker

Stripe's native PaymentSheet on iOS/Android already supports saved-card
picking out of the box. Mobile calls the same `stripe-list-methods` to
populate the sheet.

### 16d. Deep linking for deposit pages

`/deposit/<id>` should be a Universal Link / App Link so that tapping
the SMS magic link opens the Cenaiva mobile app directly to the
payment screen, not the browser.

### 16e. Onboarding parity

Mobile renders the same `/onboarding`-equivalent screen native-style.
Same fields, same logic, same write-back.

---

## 17. Future considerations

- **Passkeys / WebAuthn.** Once Apple, Google, and Android all support
  passkey sync (they do as of 2024), we should evaluate passkeys as a
  primary sign-in method. Eliminates password resets entirely.
- **Anonymous-then-claim.** A guest who books via a shared link could
  optionally convert to a real account post-booking, claiming the
  reservation. Today they're a one-shot guest record. Future feature.
- **Multi-brand payment profiles.** If Cenaiva expands to manage
  multiple restaurant brands (Cenaiva, plus a sister product),
  consider grouping connected accounts so a single Stripe Customer's
  saved cards work across brands without re-cloning.
- **PIN / biometric for high-value bookings.** If a single booking
  exceeds, say, $500 of pre-orders + deposit, require an additional
  biometric confirmation before charging the saved card.
- **Voice signup.** Hey Cenaiva (the voice assistant) could
  hypothetically capture a diner's name + phone via voice as the
  signup flow. Years out.

---

## 18. Operational runbook

### 18a. Debug "I'm logged in but my profile is empty"

```sql
SELECT au.id, au.email, au.phone, up.full_name, up.email, up.phone,
       up.created_at
FROM auth.users au
LEFT JOIN user_profiles up ON up.auth_user_id = au.id
WHERE au.id = '<auth_user_id>';
```

If the LEFT JOIN returns NULL on the user_profiles side, the trigger
failed. Check trigger existence:

```sql
SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';
```

If missing, re-run the migration. If present but inserting NULL rows,
check `GRANT INSERT ON user_profiles TO supabase_auth_admin` is in
place.

### 18b. Rotate the Apple .p8 key

Apple keys expire (sort of — they're revocable but don't auto-expire).
Rotate yearly as a best practice.

1. Apple Developer Console → Keys → Create new key with "Sign in with
   Apple" enabled.
2. Download the .p8 file. Note the Key ID.
3. Supabase Dashboard → Auth → Providers → Apple → paste the new key.
4. Test sign-in on staging.
5. Apple Developer Console → revoke the old key.

### 18c. Manually link two accounts (support flow)

When a diner emails support saying "I have two accounts, please merge":

1. Identify both `auth.users` rows (search by email).
2. Pick the canonical (older `created_at`).
3. Run the merge SQL manually (or call `merge-diner-accounts` with a
   service-role token).
4. Confirm the diner can see all their bookings + saved cards.

### 18d. Reverse a merge within the 7-day window

```sql
-- Find the archived rows
SELECT * FROM user_profiles WHERE archived_at IS NOT NULL
  AND auth_user_id IN ('<duplicate_id>');
-- Clear archived_at to restore
UPDATE user_profiles SET archived_at = NULL WHERE auth_user_id = '<duplicate_id>';
-- Move FKs back (reservations, saved_cards, etc.)
-- ...
```

This is awkward enough that we should log every merge to
`account_merge_audit` and include a "revert this merge" button in a
support dashboard later.

### 18e. Twilio account suspended

Twilio occasionally suspends accounts for spam-like patterns. If our
account gets suspended, both booking confirmations AND phone OTP
signups stop. Monitor Twilio's notification email; have a backup OTP
provider (MessageBird, Vonage) configured in Supabase as a fallback.

---

## 19. Migration appendix

In implementation order:

1. `20260515160001_auto_create_user_profile.sql` — DB trigger + backfill.
2. `20260515160002_sync_user_profile_from_auth.sql` — UPDATE sync trigger.
3. Any `account_merge_audit` table migration for Phase 5.
4. Any deposit-recalc-helper SQL functions for Phase 8.

Apple, Twilio, WhatsApp configuration is done in the Supabase Dashboard
and Apple Developer / Twilio Consoles — not in code. Run a dashboard
checklist before each phase ships:

- Phase 2 ship gate: Apple Service ID + .p8 key uploaded to Supabase;
  Twilio Phone provider enabled; WhatsApp Business sender registered.
- Phase 5 ship gate: `account_merge_audit` table exists.
- Phase 7 ship gate: Twilio + sendgrid quota verified for
  multi-payer invite volume.

---

## 20. References

- Stripe Connect cloning PaymentMethods:
  https://stripe.com/docs/connect/cloning-saved-payment-methods
- Apple Sign-In domain association:
  https://developer.apple.com/documentation/sign_in_with_apple/configuring_your_environment_for_sign_in_with_apple
- Supabase Auth identities (linkIdentity):
  https://supabase.com/docs/reference/javascript/auth-linkidentity
- Twilio WhatsApp Business setup:
  https://www.twilio.com/docs/whatsapp/quickstart
- CASL (Canadian anti-spam) auth-message exemptions:
  https://crtc.gc.ca/eng/com500/faq500.htm

---

This spec was finalized 2026-05-15. Companion files:

- `MOBILE_STRIPE_GUIDE.md` — how mobile consumes the Stripe layer.
- `DINER_MOBILE_GUIDE.md` — general mobile diner handoff.
- The implementation plan is in
  `/Users/mark_habbi/.claude/plans/okay-make-a-plan-replicated-octopus.md`.

Drift between this doc and code is a bug. Update both in the same PR.
