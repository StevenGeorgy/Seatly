# HABBI_STACK_SECURITY.md — security patterns for Supabase + Stripe + React projects

**Author:** Mark Habbi
**First written:** 2026-05-21
**Source of these rules:** the security audit + 14-vuln hardening
batch on the Cenaiva (Seatly) project, plus the split-tender feature
and the modify-reservation bug discovery in the same week.

**How to use this file:** drop it into the root of any future
project that uses Supabase + Stripe + React/Next/Vite. Tell your AI
assistant (Claude, Cursor, whatever) "read HABBI_STACK_SECURITY.md
before suggesting any change." The rules below are concrete patterns
keyed to this stack. For language-agnostic principles see
`HABBI_UNIVERSAL_SECURITY_RULES.md`.

---

## Hard rules — never break these

### 1. JWT signature verification

**Don't:** roll your own JWT decode, e.g. `atob(token.split('.')[1])`
to extract `sub`. That ONLY base64-decodes the payload — it does
NOT verify the signature. Forged tokens pass.

**Do:** use `supabaseClient.auth.getUser(token)`. supabase-js@2
verifies the signature (handles HS256 + ES256 both). Returns null
on invalid tokens.

**Why:** Cenaiva had 16 edge functions using `decodeJwtPayload` from
a shared shim. Closed in 2026-05-20. Pre-fix, an attacker could
forge `Authorization: Bearer eyJ...<base64({"sub":"victim-id"})>.fake`
and become any user.

