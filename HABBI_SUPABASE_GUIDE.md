# HABBI_SUPABASE_GUIDE.md — Supabase setup + security (universal)

**Author:** Mark Habbi
**First written:** 2026-05-21
**Source:** every Supabase gotcha I hit building Cenaiva (Seatly)
plus the 14-vulnerability security audit on its database + edge
functions.
**Scope:** universal — drop into ANY project using Supabase.

**How to use:**
- Starting a new Supabase project? Follow Parts 1-8 during setup.
- Building features? Apply Part 9 (security patterns) to every
  schema or function change.
- Before going live? Run Part 10 (pre-launch checklist).
- Day-to-day? Part 11 (ongoing ops).

For Stripe-related rules, see `HABBI_STRIPE_GUIDE.md`. For
language-agnostic principles, see `HABBI_UNIVERSAL_SECURITY_RULES.md`.

---

## TL;DR — 10 things I wish I knew on day 1

1. **One Supabase project ≠ one environment.** You want at least
   two projects: dev + prod. Don't share data between them.
2. **Three keys per project:** anon (publishable), service_role
   (server-only, all-powerful), and the auto-rotating signing key
   for JWTs. Don't confuse them.
3. **RLS doesn't apply to service_role.** Service-role bypasses
   every policy. Treat service_role code as your "trust me, I'm
   verifying ownership" layer — don't assume RLS will save you.
4. **Trust-boundary columns need column-level GRANTs, not just
   RLS.** RLS says which rows; GRANT says which columns. Field
   like `is_published`, `subscription_status`, `is_admin` need
   explicit column allowlists for authenticated users.
5. **`verify_jwt = false` in `config.toml` is a FEATURE, not a
   bug.** When you serve ES256 tokens (which the gateway doesn't
   handle yet), keep `verify_jwt = false` AND verify in-function
   via `auth.getUser`.
6. **Never edit a deployed migration.** Make a new one. Migrations
   are append-only history.
7. **Cron jobs run as `postgres` superuser.** REVOKEs from `authenticated`
   don't affect them. So you can lock down a function from public
   while keeping crons working.
8. **Audit log FKs use `ON DELETE RESTRICT`, never CASCADE.**
   Customer audit history must outlive parent rows.
9. **Storage bucket URLs are public by default unless you scope
   policies.** Check this before launch.
10. **Backups happen automatically on Pro plan, daily.** On free
    tier, you have ~7 days of point-in-time recovery. Confirm
    your plan covers your tolerance.

---

## Part 1 — Project setup (one-time)

### 1.1 Create the account + project

`supabase.com` → Sign up (GitHub login works). New Project →
pick a region close to your users (e.g. `ca-central-1` for
Canadian users). Set a strong database password (you won't use
it for app code, but you might use it for direct DB access).
Wait ~2 minutes for provisioning.

You now have:
- A unique project ref (e.g. `exbjodmnpdiayfzrdyux`)
- A Supabase URL (`https://<ref>.supabase.co`)
- An anon key (`sb_publishable_...` or `eyJ...` depending on era)
- A service_role key (top secret, server-only)
- A JWT signing key (auto-managed by Supabase if using JWT Signing Keys)

### 1.2 Use the same region across services

If your hosting is in `us-east-1` and your Supabase is in
`ap-southeast-1`, every request crosses a continent. Put them in
the same region or close (e.g. AWS `ca-central-1` ↔ Supabase
`ca-central-1`).

### 1.3 Pick your environment strategy on day 1

The right move: **two Supabase projects from day 1** — one for
dev/staging, one for prod. Even if prod sits empty for months.

Why: trying to "split a single project into dev and prod later" is
painful. Your dev data leaks into prod's database, your initial
test users become production users, etc.

### 1.4 Pricing tiers

- **Free** — 500 MB DB, 1 GB file storage, 50k monthly active
  users, 7-day PITR. Good for dev.
- **Pro ($25/mo)** — 8 GB DB, 100 GB storage, 100k MAU, daily
  backups, 7-day PITR, no auto-pause. Recommended for prod.
- **Team ($599/mo)** — adds SSO, audit logs, dedicated support.
  Useful at scale.

For a launching SaaS: Pro for prod, free tier for dev.

---

## Part 2 — API keys + secrets management

### 2.1 The three keys

