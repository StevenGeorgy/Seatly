# HABBI_SANDBOX_TO_PROD.md

How to make changes without breaking production. Read this every time you ship something.

---

## The two environments

| | Prod | Sandbox |
|---|---|---|
| Supabase ref | `exbjodmnpdiayfzrdyux` | `tqiodardwabqltnzpxvh` |
| URL | `https://exbjodmnpdiayfzrdyux.supabase.co` | `https://tqiodardwabqltnzpxvh.supabase.co` |
| Anon key | `sb_publishable_i3_kEbKihLNgMfFsR6VN0Q_npEw-bNz` | `sb_publishable_OQK2ZmrqBxbylEMqTHF_SQ__-I47OAj` |
| Data | Real customer data (eventually) | Test data only |
| Purpose | Live site | Practice/testing |

Both share the same code, same migration files, same edge functions. Only the database differs.

---

## The 6-step ship workflow

```
1. Tell agent what to change
2. Agent builds it (code + migration if needed)
3. Agent applies to SANDBOX
4. You test on localhost pointed at sandbox
5. You approve: "ship it"
6. Agent applies to PROD → you `git push` → Amplify deploys frontend
```

## The 3 rules

- **Sandbox before prod.** No exceptions.
- **Backend before frontend.** Database/edge functions first, then frontend deploy.
- **Additive only.** Add new columns/tables/functions. Never rename or delete in one step (use two-phase).

## The Stripe rule

**Sandbox ALWAYS uses Stripe test keys (`sk_test_...` / `pk_test_...`). NEVER use live Stripe keys in sandbox.**

Why: sandbox is for testing — fake charges, fake refunds, no real money. If you accidentally put live Stripe keys in sandbox env vars, real cards get charged when you click test buttons.

How:
- Sandbox edge function secrets → `STRIPE_SECRET_KEY=sk_test_...`
- Sandbox `.env` (if you use it locally) → `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...`
- Sandbox Stripe webhook → separate webhook endpoint pointing at sandbox URL, with its own `whsec_...`

Prod uses LIVE keys (`sk_live_...` / `pk_live_...`) only when you're actually ready to charge real customers. Until then, prod can also use test keys.

---

## How to switch localhost between prod and sandbox

Edit `/Users/savyoyaqoop/Seatly-12/.env`. Change these 5 lines:

**Point at PROD:**
```
VITE_SUPABASE_URL=https://exbjodmnpdiayfzrdyux.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_i3_kEbKihLNgMfFsR6VN0Q_npEw-bNz
NEXT_PUBLIC_SUPABASE_URL=https://exbjodmnpdiayfzrdyux.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_i3_kEbKihLNgMfFsR6VN0Q_npEw-bNz
SUPABASE_SERVICE_ROLE_KEY=<grab from prod dashboard → Settings → API → service_role>
```

**Point at SANDBOX:**
```
VITE_SUPABASE_URL=https://tqiodardwabqltnzpxvh.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_OQK2ZmrqBxbylEMqTHF_SQ__-I47OAj
NEXT_PUBLIC_SUPABASE_URL=https://tqiodardwabqltnzpxvh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_OQK2ZmrqBxbylEMqTHF_SQ__-I47OAj
SUPABASE_SERVICE_ROLE_KEY=<grab from sandbox dashboard → Settings → API → service_role>
```

After swapping: **stop `npm run dev` (Ctrl+C) → restart it**. Otherwise the change doesn't take effect.

**About the service role key:**
- It's the "admin" key. Bypasses all security. **Never share it. Never put it in client code.**
- For normal localhost web dev, this key is NOT actually used (only the anon key is). You can technically leave it pointing at the wrong project for normal dev.
- BUT: if you ever run a script that uses it (admin tasks, data fixes, etc.), the wrong key writes to the wrong database. So swap it for safety.
- Where to find it: Supabase dashboard → your project → Settings → API → "service_role" row → Reveal.

**Easy way to save both:** keep two files on your laptop:
- `.env.prod-backup` — full prod config
- `.env.sandbox-backup` — full sandbox config

Copy whichever one you want into `.env`. Foolproof and avoids typos.

---

## How to switch the CLI between prod and sandbox

The CLI uses one file to remember which Supabase project to target:
`/Users/savyoyaqoop/Seatly-12/supabase/.temp/project-ref`

**Check current link:**
```bash
cat /Users/savyoyaqoop/Seatly-12/supabase/.temp/project-ref
```

