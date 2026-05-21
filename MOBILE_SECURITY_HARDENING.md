# Mobile Security Hardening Guide — 2026-05-20

**Purpose:** This document is the authoritative handoff for any mobile-side
AI/engineer working on the Cenaiva diner or owner app. It explains every
security change that landed on the web backend on 2026-05-20, why it
landed, what changed at the wire-level, and what the mobile app needs
to do (or doesn't need to do) to stay compatible.

If you only read one section, read **§0 TL;DR** then **§8 Mobile
Action Items**.

> Companion docs:
> - `MOBILE_STRIPE_GUIDE.md` — Stripe integration overview
> - `MOBILE_STRIPE_GUIDE_ADDENDUM.md` — followup details for Stripe
> - `DINER_MOBILE_GUIDE.md` — full diner-side mobile mirror spec
> - `CLAUDE.md` — agent guardrails + current state

---

## §0 TL;DR

The web team ran a full security audit, found 14 issues (7 HIGH, 7
MEDIUM), shipped fixes for all 14, then added a defense-in-depth pass
that touched 48 more edge functions for stricter input validation.

**For mobile, almost all of it is invisible.** Two concrete things
mobile may need to do:

1. **If mobile calls `create-public-payment-intent` for deposit
   payments**, pass the new `deposit_payment_ids: string[]` body
   field. Without it, `confirm-deposit-paid` will reject the
   subsequent confirm with `pi_payment_id_mismatch`. See §2.
2. **If mobile calls any of the 48 edge functions covered by Phase
   C**, audit your body payloads against the new Zod schemas. Wrong
   types or unbounded free text now returns HTTP 400 with a Zod
   error. See §6.

Everything else benefits automatically. Mobile does NOT need to:
- Change auth code (already uses real JWTs — the fix just makes the
  server actually verify them)
- Migrate any tables (DB changes are server-side only)
- Rotate any secrets (mobile doesn't hold the cron secret)
- Change any URLs / endpoints (no endpoint paths or shapes changed
  beyond optional new body fields)

---

## §1 Phase 1 — JWT signature verification (16 edge functions)

### What was broken

`supabase/functions/_shared/jwt.ts` exported `decodeJwtPayload(token)`
which `atob()`-decoded the JWT payload and returned `sub` **without
verifying the signature**. 16 edge functions used this shim AND had
`verify_jwt = false` in `supabase/config.toml`, so the Supabase
gateway didn't verify either.

Attack: forge `Authorization: Bearer eyJ...<base64({"sub":"victim-id"})>.fake`
and become any user.

### What changed

All 16 fns now use the canonical pattern (already correct in
`cancel-reservation`, `modify-reservation`, `publish-restaurant`):

```ts
const { data: { user }, error } = await supabaseAdmin.auth.getUser(bearerToken);
if (error || !user) return jsonRes({ error: "invalid_token" }, 401);
// user.id is cryptographically verified.
```

`_shared/jwt.ts` was **deleted**. `_shared/auth.ts` was rewritten to
use `supabase.auth.getUser()` internally.

### Affected fns (kept `verify_jwt = false` in config.toml — gateway
doesn't support ES256; verification is inside the fn now)

`stripe-charge-order`, `stripe-setup-intent`, `stripe-list-methods`,
`stripe-attach-payment-method`, `create-public-payment-intent`,
`cancel-reservation-hold`, `create-reservation-hold`,
`update-reservation-hold`, `heartbeat-reservation-hold`,
`merge-diner-accounts`, `cenaiva-chat`, `generate-menu-suggestions`,
`elevenlabs-tts`, `deepgram-live-token`, `cenaiva-orchestrate`,
`cenaiva-small-prompt`.

### Mobile impact

**NONE.** Mobile already sends real signed JWTs from supabase-js.
The change is invisible to legitimate callers. The forged-JWT attack
path is closed.

If mobile ever hard-coded a fake JWT in tests, those tests will now
401. Use a real Supabase test user instead.

---

## §2 Phase 2 — PI substitution attacks (deposit / order / hold)

### What was broken

Three edge functions accepted ANY succeeded Stripe PaymentIntent of
sufficient amount, without verifying the PI was actually created for
the deposit/order/hold being settled:

- `confirm-deposit-paid` — attacker submits unrelated PI → deposit
  flips to `'charged'`, reservation confirms, restaurant holds a
  no-payment table.
- `mark-order-paid` — attacker submits any $1 PI → flips ANY order
  to paid → restaurant serves food.
- `confirm-hold-paid` — attacker submits unrelated PI → hold
  converts to a confirmed reservation, gets confirmation code.

### What changed

All three fns now assert that `intent.metadata.<id> === <expected_id>`:

**`mark-order-paid`:**
```ts
if (intent.metadata?.order_id !== orderId) {
  return jsonRes({ error: "pi_mismatch" }, 400);
}
```
Already-stamped by producer (`stripe-charge-order:269`) — works on
existing PIs. Mobile change required: **none**.

**`confirm-hold-paid`:**
```ts
if (pi.metadata?.hold_id !== holdId) {
  return jsonRes({ error: "pi_mismatch" }, 400);
}
```
Already-stamped by producer (`create-public-payment-intent:541`).
Mobile change required: **none**.

**`confirm-deposit-paid`:**
```ts
// Step 1: restaurant_id + transfer_data.destination must match
if (piRestaurantId !== expectedRestaurantId) return 400 pi_restaurant_mismatch;
if (expectedDestination && piDestination !== expectedDestination) return 400 pi_destination_mismatch;
// Step 2: STRICT — payment_id must be in the metadata list
const stamped = (intent.metadata?.deposit_payment_ids ?? "").split(",").map(s => s.trim());
if (!stamped.includes(paymentId)) return 400 pi_payment_id_mismatch;
```
This required **producer changes** — the deposit ID was not being
stamped before. See §2a/§2b below.

### §2a Mobile change required: `deposit_payment_ids` on PI create

When mobile calls `create-public-payment-intent` for a deposit
flow, include `deposit_payment_ids: string[]` (the
`reservation_deposit_payments.id` row UUIDs):

```ts
// BEFORE
const res = await fetch(`${SUPABASE_URL}/functions/v1/create-public-payment-intent`, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey, Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({
    restaurant_id: restaurantId,
    amount_cents: amountCents,
    hold_id: holdId,         // optional
    saved_card_id: savedId,  // optional
  }),
});

// AFTER (deposit flows only)
const res = await fetch(`${SUPABASE_URL}/functions/v1/create-public-payment-intent`, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey, Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({
    restaurant_id: restaurantId,
    amount_cents: amountCents,
    hold_id: holdId,
    saved_card_id: savedId,
    deposit_payment_ids: [depositRowId],  // ← NEW: UUID(s) from reservation_deposit_payments
  }),
});
```

**Validation:** producer requires each entry to match
`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`,
caps at 16 items.

**When you have the ID:**

- **Magic-link flow** (diner taps `/deposit/:id`): the `:id` IS the
  `reservation_deposit_payments.id`. Pass `[paymentId]`. This mirrors
  the web `DepositPayPage` pattern.
- **Inline flow** (diner pays directly on the restaurant page, then
  `prepare-deposit` creates rows): the deposit rows don't exist yet
  at PI-create time. See §2b for the alternative.

### §2b Mobile change (optional): post-charge stamping via `prepare-deposit`

For the inline split-pay flow where the diner pays BEFORE
`prepare-deposit` creates the deposit rows, the web side passes the
PI id to `prepare-deposit` so it stamps the metadata server-side after
insert:

```ts
const prep = await fetch(`${SUPABASE_URL}/functions/v1/prepare-deposit`, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey },
  body: JSON.stringify({
    reservation_id: reservationId,
    payers: payersBody,
    payment_intent_id: paymentIntentId,  // ← NEW (optional)
  }),
});
```

`prepare-deposit` calls `stripe.paymentIntents.update(pi_id, {
metadata: { deposit_payment_ids: insertedRows.map(r => r.id).join(",") } })`
post-insert. After this, `confirm-deposit-paid` finds the
metadata and accepts.

This is **optional** — if mobile doesn't have an inline post-charge
split-pay flow, skip §2b entirely. Use §2a for the more common
magic-link path.

### §2c Pre-deploy concern (already handled)

Any pending deposits with PIs created BEFORE this deploy lack the
metadata and will fail to confirm. We deployed producer + consumer in
lockstep and the in-flight window is seconds (diners create PI then
pay immediately). Mobile users with already-paid deposits are fine —
only mid-checkout PIs are at risk, and they re-pay if the network
flaked.

---

## §3 Phase 3 — DB hardening (column grants, cron lockdown)

Three migrations applied to the `exbjodmnpdiayfzrdyux` Supabase
project. **All server-side. Zero mobile changes.**

### §3a Column-level UPDATE allowlist on `restaurants` (Vuln 5)

Before: any authenticated user (e.g. a logged-in diner) could write
any column on a restaurant they own via direct supabase-js. The
publish-gate trigger only checked column values, not who supplied
them — so an owner could self-publish a restaurant without KYC by
running:

```sql
UPDATE restaurants SET
  stripe_charges_enabled=true,
  payment_method_attached_at=NOW(),
  is_published=true
WHERE id='<own>';
```

After: `REVOKE UPDATE ON TABLE public.restaurants FROM authenticated;`
then `GRANT UPDATE (allowed_columns) TO authenticated`. Owners can
still edit name / address / hours / theme / deposit_tiers / etc., but
trust-boundary columns are service-role only:

**Blocked from authenticated UPDATE:**
- `stripe_*` (account_id, customer_id, charges_enabled, payouts_enabled,
  details_submitted, onboarding_complete, subscription_id,
  payment_method_id)
- `subscription_*` (status, cancel_*, current_period_end, paused_at)
- `trial_ends_at`, `payment_method_attached_at`, `is_published`,
  `paused_reason`, `deleted_at`, `scheduled_purge_at`,
  `referral_credit_granted_at`
- `is_active`, `plan`, `owner_user_id`, `referral_code`,
  `referred_by_restaurant_id`
- `billing_card_*`

**Mobile impact:** mobile already goes through edge functions
(`publish-restaurant`, `save-subscription-payment-method`,
`create-stripe-account`, `delete-restaurant`, etc.) for everything in
the blocked list. Those edge fns use service-role and bypass the
grant restriction. So mobile is unaffected.

**If mobile EVER did a direct `supabase.from("restaurants").update({...})`
on a trust-boundary column**, it would now fail with `permission denied
for column X`. Migrate that call to the appropriate edge fn.

### §3b `cenaiva_call_cron_function` lockdown (Vuln 6)

`REVOKE EXECUTE ON FUNCTION public.cenaiva_call_cron_function(text)
FROM PUBLIC, anon, authenticated;`

Only `postgres` (which is what cron itself runs as) and `service_role`
can call it now. Before, any logged-in user could invoke any cron
with the platform secret.

**Mobile impact: NONE.** Mobile doesn't trigger crons.

### §3c `cenaiva_cron_config` table RLS (Vuln 7)

`ALTER TABLE public.cenaiva_cron_config ENABLE ROW LEVEL SECURITY;`
plus REVOKE everything. The plaintext `cron_secret` is no longer
readable by authenticated users.

**Mobile impact: NONE.** Mobile never reads this table.

### §3d FK `ON DELETE CASCADE` → `RESTRICT` on audit/consent tables (Vuln 10)

Tables affected: `subscription_consent_log`, `restaurant_notification_log`,
`referral_credits`. Before, a hard `DELETE FROM restaurants` would
cascade-wipe all audit history, violating CRA 7-year retention.

**Mobile impact: NONE.** Mobile doesn't hard-delete restaurants
(it uses `delete-restaurant` edge fn which does soft-delete +
anonymize, not hard delete).

---

## §4 Phase 4 — Open redirect (web frontend only)

`apps/web/src/pages/auth/AuthCallbackPage.tsx:155` — `handleMergeDone`
now validates the `from` query param via `isSafeRedirectPath` before
calling `window.location.href = from`. Closes a phishing vector
where `/auth/callback?from=https://evil.com` could send a freshly-
authenticated victim to a credential-capture page.

**Mobile impact: NONE.** Mobile doesn't use the `/auth/callback?from=…`
pattern. The OAuth flow on mobile uses deep links, not query-param
redirects.

---

## §5 Phase 5 — MEDIUM findings

### §5a `signup-restaurant-owner` email enumeration (Vuln 9)

Before: returned `{ error: "An account with this email already exists" }`
with 409 if the email was registered, distinct from 400 / 200 otherwise.
Attacker could oracle "is this email registered with Cenaiva?".

After: returns uniform 200 with
`{ ok: true, requires_email_verification: true, message: "Check your
email to complete setup. If you already have an account, sign in with
the existing credentials." }` in both the new-signup and
already-exists cases.

**Mobile impact:** if mobile's onboarding flow branches on the
"An account with this email already exists" error string, that branch
will never fire anymore. Update mobile to:

- Tell the user "Check your email to complete setup" uniformly
- Suggest "If you already have an account, sign in instead" in
  the success-state UI
- Rely on the email Supabase sends (or doesn't send) to be the
  signal of whether they're new

This branch only affects the **legacy email/password signup** path.
The modern OAuth+JWT path is unchanged.

### §5b Cascade-delete → restrict (Vuln 10)

Covered in §3d above. Mobile impact: NONE.

### §5c `check-in-guest` IDOR (Vuln 11)

Before: function had ZERO auth + ownership check. Any authenticated
user could check in any reservation at any restaurant by guessing IDs.

After: requires `auth.getUser`-verified caller + staff role on the
reservation's restaurant.

**Mobile impact:** if mobile's owner-side app calls `check-in-guest`,
it must:
- Send `Authorization: Bearer <real signed JWT>`
- The user must have a row in `user_restaurant_roles` for the
  reservation's restaurant

Owner-side mobile already does this; expected behavior.

### §5d `accept-staff-invite` null email/phone match (Vuln 13)

Before: a phone-only signer could accept an email-only invite because
the null-vs-string check evaluated to "no mismatch detected".

After: requires a POSITIVE match on at least one of (email, phone)
between the invite and the signed-in user.

**Mobile impact:** if mobile lets a phone-only user accept an
email-only staff invite, it now 403s. Users must sign in with the
contact that received the invite. UX-wise: show
"Sign in with the email address or phone number this invite was sent
to" if 403 returned.

---

## §6 Phase C — Input validation across 48 edge functions

The biggest defense-in-depth pass. 48 edge fns that previously used
raw `req.json()` now use `parseJsonBody(req, ZodSchema)` from
`supabase/functions/_shared/validation/parse.ts`.

### §6a Why this matters for mobile

Every body field on every covered fn now has:
- A strict type (UUID, ISO datetime, E.164 phone, etc.)
- A length cap (free text bounded to 200 / 2000 / 5000 chars
  depending on context)
- An enum check (where applicable)

Pre-fix, the raw `req.json()` parse just took whatever was there
and the fn body did spot-checks. Post-fix, the schema rejects
unexpected/oversized fields at the gate with `HTTP 400 + Zod error`.

**Mobile impact:** any mobile call that was sending:
- A non-UUID where a UUID is expected
- An invalid email format
- A phone number that isn't E.164 (`+1XXXXXXXXXX`)
- Free text exceeding the cap (e.g. special_request > 2000 chars)
- A required field as `null` or missing
- An unexpected enum value
- A number outside its range

…will now return 400. Pre-fix, those payloads "worked" but the
fn might have stored junk or behaved unpredictably.

### §6b Schema reference index

All schemas live in `supabase/functions/_shared/validation/`. Import
from there or copy the equivalent shape on the mobile side. Each
file groups by domain:

| File | Schemas | Used by |
|---|---|---|
| `base.ts` | `Uuid`, `Email`, `EmailLower`, `E164Phone`, `BoundedText(N)`, `Money`, `ConfirmationCode`, `Iso8601` | All others |
| `booking.ts` | `CancelReservationSchema`, `ModifyReservationSchema` | cancel-reservation, modify-reservation (pre-existing) |
| `restaurant.ts` | `RestaurantOnboardingSchema`, `SignupRestaurantOwnerSchema` | signup-restaurant-owner |
| `restaurant-ops.ts` | `PublishRestaurantSchema`, `DeleteRestaurantSchema`, `DispatchDepositInvitesSchema`, `NotifyDepositPayersRefundedSchema`, `DetectDuplicatesSchema`, `GeocodeRestaurantSchema` | publish-restaurant, delete-restaurant, dispatch-deposit-invites, notify-deposit-payers-refunded, detect-duplicates, geocode-restaurants |
| `charge.ts` | `StripeChargeOrderSchema` | stripe-charge-order (pre-existing) |
| `deposit.ts` | `PrepareDepositInputSchema`, `DepositPayerSchema` | prepare-deposit |
| `chat.ts` | `CenaivaChatSchema`, `CenaivaOrchestrateSchema`, `CenaivaSmallPromptSchema`, `ElevenLabsTtsSchema`, `GenerateMenuSuggestionsSchema` | cenaiva-chat, cenaiva-orchestrate, cenaiva-small-prompt, elevenlabs-tts, generate-menu-suggestions |
| `public.ts` | `ValidateReferralCodeSchema`, `FindReservationSchema`, `GetDepositPaymentContextSchema`, `GetOrderPublicSchema`, `LoyaltyWaitlistSignupSchema`, `SubmitDemoRequestSchema` | validate-referral-code, find-reservation, get-deposit-payment-context, get-order-public, loyalty-waitlist-signup, submit-demo-request |
| `reservation-hold.ts` | `CreateReservationHoldSchema`, `UpdateReservationHoldSchema`, `HeartbeatReservationHoldSchema`, `CancelReservationHoldSchema`, `ConfirmHoldPaidSchema`, `CheckInGuestSchema`, `CloseBillSchema`, `ConfirmDepositStubSchema` | reservation-hold lifecycle, check-in-guest, close-bill, confirm-deposit-stub, confirm-hold-paid |
| `payment.ts` | `StripeAttachPaymentMethodSchema`, `StripeDetachMethodSchema`, `StripeSetupIntentSchema`, `RefundPaymentIntentSchema`, `MarkOrderPaidSchema`, `ConfirmDepositPaidSchema` | stripe-attach-payment-method, stripe-detach-method, stripe-setup-intent, refund-payment-intent, mark-order-paid, confirm-deposit-paid |
| `subscription.ts` | `RestaurantIdOnlySchema`, `SaveSubscriptionPaymentMethodSchema`, `UpdateSubscriptionPaymentMethodSchema`, `CreateSubscriptionSchema`, `CreateBillingPortalSessionSchema` | cancel/pause/resume/restart-subscription, recover-restaurant, save-/update-subscription-payment-method, create-subscription, create-account-session, create-billing-portal-session, create-stripe-account |
| `observability.ts` | `ObservabilityRestaurantOnlySchema`, `ListStripeInvoicesSchema`, `ListStripePayoutsSchema`, `UpdateBillingDetailsSchema` | get-next-bill-preview, get-restaurant-payment-method, list-stripe-invoices, list-stripe-payouts, update-billing-details |
| `staff-invites.ts` | `AcceptHostInviteSchema`, `AcceptStaffInviteSchema`, `ApproveStaffActionSchema`, `InviteHostSchema`, `InviteStaffSchema` | accept-host-invite, accept-staff-invite, approve-staff-action, invite-host, invite-staff |
| `referral.ts` | `ApplyReferralCreditSchema` | apply-referral-credit |
| `account.ts` | `DeleteAccountSchema`, `MergeDinerAccountsSchema` | delete-account, merge-diner-accounts |

### §6c Common field-shape gotchas for mobile

- **`Uuid`**: must match `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`. No braces, no uppercase variations (lowercase auto-coerced).
- **`Email`**: lowercased server-side; mobile can send mixed-case but invalid emails (no `@`, no TLD) reject.
- **`E164Phone`**: must start with `+`, country code, then digits, max 15 chars total. If mobile collects raw `"(416) 555-1234"`, format to `"+14165551234"` before send.
- **`BoundedText(N)`**: trimmed, min 1, max N chars. Long bios / special requests / menu suggestions exceeding the cap reject.
- **`Money`**: integer cents, non-negative, max 100,000 (= $1000) by default. Specific schemas override for higher amounts (deposit can go to 10M cents = $100k).
- **`ConfirmationCode`**: 6-character uppercase alphanumeric (excluding ambiguous chars).
- **`Iso8601`**: full ISO with timezone. Date-only strings ("2026-05-20") will fail in most contexts.

### §6d Per-fn payload reference (high-traffic mobile calls)

Reference the schema file above for the full shape. Most common
mobile calls + their now-required fields:

**Booking & reservation:**

```ts
// create-public-booking (anon, no auth required)
{ restaurant_id: Uuid, reserved_at: Iso8601, party_size: 1-50,
  guest_full_name: BoundedText(200), guest_email: Email,
  guest_phone: E164Phone, // either required if no auth
  special_request?: BoundedText(2000), preorder_items?: [...] }

// modify-reservation (auth)
{ reservation_id: Uuid, reserved_at?: Iso8601, party_size?: 1-50,
  guest_full_name?: BoundedText(200), special_request?: BoundedText(2000) }

// cancel-reservation (auth OR confirmation_code)
{ reservation_id: Uuid, actor?: "diner"|"owner", reason?: BoundedText(500),
  confirmation_code?: ConfirmationCode } // if anon caller

// find-reservation (anon)
{ email?: Email, phone?: E164Phone, confirmation_code?: ConfirmationCode }
// At least one of email/phone/confirmation_code required
```

**Reservation holds (auth):**

```ts
// create-reservation-hold
{ restaurant_id: Uuid, reserved_at: Iso8601, party_size: 1-50,
  guest_full_name?: BoundedText(200), guest_email?: Email,
  guest_phone?: E164Phone }
// update-reservation-hold
{ hold_id: Uuid, /* same fields, all optional */ }
// heartbeat-reservation-hold
{ hold_id: Uuid }
// cancel-reservation-hold
{ hold_id: Uuid }
```

**Payment (auth required for diner-scoped ops):**

```ts
// create-public-payment-intent (auth optional; required for save_card)
{ restaurant_id: Uuid, amount_cents: 50–10,000,000,
  saved_card_id?: Uuid, hold_id?: Uuid, save_card?: boolean,
  deposit_payment_ids?: Uuid[] }  // ← NEW for §2a

// stripe-list-methods (auth)
{} // empty body
// stripe-attach-payment-method (auth)
{ payment_intent_id: /^pi_/ }
// stripe-detach-method (auth)
{ payment_method_id: /^pm_/ }
// stripe-setup-intent (auth — Branch B for diner; Branch A includes restaurant_id)
{ restaurant_id?: Uuid }
// confirm-deposit-paid (anon)
{ payment_id: Uuid, payment_intent_id: /^pi_/ }
// confirm-hold-paid (auth)
{ hold_id: Uuid, payment_intent_id: /^pi_/ }
// mark-order-paid (auth — staff role)
{ order_id: Uuid, payment_intent_id: /^pi_/ }
```

**AI / voice (auth):**

```ts
// cenaiva-chat
{ messages: [{role: "user"|"assistant", content: BoundedText(5000)}],
  context?: {...} }
// cenaiva-orchestrate (SSE response)
{ transcript: BoundedText(5000), /* context */ }
// cenaiva-small-prompt
{ transcript: BoundedText(2000), booking?: {...} }
// elevenlabs-tts
{ text: BoundedText(5000), voice_id?: BoundedText(100) }
```

**Owner-side (auth + ownership):**

```ts
// publish-restaurant
{ restaurant_id: Uuid, disclosure_text?: BoundedText(2000) }
// delete-restaurant
{ restaurant_id: Uuid, confirmationName: BoundedText(200) }
// cancel-subscription / pause / resume / restart / recover-restaurant
{ restaurant_id: Uuid }
// save-subscription-payment-method
{ restaurant_id: Uuid, payment_method_id: /^pm_/, disclosure_text: BoundedText(2000),
  referral_code?: BoundedText(50) }
// update-billing-details
{ restaurant_id: Uuid, billing_legal_name?: BoundedText(200),
  billing_email?: Email, billing_address_*?: BoundedText(300),
  billing_tax_id_type?: enum, billing_tax_id_value?: BoundedText(50) }
```

**Staff invites (auth + owner role):**

```ts
// invite-staff / invite-host
{ restaurant_id: Uuid, email?: Email, phone?: E164Phone,
  role: enum, permission_overrides_json?: { allow?: PermKey[], deny?: PermKey[] } }
// accept-staff-invite / accept-host-invite
{ token: BoundedText(200), action?: "accept"|"decline"|"preview" }
```

### §6e amount_cents upper bound (Vuln C3)

`create-public-payment-intent` previously had no upper bound on
`amount_cents` (only `>= 50`). Added cap at 10,000,000 cents
($100k CAD). If mobile lets users enter > $100k it'll 400 now.

---

## §7 Phase A — `CRON_SECRET` rotation (operational)

The cron-callable edge fns share a secret in
`cenaiva_cron_config.cron_secret` + `CRON_SECRET` env var.
The lockdown in §3c stopped new leaks of the secret, but the old
value was world-readable before the lockdown landed.

The web team rotated the secret on 2026-05-20:
1. Generated new value via `openssl rand -base64 32`
2. Set via `supabase secrets set CRON_SECRET=...`
3. Updated the DB row via service-role SQL
4. Redeployed all 14 cron-validating edge fns

**Mobile impact: NONE.** Mobile doesn't trigger or validate crons.

---

## §8 Mobile Action Items — checklist

### Required (if you have these flows)

- [ ] **Deposit payment**: when calling `create-public-payment-intent`
  for a deposit (anywhere your mobile shows a deposit-pay screen),
  pass `deposit_payment_ids: [depositPaymentId]` in the body.
  See §2a.
- [ ] **Inline split-pay**: if your mobile has a "diner pays first, then
  prepare-deposit creates rows" flow, pass `payment_intent_id` to
  `prepare-deposit`. See §2b.

### Required input-validation audit

- [ ] **Audit phone number format** at every mobile call site that
  sends a phone field. Must be E.164 (`+1XXXXXXXXXX`). Use
  `libphonenumber` to normalize. See §6c.
- [ ] **Audit free-text length** on any field mobile lets the user
  type unbounded (`special_request`, `dietary_notes`, AI
  prompts). Truncate client-side to the schema's cap (most are
  2000 chars; AI prompts 5000). See §6c.
- [ ] **Audit email format** — Supabase's auth flow already
  validates emails on signup, but if mobile lets users type
  emails in other contexts (referral code, find-reservation),
  validate format before send. See §6c.
- [ ] **Audit UUID format** — anywhere mobile passes an ID it
  pulled from a deep link or query param, validate it matches the
  UUID regex before sending. See §6c.

### UX adjustments

- [ ] **Sign-up flow**: stop branching on "An account with this email
  already exists" string. Show uniform "Check your email to
  complete setup. If you already have an account, sign in instead."
  See §5a.
- [ ] **Staff invite acceptance**: handle the 403 from
  `accept-staff-invite` when the user's sign-in contact doesn't
  match the invite. Show "Sign in with the email/phone this invite
  was sent to". See §5d.

### Nothing needed (automatic benefit)

- JWT signature verification: just send real JWTs from supabase-js.
- All DB hardening (column grants, cron lockdown, FK restrict):
  mobile uses edge fns, doesn't touch the affected tables/fns.
- Open redirect: web-only.
- Cron secret rotation: mobile doesn't see secrets.

---

## §9 Testing & verification matrix mobile should run

Once mobile picks up the above, run this regression matrix:

1. **Sign in** as a new diner → confirm session + JWT in
   subsequent edge-fn calls.
2. **Find a restaurant** via `/discover` mirror → tap to view
   → confirm preview loads.
3. **Book without deposit** → confirm reservation created, owner
   email fires.
4. **Book with deposit** → pay → confirm deposit_payment_ids stamping
   works end-to-end (deposit row flips to `'charged'`, reservation
   confirms).
5. **Modify reservation** → party size up → confirm delta charge
   succeeds.
6. **Cancel** → refund issued.
7. **Save card** → list saved cards → detach.
8. **Subscription card save** (owner side) → publish → confirm
   `consent_log` rows.
9. **Test bad input**: try sending `special_request` with 10,000 chars
   → expect 400 + Zod error. Confirm mobile UI surfaces it.
10. **Test forged JWT** (paranoid): hardcode a fake token, hit any of
    the §1 fns → expect 401 (was 200 pre-fix; serves as proof you're
    on the post-fix backend).

---

## §10 Reference: file layout in the repo

If you need to read source:

- **Backend changes:** `supabase/functions/` — every fn listed in
  §1–§6 has its `index.ts` modified. Search for the schema's
  `parseJsonBody(req, FooSchema, ...)` call to see the gate.
- **Web frontend changes** (relevant for parity):
  - `apps/web/src/components/booking/StripePaymentForm.tsx` —
    threading of `depositPaymentIds` prop (§2a reference impl)
  - `apps/web/src/pages/customer/DepositPayPage.tsx` — magic-link
    flow (§2a reference impl)
  - `apps/web/src/pages/customer/RestaurantPublicPage.tsx` —
    inline post-charge flow (§2b reference impl)
  - `apps/web/src/pages/auth/AuthCallbackPage.tsx` — Phase 4
    (web-only)
- **Schemas:** `supabase/functions/_shared/validation/*.ts` — see
  the table in §6b.
- **DB migrations applied 2026-05-20:**
  - `security_audit_log_fk_restrict_20260520`
  - `security_restaurants_column_grants_20260520`
  - `security_cron_lockdown_20260520`

---

## §11 Open questions / future hardening

Things deliberately left for later (none block mobile from shipping):

- A future iteration could tighten Vuln 14 (`get-my-staff-invites`
  enumeration) — currently filtered as FP because `auth.getUser`
  returns a verified email, but defense-in-depth would still scope
  by `auth.uid()` instead of email-OR-phone.
- External pen-test pass — internal review only at the moment.
- Forensic audit of historical Supabase logs to determine whether
  any of the 14 closed vulns were ever exploited (separate task).

If mobile finds anything that looks off — schemas too tight,
unexpected 400s, missing fields — open an issue against the
web repo and tag the security pass; the schemas can be widened
in a follow-up migration without breaking anything else.
