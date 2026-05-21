# Legal docs — implementation handoff for the web app (cenaiva.com)

**Last updated:** May 21, 2026
**Audit pass:** May 21, 2026 (against `apps/web` HEAD on `main`)
**Source mobile commits:** the three legal screens added in `mobile-seatly-v2-18` on May 21, 2026.

This document is the complete implementation handoff for shipping the three Cenaiva legal documents on cenaiva.com. It assumes you are working in this repo (`apps/web/`) and have read CLAUDE.md.

> **Hard constraint:** Legal text is contract language. Do not paraphrase, re-format, or merge sections without legal sign-off. Anything marked "canonical text from mobile" means a verbatim copy/paste — not an LLM rewrite.

---

## Section 0 — TL;DR (read this if nothing else)

There are three documents to ship:

1. **Consumer Terms of Service v1** → `/terms` (already exists; **the live text is STALE — must be updated**)
2. **Privacy Policy v1.1** → `/privacy` (already exists as a **placeholder**; needs the full 18-section body)
3. **Restaurant Partner Agreement v2.1** → `/partners/agreement` (**route does not exist at all**; needs to be built from scratch)

Plus three supporting routes:

- `/partners/agreement-history` (archive of prior Partner Agreement versions)
- `/partners/sub-processors` (Schedule A — partner-facing copy)
- `/legal/sub-processors` (Schedule A — diner-facing copy; same table, different URL because each document references its own audience-appropriate path)

You also need to:

- Set up `security@cenaiva.com` as a real inbound mailbox.
- Rewire the marketing footer, register page, restaurant onboarding wizard, and Stripe payment-confirmation surfaces to link to / record acceptance of the right documents.
- Patch ~10 stale strings already shipped in `apps/web/src/lib/legal/termsContent.ts` (see Section 9).
- Add a `partner_agreement_consent_log` row on restaurant signup and at publish-time (see Section 7).

Estimated effort: ~3–5 dev-days for routing + content scaffolding + acceptance logging; legal review separate.

---

## Section 1 — Current state of the web app

Source-of-truth files and what's already there:

| Surface | File | Status |
|---|---|---|
| Terms page | `apps/web/src/pages/legal/TermsPage.tsx` | **Live, but stale** — renders 53 sections from `lib/legal/termsContent.ts` |
| Terms content | `apps/web/src/lib/legal/termsContent.ts` | **Stale** — 8× `support@cenaiva.com`, Stripe Connect wording, `Profile > Settings > Delete Account`, 90-day voice retention, no `security@`, no Schedule A, no 72h breach SLA |
| Privacy page | `apps/web/src/pages/legal/PrivacyPage.tsx` | **Placeholder** — body is one paragraph pointing to `cenaiva.com/privacy`; needs the full 18-section body |
| Refund page | `apps/web/src/pages/legal/RefundPolicyPage.tsx` | Live. **Out of scope here**, but verify it stays consistent with the new Terms §11.3. |
| Partner Agreement | — | **Missing.** No route, no page, no content file. |
| Routing | `apps/web/src/routes/AppRoutes.tsx` lines 76–78 | `/terms`, `/privacy`, `/refund-policy` registered. Partner routes need adding. |
| Footer | `apps/web/src/components/marketing/MarketingShell.tsx` lines 187–195 | Has Terms/Privacy/Refund/Security/Accessibility. Missing Partner Agreement + Sub-processors. |
| Diner signup consent | `apps/web/src/pages/auth/RegisterPage.tsx` lines 173–193 | Age-gate checkbox only, links to `/terms#eligibility`. **No explicit ToS / Privacy acceptance**. |
| Restaurant signup wizard | `apps/web/src/components/onboarding/Step1Basics.tsx` line 160 (`signup-restaurant-owner`) | **No Partner Agreement acceptance checkbox or log.** |
| Card-save disclosure | `apps/web/src/components/billing/disclosures.ts` | `SAVE_CARD_DISCLOSURE` + `PUBLISH_CONFIRM_DISCLOSURE` exist; consumed by Step8PaymentSetup + Settings billing card. **Already writes `subscription_consent_log` server-side per CLAUDE.md.** Doesn't currently reference the Partner Agreement. |
| Booking checkout | `apps/web/src/pages/customer/RestaurantPublicPage.tsx` line 3350 | Links `/terms` near cart. Does not link `/privacy`. |
| Cookie banner | `apps/web/src/components/legal/CookieConsentBanner.tsx` | Already links `/privacy`. Will pick up new Privacy content automatically. |
| Locale strings | `apps/web/src/locales/{en,fr}/legal.ts` | Has shell strings; FR has stub for Privacy placeholder. Will need expansion. |