**Switch to PROD:**
```bash
echo "exbjodmnpdiayfzrdyux" > /Users/savyoyaqoop/Seatly-12/supabase/.temp/project-ref
```

**Switch to SANDBOX:**
```bash
echo "tqiodardwabqltnzpxvh" > /Users/savyoyaqoop/Seatly-12/supabase/.temp/project-ref
```

**Default: keep CLI on PROD.** Only switch to sandbox when you're about to push migrations to sandbox manually. Most of the time, the agent handles this via MCP — you don't need to touch the CLI.

**Always run `cat` first before any `supabase` command** in your terminal to confirm which project is linked.

---

## How the agent picks a database (MCP)

**You have to tell the agent which database to use.** The agent does NOT read your `.env` file or the CLI link. Each agent action specifies the project explicitly.

Always say "sandbox" or "prod" when asking the agent to do something on a database:

- ✅ "Apply this migration to sandbox."
- ✅ "Ship it to prod."
- ✅ "Add this restaurant to sandbox so I can test."
- ❌ "Add this restaurant." → agent has to ask which database

**Agent defaults when you're vague:**
- For reading data: agent will ask which DB if it matters
- For writing data: agent defaults to SANDBOX (safer)
- For destructive operations on prod: agent ALWAYS confirms with you first

The `.env` file controls your browser (localhost). The CLI link controls your terminal. The agent's MCP is independent of both — you tell the agent per-task.

---

## Workflow examples

### Tiny change (button color, copy fix)

1. Tell agent: "make X look like Y"
2. Agent edits the file
3. See it on localhost immediately
4. `git push` when ready (Amplify auto-deploys later)

No database. No sandbox needed.

### Medium change (new field on restaurants)

1. Tell agent: "add a 'year established' field"
2. Agent writes migration + frontend code
3. Agent applies migration to sandbox
4. You: switch `.env` to sandbox, restart `npm run dev`, test on localhost
5. You: "ship it"
6. Agent applies migration to prod
7. You: `git push` → Amplify deploys

### Breaking change (rename a column)

Don't do in one step. Two phases:

**Phase 1:**
- Add the NEW column. Backfill data. Frontend writes to BOTH.
- Ship to prod.

**Phase 2 (weeks later, after confirming nothing reads the old column):**
- Drop the OLD column.
- Ship to prod.

---

## Removing or replacing a feature

**No real customers yet:** just do it. Add new, remove old, ship.

**Real customers using the old feature:** two phases, never one.

**Phase 1 — ship new alongside old:**
- Build new feature
- Keep old code/columns/buttons working
- Ship to prod
- Both run simultaneously

**Phase 2 — remove old (days/weeks later):**
- Confirm nothing uses the old feature
- Delete old code, drop old columns
- Ship to prod

If you remove the old feature in the same deploy as adding the new, anyone mid-use of the old one hits an error.

**Risk by what you're removing:**

| Removing | Risk |
|---|---|
| Frontend button/page | Low |
| Edge function | Medium |
| Database column | High |
| Database table | Very high |

Agent flags this when it comes up.

---

## Feature branches (for work-in-progress)

Amplify only deploys `main`. Other branches don't go live. Use branches for unfinished work or to share with a collaborator.

**Start a branch:**
```bash
git checkout -b feature/whatever-name

# work, edit files normally

git add .
git commit -m "what you did"
git push -u origin feature/whatever-name
```

Now on GitHub. cenaiva.com unaffected.

**Friend/agent continues your work:**
```bash
git fetch
git checkout feature/whatever-name
git pull
```

They commit + push to the same branch.

**Branch naming:** lowercase, hyphens, descriptive. `feature/spice-level`, `fix/checkout-bug`, `wip/maps-redesign`.

**Collaborator access:** GitHub → repo → Settings → Collaborators → add their GitHub username.

**Only one person pushes at a time** to avoid merge conflicts. Coordinate.

**When done + tested, tell agent: "ship `feature/whatever-name`."** Agent:
1. Applies backend changes to prod
2. Merges branch into `main` + pushes → Amplify deploys frontend

You don't merge manually. Agent handles both halves, backend first.

**Default rule:** WIP goes on a branch. Only `main` deploys.

---

## Before starting work each day

If your friend pushed changes while you were away, you'd start from old code. Always pull latest first.

```bash
git checkout main
git pull
# then start your branch:
git checkout -b feature/whatever
```

If `git pull` shows new packages installed (or you get errors after pulling), run:
```bash
npm install
```

This installs any new dependencies someone else added.

---

## Watching the Amplify deploy

After you `git push` to `main`, check the build:

