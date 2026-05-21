# HABBI_STRIPE_GUIDE.md — Stripe setup + security (universal)

**Author:** Mark Habbi
**First written:** 2026-05-21
**Source:** every Stripe gotcha I hit while building Cenaiva, plus
the security patterns from the audit.
**Scope:** universal — drop this into ANY project that uses Stripe,
regardless of language or framework. Most rules apply to any
Stripe integration: subscriptions, one-time charges, Connect
(marketplace) setups, custom checkout flows.

**How to use:**
- Starting a new project with Stripe? Follow Part 1-7 in order
  during setup.
- Building features? Apply Part 8 (security patterns) to every
  payment-touching change.
- Before going live? Run through Part 9 (pre-launch checklist).
- Ongoing? Part 10 (operations).

---

## TL;DR — the 10 things I wish I knew on day 1

1. **`prod_` vs `price_` IDs are different things.** Subscriptions
   API needs `price_...` IDs. Don't put `prod_...` in your
   `STRIPE_SUBSCRIPTION_PRICE_ID` env var. (I did this. Took hours
   to figure out.)
2. **Test mode and live mode are completely separate worlds.**
   Different keys, different webhooks, different Products, different
   Prices, different Customers. Nothing copies between them.
3. **Test keys are `sk_test_...` / `pk_test_...`. Live keys are
   `sk_live_...` / `pk_live_...`.** Never mix them up. Never put
   live keys in your client-side code (`pk_live_` is OK; `sk_live_`
   never).
4. **Every PaymentIntent must have metadata binding it to your DB
   record.** Then verify at confirm time. Otherwise attackers
   substitute any succeeded PI.
5. **Webhook signature MUST be verified before reading any field.**
   Anyone with the URL can POST to it. The signature is the only
   proof Stripe sent it.
6. **Apple Pay / Google Pay need domain verification.** Apple Pay
   won't show until you upload a file to your domain and register
   it in Stripe. Google Pay needs a real prod cert.
7. **Stripe Connect Express vs Standard vs Custom — pick Express
   for most use cases.** Onboards merchants in 5 minutes vs hours.
8. **`stripe_charges_enabled = true` is the flag that says a merchant
   can actually receive money.** Until that flips, no charges
   destined for them succeed. Listen for the `account.updated`
   webhook to track it.
9. **Idempotency keys on EVERY retryable payment operation.**
   Stripe dedupes within 24h. Without them, double-taps double-charge.
10. **Refunds are amount-aware.** If you took an application fee
    (your cut), refunding the full charge auto-refunds the fee too,
    UNLESS you set `refund_application_fee: false`. Watch this.

---

## Part 1 — Stripe account setup (one-time)

### 1.1 Create the account

`stripe.com` → Sign up. Use a real business email. Verify your
identity, link a bank account, complete KYC. This takes 1-3 days.

### 1.2 The two-mode mental model

Inside one Stripe account, you have:
- **Test mode** — sandbox. Fake cards (`4242 4242 4242 4242`), no
  real money, no fees, separate from production data.
- **Live mode** — real cards, real money, real fees.

You toggle between them via the switch in the Stripe dashboard
header. **They share nothing.** A Product you create in test mode
doesn't exist in live mode. A Customer created in test mode
doesn't exist in live mode. Each has its own:
- API keys
- Webhooks
- Products / Prices
- Customers
- Subscriptions
- Connect accounts

When you build, you work in test mode. When you launch, you flip
to live mode and recreate everything you need (or use the export
button — see Part 7.5).

### 1.3 Get your API keys

Dashboard → Developers → API keys. You'll see:
- **Publishable key** — starts with `pk_`. Safe in client-side
  code (frontend, mobile apps).
- **Secret key** — starts with `sk_`. Server-only. NEVER in
  client code. NEVER in screenshots. NEVER in shared docs.

In test mode the prefixes are `pk_test_...` and `sk_test_...`. In
live mode `pk_live_...` and `sk_live_...`. Test mode has unlimited
keys; live mode has one publishable key + one default secret key
+ optionally restricted keys for narrow scopes.

### 1.4 Bank account + payouts

In live mode: Settings → Payouts → add a bank account. Stripe
sends money on a rolling schedule (daily/weekly depending on
country). Most countries: 2-7 days from charge to bank deposit.