| Key | What it does | Where it goes |
|---|---|---|
| **anon (publishable)** | Public-safe; allows access subject to RLS | Client + server-side .env, can ship to mobile/web |
| **service_role** | Bypasses RLS; can do ANYTHING in your DB | Server-only .env / edge function secrets. NEVER in client. NEVER in screenshots. |
| **JWT signing key** | Used internally to sign user session tokens | Managed by Supabase. You don't paste it; `auth.getUser` validates against it. |

### 2.2 Naming convention

Use the same env var names across all environments, only the
VALUE differs:
```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=eyJ...      # server only, no VITE_ prefix
```

The `VITE_` / `NEXT_PUBLIC_` / `REACT_APP_` prefix means
"client-readable." NEVER apply that prefix to the service_role
key.

### 2.3 Service-role key safety

If service_role leaks, an attacker can:
- Read every row in every table
- Modify every row
- Delete every row
- Create accounts
- Run arbitrary SQL

It's a master key. Treat accordingly:
- NEVER commit to git (even a private repo)
- NEVER paste in chat or screenshots
- NEVER use in `VITE_*` / client-readable env vars
- ROTATE if you suspect leak (Dashboard → Settings → API → reset)

### 2.4 Edge function secrets

Supabase has a separate secrets store for edge functions:
```bash
supabase secrets set MY_SECRET=value --project-ref <ref>
supabase secrets list --project-ref <ref>
supabase secrets unset MY_SECRET --project-ref <ref>
```

Edge functions read these via `Deno.env.get("MY_SECRET")`. Use this
for:
- Third-party API keys (Stripe secret, Resend, Twilio, OpenAI, etc.)
- Webhook signing secrets
- Internal cron secrets
- Anything not safe to commit

These are NOT the same as your `.env` file on your dev machine.
Local dev reads `.env`; edge functions on Supabase read the secrets
store.

### 2.5 Rotation procedure for shared secrets

When rotating a secret that's used by both your code AND an
external service (e.g. `STRIPE_WEBHOOK_SECRET`):

1. Update the secret in Supabase (`supabase secrets set ...`)
2. Redeploy edge functions that use it (they reread on cold start
   but a redeploy forces it)
3. Update the external service's copy (Stripe dashboard, etc.)
4. Watch the next webhook event — should succeed

If the order is wrong, you get a brief window where webhooks fail.

---

## Part 3 — Database schema + migrations

### 3.1 Migrations are append-only

`supabase/migrations/` contains timestamped SQL files. Each
represents a change ("add column X," "create table Y"). They're
APPLIED IN ORDER.

**Critical rule: NEVER edit a deployed migration.** Once a migration
runs against any environment, treat it as immutable history. To
change something, make a NEW migration.

Why: if dev has `migration_001.sql` applied as version 1, and you
edit it to version 2, then prod runs it for the first time as
version 2 — you have inconsistent state across environments. Some
migrations even fail to re-apply this way.

### 3.2 Naming migrations

Use timestamps: `20260520000000_add_referral_code.sql`. Supabase's
migration tools sort by this prefix. Keep names descriptive but
short.

### 3.3 Applying migrations

```bash
# Dev environment
supabase db push --project-ref <dev-ref>

# Production (CAREFUL — this writes to live DB)
supabase db push --project-ref <prod-ref>
```

Or via the MCP tool (Claude can apply migrations to a project
directly through the Supabase MCP).

### 3.4 Backward compatibility

Migrations that drop columns or rename tables can break running
code. Two-step pattern:
1. **Migration 1**: add the new column / shape. Don't drop old.
   Deploy code that uses new shape (with fallback to old).
2. **Migration 2** (weeks later): drop the old column / shape after
   confirming nothing uses it.

For solo projects you can skip the gap, but understand the
discipline.

### 3.5 Migrations modify DB structure, NOT data

Migrations typically only change schema (CREATE TABLE, ALTER
TABLE, GRANT, REVOKE, CREATE INDEX, etc.). Data fills tables
through your app, not migrations.

Exception: seed data for new lookup tables can go in a migration,
but keep it minimal.

### 3.6 Rolling back

Supabase doesn't have built-in rollback (migrations are
forward-only). If you screwed up:
- Make a NEW migration that undoes the change
- OR restore from a PITR backup (Pro plan, last 7 days)

This is why testing in dev first matters.

### 3.7 Common schema patterns

