# Seatly — SCREENS.md
# Screen-to-Backend Connection Map
# Version 1.0 — March 2026
#
# HOW TO USE THIS FILE
# ---
# This file tells Cursor exactly what every screen needs from the backend.
# Before building any screen, Cursor reads:
#   1. This file (SCREENS.md) — what the screen does and what it connects to
#   2. BACKEND.md — the full database schema
#   3. CHECKLIST.md — what is already built
#
# How to reference a design:
#   - If using Figma MCP: set design_ref to the Figma frame name e.g. "Floor Plan / Host View"
#   - If using screenshots: set design_ref to the file path e.g. "designs/floor-plan.png"
#   - If not decided yet: leave design_ref as "TBD"
#
# Cursor prompt template for building any screen:
#   "Read SCREENS.md, BACKEND.md, and .cursorrules.
#    Build the [SCREEN NAME] screen for [web/mobile].
#    Use the design reference noted in SCREENS.md.
#    Connect to the exact tables and functions listed.
#    Apply the correct RLS role.
#    Handle loading, empty, and error states.
#    Use tokens from packages/tokens for all styling."

---

## PLATFORM: WEB APP (Next.js + Tailwind)

---

### AUTH SCREENS

---

#### WEB-AUTH-01: Login
- **Route:** `/login`
- **Design ref:** TBD
- **Role:** Public (unauthenticated)
- **What it does:** Email and password login. On success redirects based on role.
- **Tables read:** user_profiles (role, restaurant_id)
- **Tables write:** None
- **Edge Functions:** None
- **Realtime:** None
- **Auth redirect logic:**
  - role = owner → `/dashboard`
  - role = host → `/floor-plan`
  - role = waiter → `/my-tables`
  - role = kitchen → `/kitchen`
  - role = admin → `/admin`
- **Error states:** Invalid credentials, unverified email, account disabled
- **Notes:** Use Supabase Auth signInWithPassword

---

#### WEB-AUTH-02: Sign Up (Owner)
- **Route:** `/signup`
- **Design ref:** TBD
- **Role:** Public (unauthenticated)
- **What it does:** Creates a new restaurant owner account
- **Tables write:** user_profiles (role: owner), restaurants (basic info)
- **Edge Functions:** Role assignment on signup
- **Realtime:** None
- **Notes:** After signup redirect to onboarding wizard WEB-OWNER-15

---

#### WEB-AUTH-03: Forgot Password
- **Route:** `/forgot-password`
- **Design ref:** TBD
- **Role:** Public
- **What it does:** Sends password reset email
- **Tables:** None
- **Edge Functions:** None (Supabase Auth built-in)
- **Notes:** Use Supabase Auth resetPasswordForEmail

---

#### WEB-AUTH-04: Reset Password
- **Route:** `/reset-password`
- **Design ref:** TBD
- **Role:** Public
- **What it does:** Sets new password from reset link
- **Notes:** Use Supabase Auth updateUser

---

### HOST SCREENS

---

#### WEB-HOST-01: Live Floor Plan
- **Route:** `/floor-plan`
- **Design ref:** TBD
- **Role:** host, owner, admin
- **What it does:** Full visual map of every table. Colour coded by status. Tap any table to see guest card and take action.
- **Tables read:**
  - tables (all columns, filtered by restaurant_id)
  - reservations (status, guest_id, party_size, reserved_at, waiter_id)
  - guests (full_name, tags, allergies, is_vip)
  - orders (status, is_preorder)
- **Tables write:**
  - tables (status, combined_with)
  - reservations (status, table_id, seated_at)
- **Edge Functions:** check-in-guest
- **Realtime:** Subscribe to tables:{restaurant_id}, reservations:{restaurant_id}
- **Colour coding:**
  - grey = empty
  - yellow = arriving soon (reserved_at within 30 min)
  - green = seated
  - red = overdue (seated longer than turn_time_minutes)
  - blue = reserved (future booking)
- **On tap table:** Show guest arrival card (see WEB-HOST-04)
- **Error states:** Realtime disconnected warning banner
- **Notes:** This screen must update live without refresh

---