For Connect marketplaces (Part 4): each merchant adds their own
bank account during onboarding; you don't see it.

### 1.5 Tax + invoices

If you're a SaaS charging subscriptions:
- Settings → Tax → enable Stripe Tax if you sell across borders
- Settings → Invoicing → upload your logo, set business address,
  customize email templates

---

## Part 2 — API keys management (security-critical)

### 2.1 Where keys go

| Key | Where it lives | Notes |
|---|---|---|
| `pk_test_...` | Local `.env`, staging hosting | Public-safe; can ship to client |
| `sk_test_...` | Local `.env`, staging hosting | Server-only; never to client |
| `pk_live_...` | Production hosting env vars | Public-safe; can ship to client |
| `sk_live_...` | Production hosting env vars ONLY | NEVER in `.env` files committed to git; NEVER in client; NEVER pasted anywhere |
| `whsec_...` (webhook secret) | Server-side env var, scoped per environment | Used for signature verification |

### 2.2 Naming convention

Use the same env var names across environments, only the VALUE
differs:
- `STRIPE_PUBLISHABLE_KEY` (or `VITE_STRIPE_PUBLISHABLE_KEY` for client-readable)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_SUBSCRIPTION_PRICE_ID`
- `STRIPE_CONNECT_CLIENT_ID` (if doing Connect)

In dev/staging, these point at test mode. In prod, they point at
live mode. Same names. Easy to swap.

### 2.3 Restricted API keys (good practice, not required)

For service-specific use, create restricted keys (Dashboard →
Developers → API keys → "Create restricted key"). Scope them to
just what they need (e.g. read-only for analytics, write for
PaymentIntents only). Reduces blast radius if leaked.

### 2.4 Rotate after any incident

If you suspect a secret key leaked (laptop stolen, contractor
left, accidentally pasted in a chat):
1. Dashboard → Developers → API keys → "Roll" (creates new, marks
   old as expiring)
2. Update env var in your hosting provider
3. Redeploy
4. Watch the dashboard for any rejected requests using the old key
5. After 24h with no rejections, "Reveal" → delete the old key

You CAN rotate without downtime if you do it right.

---

## Part 3 — Webhooks setup

Webhooks are how Stripe tells your server "a payment succeeded,"
"a subscription renewed," etc. You need them for every async event
you care about.

### 3.1 Create a webhook endpoint

Dashboard → Developers → Webhooks → "Add endpoint":
- **URL**: `https://yourdomain.com/webhook` (or wherever your
  webhook handler lives — for Supabase, typically
  `https://<project>.supabase.co/functions/v1/stripe-webhook`)
- **Events to listen to**: subscribe ONLY to the events you
  handle. Don't subscribe to all events — your endpoint will get
  spammed with stuff you don't care about. Common ones:
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `charge.refunded`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `account.updated` (for Connect)
- Click "Add endpoint"

Stripe shows you the signing secret `whsec_...` ONE TIME. Copy it
to your env vars as `STRIPE_WEBHOOK_SECRET`.

### 3.2 Test mode vs live mode webhooks are SEPARATE

You need TWO webhook endpoints: one for test mode, one for live.
Different signing secrets. Different URLs (e.g. point at staging
vs prod). When you flip from test to live, update your prod
hosting's `STRIPE_WEBHOOK_SECRET` to the live one.

### 3.3 Verify the signature on EVERY incoming webhook

In your handler:

```ts
const sig = req.headers.get("stripe-signature");
const body = await req.text();  // RAW text, not parsed JSON
const event = await stripe.webhooks.constructEventAsync(
  body, sig, STRIPE_WEBHOOK_SECRET,
);
// Only now is `event` trustworthy.
```

**Common bug:** parsing the body as JSON before signature verification
breaks the signature check. Stripe signs the EXACT raw bytes. Use
`req.text()` first, then verify, then JSON.parse if needed.

### 3.4 Dedupe by event ID

Stripe delivers at-least-once. Same event can fire 2-3 times.
Track `event.id` in your DB; ignore if already processed.

```ts
// In your handler:
const existing = await db.from("processed_webhook_events")
  .select("id").eq("event_id", event.id).maybeSingle();
if (existing) return ok(); // already handled
// ... process ...
await db.from("processed_webhook_events").insert({ event_id: event.id });
```

### 3.5 Respond fast (200 within a few seconds)

