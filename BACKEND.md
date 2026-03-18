# Seatly — BACKEND.md
# Full Planned Database Schema and API Specification
# Status: Phases 1-9 built in Supabase
# Last updated: March 2026

---

## HOW TO USE THIS FILE

This file is the single source of truth for the Seatly database.
Cursor reads this before building any screen or feature.

Rules:
- NEVER create a table that is not listed here
- NEVER add a column that is not listed here
- NEVER modify or delete an existing table without updating this file
- If a screen needs something not listed here, STOP and add it here first, then build
- Every table change must be reflected in this file before merging to main

Status legend:
- [ ] Not built yet
- [x] Built and live in Supabase

---

## PHASE 1 — CORE TABLES

### restaurants [x]
One row per restaurant business. The root of all data.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Auto-generated |
| name | text | Restaurant display name |
| slug | text | URL-safe identifier e.g. la-maison |
| logo_url | text | Supabase Storage URL |
| cover_photo_url | text | Hero image for customer-facing profile |
| cuisine_type | text | e.g. Italian, Japanese, French |
| description | text | About the restaurant |
| address | text | Full street address |
| city | text | |
| province | text | e.g. Ontario |
| country | text | e.g. Canada |
| phone | text | |
| email | text | |
| hours_json | jsonb | { mon: { open: "12:00", close: "22:00" }, ... } |
| settings_json | jsonb | Turn times, booking cutoff, no-show policy |
| stripe_customer_id | text | For Seatly subscription billing |
| plan | text | free / starter / pro |
| is_active | boolean | Soft disable without deleting |
| business_type | text | fine_dining / casual / fast_casual / cafe / bar / lounge / nightclub / food_hall / members_club / hotel_restaurant / popup |
| timezone | text | e.g. America/Toronto |
| currency | text | CAD / USD / GBP etc |
| tax_rate | decimal | e.g. 0.13 for 13% HST |
| deposit_policy_json | jsonb | { required_above_party_size: 6, amount_per_person: 25, cancellation_window_hours: 24 } |
| loyalty_config_json | jsonb | { points_per_dollar: 1, tiers: [...], expiry_inactive_months: 12 } |
| current_shift_briefing | text | AI-generated shift briefing, updated nightly at 5am |
| created_at | timestamp | |

RLS: Owners can only read and write their own restaurant row.
Seatly admins can read all rows.

---

### user_profiles [x]
Every user linked to Supabase Auth. Customers, staff, and owners.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| auth_user_id | uuid FK | Links to auth.users |
| full_name | text | |
| phone | text | |
| email | text | |
| avatar_url | text | |
| role | text | customer / host / waiter / owner / kitchen / admin |
| restaurant_id | uuid FK | Null for customers. Set for all staff. |
| birthday | date | Optional, used for customer personalization |
| dietary_restrictions | text[] | [vegetarian, halal, vegan] |
| allergies | text[] | [nuts, shellfish] |
| seating_preference | text | window, booth, quiet area, patio |
| noise_preference | text | quiet, lively, no preference |
| preferred_language | text | |
| notification_preferences_json | jsonb | { sms: true, email: true, push: true } |
| car_details_json | jsonb | { make, model, colour, plate } for valet |
| stripe_payment_method_id | text | Card on file via Stripe |
| created_at | timestamp | |

RLS: Users can only read and write their own profile.
Staff can read customer profiles for their restaurant only.

---

### tables [x]
Every physical table in the restaurant. Positions stored for floor plan editor.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| table_number | text | 1, A3, Patio-2 — display label |
| capacity | int | Maximum guests |
| section | text | Main floor, Patio, Bar, Private room |
| position_x | float | X coordinate on floor plan canvas |
| position_y | float | Y coordinate on floor plan canvas |
| shape | text | round / square / rectangle |
| status | text | empty / arriving / seated / reserved / unavailable |
| is_active | boolean | Deactivate for maintenance or private events |
| combined_with | uuid[] | Table IDs this table is currently merged with |