#### WEB-HOST-02: Today's Reservations
- **Route:** `/reservations`
- **Design ref:** TBD
- **Role:** host, owner, admin
- **What it does:** Timeline view of all bookings today sorted by time
- **Tables read:**
  - reservations (all columns for today, filtered by restaurant_id)
  - guests (full_name, tags, allergies, is_vip, no_show_risk_score)
  - tables (table_number, section)
  - shifts (name, start_time, end_time)
- **Tables write:**
  - reservations (status, table_id, waiter_id)
- **Edge Functions:** None
- **Realtime:** Subscribe to reservations:{restaurant_id}
- **Each row shows:** guest name, party size, time, table, allergy pills, VIP badge, birthday badge, status badge
- **Actions:** Mark seated, mark no-show, mark cancelled, assign table, assign waiter
- **Filters:** By shift, by status, by time range
- **Notes:** Must update live when new bookings come in

---

#### WEB-HOST-03: New Reservation Form
- **Route:** `/reservations/new`
- **Design ref:** TBD
- **Role:** host, owner, admin
- **What it does:** Creates a reservation when a customer calls
- **Tables read:**
  - shifts (available slots for selected date)
  - tables (available tables)
  - guests (search by phone or email for existing guest)
- **Tables write:**
  - reservations (new row)
  - guests (new row if guest does not exist)
- **Edge Functions:** get-availability, create-booking
- **Realtime:** None
- **Fields:** Name, phone, party size, date, time slot, occasion, special request
- **Notes:** Search existing guest by phone before creating new profile

---

#### WEB-HOST-04: Guest Arrival Card
- **Route:** Modal/overlay on floor plan
- **Design ref:** TBD
- **Role:** host, waiter, owner
- **What it does:** Popup shown when guest checks in or table is tapped. First thing host reads on arrival.
- **Tables read:**
  - guests (all fields)
  - guest_notes (is_pinned = true, last 3 notes)
  - reservations (current reservation details, pre-order status)
  - orders (is_preorder, order items if pre-ordered)
- **Tables write:** None (read only card)
- **Edge Functions:** None
- **Shows:**
  - Full name large
  - Visit number (total_visits)
  - ALL allergies as red alert boxes at top
  - Tags as colour coded pills
  - Seating and noise preferences
  - Last visit date and last ordered items
  - Pre-order summary if applicable
  - All pinned notes
  - Occasion if noted
  - Loyalty tier and points balance
- **Quick actions:** Seat now, assign table, add note

---

#### WEB-HOST-05: Waitlist Screen
- **Route:** `/waitlist`
- **Design ref:** TBD
- **Role:** host, owner
- **What it does:** Live queue of walk-in guests waiting for a table
- **Tables read:** waitlist (all columns, filtered by restaurant_id, status = waiting)
- **Tables write:** waitlist (status, notified_at, response)
- **Edge Functions:** send-communication (SMS notification)
- **Realtime:** Subscribe to waitlist:{restaurant_id}
- **Each row shows:** Name, party size, wait time estimate, time joined, notes
- **Actions:** Seat now, notify by SMS, remove from list
- **Notes:** Position must recalculate automatically when someone is removed

---

#### WEB-HOST-06: Guest Search
- **Route:** `/guests/search`
- **Design ref:** TBD
- **Role:** host, waiter, owner
- **What it does:** Quick search for any guest by name or phone mid-service
- **Tables read:** guests (full_name, phone, email, allergies, tags, last_visit_at)
- **Edge Functions:** None
- **Notes:** Returns results as user types (debounced search, min 3 characters)

---

### WAITER SCREENS

---

#### WEB-WAITER-01: My Tables
- **Route:** `/my-tables`
- **Design ref:** TBD
- **Role:** waiter
- **What it does:** Shows only tables assigned to this server
- **Tables read:**
  - tables (filtered by waiter assignment)
  - reservations (current reservations at assigned tables)
  - guests (full_name, allergies, tags)
  - orders (status, is_preorder)
  - order_items (status)
- **Realtime:** Subscribe to tables:{restaurant_id}, orders:{restaurant_id}
- **Each table shows:** Guest name, time seated, party size, pre-order status, allergy flags
- **Notes:** Waiter only sees their own tables, not the full floor

