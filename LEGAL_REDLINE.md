# Legal Redline — proposed wording fixes (for review)

**Status:** PROPOSAL ONLY. Nothing in `apps/web/src/lib/legal/*` or
`RefundPolicyPage.tsx` has been changed. Read this, then tell me go / no-go (or
edit any wording) and I'll apply it.

**Goal:** make every claim on `/terms`, `/privacy`, `/partners/agreement`, and
`/refund-policy` true for the deployed web product. One shared document covers
both apps; where they differ, the text says "on the app … / on the website …".

**Decisions baked in:**
- Docs → code only. No feature builds.
- Receipt scanning = **owner-only**, on **both** apps → removed from the
  *consumer* docs (it was wrongly described as a diner feature). Optional: add it
  to the owner-side docs (flagged, not done here).
- Channel-aware wording, no new web paths. Web push + web security-email are
  noted as optional future builds only.

Legend for WHY: code evidence is `file:line`-style references from the audit.

---

# 1) Restaurant Partner Agreement  (`partnerAgreementContent.ts`)

> Bump `PARTNER_AGREEMENT_VERSION` 2.1 → **2.2**, dates → May 29 2026, add a v2.2
> history entry. The v2.1 history line stays as a record of what v2.1 said.

### §5.8 Merchant of Record & Payouts  — 🔴 CRITICAL (currently the opposite of reality)
**BEFORE:** "Cenaiva is the merchant of record for all charges … gift cards, and event tickets. **The Platform does not currently route the price of a meal, Pre-Order, or in-venue charge into a Restaurant Partner's bank account.** … If Cenaiva later introduces a payouts feature (for example, via Stripe Connect), it will be governed by an additional notice…"

**AFTER:** "Diner payments collected through the Platform — Pre-Orders and Deposits — are processed using **Stripe Connect**. The Diner pays Cenaiva's platform Stripe account, and Stripe routes your share (the food amount plus applicable tax) to **your connected Stripe account** as a destination transfer. Cenaiva retains only its platform fee plus the diner-paid processing fee. To receive these funds you must complete Stripe Connect onboarding (identity verification and bank details); a restaurant cannot be published until Stripe has enabled charges on your connected account. Cenaiva is merchant of record for its own charges to you (Subscription Fee and Per-Booking Platform Fee); for Deposits and Pre-Order amounts collected from Diners, Cenaiva acts as your agent and transfers your share as described above. In-venue payments (the meal paid at the table) are not processed by the Platform — you remain responsible for those through your own POS and merchant of record."

**WHY:** `create-public-payment-intent` sets `transfer_data.destination = stripe_account_id`; `create-stripe-account` (Connect Express); `confirm-deposit-paid` asserts destination; `stripe-refund.ts` `reverse_transfer:true`; `publish-restaurant` gates on `stripe_charges_enabled`.

### §5.1 Fee Structure  — 🔴 CRITICAL (wrong rate AND wrong payer)
**BEFORE:** "Pre-Order Fee — **5.5%** of the Pre-Order subtotal … aggregated into your monthly invoice." + "**Deposits … do not currently carry a separate Cenaiva fee.**"

**AFTER:** "- Monthly Subscription Fee — CAD $199.99/month.
- Per-Booking Platform Fee — CAD $1.00 per Confirmed Booking, reconciled each Billing Cycle.
- Platform Fee on Diner Payments — Cenaiva charges **2% of the food amount** (the Pre-Order subtotal and any Deposit, before taxes and tips) on Diner payments. **This fee is added to the Diner's total at checkout and disclosed to the Diner; it is retained by Cenaiva out of the Diner's payment and is not separately invoiced to you. You receive 100% of the food amount and applicable tax for Pre-Orders and Deposits.** Gift cards and event tickets are not offered through the Platform."

**WHY:** `_shared/stripe-fee.ts` `PLATFORM_FEE_PERCENT = 0.02`; fee is diner-paid (`computeDinerCharge`), restaurant nets food+tax; `RefundPolicyPage` shows "Platform fee (2%)". This is a **better deal for restaurants** than the doc currently states.

> Also update the §1 "Pre-Order Fee" definition and any "5.5%" mention to match.