| Pattern | Use case |
|---|---|
| `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Standard PK, unguessable |
| `created_at timestamptz DEFAULT NOW()` | Audit columns on every table |
| `updated_at timestamptz` + trigger | Auto-update on row modification |
| `deleted_at timestamptz NULL` | Soft-delete pattern |
| `CHECK (status IN ('a', 'b', 'c'))` | Enum-like constraint |
| `REFERENCES other(id) ON DELETE RESTRICT` | Default for audit/compliance |
| `REFERENCES other(id) ON DELETE CASCADE` | Only when child is meaningless without parent |

---

## Part 4 — Row Level Security (RLS) deep dive

### 4.1 What RLS is

A Postgres feature where you write policies like "users can SELECT
rows where `user_id = auth.uid()`." Postgres enforces this on every
query made with the requesting user's role.

In Supabase: when a client makes a query with their JWT, their
role is `authenticated` and `auth.uid()` returns their user_id.
Policies fire automatically.

### 4.2 service_role BYPASSES RLS

This is the #1 thing newbies miss. RLS only applies to:
- `anon` role (unauthenticated requests)
- `authenticated` role (signed-in users)

Service_role bypasses every policy. So:
- Edge functions using service_role can read/write ANYTHING
- Your dashboard's SQL editor uses service_role; you can see
  everything
- A leaked service_role key bypasses every protection you wrote

### 4.3 RLS does NOT prevent service-role code from doing IDORs

If your edge function uses service_role to update a row based on
a client-supplied ID, the client can supply ANY id — including
someone else's. RLS won't stop it because service_role bypasses.

You must verify ownership in the function body:
```ts
// Pseudocode for service-role edge fn:
const { user } = await supabase.auth.getUser(bearerToken);
const targetRow = await supabaseAdmin.from("orders")
  .select("*").eq("id", clientBody.orderId).single();
if (targetRow.user_id !== user.id) return forbidden();
// only now: safe to mutate
```

### 4.4 RLS policy patterns

**Diner-owned row pattern:**
```sql
CREATE POLICY "users see own"
  ON reservations FOR SELECT
  TO authenticated
  USING (user_profile_id = auth.uid());
```

**Staff-of-restaurant pattern:**
```sql
CREATE POLICY "staff see restaurant rows"
  ON reservations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurant_roles urr
      WHERE urr.user_id = auth.uid()
        AND urr.restaurant_id = reservations.restaurant_id
    )
  );
```

**Public-read, auth-write pattern:**
```sql
CREATE POLICY "public read" ON restaurants FOR SELECT USING (true);
CREATE POLICY "owner update" ON restaurants FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid());
```

### 4.5 Column-level GRANTs (the hardening pattern)

RLS controls which ROWS. Column-level GRANTs control which COLUMNS.

For trust-boundary columns (flags that gate business decisions),
RLS alone is NOT enough. An owner with row-level UPDATE access can
write any column on their own row — including columns you'd never
intend them to touch.

Example: Cenaiva owners had RLS letting them UPDATE their own
restaurants row. Without column GRANTs, they could write
`is_published = true` and `stripe_charges_enabled = true` to skip
KYC entirely.

Fix:
```sql
REVOKE UPDATE ON TABLE public.restaurants FROM authenticated;
GRANT UPDATE (
  -- only legit owner-editable columns
  name, slug, address, hours_json, cover_photo_url, /* etc. */
) ON TABLE public.restaurants TO authenticated;
-- stripe_charges_enabled, is_published, subscription_status —
-- intentionally OMITTED. Service-role only.
```

### 4.6 Testing RLS policies

Use the SQL editor with role impersonation:
```sql
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"<some-user-id>"}';
SELECT * FROM reservations;  -- shows what THAT user would see
RESET ROLE;
```

Or test via the client (anon or auth'd session) and confirm the
result matches your expectation.

### 4.7 Common RLS pitfalls

- **Forgot to enable RLS on a table.** Tables WITHOUT RLS enabled
  are wide open to authenticated reads. Always
  `ALTER TABLE foo ENABLE ROW LEVEL SECURITY;` on tables holding
  user data.
- **Wrote a SELECT policy but no UPDATE policy.** UPDATE without a
  policy = nothing can update. Common gotcha when adding
  protections.
- **`USING` vs `WITH CHECK`.** `USING` is for filtering existing
  rows (SELECT, UPDATE source, DELETE). `WITH CHECK` is for new
  rows being created or updated. Different policies for different
  operations.
- **Anon role policies missed.** If you want public read,
  explicitly add `TO anon`. If you only write `TO authenticated`,
  anons see nothing.

---

## Part 5 — Edge functions

### 5.1 What they are

Deno-based serverless functions on Supabase. They run on Stripe's
edge network. Cold start ~100-300ms. Free tier covers thousands
per day; Pro covers way more.

### 5.2 File layout

```
supabase/functions/
├── _shared/                 # shared helpers
│   ├── auth.ts             # JWT verification
│   ├── validation/         # Zod schemas
│   └── rate-limit.ts       # rate limit helpers
├── my-function/
│   └── index.ts            # the fn itself
└── another-fn/
    └── index.ts
