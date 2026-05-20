# Production Launch Checklist

Everything you need to do BEFORE flipping Stripe from test → live mode.
The code is already production-ready (audited 2026-05-20) — this list is
about the business + operational prep that exists regardless of how good
the integration is.

Print this. Tick boxes as you go.

---

## Part 1 — Technical cutover (~15 min of clicks)

These steps are quick but irreversible-ish. Do them in order on launch day.

### Stripe Dashboard tasks
- [ ] Activate live mode (toggle in upper-right of dashboard)
- [ ] Recreate the **$199.99 CAD/month subscription Price** in live mode
  - Products → Cenaiva Standard → Create new Price
  - Copy the `price_xxx` ID for the env var below
- [ ] Add a new **live webhook endpoint**:
  - URL: `https://exbjodmnpdiayfzrdyux.supabase.co/functions/v1/stripe-webhook`
  - Subscribe to all 7 events:
    - `customer.subscription.created`
    - `customer.subscription.updated`
    - `customer.subscription.deleted`
    - `customer.subscription.trial_will_end`
    - `invoice.payment_failed`
    - `invoice.payment_succeeded`
    - `invoice.finalized`
  - Copy the signing secret (`whsec_xxx`) for the env var below
- [ ] (If using Connect) Verify the live Connect platform settings
  - Settings → Connect → Platform settings
  - Confirm the "destination charge" model is active
- [ ] Accept Stripe's Connect platform terms (one-time, required before any
      restaurant can onboard in live mode)

### Supabase secret swaps
Run `supabase secrets set NAME=value` for each, OR update via Dashboard:
- [ ] `STRIPE_SECRET_KEY` — `sk_test_...` → `sk_live_...`
- [ ] `STRIPE_WEBHOOK_SECRET` — `whsec_test...` → `whsec_live...`
- [ ] `STRIPE_SUBSCRIPTION_PRICE_ID` — set to the new `price_xxx` from above
- [ ] `STRIPE_CONNECT_CLIENT_ID` — verify, usually same as test
- [ ] (Optional) Keep `STRIPE_WEBHOOK_SECRET_PLATFORM` if using dual secrets

### Frontend `.env` swap
- [ ] `VITE_STRIPE_PUBLISHABLE_KEY` — `pk_test_...` → `pk_live_...`
- [ ] Redeploy frontend (Vercel auto-deploys on env change, or rebuild)