---

#### WEB-WAITER-02: Table Order Screen
- **Route:** `/tables/[table_id]/order`
- **Design ref:** TBD
- **Role:** waiter
- **What it does:** Full order management for a specific table
- **Tables read:**
  - orders (current order for this table)
  - order_items (all items on current order)
  - menu_items (for adding new items)
  - menu_categories (for browsing menu)
  - guests (CRM card sidebar — allergies, preferences, notes)
- **Tables write:**
  - orders (status, subtotal, tip, total)
  - order_items (add new items, update status)
- **Edge Functions:** close-bill
- **Realtime:** Subscribe to orders:{restaurant_id}, order_items:{restaurant_id}
- **Shows:** Pre-ordered items already listed, add new items, kitchen status per dish
- **Notes:** Pre-ordered items appear automatically when table is seated

---

#### WEB-WAITER-03: Menu Browser
- **Route:** Component within table order screen
- **Design ref:** TBD
- **Role:** waiter
- **What it does:** Browse full menu to add items to an order
- **Tables read:**
  - menu_items (is_active = true, is_available = true)
  - menu_categories (sorted by sort_order)
- **Tables write:** order_items (add item to order)
- **Notes:** Show allergen icons on each item. Show allergy WARNING if item contains guest's allergen.

---

#### WEB-WAITER-04: Guest CRM Card
- **Route:** Sidebar component on table order screen
- **Design ref:** TBD
- **Role:** waiter
- **What it does:** Sidebar showing guest info while waiter is at the table
- **Tables read:**
  - guests (name, tags, allergies, preferences, total_visits, loyalty_tier)
  - guest_notes (last note from most recent visit)
- **Shows:** Name, tags, allergies in red, preferences, visit count, last visit note

---

#### WEB-WAITER-05: Kitchen Ticket Status
- **Route:** Component within table order screen
- **Design ref:** TBD
- **Role:** waiter
- **What it does:** Live status of each dish for the waiter's tables
- **Tables read:** order_items (status, course, kitchen_started_at, kitchen_ready_at)
- **Realtime:** Subscribe to order_items:{restaurant_id}
- **Colour coding:** grey = ordered, orange = in kitchen, green = ready, white = served

---

#### WEB-WAITER-06: Bill / Check Screen
- **Route:** `/tables/[table_id]/bill`
- **Design ref:** TBD
- **Role:** waiter
- **What it does:** Generates and closes the bill
- **Tables read:** orders, order_items, guests (for loyalty points)
- **Tables write:**
  - orders (tip_amount, payment_method, discount_amount, discount_reason, billed_at, paid_at, split_type)
- **Edge Functions:** close-bill
- **Shows:** All dishes, quantities, prices, subtotal, tax, tip input, total
- **Actions:** Print, mark as paid, add discount or comp, split bill by item or evenly
- **Notes:** close-bill Edge Function triggers update_guest_totals DB trigger automatically

---

#### WEB-WAITER-07: Add Visit Note
- **Route:** Modal within table order screen
- **Design ref:** TBD
- **Role:** waiter, host
- **What it does:** Write a note about the guest after service
- **Tables write:** guest_notes (note, category, is_pinned, guest_id, reservation_id, staff_id)
- **Note categories:** preference, complaint, compliment, incident, general

---

### KITCHEN SCREENS

---

#### WEB-KITCHEN-01: Kitchen Display Screen
- **Route:** `/kitchen`
- **Design ref:** TBD
- **Role:** kitchen
- **What it does:** Real-time order tickets for kitchen staff
- **Tables read:**
  - order_items (all active items, status != served)
  - orders (table info, is_preorder)
  - guests (allergies — shown as red alert on ticket)
  - menu_items (preparation_time_minutes)
- **Tables write:** order_items (status: in_progress, ready)
- **Realtime:** Subscribe to order_items:{restaurant_id}, orders:{restaurant_id}
- **Each ticket shows:** Table number, guest name, course, modifications, allergy flags in red
- **Actions:** Mark in progress, mark ready
- **Notes:** This screen never shows financial data. Allergies always shown in red.