```

Each top-level directory under `supabase/functions/` is a separate
deployable fn.

### 5.3 The `verify_jwt` flag

In `supabase/config.toml`:
```toml
[functions.my-public-fn]
verify_jwt = false   # gateway skips JWT check; function handles it

[functions.my-internal-fn]
verify_jwt = true    # gateway requires a valid Bearer token
```

When to use which:
- **`verify_jwt = true`** for fns called by authenticated users with
  HS256 tokens. Gateway verifies signature.
- **`verify_jwt = false`** for:
  - Anon-callable fns (e.g. public booking)
  - Fns where users send ES256 tokens (the gateway doesn't handle
    ES256 yet, will reject with `UNSUPPORTED_TOKEN_ALGORITHM`)

For the ES256 case, verify in the function body:
```ts
const supabaseAdmin = createClient(URL, SERVICE_ROLE);
const token = req.headers.get("Authorization")?.slice(7);
const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
if (error || !user) return jsonRes({ error: "invalid_token" }, 401);
// user.id is now cryptographically verified
```

### 5.4 Deploying

```bash
supabase functions deploy my-function --project-ref <ref>

# All fns at once (if you have many):
supabase functions deploy --project-ref <ref>

# With shared imports/deps file:
supabase functions deploy my-function \
  --project-ref <ref> \
  --import-map supabase/functions/deno.json
```

Each deploy creates a new version. Logs available in dashboard.

### 5.5 Common patterns

**Body validation with Zod:**
```ts
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { MySchema } from "../_shared/validation/my-domain.ts";

const parsed = await parseJsonBody(req, MySchema, { jsonRes });
if ("response" in parsed) return parsed.response;
const { foo, bar } = parsed.data;
```

**Rate limiting:**
```ts
import { enforceRateLimit, rateLimitIdentifier } from "../_shared/rate-limit.ts";

await enforceRateLimit(supabaseAdmin, "my-fn",
  rateLimitIdentifier(req, userId),
  { limit: 60, windowSeconds: 60 });
```

**Service-role + ownership check:**
```ts
const supabaseAdmin = createClient(URL, SERVICE_ROLE);
const { data: { user } } = await supabaseAdmin.auth.getUser(token);
const target = await supabaseAdmin.from("rows").select("user_id").eq("id", id).single();
if (target.data?.user_id !== user.id) return forbidden();
```

### 5.6 Debugging in production

`Dashboard → Functions → [fn name] → Logs`. You see stdout +
stderr from your function. Use `console.log` liberally; remove
sensitive logs before shipping.

For local development: `supabase functions serve` runs all fns
locally. Combined with `stripe listen --forward-to` for webhook
testing.

### 5.7 Common pitfalls

- **Cold-start latency.** First request after idle = 200-500ms
  slower. For latency-critical paths, consider keeping fns
  "warm" or moving logic to direct PostgREST queries.
- **Service-role key as default client.** Always create your
  Supabase client INSIDE the function (don't store at module
  scope). Avoids confusion between authed and admin clients.
- **Forgot to await something.** Deno functions terminate when the
  Promise chain ends. Background work after `return` may not
  complete. Use `EdgeRuntime.waitUntil(promise)` for fire-and-forget
  tasks.
- **30-second timeout.** Edge functions have a hard cap. Long
  jobs should be queued (database job table, external queue).

---

## Part 6 — Auth setup

### 6.1 Sign-in methods supported

Supabase Auth supports out-of-the-box:
- Email + password
- Magic link (passwordless email)
- Phone OTP (via Twilio / MessageBird / etc.)
- WhatsApp OTP
- OAuth: Google, Apple, GitHub, Facebook, Discord, Twitter, etc.
- Anonymous (guest sessions that can be upgraded to real)

Enable each in `Dashboard → Authentication → Providers`. Most
require configuring an external account (Google Cloud, Apple
Developer, Twilio, etc.).

### 6.2 Redirect URLs (the gotcha that bit me)

For OAuth flows, Supabase redirects the user back to your app
after sign-in. The destination URL must be in your "Redirect URLs"
allowlist:

`Dashboard → Authentication → URL Configuration → Redirect URLs`

Add EVERY environment:
```
http://localhost:5174/**
https://staging.yourdomain.com/**
https://yourdomain.com/**
https://www.yourdomain.com/**
```

Forget one → user clicks "Sign in with Google" → gets redirected
to a "URL not allowed" error.

### 6.3 Site URL (the OTHER auth gotcha)

`Dashboard → Authentication → URL Configuration → Site URL`. This
is the canonical URL Supabase emails reference. Make sure it's
your prod URL (`https://yourdomain.com`), not localhost.

