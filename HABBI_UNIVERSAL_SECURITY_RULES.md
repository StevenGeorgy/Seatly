# HABBI_UNIVERSAL_SECURITY_RULES.md — language & framework-agnostic security principles

**Author:** Mark Habbi
**First written:** 2026-05-21
**How to use:** drop into the root of ANY new project, regardless of
stack (Supabase, Firebase, AWS Lambda, Django, Rails, Go, anything).
Tell your AI assistant: "Read this file. Apply these principles
before writing any feature that touches user data, payment, or
authentication."

These are PRINCIPLES, not code recipes. Every principle below applies
whether you're building with Postgres or Mongo, Stripe or PayPal,
React or Flutter, Supabase or Firebase.

For stack-specific implementations on Supabase + Stripe + React, see
`HABBI_STACK_SECURITY.md`. This file is the meta-layer above that.

---

## The 20 universal rules

### Authentication & sessions

**1. Never trust client claims about who the user is.**
Don't read the user_id from the request body, URL, or any
client-supplied field. Derive it from the verified authentication
context (a signed token, a session cookie, etc.) that you re-verify
server-side on every request.

**2. Verify the signature of every token before reading any field
from it.**
Don't decode-and-trust. Decode-and-verify. If your auth library's
documentation has a `decode` and a `verify` function, you ALWAYS
want the verify function. Use battle-tested libraries; never roll
your own crypto.

**3. Token claims expire. Re-verify on every request.**
Don't cache "this user is allowed" in your session for hours.
Cache the IDENTITY but re-check permissions on every privileged
action. Roles change.

**4. Failed auth returns the same response shape regardless of
which check failed.**
Don't say "wrong password" vs "no user with that email" — that's
an enumeration oracle. Say "invalid credentials" for both. Same
goes for signup: don't differentiate "email exists" from "email
new" in the response body or status code.

### Authorization (the WHO is allowed to do WHAT)

**5. Authentication ≠ authorization.**
Just because you know who they are doesn't mean they're allowed.
After auth, ALWAYS check whether THIS authenticated user has
permission for THIS specific action on THIS specific resource.

**6. Verify ownership at the function boundary, not just at the
database.**
Privileged code (anything that bypasses your row-level security) is
NOT exempt from the ownership check. If your code path uses an
admin/service-role key, you MUST verify the caller owns the
target row before mutating it. Otherwise you've built an IDOR
(insecure direct object reference).

**7. Verify ownership BEFORE the side effect, not after.**
Look up the target row → check ownership → only then mutate or
respond with sensitive data. Don't write first and check after.

**8. Trust-boundary fields need privileged-write paths.**
Fields that gate business decisions (`is_published`, `is_admin`,
`subscription_status`, `verified`, `kyc_passed`) must be writable
only by privileged code, not by user requests with row-level
access. Use column-level grants, write-protected admin functions,
or separate tables.

### Input validation

**9. Validate all input at every trust boundary.**
"Trust boundary" = wherever data crosses from a less-trusted to a
more-trusted layer: client → server, public API → internal API,
external webhook → internal handler. Validate shape, type, length,
range, format. Use schemas (Zod, Pydantic, JSON Schema, etc.).

**10. Length caps on every free-text field.**
Unbounded input = DoS via huge payloads, log spam, DB bloat, etc.
Every text field has a max length. AI prompts cap at ~5000 chars.
Notes/comments cap at ~2000. Names cap at ~200. Validate at the
edge.

**11. Bound numeric inputs on BOTH sides.**
Money fields: positive integer, max some sane ceiling. Negative
amounts could cause refunds; huge amounts could cause overflow or
abuse. Validate `0 <= amount <= sane_max`.

**12. Normalize before storing.**
Phone numbers → E.164. Emails → lowercase. UUIDs → lowercase
without braces. Pick the canonical form at the input boundary,
not at every read site.

### Money & financial operations

**13. Bind every payment to a specific business transaction via
metadata.**
When you create a payment intent / charge / transfer / refund,
stamp metadata that links it to your DB record (order_id,
booking_id, etc.). When you confirm or process the payment, assert
the metadata matches the record you're settling. Without this
binding, attackers substitute unrelated payments.

**14. Idempotency keys on every retryable money operation.**
Network blips, double-taps, retries. Without idempotency, you'll
double-charge. Stripe, PayPal, Square, all major providers support
idempotency keys. Use them on every create-payment call.

**15. Verify payment amounts ≥ expected, not exact match.**
Pre-orders + tips + fees often bundle. Don't fail confirmation
because the PI is $20 when you only required $15 deposit. But DO
fail if it's $5 when you required $15.