**Where to apply:** every edge function that authenticates a user.
Both `verify_jwt = true` (gateway verifies) and `verify_jwt = false`
(in-function verifies) modes need this. If the gateway rejects
ES256 tokens (as Supabase's currently does), keep `verify_jwt =
false` and verify in the fn body.

```ts
// CORRECT pattern (mirror this in every authed edge fn):
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const authHeader = req.headers.get("Authorization") ?? "";
const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
if (!bearerToken) return jsonRes({ error: "auth_required" }, 401);
const { data: { user }, error } = await supabaseAdmin.auth.getUser(bearerToken);
if (error || !user) return jsonRes({ error: "invalid_token" }, 401);
// Now user.id is cryptographically verified.
```

### 2. Stripe PaymentIntent metadata as the binding mechanism

**Don't:** trust client-supplied payment intent IDs to settle a
specific DB row. The diner sends `{ deposit_id: X, pi_id: Y }` to
your "mark paid" endpoint; if you only check that PI Y succeeded
and amount >= deposit X's expected, attackers substitute any
succeeded PI of sufficient value (their own $1 charge on an
unrelated Stripe account).

**Do:** at PI-create time, stamp the target DB row's UUID onto
`paymentIntents.metadata`. At PI-confirm time, assert the
metadata contains the row ID you're settling.

**Why:** Cenaiva had this exact vulnerability in
`confirm-deposit-paid`, `mark-order-paid`, and `confirm-hold-paid`.
Closed via the `deposit_payment_ids` / `order_id` / `hold_id`
metadata stamps.

```ts
// PRODUCER (PI creation):
const metadata: Record<string, string> = {
  restaurant_id: restaurantId,
  platform: "your_brand",
};
if (depositPaymentIds.length > 0) {
  metadata.deposit_payment_ids = depositPaymentIds.join(",");
  metadata.reservation_id = lookupReservationId;
}
await stripe.paymentIntents.create({ amount, currency, metadata, ... });

// CONSUMER (PI confirmation):
const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
const stamped = (intent.metadata?.deposit_payment_ids ?? "")
  .split(",").map(s => s.trim()).filter(Boolean);
if (!stamped.includes(rowId)) {
  return jsonRes({ error: "pi_payment_id_mismatch" }, 400);
}
```

### 3. Stripe Connect destination check

**Don't:** trust that a succeeded PI was destined for the right
restaurant. If your platform routes to N restaurants via Connect,
verify the destination matches.

**Do:** assert `intent.transfer_data.destination === expectedStripeAccountId`.

```ts
const piDestination = intent.transfer_data?.destination ?? null;
if (expectedDestination && piDestination !== expectedDestination) {
  return jsonRes({ error: "pi_destination_mismatch" }, 400);
}
```

### 4. Stripe idempotency keys on retryable operations

**Don't:** create PaymentIntents without an idempotency key on
retryable code paths (double-tap Place Order, network retry, etc.).
You'll charge cards twice.

**Do:** set a deterministic key like
`split_<reservation_id>_<deposit_row_id>` per logical operation.
Stripe dedupes within 24 hours.

```ts
const idempKey = `split_${reservationId}_${rowId}`;
await stripe.paymentIntents.create(params, { idempotencyKey: idempKey });
```

### 5. Column-level GRANTs for trust-boundary fields

**Don't:** rely on RLS alone for flags that affect business
decisions (`is_published`, `subscription_status`, `is_active`,
`stripe_charges_enabled`, etc.). RLS controls WHICH rows you can
update, not which COLUMNS. An owner with row-level UPDATE access
can write any column they own.

**Do:** explicitly REVOKE UPDATE on the whole table and GRANT
UPDATE only on the columns owners legitimately edit. Trust-boundary
columns are service-role only.

```sql
REVOKE UPDATE ON TABLE public.restaurants FROM authenticated;
GRANT UPDATE (
  name, address, hours_json, cover_photo_url, /* etc. */
) ON TABLE public.restaurants TO authenticated;
-- stripe_charges_enabled, is_published, subscription_status, etc.
-- intentionally OMITTED. Service-role writes them via edge fns.
```

### 6. RLS + REVOKE on secret-storing tables

**Don't:** create a config table (e.g. `cron_config`,
`webhook_secrets`, `api_keys`) and leave default permissions. By
default, Supabase grants `authenticated` SELECT on tables without
RLS. Any logged-in user reads your secrets.

**Do:** enable RLS with no policies (service_role still bypasses),
plus REVOKE everything from PUBLIC/anon/authenticated.

```sql
ALTER TABLE public.cron_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cron_config FROM PUBLIC, anon, authenticated;
```

### 7. SECURITY DEFINER + REVOKE EXECUTE

**Don't:** create `SECURITY DEFINER` functions without explicit
EXECUTE grants. Default = PUBLIC EXECUTE. Anyone can call them.

**Do:** REVOKE EXECUTE FROM PUBLIC, anon, authenticated. Grant only
to the roles that should call it (typically just service_role).

```sql
CREATE OR REPLACE FUNCTION call_cron_target(func_path text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$ ... $$;
REVOKE EXECUTE ON FUNCTION call_cron_target(text)
  FROM PUBLIC, anon, authenticated;
```

For dispatcher-style functions that take a path/name parameter,
whitelist the allowed values inside the function body. Don't trust
the caller to pass something safe.

### 8. Audit-log foreign keys use ON DELETE RESTRICT

**Don't:** use `ON DELETE CASCADE` on audit/consent/compliance
tables (`notification_log`, `consent_log`, `referral_credits`,
`audit_trail`, etc.). A hard-delete of the parent (intentional or
accidental) wipes the audit history. Violates retention (CRA, GDPR,
SOC2, etc.).

**Do:** use `ON DELETE RESTRICT`. If the parent uses soft-delete +
anonymize, the audit row's FK stays valid forever.

```sql
ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_parent_fkey
  FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE RESTRICT;
```

### 9. Zod schema validation on every edge function

**Don't:** raw `req.json()` and trust the shape. Type assertions
(`as MyType`) don't validate at runtime.

**Do:** use a shared `parseJsonBody(req, ZodSchema)` helper. Each
domain has a schema file. Free-text fields are length-capped, UUIDs
are regex-checked, phone numbers are E.164, etc.

```ts
import { parseJsonBody } from "../_shared/validation/parse.ts";
import { MySchema } from "../_shared/validation/my-domain.ts";

const parsed = await parseJsonBody(req, MySchema, { jsonRes });
if ("response" in parsed) return parsed.response;
const { foo, bar } = parsed.data;  // type-safe + runtime-validated
```

Primitives to define once in `_shared/validation/base.ts`:
- `Uuid = z.string().uuid()`
- `Email = z.string().trim().email()`
- `EmailLower = Email.toLowerCase()`
- `E164Phone = z.string().regex(/^\+\d{1,15}$/)`
- `BoundedText = (max) => z.string().trim().max(max)`
- `Money = z.number().int().nonnegative().max(100_000)` (cents)
- `ConfirmationCode = z.string().regex(/^[A-Z0-9]{6}$/)`

### 10. Always guard PostgREST .eq() on nullable UUID columns

**Don't:** call `.eq("uuid_col", maybeNullValue)` without a null
guard. supabase-js converts JS `null` to the literal string
`"null"` in PostgREST URL params. Postgres rejects with
`invalid input syntax for type uuid: 'null'`. 400, no data
returned.

**Do:** `if (value) { ... .eq("uuid_col", value) ... }` — only run
the filter when value is non-null. Or use a fallback path that
doesn't filter on that column.

**Where this typically bites:** filtering by `guest_id` /
`order_id` / `event_id` / any nullable FK. If you only test with
data that has the column filled, you'll never hit it. Add a test
case with the column null.

### 11. Anon-callable + service-role internal: verify ownership

**Don't:** assume that "service-role can do anything in this fn,
and only authenticated diners will call it" is enough. The CALLER
identifies their target, and a malicious caller can target someone
else's row.

**Do:** look up the target row, verify the caller has the right
to modify it, THEN mutate. Even if RLS would block them on a
direct query, your service-role write bypasses RLS.

**Where this bit Cenaiva:** `check-in-guest` accepted a
reservation_id and used service-role to flip it to seated. Pre-fix,
ANY authenticated user could check in ANY reservation at ANY
restaurant. Post-fix: verify caller has a `user_restaurant_roles`
row for the reservation's restaurant.

### 12. Idempotent confirmation endpoints

**Don't:** error out when an already-confirmed PI tries to confirm
again. Mobile + web both retry on network blips; double-confirm
fires routinely.

**Do:** check if the target row is already in the desired state
with the SAME PI id. If yes, return success with an `idempotent:
true` flag. The user's payment isn't re-charged; the operation is
just a no-op.

```ts
if (depositRow.status === "charged" &&
    depositRow.stripe_payment_intent_id === paymentIntentId) {
  return jsonRes({ deposit: depositRow, idempotent: true });
}
```

### 13. Open redirect protection on `from` / `redirect` / `next` params

**Don't:** assign a query-param-supplied URL to `window.location.href`
or `<a href>` without validation. `?from=https://evil.com` sends
your freshly-authenticated user to a phishing page while they're
still logged in.

**Do:** define a single `isSafeRedirectPath(path)` helper that
allowlists same-origin paths (e.g., must start with `/`, no
`//`, no `:` before the first `/`). Use it everywhere you assign
to `window.location` or `<Link to>`.

```ts
const safeTarget = from && isSafeRedirectPath(from) ? from : "/discover";
window.location.href = safeTarget;
```

### 14. Email enumeration on signup

**Don't:** differentiate "this email exists" vs "this email is new"
in your signup endpoint's response. Attacker enumerates which
emails are registered.

**Do:** return a uniform success-shaped response in both branches
(or, equivalently, the same error code/body). The user finds out
via the email they receive (or don't).

### 15. Webhook signature verification before any state change

**Don't:** trust webhook payloads. Anyone with the URL can POST.
A fake `payment_intent.succeeded` could mark unpaid orders as paid.

**Do:** call `stripe.webhooks.constructEventAsync(body, sig,
secret)` before reading any field from the event. If the signature
doesn't match, return 400.

```ts
const event = await stripe.webhooks.constructEventAsync(
  rawBody, signatureHeader, webhookSecret,
);
// Only NOW is `event` trustworthy.
```

Also dedupe by `event.id` to handle Stripe's at-least-once
delivery.

---

## Stack-specific patterns to reuse

### Per-domain Zod schema files

Group schemas by domain in `_shared/validation/`:
- `base.ts` — primitives (Uuid, Email, etc.)
- `booking.ts` — reservation + modify schemas
- `payment.ts` — PI confirmation / refund schemas
- `subscription.ts` — billing lifecycle schemas
- `staff-invites.ts` — staff invite / role schemas
- `chat.ts` — AI prompt schemas
- `public.ts` — anon-callable endpoint schemas
- `restaurant-ops.ts` — owner action schemas

One schema per edge function. Reuse primitives, never duplicate them.

### parseJsonBody helper signature

```ts
// _shared/validation/parse.ts
export async function parseJsonBody<T>(
  req: Request,
  schema: ZodSchema<T>,
  opts: { jsonRes: (b: unknown, s: number) => Response },
): Promise<{ data: T } | { response: Response }> {
  let raw: unknown;
  try { raw = await req.json(); } catch {
    return { response: opts.jsonRes({ error: "Invalid JSON" }, 400) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { response: opts.jsonRes({
      error: "Validation failed: " + result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "),
    }, 400) };
  }
  return { data: result.data };
}
```

Edge fns call it: `const parsed = await parseJsonBody(...);
if ("response" in parsed) return parsed.response; const { x } =
parsed.data;`.

### Auth helper

```ts
// _shared/auth.ts (canonical pattern)
export async function checkAuth(
  req: Request,
  client?: SupabaseClient,
): Promise<
  | { ok: true; authUserId: string; email: string | null }
  | { ok: false; reason: "missing_token" | "invalid_token" }
> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, reason: "missing_token" };
  const supabase = client ?? createClient(URL, SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { ok: false, reason: "invalid_token" };
  return { ok: true, authUserId: data.user.id, email: data.user.email ?? null };
}
```

### Rate limiting per user

Use a DB-backed rate-limit RPC (`check_rate_limit`) called from a
shared helper:

```ts
// _shared/rate-limit.ts
export async function enforceRateLimit(
  client: SupabaseClient,
  scope: string,
  identifier: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number },
): Promise<void> {
  const { data } = await client.rpc("check_rate_limit", {
    p_key: `${scope}|${identifier}`,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (data === false) throw new RateLimitError("Too many requests");
}
```

Keys are `${scope}|user:${authUserId}` for authed callers,
`${scope}|ip:${cf_connecting_ip}` for anon. Per-IP is defeatable by
VPN rotation — prefer per-user when possible.

### Edge function order of deploy

When a single change touches multiple layers, deploy in this order
to avoid users hitting "function doesn't exist" or "column doesn't
exist" errors:

1. Database schema migrations (apply via `supabase db push`)
2. Edge functions (`supabase functions deploy <name>`)
3. Frontend (push to hosting provider, e.g. AWS Amplify)

Reverse for rollback (frontend first, then edge fns, then DB if
safe).

### Stripe Elements wallet config

For the diner-side card-entry, configure each PaymentElement:

```tsx
<PaymentElement options={{
  layout: "tabs",
  paymentMethodOrder: ["card", "apple_pay", "google_pay"],
  wallets: { applePay: "auto", googlePay: "auto", link: "never" },
}} />
```

Why `link: "never"`: Stripe's Link wallet shows a "Secure, fast
checkout with Link" promo bar above the card form that confuses
users and creates compliance ambiguity around storing their email
in Link's separate wallet.

For the owner subscription card, same config plus
`save_card: true` only on the diner's slot 0 (not on guest payers
in a split-tender flow).

---

## CRON_SECRET rotation procedure

Cron-callable edge functions share a secret across:
- `CRON_SECRET` environment variable (set via `supabase secrets set`)
- A DB-stored copy in your `cron_config` table

To rotate:

1. Generate new secret: `openssl rand -base64 32`
2. Set env var: `supabase secrets set CRON_SECRET="$NEW"
   --project-ref $PROJECT`
3. **Redeploy all cron-validating fns** so they pick up the new
   env var. They cold-start on next invocation but you can force it
   with `supabase functions deploy <name>` for each.
4. Update DB row: `UPDATE cron_config SET cron_secret = '$NEW'
   WHERE id = (SELECT id FROM cron_config LIMIT 1);`
5. Wait for the next cron tick (5-15 min depending on schedule).
   Confirm `cron.job_run_details` shows `status='succeeded'`.

Step ordering: env var + redeploy BEFORE updating DB row, so when
crons fire with the new secret value, validating fns are already
expecting it.

---

## Common operational pitfalls

### "Forgot to redeploy"

After changing edge function code, `supabase functions deploy` is
required. The function logs will keep showing old behavior until
you deploy. Stripe webhook signatures, JWT verification logic, etc.
all silently use the old code until redeploy.

### "verify_jwt mismatch"

If you flip `verify_jwt = true` in `config.toml` on a fn that
serves ES256-tokened users (anyone using Supabase JWT Signing Keys),
the gateway rejects with `UNSUPPORTED_TOKEN_ALGORITHM`. Keep
`verify_jwt = false` and verify in-function via `auth.getUser`.

### "secret in URL"

Don't ever put secrets in URL query params. They leak via referer
headers, browser history, server access logs, CDN logs. Use POST
body or custom headers (`x-cron-secret`, `Authorization: Bearer`).

### "Apple Pay not appearing in prod"

Apple Pay requires:
1. Domain verification in Stripe (uploads
   `.well-known/apple-developer-merchantid-domain-association` to
   your domain)
2. Live mode keys (test mode + Apple Pay doesn't fully work on
   real devices)
3. User has a card in their Apple Wallet
4. HTTPS with real cert

If you forget any of these, the Apple Pay button silently doesn't
appear. Test on a real iPhone with Wallet set up.

### "Google Maps grey box on dev"

Maps API keys have HTTP-referrer restrictions. If you add a new
dev URL (e.g. when switching from `http://localhost:5173` to
`https://localhost:5174` for HTTPS dev), add it to the API key's
allowlist in Google Cloud Console. Otherwise:
`RefererNotAllowedMapError` and the map stays grey.

### "Supabase auth redirect mismatch"

Sign-in providers (Google, Apple) redirect back to a URL after
auth. That URL must be in Supabase's "Redirect URLs" allowlist
(Dashboard → Authentication → URL Configuration). Add every
environment's URL: localhost, staging, prod.

### "OAuth client mismatch"

Same as auth redirect but on Google's side. Google Cloud Console
→ OAuth Client ID → Authorized JavaScript origins + Authorized
redirect URIs.

---

## Pre-launch checklist (drop into any project)

Repeatable checklist any time you're about to flip "test mode → live
mode" on a Supabase + Stripe + React project:

- [ ] All 16-stack rules above followed
- [ ] CRON_SECRET rotated to a fresh value before going live
- [ ] All audit-log FKs are `ON DELETE RESTRICT`, not CASCADE
- [ ] Column-level grants on `restaurants`-equivalent table
- [ ] RLS + REVOKE on cron_config / secrets tables
- [ ] Stripe webhook URL configured + `whsec_` signing secret set
- [ ] Stripe Connect Express accounts complete KYC in LIVE mode
- [ ] Live publishable + secret keys swapped in
- [ ] Live $X.XX subscription Price created (NOT prod_ — must be
      price_)
- [ ] Apple Pay domain verified (if AP enabled)
- [ ] Resend domain verified (or equivalent email provider)
- [ ] Twilio phone number provisioned + WhatsApp approved
- [ ] Supabase auth redirect URLs include prod domain
- [ ] Google OAuth Client allows prod domain
- [ ] Google Maps API key allowlists prod domain
- [ ] GitHub Dependabot enabled for ongoing patches
- [ ] First live transaction: book a $5 deposit, confirm, refund

---

## How to use this file going forward

When you start a new project on the same stack:

1. Copy this file to the repo root.
2. Tell your AI assistant: "Read HABBI_STACK_SECURITY.md before
   suggesting any change. Apply rules 1-15 from day 1."
3. As you find new patterns / vulnerabilities, ADD to this file.
   It's a living document of hard-won knowledge.

When this file doesn't apply (different stack — Firebase, PayPal,
etc.) fall back to `HABBI_UNIVERSAL_SECURITY_RULES.md` which is
language- and stack-agnostic.

---

## What's in scope vs. out of scope

**In scope (this doc):**
- Supabase Auth + Edge Functions + Postgres + RLS patterns
- Stripe PaymentIntents + Connect + webhooks patterns
- React + Vite frontend patterns
- Zod input validation patterns

**Out of scope (see other docs):**
- General security principles → `HABBI_UNIVERSAL_SECURITY_RULES.md`
- Cenaiva-specific RPC names → `CLAUDE.md`
- Mobile-specific patterns → `MOBILE_*_GUIDE.md` family
- Deploy/dev/prod workflow → `HABBI_DEV_TO_PROD.md`
