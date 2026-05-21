# Cenaiva Web Sister-Repo Handoff — ToS Audit + Phase 3 Builds

**Audience**: Cenaiva web team lead.
**Created**: 2026-05-21 by mobile team.
**Status**: Mobile shipped Phase 1 (ToS edits) + Phase 2 (small code fixes) + Phase 4 (TOS_COVERAGE.md) + **Phase 3 builds 3a-3e (live)**. Build 3f (Diner Referrals) was **reverted** — see Correction Notice below. Phase 3 builds 3g (Loyalty) and 3h (Events) deferred — multi-week product work. Web team needs to mirror.

**Scope of this document**: ONLY work from the ToS audit + remediation task started 2026-05-21. Does not cover any other mobile work (split-tender shipping, security hardening, etc. — those are separate threads).

---

## 🚫 Hard No-Build List (DELETED features — do not implement)

The following are NOT Cenaiva consumer features and **must not be built** on web. They were deleted from the mobile codebase on 2026-05-21 with the explicit instruction: "We have no intent of adding these to the app."

| Feature | ToS section | Why deleted | Replacement |
|---|---|---|---|
| **Wallet (prepaid balance)** | §10 (CUT) | Never planned. Mobile screen `wallet.tsx` deleted + nav row removed. | None — show only Payment Methods (Stripe saved cards). |
| **Gift Cards (issuance + redemption)** | §11.4 (CUT) | Never planned. Lived inside the deleted Wallet screen. | None. |
| **Diner Referrals (consumer-side)** | §9.3 (CORRECTED) | Never planned for diners. Mobile screen `invite.tsx` + `lib/storage/referralLimits.ts` deleted. | The ONLY referral is owner-side "Refer & Earn" (30 days subscription credit per side, Stripe-integrated, code format `CNV-OWNER-XXXXXX`). Code lives at `lib/owner/referralPolicy.ts` + `supabase/functions/_shared/referral-policy.ts` + `register-restaurant-owner` edge fn. Governed by the Restaurant Partner Agreement, NOT the consumer ToS. |

**If your web codebase has ANY of the following, delete it:**
- A consumer/diner wallet page, balance ledger, or top-up flow
- A diner gift-card purchase/redemption UI
- A diner referral page, share-link generator, or "earn $X for inviting" UI
- A `referrals` table, `diner_referral_credits` table, `user_profiles.referral_code` column, or any `qualify_pending_referral` trigger
- Edge functions named `get-my-referral-code`, `redeem-referral`, `get-my-referral-credits` (all undeployed from `exbjodmnpdiayfzrdyux`)
- Imports from a `lib/referrals/dinerReferrals.ts` equivalent

**The mobile mock data exports for these were also deleted** from `lib/mock/profileScreens.ts`: `mockGiftCards`, `mockWalletCredits`, `mockInviteRecords`, `REFERRAL_CODE`, `REFERRAL_YOU_GET`, `REFERRAL_THEY_GET`. Don't re-introduce them.

---

## ⚠️ Mock-data removal for launch (2026-05-21)

Mock data was deleted for the launch-ready surfaces while the live backend wiring stayed intact:
- **Events** (`lib/mock/events.ts` deleted entirely; types moved to `lib/events/types.ts`). Live data via `fetchUpcomingEvents` from `lib/events/getEvents.ts`. EventCard no longer shows a "Save" bookmark button (was mock-only with no backend). Web should mirror — use live event rows only.
- **Promotions** (`mockPromotions` deleted from `lib/mock/profileScreens.ts`). Live data via `fetchActivePromotions` from `lib/promotions/getPromotions.ts`. The `PromotionOffer` TYPE is kept since live mappers reference it.
- **Tickets** — no mock data existed; events.id is the booking handle for event reservations. No change.

**Web team action**: strip any equivalent mock fallbacks in your web event/promotion screens. The backend tables (`events`, `promotions`) are shared via the Supabase project; your reads should already hit live data.

---

## Context

The mobile team ran a full audit of the Cenaiva consumer Terms of Service against the actual app's functionality on 2026-05-21. We found **16 over-claims, 5 mismatches, 20 confirmed**. After the user reviewed each over-claim and made per-claim decisions, we shipped the trimmed/reworded ToS to the mobile app and queued Phase 3 builds for the genuinely-missing features the user wants to keep claiming.

