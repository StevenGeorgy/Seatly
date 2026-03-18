# Seatly — CHECKLIST.md
# Build Progress Tracker
# Update this after every completed feature
# Status: [ ] Not Started | [~] In Progress | [x] Done

---

## HOW TO USE THIS FILE

- Change `[ ]` to `[~]` when you start a feature
- Change `[~]` to `[x]` when it is built, tested, and working
- Review this at the start of every Cursor session
- Never start building something already marked `[x]`

---

## FOUNDATION

- [ ] Monorepo folder structure created (apps/web, apps/mobile, packages/tokens, packages/types)
- [ ] .gitignore created and committed
- [ ] .env.example created and committed
- [ ] .cursorrules file created in project root
- [ ] packages/tokens/index.ts created with colour, spacing, and font placeholders
- [ ] BACKEND.md in project root
- [ ] CHECKLIST.md in project root
- [ ] README.md in project root
- [ ] GitHub repo created with branch protection on main
- [ ] Supabase project created (Data API on, automatic RLS on, Postgres default)

---

## PHASE 1 — CORE TABLES

### Database
- [x] restaurants table created with all columns
- [x] user_profiles table created with all columns
- [x] tables table created with all columns
- [x] shifts table created with all columns
- [x] RLS policies set on all Phase 1 tables
- [x] Seed data: 2 test restaurants
- [x] Seed data: 5 tables per restaurant
- [x] Seed data: 2 shifts per restaurant (Lunch and Dinner)
- [x] Seed data: 1 owner account and 1 host account per restaurant (run `npm run seed:users`)
- [ ] TypeScript types exported to packages/types
- [x] BACKEND.md Phase 1 marked [x]

---

## PHASE 2 — AUTH

### Database
- [ ] Supabase Auth configured with email
- [ ] Role assignment Edge Function on signup
- [ ] Session handling and token refresh working

### Web App
- [ ] Login screen (email + password)
- [ ] Sign up screen for restaurant owners
- [ ] Role-based redirect on login (host → floor plan, owner → dashboard)
- [ ] Forgot password flow
- [ ] Password reset flow
- [ ] Protected route wrapper (unauthenticated users redirected to login)

### Mobile App
- [ ] Onboarding splash screen
- [ ] Login screen
- [ ] Sign up screen for customers
- [ ] Face ID and Touch ID biometric login
- [ ] Role toggle on sign up (I am a restaurant owner)
- [ ] Auth state persistence (stay logged in across restarts)

---

## PHASE 3 — RESERVATIONS

### Database
- [x] reservations table created with all columns
- [x] waitlist table created with all columns
- [x] guests table created (required for reservations)
- [x] RLS policies set on reservations and waitlist
- [ ] Availability engine Edge Function (slots per shift, conflict detection)
- [ ] Booking confirmation email via Resend
- [ ] Push notification trigger on new booking
- [ ] Booking reminder push notification (2 hours before)
- [x] Supabase Realtime channel: reservations:{restaurant_id}
- [x] Supabase Realtime channel: waitlist:{restaurant_id}
- [x] Supabase Realtime channel: tables:{restaurant_id}
- [ ] BACKEND.md Phase 3 marked [x]

