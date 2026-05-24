# Stripe Live Mode Migration Checklist

When you flip from test mode to live mode, every Stripe Dashboard config you set up in test mode lives in a separate "live mode" view in the same Dashboard. **Nothing carries over automatically.** This doc captures the exact steps verified in test mode on 2026-05-23 so live setup is a copy-paste exercise.

**Order matters.** Do the steps in sequence — some live-mode Supabase secrets gate edge functions, and webhook delivery starts firing the moment you save a webhook endpoint.

---

## Pre-flight

- [ ] Confirm you have the **live mode** Stripe Dashboard open (top-left toggle, "Viewing test data" should be OFF)
- [ ] Cenaiva Connect platform must be approved for live mode (Settings → Connect)
- [ ] Have the Supabase Dashboard for `exbjodmnpdiayfzrdyux` open in another tab (Project Settings → Edge Functions → Manage Secrets)

---

## Step 1 — API keys

Stripe Dashboard → **Developers → API keys** (live mode tab).

- [ ] Copy the **Publishable key** (`pk_live_...`) → set as `VITE_STRIPE_PUBLISHABLE_KEY` in:
  - `apps/web/.env.production` (commit-safe — publishable keys are public)
  - Amplify environment variables
- [ ] Reveal + copy the **Secret key** (`sk_live_...`) → set as `STRIPE_SECRET_KEY` in Supabase secrets

```
supabase secrets set STRIPE_SECRET_KEY=sk_live_xxxxx --project-ref exbjodmnpdiayfzrdyux
```

⚠️ Never commit `sk_live_*` to git. Never paste into the frontend.

---

## Step 2 — Create the $199.99 CAD/month subscription Price

Stripe Dashboard → **Catalog → Products** (live mode).

- [ ] Find existing "Cenaiva Subscription" product OR create new
- [ ] Add a Price: **$199.99 CAD, recurring monthly**
- [ ] Set `tax_behavior: exclusive` and tax code `txcd_10103001` (SaaS)
- [ ] Copy the Price ID (`price_...`) — NOT the Product ID (`prod_...`)
- [ ] Set as `STRIPE_SUBSCRIPTION_PRICE_ID` in Supabase secrets

```
supabase secrets set STRIPE_SUBSCRIPTION_PRICE_ID=price_live_xxxxx --project-ref exbjodmnpdiayfzrdyux
```

⚠️ **Common mistake** I made in test mode: pasted `prod_...` instead of `price_...`. Stripe Subscriptions API rejects Product IDs with `resource_missing`. Double-check the prefix.

---

## Step 3 — Webhooks (the big one)

Cenaiva needs **TWO webhook endpoints** in live mode. Both point to the same Supabase URL but use different signing secrets and listen to different event types.

### 3a — "Your account" webhook (platform events)

Stripe Dashboard → **Developers → Webhooks** (live mode tab) → **+ Add endpoint**.

- [ ] **Endpoint URL:** `https://exbjodmnpdiayfzrdyux.supabase.co/functions/v1/stripe-webhook`
- [ ] **Listen to:** Events on your account (default — this is the "Your account" type)
- [ ] **Events to send:** select these:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `customer.subscription.trial_will_end`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `invoice.finalized`
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `charge.dispute.created`
  - `charge.dispute.updated`
  - `charge.dispute.closed`
- [ ] Click **Add endpoint**
- [ ] Click into the new endpoint → **Reveal** signing secret → copy `whsec_...`
- [ ] Set as `STRIPE_WEBHOOK_SECRET_PLATFORM` in Supabase secrets

```
supabase secrets set STRIPE_WEBHOOK_SECRET_PLATFORM=whsec_live_xxxxx --project-ref exbjodmnpdiayfzrdyux
```

### 3b — "Connected accounts" webhook (Connect events)

Same dashboard page → **+ Add endpoint** again.