RLS: Staff can read their restaurant's tables. Only owners can write.

---

### shifts [x]
Named service periods. All reservations belong to a shift.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| name | text | Lunch, Dinner, Saturday Brunch |
| days_of_week | int[] | [1,2,3,4,5] = Mon–Fri |
| start_time | time | 18:00 |
| end_time | time | 23:00 |
| slot_duration_minutes | int | 15 or 30 |
| max_covers | int | Hard cap on total guests this shift |
| turn_time_minutes | int | Expected table occupancy duration |
| min_party_size | int | Minimum guests per booking |
| max_party_size | int | Maximum guests per booking |
| advance_booking_days | int | How many days ahead guests can book |
| is_active | boolean | |
| blackout_dates | date[] | Dates this shift does not run |
| vip_early_access_hours | int | How many hours before public VIPs can book |

RLS: Staff can read. Only owners can write.

---

## PHASE 2 — AUTH

### (Handled by Supabase Auth)
Supabase Auth manages sessions, tokens, and password resets.
user_profiles table above is linked to auth.users via auth_user_id.

Auth roles map to user_profiles.role:
- customer → sees mobile app only
- host → sees web app floor plan and reservations
- waiter → sees web app tables and orders
- kitchen → sees kitchen display screen only
- owner → sees everything for their restaurant
- admin → Seatly internal, sees all restaurants

---

## PHASE 3 — RESERVATIONS

### reservations [x]
Every booking — past, present, and future. The central operational table.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| guest_id | uuid FK | Links to guests table |
| table_id | uuid FK | Nullable until host assigns |
| shift_id | uuid FK | |
| party_size | int | |
| reserved_at | timestamp | Date and time of reservation |
| status | text | pending / confirmed / seated / completed / no_show / cancelled |
| source | text | app / widget / phone / walk_in / ai_chat |
| special_request | text | Window table please, it is our anniversary |
| occasion | text | birthday, anniversary, business dinner, date night |
| confirmed_at | timestamp | When restaurant confirmed |
| checked_in_at | timestamp | When guest tapped check-in on mobile |
| seated_at | timestamp | When host marked as seated |
| completed_at | timestamp | When bill closed — triggers CRM update |
| no_show_risk_score | int | Copied from guest score at time of booking |
| waiter_id | uuid FK | Staff member serving this table |
| deposit_amount | decimal | Amount charged as deposit |
| deposit_status | text | none / charged / refunded / forfeited |
| deposit_stripe_payment_intent_id | text | |
| created_at | timestamp | |

RLS: Staff can read their restaurant's reservations. Customers can read their own.

---

### waitlist [x]
Walk-in guests waiting for a table when restaurant is full.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| guest_name | text | Quickly entered by host at the door |
| phone | text | For SMS notification |
| party_size | int | |
| joined_at | timestamp | |
| estimated_wait_minutes | int | Calculated by system |
| status | text | waiting / notified / seated / left |
| notes | text | Has a stroller, prefers non-bar seating |
| position | int | Queue position, recalculated on change |
| remote_join | boolean | Did guest join from the mobile app? |
| notified_at | timestamp | When SMS was sent |
| response | text | confirmed / declined / no_response |

RLS: Staff can read and write their restaurant's waitlist.

---

## PHASE 4 — MENU

### menu_items [x]
Every dish and drink the restaurant offers.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| name | text | Pan-seared duck breast |
| description | text | Full dish description |
| price | decimal | Current price |
| category | text | Starters, Mains, Desserts, Cocktails, Wine |
| photo_url | text | |
| allergens | text[] | [nuts, dairy, gluten, shellfish, eggs, soy, sesame] |
| dietary_flags | text[] | [vegetarian, vegan, halal, kosher, gluten_free] |
| preparation_time_minutes | int | For kitchen timing of pre-orders |
| is_available | boolean | Toggle off when out of stock tonight |
| is_preorderable | boolean | Can customers pre-order before arrival? |
| is_active | boolean | Permanently on or off the menu |
| sort_order | int | Display order on the menu |
| spice_level | text | mild / medium / hot / very_hot |
| pairing_suggestions | text | Pairs well with X wine |
| loyalty_points_value | int | Points earned when this item is ordered |
| cost_price | decimal | Ingredient cost for margin calculation |
| created_at | timestamp | |

