# OWNER_DASHBOARD_REFERENCE.md

**What this is:** a page-by-page reference for the **web** owner-side dashboard and the
restaurant **onboarding wizard** — the canonical, source-of-truth implementation in
`apps/web`. For each surface it maps the **UI** (sections, dialogs, components) to the
**backend** it touches (data hooks → RPCs / edge functions / tables / storage buckets).

**Scope:** web app only (`/Users/mark_habbi/Seatly-17/apps/web/src`). Use this as the
reference when building or auditing the mobile owner dashboard (see `MOBILE_PARITY_SPEC.md`
§9, §12 for where mobile diverges).

**How it was built:** read-only audit of the routed dashboard pages + onboarding steps and
the hooks they call. Column/RPC names are as found in the code; verify against the latest
migration before relying on an exact signature.

---

## 1. Access model & routing

All dashboard routes live under `/dashboard/*` (`routes/AppRoutes.tsx:286`) wrapped in a
guard chain:

```
RequireAuth → RequireStaff → RestaurantScopeProvider → DashboardRoleGuard → DashboardLayout
```

- **RequireAuth** — must be signed in (else `/login`).
- **RequireStaff** — `isStaff` from `useUser()` = the user has ≥1 row in `user_restaurant_roles` (else `/discover`).
- **RestaurantScopeProvider** — supplies `selectedRestaurantId`, `selectedRestaurant`, `restaurants[]` (from `useStaffRestaurants`); persists the selection to `localStorage` (`cenaiva.selectedRestaurantId`); defaults to the primary-role restaurant.
- **DashboardRoleGuard** — per-route role gate via `canAccessDashboardPath()` against the `DASHBOARD_PATH_ROLES` matrix (`lib/auth/dashboard-access.ts`). On deny, redirects to the role's default page (owner/manager → `/dashboard`; kitchen/bar → `/orders`; server/host → `/reservations`).

### Role access matrix

| Route | Page | Roles allowed |
|---|---|---|
| `/dashboard` | Overview | owner, manager |
| `/dashboard/reservations` | Reservations | owner, manager, server, host |
| `/dashboard/floor-plan` | Floor Plan | owner, manager, server, host |
| `/dashboard/staff-invites` | Host / Staff Invites | owner, manager |
| `/dashboard/orders` | Orders (KDS) | owner, manager, server, kitchen, bar |
| `/dashboard/menu` | Menu | owner, manager |
| `/dashboard/crm` | CRM | owner, manager |
| `/dashboard/analytics` | Analytics | owner, manager |
| `/dashboard/expenses` | Expenses | owner, manager |
| `/dashboard/events` | Events | owner, manager |
| `/dashboard/promotions` | Promotions | owner, manager |
| `/dashboard/export` | Export | owner only |
| `/dashboard/restaurant` + `/dashboard/settings` | Settings | owner, manager |

> `/setup` (onboarding) is **not** under `/dashboard` — it's `RequireAuth`-only (§15).
> `SchedulePage.tsx` exists but is **not routed** (dead/placeholder — see §14).

---

## 2. Dashboard shell

**Files:** `pages/dashboard/DashboardLayout.tsx`, `components/dashboard/DashboardSidebar.tsx`, `DashboardTopBar.tsx`

Two-column layout: collapsible sidebar (icon rail 56px ↔ 224px on desktop, drawer on
mobile) + main content with page-transition animation (the Floor Plan route opts out so the
Konva canvas can take full height).

**Sidebar nav (in order):** Overview · Reservations · Floor Plan · Staff Invites · Orders ·
Menu · CRM · Analytics · Expenses · Events · Promotions · Export · Restaurant Info · Settings.
Includes a restaurant switcher popover, notifications bell, customer-view toggle, public
"preview" link, and sign-out.

**Lifecycle banners mounted shell-wide:**
- `RestoreRestaurantBanner` — soft-deleted restaurant → restore CTA (`recover-restaurant`).
- `PaymentFailedBanner` + `PaymentFailedModal` — paused subscription (payment failure).
- `BillingStatusPill` — subscription status / trial countdown (top-right).
- `TestModeIndicator` — dev-only watermark.

Floor-plan data is prefetched here (cache + silent refetch) so the Floor Plan page paints instantly.

---

## 3. Overview — `/dashboard`

**File:** `pages/dashboard/OverviewPage.tsx` · **Purpose:** live "service tonight" snapshot.