### Data cleanup
- [ ] Delete the 10 test restaurants (their Connect `acct_xxx` IDs are
      test-only and won't work in live mode). SQL:
      ```sql
      DELETE FROM restaurants WHERE id IN (...test ids...);
      ```
- [ ] (Optional) Clean up old test reservations, orders, expenses

### Smoke test in live mode
- [ ] Process a real $0.50 charge to yourself via the diner flow
- [ ] Verify it appears in your Stripe live mode dashboard
- [ ] Refund the $0.50 via Stripe dashboard
- [ ] Verify the refund webhook fires and your DB updates

---

## Part 2 — Business / Legal (do BEFORE first paying customer)

These items are independent of code — they're about being a real business.

### Legal pages on cenaiva.com
- [ ] **Terms of Service** — covers paying customers
  - What does the subscription include?
  - When can Cenaiva terminate the account?
  - What happens to data on cancellation?
  - Liability limits
- [ ] **Privacy Policy** — current and accurate
  - What data do you collect?
  - How long do you keep it?
  - GDPR/PIPEDA compliance notes
  - Third parties (Stripe, Supabase, Resend, etc.)
- [ ] **Refund Policy** — clear and visible
  - **Current policy**: Cenaiva keeps 5.5% commission on cancellations; restaurant gets refunded 94.5%
  - Below $12 base, diner also forfeits the Stripe fee they paid (gross-up)
  - Above $12 base, diner only forfeits the 5.5% commission
  - This needs to be IN WRITING on the site so diners can't claim "they didn't tell me"
- [ ] **Cookie banner** if not already present (some Canadian provinces require this)

### First customer
- [ ] **First friendly restaurant lined up** as guinea pig
  - Someone you know personally
  - Willing to call you when something breaks
  - Will let you watch them go through onboarding
- [ ] **First-customer onboarding plan**
  - Walk them through Stripe Connect setup over Zoom
  - Make sure they bookmark the dashboard
  - Give them your direct phone number for emergencies
- [ ] **Soft launch window** — 1-2 weeks with just the first restaurant
  before opening to more
- [ ] **Marketing site updates** if needed (remove "Beta" labels, etc.)

---

## Part 3 — Operational readiness (assign before launch)

These are "who handles X when it happens" questions. Write down the answer.

### Dispute response
- Stripe gives you **7 days** to respond to a chargeback before you lose
  the money automatically
- [ ] **Primary responder**: ___________________ (you, partner, or VA)
- [ ] **Backup responder**: ___________________
- [ ] **Where alerts come in**: Stripe dashboard email + webhook
- [ ] **Response process**:
  - Pull reservation details from DB (booking confirmation, dietary notes,
    cancellation history)
  - Pull receipt PDF from Stripe (already linked in Settings → Billing)
  - Upload as evidence in Stripe dashboard
  - Add note explaining the charge was for "Cenaiva platform subscription"
    or "deposit for reservation at [restaurant name] on [date]"

### Failed-payment recovery
- When a restaurant's monthly subscription bill fails, Stripe retries 3
  times over 7 days, then marks the subscription `past_due` → `unpaid`
- [ ] Already automated: `payment_failed` email fires to owner via Resend
- [ ] Already automated: dashboard shows banner + PayoutsSection turns amber
- [ ] **Manual escalation if owner doesn't update card after 7 days**:
  - Phone call from you/team
  - At 30 days unpaid: subscription auto-pauses, restaurant unpublishes

### Billing email triage
- Owners will email about:
  - "Why was I charged $X?"
  - "Can I get a refund?"
  - "My card on file isn't working"
  - "I want to cancel"
  - "How do I update my GST number?"
- [ ] **Inbox**: ___________________ (billing@cenaiva.com? Mark's email?)
- [ ] **SLA**: respond within 24 hours weekdays, 48 hours weekends
- [ ] **Template responses** drafted for the 5 common questions above

### Saturday-night incident response
- If a diner can't book at 8pm Friday because Stripe is rejecting their
  card, what happens?
- [ ] **On-call person**: ___________________
- [ ] **Phone reachable**: Y / N
- [ ] **Escalation path** if on-call is unreachable: ___________________
- [ ] **Acceptable downtime** (be realistic — small SaaS doesn't need 4-nines)

### Monitoring
- [ ] Set up a Stripe Dashboard email alert for: dispute opened, payout
      failed, large refund issued
- [ ] (Optional) Cenaiva-side monitoring: Supabase logs alerting on
      `stripe-webhook` failures, `bill-booking-fees` failures
- [ ] Daily "Stripe health check" routine for first month:
  - Glance at Stripe dashboard for any red flags
  - Glance at Cenaiva dashboard for paused/failed restaurants

---

## Part 4 — Compliance (lower priority but real)

These are real obligations once you're actually transacting.

### Canadian sales tax (GST/HST)
- [ ] Register for GST/HST if you'll exceed **$30,000 in 4 consecutive
      quarters** (you might not initially, but plan for it)
- [ ] Add Cenaiva's own tax ID to invoices once registered
- [ ] Charge GST/HST on the $199.99/mo subscription if registered

### Bookkeeping
- [ ] Decide on bookkeeping software (QuickBooks, Wave, Xero)
- [ ] Connect Stripe to it via integration
- [ ] Monthly reconciliation routine
- [ ] Year-end tax docs export ready (you have this in `/dashboard/export`)

### Insurance (optional but recommended)
- [ ] Tech E&O insurance covers screwups (~$100-200/mo)
- [ ] Cyber insurance covers breaches (~$50-100/mo)
- [ ] Not required, but if you're handling restaurant payments at scale,
      worth pricing

---

## Part 5 — Final pre-launch verification

Right before flipping live mode, do these checks one more time:

- [ ] All 4 secret env vars are LIVE values (no `sk_test`, no `pk_test`)
- [ ] Live webhook endpoint is active in Stripe dashboard
- [ ] First friendly restaurant knows it's launch day
- [ ] You're available for the first 24-48 hours
- [ ] Refund policy is visible on the website
- [ ] You've personally completed one test charge in live mode and
      refunded it successfully

## Launch day routine

- [ ] Activate live mode (if not already)
- [ ] Have friendly restaurant onboard via live Connect Embedded
- [ ] Walk through their first booking with them on Zoom
- [ ] Watch the Stripe dashboard for the first 30 minutes
- [ ] Celebrate 🎉

---

## What's NOT in this list (already done)

These were verified production-ready on 2026-05-20:

- ✅ All Stripe integration code (no security holes, no money leaks)
- ✅ Threshold-based fee policy (diner pays < $12, Cenaiva absorbs >= $12)
- ✅ Cancel refund pipeline (94.5% to diner, 5.5% commission kept)
- ✅ Modify flows (upsize + downsize with auto-charge/refund)
- ✅ Save card via setup_future_usage
- ✅ Voice-pay money routing (cenaiva-chat + cenaiva-orchestrate)
- ✅ Race conditions + idempotency on all payment flows
- ✅ Cancel confirmation modals everywhere
- ✅ Apple Pay + Google Pay enabled, Klarna/Affirm/Link blocked
- ✅ Webhook signature verification
- ✅ Cross-customer attack prevention
- ✅ Rate limits on all payment endpoints

You don't need to re-verify these. The code is solid.