RLS: Public can read active items. Only owners can write.

---

### menu_categories [x]
Custom category ordering per restaurant.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| name | text | Starters, Mains, Cocktails etc |
| sort_order | int | Drag and drop order |
| is_active | boolean | |

---

## PHASE 5 — ORDERS

### orders [x]
One order per reservation. The financial record of every visit.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| reservation_id | uuid FK | |
| restaurant_id | uuid FK | |
| guest_id | uuid FK | Direct link for fast CRM queries |
| is_preorder | boolean | Submitted before arrival via mobile app? |
| status | text | pending / in_kitchen / served / billed / paid |
| subtotal | decimal | Sum of all order_item line totals |
| tax_amount | decimal | Calculated and stored at bill close |
| tip_amount | decimal | Entered by staff at payment |
| total_amount | decimal | subtotal + tax + tip |
| payment_method | text | card, cash, tab, room, corporate |
| discount_amount | decimal | Comps or manager discounts |
| discount_reason | text | staff meal, complaint resolution, VIP comp |
| split_type | text | none / by_item / evenly |
| room_number | text | For hotel restaurant room billing |
| corporate_account_id | uuid FK | Nullable, for corporate billing |
| created_at | timestamp | |
| billed_at | timestamp | When check was generated |
| paid_at | timestamp | When payment confirmed — triggers CRM update |

RLS: Staff can read and write their restaurant's orders.

---

### order_items [x]
Every single dish or drink on an order.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| order_id | uuid FK | |
| menu_item_id | uuid FK | |
| quantity | int | |
| unit_price | decimal | Price at time of order — never changes |
| line_total | decimal | quantity x unit_price |
| modifications | text | no onions, extra sauce, medium rare |
| course | text | starter, main, dessert, drink |
| status | text | ordered / in_kitchen / ready / served / comped |
| added_by | uuid FK | Staff member who added this item |
| added_at | timestamp | |
| kitchen_started_at | timestamp | When kitchen marked in progress |
| kitchen_ready_at | timestamp | When kitchen marked ready |
| rating | int | 1-5 guest rating after visit |

RLS: Staff can read and write their restaurant's order items.

---

## PHASE 6 — GUEST CRM

### guests [x]
THE most important table. One record per unique person per restaurant.
Auto-created on first booking. Every financial and behavioral metric lives here.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| restaurant_id | uuid FK | Each restaurant has their own copy |
| user_profile_id | uuid FK | Nullable — links if guest has app account |
| full_name | text | |
| email | text | Used for deduplication |
| phone | text | Used for deduplication |
| birthday | date | Auto-populates birthday tag this month |
| anniversary | date | Auto-populates anniversary tag this month |
| preferred_language | text | |
| tags | text[] | [VIP, Regular, Nut allergy] — colour-coded pills |
| dietary_restrictions | text[] | [vegetarian, halal, vegan] |
| allergies | text[] | [nuts, shellfish] — shown as RED ALERT |
| seating_preference | text | window, booth, quiet area, patio |
| noise_preference | text | quiet, no preference, lively |
| favourite_dishes | text[] | Manually added or AI-suggested |
| favourite_drinks | text[] | |
| internal_notes | text | General long-form staff notes |
| total_visits | int | Auto-incremented after every completed visit |
| total_spend | decimal | Running lifetime total |
| average_spend_per_visit | decimal | total_spend / total_visits |
| highest_single_bill | decimal | |
| no_show_count | int | |
| cancellation_count | int | |
| last_visit_at | timestamp | |
| first_visit_at | timestamp | Set once, never changed |
| no_show_risk_score | int | 0–100, calculated nightly |
| lifetime_value_score | int | 0–100, calculated nightly |
| is_vip | boolean | Manual or auto-assigned |
| is_blocked | boolean | Restaurant can block guests |
| loyalty_points_balance | int | Current points |
| loyalty_points_earned_total | int | All time earned |
| loyalty_points_redeemed_total | int | All time redeemed |
| loyalty_tier | text | bronze / silver / gold / platinum |
| sms_opt_in | boolean | |
| email_opt_in | boolean | |
| preferred_payment_method | text | Inferred from history |
| car_details_json | jsonb | { make, model, colour, plate } |
| stripe_payment_method_id | text | Card on file |
| total_deposits_paid | decimal | |
| total_deposits_forfeited | decimal | |
| food_spend_total | decimal | |
| drinks_spend_total | decimal | |
| duplicate_of | uuid FK | If merged, points to primary record |
| created_at | timestamp | |