---

## Section 2 — Routes to add (`apps/web/src/routes/AppRoutes.tsx`)

Add these `<Route>` entries alongside lines 76–78 (the existing legal routes). All are public (no `RequireAuth`).

```tsx
const PartnerAgreementPage = lazy(() => import("@/pages/legal/PartnerAgreementPage"));
const PartnerAgreementHistoryPage = lazy(
  () => import("@/pages/legal/PartnerAgreementHistoryPage"),
);
const SubProcessorsPage = lazy(() => import("@/pages/legal/SubProcessorsPage"));
```

```tsx
<Route path="/partners/agreement" element={<PartnerAgreementPage />} />
<Route path="/partners/agreement-history" element={<PartnerAgreementHistoryPage />} />
<Route path="/partners/sub-processors" element={<SubProcessorsPage audience="partner" />} />
<Route path="/legal/sub-processors" element={<SubProcessorsPage audience="diner" />} />
```

`SubProcessorsPage` should accept an `audience` prop so the breadcrumb/back-link reflects the correct parent doc, but the table body is identical. **Do not maintain two copies of the table.**

> Note: the route `/partners` does not currently exist as a marketing landing — restaurants enter via `/restaurants` (marketing) or `/setup` (wizard). When you add `/partners/agreement`, also add a link to it from `/restaurants` so partners can find it without a marketing redesign.

---

## Section 3 — Content file scaffolding

Mirror the existing `termsContent.ts` pattern. **Do not invent a new shape** — the `TermsPage` chrome (table of contents, sticky nav, anchor scroll, mobile collapse) is reused by reading the same `TermsSection[]` shape.

Create these three new files:

- `apps/web/src/lib/legal/privacyContent.ts` — exports `PRIVACY_VERSION`, `PRIVACY_EFFECTIVE_DATE`, `PRIVACY_LAST_UPDATED`, `PRIVACY_INTRO`, `PRIVACY_SECTIONS: TermsSection[]`, plus `SUB_PROCESSORS_TABLE` (Schedule A, see Section 10).
- `apps/web/src/lib/legal/partnerAgreementContent.ts` — exports `PARTNER_AGREEMENT_VERSION`, `PARTNER_AGREEMENT_EFFECTIVE_DATE`, `PARTNER_AGREEMENT_LAST_UPDATED`, `PARTNER_AGREEMENT_INTRO`, `PARTNER_AGREEMENT_SECTIONS: TermsSection[]`, `PARTNER_AGREEMENT_HISTORY: { version: string; effectiveDate: string; supersededAt: string; summary: string }[]`.
- `apps/web/src/lib/legal/subProcessors.ts` — exports `SUB_PROCESSORS_TABLE: { name: string; service: string; region: string }[]`, plus `SUB_PROCESSORS_NOTICE_DAYS = 30`.

The canonical text of Privacy v1.1 and Partner Agreement v2.1 lives in the **mobile** repo at:
- `components/legal/privacyPolicySections.ts`
- `components/legal/partnerAgreementSections.ts`

That repo is **not** in this monorepo (this repo is `apps/web/` only). The mobile team must export the section arrays as plain JSON / text and hand them over before this work can complete. Sections 4–11 below describe everything *around* the text; Section 8 lists the substantive contract terms (numbers, SLAs, defined terms) that must survive the copy/paste so a reviewer can verify nothing dropped on the way over.

---

## Section 4 — UI surface integration map

Every place that needs to link to or record acceptance of the new docs.

### 4.1 Marketing footer
**File:** `apps/web/src/components/marketing/MarketingShell.tsx` (lines 187–195)

