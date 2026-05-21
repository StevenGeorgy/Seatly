# HABBI_INCIDENT_RESPONSE.md — what to do when prod breaks

**Author:** Mark Habbi
**First written:** 2026-05-21
**Scope:** universal — drop into any project. Tailor the contact
list (Part 11) per project; the rest applies anywhere.

**How to use:** when something breaks in production, open this
file. Don't try to think creatively — follow the checklist. Panic
makes you forget basics; the checklist remembers for you.

**Read it ONCE now, while calm.** Even if you never reference the
exact words again, the mental model of "triage in this order" will
stick.

---

## Part 0 — The two rules

1. **Stay calm.** A 10-minute outage handled methodically is
   better than a 60-second outage where you made it worse by
   panicking. Real customers are forgiving; they've all seen
   websites go down.
2. **Communicate early.** Customers tolerate downtime if you tell
   them. They lose trust if they email you and hear nothing for
   3 hours.

---

## Part 1 — The first 5 minutes (triage)

When you notice or hear that something's broken, BEFORE doing
anything else:

### 1.1 Confirm it's actually broken (60 seconds)

Open `yourdomain.com` in an incognito tab. Try to:
- Load the homepage
- Sign in (or try to load a page that needs auth)
- Do one common action (book, pay, browse)

If everything works: customer might be experiencing a local issue.
Reply asking for screenshot + their network/browser.

If something IS broken: continue.

### 1.2 Identify what's broken (2 minutes)

Answer these in order:

**Q1: Is the frontend even loading?**
- Page renders, just wrong → frontend bug → see Part 2
- White screen, "We hit a snag," 500 error → frontend deploy
  broken OR a critical dep dead → see Part 2
- Page never loads, browser spins → DNS or hosting down → see
  Part 3

**Q2: Are users authenticated?**
- Sign-in fails → auth provider down → see Part 5
- Already-signed-in users still work → auth fine

**Q3: Are paid transactions completing?**
- Stripe charges failing → see Part 6
- Stripe charges OK but downstream broken → DB/edge fn issue →
  see Part 4

**Q4: Are emails / SMS going out?**
- No → email/SMS provider down → see Part 7

This pinpoints the layer. Don't fix anything yet — first know
where.

### 1.3 Check the obvious dashboards (2 minutes)

Open these in tabs:
- **Your hosting provider** (AWS Amplify / Vercel / Netlify)
  → most recent deploy
- **Supabase Dashboard** → Reports → Errors
- **Stripe Dashboard** → Failed payments / Recent errors
- **status.stripe.com** + **status.supabase.com** + your hosting
  provider's status page

If a status page shows an incident: it's not you. Wait it out (or
implement a workaround per Part 8). Add a banner on your site
(see Part 9 communication).

If no status incident: it's you. Continue to relevant part.

---

## Part 2 — Frontend is broken

### 2.1 Was the last deploy < 30 minutes ago?

If yes: it's almost certainly the deploy.

**ROLLBACK FIRST, INVESTIGATE LATER.**

In AWS Amplify:
1. Console → App → "Hosting" → "Deployments"
2. Find the previous successful deploy
3. Click "..." → "Redeploy this version"
4. Wait 2-3 minutes for rollback to complete
5. Verify site works
6. THEN investigate what broke

The reflex MUST be: rollback first, debug second. Don't sit
debugging while customers see errors. Restore the working state,
then take your time fixing.

### 2.2 Was the last deploy days ago?

It's probably a dependency issue (CDN-hosted asset broke, third-
party API down, etc.). Check your browser dev tools console for
clues:
- "Failed to load resource" → CDN issue
- "CORS error" → API config issue
- "NetworkError" → server-side issue (probably Supabase/edge fn)

### 2.3 White screen with no error

Usually a critical render-time JS error. Check console. If your
error reporter is set up (Sentry), check there.

Quick mitigation: add a "scheduled maintenance" page (see Part 9)
while you investigate.

---

## Part 3 — Site won't load at all (hosting/DNS)

### 3.1 DNS check

```bash
dig yourdomain.com
nslookup yourdomain.com
```

If DNS returns wrong / no IP: DNS issue. Check:
- Your DNS provider's dashboard
- Whether you recently changed records
- DNS propagation can take 24-48 hours globally

### 3.2 Hosting provider status

- AWS Amplify Console → App → "Hosting" → check whether the build
  is "Deployed" / running
- Vercel Dashboard → check the deployment for the prod URL
- Netlify Dashboard → check Sites → your site → Production deploys