RLS: Staff can read their restaurant's guests. Only owners can write core fields.
Customers can read their own guest record.

---

### guest_notes [x]
Every note a staff member writes. Stored permanently. Shown on all future visits.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| guest_id | uuid FK | |
| restaurant_id | uuid FK | |
| reservation_id | uuid FK | Which visit this note was written during |
| staff_id | uuid FK | Who wrote the note |
| note | text | Guest celebrated engagement, ordered Champagne |
| category | text | preference / complaint / compliment / incident / general |
| is_pinned | boolean | Pinned notes appear at top of profile always |
| created_at | timestamp | |

RLS: Staff can read and create. Only owners can delete.

---

### allergy_incidents [x]
Permanent health and safety log. Can never be deleted.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| guest_id | uuid FK | |
| restaurant_id | uuid FK | |
| reservation_id | uuid FK | |
| allergen | text | Which allergen caused the incident |
| dish_id | uuid FK | Which menu item was involved |
| severity | text | mild / moderate / severe |
| action_taken | text | Description of what staff did |
| reported_by | uuid FK | Staff member who logged it |
| created_at | timestamp | |

RLS: Staff can create. Nobody can delete. Owners can read.

---

### loyalty_transactions [x]
Every points earn and redeem event.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| guest_id | uuid FK | |
| restaurant_id | uuid FK | |
| order_id | uuid FK | Nullable |
| type | text | earned / redeemed / expired / adjusted |
| points | int | Positive for earned, negative for redeemed |
| balance_after | int | Points balance after this transaction |
| description | text | Earned from visit, Redeemed for free dessert |
| created_at | timestamp | |

---

### communication_log [x]
Every SMS and email ever sent to a guest.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| guest_id | uuid FK | |
| restaurant_id | uuid FK | |
| channel | text | sms / email |
| type | text | booking_confirmation / reminder / birthday / anniversary / re_engagement / review_request / survey / table_ready / deposit_receipt / loyalty_update / marketing / event_ticket |
| subject | text | Email subject line |
| body | text | Full message content |
| status | text | sent / delivered / failed / bounced |
| opened_at | timestamp | Nullable |
| replied_at | timestamp | Nullable, for two-way SMS |
| reply_content | text | Guest reply if two-way SMS |
| sent_at | timestamp | |

---

### guest_surveys [x]
Post-visit survey responses.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| guest_id | uuid FK | |
| restaurant_id | uuid FK | |
| reservation_id | uuid FK | |
| overall_rating | int | 1-5 stars |
| food_rating | int | 1-5 |
| service_rating | int | 1-5 |
| ambience_rating | int | 1-5 |
| responses_json | jsonb | Custom question answers |
| would_recommend | boolean | |
| created_at | timestamp | |

---

## PHASE 7 — FINANCIAL AND EVENTS

