# Mobile legal docs — implementation handoff

**For:** mobile app developer (React Native / Expo).
**From:** web shipped 2026-05-21 in `apps/web/`.
**Source of truth for all legal text:** the web content files listed below — do **not** retype the text. Import / copy the strings exactly.

---

## What got shipped on web (3 docs + 4 supporting pages)

| Doc | Web route | Source file |
|---|---|---|
| Consumer Terms of Service | `/terms` | `apps/web/src/lib/legal/termsContent.ts` |
| Privacy Policy v1.1 | `/privacy` | `apps/web/src/lib/legal/privacyContent.ts` |
| Restaurant Partner Agreement v2.1 | `/partners/agreement` | `apps/web/src/lib/legal/partnerAgreementContent.ts` |
| Sub-processor list (diner-facing) | `/legal/sub-processors` | shares data from `subProcessors.ts` |
| Sub-processor list (partner-facing) | `/partners/sub-processors` | same data, partner-voice copy |
| Partner Agreement version history | `/partners/agreement-history` | data in `partnerAgreementContent.ts` |
| Sub-processor data array | (used by all three above) | `apps/web/src/lib/legal/subProcessors.ts` |
| Support / Help page | `/support` | `apps/web/src/pages/support/SupportPage.tsx` |

### App store submission URLs

The `/support` page is the public Support URL for both store listings:

- **App Store Connect** → App Information → **Support URL**: `https://cenaiva.com/support`
- **Google Play Console** → App content → **Support email**: `help@cenaiva.com`, **Support website**: `https://cenaiva.com/support`
- In-app Settings → "Help & Support" row should either `mailto:help@cenaiva.com` or open a webview to `/support`. Either works — same canonical address.

**Effective date:** May 21, 2026 across all three.

---

## Critical policy decisions (don't drift from these)

1. **Minimum diner age = 16.** Terms §1 and Privacy §13 both say "16 and over" and "between 16 and 18 with parental consent". Mobile signup copy must match. Web's RegisterPage currently says *"Users under 16 may not register"*.
2. **Payment age = 18+** (for wallet, event tickets, paid features). Unchanged.
3. **All emails moved off `support@cenaiva.com`** → now `help@`, `privacy@`, `legal@`, `security@`. No mobile string should reference `support@`.
4. **Account deletion path:** *Profile → Privacy → Delete Account*. Not "Profile → Settings".
5. **Voice/chat retention:** stored while account is active, deleted on account deletion. Up to 90 days for sampled safety-review material. Not the old "90 days" blanket.
6. **Subscription price:** CAD $199.99/month (Partner Agreement §5.1). Per-booking fee: CAD $1.00. Pre-order fee: 5.5%.
7. **Sub-processor list is a contractual commitment.** Under Privacy §7 and Partner Agreement §10.5, adding a new sub-processor requires 30 days' notice. Adding rows to `subProcessors.ts` later isn't a free code change.

---

## Reusable data files (copy directly into mobile)

These files contain **structured data only** (no JSX, no Tailwind, no react-router) — they will work in React Native unchanged after you remove the `import type { LegalSection } …` line and inline the type locally.

### From `apps/web/src/lib/legal/subProcessors.ts`

```ts
export const SUB_PROCESSORS_NOTICE_DAYS = 30;
export const SUB_PROCESSORS_LAST_REVIEWED = "May 21, 2026";

export type SubProcessor = { name: string; service: string; region: string };

export const SUB_PROCESSORS: SubProcessor[] = [
  /* 13 entries — Supabase, Stripe, OpenAI, ElevenLabs, Deepgram, Twilio,
     Resend, Expo (EAS), PostHog, Sentry, Vercel, Google LLC, Apple Inc. */
];
```

Copy this verbatim. One source of truth across web + mobile is required by the 30-day notice obligation.

### From `apps/web/src/lib/legal/{terms,privacy,partnerAgreement}Content.ts`

Each exports:
- `*_VERSION`, `*_EFFECTIVE_DATE`, `*_LAST_UPDATED` (string constants)
- `*_INTRO` (string with `\n\n` paragraph breaks)
- `*_SECTIONS: LegalSection[]` (array of `{ id, number, title, body }`)
- Privacy adds: `PRIVACY_PLAIN_LANGUAGE_SUMMARY: string[]` (5 bullets shown as a callout above §1)
- Partner Agreement adds: `PARTNER_AGREEMENT_HISTORY: { version, effectiveDate, summary }[]`