Mobile + web share:
- The same Supabase project (`exbjodmnpdiayfzrdyux`)
- The same Stripe Connect setup
- The same legal text (or should — see Phase 1 row below)
- The same diner-side functionality model

This handoff doc tells the web team exactly what to mirror so behavior stays consistent across surfaces. **Sign off each row when your side ships.**

---

## Coordination notes (read first)

- **Shared DB project**: `exbjodmnpdiayfzrdyux`. Mobile applies migrations via Supabase MCP. Web should `supabase db pull` and verify reads/writes use the latest schema before deploying.
- **Shared edge functions**: most fns serve both mobile + web (e.g. `create-public-booking`, `prepare-deposit`, `refund-payment-intent`). When you deploy a fn with the same `name`, agree on which side owns the canonical code. Mobile team is pre-authorized to deploy on the prod project. Coordinate on Slack before redeploying anything shared.
- **ToS text**: should ideally live in one shared source of truth (recommend a `legal/terms-of-service.md` in a future shared repo, rendered by both clients). For now, mobile + web maintain parallel copies and **must sync on every edit**. Last-Updated dates must match across mobile + web on the same calendar day.
- **Privacy Policy**: lives at `cenaiva.com/privacy` (web team owns canonical content). The mobile ToS references it via §23. Privacy Policy audit is OUT OF SCOPE this session — recommend parallel audit by web team since the same PostHog/Vercel/account-merge over-claims likely apply.

---

## Per-item handoff

For each row: **DB** lists shared DB tables/columns. **Backend** lists shared Supabase edge functions. **Frontend** lists what web mirrors. **Sign-off** column for web lead to check.

### Phase 1 — ToS text edits (mobile shipped 2026-05-21)

| Item | Mobile change | DB | Backend | Frontend (web) | Sign-off |
|---|---|---|---|---|---|
| 1.1 | Replaced 6-section stub with full 39-section ToS at `app/(customer)/profile/legal/terms.tsx`. Cut: §10 Wallet, §11.4 Gift Cards, §6.5 Voice Deletion, §2 account-merge paragraph, §20 Vercel. Reworded: §4.4 Group Deposit (now describes one-device split-tender), §6.1 Voice retention (in-flight, not stored), §6.3 AI quality monitoring (future), §6.4 + §4.5 auto-tagging/LTV (future). Kept: §9, §8.4, §9.3, §11.5 (now §10.4) Events, §15 SMS, §18 Data Rights, §19 PostHog. | none | none | **Mirror identical text changes in your web ToS render path. Bump "Last Updated" date in sync (currently `May 21, 2026`).** Section renumbering: old §11.4 Gift Cards is GONE; old §11.5 Events became §10.4; survives-termination list in §31 updated. | ☐ |

### Phase 2 — small code fixes (mobile shipped 2026-05-21)

| Item | Mobile change | DB | Backend | Frontend (web) | Sign-off |
|---|---|---|---|---|---|
| 2a | Removed `locationAlwaysAndWhenInUsePermission` from `app.json:114`. ToS §14 commits to "when-in-use only"; the over-permission entry violated that. | none | none | **N/A** — web doesn't use Expo location plugins the same way. If web requests browser geolocation, confirm you're not requesting `permission: 'persistent'` or similar. | ☐ |
| 2b | New `lib/billing/canadianTax.ts` centralizes province → tax-label map (HST/GST/GST+PST/GST+QST). Wired into `app/booking/[restaurantId]/step6-payment.tsx` so the checkout breakdown shows e.g. "HST (13%)" for Ontario instead of generic "Tax". | none | none | **Adopt the same mapper in your web checkout.** Recommend copying `lib/billing/canadianTax.ts` verbatim into the web repo (or extract to a shared package). Required for ToS §10.1 "GST/HST/QST/PST as indicated at checkout" claim. | ☐ |
| 2c | Added refund-disclosure one-liner on cancel-confirmation Alert in `app/(customer)/bookings/[id].tsx`: "If the deposit was charged, the refund is issued to your original card and will appear on your statement within 5 business days." Only shown when `liveDepositStatus === 'charged'`. | none | none | **Add same disclosure** on web booking-detail cancel flow. Same condition: only when deposit is charged. | ☐ |

### Phase 3 — builds (✅ = mobile shipped; web team mirrors)