### events [x]
Special experiences with fixed price tickets.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| name | text | Valentine's Day Tasting Menu |
| description | text | |
| date | date | |
| start_time | time | |
| end_time | time | |
| price_per_person | decimal | |
| capacity | int | |
| tickets_sold | int | Auto-updated |
| is_recurring | boolean | |
| recurrence_rule | text | weekly, monthly etc |
| stripe_product_id | text | |
| is_active | boolean | |
| created_at | timestamp | |

---

### event_tickets [x]
Individual ticket purchases for events.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_id | uuid FK | |
| guest_id | uuid FK | |
| restaurant_id | uuid FK | |
| quantity | int | |
| total_amount | decimal | |
| stripe_payment_intent_id | text | |
| status | text | pending / confirmed / cancelled / refunded |
| created_at | timestamp | |

---

### gift_cards [x]

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| code | text | Unique redemption code |
| initial_value | decimal | |
| remaining_value | decimal | |
| purchased_by_guest_id | uuid FK | |
| stripe_payment_intent_id | text | |
| is_active | boolean | |
| expires_at | timestamp | |
| created_at | timestamp | |

---

### promo_codes [x]

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| code | text | |
| discount_type | text | percentage / fixed |
| discount_value | decimal | |
| max_uses | int | |
| uses_count | int | |
| valid_from | date | |
| valid_until | date | |
| is_active | boolean | |
| created_at | timestamp | |

---

### corporate_accounts [x]

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| company_name | text | |
| billing_email | text | |
| billing_address | text | |
| credit_limit | decimal | |
| current_balance | decimal | |
| payment_terms_days | int | e.g. 30 for net-30 |
| created_at | timestamp | |

---

## PHASE 8 — STAFF

### staff_shifts [x]
Scheduled shifts assigned to staff members.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| staff_id | uuid FK | Links to user_profiles |
| shift_id | uuid FK | The service period |
| scheduled_date | date | |
| scheduled_start | time | |
| scheduled_end | time | |
| role_for_shift | text | host / waiter / kitchen / manager |
| created_at | timestamp | |

---

### staff_clock_records [x]

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| staff_id | uuid FK | |
| staff_shift_id | uuid FK | |
| clocked_in_at | timestamp | |
| clocked_out_at | timestamp | Nullable until clocked out |
| hours_worked | decimal | Calculated on clock out |
| hourly_rate | decimal | Stored at time of shift |
| labour_cost | decimal | hours_worked x hourly_rate |

---

### staff_availability [x]

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| staff_id | uuid FK | |
| restaurant_id | uuid FK | |
| day_of_week | int | 0=Sunday, 1=Monday etc |
| available_from | time | |
| available_until | time | |
| is_available | boolean | |

---

## PHASE 9 — ANALYTICS

### restaurant_analytics [x]
Pre-computed nightly rollups so dashboards load instantly.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| date | date | The day this record covers |
| total_covers | int | Total guests seated |
| total_revenue | decimal | Sum of all paid orders |
| total_orders | int | |
| avg_spend_per_cover | decimal | |
| no_show_count | int | |
| cancellation_count | int | |
| walk_in_count | int | |
| preorder_count | int | |
| food_revenue | decimal | |
| drinks_revenue | decimal | |
| tip_total | decimal | |
| discount_total | decimal | |
| deposit_revenue | decimal | Deposits collected |
| deposit_forfeitures | decimal | Deposits kept from no-shows |
| top_dishes_json | jsonb | [{ item_id, name, count, revenue }] |
| booking_sources_json | jsonb | { app: 12, widget: 8, phone: 3, walk_in: 5 } |
| new_guests_count | int | First-time visitors |
| returning_guests_count | int | |
| loyalty_points_issued | int | |
| loyalty_points_redeemed | int | |
| labour_cost | decimal | Sum of all staff labour this day |
| computed_at | timestamp | |

---

### seatly_cron_config (internal)
Config for pg_cron → Edge Function calls. Not in RLS scope.

| Column | Type | Notes |
|--------|------|-------|
| id | int PK | Always 1 |
| cron_secret | text | Must match CRON_SECRET env var |
| base_url | text | Edge Functions base URL |
| updated_at | timestamptz | |

