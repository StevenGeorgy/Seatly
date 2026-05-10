# DINER_MOBILE_GUIDE.md

**Version**: 1.1 — 2026-05-09
**Project**: Seatly Cenaiva (`exbjodmnpdiayfzrdyux`, ca-central-1)
**Purpose**: Single source of truth for any mobile (iOS / Android / React Native / Flutter / native) implementation that mirrors the diner-facing surfaces of the Seatly Cenaiva web app.

> **Scope note (v1.1):** This guide intentionally excludes the **Hey Cenaiva voice assistant** feature. The mobile app does NOT mirror the voice pipeline — no wake word, no `cenaiva-orchestrate` calls, no ElevenLabs TTS, no Deepgram STT, no voice preference UI. Mobile consumes the same database / edge functions for booking, reservations, search, and account management only.

---

## ⚠️ READ-ONLY DIRECTIVE — Read Twice

The Seatly Cenaiva database schema, RPCs, edge functions, RLS policies, and triggers are **frozen** for the mobile app's purposes. The mobile app:

- **MUST NOT** create, alter, or drop tables, columns, RPCs, edge functions, or RLS policies.
- **MUST NOT** write to the database via raw INSERT / UPDATE / DELETE on `reservations`, `reservation_tables`, `tables`, `shifts`, `restaurants`, or any owner-controlled table. Even with service-role keys.
- **MUST** route every booking write through the canonical edge functions (`create-public-booking`, `modify-reservation`, `cancel-reservation`) so atomic RPC guards (advisory locks, GiST exclusion constraints, identifier guards, close-time guards, double-book guards) all run.
- **MAY** read from the public-readable subset (restaurants, menus, shifts, reviews, promotions, events) using the standard Supabase JS / Swift / Kotlin client + the project's anon key.
- **MAY** call public RPCs (`get_available_slots_cached`, `restaurant_available_dates`, `restaurant_review_summaries`, `get_available_slots_for_restaurants_compact`) for read-only availability and review aggregation.
- **MAY** subscribe to realtime postgres_changes channels exposed by the `supabase_realtime` publication.

If the mobile app needs a new column, RPC, or behavior, **the change ships in the web codebase first**, gets reviewed against this document, the Postgres `cenaiva-database.md`, and `CLAUDE.md`, then this file is updated. Mobile consumes; never mutates schema.

---

## Table of Contents