If your handler doesn't return 200 within ~20 seconds, Stripe
retries. Long-running work (sending emails, updating analytics)
should be enqueued, not blocked.

### 3.6 Webhook testing in development

Stripe CLI: `stripe listen --forward-to localhost:5174/webhook`.
This forwards real test-mode events from Stripe to your local
machine. Test signatures work. Use this for local dev.

---

## Part 4 — Stripe Connect (multi-merchant) setup

Skip this section if your app charges ONE Stripe account
(yours). Read it if you have multiple merchants (e.g. a
marketplace, restaurants, Uber-style platform).

### 4.1 Pick your Connect type

| Type | Onboarding time | Stripe UX | When to use |
|---|---|---|---|
| **Express** | ~5 minutes | Stripe-hosted | Most marketplaces. Recommended. |
| **Standard** | ~15 minutes | Stripe-hosted, fuller dashboard | Merchants who want their own Stripe dashboard |
| **Custom** | varies | Build entire onboarding yourself | Only if you have specific compliance needs |

**Default: Express.** It's the fastest for merchants and the
least code to maintain.

### 4.2 Connect Embedded vs Connect Hosted

For Express, you have two onboarding UX options:
- **Embedded** (newer, recommended) — onboarding renders inside an
  iframe in YOUR dashboard. Merchant never leaves your site.
- **Hosted** — Stripe-hosted URL the merchant visits, then redirects
  back.

For the cleanest UX, use Embedded. Requires the `@stripe/connect-js`
library on the client.

### 4.3 Onboarding flow

1. Merchant signs up on your site, says "I want to accept
   payments."
2. Server creates a Connect account: `stripe.accounts.create({
   type: "express", country: "CA", capabilities: { card_payments: {
   requested: true }, transfers: { requested: true } } })`.
3. Server creates an "account session" or "account link" depending
   on Embedded vs Hosted.
4. Merchant goes through KYC: identity, business info, bank.
5. Stripe sends `account.updated` webhook events as the merchant
   progresses.
6. Eventually `account.charges_enabled = true` flips. THAT's when
   the merchant can receive money.

### 4.4 `charges_enabled` is your "ready" flag

Track this per-merchant in your DB. Until it's true:
- Don't show their listing on the public side
- Don't let diners book/pay at their restaurant
- Don't bill the merchant for subscriptions

In Cenaiva, this is the `restaurants.stripe_charges_enabled` column.
Updated by the `account.updated` webhook handler.

### 4.5 Charging on behalf of a connected merchant

Two models:
- **Direct charges** — created on the connected account. Funds
  land in their balance directly.
- **Destination charges** — created on your platform account
  with `transfer_data.destination`. Funds land in their balance.
  Your platform optionally takes an application fee.

For most marketplaces: **destination charges with
`transfer_data.destination` and `application_fee_amount`**. Your
platform gets a cut, the rest goes to the merchant.

```ts
await stripe.paymentIntents.create({
  amount: 1000,             // total charge in cents
  currency: "cad",
  application_fee_amount: 55,  // your 5.5% cut
  transfer_data: { destination: merchantStripeAccountId },
  metadata: { /* your binding metadata */ },
});
```

### 4.6 Refunds + application fees

When you refund a destination charge:
- By default, the application fee is also refunded.
- Override with `refund_application_fee: false` if you want to keep
  your cut even on refund.
- Cenaiva refunds `total - application_fee` so the diner gets back
  94.5% and the platform keeps the 5.5% commission.

Pick a policy and document it (refund policy customers see).

---

## Part 5 — Subscriptions setup

Skip if you're not charging recurring subscriptions.

### 5.1 Products vs Prices (THIS BURNED ME)

In Stripe, a **Product** is a thing you sell ("Pro Plan"). A
**Price** is a specific cost ("$199.99 CAD/month"). One Product can
have many Prices (monthly, annual, with discount, etc.).

**The trap I fell into:** I put a `prod_USX4rqMU6E7f4V` (Product ID)
into `STRIPE_SUBSCRIPTION_PRICE_ID`. The Subscriptions API
rejects with `resource_missing` because it wants a Price ID
(`price_1TTc0YJABKj4FeJXsR18YzVw`), not a Product ID.

**Rule: ALWAYS pass `price_...` IDs to subscriptions, NEVER
`prod_...` IDs.** Verify with `stripe.prices.retrieve(...)` after
any env var change.

