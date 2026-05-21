# HABBI_DEV_TO_PROD.md — How I ship changes after Cenaiva launches

**Author:** Mark Habbi (me, for me)
**Date written:** 2026-05-21
**Why I wrote this:** I'm a non-technical founder who built Cenaiva
with AI help. After launch I need to keep shipping changes without
breaking the live site. This is the mental model and workflow I
worked out with Claude. Future me — read this when you forget how
this works.

---

## The big picture in one sentence

> **Work on localhost (with my DEV database). When something works,
> tell Claude to push it to production. Real customer data and test
> data NEVER touch each other.**

That's the whole thing. The rest of this doc is just the details
behind that sentence.

---

## What I need set up BEFORE I launch

This is a one-time setup. I tell Claude to do it for me.

1. **Two Supabase databases:**
   - **DEV** — my current Supabase project (the one with messy test
     data, project ref `exbjodmnpdiayfzrdyux`). Use this for testing.
   - **PROD** — a brand-new Supabase project I create before launch.
     Starts clean. Real customers go here.

2. **Two sets of API keys in AWS Amplify:**
   - Local `.env` on my computer points at DEV.
   - AWS Amplify's environment variables for `cenaiva.com` point at PROD.
   - These keys live in two different places. I don't have to switch
     them — they just sit there pointing at the right database.

3. **Stripe in both modes:**
   - Stripe test keys (`pk_test_...`, `sk_test_...`) in my local `.env`
     and DEV Supabase.
   - Stripe live keys (`pk_live_...`, `sk_live_...`) in AWS Amplify's
     environment variables for cenaiva.com.
   - One Stripe account, both modes available.

When ready to set this up: open Claude Code and say
**"Set up my production Supabase project. Copy the schema from my
current project. Give me the AWS Amplify env var values."**

Claude does the heavy lifting. I paste a few values into AWS and
click deploy.

---

## How I think about the two environments

Each environment is its own self-contained world. Think of them as
two different restaurants with the same menu but different customers.

| Thing | DEV (my localhost) | PROD (cenaiva.com) |
|---|---|---|
| Frontend code (UI) | Runs on `localhost:5174` | Hosted on AWS Amplify at cenaiva.com |
| Database | DEV Supabase project | PROD Supabase project |
| Stripe keys | TEST mode (fake cards) | LIVE mode (real money) |
| Who uses it? | Just me | Real restaurant owners + diners |
| Data inside | Test garbage, fake bookings | Real customers, real money |
| Safe to break? | Yes — break it daily | No — keep it boring & working |

**Data NEVER moves between them.** If I book a fake reservation on
localhost, it lives in DEV forever. If a real customer books at
cenaiva.com, it lives in PROD forever. The two databases never
share data.

---

## My daily workflow

This is my life after launch. It's the same loop every time.

### Step 1 — Develop on localhost

I make changes (or tell Claude to make them). I run the dev server
on my computer. My browser at `localhost:5174` shows the new version.
Anything I do here writes to my DEV Supabase. Real customers can't
see any of this.

### Step 2 — Test thoroughly

I click through the change. I try edge cases. I use Stripe test card
`4242 4242 4242 4242` to fake payments. I look for:

- Does the new feature actually work?
- Does it break anything that was working before?
- Any red errors in the browser console?
- Did the database update the way I expected?

If anything's off, I keep iterating on localhost. **No one outside
my computer sees this.**

### Step 3 — When it works, ask Claude to ship it

I open Claude Code and say:

> **"Deploy these changes to production. Apply migrations to PROD
> Supabase, redeploy any edge functions to PROD, and trigger AWS
> Amplify to deploy the frontend. Confirm each step."**

Claude does THREE things in order (this order matters):

1. **Database schema first** — if I added a new column or table,
   Claude applies that migration to PROD Supabase. The PROD database
   now has the same shape as DEV.
2. **Edge functions second** — Claude redeploys any backend
   functions that changed (like `create-public-booking`). These run
   on Supabase's servers.
