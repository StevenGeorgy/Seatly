# MOBILE_OWNER_AUDIT.md

**What this is:** a page-by-page audit of the **owner side of the mobile app**
(`/Users/mark_habbi/mobile-seatly-v2-2`) measured against the **web owner dashboard**, which
is the **source of truth** (documented in `OWNER_DASHBOARD_REFERENCE.md`). For each surface:
what's accurate, what's wrong/mock/broken, and what needs fixing.

**Backend is shared** — both apps hit the same Supabase project (`exbjodmnpdiayfzrdyux`):
same tables, RPCs, edge functions, RLS. So the heavy logic is already enforced for mobile;
nearly every gap below is a **mobile-client** issue (wrong fn name, missing UI, mock data),
not a backend change.

**Method:** read-only multi-agent sweep of `app/(staff)/*` + `lib/owner/*` + `lib/staff/*`
against the web reference. File:line citations are as found; verify before implementing.

**Legend:** ✅ matches web · ⚠️ partial · 🔴 broken / missing · ➕ mobile-only extra

---

## Scoreboard

| Surface | Mobile file(s) | Verdict | One-line |
|---|---|---|---|
| Shell / access / roles | `(staff)/_layout.tsx`, `OwnerRestaurantContext.tsx`, `roles-permissions.tsx` | ⚠️ | scope ✅; **no per-route role gate**; 6/14 permission keys |
| Overview / home | `(staff)/home.tsx`, `tonightBriefing.ts` | ⚠️ | real reads; **no Realtime**, no pre-order income metric |
| Reservations | `(staff)/reservations.tsx` | ✅ | owner-cancel + orders-embed + deposits all correct |
| Floor Plan | `(staff)/floor.tsx` | ⚠️ | status writes ✅; **read-only canvas** (no layout editing) |
| Orders (KDS) | `(staff)/ordersKds.tsx`, `kdsFeed.ts` | ✅ | updates orders **and** order_items, Realtime — full parity |
| Menu | `(staff)/menu*.tsx`, `menuCategoriesStore.ts` | ⚠️ | categories+items persisted ✅; **item images not uploaded to bucket** |
| Host / Staff invites | `(staff)/staff.tsx`, `invite-team-member.tsx` | 🔴 | roster ✅; **invite form is UI-only (no `invite-staff` call)** |
| CRM | `(staff)/crm.tsx`, `guests/` | ⚠️ | `crm_guest_rows` ✅; **campaign composer is a stub** |
| Analytics | `(staff)/analytics.tsx` | ⚠️ | core metrics real; **dish perf missing, peak-hours hardcoded** |
| Expenses | `(staff)/expenses.tsx`, `expensesApi`, `useAutoIncome` | ✅ | full parity — CRUD, recurring, OCR, auto-income |
| Export | `(staff)/export.tsx` | 🔴 | history list only; **no export generation** |
| Events | `(staff)/events/` | ⚠️ | list/create/delete/attendees ✅; **no edit screen** |
| Promotions | `(staff)/promotions/` | ⚠️ | list/create/delete/redemptions ✅; **no edit screen** |
| Settings → business info | `(staff)/business.tsx` | 🔴 | **read-only, no edit form** |
| Settings → hours | `(staff)/business-hours.tsx` | ✅ | reads/writes `hours_json` + syncs shifts |
| Settings → closures | `(staff)/closures.tsx` | ✅ | writes special days |
| Settings → deposit tiers | `lib/owner/depositTiersSettings.ts` | 🔴 | **backend lib complete but NO UI screen wired** |
| Settings → subscription/billing | `subscription-plan.tsx`, `payment-method.tsx`, `billing-*` | ✅ | canonical edge fns; trial = 90 days (stale "3 months" fixed) |
| Settings → theme | `(staff)/settings.tsx` | 🔴 | light/dark toggle only; **no brand color pickers** |
| Settings → danger zone | `lib/owner/publishRestaurant.ts` | 🔴 | publish ✅; **unpublish + delete missing** |
| **Onboarding** | `(auth)/owner-register.tsx`, `profile/register-restaurant*`, `restaurantRegistration.ts` | 🔴 | **non-functional end-to-end** (wrong fns, never publishes) |

