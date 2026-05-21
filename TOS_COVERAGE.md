# Cenaiva Consumer Terms of Service — Coverage Map

Canonical mapping from each Terms-of-Service section to its implementation status, source files, owner, and last-verified date. Update this file every time the ToS changes or a related feature ships.

**ToS source of truth**: `app/(customer)/profile/legal/terms.tsx` (mobile).
**Last audit**: 2026-05-21 (full audit run against shipped functionality).

Legend:
- ✅ BUILT — feature works as ToS describes
- 🟡 PARTIAL — feature exists but doesn't fully match ToS claim
- 🔵 FUTURE — ToS describes feature as "preparing for future release"
- ❌ NOT YET — feature listed in plan as a Phase 3 build; not live

---

## Section coverage

| § | Topic | Status | Source files | Notes |
|---|---|---|---|---|
| 1 | Eligibility | ✅ BUILT | `app/(auth)/signup.tsx` | Age checks at signup |
| 2 | Account Registration | ✅ BUILT | `app/(auth)/login.tsx`, `lib/services/phoneAuth.ts`, `lib/services/oauth.ts` | Email/password, phone OTP, Google OAuth all live. Account merge removed from ToS (was over-claim). |
| 3 | Account Deletion | ✅ BUILT | `app/(customer)/profile/settings.tsx:508-521`, `lib/services/accountSecurity.ts:218-246`, `supabase/functions/delete-account/index.ts` | Profile > Settings path live; hard-delete + Stripe detach confirmed. |
| 4.1 | How Bookings Work | ✅ BUILT | `app/booking/[restaurantId]/*` | Standard booking flow |
| 4.2 | Reservation Holds | ✅ BUILT | `lib/booking/useReservationHold.ts`, `supabase/functions/create-reservation-hold/index.ts` | 30-min TTL, deposit PI mint, auto-release |
| 4.3 | Availability Alerts | ✅ BUILT | `lib/availability/alerts.ts` (approx), push delivery via `supabase/functions/_shared/expo-push.ts` | |
| 4.4 | Split-Tender Payment | ✅ BUILT | `components/booking/SplitTenderCheckout.tsx`, `lib/stripe/runSinglePaymentSlot.ts` | One-device pass-the-phone (ToS reworded from "secure link to invited guests" to match actual feature) |
| 4.5 | Automated Risk Scoring | 🔵 FUTURE | (none yet) | ToS marks as "preparing"; engine not built. Staff CRM has empty columns. |
| 5 | Restaurant Responsibility | ✅ BUILT | (descriptive section, no code) | |
| 6.1 | Cenaiva AI providers | ✅ BUILT | `supabase/functions/cenaiva-orchestrate/`, `cenaiva-small-prompt/`, `elevenlabs-tts/`, `deepgram-live-token/`, `lib/cenaiva/voice/useMobileTranscription.ts` | OpenAI + ElevenLabs + Deepgram + Apple/Google native speech all integrated. Voice NOT persistently stored (ToS reworded from "90 days" to "processed in-flight"). |
| 6.2 | AI Accuracy/Hallucinations | ✅ BUILT | (disclaimer text only) | |
| 6.3 | AI Quality Monitoring | 🔵 FUTURE | (none) | ToS marks as "may add in future" |
| 6.4 | AI Auto-Tagging | 🔵 FUTURE | `app/(staff)/crm.tsx:205-217` columns exist | ToS marks as "preparing — not yet active"; engine TBD |
| 6.5 | Receipt + Photo Scanning | ✅ BUILT | `supabase/functions/scan-receipt/index.ts` | OpenAI Vision |
| 7.1 | Post-Visit Photo Prompts | ✅ BUILT | `lib/postVisit/push.ts`, `supabase/migrations/20260520200000_cron_post_turn_review_prompts.sql` | Push fires after dining session |
| 7.2 | Visit Photos + Story Filters | ✅ BUILT | `lib/snaps/visitPhotosApi.ts`, `app/(customer)/discover/snaps/[restaurantId].tsx`, `supabase/migrations/20260513140000_visit_photos_snap_columns.sql` | |
| 7.3 | Restaurant Reviews | ✅ BUILT | `app/booking/[restaurantId]/review.tsx` | |
| 7.4 | Surveys | 🟡 PARTIAL | (in-app prompts exist; survey UI minimal) | |
| 8.1 | Snaps Social Posts | ✅ BUILT | `lib/snaps/visitPhotosApi.ts`, `supabase/migrations/20260513140000_*.sql` | Public read on `visit_photos` confirmed |
| 8.2 | Content Moderation | ✅ BUILT | (manual via legal@cenaiva.com) | |
| 8.3 | IP Complaints | ✅ BUILT | (manual via legal@cenaiva.com) | |
| 8.4 | Snap Rewards | ❌ NOT YET | `lib/config/loyaltyFeature.ts` flag = false | Build 3g — needs loyalty system live first |
| 9 | Loyalty Program | ❌ NOT YET | `lib/loyalty/tiers.ts`, `lib/config/loyaltyFeature.ts` (flag off) | Build 3g — multi-week product work |
| 9.2 | Loyalty Waitlist | ❌ NOT YET | (depends on 9) | |
| 9.3 | Restaurant Partner Referrals (owner-only) | ✅ BUILT | `lib/owner/referralPolicy.ts`, `supabase/functions/_shared/referral-policy.ts`, `register-restaurant-owner` edge fn | Owner-side "Refer & Earn" program: 30 days subscription credit per side (referrer + referred). Code format `CNV-OWNER-XXXXXX`. Stripe-integrated (subscription trial extension at signup). Diner referrals are NOT a Cenaiva feature — Build 3f was reverted (see WEB_APP_HANDOFF.md correction notice). |
| 10 | Wallet / Prepaid Balance | 🚫 NOT BUILDING | n/a — deleted 2026-05-21 | Never a planned Cenaiva feature. Mobile `wallet.tsx` + all mock exports deleted. Web team: do NOT build this. |
| 11.4 | Gift Cards | 🚫 NOT BUILDING | n/a — deleted 2026-05-21 | Was inside the deleted Wallet screen. Never a planned Cenaiva feature. Web team: do NOT build this. |
| 10.1 | Pricing Transparency | ✅ BUILT | `app/booking/[restaurantId]/step6-payment.tsx`, `lib/stripe/stripeFee.ts`, `lib/billing/canadianTax.ts` (new) | Deposit, service fee, processing fee, provincial tax all shown |
| 10.2 | Payment Processing + Saved Cards | ✅ BUILT | `lib/stripe/stripeSavedCards.ts:19-32`, `supabase/functions/create-public-payment-intent/index.ts` | Only id/brand/last4/expMonth/expYear stored; Stripe = source of truth |
| 10.3 | Refunds + Cancellations | ✅ BUILT | `lib/booking/holdApi.ts:252-256`, `supabase/functions/refund-payment-intent/`, `supabase/functions/request-refund/`, `app/(customer)/refund-request/[bookingId].tsx`, `app/(customer)/bookings/[id].tsx` cancel-confirm + inline refund link | Build 3c shipped: in-app refund request form + auto-resolve for duplicate PIs + support email queue + 5-business-day SLA disclosure. |
| 10.4 | Events + Ticketing | ❌ NOT YET | (no schema, no UI) | Build 3h |
| 10.5 | Chargebacks | ✅ BUILT | (descriptive) | |
| 11 | Restaurant Communications + Guest Data Sharing | ✅ BUILT | `app/(staff)/guests/*` reads guest data; opt-in/out via `app/(customer)/profile/notifications.tsx` | |
| 12 | User Conduct | ✅ BUILT | (enforcement via support@cenaiva.com + abuse handling) | |
| 13 | Account Security + Device Monitoring | ✅ BUILT | `supabase/migrations/20260517194451_auth_sign_in_events_and_alert.sql`, `supabase/functions/notify-new-device-sign-in/index.ts`, `lib/auth/lockoutPolicy.ts`, `supabase/migrations/20260517192645_audit_log_for_sensitive_tables.sql` | All three: sign-in events, new-device alerts, lockout, audit log |
| 14 | Device Permissions | ✅ BUILT | `app.json:23-67, 86-163` | Mic/Camera/Photo/Location-when-in-use/Push. Background location REMOVED 2026-05-21. |
| 15 | SMS Communications | ✅ BUILT | `supabase/functions/_shared/sms.ts`, `supabase/functions/twilio-incoming-sms/`, `user_profiles.sms_opt_out` column | Build 3a shipped: STOP/UNSUBSCRIBE → `sms_opt_out=true`, START/UNSTOP → re-subscribe, HELP → reply with support info. `sendSmsOrEmail()` gates on the opt-out flag. **Ops: Twilio Console webhook URL registration is a one-time manual step.** |
| 16 | Push Notifications | ✅ BUILT | `supabase/functions/_shared/expo-push.ts`, `package.json:62 expo-notifications` | |
| 17 | Cross-Border Data Transfers | ✅ BUILT | (legal text; matches actual third-party list) | Vercel removed; PostHog marked "integration in progress" |
| 18 | Your Data Rights | ✅ BUILT | `supabase/functions/export-my-data/`, `supabase/functions/get-my-profile-tags/`, `app/(customer)/profile/privacy.tsx`, `app/(customer)/profile/my-profile-data.tsx`, `lib/privacy/dataExport.ts`, `lib/privacy/profileTags.ts` | Build 3b shipped data portability (Download my data → JSON via signed Storage URL). Build 3d shipped "What restaurants see about me" + correction-request path. |
| 19 | Third-Party Services | ✅ BUILT | (legal text matches integrations) | Vercel removed; PostHog flagged as in-progress |
| 20 | Analytics + Error Monitoring | ✅ BUILT | `app/_layout.tsx` Sentry init + PostHog boot; `lib/analytics/posthog.ts`; `lib/analytics/privacyPrefs.ts`; `app/(customer)/profile/privacy.tsx` analytics toggle | Build 3e shipped: PostHog SDK installed + init + opt-in toggle wired. SDK starts disabled and only enables on user consent. Sentry stays always-on for crash reporting per ToS §19. |
| 21 | AI Usage Limits | ✅ BUILT | `supabase/functions/_shared/cenaiva-limits.ts`, `lib/errors/friendlyError.ts` rate-limit codes | |
| 22 | App Store Terms | ✅ BUILT | (legal text only) | |
| 23 | Privacy | ✅ BUILT | (reference to cenaiva.com/privacy) | |
| 24 | Intellectual Property | ✅ BUILT | (legal text only) | |
| 25 | Service Availability | ✅ BUILT | (legal text only) | |
| 26 | Disclaimer of Warranties | ✅ BUILT | (legal text only) | |
| 27 | Limitation of Liability | ✅ BUILT | (legal text only) | External counsel review recommended for §27 Quebec CPA enforceability before next push |
| 28 | Indemnification | ✅ BUILT | (legal text only) | |
| 29 | Dispute Resolution | ✅ BUILT | (legal text only) | |
| 30 | Force Majeure | ✅ BUILT | (legal text only) | |
| 31 | Termination | ✅ BUILT | (legal text only) | Survives-termination list updated for renumbering |
| 32 | Changes to These Terms | ✅ BUILT | (legal text only) | |
| 33 | Governing Law | ✅ BUILT | (legal text only) | |
| 34 | Language / Langue | 🟡 PARTIAL | i18n EN ready; FR ToS translation pending Quebec-certified translator | |
| 35 | Severability | ✅ BUILT | (legal text only) | |
| 36 | Assignment | ✅ BUILT | (legal text only) | |
| 37 | Waiver | ✅ BUILT | (legal text only) | |
| 38 | Entire Agreement | ✅ BUILT | (legal text only) | |
| 39 | Contact | ✅ BUILT | (legal text only) | Support/Privacy/Legal email addresses live |