- [ ] **Endpoint URL:** `https://exbjodmnpdiayfzrdyux.supabase.co/functions/v1/stripe-webhook` (same URL!)
- [ ] **Listen to:** Events on Connected accounts (toggle this on)
- [ ] **Events to send:** select these:
  - `account.updated` ← critical for KYC state sync (Step 8 wizard reads this)
  - `account.application.authorized`
  - `account.application.deauthorized`
  - `payment_intent.succeeded`
  - `charge.refunded`
- [ ] Click **Add endpoint**
- [ ] Reveal signing secret → copy `whsec_...`
- [ ] Set as `STRIPE_WEBHOOK_SECRET` in Supabase secrets

```
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_live_xxxxx --project-ref exbjodmnpdiayfzrdyux
```

⚠️ The same webhook URL handles both — our handler tries both secrets and uses whichever verifies. If you swap the env vars, the function will still work but you'll see slightly more 400-then-200 transitions in the logs.

---

## Step 4 — Stripe Tax (HST/GST collection on Cenaiva revenue)

Stripe Dashboard → **Tax → Settings** (live mode).

- [ ] Enable **Stripe Tax** for Canada (accepts 0.5% Stripe surcharge)
- [ ] Set Cenaiva's **origin address** (your registered business address)
- [ ] Set **registration status**:
  - If you're HST-registered → enter your number
  - If under $30K CAD annual revenue → mark "Not registered" (Stripe still calculates rates per-province)
- [ ] On the $199.99 Price (from Step 2) → confirm `tax_behavior: exclusive` and tax code `txcd_10103001`
- [ ] On the booking fee product → set tax code `txcd_10103001` (SaaS)

---

## Step 5 — Connect platform settings

Stripe Dashboard → **Connect → Settings** (live mode).

- [ ] Confirm **Account type: Express** is enabled for Canada
- [ ] Capabilities granted to connected accounts: **Transfers only** (NOT `card_payments` — we use destination-charges)
- [ ] **MCC:** 5812 (Eating Places, Restaurants) as default
- [ ] **Branding:** upload Cenaiva logo + brand color for the hosted Connect onboarding pages

---

## Step 6 — Restricted keys for cron / batch jobs (optional but recommended)

Stripe Dashboard → **Developers → API keys → Restricted keys** (live mode).

- [ ] Create a restricted key called "cron-bill-booking-fees" with only `invoice items: write` + `customers: read` permissions
- [ ] Don't bother for now — `STRIPE_SECRET_KEY` (full secret) is fine until you scale

---

## Step 7 — Redeploy edge functions after secret swaps

After updating any Supabase secret, edge functions need to be redeployed (or restarted) to pick up the new value. The CLI:

```
unset SENTRY_DSN && supabase functions deploy stripe-webhook \
  --project-ref exbjodmnpdiayfzrdyux \
  --use-api \
  --import-map supabase/functions/deno.json
```

Functions that read Stripe-related env vars (deploy each after secret swap):

- `stripe-webhook`
- `create-stripe-account`
- `create-account-link`
- `create-public-payment-intent`
- `confirm-deposit-paid`
- `confirm-hold-paid`
- `mark-order-paid`
- `cancel-reservation`
- `refund-payment-intent`
- `refund-deposit-on-arrival`
- `modify-reservation`
- `stripe-charge-order`
- `stripe-setup-intent`
- `save-subscription-payment-method`
- `publish-restaurant`
- `bill-booking-fees`
- `list-stripe-payouts`
- `delete-restaurant`
- `recover-restaurant`
- `purge-deleted-restaurants`
- `cleanup-stale-onboarding-cards`
- `stripe-detach-method`