**16. Verify destinations on routed payments.**
If your platform splits payments to N merchants, verify the
specific payment was destined for the right merchant. Don't trust
that any succeeded payment of sufficient amount is valid for any
merchant.

### Webhooks & external callbacks

**17. Verify webhook signatures BEFORE reading any field from the
payload.**
Anyone can POST to your webhook URL. The signature is the only
proof it came from the real provider. Verify first, parse second.

**18. Webhooks deliver at-least-once. Dedupe by event ID.**
The same event can fire multiple times. Track which event IDs
you've already processed. Idempotent handlers per event.

### Redirects, URLs, and HTML

**19. Validate user-supplied redirect URLs against an allowlist.**
`?from=https://evil.com` is an open-redirect attack. After login or
any privileged action, the post-action redirect must be either an
absolute path on your own domain (`/dashboard`) or in an explicit
allowlist. Reject everything else.

**20. Never write secrets to logs, URLs, or client-visible
responses.**
Logs grow forever and leak. URLs end up in browser history, server
access logs, CDN logs, referrers. Client-visible responses leak to
anyone with browser dev tools. Secrets go in: env vars (server),
secure storage (client), never anywhere else.

---

## Database principles (applies to any DB)

### A. Use FK ON DELETE RESTRICT on audit/compliance tables

Customer audit logs must outlive the parent row. Whatever retention
your jurisdiction requires (CRA 7 years, GDPR 6 years, SOC2,
HIPAA, etc.), audit rows can't cascade-delete with a soft-deleted
or anonymized parent.

### B. Privileged DB functions need explicit grants

If your DB supports stored procedures / functions with elevated
privileges (Postgres `SECURITY DEFINER`, MS SQL `EXECUTE AS`,
etc.), the default is usually "anyone can call." REVOKE EXECUTE
from public roles, then GRANT explicitly only to roles that should
call it.

### C. Whitelist parameters in dispatcher functions

If you have a function that takes a parameter and uses it to
choose a destination (a path, a table name, a queue name), validate
that parameter against a hardcoded whitelist inside the function.
Don't trust the caller to pass something safe — even if you trust
all callers today.

### D. Secret-storing tables need read protection at the row level

If you have a table that stores secrets (cron secrets, encryption
keys, API keys, webhook secrets), enable row-level security AND
revoke all grants from non-privileged roles. The default Postgres
behavior is "anyone authenticated can SELECT." That's wrong for
secret tables.

### E. Backups are insurance, not policy

Yes, take backups. But backups don't substitute for proper
auth/authz/validation. Backups recover from disasters; they don't
prevent breaches.

---

## Configuration & secrets

### F. Each environment has its own keys

Dev, staging, production each get their own database, their own
API keys, their own secrets. NEVER share. NEVER copy production
secrets to dev to "make testing easier."

### G. Secrets rotate periodically and after any incident

Even if you don't think a secret leaked, rotate annually. After
any suspected leak (a contractor with access leaves, a laptop
goes missing, etc.), rotate immediately. Don't wait until you
confirm a breach.

### H. Service-role keys never reach the client

There's usually a "publishable" key (safe for client) and a
"service-role" / "secret" key (server only). The secret key gives
unrestricted access. It NEVER appears in client-side code, env
vars marked `VITE_*` / `NEXT_PUBLIC_*` / `REACT_APP_*`, or
anywhere the client can read.

### I. Different deploy targets have different env var sources

- Local dev: `.env` file on your machine (gitignored)
- Staging: env vars set in your staging hosting provider
- Production: env vars set in your prod hosting provider
- CI/CD: env vars set in your CI provider, scoped to the right
  branch

Never share a single `.env` across all environments.

---

## Observability & incident response

### J. Log enough to investigate, not so much that secrets leak

Log request IDs, user IDs, timestamps, status codes, error types.
Never log: passwords, API keys, full credit card numbers, full
JWTs, PII unless necessary.

### K. Monitor for anomalies

Spike in 5xx errors. Spike in failed auth. Spike in failed
payments. Sudden burst of new accounts from one IP. Set up
alerts; you can't watch logs 24/7.

### L. Have a rollback plan before you deploy

Every deploy answer: "if this breaks, how do we revert in <5
minutes?" If the answer is unclear, don't deploy.

### M. Public security disclosure email

Have a `security@yourcompany.com` address that reads to a real
human. Researchers will find issues; you want them to tell you,
not exploit them.

---

## Dependencies & supply chain

### N. Automated dependency-patch tooling

Dependabot, Renovate, Snyk, whatever. Set it up day one. Most
patches are routine; you just merge them.

### O. Audit major dependency upgrades