3. **Frontend last** — Claude pushes the frontend code, AWS Amplify
   auto-deploys it to cenaiva.com.

Why this order: if frontend went first, real users would briefly hit
"function doesn't exist" or "column doesn't exist" errors. By
deploying database + edge functions first, by the time the new
frontend goes live, everything it needs already exists.

### Step 4 — Watch for 10 minutes

After deploy, I open cenaiva.com in an incognito tab. I click
around like a customer would. If I see anything broken, I tell
Claude **"Rollback the last deploy"** and Claude reverts AWS
Amplify to the previous version. Less than a minute of broken
state, not hours.

That's the whole loop. Develop → test → ship → watch.

---

## What actually gets deployed (the 3 things)

Don't have to memorize this — Claude handles the sequencing. But
it's good to understand.

| Layer | Lives where | Deployed how |
|---|---|---|
| Database structure (tables, columns, RLS rules) | PROD Supabase | "Migration" files in `supabase/migrations/` get applied |
| Backend logic (edge functions like `create-public-booking`) | PROD Supabase | `supabase functions deploy <name>` |
| Frontend (the React app: pages, buttons, UI) | AWS Amplify → cenaiva.com | Push to GitHub main branch, Amplify auto-deploys |

When I say "deploy to prod," all three happen. Claude knows.

---

## What stays put (data)

This is the part I always forget. **Data does NOT move between DEV
and PROD.**

- My test bookings on localhost → live in DEV forever.
- Real customer bookings at cenaiva.com → live in PROD forever.

The DEV database is my playground. It's full of messy test data,
89 cancelled reservations from when I was learning, fake restaurants
I made up, etc. None of that ever shows up on cenaiva.com.

The PROD database starts empty. Real customers fill it. None of
that ever shows up on my localhost.

**Only the structure (the SHAPE of the data) moves.** When I add a
new column on DEV, that same column gets added to PROD on the next
deploy. But the actual rows in each table stay where they are.

---

## What I say to Claude

I'm not technical. I don't run commands. I just talk to Claude in
plain English. Here are the magic phrases that work:

| When I want to... | I say to Claude... |
|---|---|
| Set up the dev/prod split (one-time, before launch) | "Set up my production Supabase project. Copy the schema from my current project. Give me the AWS Amplify env var values to paste in." |
| Add a new feature | "I want to add [feature]. Plan it out, then build it on localhost." |
| Test what I built | "Walk me through testing this. Use Playwright if needed." |
| Ship to production | "Deploy these changes to prod. Apply migrations, deploy edge functions, trigger Amplify. Confirm each step." |
| Something broke in production | "Rollback the last deploy on AWS Amplify and tell me what happened." |
| Monthly security check | "Look for security advisories on my dependencies and apply safe patches. Don't change major versions." |
| Run a security review | "Run a security review on the changes since [date] and tell me what's risky." |

These phrases work because Claude has access to the right tools
(Supabase MCP, Stripe MCP, Bash for `supabase functions deploy`, etc.).

---

## Safety rules I follow

These are rules I made for myself because I'm a solo non-technical
founder who can't afford a mistake to brick the site.

### Rule 1 — Never deploy Friday afternoon

Deploy Tuesday-Thursday between 10am and 3pm. If something breaks,
I want to be awake and Claude to be available to help.

### Rule 2 — Small changes only

Don't batch 5 features into one deploy. One feature at a time. If
something breaks, I know exactly what caused it.

### Rule 3 — Watch for 10 minutes after every deploy

Open cenaiva.com in incognito. Click around. Try to book a test
reservation. If anything's off, rollback before more people hit it.

### Rule 4 — Always test on localhost first

Even for "tiny" changes. Even for a typo fix. The two seconds it
takes to verify on localhost saves me an hour of explaining to
customers why the site was broken.

### Rule 5 — Trust the tools, not my memory

I don't try to remember which keys go where, which order to deploy
in, which edge functions need updating. Claude knows. I just say
"deploy to prod" and let the automation do its thing.

