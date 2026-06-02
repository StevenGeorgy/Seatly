# MOBILE_PARITY_SPEC.md

**What this is:** a web → mobile parity spec. The **web app + shared Supabase backend are the source of truth**; this document lists where the **mobile app** is missing, wrong, or behind, and exactly how to fix each item on mobile.

**Analyzed:**
- **Web (source of truth):** `Seatly-16/apps/web/src`
- **Backend (canonical / deployed, shared by both apps):** `Seatly-16/supabase`
- **Mobile (the app you'll fix):** `mobile-seatly-v2`

**The single most important framing:** the **backend is shared**. Both apps call the same Supabase project (`exbjodmnpdiayfzrdyux`) — same database, RPCs, edge functions, RLS. So **all the heavy Stripe/booking/security logic is already enforced for mobile for free.** The real work is on the **mobile client**: calling the backend the same correct way the web app does, and building the features mobile is missing.

> ⚠️ Mobile ships its OWN copy of `supabase/functions/` that has **drifted** from canonical (e.g. a stale `delete-account` with a banned JWT shim). Treat `Seatly-16/supabase` as the truth. Do not deploy the mobile repo's backend copy.

**Scope excluded (by request):** UI/layout/styling, Hey Cenaiva voice parity, split-tender (not in use).

---

## TL;DR — priority order (fix these first)

### 🔴 P0 — correctness / money bugs (silent, real-world impact)
1. **Mobile fee math is the stale 5.5% model** (`lib/stripe/stripeFee.ts`) — should be **2% of FOOD (Option B)**. Wrong price displayed; structurally wrong. → §1
2. **Mobile never sends `tax_cents`** to the payment-intent fn → backend takes 2% commission on the tax too (restaurant under-paid), AND pre-order holds fail with `amount_mismatch` 400. → §1, §6
3. **Owner/staff cancel bypasses `cancel-reservation`** (uses `update_staff_reservation_status('cancelled')`) → **deposit/pre-order refunds are silently skipped**, no reverse_transfer, no notification. Violates a CLAUDE.md hard rule. → §2, §5, §12
4. **No-hold + activity deposit paths are broken** — they read a PaymentIntent id that `prepare-deposit` never creates → always throw "Could not start the deposit charge." → §1
5. **`guest_phone` can be `null`/malformed** at booking → `create-public-booking` rejects with 400. → §6
6. **Account deletion uses a stale, divergent edge fn** (no refund-first, soft-delete, banned `decodeJwtPayload`, breaks CRA/Law 25 retention). → §7

### 🟠 P1 — missing features / wiring
7. **Map screen is mock-only** in production (no real fetch). → §11
8. **Order detail is mock-only** (always 404s for real users). → §11
9. **Pay-the-bill screen calls a DELETED edge fn** (`stripe-charge-order`) → dead button. → §3, §11
10. **Restaurant onboarding** has no real flow — registration calls **non-existent edge fns**. → §9
11. **Search/Discover filters** are largely missing/dead (no date/time/party/availability, no `is_published` gate). → §10
12. **Consent logging** (`diner_consent_log`) is never written by mobile. → §8
13. **Account merge** is entirely absent on mobile. → §7

### 🟡 P2 — owner dashboard + legal polish
14. Deposit-tiers editor missing; floor plan read-only; menu categories don't persist; CRM bypasses the canonical RPC; no event-attendees / promo-redemption lists. → §12
15. Legal docs are a stale revision; sub-processor list drifted; no refund-policy page. → §8

> ✅ **Already at parity (no work):** the core diner journey — discover→book→deposit/preorder→confirm→bookings→modify/cancel(diner)→reviews/snaps→notifications→account/saved-cards→Hey Cenaiva — is fully wired to the real backend on mobile. Holds + hold timer, availability, atomic write RPCs, subscription billing wiring, expenses/receipts, saved cards, and all server-side security are done.

---

## §1 — Stripe: Deposits & Payment Intents (🔴 P0)

**Fee model (Option B):** canonical `supabase/functions/_shared/stripe-fee.ts` → `computeDinerCharge(foodCents, taxCents)`: `cenaivaFee = max(round(food × 0.02), 1)`; diner total grossed up for Stripe; `application_fee = cenaivaFee + processingFee`; refund returns food+tax only. Web mirror: `apps/web/src/lib/stripe-fee.ts` (re-exports `packages/mobile-shared/src/pricing/dinerCharge.ts`).

| Item | Web (truth) | Mobile (current) | Fix |
|---|---|---|---|
| **Fee math** | 2% of food, 2-arg `(food, tax)`, `appFee = cenaivaFee+processingFee` (`apps/web/src/lib/stripe-fee.ts`) | **OLD 5.5% of base**, 1-arg `computeDinerCharge(baseCents)`, `CENAIVA_APPLICATION_FEE_PERCENT = 0.055` (`lib/stripe/stripeFee.ts:39,67,82`); tax folded into commission base; missing the `+processingFee` term | Replace `lib/stripe/stripeFee.ts` with a faithful port of the canonical Option-B impl (ideally consume `@cenaiva/mobile-shared`). Update callers `step6-payment.tsx:228`, `orders/pay/[orderId].tsx:112` to the 2-arg signature. Delete stale 5.5% header + `ABSORB_FEE_THRESHOLD_CENTS`. |
| **`tax_cents` to PI** | sends food as `amount_cents` + **`tax_cents`** separately (`StripePaymentForm.tsx:415-416`) | sends combined base, **no `tax_cents`** (grep: `tax_cents` appears nowhere in mobile) | Add `tax_cents?: number` to `CreateHoldPaymentIntentRequest` (`lib/booking/holdApi.ts:198`); in `step6-payment.tsx:434` send `amount_cents = food` and `tax_cents = round(tax*100)`. Without this the server commissions the tax (restaurant under-paid) and pre-order holds 400. |
| **No-hold / activity deposit** | PI-first: `prepare-deposit` → create PI with `deposit_payment_ids:[rowId]` → confirm (`SplitTenderPaymentForm.tsx`, `DepositPayPage.tsx:125`) | calls `prepareDeposit({reservation_id,payers})` then reads `payment.stripe_payment_intent_id` which **`prepare-deposit` never sets** → throws "Could not start the deposit charge" (`step7-confirmation.tsx:442-460`, `activity/index.tsx:440-453`) | Make these PI-first: prepare-deposit → create PI **with `deposit_payment_ids:[rowId]` + `tax_cents`** → PaymentSheet → `confirmDepositPaid`. OR route them through the holds path (bind via `hold_id` + `confirm-hold-paid`). Remove the invalid "read PI off prepare-deposit response" assumption. |

**Note:** the diner is *charged* the correct amount on the **holds happy path** because the server recomputes via `computeDinerCharge` and binds via `hold_id`. The fee bug is (a) wrong displayed total, and (b) real money loss via the missing tax split. RDP insert paths are compliant (mobile never client-inserts).

**Backend = free / Mobile-client change:** charge amount, app-fee, transfer_data, metadata binding, RDP RLS = **backend (free)**. Fee display, `tax_cents` split, no-hold deposit flow = **mobile-client changes**.

---

## §2 — Stripe: Refunds & Cancellation Pipeline (🔴 P0)

Canonical: `cancel-reservation` refunds base (food+tax) via `_shared/stripe-refund.ts:45-46` (`reverse_transfer:true`, `refund_application_fee:false`). Owner cancels verify a role in `user_restaurant_roles` and require `actor:"owner"` → `cancellation_reason="Cancelled by restaurant"`.

| Path | Web | Mobile | Fix |
|---|---|---|---|
| **Diner cancel** | `cancel-reservation` (no actor → diner) | ✅ correct — `lib/booking/publicBookingApi.ts:764-825` | none (copy at `bookings/[id].tsx:371` still says "5.5%" — cosmetic) |
| **Owner/staff cancel** | `cancel-reservation` w/ `actor:"owner"` (`useReservations.ts:441-449`) | 🔴 **BYPASS** — `reservations.tsx:1208` → `updateStaffReservationStatus('cancelled')` → legacy RPC raw-flips status, **NO refund / reverse_transfer / notification / cancellation_reason** | Add `cancelReservationAsOwner(id)` posting to `cancel-reservation` with `{reservation_id, actor:"owner"}` + Bearer; use it at `reservations.tsx:1208`. Keep `update_staff_reservation_status` for `seated`/`completed`/`no_show` only. |
| **Solo modify-down refund** | server refunds `|delta|` (reverse_transfer) | ✅ server does it; client displays (`step2-time.tsx:545-579`) | none functional; "5.5%" copy at `step2-time.tsx:552,557,579` is stale |
| **Dispute/chargeback fee recovery** | `stripe-webhook` (clawback + $15 fee) | n/a (webhook) | none — backend-shared |

**This is the #1 owner-side defect.** Backend can't save you here: the legacy RPC is a *sanctioned* entry point that simply doesn't do refunds — the protection is choosing `cancel-reservation`.

---

## §3 — Stripe: On-bill / Booking Fees / Subscriptions (🟠 P1)

| Path | Backend/Web | Mobile | Fix |
|---|---|---|---|
| **Post-meal pay-the-bill** | `stripe-charge-order` + `close-bill` **DELETED** (commit `198e8d2`); web has **no** such flow | 🔴 **live screen calling the deleted fn** — `orders/pay/[orderId].tsx` → `lib/orders/chargeOrder.ts:32` invokes `stripe-charge-order` (404s) | **Remove** the pay-the-bill route + `chargeOrder.ts` + the `pay/[orderId]` screen registration (`orders/_layout.tsx:14`) + nav (`bookings/[id].tsx:579`). Scrub stale doc refs (`useAutoIncome.ts:9-10`, `expenses.tsx:311`, `home.tsx:1112`). |
| **`mark-order-paid`** | pre-order-at-booking only (`RestaurantPublicPage.tsx:2498`) | unused | n/a (only add if mobile wants pre-order-at-booking; mirror web — order row + `mark-order-paid` after PI clears) |
| **$1 per-confirmed-booking fee** | `restaurant_booking_fees` trigger + `bill-booking-fees` cron | not involved (correct) | none |
| **Owner subscription** ($199.99/mo, 90-day trial, auto-tax, auto-pause) | `save-subscription-payment-method`, `update-subscription-payment-method`, `get-next-bill-preview`, `pause/resume/cancel/restart-subscription` | ✅ **near-parity** — `lib/owner/saveSubscriptionPaymentMethod.ts`, `billing.ts`, `subscriptionLifecycle.ts`, wired into `(staff)/payment-method`, `subscription-plan`, `billing-history` | none required. Optional: add `create-billing-portal-session` if a hosted portal is wanted. Stale "5.5% pre-order" line in `lib/legal/partnerAgreementContent.ts:481`. |

---

## §4 — Booking: Holds, Hold Timer, Availability, Modify, Guards (✅ mostly parity)

| Item | Status | Notes |
|---|---|---|
| **Holds lifecycle** (create/update/heartbeat/cancel/confirm/convert) | ✅ MATCH name-for-name | `lib/booking/holdApi.ts` + `useReservationHold.ts` mirror `apps/web/src/hooks/useReservationHold.ts`, incl. recreate-on-drift + auto-retry |
| **Hold timer / countdown / expiry** | ✅ PRESENT & wired | `useReservationHold.ts:436-565` (AppState-gated ticker, heartbeat applies returned `expires_at`, 410→expired); UI mounted in `app/booking/[restaurantId]/_layout.tsx` (`HoldTimerBanner` + `HoldExpiredDialog`); `step6` re-acquires expired hold before pay |
| **Availability** | ✅ LIVE | `publicBookingApi.ts:318/578` calls `get_available_slots_cached` + `restaurant_available_dates`; mock only for demo seed restaurants. (Booking flow only — Discover is NOT wired; see §10) |
| **Atomic write RPCs** | ✅ never direct-INSERT | goes through `create-reservation-hold`→`convert_reservation_hold_to_reservation` / `create-public-booking`→`book_reservation`; `diner_double_book` 409 mapped |
| **modify-reservation** (delta-up/down) | ✅ MATCH behavior | thin caller (`publicBookingApi.ts:639`); only stale "5.5%" copy |

**Only issue here:** the fee-model display drift (same as §1). Charge is correct; display/copy wrong.

---

## §5 — Security: Auth & Authorization (✅ backend-enforced; one real bug)

| Item | Status | Notes |
|---|---|---|
| ES256 `getUser` + Bearer token | ✅ OK | mobile uses supabase-js session token via `functions.invoke` / `getSession()` (`lib/supabase/client.ts:105`, `publicBookingApi.ts:212`) |
| No body-trusted user id | ✅ OK | identity only via header token; server derives `user_profile_id` from verified session |
| Trust-boundary `restaurants` cols | ✅ OK | mobile only writes non-boundary cols (`hours_json`, `settings_json`, `cover_photo_url`…); lifecycle cols via edge fns; direct writes would 403 anyway |
| `actor:"owner"` + no raw cancel | 🔴 **RISK** | **same bug as §2** — owner cancel uses `update_staff_reservation_status('cancelled')` (`reservations.tsx:1208`) instead of `cancel-reservation` w/ `actor:"owner"`. Backend does NOT protect (legacy RPC is sanctioned-but-refundless). **Fix per §2.** |

Everything except the cancel path is backend-enforced and mobile already complies. **Recommendation:** audit the mobile repo's stale `supabase/functions/` copies (at least `delete-account`) — prefer canonical.

---

## §6 — Security: Input Validation & Rate Limiting (🔴 two conformance bugs)

All edge fns use `parseJsonBody(req, ZodSchema)` (`_shared/validation/*`). Backend fails closed, so these manifest as **failed bookings**, not security holes.

| Item | Server requires | Mobile sends | Fix |
|---|---|---|---|
| **Pre-order hold tax split** 🔴 | `(amount_cents + tax_cents) === hold.total_amount_cents` for cart holds (`create-public-payment-intent:580-582`) | `amount_cents = food+tax+deposit`, `tax_cents` absent, AND hold `total_amount_cents = food only` (`step4-preorder.tsx:203-206`) → **`amount_mismatch` 400** on any pre-order | Send `amount_cents = food`, `tax_cents = round(tax*100)` (`step6`); set hold `total_amount_cents = round((subtotal+tax+deposit)*100)` (`step4-preorder.tsx:205`) — mirror web |
| **`guest_phone`** 🔴 | `E164Phone` **required, non-nullable** (`booking.ts`) | `guest_phone: phone || null` (`step7-confirmation.tsx:400`); booking gate only checks party-size, not contact; raw-text fallback at `confirm.tsx:358` | Gate Continue on `normalizePhoneInput(phone) !== null` (+ valid email); drop the raw-text fallback; never send `null` |
| Quantity clamp 🟡 | `cart_items.quantity` ≤ 50 | floors at 1, not capped (`publicBookingApi.ts:402`) | clamp ≤ 50 client-side |
| Confirmation code 🟡 | `/^[A-Z0-9-]{4,20}$/` uppercased | verify uppercase/trim before cancel/modify | minor |
| 429 handling | per-user buckets (booking/hold/cancel/modify); per-IP for the 4 anon Stripe fns | ✅ handled gracefully (`friendlyError.ts:345`, `holdApi.ts:106`) | none |

---

## §7 — Auth & Profile Flows (🔴 deletion + 🟠 merge)

| Item | Web | Mobile | Fix |
|---|---|---|---|
| Google/Apple/phone/email sign-in | browser OAuth + OTP | ✅ native OAuth (`lib/services/oauth.ts`), OTP (`phoneAuth.ts`) — parity (drops WhatsApp OTP, adds `prepare-phone-login`) | optional: add WhatsApp transport |
| Saved cards (Branch A/B, list, self-heal) | `stripe-setup-intent`, `stripe-list-methods` | ✅ same fns (`stripeSavedCards.ts`, `saveSubscriptionPaymentMethod.ts`); branches not collapsed | none — backend-shared |
| **Account deletion** 🔴 | canonical `delete-account` → atomic `delete_diner_account` RPC, **refund-first**, email-confirm, hard-delete, CRA de-identify | calls a **stale mobile-repo copy**: no email-confirm, banned `decodeJwtPayload` shim, no refund/cancel of upcoming, **soft**-delete, hard-deletes payments/reservations (breaks CRA/Law 25). Client sends **no body** (`accountSecurity.ts:218`) | **Delete the mobile-repo `delete-account` copy**; rely on canonical. Update `deleteAccount()` to send `{ email_confirmation: <auth email> }` (add type-to-confirm UI); surface returned `cancelled_reservation_ids`/`refund_total_cents` |
| **Account merge** 🟠 | `AuthCallbackPage.tsx:68-144` detect dup → `merge-diner-accounts` edge fn | **MISSING** (only promised in legal copy) | Port duplicate-detection into `app/auth-callback.tsx`; call existing `merge-diner-accounts`; re-establish session after merge |
| Profile completeness | `on_auth_user_created` trigger + `RequireCompleteProfile` gate | trigger shared ✅; **no pre-checkout field gate** → OAuth/phone diner can book without name/email/phone | add `isProfileComplete(name,email,phone)` gate on booking entry → route to `profile/edit.tsx` |

---

## §8 — Legal / T&C / Consent / Disclosures (🟠 P1 + 🟡)

| Item | Web | Mobile | Fix |
|---|---|---|---|
| **Consent logging** 🔴 | `diner_consent_log` immutable rows via `log-diner-consent` edge fn (`RegisterPage.tsx:101-133`) | only stamps mutable `user_profiles.tos_version` (`AuthContext.tsx:311-326`); **never calls `log-diner-consent`** → no auditable PIPEDA/Law 25/CASL trail | After consent, POST `log-diner-consent` with terms + privacy rows (`consent_type`, `agreement_version`, `disclosure_text`, `source`) using the verified JWT, fire-and-forget. Table + fn already exist (shared). |
| Fee disclosure copy | "Platform fee (2%)" + non-refundable note | "Cenaiva service fee (5.5%)" / "Platform fee (5.5%)" (`step6-payment.tsx:550,609`, `i18n/locales/en.ts:329-339`, fr) | change all "5.5%" strings to "2%" (paired with §1 math fix) |
| Legal docs | Terms `2026-05-30`, Privacy `1.2`, Partner `2.2`, dedicated `/refund-policy` | Terms `2026-05-21`, Privacy `1.1`, Partner `2.1`, **no refund-policy page** (`lib/legal/versions.ts`) | re-port the 4 content files verbatim from web into `lib/legal/`, bump `versions.ts` (re-triggers consent gate — intended); add a refund-policy screen |
| Sub-processor list | AWS, Supabase "Canada, United States", Stripe | drifted — lists **Vercel**, Supabase "United States", "Stripe Canada" (`privacyContent.ts:267`) | reconcile with legal owner; this is a contractual 30-day-notice list |
| Store legal (privacy/support URL, in-app delete) | `/privacy`, `/support`, in-app delete | URLs present (`legalLinks.ts`); in-app delete present; no `SUPPORT_URL`/`REFUND_POLICY_URL` const | add the two URL consts; ensure in-app doc versions match the hosted URLs |

> ⚠️ Web-side bug to fix separately: `RegisterPage.tsx:60-61` logs consent against hardcoded stale versions (`2026-05-21`/`1.1`) while rendering `2026-05-30`/`1.2`.

---

## §9 — Restaurant Onboarding — Full Flow (🟠 P1, largely MISSING on mobile)

### The canonical WEB flow (build mobile to match this)
**0. Account + restaurant row:** `signup-restaurant-owner` edge fn (invoked at Step-1 submit). `is_active:true`, honors `force_new`/`restaurant_id`, never overwrites a published draft, uniform 200 for existing email. Side effects on fresh insert: default Dinner shift (all 7 days 17:00–22:00, turn 90, slot 30, advance 3650, `max_covers:null`), default section + floor_plan, seeds `tables`, upserts `user_profiles(role:owner)` + `user_restaurant_roles(owner, is_primary)`.

**8-step wizard** (`apps/web/src/pages/auth/SetupPage.tsx`, route `/setup`):
1. **Basics** (`Step1Basics.tsx`) — name, business type, address (Google Places → city/prov/country/**postal**/lat/lng), GST/HST #, cuisine, E.164 phone, walk-ins, dietary tags, description. → invokes `signup-restaurant-owner`.
2. **Hours** (`Step2Hours.tsx`) — per-day open/close → `restaurants.hours_json` + sync active `shifts.days_of_week`/times.
3. **Floor/tables** (`Step3FloorPlan.tsx` + `TablesListEditor.tsx`) — label/capacity(1–30)/shape → deactivate existing `tables`, insert new set.
4. **Booking rules** (`Step4BookingRules.tsx`) — turn time 60/90/120 → UPDATE active `shifts` row.
5. **Menu** (`Step5Menu.tsx`) — categories (one `is_pricing_tier_source`) + ≥3 priced tier items → upsert `menu_categories`/`menu_items`, set `restaurants.price_range`.
6. **Photos+theme** (`Step6Photos.tsx`) — **cover photo required** + logo + theme → upload to **`event-media`** bucket (5MB cap), UPDATE `cover_photo_url`/`logo_url`/`settings_json.theme`.
7. **Deposit policy** (`Step7DepositPolicy.tsx`) — tiers `{min_party_size, amount_per_person_cents}` → `restaurants.deposit_tiers` JSONB.
8. **Payments & publish** (`Step8PaymentSetup.tsx`):
   - **Connect:** `create-stripe-account` (Express, CA, capability `transfers` only, self-syncs `stripe_charges_enabled`…) → `create-account-link` (hosted URL).
   - **Subscription card:** `stripe-setup-intent` **Branch A** (`restaurant_id` → restaurant customer) → confirm → `save-subscription-payment-method` (attaches PM + pushes tax address + `ca_gst_hst`; stamps `payment_method_attached_at`; no sub yet).
   - **Publish:** `publish-restaurant` — requires Partner Agreement, enforces `tax_address_incomplete` (needs `postal_code`), creates the subscription with `trial_period_days:90` + `automatic_tax`, flips `is_published`. Gate trigger `restaurants_publish_gate`: `stripe_charges_enabled` + `cover_photo_url` + `is_active` + (`subscription_status IN (trialing,active)` OR `payment_method_attached_at`). **$199.99 CAD/mo, 90-day trial anchored to publish day.**

### Mobile state + fixes
- 🔴 **Mobile registration calls edge fns that DO NOT EXIST** in canonical: `register-restaurant-owner`, `create-onboarding-link` (`lib/services/restaurantRegistration.ts`, `lib/owner/connectOnboarding.ts`). These fail.
- `app/(auth)/owner-register.tsx` only stuffs name/cuisine into auth metadata — **never creates a `restaurants` row**.
- ✅ Post-registration editors exist: hours (`saveRestaurantHours.ts`), tables (`floor.tsx`), menu (`MenuContext`), profile/cover (`saveRestaurantProfile.ts`), publish (`lib/owner/publishRestaurant.ts` — correctly calls canonical `publish-restaurant`).
- 🟡 Stale: "5.5% application fee" (`connect-onboarding.tsx`); "3 months" trial (`trialPolicy.ts`) vs canonical **90 days**.

**Fixes (per step, edge fns to call):** (1) replace registration with **`signup-restaurant-owner`** (Bearer; full Step-1 body incl. **postal_code**); (2–7) wire the steps to the same tables/RPCs as web; (8) replace `create-onboarding-link` with **`create-stripe-account` → `create-account-link`** (mobile deep-link return), create the restaurant customer via **`stripe-setup-intent` Branch A** → **`save-subscription-payment-method`**, and add the `partner_agreement_*` fields + `tax_address_incomplete` handling to the already-correct `publish-restaurant` call. Fix the "5.5%"/"3 months" copy.

---

## §10 — Search & Discovery Filters (🟠 P1)

**Structural miss:** mobile Discover is **not connected to the availability pipeline** and **does not gate by `is_published`**.

| Filter | Web | Mobile | Fix |
|---|---|---|---|
| `is_published` catalog gate | `.eq('is_active',true).eq('is_published',true)` (`useRestaurant.ts:156`) | only drops `is_active===false` client-side (`fetchRestaurants.ts:153`) → **shows unpublished restaurants** | add `.eq('is_published',true).eq('is_active',true)` to the query |
| Date / time / party-size | drive `get_available_slots_for_restaurants_compact` | **MISSING** (no controls, no RPC call in Discover) | add state + port `fetchDisplayAvailabilitySlotsForRestaurants` (`lib/customer/availabilityFilters.ts`); build an availability-by-id map |
| "Available tonight" | real, RPC-driven (`DiscoverPage.tsx:1477`) | **fake** — keys off `r.availability` which defaults to `'Popular'` (`mapRestaurantRow.ts:126`) → matches ~nothing | replace with `availabilityByRestaurantId[r.id]?.length > 0` |
| Price ($–$$$$) | multi-select | only `cheapEats` (≤2) | multi-select set `activePrices.has(r.priceRange)` (client-side) |
| Dietary tags / walk-ins | `FEATURE_OPTIONS` AND-match | **MISSING** | map `settings_json.dietaryTags` + `accepts_walkins` in `mapRestaurantRow.ts`; add AND-match |
| Distance radius | radius cut-off 5–150km | sort-only, **no cut-off** | add radius filter before the existing distance sort |
| Free-text search / cuisine groups (voice) | client-side; voice `filterRestaurants` | ✅ parity (byte-identical voice helper); manual page hard-codes 5 cuisine chips | broaden cuisine chips |
| Deals: type / price / distance | 8 types + price + distance | 5 types, **no price/distance** | extend `EventFilterBar` types; add price+distance to events page |
| Open-now / top-rated (map) | web lacks open-now | ✅ mobile map richer here | none (reverse gap) |

**No new backend RPCs needed** — `get_available_slots_for_restaurants_compact` already exists and is callable from mobile. Everything else is client-side.

---

## §11 — Feature Inventory: Gaps & Mock Data (🟠 P1)

Mobile gates mock vs real via `isDemoModeEnabled()` (`lib/config/demoMode.ts`). Most routes are real with a demo-only fallback. The true gaps (mock with **no** real path):

| Route / module | State | Fix |
|---|---|---|
| **`(customer)/map.tsx`** | 🔴 **MOCK-ONLY** — renders only `mockMapRestaurants` (empty in prod) | wire to real `fetchRestaurants` + `applyDistancesToRestaurants` (both already exist) |
| **`orders/[id].tsx`** | 🔴 **MOCK-ONLY** — reads only `mockOrders` → always "order not found" | wire to `orders`/`order_items` (or route through activity detail) |
| **`orders/pay/[orderId].tsx`** | 🔴 **DEAD** — calls removed `stripe-charge-order` | remove route (see §3) |
| **`feed`, `post`, following/trending, people-search, collections, feed-comments** | 🔴 **all fiction** — `mock/social`, `mock/snaps`, `mock/collections`; **no backend tables, no web equivalent** | product decision: build social backend OR hide these tabs for launch |
| Discover social widgets (trending, people-search, unread badge) | 🟠 mock | wire unread badge to real `notifications` (`getUnreadCount`); trending/people-search need backend |
| **Core diner journey** (book/pay/confirm/modify/cancel/reviews/snaps/notifications/account/Hey Cenaiva) | ✅ **WIRED & matches web** | none |

> Loyalty is intentionally OFF on both platforms (`isLoyaltyEnabled()===false`) — not a gap.
> `visit_photos` + `loyalty_transactions` tables exist live but have **no migration in-repo** (created out-of-band).

---

## §12 — Owner-side Dashboard Wiring (🟡 P2, except the cancel bug)

Mobile staff screens use the same dual-mode (`isDemoModeEnabled()`) pattern; backend is fully shared. Gaps are client-side.

| Area | Mobile | Gap | Fix |
|---|---|---|---|
| Orders/KDS | real (`kdsFeed.ts`) | only bumps `orders.status`, not `order_items.status` | also update `order_items.status` (`ordersKds.tsx:229`) |
| **Reservations** | real (thin select) | 🔴 **cancel bug (§2)**; no `orders`/`reservation_deposit_payments`/`event`/`promotion` embed; uses `update_staff_reservation_status('seated')` not `seat_staff_reservation` | fix cancel per §2; expand select to pin `orders!orders_reservation_id_fkey(...)` + deposits + event/promo; map P0022 friendly |
| Floor plan | **read-only** | no layout/table editing, no `update_table_service_status` writes, no live occupancy | port `useFloorPlan` reads+writes (all RPCs/tables exist) |
| CRM/guests | raw `guests` table | bypasses canonical `crm_guest_rows` RPC → fabricated LTV/churn fields | call `fetchCrmGuestRows` (wrapper exists `staffServices.ts:152`) |
| Settings | hours+seat-capacity parity ✅ | 🟠 **deposit_tiers editor entirely MISSING** | add editor writing `restaurants.deposit_tiers` (col + `compute_deposit_for_party` exist) |
| Analytics | real `restaurant_analytics` | some peak/dead/best rows may stay mock; dish-perf unconfirmed | verify computed-from-real when demo off; add dish aggregation |
| **Expenses/receipts** | ✅ **best parity** (`expensesApi.ts`, `scan-receipt`) | confirm standalone `receipts` table parity | minor |
| Events | list+create | no attendees list; edit/delete unconfirmed | add attendees query (`reservations` by `event_id`); add edit/delete |
| Promotions | list+create | no redemption detail list; edit/delete unconfirmed | add redemptions query (`reservations` by `promotion_id`); add edit/delete/pause |
| Menu | items real; **categories local-only** | `addCategory`/`reorder` don't persist (no `menu_categories` table use); item images unconfirmed | adopt `menu_categories` table (mirror `useMenuCategories`); add item image upload to `event-media` |

**No backend changes required** except possibly a `menu_categories.sort_order` column (verify if web persists category order).

---

## §13 — Simulator Setup (how to run + live-preview on your Mac)

This is the exact flow we proved. **One cloud build (1 EAS credit), then unlimited free local live-preview.** Your Mac never compiles.

### One-time prerequisites
- Xcode + an **iOS 26.5 simulator runtime** installed (we used iPhone 17 Pro Max, UDID `54452DFC-51C2-4CB5-97AC-E1C378D42397`).
- `eas-cli` installed globally + logged into the EAS account that owns the project (`stevengeorgy`). Check: `eas whoami`.
- Mobile repo deps installed: `cd mobile-seatly-v2 && npm install` (must produce `node_modules/expo-dev-client` — the build pre-check fails without it).

### Build the simulator app in the cloud (1 credit)
```bash
cd mobile-seatly-v2
EAS_SKIP_AUTO_FINGERPRINT=1 eas build --profile development-simulator --platform ios --non-interactive
```
- The `development-simulator` profile = dev-client + `ios.simulator:true` (connects to Metro for live reload).
- `EAS_SKIP_AUTO_FINGERPRINT=1` is **required** locally — without it the build dies at "Computing project fingerprint" with `brace_expansion_1.expand is not a function` (a known EAS CLI bug). This costs **0 credits** (fails before queueing) but wastes time.
- Failures *before* the cloud build queues = 0 credits. The credit is spent only once the cloud build actually runs.

### Install onto the simulator
```bash
# get the .tar.gz artifact URL:
eas build:view <BUILD_ID> --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).artifacts.applicationArchiveUrl))"

# download + unpack:
mkdir -p /tmp/cenaiva-sim && cd /tmp/cenaiva-sim
curl -sL -o app.tar.gz "<ARTIFACT_URL>" && tar -xzf app.tar.gz   # → Cenaiva.app

# boot + install:
open -a Simulator
xcrun simctl bootstatus <UDID> -b
xcrun simctl install <UDID> /tmp/cenaiva-sim/Cenaiva.app
```

### ⚠️ Add the `.env` (REQUIRED — or the app can't reach your backend)
The mobile repo's `.env` is gitignored and **absent in a fresh clone**. Create `mobile-seatly-v2/.env` with at least:
```
EXPO_PUBLIC_SUPABASE_URL=<your project URL>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your anon/publishable key>
```
(Copy the values from a working `.env`. For a dev-client build, these `EXPO_PUBLIC_*` vars are read by **Metro at runtime**, so they take effect without rebuilding. Google Maps keys are baked at build time from EAS secrets — already present in this build.)

### Run + live-preview loop (free, no credits)
```bash
cd mobile-seatly-v2
npx expo start --dev-client      # (or: npm run start:dev)
```
- Launch **Cenaiva** in the simulator → it connects to Metro → your edits show **live**.
- **Edit JS/TS (screens, logic, wiring, the fee math) → instant reload, no rebuild, no credit, unlimited.**
- You only need a **new build (another credit)** if you add/remove a **native module** or change **native config** (app icon, permissions, bundle id, SDK upgrade).

### When satisfied
- A TestFlight/App-Store build is a **separate** build (real-phone, `production`/`preview` profile) = another credit; the same build is what you submit for Apple review (no extra credit to publish).
- Your code changes live in your repo until **you** commit + push — running the simulator never commits or publishes anything.

---

*Generated from a read-only multi-agent audit of `apps/web` + `supabase` vs `mobile-seatly-v2`. No code was changed. Companion file: `MOBILE_TRANSCRIPTION_REPORT.md`.*