Add to the **Legal** column:
- `{ label: "Partner Agreement", to: "/partners/agreement" }`
- `{ label: "Sub-processors", to: "/legal/sub-processors" }`

Keep existing `Terms`, `Privacy`, `Refund Policy`, `Security` (→ `/terms#account-security`), `Accessibility`.

The Security link's anchor (`#account-security`) is load-bearing — see Section 6.

### 4.2 Diner signup — RegisterPage
**File:** `apps/web/src/pages/auth/RegisterPage.tsx` (lines 173–193)

Current state: a single checkbox asserting `ageConfirmed`. There is **no explicit ToS or Privacy acceptance**. Update copy to read (verbatim — legal-approved language):

> By continuing, you agree to our [Terms of Service](/terms) and [Privacy Policy](/privacy), and you confirm you are 18+ or have parental consent to make payments. Users under 13 may not register.

Both `/terms` and `/privacy` must be clickable. Keep the disabled-until-checked behavior on the OAuth and email buttons.

DB: write `user_profiles.consent_accepted_at = now()`, `consent_terms_version = TERMS_VERSION`, `consent_privacy_version = PRIVACY_VERSION` on first successful auth callback. The `age_consent_at` column already exists per line 73 of RegisterPage — extend, don't replace.

### 4.3 Diner public booking checkout
**File:** `apps/web/src/pages/customer/RestaurantPublicPage.tsx` (line 3350)

Already links `/terms`. Add `/privacy` next to it. No acceptance log needed — the act of paying is acceptance under §11.2.

### 4.4 Restaurant signup wizard — Step 1 Basics
**File:** `apps/web/src/components/onboarding/Step1Basics.tsx` (around the submit at line 141)

**Add** before the submit button:

> By creating a restaurant on Cenaiva you agree to our [Restaurant Partner Agreement](/partners/agreement), [Terms of Service](/terms), and [Privacy Policy](/privacy). The Partner Agreement governs fees, payouts, and your obligations as a Cenaiva-listed venue.

Wire as a required checkbox (`partnerAgreementAccepted: z.literal(true)` in the Zod schema). Pass to `signup-restaurant-owner`:

```ts
partner_agreement: {
  version: PARTNER_AGREEMENT_VERSION,
  accepted_at: new Date().toISOString(),
  ip_capture: true,    // edge fn records X-Forwarded-For
  ua_capture: true,    // edge fn records user-agent
  disclosure_text: PARTNER_AGREEMENT_SIGNUP_DISCLOSURE,
}
```

The edge fn `signup-restaurant-owner` must persist a row in `partner_agreement_consent_log` (see Section 7).

### 4.5 Restaurant onboarding — Step 8 Payment Setup
**File:** `apps/web/src/components/onboarding/Step8PaymentSetup.tsx` + `apps/web/src/components/billing/disclosures.ts`

`SAVE_CARD_DISCLOSURE` and `PUBLISH_CONFIRM_DISCLOSURE` (both exported from `disclosures.ts`) are already rendered inline and already written to `subscription_consent_log` via the publish-restaurant / save-subscription-payment-method edge fns (per CLAUDE.md hard rule on `subscription_consent_log`).

Update `disclosures.ts` to append a one-line link to the Partner Agreement under each disclosure:

```ts
export const SAVE_CARD_DISCLOSURE =
  "Your card stays on file. We won't charge anything until you publish — your 90-day free trial starts then. Then $199.99 CAD/month. Cancel anytime. See the [Restaurant Partner Agreement](/partners/agreement) for full fee terms.";
```

(Markdown rendering of `[]()` already works in the disclosure surfaces — confirm with one quick render before merging.)

### 4.6 Settings billing card
**File:** `apps/web/src/components/billing/SubscriptionCard.tsx` (also consumes `SAVE_CARD_DISCLOSURE`)

No code change beyond the disclosure update above. The same string flows through.

### 4.7 Cookie consent banner
**File:** `apps/web/src/components/legal/CookieConsentBanner.tsx`

Already links `/privacy`. Once Privacy v1.1 ships, ensure the banner copy still matches §15-equivalent (analytics consent) of the new Privacy Policy. **Read the new text and adjust the banner copy if Privacy v1.1 changed how analytics consent is described.**