### Rule 6 — Monthly: ask Claude to patch security stuff

Once a month I open Claude and say "check for security patches on
my dependencies." Most months it's nothing. Sometimes there's a
Stripe SDK or Supabase SDK update that needs applying. Claude
applies the safe ones and asks me about the risky ones.

### Rule 7 — Don't touch the production database directly

I never log into the PROD Supabase dashboard and edit rows. If a
customer needs a refund, I do it through the dashboard UI I built.
If something's REALLY wrong and I have to fix it manually, I get
Claude involved so we have a record.

---

## Common mistakes I might make (and how to avoid them)

### Mistake 1: Testing on localhost while it's connected to PROD

**Why this is bad:** Real customers see whatever I do.

**How to avoid:** Always check what database my `.env` points at
BEFORE testing. The Supabase URL should be the DEV project, NOT the
PROD project. If I'm unsure, ask Claude **"Confirm my localhost is
pointing at DEV not PROD."**

### Mistake 2: Forgetting to deploy the database changes

**Why this is bad:** New frontend code calls a column that doesn't
exist on PROD → users see errors.

**How to avoid:** Always say "Deploy these changes" not just
"push the frontend." Claude knows to deploy everything in order.

### Mistake 3: Using live Stripe keys on localhost

**Why this is bad:** I'd accidentally charge real cards while testing.

**How to avoid:** My local `.env` should ONLY ever have
`pk_test_...` and `sk_test_...` keys. Live keys (`pk_live_...`)
ONLY go in AWS Amplify's environment variables. If Claude ever
suggests putting a live key in `.env`, push back.

### Mistake 4: Editing migration files after deploying them

**Why this is bad:** Migration files are like check-ins at a hotel —
once signed, you don't go back and edit. Editing a deployed
migration causes mismatches between DEV and PROD.

**How to avoid:** If I need to change something I already
deployed, I make a NEW migration file. Claude handles this — I
just need to not be tempted to "fix" an old migration.

### Mistake 5: Sharing my Supabase service role key

**Why this is bad:** It's the master key. Anyone with it can do
anything to my database, including delete everything.

**How to avoid:** Service role key NEVER leaves my .env or
AWS Amplify env vars. Never paste it in chat, screenshots, or
emails. If I think someone saw it, rotate immediately
(Supabase dashboard → Settings → API → reset).

---

## When to worry vs. when to relax

### Relax — these are routine

- I deployed a small change. Site looks slightly different. Cool.
- A restaurant edited their hours / menu / theme. That's just data
  in the database. Not a deploy.
- Dependabot opened a PR to bump some library version by a tiny bit.
  Click merge.
- I forgot to test something obvious before deploying. Rollback,
  test, redeploy. Five-minute fix.

### Worry — these are real concerns

- 🚨 Cenaiva.com is down or showing white screen for >5 minutes
  → Rollback NOW in AWS Amplify.
- 🚨 Real money is moving incorrectly (wrong amounts, charges to
  wrong cards) → Halt all bookings via a feature flag if available;
  call Stripe support; get Claude to investigate.