### §4 Free Trial  — 🔴 CRITICAL (unenforced promise)
**BEFORE:** "the **first 500 qualifying restaurant partners** to register receive a complimentary Trial Period of **three (3) months from the date of account activation**. The promotional cap is **enforced server-side**…"

**AFTER:** "New restaurant partners receive a complimentary **90-day** Trial Period. The Trial begins on the day you **publish** your restaurant (make it live to Diners), not when you register or save a card. During the Trial the monthly Subscription Fee is waived."

**WHY:** `publish-restaurant` sets `trial_period_days: 90` for every publish; **no 500-cap exists anywhere** in code/migrations; trial is publish-anchored (header comment).

### §5.3 Late Payment  — 🟠 (invented day-counts)
**BEFORE:** "If payment is not received **within 7 days** … suspend … Continued non-payment **beyond 30 days** may result in termination…"

**AFTER:** "If a payment fails, Stripe automatically retries on its standard schedule and we email you; access continues while retries are pending. If the subscription becomes unpaid or canceled, your restaurant is unpublished and access suspended until payment is resolved. Continued non-payment may result in termination under Section 14."

**WHY:** `stripe-webhook` `handleSubscriptionUpsert` unpublishes on `unpaid`/`canceled`; leaves `past_due`/`incomplete` during retries. No 7/30-day logic in code.

### §5.6 / §14.1 Cancellation & deletion timing  — 🟠
**BEFORE:** "Upon cancellation, your access will **remain active until the end of the current paid Billing Cycle**."

**AFTER:** "Removing your restaurant **unpublishes it immediately** (it stops taking new bookings right away) and schedules your Stripe subscription to cancel at the end of the current Billing Cycle — you are not charged again after that cycle. For **30 days** after removal your restaurant is recoverable; contact help@cenaiva.com to restore it within that window. After the recovery window, data is deleted on a rolling schedule, subject to legal retention. Subscription Fees already charged for the current cycle are non-refundable."

**WHY:** `delete-restaurant` immediately sets `is_published=false` + `deleted_at` + `cancel_at_period_end:true`; `recover-restaurant` 30-day grace.

### §5.7 Pre-order fee reversal & dispute fee  — 🟠 (contradicts code + §11.3)
**BEFORE:** "Where a Pre-Order is fully refunded … the corresponding **Pre-Order Fee is reversed**…" + "Where the chargeback is caused by your action … Cenaiva will **recover the Stripe dispute fee ($15) from you**…"