(Yes, that's the lot. Easier to redeploy all with a loop than miss one.)

---

## Step 8 — Verification recipe

After everything above is done, validate the live setup:

1. Open the wizard at `https://cenaiva.com/setup?new=1` (logged in as a test owner account)
2. Drive through Steps 1-7 and land on Step 8
3. Click **Continue with Stripe** → Stripe's HOSTED onboarding loads in live mode (URL contains `connect.stripe.com`, not `dashboard.stripe.com/test/...`)
4. Use a **real ID** and **real bank account** — test cards/IDs DO NOT work in live mode
5. Submit on Stripe → land back on Step 8
6. Check Supabase Edge Function logs for `stripe-webhook POST | 200` — webhook signature verified
7. Check DB: `select stripe_requirements_due, stripe_requirements_processing, stripe_payouts_enabled from restaurants where id = ...;`
8. Wizard should show:
   - 🔵 Blue "Verifying with Stripe" while Stripe processes (could take minutes to hours in live vs seconds in test)
   - 🟢 Green "Verified" when complete

If you see 🟧 Yellow "Action required" that persists for >24h, Stripe genuinely wants something — click "Continue with Stripe" to deep-link to the open item.

---

## Common live-mode gotchas

- **Webhook delivery requires HTTPS.** Supabase Edge Functions are HTTPS by default — fine.
- **Webhook retries** continue for 3 days on 4xx/5xx. If you fix a bug, Stripe will eventually replay the events. You can also manually replay from the Dashboard.
- **Live mode KYC takes minutes to hours**, not seconds. Don't panic about the blue "Verifying" state.
- **Cards.** Live mode rejects all `4242 4242 4242 4242` family test cards. Use a real card.
- **API version lock.** Our edge fns pin to `2024-11-20.acacia`. If Stripe forces an upgrade later, update `_shared/stripe-client.ts` AND re-test all flows.
- **Default disabled-reason check is brittle.** Past versions of our edge fns parsed `disabled_reason` to detect "Stripe is processing" — that broke in 2026-05-23 because the prefix is `requirements.pending_verification` (not just `pending_verification`). The current code ignores `disabled_reason` entirely and relies on `currently_due` + `pending_verification` arrays only. If a future Stripe API change moves to a different field, update all 3 fns (`stripe-webhook`, `create-stripe-account`, `list-stripe-payouts`) in lock-step.

---

## Rollback plan

If live mode goes sideways:

1. **Revert the publishable key** in Amplify → frontend stops trying to call live Stripe
2. **Swap `STRIPE_SECRET_KEY` back to test** in Supabase secrets → backend stops minting live charges
3. **Disable the live webhook endpoints** (Stripe Dashboard → Webhooks → disable button) so retries don't pile up
4. **Don't touch the live restaurants' Stripe accounts** — they keep working on whatever state they're in. Just no new ones can be created via the (now-test) backend.

---

## Reference: keys + secrets at a glance

| Secret name | Where to set | Value source | Test value (today) |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Supabase secrets | Stripe Dashboard → API keys → Secret | `sk_test_...` |
| `STRIPE_SUBSCRIPTION_PRICE_ID` | Supabase secrets | Stripe Dashboard → Catalog → Prices | `price_...` |
| `STRIPE_WEBHOOK_SECRET` | Supabase secrets | Webhook endpoint "Connected accounts" signing secret | `whsec_...` |
| `STRIPE_WEBHOOK_SECRET_PLATFORM` | Supabase secrets | Webhook endpoint "Your account" signing secret | `whsec_...` |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Amplify env vars + `.env.production` | Stripe Dashboard → API keys → Publishable | `pk_test_...` |

---

## What was verified in test mode on 2026-05-23

End-to-end test of `Cenaiva Final Test` (acct_1TaF9TJYwimTX5RW):

1. Wizard Steps 1-7 → restaurant draft created
2. Step 8 → click "Continue with Stripe" → hosted onboarding loaded
3. Submitted business details + bank → returned to Step 8
4. Webhook fired `account.updated` → Supabase received 200 OK → DB columns written
5. Wizard polled DB → flipped from 🟧 Yellow → 🔵 Blue → 🟢 Green
6. End state: `charges_enabled=true`, `payouts_enabled=true`, all requirements arrays empty