### 6.4 OAuth client IDs are separate

For Google OAuth: you need a Google Cloud OAuth Client ID. Its
"Authorized JavaScript origins" + "Authorized redirect URIs"
ALSO need every environment's URL. Two separate allowlists (your
OAuth client + Supabase redirects). Forget either and OAuth breaks.

### 6.5 Auth users table

Supabase manages `auth.users` (system table). You CAN'T modify
its columns directly. Create a public `user_profiles` table linked
1:1 via `auth_user_id` for your app's user data.

Use a trigger to auto-create a profile row when a user signs up:
```sql
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_profiles (auth_user_id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
```

### 6.6 JWT contents

A Supabase session JWT contains:
- `sub` — the user's auth.users.id
- `email` — usually
- `role` — `authenticated` (or `anon` for unsigned)
- Custom claims (configurable via the `before_user_created` /
  `before_signin` hooks)

Edge fns receive this via `Authorization: Bearer <jwt>`. Validate
via `supabase.auth.getUser(jwt)` which verifies the signature.

### 6.7 Session refresh

Supabase JWTs expire (default 1 hour). The client's supabase-js
library handles refresh automatically using a refresh token
stored in localStorage / cookies. You don't write refresh code.

### 6.8 Password requirements

Settings → Authentication → Auth Providers → Email → password
requirements. Default is "any 6 chars." Tighten to:
- min 8 chars
- include 1 number
- include 1 special char

Modern best practice: don't be overly strict (NIST guidance now
prefers length over complexity). 8+ chars and a denylist of
common passwords is enough.

---

## Part 7 — Storage buckets

### 7.1 Creating a bucket

Dashboard → Storage → New bucket. Two modes:
- **Public** — files served via CDN, anyone with the URL reads
- **Private** — requires signed URL or auth to access

For user avatars, restaurant cover photos, etc.: public bucket.
For receipts, sensitive uploads: private bucket.

### 7.2 RLS policies on storage

Storage has its own RLS via `storage.objects` table. Common
patterns:

**Owner-only write to user's folder:**
```sql
CREATE POLICY "users write to own folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'user-avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
```

**Staff write to restaurant's folder:**
```sql
CREATE POLICY "staff write to restaurant folder"
  ON storage.objects FOR ALL TO authenticated
  USING (
    bucket_id = 'event-media'
    AND EXISTS (
      SELECT 1 FROM public.user_restaurant_roles urr
      WHERE urr.user_id = auth.uid()
        AND urr.restaurant_id::text = (storage.foldername(name))[1]
    )
  );
```

### 7.3 File path patterns

Use predictable, scoped paths:
- `<bucket>/users/<user_id>/<filename>` for user uploads
- `<bucket>/restaurants/<restaurant_id>/<kind>/<filename>` for
  restaurant assets
- `<bucket>/<random-uuid>-<sanitized-filename>` for unguessable
  URLs

NEVER let users supply arbitrary paths. Always prefix with a
known-safe value.

### 7.4 Size + type limits

Set in bucket settings:
- `file_size_limit` — e.g. 5 MB for images
- `allowed_mime_types` — e.g. `["image/jpeg", "image/png", "image/webp"]`

