# Stripe setup checklist — Cenaiva

What needs to be done in the Stripe dashboard + environment variables **before** the Phase D (Stripe) work in the restaurant onboarding wizard can be wired up.

The plan file with full context: `/Users/mark_habbi/.claude/plans/okay-make-a-plan-replicated-octopus.md`. Phase D specifically depends on these prerequisites.

**Stack:** Canada (CAD). Stripe Connect Embedded Components (so restaurants never leave Cenaiva to onboard) + Stripe Billing for the $199 CAD/month platform subscription.

**Billing model recap (updated 2026-05-16):**

- Monthly subscription: $199 CAD, 90-day free trial
- $1 per confirmed reservation (platform fee)
- 5.5% of gross on pre-orders (application fee)
- 5.5% of gross on deposits (application fee)
- Cenaiva absorbs Stripe processing fees (~2.9% + 30¢) out of the 5.5% application fee. Restaurants receive the full 94.5% on pre-orders/deposits (Stripe Connect destination-charge default behavior).
- **Cancellation policy**: diner refunded only the restaurant's 94.5% slice; Cenaiva keeps the 5.5% commission as a cancellation cost.

---

## 1. Stripe account (on stripe.com)

### 1.1 Activate the account

- Sign in at https://dashboard.stripe.com
- Complete Activate your account if not already done:
  - Business info (legal name, address, BN/CRA number)
  - Bank account for payouts (transit + institution + account number)
  - Identity verification (government-issued ID, owner DOB)
- Without activation, Stripe blocks live payouts.

### 1.2 Enable Connect

- Go to https://dashboard.stripe.com/settings/connect
- Click Get started
- Choose Platform or marketplace
- Pick the option that lets you onboard sub-accounts (this enables you to create Connect accounts for each restaurant)
- Save

### 1.3 Configure platform branding (so restaurants see "Cenaiva" not "Stripe")

Inside Connect settings:

- Platform name: `Cenaiva`
- Platform logo: upload Cenaiva logo (square format, ~512×512)
- Brand color: match Cenaiva primary (`#EC4899` per the dashboard theme defaults)
- Support email: your support address
- Support URL: https://cenaiva.ai/ (or your actual support page)

These show up on the rare Stripe-hosted surfaces (account recovery emails, payout statements, etc.) so they look like Cenaiva.

### 1.4 Create the subscription product + price

- Products → Add product
- Name: `Cenaiva subscription`
- Description (optional): "Monthly platform subscription. Free 3 months."
- Pricing model: Recurring
- Price: `199.00 CAD`
- Billing period: Monthly
- Free trial: `90 days`
- Save
- After save, copy the price ID (looks like `price_1AbCdEfGhIjKlMnOp`)

This price ID will become the `STRIPE_SUBSCRIPTION_PRICE_ID` env var below.

### 1.5 Set up the webhook endpoint