| Build | Status | What shipped | DB | Backend (edge fns) | Frontend (web mirror) | Sign-off |
|---|---|---|---|---|---|---|
| **3a — SMS STOP/HELP webhook (TCPA)** | ✅ MOBILE LIVE | `supabase/functions/twilio-incoming-sms/index.ts` parses inbound SMS, matches STOP/UNSUBSCRIBE/CANCEL/END/QUIT (opt-out) + START/UNSTOP/YES (re-opt-in) + HELP/INFO (reply with help). Updates `user_profiles.sms_opt_out`. Returns TwiML. | New column `user_profiles.sms_opt_out BOOLEAN NOT NULL DEFAULT false`. Migration `user_profiles_sms_opt_out`. | New fn `twilio-incoming-sms` deployed (verify_jwt=false). Existing fn `_shared/sms.ts` now gates `sendSmsOrEmail()` via `isPhoneOptedOut()`. | **Web's SMS-send paths must also gate on `sms_opt_out`** — read the column before sending. The Twilio inbound webhook is shared (one URL serves both surfaces). **Ops step (not code)**: register `https://exbjodmnpdiayfzrdyux.supabase.co/functions/v1/twilio-incoming-sms` in Twilio Console → Phone Numbers → Active numbers → Messaging webhook. | ☐ |
| **3b — Self-service data export (PIPEDA/Law 25)** | ✅ MOBILE LIVE | New `supabase/functions/export-my-data/index.ts` aggregates rows for the authenticated user from 10 canonical tables (user_profiles, reservations, reservation_deposit_payments, reservation_holds, visit_photos, saved_cards, auth_sign_in_events, post_turn_visit_requests, allergy_incidents, audit_log), uploads to `user-data-exports` Storage bucket with 24h signed URL, emails via Resend. Profile > Privacy > "Download account data" button calls it. | New Storage bucket `user-data-exports` (service-role only access). Migration `user_data_exports_bucket`. | New fn `export-my-data` deployed. Rate-limited 1/24h via `_shared/cenaiva-limits.ts`. Client helper at `lib/privacy/dataExport.ts`. | **Add "Download my data" button to your web profile/privacy page** that calls the SAME `export-my-data` edge fn (it works server-side regardless of caller). Same email-link UX. | ☐ |
| **3c — In-app refund request** | ✅ MOBILE LIVE | New `app/(customer)/refund-request/[bookingId].tsx` form (3 reason options + free text). New `supabase/functions/request-refund/index.ts` posts to new `refund_requests` table + auto-resolves duplicate-PI cases via `refund-payment-intent` + emails support@cenaiva.com for everything else. Inline link added to booking-detail screen when `deposit_status=charged`. | New table `refund_requests` (id, user_id, reservation_id, payment_intent_id, reason_code, reason_text, status, resolution_note, created_at, resolved_at) + RLS for own-read + own-insert. Migration `refund_requests_table`. | New fn `request-refund` deployed. Reuses `refund-payment-intent` for auto-cases. Client helper at `lib/refunds/refundRequests.ts`. | **Add refund-request form to web booking pages**. Same `refund_requests` table + `request-refund` edge fn. Same 3-reason picker (duplicate / failed / other). Inline link should appear on bookings where deposit was charged. | ☐ |
| **3d — Profile-tags review UI** | ✅ MOBILE LIVE | New `app/(customer)/profile/my-profile-data.tsx` shows the diner's auto-tags + no-show risk + LTV across all restaurants. Until §6.4 scoring engine ships, most diners see empty tags + zero scores. Correction request via privacy@cenaiva.com (manual link). | Reads existing `guests.tags / no_show_risk_score / lifetime_value_score / total_visits / no_show_count / last_visit_at` columns. No schema change. | New fn `get-my-profile-tags` deployed. Client helper at `lib/privacy/profileTags.ts`. | **Mirror the "What restaurants see about me" page on web profile**. Same edge fn. | ☐ |
| **3e — PostHog SDK** | ✅ MOBILE LIVE | `posthog-react-native` installed. New `lib/analytics/posthog.ts` exports `initPosthog/setPosthogEnabled/capture/identifyUser/resetIdentity`. SDK starts in disabled state and only enables when user's persisted Privacy toggle is on. New `lib/analytics/privacyPrefs.ts` persists the toggle to AsyncStorage. Boot init wired in `app/_layout.tsx`. Toggle wired in `app/(customer)/profile/privacy.tsx`. `.env.example` adds `EXPO_PUBLIC_POSTHOG_KEY` + `EXPO_PUBLIC_POSTHOG_HOST`. | none | none | **If web doesn't already use PostHog**, install `posthog-js` + init pointing at the SAME PostHog project (use same `EXPO_PUBLIC_POSTHOG_KEY` value). Wrap with the same user opt-in toggle. **If web already uses PostHog**, share the project key with mobile team. Coordinate event taxonomy doc before either side adds custom events. | ☐ |
| **3f — Diner referrals** | ❌ REVERTED | See Correction Notice above. Diner referrals are not a Cenaiva feature. Owner referrals already exist (`lib/owner/referralPolicy.ts`, Stripe-integrated, +30 days per side); they're governed by the Restaurant Partner Agreement, not the consumer ToS. | All Build 3f tables/columns/triggers DROPPED. | All 3f edge fns DELETED from project `exbjodmnpdiayfzrdyux`. | N/A — do nothing for diner referrals. Owner referrals are already shipped (and out of scope for this consumer-side handoff). | N/A |
| **3g — Loyalty + Snap Rewards** | ❌ NOT YET (next sprint) | Will flip `lib/config/loyaltyFeature.ts:isLoyaltyEnabled()` to true after building. Build tier definitions (already in `lib/loyalty/tiers.ts`), points ledger, qualifying-action events, tier-change push notifications, rewards catalog, redemption flow. Snap Rewards: award points for posting a Snap (rate-limited). Reward issuance hook for Build 3f referrals. | New tables `loyalty_points_ledger`, `loyalty_rewards`, etc. | New fns for tier qualification, reward issuance, redemption. | **Web mirrors tier badge, points ledger UI, rewards redemption flow**. Multi-week build — coordinate sprints with web team. | ☐ |
| **3h — Events & Ticketing** | ❌ NOT YET (next sprint, coordinate with mock-data removal) | New `events` + `event_tickets` schemas. Customer browse + buy flow (Stripe Connect destination charge to restaurant). Restaurant event-create UI. | New tables `events` (id, restaurant_id, name, starts_at, ends_at, price_cents, capacity, status), `event_tickets` (id, event_id, user_id, status, stripe_pi_id). | New fns: `create-event` (restaurant), `purchase-event-ticket` (diner). | **Web adds events browse + buy + restaurant create UI**. Per user note: mock event data getting removed from mobile soon — coordinate before either side launches. | ☐ |