This is the cheap baseline. Validate again client-side for UX
(don't let users upload 50 MB then reject).

### 7.5 Signed URLs for private buckets

```ts
const { data } = await supabase.storage.from("receipts")
  .createSignedUrl("path/to/file.pdf", 60); // expires in 60s
```

Generate short-lived signed URLs for sensitive content. Don't
embed permanent signed URLs anywhere.

### 7.6 Common pitfalls

- **Public bucket with sensitive content.** Audit your buckets
  before launch. If a bucket has files like `users/123/passport.jpg`
  in a public bucket, ANYONE with the URL has access.
- **No RLS on storage.objects.** Default is wide open writes for
  authenticated users to any path. Always write RLS for storage.
- **MIME type spoofing.** A file named `image.jpg` can have any
  content. Validate via image-magick or similar if you really need
  to be sure.

---

## Part 8 — Realtime subscriptions

### 8.1 What it is

Postgres changes pushed to clients via WebSocket. Useful for:
- Live reservations on a dashboard
- Live chat
- Live presence ("3 users online")

Enable per-table:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE reservations;
```

### 8.2 Client usage

```ts
const channel = supabase
  .channel("realtime:public:reservations")
  .on("postgres_changes",
    { event: "*", schema: "public", table: "reservations" },
    (payload) => console.log(payload)
  )
  .subscribe();
```

### 8.3 Connection limits

Free tier: 200 concurrent connections per project. Each open client
= 1 connection. If you have 200 users with the dashboard open,
that's your cap.

### 8.4 Antipattern: one channel per row

DON'T open a separate channel per row (e.g. per reservation card).
You'll burn through your connection limit. Multiplex via ONE
channel that filters in the handler:
```ts
.on("postgres_changes",
  { event: "*", schema: "public", table: "reservations",
    filter: `restaurant_id=eq.${restaurantId}` },
  ...)
```

### 8.5 RLS applies to realtime too

The user's subscription only fires for changes their JWT allows
them to see. Make sure your RLS policies are written; realtime
respects them.

---

## Part 9 — Security patterns (the hard rules)

These map to Cenaiva's 14-vulnerability audit findings. Apply to
every Supabase project.

### 9.1 Always verify JWTs via `auth.getUser`

**Don't:** roll your own JWT decode (`atob(token.split(".")[1])`).
That only decodes the payload; it does NOT verify the signature.
Attackers forge `sub` claims and become any user.

**Do:** use `supabaseAdmin.auth.getUser(token)`. supabase-js@2
verifies HS256 and ES256 signatures.

### 9.2 Column-level GRANTs for trust-boundary fields

(See Part 4.5.) Trust-boundary columns need explicit allowlists.
Don't rely on RLS alone.

### 9.3 Audit FKs use ON DELETE RESTRICT

(See Part 3.7.) Audit/consent log tables must outlive their parent.

### 9.4 SECURITY DEFINER REVOKE EXECUTE

`SECURITY DEFINER` functions run with the function owner's
privileges (usually `postgres`). Default = anyone can call.
ALWAYS:

```sql
CREATE OR REPLACE FUNCTION my_admin_func(...)
  RETURNS ... LANGUAGE plpgsql SECURITY DEFINER AS $$ ... $$;

REVOKE EXECUTE ON FUNCTION my_admin_func(...)
  FROM PUBLIC, anon, authenticated;
```

Only grant explicitly to roles that need it (typically
`service_role` only).

For dispatcher functions that take a parameter and route to
different actions, whitelist the parameter values:
```sql
IF func_path NOT IN ('safe-fn-1', 'safe-fn-2', /* ... */) THEN
  RAISE EXCEPTION 'unknown target: %', func_path;
END IF;
```

### 9.5 Secret-storing tables need RLS + REVOKE

If you store secrets (cron secrets, API keys, webhook signing
keys) in a Postgres table:
```sql
ALTER TABLE my_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE my_secrets FROM PUBLIC, anon, authenticated;
-- No policies. Only service_role can read.
```

### 9.6 Anon-callable edge fns: verify ownership server-side

If your fn uses `service_role` to mutate based on client-supplied
IDs, verify the caller has the right to that resource. Don't
assume RLS does this — it doesn't, because service_role bypasses.

### 9.7 Zod schema on every edge function

(See HABBI_STACK_SECURITY.md rule 9.) Every edge fn validates
incoming body with a Zod schema. Never raw `req.json()`.

### 9.8 Guard PostgREST `.eq()` on nullable UUIDs

(See HABBI_STACK_SECURITY.md rule 10.) Calling
`.eq("uuid_col", maybeNullValue)` with a null sends literal "null"
to Postgres → 400 invalid syntax. Always guard with `if (value)`.

### 9.9 Never use `policy USING (true)` for sensitive tables

`USING (true)` = "anyone can do this." Only acceptable for truly
public-read tables (e.g. `restaurants` SELECT). For anything user-
specific, narrow the policy.

### 9.10 Rotate `JWT_SECRET` (or equivalent) periodically

Supabase auto-rotates JWT signing keys if you opt into JWT Signing
Keys. For legacy projects on the static `JWT_SECRET`, rotate
annually + after any incident:
1. Generate new secret
2. Update in Settings → API → JWT secret
3. ALL existing sessions invalidate → users sign in again

---

## Part 10 — Pre-launch checklist (universal)

Before flipping a Supabase project to "production," walk through
this.

### Project + plan
- [ ] Project is on Pro plan ($25/mo) — daily backups + no auto-pause
- [ ] Project region matches your hosting region
- [ ] Database password documented in your password manager
- [ ] Dashboard 2FA enabled on your account

### API keys + secrets
- [ ] anon key and service_role key documented (in your password
      manager, NOT in code)
- [ ] No `sk_test_...` keys anywhere in client code or git
- [ ] All edge function secrets set via `supabase secrets set`
- [ ] No service_role key in `VITE_*` / `NEXT_PUBLIC_*` env vars

### Schema + RLS
- [ ] Every table with user data has RLS enabled
- [ ] Every table has policies for SELECT, INSERT, UPDATE, DELETE
      (as appropriate)
- [ ] Trust-boundary columns have column-level GRANTs (Part 4.5)
- [ ] Audit log FKs use ON DELETE RESTRICT (Part 3.7)
- [ ] SECURITY DEFINER functions have explicit GRANT/REVOKE (Part 9.4)
- [ ] Secret-storing tables have RLS + REVOKE (Part 9.5)
- [ ] All migrations applied successfully (no failed migrations
      in dashboard)

### Edge functions
- [ ] Every fn uses Zod validation on request body
- [ ] Every authed fn uses `auth.getUser` (NOT custom decode)
- [ ] Service-role fns verify ownership before mutation
- [ ] Rate limits on all anon-callable fns
- [ ] Cron secrets rotated to fresh value before launch
- [ ] Webhook fns verify signatures BEFORE reading body

### Auth
- [ ] Site URL = production URL (NOT localhost)
- [ ] Redirect URLs allowlist includes prod + staging + localhost
- [ ] Email templates customized (not Supabase defaults)
- [ ] Password requirements set (8+ chars min)
- [ ] OAuth provider redirect URIs match Supabase's expected URLs
- [ ] Email provider (SMTP) configured to send from your domain
      (not Supabase's no-reply)

### Storage
- [ ] All buckets reviewed for public-vs-private classification
- [ ] RLS policies on `storage.objects` for every bucket
- [ ] File size limits set per bucket
- [ ] Allowed MIME types restricted per bucket
- [ ] Test: upload a file, verify URL is signed (private) or public
      as expected

### Realtime
- [ ] Only tables that need realtime are in `supabase_realtime`
      publication
- [ ] Client code multiplexes (no one-channel-per-row antipattern)
- [ ] Connection limit headroom for projected user count

### Backups + recovery
- [ ] Daily backup schedule confirmed (Pro plan)
- [ ] PITR window known (7 days on Pro)
- [ ] Test: do a point-in-time restore to a separate project to
      confirm the workflow before you ever need it

### Monitoring
- [ ] Dashboard alerts configured (Settings → Reports → email
      digest)
- [ ] You'll notice if the database hits 80%+ usage (free tier
      caps + Pro tier soft limits)

---

## Part 11 — Ongoing operations

### 11.1 Daily

- Glance at Dashboard → Reports → Errors. Any new error patterns?
- Check `cron.job_run_details` if you use crons. Anything failing?
- Read your Stripe + Sentry (or equivalent) alerts.

### 11.2 Weekly

- Check storage usage trend (Settings → Usage). If it's growing
  fast, audit what's being stored.
- Check DB size. Free tier 500 MB / Pro tier 8 GB caps.
- Skim the Supabase changelog (https://supabase.com/changelog).
  Breaking changes are rare but communicated.

### 11.3 Monthly

- Review who has access to your Supabase project (Settings →
  Team). Revoke contractors who left.
- Rotate any secret that's been in env vars for >12 months.
- Test a backup restore to a separate project (10 min, confirms
  you can recover from disaster).
- Apply security patches to dependencies (HABBI_STACK_SECURITY.md
  monthly ritual).

### 11.4 Quarterly

- Audit RLS policies. Did any new tables get added without RLS?
- Audit edge function deploys. Anything not deployed in 6+ months
  might be stale.
- Re-read HABBI_UNIVERSAL_SECURITY_RULES.md and reconcile against
  your codebase.

### 11.5 Annually

- Rotate JWT signing key (if on legacy static JWT_SECRET).
- Hire a freelance security audit ($200-500). They WILL find
  things.
- Update this file with anything new you've learned.

---

## Part 12 — Common pitfalls I hit (don't repeat)

### "My queries return zero rows but the data exists in dashboard"

RLS is blocking. Dashboard SQL editor uses service_role (bypasses
RLS); your app uses anon/authenticated (respects RLS). Either:
- Add a policy that allows your case
- OR if you intend to bypass RLS, use service_role from an edge
  function

### "My migration ran in dev but fails in prod"

Either:
- You edited a deployed migration (DON'T)
- OR dev has data that doesn't satisfy a new constraint (e.g.
  adding NOT NULL to a column with existing NULLs)

Fix: write migration to handle the data first (UPDATE the NULLs,
THEN add NOT NULL), or skip the constraint in prod with a manual
data fix.

### "Edge function deploys but returns 401 even with valid JWT"

You probably have `verify_jwt = true` on a function whose users
send ES256 tokens. The gateway rejects with
`UNSUPPORTED_TOKEN_ALGORITHM` before your code runs. Set
`verify_jwt = false` and verify in-function via `auth.getUser`.

### "Service role key in client code somehow"

Check your `.env`, your hosting env vars, your source. If you find
it client-side: ROTATE IMMEDIATELY (Dashboard → Settings → API →
reset service role key). Then redeploy everything.

### "Realtime stops working under load"

Connection limit hit. Reduce channel count (multiplex) or upgrade
plan. Each open subscribe() = 1 connection.

### "Storage uploads fail with 'new row violates row-level security
policy'"

The bucket has RLS but no INSERT policy that allows the upload
path. Either add a policy or temporarily widen for testing (then
narrow before prod).

### "JWT decode failure"

If you're seeing JWT errors in edge functions:
- Confirm token isn't expired (check `exp` claim)
- Confirm the JWT_SECRET / signing key matches what generated the
  token
- Confirm you're using `auth.getUser` (verifies) not raw decode

### "OAuth redirect goes to localhost instead of prod"

Site URL is set to localhost. Change in Authentication → URL
Configuration → Site URL.

### "Email confirmation links go to localhost"

Same — Site URL. Set it to prod URL once you're live.

### "Migration created a table but my app says it doesn't exist"

You ran migration against dev but your app talks to prod (or vice
versa). Confirm via `supabase db push --project-ref <ref>`.

---

## Part 13 — Useful Supabase CLI commands

```bash
# Login
supabase login

# Link a local repo to a remote project
supabase link --project-ref <ref>

# Run migrations on remote project
supabase db push --project-ref <ref>

# Pull remote schema into local migrations
supabase db pull --project-ref <ref>

# Deploy a single function
supabase functions deploy my-fn --project-ref <ref>

# Tail function logs
supabase functions logs my-fn --project-ref <ref> --tail

# Manage secrets
supabase secrets list --project-ref <ref>
supabase secrets set KEY=value --project-ref <ref>
supabase secrets unset KEY --project-ref <ref>

# Start local Supabase (full stack: DB + auth + storage + studio)
supabase start
supabase stop

# Generate TypeScript types from schema
supabase gen types typescript --project-id <ref> > types.ts
```

---

## Part 14 — Resources

- **Supabase Docs** — https://supabase.com/docs
- **Supabase Status** — https://status.supabase.com
- **Supabase Discord** — community + staff help
- **Supabase GitHub Discussions** — feature requests + bug reports
- **Awesome Supabase** — community-curated patterns + libraries

---

## TL;DR (skim when in a hurry)

1. Two projects from day 1 (dev + prod). Never share data.
2. Three keys: anon (public), service_role (server only, ALL POWER),
   JWT signing (Supabase-managed).
3. service_role BYPASSES RLS. Verify ownership in code.
4. RLS controls rows; column GRANTs control columns. Use both.
5. Migrations are append-only. Never edit a deployed one.
6. Edge fns: `verify_jwt = false` + `auth.getUser` in body for
   ES256 tokens.
7. Audit log FKs: `ON DELETE RESTRICT`, never CASCADE.
8. SECURITY DEFINER functions need explicit REVOKE EXECUTE.
9. Storage RLS: write policies on `storage.objects` for every
   bucket.
10. Pro plan in prod for daily backups + no auto-pause.

---

Last updated: 2026-05-21 by Mark Habbi, after the Cenaiva
14-vulnerability hardening batch.