If hosting shows the app as deployed but it doesn't load: it's a
config issue. Check:
- Custom domain settings still point at your build
- SSL cert hasn't expired (most hosts auto-renew but verify)

### 3.3 If everything looks fine but it doesn't load

Try from a different network (your phone on cellular vs WiFi).
If it works on cellular but not WiFi: ISP/local DNS issue. Not
your problem.

If it doesn't work on either: customers can't reach you either.
Escalate to hosting provider support.

---

## Part 4 — Database / edge functions broken

### 4.1 Supabase Dashboard → Reports

This is your first stop. Recent errors are listed by error type
and count. Look for:
- Sudden spike in 5xx errors
- Specific edge function with high error rate
- Specific table with constraint errors

### 4.2 Check the function logs

Dashboard → Edge Functions → [function name] → Logs. Scroll to
the recent ones. Look for stack traces.

Common patterns:
- `TypeError: x is undefined` → code bug (probably from last
  deploy)
- `Permission denied` → RLS or grant issue, possibly from a
  recent migration
- `Connection timeout` → DB overloaded or function slow

### 4.3 Check the database

Dashboard → Database → Reports → look for high CPU, lock waits,
slow queries.

If the DB is overloaded:
- Recent migration may have added bad indexes or removed good
  ones
- A new feature may be running an N+1 query
- A backup or vacuum is running

### 4.4 The "is it just one function" check

If ONE function is failing, isolate it. Test directly via curl
with a known-good payload. If it fails: redeploy. If it succeeds:
it's a client-side issue.

### 4.5 Mitigations while you fix

- **Disable the broken feature client-side** via feature flag (if
  you have one) so users don't keep hitting the broken endpoint
- **Manual fix the data** via Supabase Dashboard SQL editor if
  customer data is corrupted (CAREFUL — work on one row at a time)
- **Increase the rate limit / quota** if you're hitting Supabase's
  limits

---

## Part 5 — Auth broken (users can't sign in)

### 5.1 Check Supabase Authentication status

Dashboard → Authentication → Users → recent signups working? Look
for clues in:
- Authentication → Reports → Errors

### 5.2 OAuth provider down

If sign-in-with-Google / Apple is failing:
- Check the provider's status page (Google Cloud Status, Apple
  System Status)
- Test sign-in via email/password as a fallback (if you support it)
- Surface "Try email sign-in instead" on the sign-in screen

### 5.3 Redirect URL mismatch

If users see "Redirect URL not allowed" after sign-in:
- Check Supabase Authentication → URL Configuration → Redirect
  URLs allowlist. Recent domain changes? Staging URL accidentally
  added/removed?
- Check Google Cloud Console (or Apple Developer) → OAuth Client
  ID → Authorized redirect URIs. Match?

### 5.4 JWT signing key rotated unexpectedly

If ALL signed-in users get logged out: someone rotated the JWT
signing key. They'll have to sign in again. Communicate.

### 5.5 Phone OTP / SMS not arriving

Twilio / MessageBird / WhatsApp Business issue. Check their
status pages. Implement email-based magic link as fallback while
they recover.

---

## Part 6 — Payments broken (Stripe issues)

### 6.1 Check Stripe Dashboard first

Dashboard → Payments → Failed. Are recent payments failing? What
error code (card_declined, processing_error, etc.)?

If failures are spread across many cards: Stripe-side issue or
your config.
If a specific user can't pay: their card or their bank.

### 6.2 Check status.stripe.com

Stripe outages are rare but real. If they're having issues, all
you can do is communicate to customers. Don't try to manually
charge cards while Stripe is down.

### 6.3 Webhook events not firing

If your DB isn't updating after successful charges:
- Stripe Dashboard → Webhooks → recent deliveries → check status
- If 401 / 403: signing secret mismatch
- If 5xx: your handler errored. Check Supabase function logs.
- If 2xx but DB still wrong: handler is silently swallowing errors.
  Check logs.

### 6.4 Connect merchants can't accept charges

Check the merchant's `charges_enabled` status:
- Dashboard → Connect → Accounts → find the merchant
- If `Charges enabled: No`: they have a KYC issue or compliance
  hold. Surface in your dashboard so they know.

### 6.5 Customer says they were charged but you have no record

This is the worst kind of incident. Trace:
1. Search Stripe Dashboard by amount + approximate time
2. If you find the charge: webhook didn't fire OR your handler
   errored. Manually fulfill (insert the DB record); look at
   webhook logs to fix the underlying issue.