### 4.8 Account → Privacy & data
**File:** `apps/web/src/pages/account/PrivacySettingsPage.tsx`

Mobile path is **Profile → Privacy → Delete Account**. Web equivalent is `/account/privacy`. The page already exists; verify that:
- The "Delete account" CTA flow language matches Privacy §3.
- A link to `/privacy` is visible at the top.
- The page references the 30-day soft-delete grace + scheduled-purge cron behavior documented in CLAUDE.md.

### 4.9 My data export page
**File:** `apps/web/src/pages/account/MyDataPage.tsx` (line 220 already links `/privacy`)

No change required.

### 4.10 Partner-facing pages
- `/restaurants` marketing page (`apps/web/src/pages/marketing/RestaurantsPage.tsx`) — add a "Partner Agreement" link near the pricing block.
- `/book-a-demo` (`BookDemoPage.tsx`) — add a "By submitting, you agree to our [Terms](/terms) and [Privacy Policy](/privacy)" line under the form.
- Dashboard footer (if there is one) — link `/partners/agreement` so owners can reach the live agreement from their dashboard.

### 4.11 Pages that must NOT link the Partner Agreement
The Partner Agreement is partner-facing only. Do not surface it on:
- `/` (HomePage)
- `/discover`, `/deals`, `/bookings`, `/notifications`
- Any `RestaurantPublicPage` (diner-facing)
- Cookie banner, register, login, phone login

---

## Section 5 — Acceptance / consent logging

Three consent records must exist after this work ships:

| Consent | Recorded by | Table | Trigger |
|---|---|---|---|
| Diner ToS + Privacy acceptance | Web client → `user_profiles` upsert | `user_profiles.consent_accepted_at`, `consent_terms_version`, `consent_privacy_version` | First successful sign-in after this ship |
| Restaurant Partner Agreement | Edge fn `signup-restaurant-owner` | `partner_agreement_consent_log` (new — see §7) | Restaurant created |
| Subscription card-save / publish | Edge fns `save-subscription-payment-method` and `publish-restaurant` | `subscription_consent_log` (exists) | Card saved + restaurant published |

Each row must capture: `user_id` or `restaurant_id`, `version`, `disclosure_text`, `ip`, `user_agent`, `accepted_at`. This is required for Quebec Law 25 / PIPEDA defensibility — the platform claims certain disclosure language was shown; the log proves it.

---

## Section 6 — Anchor IDs that must be preserved

The following anchors are referenced from elsewhere in the codebase. **Do not rename or remove them** when updating `termsContent.ts`:

| Anchor | Referenced from |
|---|---|
| `#eligibility` | `RegisterPage.tsx` line 186 |
| `#account-security` | `MarketingShell.tsx` line 192 (footer "Security" link) |
| `#cross-border-data` | `PrivacyPage.tsx` line 58 |
| `#data-rights` | `PrivacyPage.tsx` line 65 |
| `#third-party-services` | `PrivacyPage.tsx` line 72 |
| `#refunds-cancellations` | `RefundPolicyPage.tsx` lines 39, 185 |
| `#chargebacks` | `RefundPolicyPage.tsx` line 194 |

If the new Privacy / Partner Agreement want their own anchors (likely), add a `PRIVACY_ANCHORS` / `PARTNER_ANCHORS` constant export so future references stay typed.

---

## Section 7 — DB schema changes needed

Two new artifacts. Roll into a single migration.

### 7.1 `partner_agreement_consent_log` (new table)

```sql
create table public.partner_agreement_consent_log (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  agreement_version text not null,
  disclosure_text text not null,
  accepted_at timestamptz not null default now(),
  ip inet,
  user_agent text
);

alter table public.partner_agreement_consent_log enable row level security;

-- Owners can SELECT their own restaurant's rows.
create policy partner_agreement_consent_log_owner_select
  on public.partner_agreement_consent_log
  for select to authenticated
  using (
    exists (
      select 1 from public.user_restaurant_roles urr
      where urr.restaurant_id = partner_agreement_consent_log.restaurant_id
        and urr.user_id = auth.uid()
        and urr.role = 'owner'
    )
  );

-- Service-role only writes (via signup-restaurant-owner edge fn).
revoke insert, update, delete on public.partner_agreement_consent_log from authenticated, anon;

create index partner_agreement_consent_log_restaurant_idx
  on public.partner_agreement_consent_log (restaurant_id, accepted_at desc);
```