Run `UPDATE seatly_cron_config SET cron_secret = 'your-secret' WHERE id = 1` after setting CRON_SECRET in Supabase Edge Function secrets.

---

## DATABASE TRIGGERS

These run automatically. Never calculate these manually in app code.

| Trigger | When it fires | What it does |
|---------|--------------|--------------|
| update_guest_totals | orders.paid_at is set | Increments guest.total_visits, adds to total_spend, recalculates average_spend_per_visit, updates last_visit_at |
| increment_no_show | reservation.status set to no_show | Increments guest.no_show_count |
| increment_cancellation | reservation.status set to cancelled | Increments guest.cancellation_count |
| update_loyalty_balance | loyalty_transactions row inserted | Updates guest.loyalty_points_balance |
| update_tickets_sold | event_tickets row inserted | Increments events.tickets_sold |

---

## EDGE FUNCTIONS (NIGHTLY CRON JOBS)

Scheduled via Supabase pg_cron (no external cron service). Cron jobs call Edge Functions via pg_net.http_post. Configure `seatly_cron_config.cron_secret` to match `CRON_SECRET` env var.

| Function | Schedule (UTC) | What it does |
|----------|----------------|--------------|
| calculate_no_show_risk | 2am daily | Recalculates no_show_risk_score for all guests using formula: (no_show_count / total_visits) x 60 + booking_source_weight x 20 + recency_weight x 20 |
| calculate_lifetime_value | 2am daily | Recalculates lifetime_value_score based on total_spend, visit frequency, and recency |
| run_auto_tagging | 3am daily | Applies all tag rules to every guest in every restaurant |
| compute_analytics | 4am daily | Aggregates previous day's data into restaurant_analytics |
| generate_shift_briefing | 5am daily | Uses Claude API to generate the next day's shift briefing; stores in restaurants.current_shift_briefing |
| send_birthday_messages | 8am daily | Sends birthday SMS/email to guests whose birthday is today |
| send_anniversary_messages | 8am daily | Sends anniversary SMS/email |
| expire_loyalty_points | Midnight on 1st of month | Expires points for guests inactive over loyalty_config_json.expiry_inactive_months (default 12) |

---

## EDGE FUNCTIONS (ON-DEMAND)

| Function | Trigger | What it does |
|----------|---------|--------------|
| get_availability | GET request | Returns available booking slots for a restaurant, date, and party size |
| create_booking | POST request | Creates reservation, creates or matches guest profile, charges deposit if required, sends confirmation |
| check_in_guest | POST request | Marks reservation as checked in, generates kitchen ticket for pre-orders |
| close_bill | POST request | Sets order.paid_at, triggers CRM update trigger |
| ai_chat | POST request | Receives customer message, detects booking intent, completes booking via Claude API |
| ai_crm_query | POST request | Receives owner natural language query, queries database, returns answer via Claude API |
| detect_duplicates | POST request | Checks for duplicate guest profiles by phone and email |
| merge_guests | POST request | Merges two guest profiles, combines history and loyalty points |
| send_communication | POST request | Sends SMS via Twilio or email via Resend to a guest |
| calculate_demand_forecast | GET request | Projects upcoming busy periods based on booking pace |
| process_deposit_refund | POST request | Refunds deposit via Stripe on cancellation within window |
| forfeit_deposit | POST request | Marks deposit as forfeited on no-show |
| scan_menu | POST request | Receives PDF or image, uses AI to extract menu items |

---

## REALTIME CHANNELS

Supabase Realtime subscriptions. UI subscribes to these for live updates.

| Channel | Table | Events | Who subscribes |
|---------|-------|--------|---------------|
| reservations:{restaurant_id} | reservations | INSERT, UPDATE | Host, owner web and mobile |
| tables:{restaurant_id} | tables | UPDATE | Host, owner, waiter |
| orders:{restaurant_id} | orders | INSERT, UPDATE | Waiter, kitchen screen |
| order_items:{restaurant_id} | order_items | INSERT, UPDATE | Kitchen screen, waiter |
| waitlist:{restaurant_id} | waitlist | INSERT, UPDATE, DELETE | Host |