**Body grammar (used by all three docs):**
- Paragraphs separated by blank lines (`\n\n`).
- Bullet lines start with `- ` at column zero.
- No markdown bold, no sub-headings inside a body, no inline links.

This is **plain text** — no special rendering needed. Any paragraph + bullet renderer works.

---

## Mobile rendering — what to build

You need **3 screens** (mirroring web's 3 user-visible docs) + **2 supporting screens**.

| Mobile screen | Suggested route name | Renders |
|---|---|---|
| `TermsOfServiceScreen` | `legal/terms` | `TERMS_SECTIONS` |
| `PrivacyPolicyScreen` | `legal/privacy` | `PRIVACY_PLAIN_LANGUAGE_SUMMARY` callout + `PRIVACY_SECTIONS` + Schedule A table |
| `PartnerAgreementScreen` | `partners/agreement` | `PARTNER_AGREEMENT_SECTIONS` + Schedule A table + link to history |
| `SubProcessorsScreen` | `legal/sub-processors` | `SUB_PROCESSORS` as a list/table |
| `PartnerAgreementHistoryScreen` | `partners/agreement-history` | `PARTNER_AGREEMENT_HISTORY` rows |

### Section renderer (single shared component)

Build one `<LegalSection>` component used by all three docs. Pseudocode:

```tsx
function LegalSection({ section }: { section: LegalSection }) {
  const blocks = parseLegalBody(section.body); // same parser as web
  return (
    <View>
      <Text style={styles.h2}>{section.number}. {section.title}</Text>
      {blocks.map((b, i) =>
        b.type === "paragraph"
          ? <Text key={i} style={styles.p}>{b.text}</Text>
          : <View key={i}>
              {b.items.map((item, j) =>
                <View key={j} style={styles.bulletRow}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.bulletText}>{item}</Text>
                </View>
              )}
            </View>
      )}
    </View>
  );
}
```

**Copy `parseLegalBody` from** `apps/web/src/components/legal/LegalSection.tsx` — pure function, ~40 lines, no DOM dependencies, works in React Native unchanged.

### Sub-processor table

React Native has no native `<table>`. Use a `FlatList` or a column-styled `View`:

```tsx
<View style={styles.tableHeader}>
  <Text>Sub-Processor</Text>
  <Text>Service</Text>
  <Text>Region</Text>
</View>
{SUB_PROCESSORS.map(sp => (
  <View key={sp.name} style={styles.tableRow}>
    <Text>{sp.name}</Text>
    <Text>{sp.service}</Text>
    <Text>{sp.region}</Text>
  </View>
))}
```

### Table of contents (optional)

Web has a sticky right-sidebar ToC. On mobile this doesn't fit. Either:
- Skip the ToC entirely (recommended — long-form legal docs are scrolled, not jumped on mobile), or
- Add a collapsed "Jump to section" `<Picker>` / bottom sheet at the top.

### Cross-doc links inside bodies

Bodies contain inline references like `cenaiva.com/terms`, `cenaiva.com/privacy`, `cenaiva.com/partners/sub-processors`. Web renders these as plain text (they don't auto-link to internal routes). Mobile can do the same — these are fine as plain text, OR you can post-process with a regex to make them deep links into your nav stack. Either is acceptable.

---

## Mobile-specific wiring (in addition to the screens)

These are **not** in the web ship but are mobile-side obligations from the same docs:

### 1. Onboarding age gate
Mobile signup must enforce 16+. Web currently just shows a checkbox; mobile should match or do better. Recommendation: ask date of birth at signup (existing field — already in the Privacy Policy under "Account information") and block signup for under-16.

### 2. Voice consent notice (Terms §6.1, Privacy §4)
**Before the first voice session**, show an in-app modal: "We capture your microphone audio and send a transcript to our AI providers (OpenAI, Deepgram, ElevenLabs). Voice data is stored while your account is active and deleted on account deletion. Tap 'Continue' to consent."
Web records this in a consent log; mobile should write the same row. Table: `voice_consent_log` (if it doesn't exist, ask backend to create it).

### 3. Card-save disclosure (already shipped on web as `SAVE_CARD_DISCLOSURE`)
Mobile's wallet / saved-card flow must show the same disclosure text inline above the "Save card" button. Source: `apps/web/src/components/billing/disclosures.ts`. Records into `subscription_consent_log` (table already exists).

### 4. Account deletion path
Settings → Privacy → Delete Account (matching the Terms wording). The flow must:
- Detach Stripe payment methods.
- Cancel active subscriptions.
- Forfeit any wallet balance (warn the user first — recommend they spend it).
- Show a "this is irreversible" final confirm.

### 5. Push notification preferences
Per Privacy §3, in-app notification preferences should live at **Profile → Notifications** with per-category toggles (booking, security, marketing, post-visit, etc.).

### 6. Per-restaurant marketing toggle
**Profile → Restaurant Communications.** Each restaurant the diner has booked appears as a row with marketing on/off. Opting out doesn't affect transactional messages for active reservations.

### 7. Partner Agreement acceptance (for restaurant-facing mobile flows)
If you're building the **partner** side of the mobile app (restaurant owner / staff), the onboarding wizard must:
- Show the v2.1 Partner Agreement.
- Have an "I accept" checkbox before "Continue".
- Write a row to `partner_agreement_consent_log` capturing: restaurant_id, accepted_version="2.1", accepted_at=now(), accepted_by_user_id, ip_address (best-effort on mobile), device_user_agent.

**This table does not exist on the backend yet** — it was flagged as a follow-up. Coordinate with backend before shipping the mobile partner signup.

---

## French translation gap

All three docs ship in **English only** on web. Quebec Law 25 and the Charter of the French Language require consumer-facing legal docs in French for Quebec users. Mobile cannot solve this alone — it needs a certified Quebec translator to produce the French body text. Until then:
- Mobile can use the same FR translation gap workaround as web: a banner saying *"La traduction française de ce document est en cours. Pour toute question, contactez legal@cenaiva.com."*
- Do NOT machine-translate contract language.

---

## Hard contractual commitments mobile must honor

These are promises baked into the doc text. Breaking them is a legal exposure, not just a bug.

| Promise | Doc reference | What mobile must do |
|---|---|---|
| 30 days' notice before adding a sub-processor | Privacy §7, Partner §10.5 | Don't add to `SUB_PROCESSORS` without ops coordinating notice first |
| 72-hour breach notification | Privacy §12, Partner §10.9 | Mobile shouldn't need to do anything direct, but the in-app notification system must be capable of pushing a breach notice fast |
| Voice data deletion within 30 days of request | Terms §6.5, Privacy §4 | Provide an in-app "Delete voice data" button at Profile → Privacy that calls the deletion endpoint |
| Human review of automated decisions (Quebec Law 25) | Privacy §10 | Provide a "Request human review" link in any UI that surfaces a no-show risk score, lifetime value, or AI-generated tag |
| Free trial = first 500 restaurant partners only | Partner §4 | Server-side enforcement, not mobile; but mobile signup copy must NOT promise a free trial unconditionally — show it gated on backend response |

---

## Verification checklist for the mobile ship

- [ ] Three legal screens render the canonical text without truncation
- [ ] Sub-processor screen shows all 13 rows
- [ ] Plain-language summary (Privacy) appears as a styled callout above §1
- [ ] Schedule A table renders inline at the bottom of Privacy + Partner Agreement
- [ ] Account deletion path matches the doc: Profile → Privacy → Delete Account
- [ ] Age gate enforces 16+ on signup
- [ ] Voice consent modal shows before first voice session, records to `voice_consent_log`
- [ ] No `support@cenaiva.com` strings anywhere in the app
- [ ] Voice data deletion button exists at Profile → Privacy
- [ ] "Request human review" CTA exists wherever an AI score is displayed to the diner
- [ ] (Partner side only) Agreement acceptance checkbox + `partner_agreement_consent_log` write

---

## File-by-file pointer

When in doubt, **read the web source**:

- `apps/web/src/lib/legal/termsContent.ts` — Terms canonical text
- `apps/web/src/lib/legal/privacyContent.ts` — Privacy canonical text
- `apps/web/src/lib/legal/partnerAgreementContent.ts` — Partner Agreement canonical text
- `apps/web/src/lib/legal/subProcessors.ts` — Sub-processor data
- `apps/web/src/components/legal/LegalSection.tsx` — `parseLegalBody` parser (copy into mobile)
- `apps/web/src/components/legal/SubProcessorsTable.tsx` — table layout (rewrite for RN)
- `apps/web/src/pages/legal/*.tsx` — reference renderings (do NOT copy verbatim; they use react-router + Tailwind)
- `apps/web/src/components/billing/disclosures.ts` — `SAVE_CARD_DISCLOSURE` + `PUBLISH_CONFIRM_DISCLOSURE` strings (reuse verbatim)

Questions: legal@cenaiva.com.