FK is `on delete restrict` to mirror `subscription_consent_log` / `restaurant_notification_log` (CRA 7-year retention — consent logs must outlive deleted restaurants).

### 7.2 `user_profiles` columns

```sql
alter table public.user_profiles
  add column if not exists consent_accepted_at timestamptz,
  add column if not exists consent_terms_version text,
  add column if not exists consent_privacy_version text;
```

Backfill is **not** required. Existing users will get their first stamp on next sign-in via the version-bump check in `useAuthCallback` (add this check in the same PR).

---

## Section 8 — Substantive terms that must appear in each document

For reviewer verification when the mobile team hands over the canonical text. If any of these are missing from the pasted content, reject the file and ask the mobile team to re-export.

### Consumer Terms of Service v1 (`/terms`)
The text in `apps/web/src/lib/legal/termsContent.ts` is already 40 sections. **Patch in place** — see Section 9 below for the diff.

### Privacy Policy v1.1 (`/privacy`)
The mobile-canonical file must include:
- Plain-language summary at the top
- **18 numbered sections** + **Schedule A** sub-processor table
- All four contact emails: `help@`, `privacy@`, `legal@`, `security@`
- **72-hour breach notification SLA** (must match Terms §19)
- **Quebec Law 25 "right of human review" clause** in §10 (or whatever section number Privacy v1.1 uses for automated decision-making)
- Delete path described as **Profile → Privacy → Delete Account** (mobile language); the web equivalent `/account/privacy` should be mentioned parenthetically
- **Voice / chat retention:** "lifetime-of-account, plus up to 90 days of safety review for sampled material" — must match the chat_messages retention shipped per CLAUDE.md
- Stripe described per the Section 11 architecture clarification below (see "Risk: Stripe Connect language")
- Cross-border transfer disclosure naming each US-based sub-processor

### Restaurant Partner Agreement v2.1 (`/partners/agreement`)
The mobile-canonical file must include:
- **24 numbered sections** + Schedule A
- Subscription Fee: **CAD $199.99 / month** (matches `PLAN_PRICE_CENTS=19999` in SettingsPage and `STRIPE_SUBSCRIPTION_PRICE_ID` swap pending per CLAUDE.md)
- Per-Booking Platform Fee: **CAD $1.00** (matches `restaurant_booking_fees` ledger + `bill-booking-fees` cron)
- Pre-Order Fee: **5.5% of subtotal** (matches the 5.5% application fee on connected-account PIs)
- Trial: **3 months** (== 90 days, matches `trial_ends_at` math) for first **500 qualifying restaurants** only
- Referral bonus: **30 days each side**, code format `CNV-OWNER-XXXXXX` (matches `apply-referral-credit` edge fn and `referral_credits` audit table)
- Cenaiva's role: **merchant of record on the platform Stripe account**, with destination charges to the restaurant's connected Stripe account net of platform + Stripe fees (see "Risk: Stripe Connect language")
- Liability cap: **the greater of 12 months of fees or CAD $5,000**, with explicit carve-outs (gross negligence, willful misconduct, IP infringement, breach of confidentiality)
- Breach notification: **72 hours**
- Anti-circumvention clause in §6 (no off-platform diversion of Cenaiva-acquired diners)
- Data Subject Request routing clause in §10.11 (5 business days to forward to `privacy@cenaiva.com`)
- 30-day notice obligation when sub-processors change (Schedule A)
- All four contact emails

---

## Section 9 — Stale text patches to `termsContent.ts` (must ship with this work)

The currently-live `/terms` page has drifted from what mobile shipped. Patch these in the same PR:

| Find | Replace with | Sections affected |
|---|---|---|
| `support@cenaiva.com` (8 occurrences) | `help@cenaiva.com` | §2, §3, §4.5, §6.5, §10.2, §10.3, §10.5, §14, §16, §30, §40 |
| `Profile > Settings > Delete Account` | `Profile → Privacy → Delete Account` | §3 |
| `Voice recordings and transcripts may be stored for up to 90 days...` | `Voice recordings, transcripts, and chat messages are stored while your account is active so you can review past conversations; up to 90 days of additional safety review applies for sampled material, after which it is deleted or anonymized. All voice and chat data is deleted upon account deletion or upon your verified request.` | §6.1 |
| `Where Cenaiva facilitates payments between diners and restaurants, payments are routed through Stripe Connect directly to the restaurant's connected Stripe account.` | **See "Risk: Stripe Connect language" below — needs legal direction before patching.** | §10.2 |
| `Stripe — Payment processing, saved payment methods, and Stripe Connect for restaurant payouts` | `Stripe — Payment processing, saved payment methods, deposit collection, invoicing, and payouts to restaurant partners via Stripe Connect (destination charges)` | §20 |
| `Cenaiva will notify affected users and applicable regulators as required by law.` | `Cenaiva will notify affected users and applicable regulators without unreasonable delay, and in any event within 72 hours of becoming aware of the breach.` | §19 |
| §40 Contact block | Add `security@cenaiva.com — Security Vulnerability Reports` line | §40 |
| §14 Account Security | Add the "Vulnerability disclosure" paragraph naming `security@cenaiva.com` and the safe-harbor clause | §14 |

Add new sections to `TERMS_SECTIONS`:
- `pre-order-fee` mention in §11.1 Pricing Transparency (add "pre-order fees, per-booking fees" to the disclosed fee list)
- Schedule A reference at the bottom: "See our [sub-processor list](/legal/sub-processors) for the current third-party processors who may handle your data."

Bump `TERMS_VERSION` from `"2026-05-21"` to `"2026-05-21.1"` (or `"v1.1"` if legal prefers semantic versions) so the version-bump check in `useAuthCallback` re-prompts existing diners.

---

## Section 10 — Schedule A (sub-processor table)

Single source of truth at `apps/web/src/lib/legal/subProcessors.ts`. Imported by Terms, Privacy, Partner Agreement, and the `SubProcessorsPage` component.

| Sub-Processor | Service Provided | Primary Region |
|---|---|---|
| Supabase | Database, authentication, edge functions | United States, with regional options (Cenaiva uses `ca-central-1`) |
| Stripe / Stripe Canada | Payment processing, saved cards, deposit collection, Stripe Connect destination charges, invoicing | Canada, United States |
| OpenAI | AI language understanding and vision (receipts) | United States |
| ElevenLabs | Text-to-speech voice synthesis | United States |
| Deepgram | Speech-to-text transcription | United States |
| Twilio | SMS messaging and one-time passcodes | United States |
| Resend | Transactional email | United States |
| Expo (EAS) | Mobile app delivery and push notifications | United States |
| PostHog | Product analytics and usage insights | United States, European Union |
| Sentry | Error monitoring and crash reporting | United States |
| Vercel | Web hosting and infrastructure | United States, global edge |
| Google LLC | Google OAuth sign-in, Google Maps Platform, on-device speech (Android), Android push | United States |
| Apple Inc. | Sign in with Apple, on-device speech (iOS), iOS push | United States |

**30-day notice rule:** when a sub-processor is added or replaced, update this file, push a release, and email the change list to all owners with active subscriptions at least 30 days before the change takes effect. Track the dispatch in `restaurant_notification_log` with template `subprocessor_change_notice`.

---

## Section 11 — Risks and open questions (require legal sign-off before merging)

### Risk: Stripe Connect language
**This is the biggest contract-vs-reality gap.**

- The original handoff says "Cenaiva is the merchant of record; restaurants handle in-venue payments through their own POS" and instructed removing Stripe Connect mentions.
- The actual platform (per CLAUDE.md hard rules) uses **Stripe Connect destination charges**: PIs are created on the connected restaurant Stripe account with `application_fee_amount` going to Cenaiva. The diner sees Cenaiva on the statement only for platform-level charges; restaurant-facilitated charges flow to the restaurant's Stripe.
- Saying simply "Cenaiva is the merchant of record" is **misleading** to acquiring banks, chargeback teams, and CRA.