---

## Mismatch fixes (mobile shipped, web should verify)

| Mismatch | Mobile fix | Web action |
|---|---|---|
| §10.1 generic "Tax" label | Added `canadianTaxLabel()` (2b above) | Mirror — same util |
| §10.1 unused "per-booking + pre-order fees" mention | Confirmed these don't exist as diner-facing charges; trimmed from ToS pricing-transparency list | Mirror ToS edit |
| §14 always-on location | Removed from `app.json` (2a above) | Verify web doesn't request persistent geolocation |
| §10.3 refund SLA | Added 5-business-day disclosure on cancel screen (2c above) | Mirror — same wording |
| §4.5 / §6.4 empty scoring columns | Reworded ToS to "preparing — not yet active" | Mirror ToS edit; engine TBD as Phase 3g/3d work |

---

## Files mobile created or changed (scoped to ToS audit + builds; no other work)

### Phase 1 (ToS text)
| File | Change |
|---|---|
| `app/(customer)/profile/legal/terms.tsx` | Replaced stub → full 39-section ToS |

### Phase 2 (small code fixes)
| File | Change |
|---|---|
| `app.json` | Removed `locationAlwaysAndWhenInUsePermission` |
| `lib/billing/canadianTax.ts` | NEW — province → tax label mapper |
| `app/booking/[restaurantId]/step6-payment.tsx` | Wired `canadianTaxLabel()`, added `taxProvince` state |
| `app/(customer)/bookings/[id].tsx` | Refund disclosure on cancel Alert + inline refund-request link |

### Phase 3a — SMS STOP/HELP
| File | Change |
|---|---|
| `supabase/functions/twilio-incoming-sms/index.ts` | NEW — TwiML webhook handler |
| `supabase/functions/_shared/sms.ts` | Added `isPhoneOptedOut()` gate before SMS send |
| DB migration | NEW — `user_profiles.sms_opt_out` column |

### Phase 3b — Data export
| File | Change |
|---|---|
| `supabase/functions/export-my-data/index.ts` | NEW — gathers user_id rows + uploads to Storage + emails link |
| `lib/privacy/dataExport.ts` | NEW — client wrapper |
| `app/(customer)/profile/privacy.tsx` | Wired "Download account data" row to live fn |
| DB migration | NEW — `user-data-exports` Storage bucket + service-role policy |