3. If you DON'T find the charge: customer is wrong (it's pending,
   or different merchant). Send screenshot from their statement,
   confirm it's actually you.

### 6.6 Mass refund needed

If you have to refund many customers (e.g. broken feature charged
for nothing):

- Don't try to use the Stripe Dashboard one-by-one — too slow
- Use the Stripe API via a script
- Use idempotency keys per refund to prevent double-refunds
- Communicate proactively (Part 9)

---

## Part 7 — Email / SMS not delivering

### 7.1 Check the provider

- Resend Dashboard → recent sends → bounces / errors
- Twilio Console → recent SMS → failure reasons

### 7.2 Common failures

- **Sender domain not verified** → emails bounce. Verify
  cenaiva.com (or wherever) in Resend.
- **SPF/DKIM/DMARC misconfigured** → emails go to spam. Check
  with `mxtoolbox.com`.
- **Twilio number unverified for international destinations** →
  SMS bounces.
- **WhatsApp template not approved** → first message to a user
  fails. Need pre-approved template.

### 7.3 Fallback

If email is down but SMS works, use SMS. If both are down, surface
in-app banner saying "we're having issues sending notifications;
your reservation is confirmed regardless."

---

## Part 8 — Common incident playbooks

### 8.1 "Deploy broke prod" (most common)

**Severity:** HIGH — customers hit broken site
**Time to fix:** < 5 minutes

1. Open hosting provider
2. Rollback to previous deploy
3. Verify site works
4. Investigate what broke locally
5. Fix and redeploy when ready
6. Write a post-mortem (Part 10)

### 8.2 "Stripe payments declining at high rate"

**Severity:** HIGH — revenue impact
**Time to fix:** depends on cause

1. Check Stripe Dashboard → Payments → most common decline reason
2. If `do_not_honor` or similar bank-side: not you, customer's bank
3. If `incorrect_cvc` spike: your form might be broken (test it)
4. If `requires_action` not handled: SCA challenge missing in code
5. If across all cards: Stripe-side, check status.stripe.com

### 8.3 "Database is slow / queries timing out"

**Severity:** MEDIUM-HIGH — UX degraded
**Time to fix:** 5-60 minutes

1. Supabase Dashboard → Database → Reports → look for blockers
2. Recent migration that removed an index? Add back.
3. Recent new feature with N+1 query? Add a batched RPC.
4. Just high traffic? Upgrade plan or shed load.

### 8.4 "Customer says they can't sign in"

**Severity:** LOW (one customer) to HIGH (all customers)
**Time to fix:** 1-30 minutes

1. Ask them to send screenshot of error
2. Try to sign in with a test account yourself
3. If yours works: their account issue — check their email is
   verified, password reset link works
4. If yours fails: see Part 5

### 8.5 "Mysterious data appearing / disappearing"

**Severity:** HIGH — data integrity
**Time to fix:** investigate before acting

1. DON'T make any DB changes yet
2. Pull a current backup snapshot (Pro plan → PITR)
3. Check audit logs / `created_at`/`updated_at` timestamps to
   understand what changed when
4. Check if you ran a manual migration or someone with access did
5. If unexplained: serious — investigate, possibly rotate
   credentials

### 8.6 "Webhook events not landing"

**Severity:** MEDIUM-HIGH — eventual data divergence
**Time to fix:** depends

1. Stripe Dashboard → Webhooks → recent deliveries
2. If 5xx: your handler is failing. Check logs.
3. If 2xx but DB out of sync: handler has a bug
4. Stripe will retry for 3 days. You have time. Don't panic.
5. Once handler fixed, you can "resend" specific events via
   `stripe events resend evt_XXX`

### 8.7 "Cron jobs not running"

**Severity:** LOW-MEDIUM (depends on what the cron does)
**Time to fix:** 5-30 minutes

1. Supabase SQL: `SELECT * FROM cron.job_run_details ORDER BY
   start_time DESC LIMIT 20;`
2. Status `failed`? Check `return_message` for why
3. If 401: env var (CRON_SECRET or similar) doesn't match DB-stored
   value
4. If long-running timeouts: function is too slow, optimize or
   split

### 8.8 "Site is being attacked / spammed"

**Severity:** depends
**Time to fix:** 10-60 minutes

1. Identify the attack pattern: source IPs, target endpoint
2. Tighten rate limits on the targeted endpoint
3. If attack is via a feature that doesn't need to be public,
   add auth gate
