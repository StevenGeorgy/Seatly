# Sandbox → Prod Schema Sync — Handoff

**Status:** PAUSED (May 23, 2026 — user doing software update)
**Goal:** Make Cenaiva's sandbox Supabase project (`tqiodardwabqltnzpxvh`) a true mirror of prod (`exbjodmnpdiayfzrdyux`) so tests run on sandbox behave identically to prod.

---

## Context (why we started this)

Sandbox and prod diverged months ago. Sandbox has its own migration history (113 migrations, starting 2025-03-17) while prod has its own (99 migrations, starting 2026-05-02). The user wants sandbox to be a clean mirror so they can:

1. Run new migrations on sandbox first before prod
2. Test edge function code paths against a non-production DB
3. Stop accidentally testing against live data + real Stripe

---

## What's DONE (don't redo)

### Database (sandbox)
- ✅ All 5 of today's migrations applied (`partner_agreement_consent`, `diner_consent_log`, `sign_in_events_purge_cron`, `dispute_notification_types`, `restaurant_postal_code_and_hst`)
- ✅ 3 missing tables created via MCP `apply_migration`:
  - `data_correction_requests`
  - `refund_requests`
  - `user_restaurant_comm_prefs`
- ✅ Missing columns added:
  - `restaurants.postal_code`
  - `restaurants.hst_registration_number`
  - `user_profiles.sms_opt_out`
  - `user_profiles.tos_accepted_at`
  - `user_profiles.tos_version`
  - `user_profiles.age_consent_at`
  - `auth_sign_in_events.acked_at`
- ✅ 2 storage buckets created: `user-data-exports`, `visit-photos`
- ✅ 6 SQL purge cron jobs scheduled in sandbox (audit_log, auth_attempts, auth_sign_in_events, crash_logs, security_alert_queue, stripe_webhook_events)

### Edge Functions (sandbox)
- ✅ All 93 edge functions deployed to sandbox in 3 batches via `supabase functions deploy ... --project-ref tqiodardwabqltnzpxvh --import-map supabase/functions/deno.json --no-verify-jwt`
- Verified: `supabase functions list --project-ref tqiodardwabqltnzpxvh | grep ACTIVE | wc -l` = 93