**Recommended wording (pending legal sign-off):**

> Cenaiva operates as the platform of record for all transactions facilitated through the Services. Payments for restaurant-specific charges (deposits, pre-orders, post-meal pay-the-bill, event tickets) are processed by Stripe Inc. on the restaurant's behalf via Stripe Connect destination charges, with Cenaiva collecting a platform fee and the remainder settling to the restaurant's connected Stripe account. Subscription fees and per-booking platform fees are billed by Cenaiva directly. By making a payment you agree to Stripe's Terms of Service in addition to these Terms.

Flag for legal: choose one description and use it identically in Terms §10.2, Privacy §11 (or equivalent), and Partner Agreement §5 / §7. Right now the three documents will diverge if you copy the mobile-source verbatim because the mobile drafts were written assuming the simpler "merchant of record" framing.

### Risk: 18+ payment self-attestation
Register page only requires a checkbox; there is no real age gate at checkout. If a minor pays for a deposit, Cenaiva's defence is the §1 self-attestation. Legal should confirm this is sufficient under Ontario / Quebec consumer protection law.

### Risk: Quebec Law 25 right-of-human-review
The handoff says the clause "lives in Privacy §10" but we have not seen the mobile text. Verify on receipt that the clause covers: (a) the no-show risk score, (b) AI auto-tags, (c) lifetime value scoring. All three are referenced in Terms §4.5 and §6.4 — if Privacy §10 misses any, the documents disagree.

### Risk: liability cap discrepancy
- Consumer Terms §28: "the greater of CAD $100 or 12 months of fees paid"
- Partner Agreement (per handoff): "12 months of fees or CAD $5,000, whichever is greater"

These are two different caps for two different counterparties — that's fine, but the Partner Agreement must explicitly state it overrides the Consumer Terms cap **for restaurants in their capacity as partners** (and not when they personally book as diners).

### Risk: Privacy / Partner Agreement text not in this repo
The canonical text lives in the mobile repo. This handoff cannot complete until the mobile team exports both files. Add a blocking task: "Mobile team exports `components/legal/privacyPolicySections.ts` and `components/legal/partnerAgreementSections.ts` as JSON/Markdown."

### Risk: existing /refund-policy
A standalone Refund Policy page exists on web (mobile does not have one). Confirm with legal whether to keep it (and update wording to match new Terms §11.3) or to redirect `/refund-policy` to `/terms#refunds-cancellations`.

### Risk: anchor breakage
`MarketingShell.tsx` link "Security" goes to `/terms#account-security`. If the new content reorganizes Section 14, that link silently 404s to the top of the page. Section 6 lists all anchors that must survive.

---

## Section 12 — i18n

Quebec Law 25 requires the French version be made available first, at no cost, before the user can choose to be bound by the English version.

Required:
- `apps/web/src/locales/fr/legal.ts` — full chrome strings (titles, TOC labels, contact CTAs) for all three documents.
- Three new content files: `privacyContent.fr.ts`, `partnerAgreementContent.fr.ts`, plus the FR Terms content (currently English-only in `termsContent.ts`).
- Update `TermsPage.tsx`, `PrivacyPage.tsx`, `PartnerAgreementPage.tsx` to switch content arrays based on `i18n.language === "fr"`.
- For Quebec IP ranges, default to FR on first visit. Use the existing locale-detection helper; if there isn't one, gate on `navigator.language.startsWith("fr")` plus a `?lang=` override.

The mobile team must hand over French text for Privacy + Partner Agreement at the same time as English. Do not ship English-only — that creates a Law 25 violation the moment a Quebec user visits.

---

## Section 13 — SEO, sitemap, and crawling

- Add to `apps/web/public/sitemap.xml`: `/terms`, `/privacy`, `/partners/agreement`, `/partners/agreement-history`, `/partners/sub-processors`, `/legal/sub-processors`.
- Set `<meta name="robots" content="index, follow">` on all six pages.
- Set canonical URL (`<link rel="canonical">`) per page.
- OpenGraph: use the standard Cenaiva og-image; title pattern `"<doc name> — Cenaiva"`.
- Do **not** index `/partners/agreement-history` archived versions individually unless legal requires they be indexed; default to canonical-pointing the archive entries at `/partners/agreement`.