4. AWS Amplify / Cloudflare → enable WAF / DDoS protection if
   sustained
5. Block specific IPs if needed
6. After incident, write up the vector and patch

---

## Part 9 — Customer communication

### 9.1 The three communication tiers

| Severity | Channel | Timing |
|---|---|---|
| Major outage (site down) | Status page banner + Twitter/X + email customers | Within 15 minutes of confirming |
| Single feature broken | In-app banner | Within 30 minutes |
| Affecting individuals | DM / email reply | Within 2 hours |

### 9.2 Template: site down

```
🔴 Service interruption — we're aware and working on it.

Some users may have trouble [booking reservations / paying / etc.]
right now. Our team is investigating and we'll post updates here.

Expected fix: [estimate, or "in the next 30 minutes"]
Last updated: [time]

We'll send a follow-up once everything's back to normal.
```

Update every 30 minutes minimum, even if it's just "still
investigating." Silence is worse than slow progress.

### 9.3 Template: payment issue

```
We're investigating a payment issue affecting some of today's
[bookings / orders]. If you've been charged but didn't receive
a confirmation, your money is safe — we'll either complete the
[booking] or issue a full refund within 24 hours.

If you need immediate help, reply to this email.
```

### 9.4 Template: post-incident all-clear

```
Resolved: today's [issue description] has been fixed.

What happened: [brief, non-technical summary]
Who was affected: [scope, e.g. "users who tried to book between
2pm and 3:15pm"]
What we did: [brief]
What we're doing to prevent: [optional, but builds trust]

Sorry for the disruption. If you were impacted in a way we
haven't addressed, reply to this email and we'll make it right.
```

### 9.5 Tone rules

- Plain English, no engineering jargon
- Honest about scope and timing
- Use "we" (we know it's just you, but "we" reads more
  professional)
- Apologize, don't blame third parties unless absolutely necessary
  ("we" went down, not "Stripe failed us")
- Offer make-whole gestures for paying customers (refund, credit,
  free month) when warranted

### 9.6 Don't lie about timing

If you don't know how long the fix will take, say "we're working
on it; we'll update by [time]." Don't promise "fixed in 10
minutes" if it might take an hour.

---

## Part 10 — Post-mortem template

After every incident lasting > 15 minutes, write this up. Even if
no one reads it but you. The act of writing forces you to
understand what happened and what to do differently.

### Post-mortem template

```
INCIDENT: [short title]
DATE: [yyyy-mm-dd]
DURATION: [start time → end time, in user-facing terms]
SEVERITY: [low / medium / high / critical]

WHAT HAPPENED (timeline):
- 14:32 — first customer email about issue
- 14:38 — confirmed in incognito tab
- 14:41 — identified failed deploy as cause
- 14:43 — rolled back to previous deploy
- 14:45 — verified site working again

ROOT CAUSE:
[The technical reason. Be specific. "deploy of commit abc123
included a typo in the database connection string."]

WHY IT WASN'T CAUGHT EARLIER:
[Honest answer. "no integration tests on the env var loading
path." Or "tested on localhost but env var differs in prod."]

WHAT WE DID:
[Step by step what fixed it.]

CUSTOMER IMPACT:
[How many users? How long? Did anyone lose money? Get a
charge they shouldn't have?]

WHAT WE'RE DOING TO PREVENT:
[Specific action items with dates.
- [ ] Add an integration test for env var loading (by 2026-05-25)
- [ ] Add a deploy preview that runs against staging Supabase
      (by 2026-06-01) ]

WHAT WORKED:
[The good. "Rollback was 2 minutes from confirming to verified."]

WHAT DIDN'T WORK:
[The bad. "Took 6 minutes to confirm the issue because I tested
in the wrong browser."]
```

Save in a `post-mortems/` folder. Read your own old ones quarterly
— you'll spot patterns.

---

## Part 11 — Contact list (TAILOR PER PROJECT)

When something's on fire, you don't want to be searching for phone
numbers. Fill this in before you launch and keep it updated.

### My project-specific contacts (FILL IN)

- **Supabase support email:** support@supabase.io
- **Supabase project URL:** https://supabase.com/dashboard/project/[YOUR-REF]
- **Stripe support phone:** [in dashboard → Settings → Support]
- **Stripe dashboard:** https://dashboard.stripe.com
- **AWS Amplify console:** https://console.aws.amazon.com/amplify
- **Domain registrar:** [Cloudflare / Namecheap / etc.]
- **Email provider (Resend) dashboard:** https://resend.com
- **SMS provider (Twilio) dashboard:** https://console.twilio.com
- **OpenAI/Anthropic dashboard:** [if using LLMs]
- **DNS dashboard:** [Cloudflare / Route 53 / etc.]
- **Your personal email:** [for outreach to customers]
- **Customer support inbox:** [where customer emails land]