### Safety
- ✅ Removed dangerous LIVE Stripe keys from sandbox secrets via `supabase secrets unset STRIPE_SECRET_KEY STRIPE_SUBSCRIPTION_PRICE_ID STRIPE_WEBHOOK_SECRET --project-ref tqiodardwabqltnzpxvh`. Sandbox can no longer fire live Stripe calls.
- Sandbox still has `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (browser-safe) + OpenAI/Deepgram/ElevenLabs/Google Maps/CRON_SECRET keys.

---

## What's PENDING (resume here)

Last measured gap between sandbox and prod (from `pg_*` catalog queries):

| Metric | Prod | Sandbox | Gap |
|---|---|---|---|
| Tables | 83 | 83 | ✅ Match |
| Storage buckets | 8 | 8 | ✅ Match |
| Columns | 1,131 | 1,075 | ❌ 56 missing |
| Cron jobs | 29 | 21 | ❌ 8 missing (edge-fn callers) |
| Postgres functions/RPCs | 332 | 302 | ❌ 30 missing |
| RLS policies | 234 | 88 | ❌ 146 missing 🚨 |
| Constraints | 395 | 261 | ❌ 134 missing |
| Indexes | 370 | 212 | ❌ 158 missing |

### What this means

- **Tests on sandbox today** are reliable for booking + reservation flows (the tables exist).
- **Permission/security tests** are UNRELIABLE — sandbox has 146 fewer RLS policies, so a query blocked in prod might succeed in sandbox.
- **Some PERFORMANCE characteristics differ** — sandbox is missing 158 indexes.
- **Some DATA INTEGRITY rules differ** — sandbox is missing 134 constraints, could accept data that prod would reject.
- **Some RPCs may behave differently** — 30 missing functions.

---

## Why we got stuck

`supabase db dump` (the proper way) requires **Docker Desktop running** (CLI spawns a pg_dump container). Docker wasn't running. Two alternate paths exist:

1. **Start Docker Desktop** → CLI works → 10 min total to finish sync
2. **Provide DB connection strings** → use `pg_dump` directly (libpq already installed) → 10 min
3. **MCP-only incremental sync** → 45-60 min, all via Supabase MCP `execute_sql` + `apply_migration`

We were starting Path 3 when interrupted.

---

## Resume playbook

### Option A — Docker path (cleanest, recommended)

1. Open Docker Desktop on Mac (Applications → Docker)
2. Wait for whale icon to stop animating
3. Verify CLI link is good:
   ```bash
   cat supabase/.temp/project-ref
   # Should print: exbjodmnpdiayfzrdyux
   ```
4. Dump prod schema (Sentry DSN env var in `.env` is malformed; unset before running):
   ```bash
   env -i HOME="$HOME" PATH="$PATH" SENTRY_DSN="" \
     supabase db dump --schema public --linked -f /tmp/prod-public-schema.sql
   ```
5. Look at the dump to confirm it's complete:
   ```bash
   wc -l /tmp/prod-public-schema.sql
   grep -c "CREATE TABLE" /tmp/prod-public-schema.sql
   ```
6. Apply to sandbox via MCP `execute_sql` in chunks (the dump is too big for a single call). Or set up sandbox DB URL and use `psql -f /tmp/prod-public-schema.sql --db-url ...`.
7. Re-seed sandbox restaurants (a1000001-a1000008 seed data).
8. Verify by re-running the gap-measurement query (see "Verification queries" below).

### Option B — DB URL path

1. Open https://supabase.com/dashboard/project/exbjodmnpdiayfzrdyux/settings/database → copy URI (with password)
2. Same for https://supabase.com/dashboard/project/tqiodardwabqltnzpxvh/settings/database
3. Save to `~/.cenaiva/clone-creds.env`:
   ```
   export PROD_DB_URL="postgresql://postgres.exbjodmnpdiayfzrdyux:PASSWORD@aws-0-...:5432/postgres"
   export SANDBOX_DB_URL="postgresql://postgres.tqiodardwabqltnzpxvh:PASSWORD@aws-0-...:5432/postgres"
   ```
4. Chmod 600 the file
5. Tell Claude "ready", and have it run:
   ```bash
   source ~/.cenaiva/clone-creds.env
   /opt/homebrew/opt/libpq/bin/pg_dump "$PROD_DB_URL" --schema-only --schema=public -f /tmp/prod-public-schema.sql
   /opt/homebrew/opt/libpq/bin/psql "$SANDBOX_DB_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role; GRANT CREATE ON SCHEMA public TO postgres, service_role;"
   /opt/homebrew/opt/libpq/bin/psql "$SANDBOX_DB_URL" -f /tmp/prod-public-schema.sql
   ```
6. Re-seed restaurants + verify.

### Option C — MCP-only incremental (slow path)

Resume by running each category as a single `execute_sql` against prod to extract DDL, then apply to sandbox. The order matters (some depend on others).

**Phase 1: Indexes (287 total, ~158 missing)**

```sql
-- Query prod to get DDL, applied to sandbox via execute_sql with IF NOT EXISTS:
SELECT
  string_agg(
    CASE
      WHEN indexdef LIKE 'CREATE UNIQUE INDEX %' THEN
        regexp_replace(indexdef, '^CREATE UNIQUE INDEX ', 'CREATE UNIQUE INDEX IF NOT EXISTS ')
      ELSE
        regexp_replace(indexdef, '^CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ')
    END || ';',
    E'\n'
  ) AS ddl
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname NOT LIKE '%_pkey';
```

Take the `ddl` output → send to sandbox via `mcp__plugin_supabase_supabase__execute_sql` (project_id=tqiodardwabqltnzpxvh, query=<that DDL>).

**Phase 2: Constraints (134 missing)**

```sql
SELECT
  string_agg(
    'ALTER TABLE ' || quote_ident(n.nspname) || '.' || quote_ident(t.relname)
    || ' ADD CONSTRAINT ' || quote_ident(c.conname)
    || ' ' || pg_get_constraintdef(c.oid) || ';',
    E'\n'
  ) AS ddl
FROM pg_constraint c
JOIN pg_class t ON c.conrelid = t.oid
JOIN pg_namespace n ON t.relnamespace = n.oid
WHERE n.nspname = 'public'
  AND c.contype IN ('c', 'f', 'u');  -- check, foreign, unique
```

Apply with caveat: ALTER TABLE doesn't support IF NOT EXISTS for constraints. Wrap in DO block that catches "already exists" errors.

**Phase 3: Columns (56 missing)**

```sql
-- For each prod column not in sandbox, generate ALTER TABLE ADD COLUMN IF NOT EXISTS
-- This requires cross-database comparison — use 2 queries + manual diff.
SELECT
  table_name, column_name, data_type,
  is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public';