1. [Architecture & Tech Stack](#1-architecture--tech-stack)
2. [Authentication & User Context](#2-authentication--user-context)
3. [Database Tables (Diner-Relevant)](#3-database-tables-diner-relevant)
4. [Public RPC Functions](#4-public-rpc-functions)
5. [Edge Functions (HTTP Endpoints)](#5-edge-functions-http-endpoints)
6. [Diner UI Surfaces (mirror these)](#6-diner-ui-surfaces-mirror-these)
   - [6.1 Discover Page](#61-discover-page)
   - [6.2 Deals Page](#62-deals-page)
   - [6.3 Restaurant Preview Modal](#63-restaurant-preview-modal)
   - [6.4 Restaurant Public Page](#64-restaurant-public-page)
   - [6.5 AvailabilityPanel (booking widget)](#65-availabilitypanel-booking-widget)
   - [6.6 My Reservations / Bookings list](#66-my-reservations--bookings-list)
   - [6.7 Reservation Details / Modify / Cancel](#67-reservation-details--modify--cancel)
   - [6.8 Account Page](#68-account-page)
   - [6.9 Auth (Sign-in / Sign-up)](#69-auth-sign-in--sign-up)
   - [6.10 Notifications](#610-notifications)
   - [6.11 Favorites / Saved](#611-favorites--saved)
7. [Booking Lifecycle State Machine](#7-booking-lifecycle-state-machine)
8. [Search, Filters, & Auto-Roll](#8-search-filters--auto-roll)
9. [Realtime Updates](#9-realtime-updates)
10. [Error Code Reference](#10-error-code-reference)
11. [Mobile-Specific Notes & Pitfalls](#11-mobile-specific-notes--pitfalls)
12. [File-Path Index (Web Reference)](#12-file-path-index-web-reference)
13. [Quick-Reference Implementation Order](#13-quick-reference-implementation-order)

---

## 1. Architecture & Tech Stack

| Layer | Tech | Notes |
|-------|------|-------|
| Database | PostgreSQL 15 on Supabase, ca-central-1 | Project ref `exbjodmnpdiayfzrdyux`. Connection is opaque to mobile; use SDK. |
| Realtime | Supabase Realtime (postgres_changes via `supabase_realtime` publication) | Multiplexed per restaurant — never open one channel per card. |
| Auth | Supabase Auth (OAuth + email/password). Sessions are JWTs (ES256). | Mobile reads `access_token` from Supabase SDK and forwards as `Authorization: Bearer <token>` to edge functions. |
| Storage | Supabase Storage for restaurant cover photos, menu item photos, logos. | Public bucket; signed URLs only for owner uploads. |
| Edge Functions | Deno on Supabase Edge Runtime. All booking writes route here. | Set `verify_jwt = false` for diner-facing functions because they self-decode ES256 (gateway rejects ES256 with `UNSUPPORTED_TOKEN_ALGORITHM`). |
| Maps | Google Maps Platform | Single API key per platform. Mobile uses Google Maps SDK. Same `CENAIVA_MAP_STYLES` dark theme. |
| Payment | Stripe Connect (per-restaurant accounts) | Mobile uses Stripe SDK + `stripe-setup-intent` / `stripe-charge-order` edge functions. |

**Repo layout (web reference):**
- `apps/web/` — Vite + React 18 + TypeScript strict + Tailwind + shadcn/ui
- `supabase/functions/` — All edge functions (Deno)
- `supabase/migrations/` — All SQL DDL/DML

**Project ref**: `exbjodmnpdiayfzrdyux` (ca-central-1). Use `https://exbjodmnpdiayfzrdyux.supabase.co` as the Supabase URL.

---

## 2. Authentication & User Context

### 2.1 Sign-in methods

The web app supports two methods. Mobile must mirror at minimum the email/password and OAuth methods; phone OTP is partially implemented and **not active for diner sign-in** today.

1. **Email + password**
   - Form: `email`, `password`.
   - Call: `supabase.auth.signInWithPassword({ email, password })`.
   - Returns: `{ session, user }` with `session.access_token` (JWT).
2. **Google OAuth**
   - Call: `supabase.auth.signInWithOAuth({ provider: 'google', redirectTo })`.
   - Mobile: use the platform's OAuth deep-link redirect.
3. **Email magic link / phone OTP** — `prepare-phone-login` edge function exists, but **not currently wired into the diner sign-in UI**. Do not implement on mobile yet.

### 2.2 Sign-up

- Form: `full_name`, `email`, `password`, `confirm_password`.
- Call: `supabase.auth.signUp({ email, password, options: { data: { full_name }, emailRedirectTo } })`.
- Email verification required. After click, the redirect path runs `loadUserContext` (creates / fetches `user_profiles` row, fetches saved cards, etc.).

### 2.3 `auth.users` ↔ `user_profiles` linkage

Every auth user has exactly one `user_profiles` row, linked by:
- `user_profiles.auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE`
- `user_profiles.id UUID` — separate identity key used as the **diner's foreign key everywhere else** (`reservations.user_profile_id`, `guests.user_profile_id`, `saved_cards.user_profile_id`, `notifications.user_id`).
- `auto-create trigger` on first sign-in inserts a minimal `user_profiles` row with `role='customer'`.

**Mobile rule:** after sign-in, fetch `user_profiles` keyed by `auth_user_id = auth.uid()`, **cache `user_profiles.id`**, and use that ID for every downstream call.

```sql
select id, full_name, phone, email, avatar_url, role, birthday,
       dietary_restrictions, allergies, seating_preference, noise_preference,
       notification_preferences_json, stripe_payment_method_id,
       expo_push_token, preferred_locale
from user_profiles
where auth_user_id = auth.uid();
```

### 2.4 JWT requirements per edge function

Diner-relevant edge functions only (voice functions are out of scope for this guide).

| Edge function | `verify_jwt` setting | Mobile must send Bearer JWT |
|---|---|---|
| `create-public-booking` | false | Optional (logged-in: yes for double-book pre-check; guest: no) |
| `modify-reservation` | false | Yes OR provide `confirmation_code` in body |
| `cancel-reservation` | false | Yes OR provide `confirmation_code` in body |
| `prepare-phone-login` | false | No |
| `get-availability` | false | Optional |
| `stripe-setup-intent` | false | Yes |
| `stripe-charge-order` | false | Yes |
| `stripe-list-methods` | false | Yes |

**ES256 quirk:** Supabase issues ES256 JWTs (the new sb_publishable / sb_secret format). The Supabase gateway rejects ES256 with `UNSUPPORTED_TOKEN_ALGORITHM` if `verify_jwt = true`. For booking functions we set `verify_jwt = false` and decode the JWT inside the function. **Never flip these to `verify_jwt = true`** — mobile will silently lose auth.

### 2.5 RLS overview (read-only summary)

Only the diner-relevant RLS rules are listed here. Owner/staff RLS is documented in `cenaiva-database.md`.

| Table | SELECT (diner) | INSERT/UPDATE/DELETE (diner) |
|---|---|---|
| `restaurants` | Public if `is_active = true` | None (owner-only) |
| `menu_items` | Public if `is_active = true AND is_available = true` | None |
| `menu_categories` | Public if `is_active = true` | None |
| `shifts` | Public if `is_active = true` | None |
| `tables` | Public if `is_active = true` | None |
| `reviews` | Public for read | INSERT own (`auth.uid()`-scoped) |
| `events` | Public if `is_active = true` | None |
| `promotions` | Public if `is_active = true` | None |
| `reservations` | Own (`user_profile_id` ↔ `user_profiles.auth_user_id = auth.uid()`) OR via `confirmation_code` lookup through edge functions | None (use edge functions only) |
| `notifications` | Own (`user_id = user_profiles.id` via auth) | UPDATE `is_read` only |
| `saved_cards` | Own | INSERT/UPDATE/DELETE own |
| `user_profiles` | Own | UPDATE own (limited fields) |
| `guests` | Owner-only (denormalized; mobile reads `reservation.guest_full_name/email/phone` instead) | None |

---

## 3. Database Tables (Diner-Relevant)

All tables are in the `public` schema.

### 3.1 `restaurants`

The single most important table for the diner. Public-readable when `is_active = true`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Primary key. |
| `name` | text | Display name. |
| `slug` | text NOT NULL UNIQUE | URL slug (e.g. `mark-testing`). Mobile may deep-link via slug. |
| `logo_url` | text | Square logo. |
| `cover_photo_url`, `cover_image_url` | text | Cover banner. `cover_photo_url` is preferred. |
| `cuisine_type` | text | "Mediterranean", "Egyptian", "Italian", etc. |
| `business_type` | text | Venue STYLE: cafe, bistro, bar, brewery, deli, bakery, lounge, pub, coffee shop, restaurant. |
| `description` | text | Long-form prose description. |
| `address`, `city`, `province`, `country` | text | |
| `phone`, `email`, `website` | text | Contact info. |
| `lat`, `lng` | numeric | Latitude/longitude (geocoded server-side). Used by Discover map and distance sorting. |
| `hours_json` | jsonb | Per-day hours map: `{ monday: { open: '11:00', close: '22:00' }, ... }` plus optional `closures: [{ date: '2026-12-25', reason: 'Christmas' }]`. |
| `settings_json` | jsonb | Misc settings, including `dietaryTags: ['halal','kosher','vegan','gluten_free','dairy_free','nut_free','vegetarian']` array used by Discover filters. |
| `timezone` | text | IANA tz string (e.g. `America/Toronto`). **Critical** — every booking time computation derives from this. |
| `currency` | text | "CAD", "USD", etc. |
| `tax_rate` | numeric | Tax % applied to orders/preorders. |
| `price_range` | int (1\|2\|3) | Owner-set price hint. **NOT used by the diner price meter** — mobile must derive from menu (see §6.1.2). |
| `avg_rating`, `total_reviews` | numeric / int | Cached aggregate from reviews. Re-derived via `restaurant_review_summaries` RPC for fresh values. |
| `accepts_walkins` | boolean | Used as a filter chip ("Walk-ins accepted"). |
| `cancellation_hours` | int | Owner policy hint (default 24). Mobile displays as info; **not enforced** in `cancel-reservation`. |
| `no_show_fee` | numeric | Owner policy hint. Not auto-charged. |
| `booking_advance_days` | int | Maximum advance days (per-restaurant cap). Defaults to per-shift `advance_booking_days` which is currently `3650` (10 years) for all active shifts. |
| `is_active` | boolean | Diner reads only `is_active = true`. |
| `has_bar` | boolean | UI hint. |
| `current_shift_briefing` | text | Owner-only. |
| `deposit_policy_json`, `loyalty_config_json` | jsonb | Owner config; mobile may surface deposits in booking flow if non-empty. |
| `created_at` | timestamptz | |

**Diner read example:**
```ts
const { data } = await supabase
  .from('restaurants')
  .select('*')
  .eq('is_active', true)
  .order('avg_rating', { ascending: false, nullsFirst: false });
```

### 3.2 `shifts`

Per-restaurant booking windows. The diner indirectly consumes this via `get_available_slots_cached`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `restaurant_id` | uuid FK | |
| `name` | text | "Lunch", "Dinner", "Saturday service" — staff-facing. |
| `display_name` | text | Optional diner-facing label. |
| `days_of_week` | int[] | 0-6 Sunday–Saturday. `[5]` = Friday only; `[0,1,2,3,4,5,6]` = every day. |
| `start_time`, `end_time` | time | Local to restaurant tz. Same-day only; overnight (start > end) is **not yet supported by `get_available_slots`**. |
| `slot_duration_minutes` | int | Slot increment (default 15). |
| `turn_time_minutes` | int | How long a booking holds the table (default 90). |
| `max_covers` | int | Concurrent diners cap for this shift. |
| `min_party_size`, `max_party_size` | int | Range. |
| `advance_booking_days` | int | Lead time cap. Currently 3650 on all active shifts (effectively unlimited). |
| `blackout_dates` | date[] | Specific closures. |
| `is_active` | boolean | Diner reads only `is_active = true`. |
| `vip_early_access_hours` | int | VIP pre-booking window (not currently surfaced to mobile). |

**Diner rule:** never query `shifts` directly to compute slots. Always use `get_available_slots_cached` (RPC) — it handles the joins, blackouts, capacity, table availability, and close-time guards atomically.

### 3.3 `tables`

Physical tables in the restaurant. The diner consumes table info **only as part of a reservation** (which tables were assigned). Direct diner access is not needed beyond aggregate seat capacity.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `restaurant_id` | uuid FK | |
| `table_number`, `label` | text | Display label. `label` is preferred when set. |
| `capacity` | int | Seats. |
| `min_party` | int | Smallest party allowed (avoids seating 1 at a 10-top). |
| `section`, `section_id` | text / uuid | Indoor/Patio/etc. |
| `position_x`, `position_y` | double precision | Floor plan coordinates. Mobile usually doesn't render the floor plan; staff uses it. |
| `shape` | text | "round", "square", "rectangle". |
| `combined_with` | uuid[] | Tables currently combined into a group (set by host). |
| `seated_count`, `status` | int / text | Live table state ("empty", "seated", "blocked"). |
| `is_active` | boolean | |

**Aggregate seat capacity** for an active restaurant: `sum(tables.capacity) where is_active = true`. The hook `useRestaurantSeatTotal(restaurantId)` exposes this; mobile can compute equivalently or call a future RPC if added.

### 3.4 `menu_categories`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `restaurant_id` | uuid FK | |
| `name` | text NOT NULL | "Mains", "Starters", "Drinks", etc. |
| `name_fr` | text | French translation. |
| `description` | text | |
| `sort_order` | int | Display order. |
| `is_active` | boolean | |
| `available_from`, `available_to` | time | Optional time-of-day window (e.g. lunch-only). |

**Important:** the diner price meter (web `RestaurantPriceMeter` + `deriveRestaurantPriceLevel`) recognizes the **literal category names** `Mains`, `Main`, `Entrée`, `Entrées`, `Entree`, `Entrees` (case-insensitive, accent-insensitive) for median price computation. Other category names are NOT counted toward the price meter.

### 3.5 `menu_items`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `restaurant_id` | uuid FK | |
| `name` | text NOT NULL | |
| `name_fr` | text | |
| `description`, `description_fr` | text | |
| `price` | numeric NOT NULL | In restaurant's `currency`. |
| `category` | text | **Legacy denormalized string**. Newer items use `category_id` FK. Both populated when known. |
| `category_id` | uuid FK → menu_categories | |
| `photo_url` | text | |
| `allergens` | text[] | "peanut", "dairy", "gluten", "shellfish", "egg", "soy", "tree_nut", "sesame", "fish", "wheat". |
| `dietary_flags` | text[] | "vegan", "vegetarian", "gluten_free", "dairy_free", "halal", "kosher", "nut_free", "low_carb", "spicy". |
| `preparation_time_minutes`, `spice_level` | int / text | |
| `pairing_suggestions` | text | |
| `loyalty_points_value`, `cost_price` | int / numeric | |
| `calories`, `protein_g`, `carbs_g`, `fat_g` | int / numeric | Nutrition if entered. |
| `is_available`, `is_active`, `is_featured`, `is_preorderable` | boolean | Diner reads only `is_active = true AND is_available = true`. `is_preorderable` gates preorder UI. |
| `sort_order` | int | |

**Diner read for full menu of one restaurant:**
```ts
const { data: items } = await supabase
  .from('menu_items')
  .select('*')
  .eq('restaurant_id', restaurantId)
  .eq('is_active', true)
  .eq('is_available', true);
```

### 3.6 `reservations`

The center-of-gravity table. The diner reads their own; writes go through edge functions only.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `restaurant_id` | uuid FK | |
| `guest_id` | uuid FK → guests | Denormalized owner-side guest record. |
| `user_profile_id` | uuid FK → user_profiles | NULL for guest checkouts. |
| `is_guest_checkout` | boolean NOT NULL | True if booked without account. |
| `guest_full_name`, `guest_email`, `guest_phone` | text | Denormalized from `guests`. |
| `table_id` | uuid FK → tables | Denormalized "primary" table for the group. The full set is in `reservation_tables`. |
| `shift_id` | uuid FK → shifts | |
| `party_size` | int NOT NULL CHECK ≥ 1 | |
| `reserved_at` | timestamptz NOT NULL | UTC instant. Convert to restaurant tz for display. |
| `duration_minutes` | int NOT NULL | Defaults to shift `turn_time_minutes` (90). |
| `slot_range` | tstzrange NOT NULL | `[reserved_at, reserved_at + duration_minutes)`. **Trigger-set on insert.** Used by GiST exclusion constraints. |
| `status` | text | One of: `pending`, `confirmed`, `seated`, `completed`, `cancelled`, `no_show`. CHECK constraint enforced. |
| `source` | text | `web`, `app`, `voice`, `staff`, `api`. Mobile sends `app`. |
| `confirmation_code` | text | 8-hex auto-generated by `reservations_confirmation_code` trigger on INSERT. **Always overrides input.** Used for self-serve modify/cancel without auth. |
| `special_request` | text | Free-form diner request ("window seat", "high chair please"). |
| `dietary_notes` | text | Staff-set; not editable by diner. |
| `internal_notes` | text | Staff audit log; not visible to diner. |
| `occasion` | text | "birthday", "anniversary", "date", "business", etc. |
| `confirmed_at`, `checked_in_at`, `seated_at`, `completed_at`, `cancelled_at`, `checked_out_at` | timestamptz | Per-status timestamps. |
| `cancellation_reason` | text | "Cancelled by diner", "Cancelled by staff", or restaurant-specific reasons. |
| `no_show_risk_score` | int 0–100 | ML score (owner-side). Not displayed to diner. |
| `no_show_fee_charged` | boolean | |
| `waiter_id` | uuid FK → user_profiles | Assigned server (owner-side). |
| `deposit_amount`, `deposit_status`, `deposit_stripe_payment_intent_id` | numeric / text / text | Deposit fields if restaurant requires one. |
| `reminder_sent_24h`, `reminder_sent_2h` | boolean | Reminder flags. |
| `preorder_order_id` | uuid FK → orders | If diner pre-ordered menu items. |
| `order_type` | text | "dine_in", "takeout", "preorder". Diners default to `dine_in`. |
| `created_at`, `updated_at` | timestamptz | |

**CHECK and EXCLUDE constraints:**
- `reservations_status_valid` — `status IN ('pending','confirmed','seated','completed','cancelled','no_show')`.
- `reservations_must_have_identifier` — at least one of `user_profile_id`, `guest_email`, `guest_phone` must be non-empty.
- `reservations_user_no_overlap`, `reservations_guest_email_no_overlap`, `reservations_guest_phone_no_overlap` — partial GiST exclusions on `slot_range` for status ∈ {pending, confirmed, seated}, preventing diner double-book.
- `reservation_tables_no_overlap` (on `reservation_tables`) — prevents two reservations from holding the same table at overlapping times.

### 3.7 `reservation_tables`

Junction between reservations and tables. Mobile usually doesn't query this directly — `book_reservation` returns `table_ids[]`, and modifications go through `modify_reservation_slot`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `restaurant_id`, `reservation_id`, `table_id` | uuid FK | |
| `is_primary` | boolean NOT NULL | True for the first table in a group. Denormalized to `reservations.table_id`. |
| `slot_range` | tstzrange NOT NULL | Same as parent reservation's range. |
| `released_at` | timestamptz | NULL = active. Modifications mark old rows `released_at = now()` (soft delete). |
| `created_at` | timestamptz | |

### 3.8 `guests`

Owner-side CRM record. Diner does NOT read this directly. The denormalized fields on `reservations` (`guest_full_name`, `guest_email`, `guest_phone`) are sufficient.

Selected columns (full list in `cenaiva-database.md`): `id`, `restaurant_id`, `user_profile_id`, `full_name`, `email`, `phone`, `birthday`, `anniversary`, `tags`, `dietary_restrictions`, `allergies`, `seating_preference`, `noise_preference`, `loyalty_points_balance`, `loyalty_tier`, `is_vip`, `is_blocked`, `total_visits`, `total_spend`, `no_show_count`, `cancellation_count`, `last_visit_at`, `first_visit_at`.

**Mobile rule:** never write to `guests`. The booking edge functions and `canonical_guest_id` RPC handle guest record dedupe + insert atomically.

### 3.9 `user_profiles`

Diner's own record. Mobile reads + writes own row only.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Used as FK in `reservations`, `guests`, `notifications`, `saved_cards`. |
| `auth_user_id` | uuid UNIQUE FK → auth.users | Linked at signup. |
| `full_name`, `phone`, `email` | text | Editable by diner. |
| `avatar_url` | text | |
| `role` | text NOT NULL | `customer` for diners. Owner/staff have other values. |
| `restaurant_id` | uuid | NULL for diners (used by staff). |
| `birthday` | date | |
| `dietary_restrictions`, `allergies` | text[] | "vegan", "gluten_free", etc. |
| `seating_preference` | text | "booth", "window", "patio", "bar". |
| `noise_preference` | text | "quiet", "lively", "any". |
| `preferred_language`, `preferred_locale` | text | |
| `notification_preferences_json` | jsonb | `{ email: true, sms: true, push: true, marketing: false, reminders: true }`. |
| `car_details_json` | jsonb | For valet: `{ make, model, color, plate }`. |
| `stripe_payment_method_id`, `stripe_customer_id` | text | Stripe references. |
| `expo_push_token` | text | **Mobile populates this** with the Expo / FCM / APNS push token. |
| `created_at` | timestamptz | |

> The `cenaiva_tts_voice` column exists on this table but is owned by the web's voice assistant feature. **Mobile should not read or write it** — it's not relevant outside the voice flow.

### 3.10 `reviews`

Public-readable. Diner can write own (`auth.uid()`-scoped INSERT).

(Schema omitted for brevity — read via `restaurant_review_summaries` RPC for aggregates and direct table read for individual reviews.)

### 3.11 `events`

Restaurant-hosted events (tasting menus, prix fixe nights, parties).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `restaurant_id` | uuid FK | |
| `name`, `description` | text | |
| `date`, `start_time`, `end_time`, `end_date` | date / time | When the event runs. |
| `price_per_person` | numeric | |
| `capacity`, `tickets_sold` | int | Capacity tracking. |
| `is_recurring`, `recurrence_rule` | boolean / text | |
| `cover_image_url`, `media_url`, `media_type`, `media_name` | text | |
| `min_age`, `dress_code`, `theme` | int / text | |
| `is_active`, `is_private` | boolean | Diner reads only `is_active = true AND is_private = false`. |
| `menu_id`, `stripe_product_id` | uuid / text | |

### 3.12 `promotions`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `restaurant_id` | uuid FK | |
| `title`, `description` | text | |
| `promo_type` | text | "percentage", "amount", "bogo", "free_item". |
| `discount_value`, `discount_unit` | numeric / text | |
| `applies_to` | text | "all", "category", "items". |
| `eligible_item_ids`, `bogo_item_ids` | uuid[] | |
| `free_item_id`, `free_item_name` | uuid / text | |
| `buy_quantity`, `get_quantity` | int | For BOGO. |
| `starts_at`, `ends_at`, `recurrence_end_at` | timestamptz | |
| `is_recurring`, `recurrence_frequency`, `recurrence_interval`, `recurrence_days` | bool / text / int / int[] | |
| `is_active`, `is_private` | boolean | Diner reads only `is_active = true AND is_private = false`. |
| `min_order_amount`, `max_uses`, `current_uses` | numeric / int | |
| `promo_code` | text | Optional code-redeem promotions. |
| `badge_color` | text | Hex for the colored badge on the deal card. |
| `cover_image_url`, `media_url`, `media_type`, `media_name` | text | |
| `created_at` | timestamptz | |

### 3.13 `notifications`

Per-diner notification feed. Mobile reads + marks `is_read`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → user_profiles.id | NOT auth_user_id. |
| `restaurant_id` | uuid FK | Optional. |
| `type` | text | `booking_confirmed`, `booking_reminder`, `booking_cancelled`, `booking_modified`, `promotion_alert`, `event_alert`, `review_request`, `system`. |
| `title`, `body` | text | Display strings. |
| `data` | jsonb | Type-specific payload (e.g. `{ reservation_id, restaurant_id, deep_link }`). |
| `is_read` | boolean | Diner UPDATEs to `true` on tap. |
| `sent_push` | boolean | Server tracks if push was delivered. |
| `created_at` | timestamptz | |

**Realtime channel:** `notifications:user_id=eq.{user_profile_id}`.

### 3.14 `saved_cards`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_profile_id` | uuid FK | |
| `stripe_payment_method_id` | text | |
| `brand`, `last4` | text NOT NULL | "visa", "mastercard", etc. |
| `exp_month`, `exp_year` | int | |
| `is_default` | boolean NOT NULL | Only one row per user has `is_default = true` (enforced application-side). |
| `created_at` | timestamptz | |

Mobile reads + manages via `stripe-setup-intent`, `stripe-list-methods`, and direct DELETE for removal.

### 3.15 Tables NOT relevant to diners

The following tables exist in the schema but are owner/staff-only. Mobile must NOT query them: `staff_invitations`, `host_invitations`, `analytics_*`, `audit_events`, `accountant_exports`, `staff_actions`, `floor_plan_revisions`, `kitchen_orders`, `tickets`, `waitlist` (owner-side only — there is no diner waitlist UI today), `automated_payouts`, `subscription_events`, `restaurant_payouts`, `dish_metrics`, `loyalty_*` (except `guests.loyalty_*` which mobile never writes), `allergy_incidents`, `recipes`, `nutrition_*`, `inventory_*`, `pos_*`. Additional confirmation in `cenaiva-database.md`.

---

## 4. Public RPC Functions

These are PostgreSQL functions exposed via PostgREST. Call via `supabase.rpc('<name>', { ...args })`.

### 4.1 `get_available_slots_cached`

Primary read for the booking calendar. Wraps `get_available_slots` with a 20-second TTL UNLOGGED cache table — multiple diners hitting the same restaurant/date/party in a 20s window get one DB compute.

**Signature:**
```sql
get_available_slots_cached(
  p_restaurant_id uuid,
  p_date text,             -- YYYY-MM-DD in restaurant local tz
  p_party_size int
) returns jsonb
```

**Returns:**
```json
{
  "slots": [
    { "shift_id": "uuid", "shift_name": "Dinner", "date_time": "ISO8601", "table_ids": ["uuid",...], "duration_minutes": 90 }
  ],
  "floor_capacity": 100,
  "configured_hours_window": "17:00 to 23:00",
  "unavailable_reason": null | "closed" | "fully_booked" | "no_future_slots",
  "message": null | "string"
}
```

**Mobile usage:**
```ts
const { data } = await supabase.rpc('get_available_slots_cached', {
  p_restaurant_id: restaurantId,
  p_date: '2026-05-10',           // YYYY-MM-DD local to restaurant tz
  p_party_size: 2,
});
```

The web client also has a 10-second client-side cache layer on top (`apps/web/src/hooks/useAvailability.ts:AVAILABILITY_CACHE_TTL_MS = 10_000`). Mobile should mirror this — repeated requests within 10 seconds for the same `(restaurantId, date, partySize, time)` triple return cached values, avoiding re-fetching when the user is just adjusting the time pill.

### 4.2 `get_available_slots_for_restaurants_compact`

Batched availability for many restaurants at once (Discover and Deals pages). Returns the first 6 future slots per restaurant, stripping `table_ids` to save bandwidth.

**Signature:**
```sql
get_available_slots_for_restaurants_compact(
  p_restaurant_ids uuid[],
  p_date text,            -- YYYY-MM-DD
  p_party_size int,
  p_now timestamptz        -- usually now() so server filters past slots
) returns jsonb
```

**Returns:**
```json
{
  "<restaurant_id>": [{ "shift_id": "uuid", "date_time": "ISO8601", "duration_minutes": 90 }, ...],
  ...
}
```

Use this for grid views that render slot pills next to many restaurant cards. Web `fetchDisplayAvailabilitySlotsForRestaurants` (`apps/web/src/lib/customer/availabilityFilters.ts`) is the canonical caller.

### 4.3 `restaurant_available_dates`

Returns dates within a range that have at least one available slot for the given party size. Used to grey out fully-booked dates in the calendar.

**Signature:**
```sql
restaurant_available_dates(
  p_restaurant_id uuid,
  p_party_size int,
  p_start_date date,
  p_end_date date
) returns text[]            -- array of YYYY-MM-DD strings
```

**Mobile rule for empty vs null:** if the RPC returns an **empty array**, every date in the range is closed → grey out all. If the RPC errors or you haven't called it yet, do NOT grey anything (calendar stays permissive). This was caught 2026-05-09 — see CLAUDE.md "Calendar empty-set vs null distinction".

### 4.4 `restaurant_review_summaries`

Aggregate review data per restaurant (cheaper than re-deriving from `reviews`).

**Signature:**
```sql
restaurant_review_summaries(p_restaurant_ids uuid[])
returns table(restaurant_id uuid, avg_rating numeric, total_reviews int)
```

### 4.5 `book_reservation`

The atomic write for new bookings. **Mobile should NOT call this directly** — call the `create-public-booking` edge function instead, which wraps this with rate-limiting, identifier validation, and Twilio/Resend confirmation send. Documented for completeness.

**Signature** (current as of migration `20260509230000_booking_close_time_and_confirmation_return.sql`):
```sql
book_reservation(
  p_restaurant_id uuid,
  p_shift_id uuid,
  p_reserved_at timestamptz,
  p_party_size int,
  p_turn_minutes int,
  p_guest_id uuid,
  p_user_profile_id uuid,
  p_confirmation_code text,
  p_source text default 'web',
  p_special_request text default null,
  p_dietary_notes text default null,
  p_occasion text default null,
  p_is_guest_checkout boolean default false,
  p_guest_full_name text default null,
  p_guest_email text default null,
  p_guest_phone text default null,
  p_status text default 'pending'
) returns table(
  reservation_id uuid,
  confirmation_code text,
  table_ids uuid[],
  duration_minutes int
)
```

**Behavior** (do not bypass):
1. Acquires advisory lock on hash of `(restaurant_id, reserved_at)` so two concurrent bookings for the same instant serialize.
2. Validates shift exists and is active.
3. Validates `party_size` ≤ remaining cover capacity.
4. Validates close-time (P0008): `reserved_at + turn_minutes ≤ shift.end_time` and `reserved_at ≥ shift.start_time`.
5. Validates identifier present (P0007): at least one of `user_profile_id`, `guest_email`, `guest_phone` non-empty.
6. Pre-checks diner double-book (P0006): no existing active reservation for same diner with overlapping `slot_range`.
7. Calls `find_available_table_group` to locate tables.
8. Inserts into `reservations` and `reservation_tables`.
9. Returns the **trigger-persisted** `confirmation_code` (overrides input) plus `table_ids` and `duration_minutes`.

**Errors raised** (caught by edge function and mapped to HTTP):
- `P0001 / no_table` — no table fits the party at this slot.
- `P0002 / over_cover_cap` — party_size pushes shift over `max_covers`.
- `P0003 / shift_not_found`.
- `P0006 / diner_double_book` — diner has another active reservation in this window.
- `P0007 / missing_identifier`.
- `P0008 / past_shift_close`.
- `23P01` — exclusion constraint violation (backstop if pre-check is bypassed).

### 4.6 `modify_reservation_slot`

Atomic modify — releases old tables, finds new tables, updates reservation. Mobile uses the `modify-reservation` edge function which wraps this.

**Signature:**
```sql
modify_reservation_slot(
  p_reservation_id uuid,
  p_restaurant_id uuid,
  p_shift_id uuid,
  p_new_reserved_at timestamptz,
  p_new_party_size int,
  p_turn_minutes int
) returns table(
  out_reservation_id uuid,
  out_table_ids uuid[],
  out_duration int
)
```

**Errors:** Same as `book_reservation` plus `P0004` (only pending/confirmed reservations can be modified) and `P0005` (reservation not found).

### 4.7 `release_reservation_tables`

Atomic table release — soft-deletes `reservation_tables` rows (sets `released_at = now()`) and resets `tables.status` to `empty`. Mobile uses via `cancel-reservation` edge function.

**Signature:**
```sql
release_reservation_tables(p_reservation_id uuid) returns uuid[]
```

### 4.8 `find_available_table_group`

Internal helper used by `book_reservation` and `modify_reservation_slot`. Mobile does NOT call directly. Documented for understanding.

**Signature:**
```sql
find_available_table_group(
  p_restaurant_id uuid,
  p_reserved_at timestamptz,
  p_party_size int,
  p_turn_minutes int default 90,
  p_exclude_reservation_id uuid default null,
  p_adjacency_distance double precision default 170
) returns uuid[]
```

Tries (1) single table ≥ capacity, (2) adjacent pair within 170px, (3) adjacent triple. Returns empty array if no fit, which `book_reservation` translates to P0001.

### 4.9 `restaurant_floor_capacity` and `restaurant_turn_time_minutes`

Helper RPCs used by the edge functions. Mobile may also call:

```sql
restaurant_floor_capacity(p_restaurant_id uuid) returns int  -- sum of active table capacities
restaurant_turn_time_minutes(p_restaurant_id uuid, p_shift_id uuid) returns int  -- shift override or default 90
```

### 4.10 `canonical_guest_id`

Finds-or-creates a `guests` row, deduplicating by email/phone within a restaurant. Mobile does NOT call directly — `create-public-booking` calls it internally.

---

## 5. Edge Functions (HTTP Endpoints)

All edge functions are at `https://exbjodmnpdiayfzrdyux.supabase.co/functions/v1/<function-slug>`. Send `apikey: <publishable_anon_key>` header on every request.

### 5.1 `create-public-booking` (POST)

The canonical write for new diner bookings.

**Auth:** Optional `Authorization: Bearer <jwt>`. With JWT, the diner double-book pre-check runs against their full reservation history. Without JWT, treated as guest checkout.

**Request body:**
```ts
{
  restaurant_id: string,                 // UUID, REQUIRED
  shift_id: string,                      // UUID, REQUIRED
  date_time: string,                     // ISO 8601 UTC, REQUIRED
  party_size: number,                    // ≥1, REQUIRED
  guest_name: string,                    // REQUIRED
  guest_email?: string,                  // at least one of email or phone REQUIRED
  guest_phone?: string,                  // North American format
  allergies?: string,                    // comma-separated, optional
  seating_preference?: string,           // optional
  occasion?: string,                     // optional ("birthday", etc.)
  confirmation_code?: string,            // optional; trigger overrides anyway
  cart_items?: Array<{                   // optional preorder
    menu_item_id?: string,
    name: string,
    quantity: number,
    unit_price: number,
  }>,
  subtotal?: number,
  tax_amount?: number,
  tip_amount?: number,
  total_amount?: number,
  discount_amount?: number,
  discount_reason?: string,
  promotion_id?: string,
  payment_method?: string,               // default "card"
}
```

**Response on success (200):**
```json
{
  "reservation_id": "uuid",
  "order_id": "uuid | null",
  "confirmation_code": "ABC12DEF",
  "table_ids": ["uuid", ...],
  "duration_minutes": 90,
  "confirmation_delivery": "sent" | "failed" | "skipped",
  "confirmation_delivery_channel": "sms" | "email" | null
}
```

**Errors:**
- 409 with `unavailable_reason: "rate_limited"` — 20/min per IP+user exceeded.
- 409 with `unavailable_reason: "slot_taken"` — P0001 from RPC.
- 409 with `unavailable_reason: "over_cover_cap"` — P0002.
- 400 with `unavailable_reason: "shift_not_found"` — P0003.
- 409 with `unavailable_reason: "diner_double_book"` — P0006 (or 23P01 backstop).
- 400 with `unavailable_reason: "missing_identifier"` — P0007.
- 409 with `unavailable_reason: "past_shift_close"` — P0008.
- 409 with `unavailable_reason: "closed"` — restaurant has a `hours_json.closures` entry for that date.
- 409 with `unavailable_reason: "no_floor_capacity"` — restaurant has zero active tables.
- 200 with `reused: true` — exact-match idempotency; same email/phone+restaurant+slot+party already exists in pending/confirmed/seated → returns existing reservation.

**Mobile UX guidance:** map every `unavailable_reason` to a user-friendly message. For `slot_taken` re-fetch slots and ask the diner to pick again; for `diner_double_book` show the existing booking with a "modify or cancel" CTA; for `past_shift_close` re-fetch slots (it shouldn't happen if `get_available_slots_cached` is your source).

### 5.2 `modify-reservation` (POST)

Modify slot (date/time/party) or special request on an existing reservation.

**Auth:** Either `Authorization: Bearer <jwt>` (must own reservation via `user_profile_id`) OR `confirmation_code` in body (case-insensitive, no JWT needed). 401 if neither.

**Request body:**
```ts
{
  reservation_id: string,            // UUID, REQUIRED
  date?: string,                     // YYYY-MM-DD (one of date OR full datetime)
  time?: string,                     // HH:MM 24h or "h:mma"
  party_size?: number,
  special_request?: string,
  confirmation_code?: string,        // for guest auth
}
```

**Response on success (200):**
```json
{
  "ok": true,
  "reservation_id": "uuid",
  "reserved_at": "ISO8601",
  "party_size": 4,
  "special_request": "high chair",
  "table_ids": ["uuid", ...],
  "notification_delivery": "sent" | "failed" | "skipped",
  "notification_delivery_channel": "sms" | "email" | null
}
```

**Errors:**
- Same set as `create-public-booking` plus:
- 400 with `unavailable_reason: "not_modifiable"` — P0004 (status not in pending/confirmed).
- 404 — P0005 (reservation not found).
- 409 with `unavailable_reason: "rate_limited"` — 15/min per IP+user.

### 5.3 `cancel-reservation` (POST)

Cancel an existing reservation.

**Auth:** Either JWT (must own) OR `confirmation_code` in body. 401 if neither.

**Request body:**
```ts
{
  reservation_id: string,
  confirmation_code?: string,
}
```

**Response on success (200):**
```json
{
  "ok": true,
  "reservation_id": "uuid",
  "status": "cancelled",
  "notification_delivery": "sent" | "failed" | "skipped",
  "notification_delivery_channel": "sms" | "email" | null
}
```

**Errors:**
- 400 — past reservations (`reserved_at < now()`).
- 400 — already cancelled (idempotent; returns 200 with `status: "cancelled"`).
- 409 — rate limited (10/min per IP+user).

**Side effects:**
1. `UPDATE reservations SET status='cancelled', cancelled_at=now(), cancellation_reason='Cancelled by diner'`.
2. `release_reservation_tables(reservation_id)` RPC.
3. SMS/email notification to diner.
4. Deposit (if any) **NOT auto-refunded** — manual process.

### 5.4 `prepare-phone-login` (POST)

Phone OTP flow seed. **Not currently active in diner UI**; mobile may skip.

### 5.5 `get-availability` (POST)

Legacy availability fetch. Web prefers `useAvailability` (RPC-based). Mobile may skip in favor of direct RPC calls (`get_available_slots_cached`).

### 5.6 Stripe family

`stripe-setup-intent`, `stripe-list-methods`, `stripe-charge-order`. Used during preorder checkout. Mobile invokes via Stripe SDK + these endpoints in tandem.

> **Out of scope:** the voice-related edge functions (`cenaiva-orchestrate`, `cenaiva-availability`, `cenaiva-small-prompt`, `elevenlabs-tts`, `deepgram-live-token`) are not part of the mobile app and are not documented here. See `cenaiva-database.md` if you need them.

---

## 6. Diner UI Surfaces (mirror these)

The mobile app must render every surface in this section with **the same data and the same affordances** as the web app. Layout details may differ (web uses sidebars where mobile uses bottom nav, etc.); the data model and interactions must not. The Cenaiva voice assistant is **not mirrored** on mobile.

### 6.1 Discover Page

**Web file:** `apps/web/src/pages/customer/DiscoverPage.tsx`
**Route:** `/` and `/discover`
**Mobile equivalent:** root tab.

#### 6.1.1 Restaurant card (per item)

Each card displays:

| Field | Source | Notes |
|---|---|---|
| Cover image | `restaurants.cover_photo_url` (fallback `cover_image_url`) | 4:3 aspect ratio. |
| Logo (small overlay) | `restaurants.logo_url` | Optional. |
| Restaurant name | `restaurants.name` | Heading. |
| Cuisine | `restaurants.cuisine_type` | Subtitle, e.g. "Mediterranean". |
| Area | `restaurants.city` (fallback `address`) | Subtitle, after cuisine. |
| Price meter | **Derived from menu items** via `deriveRestaurantPriceLevel` (see §6.1.2) | 3 `$` slots, gold-filled where derived. Empty placeholder if no Mains/Entrées categorized. |
| Rating | `restaurants.avg_rating` | 4.6 ★ (5,432) |
| Review count | `restaurants.total_reviews` | |
| Booked-today count | from `restaurant_review_summaries` or stats RPC | "1,200 booked today" |
| Walk-ins badge | `restaurants.accepts_walkins = true` | "Walk-ins accepted" chip |
| Business-type badge | `restaurants.business_type` | E.g. "CAFE" tag in top-left |
| Dietary tags | `restaurants.settings_json.dietaryTags[]` | Up to 3 chips: Halal, Kosher, Vegan, etc. |
| Available slot pills | `get_available_slots_for_restaurants_compact` | First 6 future slots, formatted "7:30pm" |
| Heart (favorite) icon | client-side state (no DB) | |
| Bookmark (save) icon | client-side state (no DB) | |

#### 6.1.2 Price meter rule (CRITICAL — mirror exactly)

The price meter on diner-facing surfaces is derived **solely from menu items**, not from `restaurants.price_range`. See `apps/web/src/lib/restaurant-price-level.ts:deriveRestaurantPriceLevel`.

Algorithm:
1. Filter `menu_items` of the restaurant to those with `is_active = true AND is_available = true AND category_id IS NOT NULL`.
2. Join to `menu_categories` and keep only items whose category name (case- and accent-insensitive) ∈ `{ main, mains, entree, entrees }` (and the category itself is `is_active = true`).
3. Compute median price.
4. Map to level:
   - median < $22 → level 1 ($)
   - median < $55 → level 2 ($$)
   - median ≥ $55 → level 3 ($$$)
5. If no Mains/Entrées items qualify → return null. **The meter component renders a 3-slot placeholder (all outlined, none gold) when null** — owners populate by categorizing items as "Mains" in the dashboard.
6. The owner-set `restaurants.price_range` column is **NOT consulted** for the diner meter.

#### 6.1.3 Filters

| Filter | Type | Source | Notes |
|---|---|---|---|
| Search | text | client-side substring match against `name`, `cuisine_type`, `city`, `area` | |
| Price | multi-select chips: $ / $$ / $$$ | derived (above) | |
| Features | multi-select chips: Vegetarian, Vegan, Gluten-free, Dairy-free, Nut-free, Halal, Kosher, Walk-ins accepted | `settings_json.dietaryTags[]` + `accepts_walkins` | |
| Date | preset (Today, Tomorrow, Saturday) or calendar picker | client | Cap at `addDays(today, 3650)` (10 years out, current `advance_booking_days`). |
| Time | scroll wheel (6:00 AM – 11:30 PM in 30-min increments) | client | Default: closest upcoming half-hour. |
| Party size | scroll wheel (1–25 + "Large group") | client | Default: 2. |
| Radius | 5 / 10 / 25 / 50 / 150 km / Anywhere | client + Haversine | Requires geolocation permission. |
| View toggle | grid / map | client | Map uses Google Maps with `CENAIVA_MAP_STYLES`. |

Filters are applied client-side after the initial `usePublicRestaurants` fetch (which reads ALL active restaurants — the dataset is small enough today that server-side filtering isn't required). Mobile may keep this approach until the active-restaurant count exceeds ~500.

#### 6.1.4 Empty state & auto-roll

Discover hides any restaurant with zero `availableSlots` for the selected date+party+time triple. To prevent an empty-page UX after hours, **the page auto-rolls to the next available date**:

- Trigger condition: `cardsWithSlotsCount === 0 AND isOnDefaultDate (dateId='today' && customDate undefined) AND noFiltersActive AND !availabilityLoading AND autoRollOffsetDays < 14`.
- Action: `setAutoRollOffsetDays(prev => prev + 1)` and re-fetch with `effectiveBookingDate = selectedBookingDate + autoRollOffsetDays days`.
- Reset: as soon as the user manually picks a date or any filter, `autoRollOffsetDays = 0`.
- Banner: when `autoRollOffsetDays > 0 && filtered.length > 0`, render a gold-tinted banner above the list:
  > No availability for Sat, May 9. Showing **Sun, May 10** instead.

Mobile must implement the same triple-condition gate. If filters or a custom date are active, NEVER auto-roll — the user's pick wins.

#### 6.1.5 Realtime invalidation

The web subscribes to `reservations:restaurant_id=eq.{restaurantId}` postgres_changes ONCE per restaurant via the multiplexed registry (`useAvailabilityRealtimeInvalidate` in `useAvailability.ts`). Mobile should do the same — open one channel per visible restaurant, share callbacks, never one channel per card.

### 6.2 Deals Page

**Web file:** `apps/web/src/pages/customer/DealsPage.tsx`
**Route:** `/deals`
**Mobile equivalent:** "Deals" tab.

Same structure as Discover but driven by `useAllActivePromotions()` and `useAllActiveEvents()` instead of `usePublicRestaurants()`.

Each card displays:
- Promotion title or event name + restaurant name + restaurant logo
- Type badge (colored): `Tasting Menu`, `Happy Hour`, `Event`, `Prix Fixe`, `Promotion`, `Wine Dinner`, `Brunch`. Color from `promotions.badge_color`.
- Description (short)
- Price (event `price_per_person` or promotion discount)
- Availability window (date range or "Available now")
- Cover image (`cover_image_url` or `media_url`)

Filters: same set as Discover. Cards click → `EventPromotionDetailDialog` (modal) showing full description + booking CTA.

There is no map view on Deals.

### 6.3 Restaurant Preview Modal

**Web file:** `apps/web/src/components/customer/RestaurantPreviewModal.tsx`
**Trigger:** clicking a restaurant card on Discover or Deals.

#### Sections

1. **Header:** cover photo (full-width, 16:9 mobile / 21:9 web), logo overlay, name, cuisine, area, price meter, avg rating + review count, ❤️ favorite + 🔖 bookmark, ✕ close.
2. **AvailabilityPanel** (see §6.5) — date / time / party / 8 slot pills, embedded under the header.
3. **Tabs**: Menu, Photos, Reviews, About, Events.
   - **Menu tab:** category list → item cards. Each item shows name, description, price, dietary chips, allergen list, photo if present.
   - **Photos tab:** photo gallery from restaurant + menu items.
   - **Reviews tab:** scroll-paginated reviews with reviewer name initials, rating, text, date.
   - **About tab:** hours (formatted), `description`, dietary tags array, phone, address (clickable for maps), website link.
   - **Events tab:** active events for this restaurant (mini `EventPromotionDetailCard` cards).

#### Realtime
- `useAvailability(restaurantId)` opens postgres_changes on `reservations:restaurant_id=eq.{id}` (multiplexed).
- `useRestaurantReviews(restaurantId)` polls; mobile may use realtime on `reviews` table.

#### Closing
- Tap backdrop OR ✕ → `onClose()` callback.
- Mobile: full-screen modal with swipe-down dismiss.

### 6.4 Restaurant Public Page

**Web file:** `apps/web/src/pages/customer/RestaurantPublicPage.tsx`
**Route:** `/r/:slug`
**Trigger:** sharing a restaurant link, deep link, or "View full page" from the preview modal.

A full-page version of the preview modal that ALSO supports a **complete checkout flow** for dine-in + preorder:

- **Step machine:** `details → menu → checkout → confirmed`.
- **details:** the AvailabilityPanel + diner contact form.
- **menu:** browse menu_items, add to cart, see line totals.
- **checkout:** review cart, special requests, occasion, payment method, deposit (if required).
- **confirmed:** confirmation page with code, summary, Add-to-calendar, Share.

The public page ends up calling `create-public-booking` with the cart payload.

### 6.5 AvailabilityPanel (booking widget)

**Web file:** `apps/web/src/components/booking/AvailabilityPanel.tsx`
**Used by:** RestaurantPreviewModal, RestaurantPublicPage, ModifyBookingFields.

#### Inputs (props the parent supplies)

| Prop | Type | Notes |
|---|---|---|
| `restaurantId` | string | |
| `restaurantTimezone` | string | IANA tz. |
| `userProfileId` | string \| null | For conflict-window lookups. |
| `excludeReservationId` | string \| undefined | When in modify flow, skip the reservation being edited. |
| `initialDate`, `initialTime`, `initialPartySize` | Date / string / number | Optional starting values. |
| `onSelectSlot` | `(slot) => void` | Called when user taps a pill. |
| `onStateChange` | `({ date, time, partySize }) => void` | Fires on every control change. |

#### Controls

- **Date**: calendar popover. Disabled dates are past dates AND those returned by `restaurant_available_dates` as not in the array. Calendar caps at `addDays(today, 3650)`.
- **Time**: scroll wheel (`TimeWheel`) with 30-minute granularity. Default: closest upcoming half-hour.
- **Party size**: scroll wheel (`SeatWheel`), 1–25 + Large group. Default: 2.

#### Slot pills

`SLOT_PILL_COUNT = 8`. Pills are windowed around the selected time (3 before, 5 at-or-after, backfilled if not enough). Each pill represents a slot from `get_available_slots_cached` and shows formatted time ("7:30pm").

States:
- **Available**: clickable, gold-tinted on selection.
- **Conflict**: disabled with tooltip explaining the user has another reservation overlapping. Conflict windows come from `useDinerConflictWindows(userProfileId, excludeReservationId)`.

#### Refetch behavior
- `restaurantId`, `date`, or `partySize` change → re-fetch slots.
- `time` change → no refetch; just re-window the existing slot list via `centerSlotsAround`.

### 6.6 My Reservations / Bookings list

**Web file:** `apps/web/src/pages/customer/BookingsPage.tsx` (and supporting hook `apps/web/src/hooks/useMyReservations.ts`)
**Route:** `/bookings`
**Mobile equivalent:** "Reservations" or "Bookings" tab.

#### Sections

Three sections / tabs:
1. **Upcoming** — `status IN ('pending', 'confirmed', 'seated')` AND `reserved_at >= now()`.
2. **Past** — `status IN ('completed', 'cancelled')` OR (`status IN ('pending','confirmed','seated')` AND `reserved_at < now()`).
3. **Cancelled** — `status = 'cancelled'` only.

(Some mobile UIs combine Past + Cancelled into a single "Past" tab — that's fine.)

#### Per-reservation card

| Field | Source |
|---|---|
| Restaurant cover photo + logo | `restaurants.cover_photo_url` / `logo_url` |
| Restaurant name | `restaurants.name` |
| Cuisine + city | `restaurants.cuisine_type` / `city` |
| Date + time | `reservations.reserved_at` formatted in `restaurants.timezone` |
| Party size | `reservations.party_size` |
| Confirmation code | `reservations.confirmation_code` |
| Status badge | derived: "Upcoming" / "Today" / "Past" / "Cancelled" — see `reservationDisplayStatus(r, now)` in `apps/web/src/hooks/useMyReservations.ts` |
| Occasion | `reservations.occasion` (if set) |
| Address (clickable for maps) | `restaurants.address` |
| Phone (clickable for tel:) | `restaurants.phone` |

#### Actions per card

- Tap card → Booking Details page (§6.7).
- "Modify" → opens `ManageBookingView` modal (date / time / party / special_request).
- "Cancel" → confirm dialog → `cancel-reservation` edge function.
- "Share" → native share sheet with confirmation code + details.
- "Directions" → opens platform maps app with `restaurants.address`.

#### Hide rule
The web hook explicitly excludes `status = 'no_show'` rows (`useMyReservations.ts:127`). Mobile must mirror — diners do not see no-shows in their list.

#### Dedup rule
The web hook deduplicates by `(restaurant_id, reserved_at, party_size, status)` in case of legacy duplicates, keeping the oldest `created_at`. Mobile may safely mirror this — duplicates can happen if older `book_reservation` versions had race conditions before advisory locks.

### 6.7 Reservation Details / Modify / Cancel

**Web file:** `apps/web/src/pages/customer/BookingDetailsPage.tsx`
**Route:** `/bookings/:reservationId`

#### Detail view

- Large cover photo header.
- Restaurant info row: name, cuisine, area, phone, address.
- Detail rows: date, time, party size, table/section info (`reservation_tables` joined), status badge, confirmation code (copy-tap), special request.
- Allergies chip if `dietary_notes` set (read-only).
- Cancel button (in header or footer).
- Modify button (opens dialog).

#### Modify dialog (`ModifyBookingFields`)

- Embeds `<AvailabilityPanel>` with `excludeReservationId={reservationId}` so the user's current booking doesn't block their own slot.
- Editable fields: `date`, `time`, `party_size`, `special_request`.
- Submit calls `modify-reservation` edge function.
- On success: toast notification, close dialog, refresh the page data.

**Cannot change:** restaurant_id, status (system-controlled).

#### Cancel flow

- Confirm dialog: "Cancel reservation at {restaurant name} on {date}?"
- Yes → `cancel-reservation` edge function with reservation_id (JWT) OR confirmation_code (guest).
- On success: navigate back to `/bookings`, show toast "Booking cancelled".
- Past reservations: reject with 400 ("Past reservations cannot be cancelled"). Mobile should grey out the Cancel button for past bookings.

### 6.8 Account Page

**Web file:** `apps/web/src/pages/customer/AccountPage.tsx`
**Route:** `/account`

Sections:
- **Profile:** full_name, email, phone (editable). Saves to `user_profiles`.
- **Bookings:** quick previews of upcoming + past (links to `/bookings`).
- **Orders:** if preorder feature enabled, list of orders.
- **Loyalty:** if any restaurant loyalty program — points balance from `guests.loyalty_points_balance` aggregated.
- **Concierge:** placeholder for future concierge feature.
- **Payment methods:** `PaymentMethodsSection` reads `saved_cards`. Add/remove via Stripe.
- **Preferences:**
  - **Dietary restrictions** (`user_profiles.dietary_restrictions`).
  - **Allergies** (`user_profiles.allergies`).
  - **Seating preference** (`user_profiles.seating_preference`).
  - **Notifications** (`user_profiles.notification_preferences_json`).
  - **Language / locale** (`preferred_language` / `preferred_locale`).
- **Sign out** button.

> The web has an extra "Cenaiva voice" preference link under this section. Mobile **does not include voice** and should omit this entry.

### 6.9 Auth (Sign-in / Sign-up)

- **Sign-in:** email + password OR Google OAuth.
- **Sign-up:** name + email + password + confirm. Email verification required.
- **Forgot password:** `supabase.auth.resetPasswordForEmail(email, { redirectTo })`.

Mobile flows mirror these. Use the platform's OAuth deep-link handling for Google.

### 6.10 Notifications

**Web file:** `apps/web/src/hooks/useNotifications.ts`

- Header bell icon shows `unreadCount` badge.
- Tap opens drawer / modal with the last ~50 notifications, newest first.
- Each row: type icon, title, body snippet, timestamp, "tap to dismiss" / "tap to deep-link".
- Tap → `markRead(id)` and follow `data.deep_link` if present (e.g. `/bookings/<reservation_id>`).
- Realtime channel: `postgres_changes` on `notifications` filtered by `user_id=eq.{user_profile_id}`.

#### Push tokens

The mobile app should:
1. On first launch + every login, request push permission.
2. Get the platform push token (FCM for Android, APNS for iOS, Expo token if using Expo).
3. PATCH `user_profiles.expo_push_token` (the column is generic — name kept for legacy reasons).
4. Server-side: a future scheduled function will send push for new notifications. Today, only SMS / email confirmations exist; push delivery is a near-term roadmap item.

### 6.11 Favorites / Saved

**Status (2026-05-09):** the web app stores favorites and saved restaurants in **client-side React state only**. There is NO `favorites` or `saved_restaurants` table. State resets on page refresh.

**Mobile rule:** mirror the same client-only behavior for now. If persistence is needed, ship a `user_restaurant_favorites` table in the web codebase first, then expose it to mobile. Do NOT invent a mobile-only table.

---

## 7. Booking Lifecycle State Machine

### 7.1 Status enum

`reservations.status` is a text column with a CHECK constraint enforcing exactly these values:

| Value | Meaning | Diner-visible? | UI surface |
|---|---|---|---|
| `pending` | Initial state after `book_reservation` succeeds. Confirmation sent (SMS/email). | Yes — "Upcoming" | My Reservations / Upcoming |
| `confirmed` | Staff manually confirmed (or auto-confirm policy fired). | Yes — "Upcoming" or "Confirmed" | My Reservations / Upcoming |
| `seated` | Diner checked in and assigned to physical tables. | Yes — "Today / Now" | My Reservations / Upcoming or Current |
| `completed` | Meal finished (auto or staff). | Yes — "Past" | My Reservations / Past |
| `cancelled` | Diner or staff cancelled. | Yes — "Cancelled" | My Reservations / Cancelled |
| `no_show` | Staff or system marked no-show. | **Hidden** from diner-facing list | (none) |

### 7.2 Transitions

```
                                                 +-----------+
                                                 | no_show   |
                                                 +-----------+
                                                       ^
                                                       | (staff or auto after grace period)
                                                       |
[create-public-booking] → pending → confirmed → seated → completed
                            ↓          ↓          ↓
                        cancelled ← cancelled ← cancelled
                            (diner or staff)
[modify-reservation]  → pending stays pending
                       confirmed stays confirmed
                       (status doesn't change on modify; only reserved_at, party_size, special_request)
```

### 7.3 What the diner can do per status

| Status | Modify? | Cancel? | Notes |
|---|---|---|---|
| `pending` | ✅ | ✅ | Full diner control. |
| `confirmed` | ✅ | ✅ | Same as pending. |
| `seated` | ❌ (P0004) | ✅ | Once seated, modification is staff-side. |
| `completed` | ❌ | ❌ (past) | Read-only history. Allow leaving a review. |
| `cancelled` | ❌ | ❌ | Read-only history. |
| `no_show` | n/a | n/a | Hidden from diner list. |

Modify is enforced by the RPC raising `P0004 / not_modifiable` if status not in `pending` or `confirmed`. Cancel of `seated` is allowed (table is released at the host stand).

### 7.4 Cancellation policy

- **Minimum hours before booking:** NONE enforced by code. `cancel-reservation` only checks `reserved_at >= now()` (past reservations rejected with 400).
- **Penalty:** NONE enforced by code. `restaurants.cancellation_hours` and `restaurants.no_show_fee` are owner hints displayed by the UI; not auto-applied.
- **Deposit:** NOT auto-refunded on cancel. `deposit_amount`, `deposit_status`, `deposit_stripe_payment_intent_id` tracked separately. Manual refund process owner-side.
- **Notification:** confirmation cancellation email/SMS auto-sent on success.

### 7.5 Reminder schedule (server-side)

`send-booking-reminder` edge function runs nightly. Sends:
- 24h before reservation if `reminder_sent_24h = false` (then sets it true).
- 2h before if `reminder_sent_2h = false`.

Mobile receives these as push notifications (once push delivery ships) and as SMS/email today.

---

## 8. Search, Filters, & Auto-Roll

### 8.1 Discover search algorithm (text)

Client-side substring match against the four fields, all lowercased:
```ts
list = list.filter(r =>
  r.name.toLowerCase().includes(q) ||
  r.cuisine.toLowerCase().includes(q) ||
  r.area.toLowerCase().includes(q),
);
```

Mobile may keep this client-side until the dataset grows. There is no server-side `search` RPC for diners.

### 8.2 Filter chain order

Applied in this order in `apps/web/src/pages/customer/DiscoverPage.tsx:1070-1105`:
1. `availableSlots.length > 0` — drop restaurants with no slots for selected date.
2. Search text.
3. Active price chips.
4. Active feature chips (dietary tags + walk-ins).
5. Radius (Haversine distance).
6. Sort by distance ascending if `userLocation` known.

### 8.3 Auto-roll details

See §6.1.4. The trigger and reset effects live in `DiscoverPage.tsx`:
- Trigger: `useEffect` watching `[isOnDefaultDate, noFiltersActive, availabilityLoading, cards.length, cardsWithSlotsCount, autoRollOffsetDays]`.
- Reset: `useEffect` watching `[isOnDefaultDate, autoRollOffsetDays]` resets to 0 if the user manually picks a date.

Mobile must mirror both effects with the same triggers / reset rules.

---

## 9. Realtime Updates

### 9.1 The multiplexed registry pattern

The web app uses `apps/web/src/hooks/useAvailability.ts:availRealtimeRegistry`, a module-level `Map<restaurantId, AvailRealtimeEntry>`. Every consumer that calls `useAvailabilityRealtimeInvalidate(restaurantId, callback)` shares **one** postgres_changes channel per restaurant; their callbacks are stored in a Set on the entry.

Mobile rule: **never open one realtime channel per visible card**. Even if 50 cards render, there should be exactly one channel per unique restaurant id, and unsubscribe when the last consumer unmounts.

```ts
// PSEUDO mobile code mirroring web behavior
class AvailabilityRealtimeRegistry {
  private entries = new Map<string, { channel: any, callbacks: Set<() => void>, unsub: () => void }>();
  subscribe(restaurantId: string, cb: () => void) {
    let entry = this.entries.get(restaurantId);
    if (!entry) {
      const channel = supabase.channel(`reservations:${restaurantId}`)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'reservations', filter: `restaurant_id=eq.${restaurantId}` },
            () => entry?.callbacks.forEach(c => c()))
        .subscribe();
      entry = { channel, callbacks: new Set([cb]), unsub: () => supabase.removeChannel(channel) };
      this.entries.set(restaurantId, entry);
    } else {
      entry.callbacks.add(cb);
    }
    return () => {
      entry?.callbacks.delete(cb);
      if (entry?.callbacks.size === 0) {
        entry.unsub();
        this.entries.delete(restaurantId);
      }
    };
  }
}
```

### 9.2 Channels the diner client subscribes to

| Channel | When | Used by |
|---|---|---|
| `reservations:restaurant_id=eq.{id}` | Per restaurant on Discover map / Preview / Public page | Availability invalidation |
| `notifications:user_id=eq.{user_profile_id}` | Per logged-in user, app-wide | Notifications drawer + bell badge |
| `reservations:user_profile_id=eq.{user_profile_id}` (optional) | Per logged-in user on My Reservations | Refresh own bookings on status changes |
| `orders:user_profile_id=eq.{user_profile_id}` (optional) | If preorder enabled | Preorder status updates |

The `supabase_realtime` publication exposes `reservations`, `tables`, `orders`, `order_items`, `waitlist`, and `notifications`. Other tables are NOT exposed and cannot be subscribed to.

---

## 10. Error Code Reference

| ERRCODE | HTTP | unavailable_reason | UX guidance |
|---|---|---|---|
| `P0001` | 409 | `slot_taken` (book) / `no_table` (modify) | Re-fetch slots; ask diner to pick another. |
| `P0002` | 409 | `over_cover_cap` | Same — slot lost capacity in flight. |
| `P0003` | 400 | `shift_not_found` | Should not happen with valid data; log + show generic error. |
| `P0004` | 400 | `not_modifiable` | "This reservation can't be modified — contact the restaurant if you need help." |
| `P0005` | 404 | (none) | "Reservation not found." |
| `P0006` | 409 | `diner_double_book` | "You already have a reservation at this time. Cancel or modify the existing one before booking again." Show the conflicting reservation if discoverable. |
| `P0007` | 400 | `missing_identifier` | "Please provide a name and email or phone to complete your booking." Block submit until at least email or phone is filled. |
| `P0008` | 409 | `past_shift_close` | "This time is past the shift's close. Pick an earlier slot." Re-fetch slots automatically — this should not happen with `get_available_slots_cached` as the source. |
| `23P01` | 409 | `diner_double_book` (backstop) | Same as P0006. Means a pre-check was bypassed. |
| `23514` | 400 | (CHECK violation) | Generic constraint violation. Should not reach diner today; log and show generic error. |
| HTTP 401 | 401 | (auth) | "Please sign in to continue" or fall back to confirmation-code auth. |
| HTTP 429 | 429 | `rate_limited` | "Too many requests — please wait a minute." Rate limits: book 20/min, modify 15/min, cancel 10/min. |

---

## 11. Mobile-Specific Notes & Pitfalls

### 11.1 Things to KEEP IDENTICAL on mobile

- The price meter algorithm (menu-derived, not owner-set; placeholder when null).
- The auto-roll behavior on Discover.
- The multiplexed realtime channel registry pattern.
- The hide rule for `status = 'no_show'` reservations.
- The `excludeReservationId` plumbing in modify flow.
- The empty-set vs null distinction for `restaurant_available_dates`.
- The set of edge function error codes and their `unavailable_reason` strings.

### 11.2 Things that MAY differ

- Push notification delivery (mobile has FCM/APNS; web has none today).
- Map rendering (mobile uses Google Maps SDK; web uses Google Maps JS).
- Local cache layer (mobile has SQLite/Realm/AsyncStorage; web has IndexedDB).
- Layout (mobile bottom-tab nav vs web sidebar/header). Cards stack vertically.

### 11.3 Things mobile has on its own (no web mirror)

- Push token registration (`user_profiles.expo_push_token`).
- Native share sheets for confirmation codes.
- Native maps deep-linking ("Open in Apple Maps" / "Open in Google Maps").
- Phone deep-link (`tel:` for restaurant phone).

### 11.4 Things mobile EXPLICITLY does NOT mirror

- The Hey Cenaiva voice assistant (wake word, four-stage pipeline, `cenaiva-orchestrate`, ElevenLabs TTS, Deepgram STT, voice preference). The web's `<AssistantProvider>`, `useCenaivaWakeWord`, `useCenaivaVoice`, `useElevenLabsTTS`, `useDeepgramTranscription`, `useCenaivaVoicePreference`, `AccountVoicePage`, `CustomerMap` (the voice-shell variant), and `RestaurantRail` all stay web-only.
- The voice-related `/account/voice` route.
- The `user_profiles.cenaiva_tts_voice` column (don't read or write it).

### 11.5 Common pitfalls

1. **Restaurant timezone matters.** All `reserved_at` displays must be converted to `restaurants.timezone`, not the device timezone. Use `date-fns-tz` (RN) or platform equivalents.
2. **Date strings vs datetime strings.** RPC inputs are mixed: `get_available_slots_cached` takes `p_date` as `YYYY-MM-DD`, `book_reservation` takes `p_reserved_at` as full timestamptz. Be careful which you pass where.
3. **Confirmation code is auto-generated.** Don't expect to set it client-side — the trigger overrides whatever you send.
4. **Diner double-book is enforced at the DB level.** Even if you bypass the edge function pre-check, the GiST exclusion will raise `23P01`. Always go through edge functions so users see the friendly P0006 message.
5. **Calendar empty-set vs null.** Empty Set = no openings (grey out all). null = fetch hasn't completed (calendar stays permissive). Don't conflate.
6. **`category` string vs `category_id` FK.** Some legacy items have `category` populated as a string but `category_id` null. Use `category_id`-joined `menu_categories.name` for display when present; fall back to the string column.
7. **`is_active` filter is everywhere.** Active restaurants, active shifts, active tables, active categories, active items. Mobile must always include these filters when querying the public surface.
8. **Self-service signup is open by design.** New restaurants ship with `is_active = true` immediately. Don't add a moderation gate on the diner side.
9. **Don't write to `guests`.** Ever. Even if you have a phone + email, let `create-public-booking` deduplicate via `canonical_guest_id` server-side.
10. **The mobile app has no voice flow.** Don't accidentally call `cenaiva-orchestrate`, `elevenlabs-tts`, `deepgram-live-token`, or `cenaiva-availability` even if you see references in the codebase — they belong to the web's voice assistant feature only.

---

## 12. File-Path Index (Web Reference)

These are the canonical files mobile implementers should read for behavior reference. **Do not copy verbatim into mobile** — adapt, don't fork. Track upstream changes (the web codebase ships first; mobile follows).

> Voice-related files (`useCenaivaWakeWord.ts`, `useCenaivaVoice.ts`, `useElevenLabsTTS.ts`, `useDeepgramTranscription.ts`, `useCenaivaVoicePreference.ts`, `AssistantProvider.tsx`, `AccountVoicePage.tsx`, `CustomerMap.tsx`, `RestaurantRail.tsx`, `apps/web/src/lib/cenaiva/*`, `supabase/functions/cenaiva-*`, `supabase/functions/elevenlabs-tts`, `supabase/functions/deepgram-live-token`) are intentionally OMITTED from this index — they're out of scope for the mobile app.

### 12.1 UI surfaces
- Discover: `apps/web/src/pages/customer/DiscoverPage.tsx`
- Deals: `apps/web/src/pages/customer/DealsPage.tsx`
- Restaurant preview modal: `apps/web/src/components/customer/RestaurantPreviewModal.tsx`
- Restaurant public page: `apps/web/src/pages/customer/RestaurantPublicPage.tsx`
- AvailabilityPanel: `apps/web/src/components/booking/AvailabilityPanel.tsx`
- Bookings list: `apps/web/src/pages/customer/BookingsPage.tsx`
- Booking detail: `apps/web/src/pages/customer/BookingDetailsPage.tsx`
- Account page: `apps/web/src/pages/customer/AccountPage.tsx`
- Login: `apps/web/src/pages/auth/LoginPage.tsx`
- Register: `apps/web/src/pages/auth/RegisterPage.tsx`

### 12.2 Hooks (data layer)
- Restaurants: `apps/web/src/hooks/useRestaurant.ts` (`fetchPublicRestaurants`, `usePublicRestaurants`)
- Availability: `apps/web/src/hooks/useAvailability.ts` (with multiplexed realtime registry)
- My reservations: `apps/web/src/hooks/useMyReservations.ts`
- Notifications: `apps/web/src/hooks/useNotifications.ts`
- Reviews: `apps/web/src/hooks/useReviews.ts` (or similar)
- User: `apps/web/src/hooks/useUser.ts`

### 12.3 Helpers
- Price level: `apps/web/src/lib/restaurant-price-level.ts` (menu-only derivation)
- Time utilities: `apps/web/src/lib/utils/time.ts` (e.g. `localDayBoundsUtcIso`)
- Availability filters: `apps/web/src/lib/customer/availabilityFilters.ts` (`fetchDisplayAvailabilitySlotsForRestaurants`)

### 12.4 Edge functions
- Booking write: `supabase/functions/create-public-booking/index.ts`
- Modify: `supabase/functions/modify-reservation/index.ts`
- Cancel: `supabase/functions/cancel-reservation/index.ts`

### 12.5 RPC migrations (read for signature + behavior)
- `book_reservation`: `supabase/migrations/20260509230000_booking_close_time_and_confirmation_return.sql` (latest)
- `modify_reservation_slot`: `supabase/migrations/20260508000800_modify_reservation_rpc.sql`
- `release_reservation_tables`: `supabase/migrations/20260503000001_add_reservation_table_assignments.sql`
- `get_available_slots`: `supabase/migrations/20260508000600_get_available_slots.sql`
- Close-time fix: `supabase/migrations/20260509100000_get_available_slots_close_time_turn.sql`
- Reservations status enum CHECK: `supabase/migrations/20260508001600_reservations_status_check.sql`
- GiST exclusion (diner double-book): `supabase/migrations/20260508000300_reservation_tables_exclusion.sql`
- Identifier guard (P0007): `supabase/migrations/20260509081135_reservations_require_identifier.sql`

### 12.6 Other docs in this repo
- `CLAUDE.md` — agent guardrails + hard rules. **Read before any change.**
- `cenaiva-database.md` — ~5,000-word reference for Postgres/RPC details (companion to this file; that one is more SQL-centric, this one is more UI-centric).
- `MOBILE_BACKEND_INTEGRATION.md` — older mobile↔backend integration notes.

---

## 13. Quick-Reference Implementation Order

For an AI / engineer building the diner mobile app from scratch, here's the recommended build order:

1. **Auth scaffolding** — Supabase SDK + Sign-in / Sign-up screens. Verify `user_profiles.id` is cached after login.
2. **Discover** — `usePublicRestaurants` + `get_available_slots_for_restaurants_compact` + price meter (menu-derived) + filters. No realtime yet.
3. **Restaurant detail** — Preview / Public page consolidated into a single mobile screen. Embed AvailabilityPanel.
4. **Booking flow** — date / party / time / slot picker + diner contact form → `create-public-booking`. Handle every error code in §10.
5. **My Reservations** — `useMyReservations` + status badges + tabs (upcoming / past / cancelled). No-shows hidden.
6. **Reservation detail + modify + cancel** — `modify-reservation` and `cancel-reservation` with `excludeReservationId` plumbing.
7. **Realtime invalidation** — Multiplexed registry. Apply on Discover, Preview, Public, Reservations.
8. **Account** — Profile + dietary + saved cards (via Stripe SDK). No voice preference UI on mobile.
9. **Notifications** — Bell + drawer + push token registration to `user_profiles.expo_push_token`.
10. **Auto-roll on Discover** — Add the next-available-date logic. Polish step.
11. **Deals page** — Promotions + events parallel to Discover.
12. **Polish** — Empty states, loading skeletons, error toasts, share sheets, deep-linking, deep-link from notifications.

---

**End of DINER_MOBILE_GUIDE.md**

If anything in this file conflicts with the actual web behavior at the latest commit, the web behavior wins and this file is wrong — open a PR to fix it. The contract is: web ships first, mobile mirrors (excluding the voice assistant), this file documents the contract.