### Status pages (bookmark these)

- https://status.supabase.com
- https://status.stripe.com
- https://health.aws.amazon.com/health/status (AWS overall)
- https://status.resend.com
- https://status.twilio.com
- https://www.cloudflarestatus.com (if using Cloudflare)
- https://status.googleapis.com (Google Maps, OAuth)
- https://www.apple.com/support/systemstatus/ (Apple Sign-in,
  Apple Pay)

### Hire-a-developer in an emergency

If you're stuck and need a real human:
- **Upwork** — search "Supabase emergency" / "Stripe debug" — can
  hire someone in 30 minutes for $50-100/hr
- **Discord/Slack security communities** — sometimes free help
  from generous strangers
- **Stripe support chat** — included with your account
- **Supabase support chat** — Pro plan and above

### Your "calm friend" who codes

If you have a developer friend who can be your "phone a friend" in
emergencies, list their name + best contact method here:
- [Name]
- [Phone/email]

Send them a thank-you bottle of wine occasionally so they pick up
when you call.

---

## Part 12 — Pre-emptive setup (do this before you ever have an
incident)

The best incident response is the one you never have. These
items reduce the chance:

### Monitoring + alerts
- [ ] Sentry (or similar) error reporter wired into frontend
- [ ] Email alert when an edge function 5xx rate spikes
- [ ] Dashboard alert when DB hits 80% capacity
- [ ] Stripe email when failed-payment rate spikes
- [ ] Status page (e.g. statuspage.io free tier) bookmarked

### Capacity to roll back
- [ ] AWS Amplify "Redeploy this version" tested at least once
      (do it in dev to confirm the flow)
- [ ] Supabase PITR restore tested at least once (to a separate
      project, takes 10 min)
- [ ] Feature flags for risky new code (so you can disable without
      redeploy)

### Documentation
- [ ] This file, filled in with project-specific contacts (Part 11)
- [ ] Customer support email setup with autoresponder ("we got
      your message, replying within 24h")
- [ ] Status page domain set up (status.yourdomain.com) so you
      have somewhere to post during incidents

### Backups
- [ ] Pro Supabase plan (daily backups)
- [ ] Off-Supabase backup once a week (export critical tables to
      S3 / Google Drive)
- [ ] Stripe data is on Stripe's servers — they have backups but
      it's still good to export CSVs monthly

---

## Part 13 — When NOT to act

Some incidents resolve themselves. Don't make it worse by acting
prematurely:

- **A status page incident on Stripe/Supabase/AWS** → they'll fix
  it. Don't redeploy. Don't change config. Just communicate to
  customers and wait.
- **A single customer complaining about something that works for
  everyone else** → investigate their specific case, don't
  generalize and make changes that affect everyone.
- **Slow response times during a known load spike** → you'll just
  cause secondary failures by deploying or scaling unnecessarily.
  Wait for the spike to pass; analyze after.

The rule: **always rollback if a recent deploy broke things;
otherwise PAUSE before changing anything.**

---

## Part 14 — Recovery, not blame

When you screw up (you will):
- Don't beat yourself up
- Don't beat anyone else up
- Treat the incident as data, not a verdict
- Write the post-mortem, ship the fix, move on

The companies you admire — Stripe, Vercel, Slack, all of them —
have had multi-hour outages. They handled it methodically and
moved on. So can you.

---

## Part 15 — The TL;DR card (print and keep nearby)

```
PROD IS BROKEN. WHAT NOW?

1. CONFIRM: incognito tab. Is it actually broken?
2. IDENTIFY: which layer? (frontend, DB, auth, payment, email)
3. CHECK STATUS PAGES: Supabase, Stripe, AWS, your DNS
4. IF RECENT DEPLOY: rollback FIRST, debug second
5. COMMUNICATE: in-app banner + status page within 15 min
6. FIX: one change at a time. Verify each.
7. UPDATE customers every 30 min while still broken
8. POST-MORTEM after, no matter how minor
```

That's it. Keep this file ready. Hope you never need it.

---

Last updated: 2026-05-21 by Mark Habbi, while still pre-launch
and praying he never has to use this file. Future-Mark: if you're
reading this in the middle of an outage — breathe. You've got
this.