```
Run against both projects, diff in memory, generate ADD COLUMN statements.

**Phase 4: Functions/RPCs (30 missing)**

```sql
SELECT
  string_agg(pg_get_functiondef(p.oid) || ';', E'\n\n') AS ddl
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public';
```
Use `CREATE OR REPLACE FUNCTION` so it's idempotent.

**Phase 5: RLS Policies (146 missing)**

```sql
SELECT
  string_agg(
    'DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON '
    || quote_ident(schemaname) || '.' || quote_ident(tablename) || '; '
    || 'CREATE POLICY ' || quote_ident(policyname) || ' ON '
    || quote_ident(schemaname) || '.' || quote_ident(tablename)
    || ' AS ' || permissive
    || ' FOR ' || cmd
    || (CASE WHEN roles IS NOT NULL THEN ' TO ' || array_to_string(roles, ', ') ELSE '' END)
    || (CASE WHEN qual IS NOT NULL THEN ' USING (' || qual || ')' ELSE '' END)
    || (CASE WHEN with_check IS NOT NULL THEN ' WITH CHECK (' || with_check || ')' ELSE '' END)
    || ';',
    E'\n'
  )
FROM pg_policies
WHERE schemaname = 'public';
```

---

## Verification queries

Run these against BOTH prod and sandbox after sync. Numbers should converge.

```sql
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') AS tables,
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public') AS columns,
  (SELECT count(*) FROM cron.job) AS crons,
  (SELECT count(*) FROM storage.buckets) AS buckets,
  (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace) AS functions,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS rls_policies,
  (SELECT count(*) FROM pg_constraint WHERE connamespace = 'public'::regnamespace) AS constraints,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public') AS indexes;
```

Last snapshot (May 23, 2026):
- **Prod:** tables=83, columns=1131, crons=29, buckets=8, functions=332, rls_policies=234, constraints=395, indexes=370
- **Sandbox:** tables=83, columns=1075, crons=21, buckets=8, functions=302, rls_policies=88, constraints=261, indexes=212

---

## After sync — re-seed sandbox

Sandbox should have the canonical 8 seed restaurants for testing (a1000001-a1000008). Get the SQL from prod:

```sql
-- Run against prod to extract seed restaurant rows
SELECT 'INSERT INTO restaurants (' || string_agg(column_name, ', ') || ') VALUES (' || string_agg('?', ', ') || ');'
FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'restaurants';
```

Or simpler: query prod for the 8 restaurants and INSERT into sandbox. (Schema sync must finish first so columns match.)

---

## After sync — set test-mode secrets in sandbox

Once schema is in sync, set Stripe TEST mode keys + Resend/Twilio:

```bash
# Get test keys from Stripe Dashboard → Test mode toggle → Developers → API keys
supabase secrets set \
  STRIPE_SECRET_KEY=sk_test_REPLACE_ME \
  STRIPE_SUBSCRIPTION_PRICE_ID=price_test_REPLACE_ME \
  STRIPE_WEBHOOK_SECRET=whsec_test_REPLACE_ME \
  --project-ref tqiodardwabqltnzpxvh

# Create test-mode webhook endpoint pointing at:
# https://tqiodardwabqltnzpxvh.supabase.co/functions/v1/stripe-webhook
# Subscribe to: subscription.*, payment_intent.*, invoice.*, charge.dispute.*
```

---

## Notes / gotchas

- **Sentry DSN bug:** `.env` has `SENTRY_DSN=d06cc26fccd404071807fc2a3ec88132` which is a hash, not a valid DSN URL. The Supabase CLI tries to parse it and crashes. Workaround: `env -i HOME="$HOME" PATH="$PATH" SENTRY_DSN="" supabase ...` before any CLI command.

- **Pooler URL doesn't have password:** `supabase/.temp/pooler-url` has the host but no password. CLI uses access token for OAuth pooler auth. pg_dump needs the actual password.

- **`supabase db dump` needs Docker by default**, but has a `--db-url <URL>` flag that uses libpq directly (no Docker needed). Just needs the password.

- **MCP `execute_sql` has size limits** but is fine for the DDL chunks we'd need (~50-200KB each).

- **The DB has user_data_exports storage bucket** (private, no size limit) for PIPEDA-mandated data exports. Already created in sandbox.

- **Edge function deploys** use the auto-mode classifier's auth scope. They're allowed because the user pre-authorized this work earlier.

- **CLAUDE.md hard rule:** sandbox must use Stripe TEST keys, never LIVE. Currently sandbox has NO Stripe keys (safest state). When resuming, MUST set test-mode keys before any Stripe-using flows are tested.

---

## TL;DR for next session

When you (the user) come back:

1. Open Docker Desktop (or grab DB URLs from Supabase Dashboard)
2. Tell Claude: "resume sandbox sync from `SANDBOX_SYNC_HANDOFF.md`"
3. Claude will read this file, pick up where we left off, and finish the remaining 5 phases
4. Final step: set Stripe TEST mode keys in sandbox

ETA from "Docker is open": ~15-20 min.