### 5.2 Creating a Product + Price

Dashboard → Products → Add product:
1. Name: "Standard" (or whatever)
2. Pricing model: Standard pricing
3. Price: $19.99 (or whatever) — pick currency
4. Billing period: Monthly / Annual
5. Save

Stripe creates a Product (`prod_...`) and a Price (`price_...`) for
it. The Price ID is what you use in code.

### 5.3 Trial periods

In Cenaiva: 90-day free trial starts when the merchant publishes
their restaurant, not when they save their card. Two ways:

- **Stripe-managed trials**: pass `trial_period_days: 90` when
  creating the subscription. Stripe handles the trial countdown.
- **App-managed trials**: store `trial_ends_at` in your DB, gate
  the subscription create call until trial ends. More flexible
  but more code.

Cenaiva does app-managed. Simpler to deviate from Stripe's default
trial logic (e.g. "trial only starts on publish").

### 5.4 Subscription lifecycle states

The states Stripe will surface via webhooks:
- `trialing` — in the free trial window
- `active` — paying
- `past_due` — failed last invoice, Stripe retrying
- `unpaid` — exhausted retries, Stripe gave up
- `canceled` — sub ended
- `incomplete` — first payment failed
- `incomplete_expired` — never got past first payment

Listen for `customer.subscription.updated` and react to each
state. Cenaiva auto-pauses the restaurant (sets
`is_published=false`) on `unpaid`/`canceled`, republishes on
recovery to `trialing`/`active`.

### 5.5 Failed payment recovery

Stripe Smart Retries retries failed payments on a schedule (3-4
attempts over a few weeks). You don't have to write retry logic.
Configure in Dashboard → Settings → Subscriptions and emails.

### 5.6 Card on file vs subscription creation

You can SAVE a card without creating a subscription (use
SetupIntent). This is the "card-save before publish" pattern.
- `SetupIntent` saves the PaymentMethod to the customer.
- Later, `stripe.subscriptions.create({ customer, items, default_payment_method: pmId })` actually starts charging.

Cenaiva separated these in May 2026: card-save and subscription
creation are now two different actions. Trial starts at
subscription creation (= publish), not at card save.

---

## Part 6 — Apple Pay + Google Pay setup

### 6.1 Apple Pay

Three prerequisites for Apple Pay to show on your site:
1. **Apple Pay Merchant ID** — create one in Apple Developer
   portal (free with developer account, $99/year)
2. **Domain verification** — Dashboard → Settings → Payments →
   Apple Pay → "Add new domain" → upload the
   `.well-known/apple-developer-merchantid-domain-association` file
   to your domain root → click verify
3. **HTTPS with valid cert** — Apple Pay refuses self-signed certs
   in production. Cenaiva.com has Let's Encrypt; works fine. Local
   dev with self-signed cert won't show Apple Pay.

In code (web): pass `wallets: { applePay: "auto" }` to
PaymentElement options.

In code (mobile native): use `merchantIdentifier:
"merchant.com.yourdomain"` in your Stripe SDK config.

### 6.2 Google Pay

Simpler:
1. **HTTPS** with valid cert (same as Apple Pay)
2. **User signed into Chrome with a saved card** (out of your control)
3. **Google Pay enabled in Stripe Dashboard** — Dashboard →
   Settings → Payments → Google Pay → toggle on

In code: `wallets: { googlePay: "auto" }`.

In test mode, Google Pay shows but uses a test wallet. Real
behavior in live mode only.

### 6.3 Link (Stripe's own wallet) — usually OFF

Link shows a "Secure, fast checkout with Link" banner above your
card form. Some apps want it (faster checkout); most don't (extra
brand confusion).

Set `wallets: { link: "never" }` to hide. Cenaiva does this on
all card-entry surfaces.

---

## Part 7 — Test mode → live mode migration

### 7.1 What carries over

Almost nothing. Test mode and live mode are separate worlds.

### 7.2 What you need to recreate in live mode

When you flip to live:
- All Products + Prices (Dashboard now has a "Copy to live mode"
  button for these — saves time)
- Webhook endpoints (different URLs, different signing secrets)
- Connect platform settings (branding, OAuth client ID if applicable)
- Apple Pay domain verification (separate per mode)

### 7.3 What stays in test mode forever