**Roughly:** backend wiring is ~85% solid; the gaps are mostly **missing UI** and the
**onboarding flow**. Two surfaces match web fully (Reservations, Orders, Expenses); one is
totally broken (Onboarding); the rest are partial.

---

## 1. Shell / access / roles — ⚠️ partial

**Mobile:** `app/(staff)/_layout.tsx`, `lib/owner/OwnerRestaurantContext.tsx`, `roles-permissions.tsx`, `lib/owner/staffRoles.ts`

- ✅ Restaurant scope selection + persistence (AsyncStorage) via `OwnerRestaurantContext` (`fetchOwnerRestaurants`), incl. multi-restaurant + "all" mode.
- ✅ Staff-shell gate via `isStaffLike` (`_layout.tsx:163`).
- ✅ Role-permissions matrix stored/edited in `restaurants.settings_json.role_permissions` (4 roles × 6 perms).
- 🔴 **No per-route role gating** — web's `DashboardRoleGuard` + `DASHBOARD_PATH_ROLES` matrix has no mobile equivalent; every `(staff)` screen is reachable by any staff user (relies on RLS for data). Web gates e.g. `/export` to owner-only.
- 🔴 **Permission keys 6 vs 14** — web has 14 (overview, reservations, floorPlan, staffInvites, orders, menu, crm, analytics, expenses, events, promotions, export, restaurant, settings); mobile has 6.

**Fix:** add a client-side per-screen role gate; expand the permission set 6 → 14 to match web's `DEFAULT_PERMS`.

## 2. Overview / home — ⚠️ partial

**Mobile:** `app/(staff)/home.tsx`, `lib/owner/tonightBriefing.ts`

- ✅ Real reads: `reservations` + `tables` + `restaurant_analytics`; computes covers, busiest window, runway, open seats on-device.
- 🔴 **No Realtime** — web subscribes to `postgres_changes` on `orders` + `reservations`; mobile must manually refetch (stale until reload).
- 🔴 No **paid pre-order income** metric and no **next-2-hours** reservation list (web shows both).

**Fix:** add Realtime subscriptions on `reservations`+`orders`; surface pre-order income (sum paid `orders` where `is_preorder`).

## 3. Reservations — ✅ matches

**Mobile:** `app/(staff)/reservations.tsx`

- ✅ Owner cancel routes through **`cancelReservationAsOwner()` → `cancel-reservation` `actor:'owner'`** (`:1269`) — refund + reverse_transfer + notification correct.
- ✅ Orders embed pins **`orders!orders_reservation_id_fkey(...)`** (`:959`) — avoids PGRST201.
- ✅ Seat via `seatStaffReservation` RPC; status (seated/completed/no_show) via `update_staff_reservation_status`; deposit + pre-order detail shown.
- 🔴 Minor: no **"Modified"** quick-filter (web flags diner-modified via `internal_notes`).

**Fix:** add the Modified filter (cosmetic / low priority).

## 4. Floor Plan — ⚠️ partial

**Mobile:** `app/(staff)/floor.tsx`, `lib/owner/floorCapacity.ts`

- ✅ Reads `tables`; live occupancy from reservations; **`update_table_service_status`** RPC for status changes; capacity via on-device sum.
- 🔴 **Read-only canvas** — cannot edit layout, walls, sections/floors (no `updateLayout` / `createSectionAndFloor` / `updateFloorName`). Web has full Konva editing + undo/redo.