---

## Phase 3 build status

Track in `docs/WEB_APP_HANDOFF.md` for the parallel web-team work.

| Build | Covers § | Status |
|---|---|---|
| 3a SMS STOP/HELP webhook + sms_opt_out column | §15 | ✅ SHIPPED (2026-05-21) |
| 3b Self-service data export | §18 | ✅ SHIPPED (2026-05-21) |
| 3c In-app refund request UI | §10.3 | ✅ SHIPPED (2026-05-21) |
| 3d Profile-tags review UI | §18 + §6.4 | ✅ SHIPPED (2026-05-21) |
| 3e PostHog SDK | §19 + §20 | ✅ SHIPPED (2026-05-21) |
| 3f Diner referrals | §9.3 | ❌ REVERTED (2026-05-21) — diner referrals are not a Cenaiva feature. Owner referrals already exist (`lib/owner/referralPolicy.ts`) — Stripe-integrated +30 days per side. |
| 3g Loyalty + Snap Rewards | §9 + §8.4 | ❌ NOT YET (multi-week product work) |
| 3h Events + Ticketing | §10.4 | ❌ NOT YET (coordinate with mock-data removal) |

---

## How to use this document

1. **Before publishing any ToS change**: open this file alongside the ToS edit. Update affected rows.
2. **After shipping a Phase 3 build**: flip the corresponding row from ❌/🔵 to ✅, update Source files + Notes.
3. **During quarterly legal review**: re-run the audit against this map; flag any 🟡 PARTIAL rows that have drifted.
4. **When the Privacy Policy is audited next** (out of scope this session): create a parallel `docs/PRIVACY_COVERAGE.md`.