**AFTER:** "When a Pre-Order or Deposit is refunded, the refunded amount (food and tax) is returned from your connected Stripe account via a reversed transfer. The diner-paid platform and processing fees are not refundable. Where a chargeback related to your restaurant is lost, the transferred amount (food and tax) is reversed from your connected account." **— KEEP the existing dispute-fee wording unchanged**: the $15 is recovered from the restaurant when the chargeback is its fault, and absorbed by Cenaiva only on a verified Cenaiva error. (This is the intended policy. The CODE must be updated to match it — see code item #6 — but the words stay.)

**WHY:** every refund path uses `refund_application_fee:false` (no fee reversal), so the "Pre-Order Fee is reversed" sentence must go; the food+tax transfer is already clawed back on a lost dispute. The **$15 owner-pays policy is correct in the contract but NOT yet implemented in code** → it's a code fix (item #6), not a wording change.

### §5.9 Referrals  — 🟠 (disabled; wrong benefit + fake code format)
**BEFORE:** "signs up using your referral code (format **CNV-OWNER-XXXXXX**), both you and the referred restaurant receive **30 additional days** of free Platform access…"

**AFTER:** "Cenaiva may offer an owner referral program. **The program is not active at this time.** When active, you and a referred restaurant that signs up with your referral code each receive a **one-time credit of CAD $199.99** (about one month of Subscription Fee) applied to your Stripe subscription. Referral codes are issued by Cenaiva. Referral abuse (self-referrals, fake businesses, chained signups to evade billing) forfeits credits and may result in termination."

**WHY:** `publish-restaurant` "referral disabled"; `apply-referral-credit` grants `amount_off: 19999` coupon; real code format is `{NAME4}{RND3}`, not `CNV-OWNER-`.

### §2 / §10.3 Risk & lifetime-value "visible to partners"  — 🟡
**BEFORE:** lists "no-show risk scores and lifetime value estimates" as live dashboard/booking data shared with partners.

**AFTER:** keep guest **tags** (those are shown), but soften the scores: "Cenaiva-generated guest tags, and — as these features roll out — no-show-risk and lifetime-value signals." (i.e. don't assert the scores are currently displayed).

**WHY:** `crm_guest_rows` RPC + `CrmPage`/`useReservations` don't surface either score (computed on `guests` but not rendered).

> **Not changed here (flagged below):** §1 "Confirmed Booking" 24h rule + "no-shows are billable" — the *code* is the likely bug; weakening the contract would forfeit revenue.

---

# 2) Privacy Policy  (`privacyContent.ts`)

> Bump `PRIVACY_VERSION` 1.1 → **1.2**, dates → May 29 2026.

### §4 Voice/chat retention  — 🟠 (the policy contradicts itself; §4 vs §9)
**BEFORE (§4):** "We **do not retain** voice recordings or transcripts in our own systems beyond the active conversation … Chat messages may be retained briefly … and are **not persisted across sessions** in identifiable form."

**AFTER (§4):** "We do not store raw audio of your voice. We **do store the text transcript** of your voice and chat conversations with Cenaiva AI **while your account is active**, so you can review past conversations; sampled material may be kept up to an additional 90 days for safety/quality review, then deleted or anonymized. AI providers process your input solely to return a response and do not train on it. You may request review or deletion at privacy@cenaiva.com (completed within 30 days). All voice and chat data is deleted when you delete your account."

**WHY:** `cenaiva-orchestrate`/`cenaiva-chat` persist transcripts to `chat_messages` keyed to the user. This now matches §9 (which was already correct). *(The "deleted on account deletion" line is kept but flagged for code verification below.)*

### Receipt/photo scanner — remove from consumer Privacy  — 🟡 (owner-only feature)
**BEFORE (§2):** "… allergy incident reports, in-app messages to support, **and any image you submit to the receipt or photo scanner.**"
**BEFORE (§4):** the "**Receipt and photo scanning.** Images you submit … sent to OpenAI's vision model…" paragraph.

**AFTER:** remove both from the diner-facing Privacy Policy (receipt scanning is an owner/business tool, not a diner feature). *Optional:* document the owner receipt-scanner's image handling in the Partner Agreement §10 instead (flagged, not done here).

**WHY:** per your correction — receipt scanning is owner-only, present on both apps; it does not belong in consumer privacy text.

### §3 + §12 New-device alert channel  — 🟡
**BEFORE:** "the new-device security alert you receive **by push or email**…"
**AFTER:** "the new-device security alert (by push or email on the mobile app, and shown as an in-app alert on the website)…"
**WHY:** web shows `NewDeviceAlertBanner` (in-app), no web push/email.

### §11 + §13 Wallet references — remove  — 🟡
**BEFORE (§11):** "any **prepaid wallet balance** are forfeited at deletion — withdraw or use any remaining balance first…"
**BEFORE (§13):** "users who make payments, **hold a wallet balance, or buy event tickets** must be 18…"
**AFTER (§11):** drop the wallet sentence. **AFTER (§13):** "users who make payments must be 18 or have express parental authorization."
**WHY:** no wallet / no consumer event-ticketing exists anywhere.

### §2 / §11 Surveys — remove the word
**BEFORE:** §2 "… **survey responses** …"; §11 "delete or scrub … orders, **surveys**, Snaps…"
**AFTER:** drop "surveys" from both (no survey feature exists). Keep "chats" in §11 (flagged for verification).
**WHY:** no survey table/fn/UI anywhere.

> §7/§8 provider lists are already complete (Twilio, Resend, Google, Apple included) — no change; used as the model for ToS §18 below.

---

# 3) Consumer Terms of Service  (`termsContent.ts`)

> Update INTRO from "the Cenaiva **mobile application** and related services" → "the Cenaiva mobile application, **the Cenaiva website**, and related services". Bump `TERMS_VERSION`/date → May 29 2026. Keep section `id`s stable so deep links keep working.

| § | BEFORE (key phrase) | AFTER | WHY |
|---|---|---|---|
| **2** | "email/password, phone number (OTP), or **Google** OAuth" | "email/password, phone number (one-time passcode), Google, **or Apple**" | Apple OAuth is live (`LoginPage`/`RegisterPage`) |
| **4.1** | "Reservations are **requests and are subject to confirmation by the restaurant**." | "When you complete a booking (including any required deposit/pre-order), your reservation is **confirmed immediately** — it is not held for separate restaurant approval." | `create-public-booking` `p_status:'confirmed'` |
| **4.3** | alerts "notify you via **push notification**" | "notify you — by push on the app, and by **SMS and an in-app alert on the website**" | `_shared/notify-me-sms.ts`; no web push |
| **4.4** | "Invited guests receive a **secure link** to contribute their portion" | "Where available, a booking party may split the deposit across more than one card; each contributor **enters their own card during checkout on the booking device**, processed independently through Stripe. Not enabled on all bookings." | `featureFlags` OFF; `SplitTenderPaymentForm` is one-device |
| **4.5** | risk score "**is visible to restaurant partners** and may be used … to require a deposit" | "Where available, this score **may be made available** to restaurants to help manage reservations, including whether to require a deposit. Cenaiva does not use it to deny platform access." | scores not surfaced in dashboard |
| **6.1** | "Voice recordings, transcripts, and chat messages are stored…"; "An **in-app notice will be displayed before your first voice interaction**" | align storage wording with Privacy §4 ("no raw audio; transcripts stored while active; +90d sampled"); voice-notice → "On the mobile app, a notice is shown before your first voice interaction; you can disable voice in settings." | matches code; web has no first-use notice (optional build flagged) |
| **6.4** | "Cenaiva uses automated **AI systems** … generate guest tags and a lifetime value score. These … are **visible to restaurant partners**." | "Cenaiva uses automated **systems** … generate guest tags and a lifetime-value estimate. **Tags are shared** with a restaurant when you book/visit; lifetime-value and no-show-risk signals are computed and **may be made available as these features roll out**." | tagging is rule-based, not LLM; scores not displayed |
| **6.6** | entire "Receipt and Photo Scanning" section | **Remove** (owner-only feature; not a diner feature) | per your correction |
| **7.1** | post-visit "**push notification** or in-app prompt inviting you to share a **photo** or review" | "a notification (push on the app; in-app on the website) inviting you to share a review, and where available a photo" | web does review prompts, not photo upload |
| **9.1** | "**Cenaiva offers** a loyalty program with tiered benefits" | "Cenaiva **may offer** a loyalty program. It is **not generally available yet**; you can join the waitlist (§9.2)." | only a waitlist exists |
| **9.3** | "Cenaiva may offer referral incentives for inviting new users" | add: "This is **not currently offered to diners**." | only owner referrals exist |
| **10** | entire **Wallet** section | **Remove** + scrub wallet refs in §1, §3, §11.3, §13, §32 survival list | no wallet anywhere |
| **11.4** | entire **Gift Cards** section | **Remove** | no gift cards anywhere |
| **11.3** | "subject to **that restaurant's refund policy, which will be displayed at the time of booking**"; "**Wallet top-ups** are non-refundable" | "Deposits/pre-orders are fully refundable (food + tax) when you cancel before you're seated, when the restaurant seats you, or when the restaurant cancels. Platform + processing fees are non-refundable, as disclosed at checkout. See cenaiva.com/refund-policy." Remove wallet line. | no per-restaurant window (`cancellation_hours` dropped); fees kept |
| **11.5** | "restaurants to list events and **sell tickets** … Payment processed through Stripe … Tickets are linked to your account" | "Where an event is bookable, you reserve a spot like a standard reservation, subject to availability/any deposit. **Paid ticketing is not currently offered.** Cenaiva will facilitate refunds where an event is cancelled by the restaurant." | only free event reservations |
| **13/14** | "security alert via **push notification or email**"; "**temporarily lock your account** after failed attempts" | channel-qualify: "(push/email on the app; in-app alert on the website)"; "our authentication provider may rate-limit or lock sign-in after repeated failures" | web = in-app banner; lockout via Supabase, not custom |
| **15** | mobile permission list (mic/camera/photo/location/push) | "On the mobile app, Cenaiva may request Microphone, Camera/Photo, Location (when-in-use), and Push. **On the website, voice uses your browser's microphone permission, maps use approximate location with permission, and notifications come by SMS and in-app alerts rather than push.**" | web has no native permission/push model |
| **17** | "Cenaiva uses **Expo Notifications**…" | "On the mobile app, Cenaiva uses Expo Notifications for push. **On the website, Cenaiva does not send push**; time-sensitive updates come by SMS and in-app alerts." | no web push (no Expo in web) |
| **18** | cross-border: "OpenAI, ElevenLabs, Deepgram, Stripe, PostHog, Sentry, and AWS" | add **Twilio, Resend, Google, Apple** (match Privacy §8) | those also transfer data to US |

> §7.2 (visit photos), §7.4 (surveys), §8.1 (Snaps), §8.4 (Snap rewards) are
> already hedged ("where this feature is available" / "may"), so they read
> acceptably as-is — minimal/no change needed. §3 account-deletion: remove the
> wallet bullet; the "data cannot be restored" promise stays (flagged for the
> chat-deletion verification below).

---

# 4) Refund Policy page  (`RefundPolicyPage.tsx`)

**§2 "What gets refunded":**
**BEFORE:** "fully refundable when the restaurant marks you seated, when you cancel **under the restaurant's policy**, or when the restaurant cancels on you."
**AFTER:** "fully refundable when you cancel **before you're seated**, when the restaurant marks you seated, or when the restaurant cancels on you."

**§3 "Full refund of base" list:**
**BEFORE:** "You cancel **within the restaurant's refund window**"
**AFTER:** "You cancel **before you're seated** (or before the reservation reaches a final status)"

**WHY:** `cancel-reservation` has no per-restaurant window; `cancellation_hours` column was dropped (`migrations/20260528160000`). The 2%/processing example, 5–10 business-day timing, and 5-business-day dispute SLA all match code — **no change**.

---

# 5) Version / date stamps (mechanical)

- `TERMS_VERSION` → 2026-05-29; `TERMS_LAST_UPDATED` → "May 29, 2026"
- `PRIVACY_VERSION` → 1.2; dates → May 29 2026
- `PARTNER_AGREEMENT_VERSION` → 2.2; dates → May 29 2026; + v2.2 history entry summarizing the fee/payouts/trial/referral corrections
- `SUB_PROCESSORS_LAST_REVIEWED` → "May 29, 2026" (no row changes)

---

# 6) NOT fixed here — real code issues (your call, separate)

These are *code*, not wording. Two must NOT be "fixed" by weakening a promise.

1. **Account deletion must actually delete chat/voice** — Privacy §11 + Terms §6.1
   promise it; `delete-account` doesn't touch `chat_messages`. → verify the DB
   cascade; if missing, add deletion (privacy-law obligation).
2. **$1 booking fee wrongly voided on no-shows / short-notice cancels** vs Partner
   §1 "no-shows are billable" — trigger has no 24h logic → lost revenue.
3. **Risk/LTV scores not shown to partners** — if you want the docs literally
   true, surface them in the dashboard (a build; not earmarked).
4. **Stale code comments** ("5.5%/94.5%/2.2%") in `create-public-payment-intent`
   + `stripe-refund.ts` — cheap cleanup; logic is already correct.
5. **`pause-subscription`/`resume-subscription` fns exist** vs §5.5 "no pause" —
   verify they're not owner-wired.
6. **Charge the $15 dispute fee to the owner** — ✅ **CODE WRITTEN (Option A),
   pending deploy + live test.** `stripe-webhook` `handleChargeDispute()` now, on a
   LOST dispute, bills CAD $15 to the restaurant's subscription via
   `stripe.invoiceItems.create` (idempotent on `dispute_fee_${dispute.id}`), in
   addition to the existing food+tax transfer reversal. Confirmed against Stripe
   docs: destination-charge dispute fees hit the platform balance and are not
   auto-routed, so this code recovery is required (not a dashboard setting).
   Contract §5.7 wording stays as-is. Skips if no `stripe_customer_id` / paused /
   deleted (logs for manual). Not a Stripe dashboard task.

# 7) Operational (not code)

- **French translation** of all four docs by a Quebec-certified translator (Law 25)
  — highest legal-risk operational gap; placeholder stays until done.
- Optional future **web builds** (not earmarked): web push, web new-device email
  security alert.
- `TOS_COVERAGE.md` is a stale **mobile** map — mark it mobile-only and/or create
  a web coverage map.