- Test Customers, test PaymentMethods, test PaymentIntents
- Test Connect accounts (merchants who onboarded in test mode are
  test-only)
- Test subscriptions

Don't expect any of these to "come with you" to live. Test mode is
a playground.

### 7.4 Update your env vars

In your prod hosting (AWS Amplify, Vercel, etc.):
- `STRIPE_PUBLISHABLE_KEY` → live `pk_live_...`
- `STRIPE_SECRET_KEY` → live `sk_live_...`
- `STRIPE_WEBHOOK_SECRET` → live `whsec_...` (different from test's)
- `STRIPE_SUBSCRIPTION_PRICE_ID` → live `price_...` (different
  from test's)
- `STRIPE_CONNECT_CLIENT_ID` (if applicable) → live `ca_...`

Redeploy. Watch for errors.

### 7.5 First live transaction smoke test

Before announcing your launch:
1. Use a real card you own
2. Book / purchase / subscribe — the smallest unit you can
3. Verify the charge in Stripe Dashboard → Payments → live mode
4. Verify the webhook fired and your DB updated
5. Refund the charge to yourself
6. Verify the refund hit your bank statement (next business day)

If any step fails, you have time to debug before customers hit it.

---

## Part 8 — Security patterns (the hard rules)

These map to the 14-vulnerability hardening batch on Cenaiva. Apply
to every Stripe integration regardless of language/framework.

### 8.1 PI metadata is the binding mechanism

**Rule:** at PaymentIntent creation, stamp metadata that links to
your DB record (order_id, booking_id, etc.). At confirmation,
assert the metadata matches the record you're settling.

**Why:** without this, an attacker who knows YOUR order's id can
submit any unrelated succeeded PI of sufficient amount and have
your code mark the order paid.

**Producer (PI create):**
```ts
await stripe.paymentIntents.create({
  amount, currency,
  metadata: {
    order_id: yourOrderId,
    // other binding IDs:
    user_id: customerId,
    item_ids: itemIds.join(","),
  },
  // ... other params
});
```

**Consumer (your "mark paid" endpoint):**
```ts
const intent = await stripe.paymentIntents.retrieve(piId);
if (intent.status !== "succeeded") return err("not paid");
if (intent.metadata?.order_id !== yourOrderId) return err("pi_mismatch");
if (intent.amount < yourOrder.amountCents) return err("amount_too_low");
// safe to mark paid now
```

### 8.2 Verify destination on Connect

If you route to merchants via `transfer_data.destination`, verify
the destination matches the expected merchant before marking
payment-succeeded.

```ts
const piDestination = intent.transfer_data?.destination;
if (piDestination !== expectedMerchantAccountId) return err("destination_mismatch");
```

### 8.3 Verify amount ≥ expected (NOT exact match)

Charges may bundle (pre-order + deposit + tip). Don't fail on
`!==`. Use `>=`.

```ts
if (intent.amount < requiredCents) return err("amount_too_low");
```

But also: don't accept a $0.50 PI as full payment for a $50 order.
Stripe enforces minimum charge amounts (~50 cents); your check
catches the rest.

### 8.4 Idempotency keys

Every retryable payment operation has an idempotency key.

```ts
await stripe.paymentIntents.create(params, {
  idempotencyKey: `pi_${userId}_${orderId}`,  // deterministic
});
```

Stripe dedupes within 24h. Same key + same params = same PI. Same
key + different params = error (good — catches accidental param
changes during retry).

### 8.5 Never trust client-supplied amounts

The CLIENT can lie about the price. The SERVER recomputes.

**Wrong:**
```ts
// client sends { amount: 100, item_id: "X" }
await stripe.paymentIntents.create({ amount: clientBody.amount });
```

**Right:**
```ts
// server looks up item_id, computes price from DB
const item = await db.getItem(clientBody.item_id);
await stripe.paymentIntents.create({ amount: item.priceCents });
```

### 8.6 Webhook signature verification (covered in Part 3)

Every webhook: verify signature → read fields → process.

### 8.7 Never log secret keys, full PANs, or full PMs

Logs grow forever and leak.

**Safe to log:** `pi_xxx` IDs, `pm_xxx` IDs (last 4 chars are
fine), customer IDs (`cus_xxx`), event IDs, amounts.

**Never log:** secret keys, webhook signing secrets, full card
numbers, full CVCs (Stripe never sends these to you anyway).

### 8.8 Connect platform separation

If your platform uses Connect, the platform's Stripe customer (you)
is SEPARATE from each merchant's Stripe customer. Don't get them
confused.

Cenaiva had this bug: SetupIntent created on the diner's customer
when it should have been on the restaurant's. Fix: when saving a
card "for the merchant," create SetupIntent on the merchant's
account, not the diner's.

### 8.9 PaymentMethod sharing limits

A PaymentMethod attached to Customer A CANNOT be moved to Customer
B. Stripe blocks this. If you need a card on a different customer,
create a new PaymentMethod via SetupIntent on that customer.

### 8.10 SetupIntent for save-for-later

Use SetupIntent (not PaymentIntent) when you want to save a card
without charging immediately. The card sits on the customer's
saved methods. Later, charge it off-session:

```ts
await stripe.paymentIntents.create({
  amount, currency,
  customer: customerId,
  payment_method: pmId,
  off_session: true,    // no UI prompt; we're charging a saved card
  confirm: true,        // create + confirm in one shot
});
```

If SCA (Strong Customer Authentication) is required (Europe, etc.),
Stripe may return `requires_action` — handle by surfacing a
challenge on-session.

### 8.11 Refund discipline

When you refund:
- Decide whether to refund the application fee (`refund_application_fee`)
- Decide whether to refund partial vs full (`amount`)
- Mark your DB record refunded BEFORE creating the Stripe refund
  (to prevent double-refund on retry)
- OR after, with idempotency key — pick one

### 8.12 Customer creation on demand

Don't pre-create Stripe Customers for every user. Create lazily:
when they first attempt a payment. Saves on Customer count + keeps
your Stripe dashboard tidy.

```ts
let customerId = user.stripe_customer_id;
if (!customerId) {
  const c = await stripe.customers.create({ email: user.email });
  customerId = c.id;
  await db.user.update({ stripe_customer_id: customerId });
}
```

---

## Part 9 — Pre-launch checklist (universal)

Before flipping test → live, walk through this. EVERY ITEM.

### Account
- [ ] Business KYC completed in live mode
- [ ] Bank account verified for payouts
- [ ] Tax settings configured (Stripe Tax enabled if applicable)
- [ ] Invoice branding (logo, address) set up
- [ ] Statement descriptor set (the text on customer credit card
      statements — e.g. "CENAIVA")
- [ ] Support email + phone on account (Stripe shows these to
      customers)

### API keys + secrets
- [ ] Live `pk_live_...` and `sk_live_...` saved in production
      hosting env vars
- [ ] Live `whsec_...` saved (NOT the test one)
- [ ] No `sk_live_...` keys anywhere in client-side code or git
- [ ] No live keys in screenshots, chat history, or shared docs

### Products + Prices
- [ ] Every subscription Price ID env var is a `price_...`
      (NOT `prod_...`)
- [ ] Every test-mode Price has a live-mode equivalent (use
      "Copy to live mode")
- [ ] Currency is correct (CAD vs USD matters)
- [ ] Trial periods configured (or app-managed trial state in
      your DB)

### Webhooks
- [ ] Live webhook endpoint configured with correct URL
- [ ] Subscribed to ALL events you actually handle (no more, no less)
- [ ] Webhook signature verification in code — tested with a fake
      signature to confirm it rejects
- [ ] Event-ID dedupe table set up in DB
- [ ] Webhook handler returns 200 in < 5 seconds

### Connect (if applicable)
- [ ] Live-mode Connect type confirmed (Express recommended)
- [ ] Connect onboarding flow tested end-to-end with a real
      merchant
- [ ] At least one merchant has `charges_enabled = true` in live
- [ ] Bank account verified for that merchant
- [ ] Application fee policy documented (your cut %)
- [ ] Refund policy documented (do you keep the application fee
      on refund?)

### Wallets
- [ ] Apple Pay domain verified for production domain
- [ ] Apple Pay capability enabled in iOS app entitlements (if
      mobile)
- [ ] Google Pay enabled in dashboard
- [ ] `link: "never"` set on PaymentElement / PaymentSheet (or
      "auto" if you want Link)

### Security
- [ ] PI metadata stamping at create time (Rule 8.1)
- [ ] Metadata + amount + destination assertion at confirm time
      (8.1-8.3)
- [ ] Idempotency keys on all retryable charges (8.4)
- [ ] No client-supplied amounts trusted (8.5)
- [ ] Webhook signature verified before reading fields (8.6)
- [ ] No secret keys in logs (8.7)
- [ ] Customer/account separation correct for Connect (8.8)
- [ ] SCA challenges handled for off_session charges (8.10)

### Operational
- [ ] Daily payout schedule confirmed in dashboard
- [ ] Customer support email monitored
- [ ] Dispute notification email monitored (chargebacks happen)
- [ ] Refund approval flow documented internally
- [ ] First live transaction smoke test passed (Part 7.5)

---

## Part 10 — Ongoing operations

### 10.1 Watch for disputes (chargebacks)

Customers can dispute charges via their bank. Stripe notifies
you via `charge.dispute.created` webhook. You have ~7 days to
submit evidence. Lose the dispute → you lose the money + a $15
fee.

Best practices:
- Reply within 24h with evidence (receipt, delivery confirmation,
  policy screenshots)
- Track dispute rate; >1% triggers Stripe review

### 10.2 Monitor failure rates

Dashboard → Payments → "Card decline rates." High decline rates
(>10%) signal:
- Wrong card details from users (UX problem)
- Fraud blocking by issuer (your Radar settings)
- Bad geographies (cards from countries with low approval)

Fix root cause; don't ignore.

### 10.3 Update card-saved-on-file when subscriptions fail

Stripe Smart Retries handles most failed renewals, but eventually
the customer needs to update their card. Send them an email link
to your billing-portal-session URL. Customers can update without
losing their subscription.

### 10.4 Stripe Radar (fraud detection)

Comes free with Standard pricing. Dashboard → Radar → review
flagged charges. Tune rules if you see patterns (e.g. block
prepaid cards if you have issues).

### 10.5 Annual security review

Every year:
- Re-read this file
- Audit your code against all 12 Part 8 rules
- Rotate webhook signing secrets
- Review who has access to your Stripe account (Dashboard →
  Settings → Team)
- Confirm API key restrictions are still tight

### 10.6 Stripe API version upgrades

Stripe pins your account to an API version. They release new
versions periodically. Dashboard → Developers → API version. You
can upgrade explicitly when you're ready (and test in test mode
first).

Don't auto-upgrade major API versions; breaking changes happen.

---

## Part 11 — Common pitfalls I hit (don't repeat)

### "I'm using the right API key but getting permission errors"

Check: am I in test mode or live mode in the dashboard? Are my
keys from the matching mode? `pk_test_` won't authenticate
live-mode requests and vice versa.

### "My webhook events aren't being received"

In order:
1. Is the webhook URL reachable from the internet? `curl <URL>` from
   a non-local machine.
2. Is `STRIPE_WEBHOOK_SECRET` set on the server? `console.log` to
   confirm (DON'T log the value, just `Boolean(secret)`).
3. Is signature verification passing? Add temporary logging on
   error.
4. Is your handler returning 200 within 20 seconds?
5. Look at Dashboard → Developers → Webhooks → your endpoint →
   "Recent deliveries" tab. Errors are listed there.

### "My subscription create call fails with `resource_missing`"

You probably passed a Product ID (`prod_...`) where a Price ID
(`price_...`) is expected. Confirm via
`stripe.prices.retrieve(envVarValue)`.

### "Apple Pay isn't appearing on my live site"

Likely causes (in order):
1. Domain not verified in Stripe (Settings → Apple Pay)
2. Test mode keys still in production env vars
3. User's device has no card in Apple Wallet
4. Cert issue (self-signed cert or staging cert)

Test on a real iPhone with a wallet card, on your verified live
domain.

### "My platform took a $5 fee but the refund refunded the whole charge"

You forgot `refund_application_fee: false`. Set it on the refund
call to keep your cut.

### "Customer says they were charged but our DB shows no order"

Webhook didn't fire OR your handler errored. Two checks:
1. Dashboard → Payments → search by amount/time → confirm the PI
   in Stripe.
2. Dashboard → Developers → Webhooks → recent deliveries — was the
   `payment_intent.succeeded` event delivered? If yes but your DB
   doesn't match, your handler errored. Check logs.

### "Test mode keys leaked accidentally on Github"

Don't panic — test keys can't charge real money. But STILL rotate
(Dashboard → Developers → API keys → Roll test key) because the
leak might also imply your live keys aren't safe.

### "I created a subscription but the trial isn't applied"

If you used Stripe-managed trial (`trial_period_days: 90`), confirm
in Dashboard → Subscriptions that the trial is showing. If you're
managing trial yourself in your DB, confirm `trial_ends_at` is set
and your gating code reads it.

### "PaymentMethod attach failed with 'already attached to another customer'"

PMs can only be on one customer. Detach from old, attach to new.
Or use SetupIntent to create a fresh PM on the right customer.

### "Refund is in `failed` state"

The customer's bank refused the refund (rare). Stripe tries again
automatically. If it keeps failing, you may have to issue a
manual refund check / ACH. Contact Stripe support.

---

## Part 12 — Useful Stripe CLI commands

Install: `brew install stripe/stripe-cli/stripe`. Login:
`stripe login`.

| Command | What it does |
|---|---|
| `stripe listen --forward-to localhost:PORT/webhook` | Forward test events to your local webhook handler |
| `stripe trigger payment_intent.succeeded` | Fire a fake test event to your handler |
| `stripe payment_intents list --limit 10` | Recent PIs (test mode) |
| `stripe payment_intents retrieve pi_XXX` | Inspect a specific PI |
| `stripe subscriptions list --customer cus_XXX` | A customer's subs |
| `stripe events resend evt_XXX` | Re-send a webhook event (useful for debugging) |
| `stripe logs tail` | Live API logs for your account |

---

## Part 13 — Resources

- **Stripe Docs** — https://stripe.com/docs (the canonical source)
- **Stripe Status** — https://status.stripe.com (when "is Stripe
  down?")
- **Stripe Discord** — community help, surprisingly responsive
- **Stripe API Changelog** — https://stripe.com/docs/upgrades
  (track breaking changes)
- **Stripe Test Cards** — https://stripe.com/docs/testing#cards
  (every behavior you need to test)

---

## Part 14 — Quick reference card

**Test cards (test mode):**
| Card | Behavior |
|---|---|
| `4242 4242 4242 4242` | Success, no SCA |
| `4000 0025 0000 3155` | SCA challenge → success |
| `4000 0000 0000 9995` | Insufficient funds decline |
| `4000 0000 0000 0002` | Generic decline |
| `4000 0000 0000 0069` | Expired card |
| `4000 0000 0000 0127` | Incorrect CVC |

Any future expiry. Any 3-digit CVC. Any postal code.

**Env vars (universal naming):**
```
STRIPE_PUBLISHABLE_KEY=pk_test_... or pk_live_...
STRIPE_SECRET_KEY=sk_test_... or sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_SUBSCRIPTION_PRICE_ID=price_...
STRIPE_CONNECT_CLIENT_ID=ca_...   # only for Connect
```

**ID prefixes (recognize at a glance):**
- `acct_` — Connect account
- `ch_` — Charge (legacy; prefer PaymentIntent)
- `cs_` — Checkout Session
- `cus_` — Customer
- `dp_` — Dispute
- `evt_` — Event
- `in_` — Invoice
- `ii_` — InvoiceItem
- `pi_` — PaymentIntent
- `pm_` — PaymentMethod
- `po_` — Payout
- `price_` — Price (for subscriptions)
- `prod_` — Product (NOT for subscription create — use price_)
- `re_` — Refund
- `seti_` — SetupIntent
- `sub_` — Subscription
- `txn_` — Balance transaction
- `whsec_` — Webhook signing secret

---

## TL;DR (skim this when in a hurry)

1. Test mode and live mode are separate. Same account, two worlds.
2. `price_...` for subscriptions. `prod_...` is NOT a substitute.
3. Webhook signature verify FIRST, parse body second.
4. PI metadata binds to your DB record. Stamp at create, assert
   at confirm.
5. Idempotency keys on every charge.
6. Apple Pay needs domain verification. Google Pay needs HTTPS.
7. Connect Express + destination charges + 5-10% application fee
   is the most common marketplace shape.
8. `stripe_charges_enabled = true` is the "merchant can receive
   money" flag.
9. Track event IDs to dedupe webhooks (at-least-once delivery).
10. First live transaction = smoke test BEFORE announcing launch.

---

Last updated: 2026-05-21 by Mark Habbi, after the Cenaiva Stripe
integration + 14-vulnerability hardening batch.