- 🚨 Customer data appears mixed up (one diner seeing another's info)
  → Investigate immediately, may need to take site offline.
- 🚨 A security advisory drops about a library I use (e.g., the
  next Log4j scenario) → Patch within hours, not days. Get Claude
  on it.
- 🚨 A real customer emails saying their card was charged but no
  reservation appears → Check Stripe dashboard + Supabase
  `reservation_deposit_payments` table. Likely the webhook didn't
  fire. Refund through Stripe dashboard manually.

For the rare crisis: I have Stripe's number, Supabase's support
email, and Claude on standby. That's enough for a solo founder.

---

## My setup checklist BEFORE I launch

Things I (or Claude) need to do once before flipping the switch:

- [ ] Spin up a NEW Supabase project as PROD (the current one
      becomes DEV)
- [ ] Copy the schema from DEV → PROD (migration files run)
- [ ] Deploy all edge functions to PROD
- [ ] Set AWS Amplify environment variables to point at PROD
- [ ] Set Stripe keys in AWS Amplify to LIVE mode
- [ ] Create a live Stripe Price for the $199.99 CAD subscription
- [ ] Set up the Stripe webhook on the live mode with the right URL
- [ ] Add cenaiva.com to Supabase auth redirect URLs allowlist
- [ ] Add cenaiva.com to Google Maps API key allowlist
- [ ] Add cenaiva.com to Google OAuth Client ID allowlist
- [ ] Verify cenaiva.com domain in Resend for emails
- [ ] Apple Pay domain verification (if I want Apple Pay)
- [ ] Onboard at least one real restaurant to live Stripe Connect KYC
- [ ] Smoke test: book a $5 deposit, modify it, cancel it, get refund
- [ ] Enable GitHub Dependabot on the repo for ongoing patches
- [ ] Bookmark this file

Claude can do most of these. I just have to click through a few
operator-only steps in Stripe / Supabase / AWS dashboards.

---

## What I do NOT need to do

Things I don't have to worry about because Claude / automation
handles them:

- Remember the order to deploy in
- Know which edge functions changed since last deploy
- Read migration files to understand what they do
- Compare two databases to see what's different
- Manually back up the database (Supabase does daily backups)
- Hand-write commit messages (Claude writes them)
- Roll my own deploy pipeline (AWS Amplify auto-deploys)
- Configure CDN, SSL, DNS (Amplify handles these)

---

## My monthly maintenance ritual

Once a month, I do this:

1. Open Claude Code, say **"Check for security advisories on my
   dependencies and apply safe patches. Don't touch major versions.
   Type-check after. Report what you did."**
2. Watch Claude do it. Approve when asked.
3. Deploy the patches to PROD (small change, low risk).
4. Done. Total time: ~30 minutes.

That's the entire ongoing security maintenance for a solo
non-technical founder. The rest is handled by Dependabot's
automatic PRs and GitHub Security Advisories' email alerts.

---

## My yearly check

Once a year, I do this:

1. Hire a freelance security engineer on Upwork for $200-500 to
   run a 1-week independent security review.
2. Have Claude run a comprehensive audit comparing the codebase
   to current best practices.
3. Update this file with anything I've learned.

For Cenaiva specifically: the major security batch ran on
2026-05-20/21 closing 14 vulnerabilities. Re-run that depth of
audit annually.

---

## Quick reference card (for when I forget)

**Where my work lives:**
- Code: GitHub repo + my laptop
- Database (DEV): Supabase project `exbjodmnpdiayfzrdyux`
- Database (PROD): the NEW one I create at launch
- Frontend hosting: AWS Amplify
- Payments: Stripe (test + live modes)
- Email: Resend (using cenaiva.com domain)
- SMS: Twilio
- AI: OpenAI + Anthropic + ElevenLabs + Deepgram

**Critical files in the repo:**
- `CLAUDE.md` — top-level rules + project state
- `WORK_LOG.md` — chronological decisions and gotchas
- `MOBILE_*.md` files — handoff docs for the mobile team
- `supabase/migrations/` — database schema history
- `supabase/functions/` — backend logic
- `apps/web/src/` — frontend code

**The 3 phrases that solve 90% of my problems:**
1. **"Claude, deploy these changes to production."**
2. **"Claude, rollback the last deploy."**
3. **"Claude, run a security check."**

---

## Final reminder for future me

You built this product without writing the code yourself, and that's
fine. You're not pretending to be an engineer. You're a founder who
uses AI as your technical co-founder. The point is to:

- Not be afraid to ship
- Not break things by being careless
- Have a clear loop you can trust

The dev → prod separation is the safety net. Use it religiously. If
you're ever about to deploy something you haven't tested on localhost,
stop. Test first. Always.

You've got this. Just follow the playbook.

— Mark, May 21, 2026