---

### OWNER SCREENS

---

#### WEB-OWNER-01: Owner Dashboard
- **Route:** `/dashboard`
- **Design ref:** TBD
- **Role:** owner, admin
- **What it does:** Today at a glance with AI shift briefing
- **Tables read:**
  - restaurant_analytics (today's row)
  - reservations (tonight's bookings count, VIP count, no-show risk flags)
  - restaurants (current_shift_briefing)
  - guests (is_vip = true arriving tonight)
- **Edge Functions:** None (briefing pre-generated by cron)
- **Realtime:** Subscribe to reservations:{restaurant_id}
- **Shows:** Total covers tonight, revenue so far, VIPs arriving, no-show risk flags, AI briefing

---

#### WEB-OWNER-02: Guest CRM List
- **Route:** `/crm`
- **Design ref:** TBD
- **Role:** owner, admin
- **What it does:** Full searchable filterable list of every guest
- **Tables read:** guests (all columns, filtered by restaurant_id)
- **Edge Functions:** None
- **Filters:** All smart filters from CRM_SPEC.md
- **Sort options:** All sort options from CRM_SPEC.md
- **Columns:** Name, avatar, tags, total visits, last visit, total spend, avg spend, no-show risk, VIP badge, allergy icon, most ordered dish, loyalty tier, points
- **Notes:** Paginated — 50 guests per page. Search debounced.

---

#### WEB-OWNER-03: Guest Profile Page
- **Route:** `/crm/[guest_id]`
- **Design ref:** TBD
- **Role:** owner, admin
- **What it does:** Complete profile of one guest
- **Tables read:**
  - guests (all columns)
  - guest_notes (all notes, sorted by is_pinned then created_at)
  - reservations (all past reservations)
  - orders (all past orders)
  - order_items (all items per order)
  - loyalty_transactions (all points history)
  - communication_log (all messages sent)
  - guest_surveys (all survey responses)
  - allergy_incidents (if any)
- **Tables write:**
  - guests (tags, is_vip, is_blocked, preferences, notes)
  - guest_notes (add, pin, delete)
- **Edge Functions:** detect-duplicates, merge-guests
- **Shows:** All profile fields, visit timeline, food intelligence, financial totals, loyalty history, communication history, survey responses

---

#### WEB-OWNER-04: Analytics Dashboard
- **Route:** `/analytics`
- **Design ref:** TBD
- **Role:** owner, admin
- **What it does:** Full financial and operational analytics
- **Tables read:**
  - restaurant_analytics (date range filtered)
  - orders (for real-time today's numbers)
  - guests (new vs returning counts)
- **Edge Functions:** calculate-demand-forecast
- **Charts:**
  - Revenue line chart (daily, weekly, monthly, yearly toggle)
  - Cover counts bar chart
  - No-show rate over time
  - Busiest days heatmap
  - Busiest time slots heatmap
  - Booking source pie chart
  - Top 10 dishes table
  - Staff performance leaderboard
  - Labour cost vs revenue

---

#### WEB-OWNER-05: Most Ordered Items Dashboard
- **Route:** `/analytics/menu`
- **Design ref:** TBD
- **Role:** owner, admin
- **What it does:** Full menu performance breakdown
- **Tables read:**
  - order_items (grouped by menu_item_id)
  - menu_items (name, price, cost_price, category)
  - restaurant_analytics (top_dishes_json)
- **Shows:** Every item ranked by orders and revenue, margin per dish, best by day and time, items ordered together

---

#### WEB-OWNER-06: Menu Management
- **Route:** `/menu`
- **Design ref:** TBD
- **Role:** owner, admin
- **What it does:** Add, edit, remove dishes and categories
- **Tables read:** menu_items, menu_categories (filtered by restaurant_id)
- **Tables write:** menu_items (all fields), menu_categories (name, sort_order)
- **Edge Functions:** scan-menu (for PDF/photo import)
- **Actions:** Add item, edit item, toggle available tonight, toggle pre-orderable, drag reorder categories, CSV import, scan menu photo

---

#### WEB-OWNER-07: Floor Plan Editor
- **Route:** `/settings/floor-plan`
- **Design ref:** TBD
- **Role:** owner, admin
- **What it does:** Drag and drop canvas to set up restaurant layout
- **Tables read:** tables (all columns, filtered by restaurant_id)
- **Tables write:** tables (position_x, position_y, table_number, capacity, section, shape, is_active)
- **Notes:** Uses a canvas library (e.g. Konva.js or React Flow). Positions saved on drag end.

---

#### WEB-OWNER-08: Shift Management
- **Route:** `/settings/shifts`
- **Design ref:** TBD
- **Role:** owner, admin
- **What it does:** Create and edit service periods
- **Tables read:** shifts (filtered by restaurant_id)
- **Tables write:** shifts (all fields)
- **Notes:** Days of week selector, time pickers, slot duration selector, blackout date picker

---

#### WEB-OWNER-09: Staff Management
- **Route:** `/settings/staff`
- **Design ref:** TBD
- **Role:** owner, admin
- **What it does:** Add, remove, assign roles to staff accounts
- **Tables read:** user_profiles (filtered by restaurant_id, role != customer)
- **Tables write:** user_profiles (role, restaurant_id)
- **Shows:** Name, email, role, last login, currently clocked in status

---

#### WEB-OWNER-10: Staff Scheduling
- **Route:** `/staff/schedule`
- **Design ref:** TBD
- **Role:** owner, admin
- **What it does:** Weekly shift schedule for all staff
- **Tables read:**
  - staff_shifts (week view, filtered by restaurant_id)
  - user_profiles (staff members)
  - shifts (service periods)
  - staff_availability (staff available days)
- **Tables write:** staff_shifts (assign staff to service periods)
- **Notes:** Weekly calendar view. Drag staff onto shifts.

---

#### WEB-OWNER-11: Events Management
- **Route:** `/events`
- **Design ref:** TBD
- **Role:** owner, admin
- **What it does:** Create and manage special events with ticket sales
- **Tables read:** events, event_tickets (filtered by restaurant_id)
- **Tables write:** events (all fields)
- **Edge Functions:** None (Stripe handled separately)
- **Shows:** Event list, tickets sold vs capacity, revenue per event

---

#### WEB-OWNER-12: Marketing Messages
- **Route:** `/marketing`
- **Design ref:** TBD
- **Role:** owner, admin
- **What it does:** Compose and send SMS or email to filtered guest segments
- **Tables read:** guests (for segment preview count)
- **Tables write:** communication_log (new message records)
- **Edge Functions:** send-communication
- **Notes:** Filter guests same as CRM list screen. Show preview count before sending.

---

#### WEB-OWNER-13: AI Assistant
- **Route:** `/ai`
- **Design ref:** TBD
- **Role:** owner, admin
- **What it does:** Natural language queries over CRM and analytics
- **Tables read:** None directly — AI reads via Edge Function
- **Edge Functions:** ai-crm-query
- **Notes:** Chat interface. Owner types question. AI returns answer. Never sends financial totals to Claude — only aggregates and counts.

---

#### WEB-OWNER-14: Settings
- **Route:** `/settings`
- **Design ref:** TBD
- **Role:** owner, admin
- **What it does:** Restaurant profile, booking rules, deposit config, loyalty config
- **Tables read:** restaurants (all columns)
- **Tables write:** restaurants (all fields except id, created_at, stripe_customer_id)
- **Sections:** Restaurant profile, hours, booking window, deposit policy, loyalty config, notification preferences

---

#### WEB-OWNER-15: Restaurant Onboarding Wizard
- **Route:** `/onboarding`
- **Design ref:** TBD
- **Role:** owner (new accounts only)
- **What it does:** Step by step setup for new restaurants
- **Tables write:**
  - restaurants (profile, hours, settings)
  - tables (initial floor plan)
  - shifts (initial service periods)
  - menu_categories (initial categories)
  - menu_items (initial menu)
  - user_profiles (additional staff)
- **Steps:** 1. Restaurant details, 2. Hours, 3. Floor plan, 4. Shifts, 5. Menu, 6. Staff, 7. Done

---

#### WEB-OWNER-16: Billing
- **Route:** `/billing`
- **Design ref:** TBD
- **Role:** owner, admin
- **What it does:** Seatly subscription management
- **Tables read:** restaurants (plan, stripe_customer_id)
- **Edge Functions:** None (Stripe customer portal redirect)
- **Notes:** Redirects to Stripe customer portal for plan management

---

### ADMIN SCREENS

---

#### WEB-ADMIN-01: Admin Dashboard
- **Route:** `/admin`
- **Design ref:** TBD
- **Role:** admin only
- **What it does:** Platform-wide overview for Seatly internal team
- **Tables read:** restaurants (all rows — admin sees all), user_profiles (counts)
- **Notes:** Admin bypasses restaurant_id filtering via RLS

---

## PLATFORM: MOBILE APP (Expo SDK 52 + React Native)

---

### CUSTOMER SCREENS

---

#### MOB-CUST-01: Onboarding Splash
- **Screen:** OnboardingScreen
- **Design ref:** TBD
- **Role:** Public (unauthenticated)
- **What it does:** Brand intro on first launch
- **Tables:** None
- **Notes:** Show only on first launch. Use AsyncStorage to track.

---

#### MOB-CUST-02: Sign Up
- **Screen:** SignUpScreen
- **Design ref:** TBD
- **Role:** Public
- **What it does:** Creates a new customer account
- **Tables write:** user_profiles (role: customer, dietary_restrictions, allergies)
- **Notes:** Collect allergies and dietary preferences upfront so AI never asks again

---

#### MOB-CUST-03: Login
- **Screen:** LoginScreen
- **Design ref:** TBD
- **Role:** Public
- **What it does:** Email and password login with biometric option
- **Tables read:** user_profiles (role)
- **Notes:** Face ID / Touch ID via Expo LocalAuthentication. Persist session via Expo SecureStore.

---

#### MOB-CUST-04: Explore / Home
- **Screen:** ExploreScreen
- **Design ref:** TBD
- **Role:** customer
- **What it does:** Browse and search restaurants
- **Tables read:**
  - restaurants (name, slug, cuisine_type, description, logo_url, cover_photo_url, city)
  - shifts (available slots tonight)
- **Edge Functions:** get-availability (for showing available slots)
- **Filters:** By cuisine, by city, by available tonight
- **Notes:** Main home tab

---

#### MOB-CUST-05: Restaurant Profile
- **Screen:** RestaurantProfileScreen
- **Design ref:** TBD
- **Role:** customer
- **What it does:** Full restaurant details and available booking slots
- **Tables read:**
  - restaurants (all public fields)
  - menu_items (is_active = true, preview of top items)
  - shifts (available slots for selected date)
- **Edge Functions:** get-availability
- **Shows:** Photos, description, hours, cuisine, address, map, available time slots by date

---

#### MOB-CUST-06: Booking Flow
- **Screen:** BookingFlowScreen (multi-step)
- **Design ref:** TBD
- **Role:** customer
- **What it does:** Complete a reservation in under 60 seconds
- **Tables read:**
  - shifts (available slots)
  - restaurants (deposit_policy_json)
  - user_profiles (dietary_restrictions, allergies — pre-filled)
- **Tables write:** reservations, guests
- **Edge Functions:** get-availability, create-booking
- **Steps:**
  1. Date selection
  2. Party size
  3. Available time slots
  4. Special request and occasion
  5. Confirm (deposit charge if required)
- **Notes:** Must complete in under 60 seconds. Pre-fill known preferences.

---

#### MOB-CUST-07: Pre-Order Screen
- **Screen:** PreOrderScreen
- **Design ref:** TBD
- **Role:** customer
- **What it does:** Browse menu and add items to reservation before arriving
- **Tables read:**
  - menu_items (is_preorderable = true, is_active = true)
  - menu_categories
  - reservations (cutoff time)
- **Tables write:** orders (is_preorder = true), order_items
- **Notes:** Show cutoff time prominently. Disable after cutoff.

---

#### MOB-CUST-08: Pre-Order Summary
- **Screen:** PreOrderSummaryScreen
- **Design ref:** TBD
- **Role:** customer
- **What it does:** Review and submit pre-order
- **Tables read:** order_items (current pre-order), menu_items (names, prices)
- **Tables write:** orders (status: pending)
- **Shows:** Itemised list, total, submit or cancel button

---

#### MOB-CUST-09: My Bookings
- **Screen:** MyBookingsScreen
- **Design ref:** TBD
- **Role:** customer
- **What it does:** List of upcoming and past reservations
- **Tables read:**
  - reservations (filtered by guest_id, sorted by reserved_at)
  - restaurants (name, logo_url)
- **Shows:** Restaurant name, date, status badge, party size
- **Tabs:** Upcoming / Past

---

#### MOB-CUST-10: Booking Detail
- **Screen:** BookingDetailScreen
- **Design ref:** TBD
- **Role:** customer
- **What it does:** Full booking info with actions
- **Tables read:**
  - reservations (all fields)
  - restaurants (name, address)
  - orders (pre-order summary if applicable)
  - order_items (pre-ordered items)
  - tables (table_number once assigned)
- **Tables write:** reservations (status: cancelled)
- **Edge Functions:** process-deposit-refund (on cancel within window)
- **Shows:** All booking info, QR check-in code, pre-order summary, modify or cancel button

---

#### MOB-CUST-11: Arrival Screen
- **Screen:** ArrivalScreen
- **Design ref:** TBD
- **Role:** customer
- **What it does:** Shown when table is ready. One-tap check-in.
- **Tables read:** reservations (table_id), tables (table_number)
- **Tables write:** reservations (checked_in_at)
- **Edge Functions:** check-in-guest
- **Notes:** Triggered by push notification. Shows guest name and table number large.

---

#### MOB-CUST-12: AI Chat Assistant
- **Screen:** AIChatScreen
- **Design ref:** TBD
- **Role:** customer
- **What it does:** Conversational booking assistant
- **Tables read:** None directly — AI reads via Edge Function
- **Edge Functions:** ai-chat
- **Notes:** Full booking can be completed inside chat. AI knows guest preferences. Never shows financial data to Claude.

---

#### MOB-CUST-13: My Profile
- **Screen:** ProfileScreen
- **Design ref:** TBD
- **Role:** customer
- **What it does:** Edit personal details and preferences
- **Tables read:** user_profiles (all fields)
- **Tables write:** user_profiles (full_name, phone, dietary_restrictions, allergies, seating_preference, noise_preference, notification_preferences_json, car_details_json)
- **Sections:** Personal info, dietary preferences, allergies, seating preferences, notifications, car details (valet)

---

#### MOB-CUST-14: Visit History
- **Screen:** VisitHistoryScreen
- **Design ref:** TBD
- **Role:** customer
- **What it does:** Full history of past visits
- **Tables read:**
  - reservations (completed, filtered by guest_id)
  - orders (per reservation)
  - order_items (per order, with rating)
  - restaurants (name)
- **Tables write:** order_items (rating — guest rates dishes after visit)
- **Shows:** Restaurant, date, dishes ordered, total spent, dish ratings

---

#### MOB-CUST-15: Loyalty Screen
- **Screen:** LoyaltyScreen
- **Design ref:** TBD
- **Role:** customer
- **What it does:** Loyalty points balance, tier, history, and rewards
- **Tables read:**
  - guests (loyalty_points_balance, loyalty_tier)
  - loyalty_transactions (full history)
  - restaurants (loyalty_config_json — tier thresholds and rewards)
- **Tables write:** loyalty_transactions (redeem reward)
- **Shows:** Current points, tier badge, progress to next tier, transaction history, available rewards

---

#### MOB-CUST-16: Saved Restaurants
- **Screen:** SavedScreen
- **Design ref:** TBD
- **Role:** customer
- **What it does:** Favourites list for quick rebooking
- **Tables read:** restaurants (saved ones — requires saved_restaurants join table)
- **Notes:** May need a saved_restaurants table — check BACKEND.md first

---

#### MOB-CUST-17: Events Browse
- **Screen:** EventsScreen
- **Design ref:** TBD
- **Role:** customer
- **What it does:** Browse and purchase event tickets
- **Tables read:** events (is_active = true, date >= today)
- **Tables write:** event_tickets
- **Edge Functions:** None (Stripe handled in create-booking flow)

---

#### MOB-CUST-18: Waitlist
- **Screen:** WaitlistScreen
- **Design ref:** TBD
- **Role:** customer
- **What it does:** Join and track waitlist position remotely
- **Tables read:** waitlist (position, estimated_wait_minutes, status)
- **Tables write:** waitlist (remote_join = true)
- **Realtime:** Subscribe to waitlist:{restaurant_id} for position updates
- **Shows:** Current position, estimated wait, confirm or decline when notified

---

### RESTAURANT OWNER MOBILE SCREENS

---

#### MOB-OWNER-01: Tonight Summary
- **Screen:** TonightScreen
- **Design ref:** TBD
- **Role:** owner
- **What it does:** Quick overview of tonight's service
- **Tables read:**
  - restaurant_analytics (today's row)
  - reservations (tonight, VIP count, no-show risk flags)
  - restaurants (current_shift_briefing)
- **Shows:** Covers tonight, revenue so far, VIP count, no-show flags, AI briefing

---

#### MOB-OWNER-02: Live Floor (Read Only)
- **Screen:** FloorScreen
- **Design ref:** TBD
- **Role:** owner
- **What it does:** Real-time table status map — read only from mobile
- **Tables read:** tables, reservations (same as web floor plan)
- **Realtime:** Subscribe to tables:{restaurant_id}
- **Notes:** No editing from mobile. View only.

---

#### MOB-OWNER-03: Reservations List
- **Screen:** ReservationsScreen
- **Design ref:** TBD
- **Role:** owner
- **What it does:** Today's full reservation list
- **Tables read:** reservations, guests (same as web WEB-HOST-02)
- **Notes:** Tap any reservation to see guest card

---

#### MOB-OWNER-04: Guest CRM Mobile
- **Screen:** GuestProfileScreen
- **Design ref:** TBD
- **Role:** owner
- **What it does:** Simplified guest profile for mobile viewing
- **Tables read:**
  - guests (key stats, tags, allergies, last_visit_at)
  - guest_notes (pinned notes only)
- **Shows:** Key stats, tags, last visit, allergy alert, pinned notes

---

#### MOB-OWNER-05: Notifications
- **Screen:** NotificationsScreen
- **Design ref:** TBD
- **Role:** owner
- **What it does:** Push alert history
- **Shows:** New bookings, no-shows, large party arrivals, VIP check-ins
- **Notes:** Expo Push Notifications. Deep link to relevant screen on tap.

---

## CURSOR PROMPT TEMPLATE

Use this exact prompt structure when building any screen:

```
Read SCREENS.md, BACKEND.md, and .cursorrules.

Build screen [SCREEN ID]: [SCREEN NAME]
Platform: [web / mobile]
Design reference: [Figma frame name / screenshot path / TBD]

Connect to exactly these backend resources as listed in SCREENS.md:
- Tables: [list from SCREENS.md]
- Edge Functions: [list from SCREENS.md]
- Realtime: [list from SCREENS.md]

Requirements:
- Apply RLS role: [role from SCREENS.md]
- Handle loading state
- Handle empty state
- Handle error state
- Use tokens from packages/tokens for all styling
- Never hardcode colours, spacing, or font sizes
- TypeScript only
- Named exports only

Show me the plan first. Wait for my approval.
```

---

## DESIGN REFERENCE — HOW TO FILL IN TBD

When your UI is designed, update each screen's `design_ref` field:

**If using Figma MCP:**
```
design_ref: "Figma frame name exactly as it appears in your Figma file"
```
Cursor will read the frame directly via Figma MCP.

**If using screenshots:**
```
design_ref: "designs/web/floor-plan.png"
```
Drop screenshots in a `designs/` folder and reference the path.

**If building directly in Cursor:**
```
design_ref: "Build based on APP_BIBLE.md description only"
```
Cursor will use the screen description from APP_BIBLE.md as the visual guide.

---

*Seatly SCREENS.md — Version 1.0 — March 2026*
*Confidential — For internal use only*