- Developers → Webhooks → Add endpoint
- Endpoint URL:

  ```
  https://exbjodmnpdiayfzrdyux.supabase.co/functions/v1/stripe-webhook
  ```

  (This is the Cenaiva Supabase project's edge function URL. The `stripe-webhook` function is built in Phase D.)

- API version: leave at the default (latest)
- Events to subscribe to — select these exact events:

  Connect (sub-account state):
  - `account.updated`
  - `account.application.deauthorized`

  Subscriptions:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `customer.subscription.trial_will_end`

  Payments:
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `invoice.payment_failed`

- Add endpoint
- After creation, click Reveal under "Signing secret" — copy the value (looks like `whsec_AbCdEfGhIjKlMnOp`)

This becomes the `STRIPE_WEBHOOK_SECRET` env var below.

### 1.6 Get the API keys

- Developers → API keys
- Copy:
  - Publishable key (`pk_test_…` for test, `pk_live_…` for production) — safe to expose in browser
  - Secret key (`sk_test_…` or `sk_live_…`) — NEVER expose in browser, server-side only

**Start with test mode.** Stripe test keys let you run end-to-end transactions with fake cards (e.g. `4242 4242 4242 4242`) without real money moving. Switch to live keys only after the full flow is verified.

---

## 2. Supabase Edge Function secrets (server-side keys)

These go into the Supabase project's Edge Function environment so the Cenaiva edge functions can talk to Stripe.

Project ref: `exbjodmnpdiayfzrdyux` (ca-central-1)

Set via the Supabase CLI:

```bash
supabase secrets set --project-ref exbjodmnpdiayfzrdyux \
  STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxx \
  STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxx \
  STRIPE_SUBSCRIPTION_PRICE_ID=price_xxxxxxxxxxxxxxxx
```

Or via the dashboard: Project Settings → Edge Functions → Secrets → Add new secret.

| Secret name | What it is | Where to find it |
|---|---|---|
| `STRIPE_SECRET_KEY` | Server-side API key | Step 1.6 above — the Secret key (`sk_test_…` or `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret | Step 1.5 above — the `whsec_…` from the webhook endpoint |
| `STRIPE_SUBSCRIPTION_PRICE_ID` | The $199/mo recurring price | Step 1.4 above — the `price_…` from the product |

**Verify they're set** after adding:

```bash
supabase secrets list --project-ref exbjodmnpdiayfzrdyux
```

You should see all three names (values aren't shown for security).

---

## 3. Web app environment (browser-side publishable key)

The web app needs the publishable key to mount Stripe Elements (the card input + Connect Embedded Components).

### 3.1 Local development

Add to `apps/web/.env.local` (create the file if it doesn't exist):

```
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxx
```

Restart the Vite dev server after adding (`npm run dev` from `apps/web/`).

### 3.2 Production deploy

Wherever the web app is hosted (Vercel / Netlify / similar), set the same env var in the project's environment variables. For Vercel:

- Vercel dashboard → Project → Settings → Environment Variables
- Name: `VITE_STRIPE_PUBLISHABLE_KEY`
- Value: `pk_test_…` (or `pk_live_…` once you're ready for production)
- Apply to all environments (Production, Preview, Development) or specifically Production

After saving, redeploy so the new env var is picked up by the build.

---

## 4. Test mode vs live mode

Strongly recommended: run everything in test mode first.

| Mode | When to use | Key prefixes |
|---|---|---|
| Test | During build-out + initial verification + staging | `sk_test_…`, `pk_test_…`, webhook signing secret from a test-mode endpoint |
| Live | Only after end-to-end smoke test passes in test mode | `sk_live_…`, `pk_live_…`, separate webhook endpoint in live mode |

To switch modes, you swap the keys (both in Supabase secrets and the web app env). The Stripe dashboard has a toggle in the top-right to view test vs live data.

**Test cards** (useful during verification):

- Success: `4242 4242 4242 4242` (any future date, any CVC)
- Auth required (3D Secure): `4000 0025 0000 3155`
- Decline: `4000 0000 0000 0002`
- See more: https://stripe.com/docs/testing

---

## 5. Verification checklist

When everything above is done, run through this before calling Phase D ready:

- [ ] Stripe account fully activated (no warnings in dashboard)
- [ ] Connect platform enabled with Cenaiva branding (logo + name + brand color set)
- [ ] Product created, recurring monthly $199 CAD price with 90-day trial, `price_id` recorded
- [ ] Webhook endpoint created with the 9 events above, signing secret recorded
- [ ] All 3 Supabase secrets set (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SUBSCRIPTION_PRICE_ID`)
- [ ] `VITE_STRIPE_PUBLISHABLE_KEY` set in `apps/web/.env.local` AND in the production hosting env
- [ ] Test mode keys to start (not live)
- [ ] Confirm with `supabase secrets list` that all 3 Supabase secrets are visible

---

## 6. What happens next

Once all of the above is checked off, the Phase D (Stripe) implementation work can begin. That involves:

- 4 new Supabase edge functions:
  - `create-stripe-account` — creates a Connect Custom account for a restaurant (background, no Stripe-branded UI)
  - `create-account-session` — issues a short-lived Account Session token for the embedded Connect onboarding component
  - `create-subscription` — creates the Stripe Customer + Subscription with the 90-day trial
  - `stripe-webhook` — handles the 9 events listed in 1.5; updates `subscription_status` + flips `is_published` on KYC verification

- Frontend changes:
  - Replace `apps/web/src/components/onboarding/Step8InterimPublish.tsx` with the real Step 8 that mounts Connect Embedded Components + Stripe Elements
  - Install npm packages: `@stripe/connect-js`, `@stripe/react-connect-js`, `@stripe/stripe-js`
  - Wire the new edge functions into the wizard's final step

- Real publish gate:
  - Restaurant can only publish after Stripe Connect verification (KYC complete) AND a card is on file (trial started)

- Phase D cleanup:
  - Delete `/setup-legacy` route + `SetupPageLegacy.tsx` (old 5-step wizard)

---

## 7. Useful Stripe docs

- Connect overview: https://stripe.com/docs/connect
- Connect Custom accounts: https://stripe.com/docs/connect/custom-accounts
- Connect Embedded Components: https://stripe.com/docs/connect/get-started-connect-embedded-components
- Account onboarding (embedded): https://stripe.com/docs/connect/embedded-onboarding
- Billing (subscriptions): https://stripe.com/docs/billing/subscriptions/overview
- Trial periods: https://stripe.com/docs/billing/subscriptions/trials
- Application fees: https://stripe.com/docs/connect/destination-charges#collect-fees
- Webhooks: https://stripe.com/docs/webhooks
- Test cards: https://stripe.com/docs/testing

---

## 8. If you get stuck

- Stripe support (chat in dashboard, fast for activation/Connect questions): https://support.stripe.com/contact
- Stripe Discord: https://stripe.dev/discord
- Cenaiva-side issues (the edge functions, the wizard): keep the AI assistant in this repo informed of which step you're on; the plan file has the full context.

---

Last updated: 2026-05-14