- **UI:** setup-progress banner (if unpublished); 3 metric cards (tonight's covers, paid pre-order income, today's pre-orders); hourly **timeline bar chart** with a "now" marker and event overlays; next-2-hours reservations table (desktop) / cards (mobile); service-summary prose; `EventAttendeesDialog`.
- **Hooks:** `useOverviewStats(range)`, `useReservations({date, timezone})`, `useTonightEvents(date)`, `useRestaurant`, `useRestaurantSetupCompletion`, `useRestaurantScope`.
- **Backend:** reads `orders` (pre-order stats), `reservations` (+guests/tables/orders embeds), `events`. **Realtime** postgres_changes on `orders` + `reservations` auto-refetch.
- **Notes:** pre-order = `is_preorder` OR has `reservation_id`; active order statuses = pending/confirmed/preparing/ready/served.

---

## 4. Reservations — `/dashboard/reservations`

**File:** `pages/dashboard/ReservationsPage.tsx` · **Purpose:** day/week/list reservation management, seating, cancellation, deposit & pre-order detail.

- **UI:** date picker + view tabs (Day/Week/List) + quick filters (All/Upcoming/Current/Past/Cancelled/**Modified**) + search; timeline grouped by table/section, colored by status; list cards; **details dialog** (Reservation + Orders tabs) with deposit breakdown, pre-order summary, confirmation code, event/promo chips; actions Seat / Mark seated / No-show / Cancel / Mark arrived; force-confirm dialog on seating-window errors; cancel dialog showing refund.
- **Components:** `ReservationDepositBreakdown` (per-payer rows, split-tender badge), `ReservationPreorderSummary`, `SeatReservationDialog`, `StatusBadge`.
- **Hooks:** `useReservations(filters)` — embeds guests, tables, `reservation_tables`, events, promotions, `reservation_deposit_payments[]`, **`orders!orders_reservation_id_fkey(... order_items[])`** (the explicit FK embed is mandatory — a bare `orders(...)` returns PGRST201 and empties the list). Realtime subscription.
- **Backend — RPCs:** `update_staff_reservation_status` (seated/completed/no_show; **not** for cancel), `seat_staff_reservation`, `create_staff_reservation`, `write_staff_audit_event`.
- **Backend — edge fns:** **`cancel-reservation` with `actor:"owner"`** (owns the refund pipeline — `reverse_transfer`, sets `cancellation_reason="Cancelled by restaurant"`), `refund-deposit-on-arrival`, `notify-no-show`, `approve-staff-action` (manager approval).
- **Backend — tables:** `reservations`, `guests`, `tables`, `reservation_tables`, `events`, `promotions`, `reservation_deposit_payments`, `orders`, `order_items`, `staff_audit_events`.
- **Guardrails:** owner cancels MUST go through `cancel-reservation` (never raw-flip status); seating window 1h-before → 24h-after (`P0020/P0022`, owner/manager force-override); diner-modified flagged via `internal_notes` marker.

---

## 5. Floor Plan — `/dashboard/floor-plan`

**File:** `pages/dashboard/FloorPlanPage.tsx` · **Purpose:** live seating canvas with table/wall editing, occupancy, quick-seat.

- **UI:** Konva canvas (tables colored by status, walls, entrances, mini-map, pan/zoom, snap-to-grid); context-aware right rail (idle quick-add form / table detail with seated-count + status dropdown + delete / wall-entrance editor); floor selector + add-floor; undo/redo (client-side); seating + combine-tables dialogs.
- **Hooks:** `useFloorPlan()` (tables, sections=floors, `floor_plans` layout JSON; CRUD + `updateTableServiceStatus`, `createSectionAndFloor`, `updateFloorName`, `updateLayout`; localStorage cache for instant paint), `useReservations` (occupancy), `useAvailability`.
- **Backend — RPC:** `update_table_service_status(table_id, status, seated_count)`; shares Reservations' create/seat/cancel RPCs + edge fns.
- **Backend — tables:** `tables` (position_x/y, shape, status, seated_count), `restaurant_sections`, `floor_plans` (layout JSON: walls/doors/windows/tableTransforms/decorations), `reservations` + `reservation_tables` for occupancy.

---

## 6. Orders (KDS) — `/dashboard/orders`

**File:** `pages/dashboard/OrdersPage.tsx` · **Purpose:** pre-order kitchen display + status transitions.

- **UI:** 4 stat cards (active pre-orders, ready, pre-order value, item count); status tabs (all/pending/preparing/ready/served); search; table (desktop) / cards (mobile); Mark Ready → Mark Served actions.
- **Hooks:** `useOrders({ preordersOnly: true })` with Realtime on `orders` + `order_items`.
- **Backend:** reads `orders` (filter `restaurant_id`, status in pending/confirmed/preparing/ready/served) joined to `order_items`, `reservations`, `guests`, `menu_items`. Mutations: `updateOrderStatus()` updates **both** `orders.status` and `order_items.status`.
- **Notes:** diner clients must NOT update `orders` (RLS staff-only; diners use `mark-order-paid`). Status is forward-only.

---

## 7. Menu — `/dashboard/menu`

**File:** `pages/dashboard/MenuPage.tsx` + `components/dashboard/menu/` · **Purpose:** manage categories + items, pricing, images, AI suggestions.

- **UI:** category/item counts; AI `MenuSuggestionsPanel` (Sparkles toggle); category tabs; `MenuCard` grid (image, price, dietary flags, margin %); create/edit modals with image upload + preview.
- **Hooks:** `useMenuCategories()` (auto-creates Mains/Entrées as the pricing-tier source), `useMenuItems()` (incl. `uploadMenuItemImage()`).
- **Backend — tables:** `menu_categories` (name, sort_order, is_active, `is_pricing_tier_source`, available_from/to), `menu_items` (price, cost_price, photo_url, dietary_flags, allergens, is_available, is_preorderable, is_featured, prep time, loyalty points). **Storage:** `event-media` (`{restaurant_id}/menu-items/{uuid}-{file}`).
- **Guardrails:** Mains/Entrées are system-required (drive price level, not deletable); categories with items can't be deleted; soft-delete via `is_active=false`; image MIME + size via `assertImageSizeOk` (5 MB).

---

## 8. Host / Staff Invites — `/dashboard/staff-invites`

**File:** `pages/dashboard/HostPage.tsx` · **Purpose:** invite staff with role + permission overrides; manage roster.

- **UI:** invite form (role select, email/phone, 14 permission pills, customize toggle) + active roster (name, role badge, hourly rate, edit/remove) + pending invites (resend/cancel).
- **Hooks:** `useHostInvites()` (sendInvite/resendInvite/cancelInvite), `useStaffRoster({includeMock:false})` (updateMemberAccess/removeMemberAccess).
- **Backend — edge fn:** `invite-staff` (validates owner/manager; emails via `auth.inviteUserByEmail` or SMS via Twilio; writes `delivery_status`). **Tables:** `staff_invitations` (token, status, `permission_overrides_json`, expires_at), `user_restaurant_roles` (role, hourly_rate, employment_type, overrides), `user_profiles`.
- **Guardrails:** managers may only invite **hosts** and only grant `reservations`+`floorPlan`; 14 permission keys with role presets (owner=all; manager=all except export; host=reservations+floorPlan).

---

## 9. CRM — `/dashboard/crm`

**File:** `pages/dashboard/CrmPage.tsx` · **Purpose:** guest book by segment + targeted in-app campaigns.

- **UI:** stat cards (guests, active VIPs, total LTV, repeat rate) + segment tabs (all/vip/loyalty/returning/new/blocked); guest table (visits, last visit, LTV, avg ticket, loyalty points, tags/allergens); guest detail sheet; campaign composer (segment targeting + event/promo offer).
- **Hooks:** `useGuests()` → RPC **`crm_guest_rows(p_restaurant_id)`** (computed LTV/visits/segment fields — do not hand-roll from `guests`), `useEvents`, `usePromotions`, `useCrmCampaigns()` → RPC `send_crm_campaign(...)`.
- **Backend:** RPCs `crm_guest_rows`, `send_crm_campaign`; reads `guests`, `reservations`, `events`, `promotions`.
- **Notes:** campaigns only reach guests with a linked `user_profile_id`; draft event/promo auto-activated (private) before send.

---

## 10. Analytics — `/dashboard/analytics`

**File:** `pages/dashboard/AnalyticsPage.tsx` · **Purpose:** last-30-day revenue/covers/turn + peaks + dish performance.

- **UI:** 3 stat cards (income, covers + avg/cover, avg table turn — each vs prior 30d); monthly income/expenses bar chart; top-5 dishes by revenue; weekly peak-hours heatmap (respects operating hours).
- **Hooks:** `useAnalytics(range)` (`restaurant_analytics`), `useAnalyticsDishPerformance(range)` (`orders`→`order_items`→`menu_items`), `useAnalyticsReservations(range)`, `useExpenses(range)`.
- **Backend — tables:** `restaurant_analytics` (pre-computed daily: covers, revenue, avg spend/cover, table-turn, no-shows, food/drink revenue, tips, labour, new/returning guests, loyalty), `orders`/`order_items`/`menu_items`, `reservations` (peak hours), `expenses`.
- **Notes:** only paid orders (`paid_at NOT NULL`); heatmap greys closed slots from `hours_json`.

---

## 11. Expenses — `/dashboard/expenses`

**File:** `pages/dashboard/ExpensesPage.tsx` + `ReceiptsLibrary.tsx` + `ReceiptScanReviewDialog.tsx` · **Purpose:** money in/out ledger + recurring rules + auto-income + receipt OCR.

- **UI:** Entries view (date-range selector, income/expense/net/due cards, category chart, ledger table, create/edit dialog with recurring config); Receipts view (upload → OCR scan → review extracted fields → link/create expense).
- **Hooks:** `useExpenses(filters)` (`expenses` + `recurring_expense_rules`, full CRUD), `useAutoIncome(filters)` (read-only ledger synthesized from paid `orders` + charged `reservation_deposit_payments`), `useReceipts()` (`receipts`, soft-delete), `useScanReceipt()` → edge fn `scan-receipt`.
- **Backend — edge fn:** `scan-receipt` (Claude vision OCR → vendor/date/amount/tax/category; rate-limited per-min/day). **Tables:** `expenses` (incl. `source='auto:cenaiva'` for Stripe-imported rows), `recurring_expense_rules`, `receipts`. **Storage:** `receipts` bucket.
- **Notes:** auto-income + Cenaiva auto-imports are read-only ("Managed by Cenaiva" badge); CSV carries payer/reference/`deposit_payment_id`/`stripe_payment_intent_id`.

---

## 12. Events — `/dashboard/events`

**File:** `pages/dashboard/EventsPage.tsx` + `EventAttendeesDialog.tsx` · **Purpose:** create/schedule events, media, attendees.

- **UI:** counts (upcoming/drafts/past); grid ↔ calendar; phase tabs (Active/Draft/Past); `EventFormDialog` (title, description, theme, media image/PDF, dates/times, capacity, per-cover price, private, fixed-arrival toggle); `EventAttendeesDialog` (reservations by `event_id`); diner-facing preview.
- **Hooks:** `useEvents()`, `useEventAttendees(eventId)`, `useRestaurantScope`.
- **Backend — table:** `events` (name, date/end_date, start/end_time, capacity, tickets_sold, price_per_person, is_active, is_private, theme, fixed_arrival_time, media_*). Attendees via `reservations.event_id`. **Storage:** `event-media`.
- **Notes:** `tickets_sold` is computed from reservations; draft = `is_active=false`; capacity NULL = unlimited; private events hidden from public deals.

---

## 13. Promotions — `/dashboard/promotions`

**File:** `pages/dashboard/PromotionsPage.tsx` + `PromotionRedemptionsDialog.tsx` · **Purpose:** discounts (BOGO / % off / fixed / free item) with optional codes, recurrence, redemptions.

- **UI:** status tabs (Active/Scheduled/Draft/Expired/Paused); cards (type badge, promo code, redemptions, usage bar, "View bookings"); `PromoFormDrawer` (type-driven fields, item eligibility, date + time-of-day windows, recurrence config); `PromotionRedemptionsDialog` (reservations by `promotion_id`).
- **Hooks:** `usePromotions()`, `usePromotionRedemptions(promotionId)`, `useMenuItems()`.
- **Backend — table:** `promotions` (promo_type, discount_value/unit, applies_to, min_order_amount, starts/ends_at, time-of-day, promo_code, max_uses/current_uses, bogo/free/eligible item ids, recurrence_*, media_*). Redemptions via `reservations.promotion_id`. **Storage:** `event-media`.
- **Notes:** status derived from `is_active` + time logic; `promo_type` drives which fields apply; code format `^[A-Z0-9_-]{3,32}$`; code optional (auto-applies at checkout if omitted).

---

## 14. Settings — `/dashboard/settings` & `/dashboard/restaurant`

**File:** `pages/dashboard/SettingsPage.tsx` (~2,900 lines) · **Purpose:** restaurant config + billing + subscription lifecycle.

**Sections:**
1. **Restaurant info** — name, slug, cuisine, business type, address (Google autocomplete → lat/lng), contact, legal name, socials, description, currency, accepts-walkins, dietary tags, logo + cover upload, turn time.
2. **Hours & calendar** — weekly hours grid (time-wheel), special days/closures, seat-capacity total (`useRestaurantSeatTotal`).
3. **Billing** — subscription status card, card-on-file + change (`ChangeSubscriptionCard` via SetupIntent), `BillingDetailsForm` (legal name/address/postal/tax id), `NextBillCard`, `PayoutsSection` (Connect account).
4. **Notifications** — email preference toggles.
5. **Theme** — primary/accent/background colors → `settings_json.theme` + `applyRestaurantTheme()`.
6. **Danger zone** — `DepositPolicyEditor` (→ `deposit_tiers` JSONB; backend RPC `compute_deposit_for_party`); publish/unpublish; pause/resume/cancel subscription; delete.

- **Hooks:** `useStaffRestaurants`, `useUser`, `useRestaurantScope`, `useRestaurantSeatTotal`.
- **Backend — edge fns (trust-boundary cols only via these):** `publish-restaurant`, `recover-restaurant`, `update-subscription-payment-method`, `pause-subscription`, `restart-subscription`, `cancel-subscription`. **Direct `.update()` (non-boundary):** `hours_json`, `settings_json` (theme/dietary), `deposit_tiers`, profile columns.
- **Backend — tables:** `restaurants` (profile + `hours_json` + `settings_json` + `deposit_tiers` + Stripe/subscription/soft-delete cols), `seat_sections`. **RPC:** `compute_deposit_for_party(restaurant_id, party_size)`.
- **Guardrails:** trust-boundary cols (`is_published`, `stripe_charges_enabled`, `subscription_status`, `payment_method_attached_at`, `trial_ends_at`…) are NOT in the client UPDATE grant — edge fns only (direct client writes 403). Deposit tiers must be unique + sorted by `min_party_size`. Soft-delete uses `deleted_at` + `scheduled_purge_at` (30-day grace) + `paused_reason`.

> **`SchedulePage.tsx`** — present in `pages/dashboard/` but **not registered in the router**. It renders the staff roster grouped by employment type with a disabled "staff scheduling coming soon" CTA (`useStaffRoster`). Treat as a placeholder until wired.

---

## 15. Onboarding wizard — `/setup`

**Shell:** `pages/auth/SetupPage.tsx` (`RequireAuth`-only). **Steps:** `components/onboarding/Step1Basics.tsx` … `Step8PaymentSetup.tsx`.

- **Entry modes:** `?new=1` (fresh), `?restaurant_id=X` (resume specific draft), `?step=N`.
- **Persistence:** sessionStorage snapshot `cenaiva.wizard.v1` (cross-step, 24h) + per-step autosave; resume via `loadInProgressRestaurant()` which computes the start step from what's done (hours/tables/shifts/menu/cover/deposit_tiers).

| Step | Collects | Backend on save |
|---|---|---|
| **1 · Basics** | name, business type, address + **postal_code (required, tax)**, GST/HST #, cuisine, E.164 phone, walk-ins, dietary tags, description | **edge fn `signup-restaurant-owner`** → creates/updates `restaurants` (`is_active=true`), seeds starter `tables`, default `shifts`, `user_restaurant_roles(owner)`; honors `force_new`/`restaurant_id`; uniform 200 for existing email |
| **2 · Hours** | per-day open/close (≥1 open day) | direct update `restaurants.hours_json` + sync active `shifts` (days_of_week/start/end) |
| **3 · Floor/tables** | label / capacity(1–30) / shape (≥1 table) | deactivate existing `tables`, insert new active set |
| **4 · Booking rules** | turn time 60/90/120 | upsert active `shifts` (turn_time, slot 15, advance days, `max_covers`) |
| **5 · Menu** | categories (one `is_pricing_tier_source`) + **≥3 priced tier items** | upsert `menu_categories`/`menu_items`; derive + set `restaurants.price_range` |
| **6 · Photos+theme** | **cover photo required** + logo + theme colors | upload to **`event-media`** (`{rid}/restaurant/{kind}/...`); update `cover_photo_url`/`logo_url`/`settings_json.theme` |
| **7 · Deposit policy** | "take deposits" tiers `{min_party_size, amount_per_person_cents}` or none | update `restaurants.deposit_tiers` (NULL / `[]` / tiers) |
| **8 · Payments & publish** | Connect KYC + subscription card + publish | see below |

**Step 8 detail:**
- **Connect KYC:** `create-stripe-account` (Express, CA, `transfers` capability; idempotent, self-syncs `stripe_charges_enabled`/`stripe_payouts_enabled`) → `create-account-link` (hosted URL); returns to `/setup?step=8&stripe=return`, polls until `payouts_enabled`.
- **Subscription card:** `stripe-setup-intent` **Branch A** (`restaurant_id` → restaurant customer; creates `stripe_customer_id`) → `stripe.confirmSetup()` → `save-subscription-payment-method` (attaches PM, sets default, first-attach stamps `payment_method_attached_at`, logs `subscription_consent_log`). No subscription yet — "trial starts when you publish."
- **Publish:** `publish-restaurant` with partner-agreement fields → validates the `STRIPE_SUBSCRIPTION_PRICE_ID` (active, recurring, CAD), creates the subscription `trial_period_days:90` + `automatic_tax:{enabled:true}` (idempotency `publish_{rid}_{YYYYMMDD}_tax_v1`), atomically flips `is_published=true` (race-guarded `WHERE is_published=false`), writes two `subscription_consent_log` rows.

**Publish gate** (server trigger `restaurants_publish_gate` + client check in Step8):
`stripe_charges_enabled` **AND** `cover_photo_url` **AND** (`payment_method_attached_at` OR `subscription_status IN (trialing,active)`) **AND** complete tax address (`postal_code`) **AND** `deleted_at IS NULL`. Missing tax address → `tax_address_incomplete`.

**Pricing:** **$199.99 CAD/mo, 90-day trial anchored to publish day.**

---

## 16. Backend reference (appendix)

### Edge functions used by the owner dashboard / onboarding
`signup-restaurant-owner` · `create-stripe-account` · `create-account-link` ·
`stripe-setup-intent` · `save-subscription-payment-method` ·
`update-subscription-payment-method` · `publish-restaurant` · `recover-restaurant` ·
`pause-subscription` · `restart-subscription` · `cancel-subscription` ·
`cancel-reservation` (`actor:"owner"`) · `refund-deposit-on-arrival` · `notify-no-show` ·
`approve-staff-action` · `invite-staff` · `scan-receipt`.

### RPCs (Postgres functions)
`update_staff_reservation_status` · `seat_staff_reservation` · `create_staff_reservation` ·
`update_table_service_status` · `write_staff_audit_event` · `crm_guest_rows` ·
`send_crm_campaign` · `compute_deposit_for_party`.

### Tables (read/written by owner surfaces)
`restaurants` · `restaurant_sections` · `floor_plans` · `tables` · `reservation_tables` ·
`reservations` · `guests` · `orders` · `order_items` · `menu_categories` · `menu_items` ·
`events` · `promotions` · `reservation_deposit_payments` · `expenses` ·
`recurring_expense_rules` · `receipts` · `restaurant_analytics` · `seat_sections` ·
`user_restaurant_roles` · `user_profiles` · `staff_invitations` · `staff_audit_events` ·
`subscription_consent_log`.

### Storage buckets
`event-media` (restaurant cover/logo, menu-item images, event & promo media — 5 MB cap) ·
`receipts` (expense receipt scans).

### Key guardrails (cross-cutting)
- Trust-boundary `restaurants` columns are edge-fn-only (client direct write → 403).
- Owner cancel = `cancel-reservation` `actor:"owner"`; never raw-flip status via the legacy RPC.
- Owner reservation embed must pin `orders!orders_reservation_id_fkey(...)`.
- All edge fns: zod-validated bodies (`parseJsonBody`), per-user rate limits, JWT via `auth.getUser`.
- Fee model = Option B (2% of food); refunds return food+tax only.

---

*Reference for the canonical web owner dashboard. Companion files: `MOBILE_PARITY_SPEC.md`
(web→mobile gaps), `cenaiva-database.md` (schema/RPC/edge-fn reference), `STRIPE_SETUP.md`.*