1. Open https://console.aws.amazon.com/amplify
2. Click your app
3. "Hosting" → "Deployments"
4. Most recent push at the top — green = live, red = build failed

If red: the live site stays on the LAST WORKING version. Fix the issue, push again.

---

## Rolling back a bad deploy

**Frontend (Amplify):**
1. Amplify console → app → Hosting → Deployments
2. Find the last working deploy
3. Click "..." → "Redeploy this version"
4. Live in ~2 minutes

**Code (git):**
```bash
git revert <commit-hash>
git push
```
Creates a new commit that undoes the bad one. Amplify auto-deploys.

**Database (Supabase):**
Tell the agent: "rollback prod to before [time]." Agent uses Point-in-Time Recovery to restore prod. Available for the last 7 days.

For detailed incident response, see `HABBI_INCIDENT_RESPONSE.md`.

---

## Cron jobs (background tasks)

Prod has 14 scheduled background tasks running automatically:
- Billing $1 booking fees hourly
- Expiring abandoned reservation holds
- Sending trial-ending emails 7 days before
- Cleaning up stale onboarding cards after 90 days
- Purging soft-deleted restaurants after 30-day grace
- And more

They run regardless of UI activity. You don't have to trigger them.

**When you add a new cron job:** treat it like any other backend change — sandbox first, then prod.

**To check what's scheduled:** ask the agent "what cron jobs are running on prod?" It'll list them.

---

## Does this apply to the mobile app?

**Yes — same backend, same flow.** Mobile app reads from the same Supabase project as web. When the agent applies a migration to prod, mobile users see it too.

**Mobile-specific notes:**
- Mobile has its own env config (`.env` or platform-specific config file) that points at the same Supabase URLs. Same prod/sandbox switching pattern applies on the mobile side.
- Mobile deploys via the app stores (App Store / Play Store), not Amplify. Different timeline — store review takes 1-7 days.
- Because mobile updates lag (users have to update the app), additive migrations matter even more. Old mobile clients on user phones will be calling the backend for weeks after a new version ships.
- For changes that affect mobile, the agent should be told: "this affects mobile too" so the migration is designed to be backward-compatible for old app versions.

---

## When you have real customers using prod

Until you have real customers, you can ship freely with minimal worry. Once you do:

- **Additive migrations are safe at any time** — customers don't notice.
- **Edge function deploys are zero-downtime** — Supabase swaps versions atomically.
- **Schedule risky changes for low traffic** (2-4am local time).
- **Watch the site for 10 minutes after every prod deploy.**

---

## Safety nets

- **Supabase Pro plan = 7-day point-in-time recovery.** If something goes catastrophically wrong on prod, the agent can restore it to any moment in the last 7 days.
- **Daily backups** on top of PITR.
- **Sandbox stays untouched** when you fix prod — sandbox is your forever safe testing ground.

---

## What the agent does vs what you do

| Action | Who |
|---|---|
| Decide what to change | You |
| Write code + migrations | Agent |
| Apply migration to sandbox | Agent |
| Switch `.env` to sandbox + restart dev | You |
| Test on localhost | You |
| Say "ship it" or "needs work" | You |
| Apply migration to prod | Agent |
| `git push` to trigger Amplify | You |
| Watch site for errors after deploy | You |

---

## Red flags that should stop you

If the agent says ANY of these, pause and read carefully:

- "This will lock the table for X seconds"
- "This is a breaking change"
- "We can't undo this easily"
- "This affects existing rows in prod"

Ask: "Why? What's the risk?" before approving.

---

## Quick reference

**Switch .env to sandbox:** Edit 5 lines in `.env` (URL, anon key — both VITE_ and NEXT_PUBLIC_ — plus SERVICE_ROLE_KEY), restart `npm run dev`. Service role key found at: Supabase dashboard → project → Settings → API → service_role → Reveal.

**Switch CLI to prod:**
```bash
echo "exbjodmnpdiayfzrdyux" > supabase/.temp/project-ref
```

**Switch CLI to sandbox:**
```bash
echo "tqiodardwabqltnzpxvh" > supabase/.temp/project-ref
```

**Check CLI link:**
```bash
cat supabase/.temp/project-ref
```

**Six steps to ship:** Tell agent → agent builds → sandbox test → approve → backend prod → `git push`.

**Three rules:** Sandbox always. Backend first. Additive only.

**Telling the agent which DB:** Always say "sandbox" or "prod" with every database task. The agent doesn't read your `.env` or CLI link — it relies on you saying which one. If vague, agent defaults to sandbox.