Minor patches (`x.y.Z`) usually safe to auto-merge. Major upgrades
(`X.y.z`) deserve a manual review. Read the changelog. Test
broadly.

### P. Pin lockfiles, commit them

Whatever your stack's equivalent of `package-lock.json` is — commit
it. Two builds of the same commit should produce byte-identical
output.

### Q. Watch for malicious-package incidents in your ecosystem

The npm "event-stream" / "ua-parser-js" / "node-ipc" incidents —
maintainers get compromised, malicious code lands in a widely-used
package. Subscribe to security advisories for your ecosystem
(GitHub Security Advisories is free).

---

## The "I'm a solo founder using AI to build" disclaimer

If you're like me (Mark) — building with AI as your technical
co-founder — you can't deeply audit every dependency or read every
piece of code AI writes. Realistic compromises:

- **Pick a popular, well-maintained stack** (React, Supabase,
  Stripe). Million-user products use them; their issues are found
  and patched fast. Don't pick an obscure framework just because
  AI suggested it.
- **Enable automated patching** (Dependabot). Click-merge the
  routine patches.
- **Once a year, hire a freelance security engineer for $200-500
  on Upwork** to run a fresh audit. They'll find what AI missed.
- **Ask AI to do periodic security sweeps** ("look at all my edge
  functions for these 20 patterns from HABBI_UNIVERSAL_SECURITY_RULES.md
  and report violations").
- **Stay subscribed to the security advisories** of your major
  providers (Stripe, Supabase, OAuth providers, etc.). When the
  next Log4j drops, you want to know.

You'll never have the deep security knowledge of a 20-year veteran.
But following the 20 rules above puts you ahead of 90% of
hand-coded projects. The remaining 10% gap is what your annual
audit catches.

---

## The Cenaiva audit list — examples mapped to universal rules

For context, these are the real vulnerabilities that the universal
rules above would have prevented:

| Cenaiva issue (2026-05) | Universal rule it violates |
|---|---|
| `decodeJwtPayload` bypass on 16 edge fns | Rule 2 (verify token signatures) |
| PI substitution in confirm-deposit-paid | Rule 13 (bind via metadata) |
| `is_published` writable by any owner directly | Rule 8 (trust-boundary needs privileged write) |
| Cron secret readable by authenticated users | Rule D (secret tables need read protection) |
| Cron dispatcher accepts arbitrary func_path | Rule C (whitelist parameters) |
| `signup-restaurant-owner` email enumeration | Rule 4 (uniform error responses) |
| Cascade-delete on audit tables | Rule A (audit FKs use RESTRICT) |
| `AuthCallbackPage` open redirect | Rule 19 (validate redirect URLs) |
| `check-in-guest` IDOR | Rule 6 (verify ownership in privileged code) |
| `accept-staff-invite` null match | Rule 9 (validate input, positive matches not absence-of-mismatch) |
| 48 edge fns with no Zod schemas | Rule 9 (validate all input) |
| `modify-reservation` guest_id null bug | Rule 9 + general null-handling discipline |

Every vulnerability mapped to one or more universal rules. If those
20 rules had been applied from day 1, we wouldn't have had to
audit-and-fix.

---

## How to use this file

### When starting a new project
Drop this file in the root. Tell your AI assistant: "Read
HABBI_UNIVERSAL_SECURITY_RULES.md. Apply rules 1-20 from day 1 of
this project. Whenever I ask for a feature that touches auth,
payment, or user data, walk me through which rules apply before
writing code."

### When auditing an existing project
Tell your AI: "Audit this codebase against
HABBI_UNIVERSAL_SECURITY_RULES.md. For each of the 20 rules, find
any code that violates it. Report findings with file:line, severity,
and the rule number violated."

### When the security landscape changes
Add new rules here as you learn from incidents — yours or others'.
This file is the spine of your security discipline; keep it living.

### When you're not sure if something's safe
Ask AI: "Does this change violate any rule in
HABBI_UNIVERSAL_SECURITY_RULES.md?" If unsure, get a second opinion
(another AI, a developer friend, or a paid hour with a security
engineer).

---

## TL;DR — the 5 rules that catch 80% of real-world bugs

If you remember nothing else:

1. **Verify token signatures.** (Rule 2)
2. **Verify ownership in privileged code.** (Rule 6)
3. **Bind payments to records via metadata + assert at confirm.** (Rule 13)
4. **Validate every input.** (Rule 9)
5. **Validate redirect URLs.** (Rule 19)

If your project follows just those five, you've cleared the bar
for most apps in the real world. The other 15 are the polish on
top.

---

Last updated: 2026-05-21 by Mark Habbi, after the Cenaiva
14-vulnerability hardening batch.