**Fix:** add layout/section editing if needed — or accept read-only as the intentional mobile MVP scope (call it out explicitly so it isn't mistaken for a bug).

## 5. Orders (KDS) — ✅ matches (full parity)

**Mobile:** `app/(staff)/ordersKds.tsx`, `lib/owner/kdsFeed.ts`

- ✅ `fetchKdsTickets` reads `orders` + `order_items` (+ modifiers + tables); `persistOrderStatus` updates **both** `orders.status` (`:229`) **and** `order_items.status` (`:239`); Realtime on `orders` + 15s focus poll; live feed from `reservations`.

**Fix:** none.

## 6. Menu — ⚠️ partial

**Mobile:** `app/(staff)/menu*.tsx`, `lib/owner/menuCategoriesStore.ts`, `MenuContext.tsx`

- ✅ **Categories now persist** to `menu_categories` (`syncOrderedCategories`/`fetchOrderedCategoryNames`) — the parity spec's "categories local-only" gap is **CLOSED**.
- ✅ Items CRUD to `menu_items` (add/update/remove, optimistic).
- 🔴 **Item images not uploaded** — `menu-item-edit.tsx` stores the local `file://` URI directly in `menu_items.photo_url`; never uploads to the `event-media` bucket (web does `event-media/{rid}/menu-items/{uuid}`). Images will be broken for everyone but the uploader's device.

**Fix:** upload picked images to `event-media` (mirror web `uploadMenuItemImage`), persist the returned public URL.

## 7. Host / Staff invites — 🔴 broken

**Mobile:** `app/(staff)/staff.tsx`, `invite-team-member.tsx`, `team.tsx`, `roles-permissions.tsx`, `lib/owner/staffRoster.ts`

- ✅ Roster read from `user_restaurant_roles` ⨝ `user_profiles` (`staffRoster.ts:64`).
- 🔴 **Invite form is UI-only** — `invite-team-member.tsx:149` `onSave()` just shows an `Alert`; it never calls the **`invite-staff`** edge fn, never writes `staff_invitations`, no `permission_overrides_json`. Inviting a teammate does nothing.
- ⚠️ Role permissions 6/14 keys (see §1).
- ➕ Staff **PINs** (`staff-pins.tsx`) — mobile-only, no web equivalent.

**Fix:** wire the invite form to the `invite-staff` edge fn (role + overrides → email/SMS + `staff_invitations`); expand permission keys.

## 8. CRM — ⚠️ partial (~⅔)

**Mobile:** `app/(staff)/crm.tsx`, `app/(staff)/guests/index.tsx`, `lib/crm/guestIntel.ts`

- ✅ `guests/index.tsx:98` uses canonical RPC **`crm_guest_rows`** (computed LTV/visits/segments); guest detail + segment filters real.
- ⚠️ `crm.tsx:203` **also reads the raw `guests` table** directly (top-10) — duplicate of the RPC.
- 🔴 **Campaign composer is a stub** — `crm.tsx:798` shows "coming soon"; **`send_crm_campaign` is never called** (body collected then discarded).

**Fix:** wire the Message button to `send_crm_campaign`; drop the duplicate raw `guests` read.

## 9. Analytics — ⚠️ partial (~½)

**Mobile:** `app/(staff)/analytics.tsx`, `insights.tsx`

- ✅ Reads **`restaurant_analytics`** (`:307`): revenue, covers, avg spend/cover, no-shows — stat cards + revenue chart correct.
- ⚠️ **Peak-hours heatmap is hardcoded** demo data, not computed from `reservations`.
- 🔴 **Dish performance missing in prod** — top-5 dishes only exist in demo mode; no `orders→order_items→menu_items` aggregation. Revenue breakdown / guest mix likewise demo-only.

**Fix:** add the dish-performance query; compute peak hours from `reservations`; expose revenue breakdown from real `orders`.

## 10. Expenses — ✅ matches (best parity)

**Mobile:** `app/(staff)/expenses.tsx` + `expense-*`, `lib/expenses/expensesApi.ts`, `lib/owner/useAutoIncome.ts`

- ✅ `expenses` + `recurring_expense_rules` + `receipts` full CRUD (soft-delete); **`scan-receipt`** edge-fn OCR; **auto-income** from paid `orders` + charged `reservation_deposit_payments`; report grouping + CSV share.

**Fix:** none — production-ready.

## 11. Export — 🔴 broken

**Mobile:** `app/(staff)/export.tsx`

- ⚠️ Reads `accountant_exports` history (`:38`) and lists past exports; tapping a row is a stub (`Alert`).
- 🔴 **No generation** — no dataset selector, no date range, no CSV pipeline, no download. Web generates 7 CSVs (revenue/reservations/orders/expenses/payroll/analytics/Cenaiva-billing).

**Fix:** add a dataset+date-range form that produces the CSVs (or queues via `accountant_exports`) + a download path. Lower priority (owners can use web).

## 12. Events — ⚠️ partial

**Mobile:** `app/(staff)/events/index.tsx` + `new.tsx`, `lib/owner/createEventOrPromotion.ts`, `eventPromoManage.ts`, `uploadEventMedia.ts`

- ✅ List (`fetchUpcomingEvents`), create (`createEvent` → `events`), attendees (`reservations.event_id`), media → `event-media`, pause/delete.
- 🔴 **No edit screen** — once posted, an event can only be deleted + recreated.
- ⚠️ No diner-facing preview.

**Fix:** add an event edit screen (load + full-form update).

## 13. Promotions — ⚠️ partial

**Mobile:** `app/(staff)/promotions/index.tsx` + `new.tsx`, `promote.tsx`, `lib/owner/promotionTypes.ts`

- ✅ List, create (type-driven: percent/amount/bogo/free_item), redemptions (`reservations.promotion_id`), recurrence + time-of-day + promo codes, pause/delete.
- 🔴 **No edit screen** (create + delete only).

**Fix:** add a promotion edit screen.

## 14. Settings (by sub-screen)

| Sub-screen | Mobile file | Verdict | Notes / fix |
|---|---|---|---|
| **Business info** | `business.tsx` (+ `saveRestaurantProfile.ts`) | 🔴 | **read-only display, no edit form** — wire an edit form to `saveRestaurantProfile` (name/address/phone/cuisine/dietary/logo/cover/description/socials) |
| **Hours** | `business-hours.tsx` (+ `saveRestaurantHours.ts`) | ✅ | reads/writes `hours_json`, syncs `shifts` |
| **Closures** | `closures.tsx` | ✅ | writes special days/closures |
| **Reservation settings** | `reservation-settings.tsx` | ⚠️ | verify scope vs web booking rules |
| **Deposit tiers** | `lib/owner/depositTiersSettings.ts` | 🔴 | **lib is complete** (`read`/`saveDepositTiers` → `restaurants.deposit_tiers`, dedup+sort) **but NO UI screen is wired to it** — add `app/(staff)/deposit-tiers.tsx` and link it from settings |
| **Subscription** | `subscription-plan.tsx` (+ `subscriptionLifecycle.ts`) | ✅ | canonical `pause`/`cancel`/`restart-subscription`; trial = **90 days** (stale "3 months" fixed in `trialPolicy.ts`) |
| **Payment method** | `payment-method.tsx` (+ `saveSubscriptionPaymentMethod.ts`) | ✅ | `stripe-setup-intent` + `save-subscription-payment-method` |
| **Billing history/address** | `billing-history.tsx`, `billing-address.tsx` | ✅ | next-bill preview + payouts |
| **Theme** | `settings.tsx` | 🔴 | light/dark/system toggle only; **no brand color pickers** (web edits `settings_json.theme` primary/accent/background) |
| **Danger zone** | `publishRestaurant.ts` | 🔴 | publish ✅; **unpublish + per-restaurant delete missing** (web has both; `recover-restaurant`/soft-delete) |

## 15. Onboarding — 🔴 broken end-to-end

**Mobile:** `app/(auth)/owner-register.tsx`, `app/(customer)/profile/register-restaurant*.tsx`, `app/(staff)/connect-onboarding.tsx`, `lib/services/restaurantRegistration.ts`, `lib/owner/connectOnboarding.ts`, `lib/owner/publishRestaurant.ts`

The mobile flow is a custom 3-step (form → Connect → card) that **never publishes**, vs the web's 8-step wizard. Specifics:

- 🔴 **Wrong registration fn** — `restaurantRegistration.ts:79+` calls **`register-restaurant-owner`** (non-canonical, mobile-only, with `action` sub-branches) instead of canonical **`signup-restaurant-owner`**.
- 🔴 **Wrong Connect fn** — `connectOnboarding.ts:25` calls **`create-onboarding-link`** directly and **skips `create-stripe-account`** (the Express CA account creation/sync).
- 🔴 **Step-1 form is incomplete** — collects only `businessName`, `address`, `ownerPhone`. **Missing `postal_code` (required for tax / publish gate)**, `business_type`, `cuisine_type`, GST/HST, walk-ins, dietary tags, description.
- 🔴 **No hours / tables / menu / cover-photo steps** — web Steps 2,3,5,6. Cover photo + ≥3 priced tier items + postal_code are all **publish-gate requirements** that mobile never collects.
- ✅ **Card capture is correct** — `register-restaurant-card-entry.tsx` uses `stripe-setup-intent` (Branch A) → `save-subscription-payment-method` with consent disclosure.
- 🔴 **Never publishes** — `publishRestaurant.ts` correctly calls canonical `publish-restaurant`, but **it is never invoked** in the onboarding screens. Restaurant stays `is_published=false` → invisible to diners, **trial never starts**.
- ✅ `trialPolicy.ts` = 90 days (correct).

**Fix (ordered):**
1. Replace `register-restaurant-owner` → **`signup-restaurant-owner`** (full Step-1 body incl. **postal_code**).
2. Add the missing Step-1 fields (postal_code, business_type, cuisine, GST/HST, walk-ins, dietary, description).
3. Call **`create-stripe-account`** before `create-account-link` (rename `create-onboarding-link`).
4. Collect **cover photo** (→ `event-media`) and **≥3 priced tier menu items** before allowing publish.
5. Call **`publish-restaurant`** (via the existing `publishRestaurant.ts`) at the end; gate the success screen on it.
6. Handle the **`tax_address_incomplete`** publish-gate error → prompt for postal code.
7. Retire the custom `register-restaurant-owner` edge fn once the canonical flow is in.

---

## What needs fixing — prioritized punch list

**🔴 P0 — blocks core owner workflows**
1. **Onboarding rebuild** (§15) — non-functional end-to-end; align to `signup-restaurant-owner` + `create-stripe-account`→`create-account-link` + `publish-restaurant`; collect postal_code/cover/menu. *Owners literally cannot go live from mobile.*
2. **Staff invite** (§7) — wire the form to the `invite-staff` edge fn (currently a no-op Alert).
3. **Deposit-tiers screen** (§14) — backend lib is done; add the missing UI so owners can set deposits.
4. **Menu item image upload** (§6) — upload to `event-media` instead of storing local `file://` URIs.

**🟠 P1 — partial features / accuracy**
5. **Business-info edit form** (§14) — currently read-only.
6. **Event + Promotion edit screens** (§12, §13) — create/delete only today.
7. **CRM campaign** (§8) — wire `send_crm_campaign` (stub today).
8. **Analytics dish performance + real peak hours** (§9) — demo-only today.
9. **Per-route role gating + 14 permission keys** (§1).
10. **Home Realtime + pre-order income** (§2).

**🟡 P2 — polish / lower frequency**
11. **Danger zone** unpublish/delete (§14); **theme color pickers** (§14); **Export generation** (§11); Floor-plan layout editing (§4, or accept as MVP scope); Reservations "Modified" filter (§3); dedupe CRM raw `guests` read (§8).

**✅ Already correct (no work):** Reservations (owner-cancel + embeds), Orders/KDS, Expenses (full), hours/closures + subscription/billing settings, menu category/item persistence, trial = 90 days.

---

*Audit of `mobile-seatly-v2-2` owner side vs the canonical web. Source of truth:
`OWNER_DASHBOARD_REFERENCE.md`. Related: `MOBILE_PARITY_SPEC.md` (full web→mobile parity,
incl. diner side). Backend is shared — fixes here are mobile-client unless noted. Verify
file:line citations against current code before implementing.*