---

## Section 14 — Test checklist (before requesting legal sign-off)

- [ ] `/terms`, `/privacy`, `/partners/agreement` render with the latest version + "Last updated" date.
- [ ] All anchor links in Section 6 still scroll to the right section.
- [ ] Marketing footer renders Partner Agreement + Sub-processors.
- [ ] Register page blocks submission until both age + ToS/Privacy boxes are checked.
- [ ] Restaurant signup wizard Step 1 writes a row to `partner_agreement_consent_log` (verify with `select * from partner_agreement_consent_log order by accepted_at desc limit 1` after a test signup).
- [ ] `subscription_consent_log` row appears on card save and on publish (this is existing behavior; just verify the disclosure_text now includes the Partner Agreement link).
- [ ] `user_profiles.consent_accepted_at` stamped on first sign-in after version bump.
- [ ] Cookie banner links to `/privacy` and renders the right copy.
- [ ] `/account/privacy` mentions 30-day soft-delete grace.
- [ ] French version of all three documents renders when `?lang=fr` is appended.
- [ ] No `support@cenaiva.com` left in `termsContent.ts`, `privacyContent.ts`, or `partnerAgreementContent.ts`.
- [ ] `security@cenaiva.com` inbox is set up and routed.
- [ ] Sitemap and robots meta are correct.
- [ ] `npx tsc --noEmit -p apps/web/tsconfig.app.json` passes.

---

## Section 15 — Drift control (post-ship)

Web and mobile must stay in sync.

- When you update any document, bump the version in the content file (`PRIVACY_VERSION` etc.) and the "Last updated" date.
- Move the previous Partner Agreement version into `PARTNER_AGREEMENT_HISTORY` (rendered by `/partners/agreement-history`).
- Mirror every wording change back into the mobile source-of-truth files (`components/legal/privacyPolicySections.ts`, `components/legal/partnerAgreementSections.ts`, `app/(customer)/profile/legal/terms.tsx`) and vice versa.
- The three real Supabase tables backing these commitments — `account_merge_audit`, `subscription_consent_log`, `partner_agreement_consent_log`, `restaurant_notification_log`, `referral_credits`, `restaurant_booking_fees` — must stay healthy server-side; if any of them is dropped, the corresponding legal commitment becomes unsupportable.
- Sub-processor changes require the 30-day owner notification dispatch (Section 10).

---

## Section 16 — Contact emails (must route to real inboxes before ship)

| Email | Purpose | Status |
|---|---|---|
| `help@cenaiva.com` | General support (replaces `support@cenaiva.com`) | **Verify it routes** |
| `privacy@cenaiva.com` | Privacy rights requests, data deletion, profile correction | Verify |
| `legal@cenaiva.com` | Legal notices, IP complaints, partner-agreement appeals | Verify |
| `security@cenaiva.com` | **NEW** — vulnerability disclosure | **Set this up before merging the Terms patch — §14 promises a working address** |

---

## Section 17 — Suggested PR breakdown

To keep review scope tight, split into four PRs:

1. **`legal-1-terms-patch`** — Patch `termsContent.ts` per Section 9, add `security@cenaiva.com` references, bump `TERMS_VERSION`, add anchor constants export, add user_profiles consent columns + version-bump check on sign-in. Stale-text-only; no new pages.
2. **`legal-2-privacy-full`** — Replace `PrivacyPage.tsx` placeholder with full content from `privacyContent.ts`. Mobile team's exported text drops in here.
3. **`legal-3-partner-agreement`** — New routes, new content file, new `partner_agreement_consent_log` table + migration, wire Step 1 wizard checkbox, update `signup-restaurant-owner` edge fn.
4. **`legal-4-disclosures-and-footer`** — Update `disclosures.ts` to link Partner Agreement, update marketing footer, update RestaurantPublicPage checkout, add sub-processor pages, add sitemap entries.

Order matters: PR 1 must merge first because it changes anchors used elsewhere; PR 3 depends on PR 2 (Partner Agreement references Privacy by URL).

---

*End of handoff.*