### Web App
- [ ] Reservations dashboard (today's list view)
- [ ] Reservations dashboard (timeline view)
- [ ] Visual live floor plan (colour coded by table status)
- [ ] New reservation form (for phone bookings)
- [ ] Waitlist panel (queue with estimated wait)
- [ ] Reservation detail sidebar (edit, cancel, notes)
- [ ] Seat and action panel (mark seated, no-show, cancelled)
- [ ] Embeddable booking widget (iframe for restaurant websites)
- [ ] Guest search (search by name or phone mid-service)

### Mobile App
- [ ] Restaurant explore and search screen
- [ ] Restaurant profile page (photos, hours, menu preview, available slots)
- [ ] Booking flow step 1: date selection
- [ ] Booking flow step 2: party size
- [ ] Booking flow step 3: available time slots
- [ ] Booking flow step 4: special request and occasion
- [ ] Booking flow step 5: confirm (full flow under 60 seconds)
- [ ] My bookings screen (upcoming and past)
- [ ] Booking detail screen with cancel and modify
- [ ] Remote waitlist join from mobile app
- [ ] Real-time wait position shown to guest
- [ ] SMS notification when table is ready
- [ ] Guest confirms or declines table from phone

---

## PHASE 4 — MENU

### Database
- [x] menu_items table created with all columns
- [x] menu_categories table created with all columns
- [x] RLS policies set
- [x] Seed data: 20 test menu items across 4 categories
- [x] BACKEND.md Phase 4 marked [x]

### Web App
- [ ] Menu management screen (add, edit, remove dishes)
- [ ] Category management (create, reorder by drag and drop)
- [ ] Toggle availability tonight per item
- [ ] Toggle is_preorderable per item
- [ ] Photo upload per item
- [ ] Allergen and dietary flag editor per item
- [ ] Menu CSV bulk import
- [ ] Menu scanning (upload photo or PDF, AI extracts items)
- [ ] Copy from previous menu

### Mobile App
- [ ] Menu browse screen by category (for pre-ordering)
- [ ] Menu item detail view (photo, allergens, description)

---

## PHASE 5 — ORDERS AND ARRIVAL

### Database
- [x] orders table created with all columns
- [x] order_items table created with all columns
- [x] RLS policies set
- [ ] Pre-order cutoff logic (configurable minutes before reservation)
- [ ] Kitchen ticket generation on guest check-in
- [ ] Table assignment on arrival
- [x] Supabase Realtime channel: orders:{restaurant_id}
- [x] Supabase Realtime channel: order_items:{restaurant_id}
- [ ] close_bill Edge Function (triggers CRM update)
- [ ] BACKEND.md Phase 5 marked [x]

### Web App
- [ ] Order management screen (live view of all orders)
- [ ] Pre-orders panel (orders on upcoming reservations)
- [ ] Table order screen (waiter views and adds items)
- [ ] Menu browser on table screen (search and add items)
- [ ] Kitchen display screen (real-time tickets)
- [ ] Dish status: received, in progress, ready, served
- [ ] Course firing by waiter
- [ ] Allergy alert on kitchen ticket
- [ ] Bill and check generation screen
- [ ] Split bill by item
- [ ] Split bill evenly
- [ ] Add discount or comp
- [ ] Mark as paid
- [ ] Bill to room (hotel restaurants)
- [ ] Guest arrival alert banner (name and allergy flags)
- [ ] Guest CRM card sidebar on table screen

### Mobile App
- [ ] Pre-order screen (browse menu, add to reservation)
- [ ] Pre-order summary with modify option before cutoff
- [ ] Arrival push notification (table is ready)
- [ ] In-app arrival screen with one-tap check-in
- [ ] QR check-in code on booking detail

---

## PHASE 6 — GUEST CRM

### Database
- [x] guests table created with all columns
- [x] guest_notes table created with all columns
- [x] allergy_incidents table created (permanent, undeletable)
- [x] loyalty_transactions table created
- [x] communication_log table created
- [x] guest_surveys table created
- [x] RLS policies set on all CRM tables
- [ ] Profile auto-creation on first booking
- [ ] Deduplication logic (match by phone and email)
- [x] DB trigger: update_guest_totals (fires on orders.paid_at)
- [x] DB trigger: increment_no_show
- [x] DB trigger: increment_cancellation
- [x] DB trigger: update_loyalty_balance
- [ ] CRM search and filter API (all filter types)
- [ ] Seed data: 10 test guests with visit history
- [ ] BACKEND.md Phase 6 marked [x]

### Web App
- [ ] Guest CRM list screen (searchable, sortable, paginated)
- [ ] All smart filters working (all filter types from spec)
- [ ] All sort options working
- [ ] Guest profile page (all fields)
- [ ] Visit timeline (every past visit)
- [ ] Food intelligence section (most ordered, food vs drinks split)
- [ ] Financial totals section
- [ ] Tag manager (add, remove, create custom tags)
- [ ] Preferences editor
- [ ] Add note form (with category selection)
- [ ] Pinned notes at top of profile
- [ ] Guest arrival card popup
- [ ] Allergy RED ALERT everywhere guest appears
- [ ] Allergy warning on item add if conflict detected
- [ ] Duplicate detection and merge flow
- [ ] Block and unblock guest
- [ ] Export guest list to CSV

### Mobile App
- [ ] My profile screen (edit name, phone, preferences, allergies)
- [ ] Visit history screen (past visits with dishes and spend)
- [ ] Loyalty points balance and history
- [ ] Loyalty tier badge
- [ ] Redeem loyalty rewards in app
- [ ] Rate visit (1-5 stars) after completion
- [ ] Rate individual dishes after visit

---

## PHASE 7 — FINANCIAL AND EVENTS

### Database
- [x] events table created
- [x] event_tickets table created
- [x] gift_cards table created
- [x] promo_codes table created
- [x] corporate_accounts table created
- [x] DB trigger: update_tickets_sold
- [ ] Deposit charge via Stripe on booking
- [ ] Auto-refund deposit within cancellation window
- [ ] Auto-forfeit deposit on no-show
- [ ] BACKEND.md Phase 7 marked [x]

### Web App
- [ ] Events management screen (create, edit, manage tickets)
- [ ] Event ticket sales view
- [ ] Gift card management screen
- [ ] Promo code management screen
- [ ] Corporate accounts screen
- [ ] Deposit configuration in settings
- [ ] Cancellation window configuration in settings

### Mobile App
- [ ] Events browse screen
- [ ] Event ticket purchase flow
- [ ] Gift card purchase
- [ ] Promo code input on booking

---

## PHASE 8 — STAFF

### Database
- [x] staff_shifts table created
- [x] staff_clock_records table created
- [x] staff_availability table created
- [x] RLS policies set
- [ ] Late clock-in alert logic
- [ ] BACKEND.md Phase 8 marked [x]

### Web App
- [ ] Staff management screen (add, remove, assign roles)
- [ ] Weekly shift scheduling screen
- [ ] Staff availability management
- [ ] Clock in and clock out
- [ ] Labour cost tracking per shift
- [ ] Staff performance leaderboard
- [ ] End of shift report per waiter
- [ ] Export clock records for payroll

---

## PHASE 9 — ANALYTICS

### Database
- [x] restaurant_analytics table created
- [x] current_shift_briefing column on restaurants
- [x] pg_cron + pg_net extensions enabled
- [x] seatly_cron_config table for cron secret
- [x] Realtime publication: reservations, tables, orders, order_items, waitlist
- [x] Storage buckets: restaurant-logos, menu-photos, user-avatars, cover-photos
- [x] compute_analytics nightly cron job (4am UTC)
- [x] calculate_no_show_risk nightly cron job (2am UTC)
- [x] calculate_lifetime_value nightly cron job (2am UTC)
- [x] run_auto_tagging nightly cron job (3am UTC)
- [x] generate_shift_briefing nightly cron job (5am UTC)
- [x] send_birthday_messages morning cron job (8am UTC)
- [x] send_anniversary_messages morning cron job (8am UTC)
- [x] expire_loyalty_points monthly cron job (midnight 1st)
- [x] BACKEND.md Phase 9 marked [x]

### Web App
- [ ] Analytics dashboard (revenue charts daily, weekly, monthly, yearly)
- [ ] Cover counts by period
- [ ] No-show rate chart
- [ ] Average spend per cover chart
- [ ] Busiest days heatmap
- [ ] Busiest time slots heatmap
- [ ] Top 10 dishes by orders
- [ ] Top 10 dishes by revenue
- [ ] Most ordered items dashboard (full menu performance)
- [ ] Booking source breakdown
- [ ] New vs returning guest ratio
- [ ] Staff performance leaderboard
- [ ] Food cost and margin per dish
- [ ] Labour cost per shift chart
- [ ] Deposit revenue and forfeitures
- [ ] Loyalty points issued and redeemed
- [ ] End of day report (auto-emailed to owner)
- [ ] Monthly financial summary (auto-emailed)

### Mobile App
- [ ] Tonight at a glance widget
- [ ] Key stat cards (covers, revenue, no-shows, VIPs)
- [ ] Weekly summary push notification

---

## PHASE 10 — AI LAYER

### Backend
- [ ] Claude API integration via Supabase Edge Function
- [ ] ai_chat Edge Function (booking intent detection)
- [ ] Context injection (guest history, restaurant info, available slots, menu)
- [ ] ai_crm_query Edge Function (owner natural language queries)
- [ ] Demand forecasting Edge Function
- [ ] VAPI voice AI receptionist integration (answers calls, takes bookings)
- [ ] BACKEND.md Phase 10 marked [x]

### Web App
- [ ] Owner AI assistant panel
- [ ] AI-generated shift briefing on dashboard
- [ ] Natural language CRM search
- [ ] AI menu item removal suggestions (low orders and low margin)
- [ ] AI slow night prediction with promotion suggestion
- [ ] AI weekly performance summary email
- [ ] AI lapsed guest re-engagement suggestions

### Mobile App
- [ ] Customer AI chat screen
- [ ] Full booking flow inside the chat
- [ ] AI menu item suggestions based on past orders
- [ ] Booking confirmation summary card in chat

---

## PHASE 11 — COMMUNICATIONS

### Backend
- [ ] send_communication Edge Function (SMS via Twilio, email via Resend)
- [ ] Two-way SMS receiving and logging
- [ ] Booking confirmation automated message
- [ ] Booking reminder automated message (2 hours before)
- [ ] Post-visit thank you automated message
- [ ] Re-engagement message (90 days no visit)
- [ ] Birthday message automated
- [ ] Anniversary message automated
- [ ] Table ready SMS automated
- [ ] Deposit receipt automated
- [ ] Loyalty points update automated
- [ ] Review request automated (with Google Review link)
- [ ] Post-visit survey automated
- [ ] Event ticket confirmation automated

### Web App
- [ ] Marketing message composer (send to filtered segment)
- [ ] Communication history view on guest profile
- [ ] Two-way SMS inbox (see guest replies)
- [ ] Unsubscribe management
- [ ] Survey builder (custom questions)
- [ ] Survey results dashboard
- [ ] Review request management
- [ ] Internal satisfaction flag (unhappy guests)

---

## PHASE 12 — LAUNCH PREP

### Backend
- [ ] Stripe billing integration (Seatly subscription plans)
- [ ] Webhook hardening and signature verification
- [ ] Rate limiting on all Edge Functions
- [ ] Sentry error logging configured
- [ ] Database backup schedule configured
- [ ] GDPR and PIPEDA data deletion flow
- [ ] Full performance review

### Web App
- [ ] Restaurant onboarding wizard (floor plan, shifts, menu, hours, staff)
- [ ] Billing and subscription screen
- [ ] Settings page (restaurant profile, notifications, integrations)
- [ ] Multi-location switcher (for owners with multiple restaurants)
- [ ] Google Reserve integration
- [ ] Instagram booking button integration
- [ ] POS import (Square, Toast, or Lightspeed)

### Mobile App
- [ ] App Store submission (iOS)
- [ ] Google Play submission (Android)
- [ ] Offline fallback screens
- [ ] Push notification permissions flow
- [ ] App icon final
- [ ] Splash screen final
- [ ] Store screenshots

---

## PROGRESS SUMMARY

| Phase | Status | Notes |
|-------|--------|-------|
| Foundation | [ ] | |
| Phase 1 — Core Tables | [x] | Database + RLS + seed complete |
| Phase 2 — Auth | [~] | RLS policies done; web/mobile screens pending |
| Phase 3 — Reservations | [~] | Database + RLS done; availability engine pending |
| Phase 4 — Menu | [x] | Database + RLS + seed complete |
| Phase 5 — Orders and Arrival | [~] | Database + triggers done; Edge Functions pending |
| Phase 6 — Guest CRM | [~] | Database + triggers done; Edge Functions pending |
| Phase 7 — Financial and Events | [~] | Database + triggers done; Stripe integration pending |
| Phase 8 — Staff | [x] | Database + RLS complete |
| Phase 9 — Analytics | [~] | Table built; cron jobs pending |
| Phase 10 — AI Layer | [ ] | |
| Phase 11 — Communications | [ ] | |
| Phase 12 — Launch Prep | [ ] | |

---

*Update this file after every completed feature. Last updated: March 2026*