### Phase 3c — In-app refund request
| File | Change |
|---|---|
| `supabase/functions/request-refund/index.ts` | NEW — inserts row + auto-resolves duplicates + emails support |
| `lib/refunds/refundRequests.ts` | NEW — client wrapper |
| `app/(customer)/refund-request/[bookingId].tsx` | NEW — refund request form (reason picker + free text) |
| `app/(customer)/bookings/[id].tsx` | NEW — inline "Request a refund" link when deposit charged |
| DB migration | NEW — `refund_requests` table + RLS policies |

### Phase 3d — Profile-tags review
| File | Change |
|---|---|
| `supabase/functions/get-my-profile-tags/index.ts` | NEW — returns user's auto-tags + scores per restaurant + aggregate |
| `lib/privacy/profileTags.ts` | NEW — client wrapper |
| `app/(customer)/profile/my-profile-data.tsx` | NEW — "What restaurants see about me" screen + correction link |
| `app/(customer)/profile/privacy.tsx` | Added "What restaurants see" row pointing to the new screen |

### Phase 3e — PostHog SDK
| File | Change |
|---|---|
| `package.json` | NEW dep `posthog-react-native` |
| `lib/analytics/posthog.ts` | NEW — init / enable / capture / identify / reset helpers |
| `lib/analytics/privacyPrefs.ts` | NEW — AsyncStorage opt-in persistence |
| `app/_layout.tsx` | NEW boot effect: initPosthog + hydrate opt-in pref |
| `app/(customer)/profile/privacy.tsx` | Wired Analytics toggle to persist + setPosthogEnabled |
| `.env.example` | NEW vars `EXPO_PUBLIC_POSTHOG_KEY` + `EXPO_PUBLIC_POSTHOG_HOST` |

### Phase 3f — REVERTED (no diner referrals in Cenaiva)
| File | Change |
|---|---|
| `supabase/functions/get-my-referral-code/` | DELETED + undeployed |
| `supabase/functions/redeem-referral/` | DELETED + undeployed |
| `supabase/functions/get-my-referral-credits/` | DELETED + undeployed |
| `lib/referrals/` | DELETED |
| `app/(customer)/profile/invite.tsx` | REVERTED to pre-3f mock-only state (screen still exists but is only navigable in demo mode) |
| `app/(customer)/profile/settings.tsx` | Gated "Refer & Earn" nav row behind `isDemoModeEnabled()` so live users don't see a path to a non-existent feature |
| DB migration `revert_diner_referrals_misbuilt` | DROPped `diner_referral_credits` + `referrals` tables + `qualify_pending_referral_trg` + `user_profiles.referral_code` column |

### Phase 4 (docs)
| File | Change |
|---|---|
| `docs/TOS_COVERAGE.md` | NEW — canonical ToS-section → implementation map |
| `docs/UNHARDCODE_CHECKLIST.md` | Phase K entry |

### Phase 5 (handoff)
| File | Change |
|---|---|
| `docs/WEB_APP_HANDOFF.md` | THIS DOC |

**Scope guarantee**: every file change above is part of the ToS audit + remediation task started 2026-05-21. No unrelated mobile work is bundled here. If you see ANY change in the mobile repo's git log that's not in this table, it's NOT in scope for this handoff.

---

## Out of scope for this handoff

- **Privacy Policy** at `cenaiva.com/privacy` — web team owns; same audit recommended in parallel.
- **French ToS translation** — needs Quebec-certified translator (per ToS §34 Quebec requires FR-first availability). Web team coordinates with legal.
- **Restaurant Partner Agreement** — separate document. Mobile didn't audit; web/legal team owns.
- **External legal review of §27 limitation of liability** under Quebec CPA. Recommend external counsel sign-off before next mobile or web push.
- **Mock data removal for Events** — user noted this is happening separately. Coordinate timing before Build 3h launches.
- **App Store review compliance** for new in-app refund + data-export flows (Apple sometimes requires specific receipts).

---

## Sign-off

Web team lead, please check each row's sign-off box when your side ships. Drop a note in #cenaiva-legal-coverage Slack channel (or your equivalent) when Phase 1 mirroring is complete and Phase 2 fixes are deployed. Phase 3 sequencing is up to product priority.