---

## STORAGE BUCKETS

| Bucket | Access | Used for |
|--------|--------|---------|
| restaurant-logos | Public read, owner write | Restaurant logo images |
| menu-photos | Public read, owner write | Menu item photos |
| user-avatars | Auth read, self write | Customer and staff avatars |
| cover-photos | Public read, owner write | Restaurant hero images |

---

## AUTO-TAGGING RULES

Applied nightly by run_auto_tagging Edge Function.

| Tag | Rule |
|-----|------|
| Regular | total_visits >= 5 |
| Loyal | total_visits >= 15 |
| VIP | lifetime_value_score >= 80 |
| New Guest | total_visits == 1 |
| Lapsed | last_visit_at < 90 days ago AND total_visits >= 3 |
| No-show Risk | no_show_risk_score >= 60 |
| High Spender | average_spend_per_visit >= restaurant top 10% threshold |
| Birthday This Month | birthday month == current month |
| Anniversary This Month | anniversary month == current month |

---

## FINANCIAL CALCULATIONS

All done in PostgreSQL triggers and Edge Functions. Never in AI prompts.

| Metric | Formula |
|--------|---------|
| average_spend_per_visit | total_spend / total_visits |
| no_show_risk_score | (no_show_count / total_visits) x 60 + source_weight x 20 + recency_weight x 20 |
| lifetime_value_score | Normalised score: total_spend weight 40% + visit_frequency weight 30% + recency weight 30% |
| order subtotal | SUM of order_items.line_total |
| line_total | quantity x unit_price |
| labour_cost per shift | hours_worked x hourly_rate |
| food margin | (price - cost_price) / price x 100 |

---

## AI RULES — NON-NEGOTIABLE

- Claude API is used for conversation, suggestions, and natural language queries ONLY
- NEVER send financial totals, tax calculations, or scores to Claude API
- NEVER let Claude API write directly to the database without validation
- ALL money calculations happen in PostgreSQL and Edge Functions only
- Claude API calls go through Supabase Edge Functions — never called directly from the frontend

---

## ENVIRONMENT VARIABLES REQUIRED

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
RESEND_API_KEY=
VAPI_API_KEY=
SENTRY_DSN=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
CRON_SECRET=           # For nightly cron Edge Functions; also set in seatly_cron_config table
```

---

## BUILD STATUS

| Phase | What | Status |
|-------|------|--------|
| Phase 1 | Core tables: restaurants, user_profiles, tables, shifts | [x] Built |
| Phase 2 | Auth: Supabase Auth + RLS policies + user roles | [x] RLS policies built |
| Phase 3 | Reservations: reservations, waitlist tables + availability engine | [x] Tables built (guests, reservations, waitlist) |
| Phase 4 | Menu: menu_items, menu_categories | [x] Built |
| Phase 5 | Orders: orders, order_items + kitchen tickets | [x] Built |
| Phase 6 | Guest CRM: guests, guest_notes, allergy_incidents, loyalty_transactions, communication_log, guest_surveys | [x] Built |
| Phase 7 | Financial: events, event_tickets, gift_cards, promo_codes, corporate_accounts | [x] Built |
| Phase 8 | Staff: staff_shifts, staff_clock_records, staff_availability | [x] Built |
| Phase 9 | Analytics: restaurant_analytics + pg_cron nightly jobs + Realtime + Storage | [x] Built |
| Phase 10 | All Edge Functions live and tested | [~] 8 nightly cron functions built; 13 on-demand pending |
| Phase 11 | All Realtime channels active | [x] Migration adds reservations, tables, orders, order_items, waitlist to publication |

---

*Update this file every time a phase is completed. Change [ ] to [x] and add any new columns or tables created during the build.*
