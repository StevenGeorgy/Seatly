# Seatly — APP_BIBLE.md
# Full Product Specification
# Version 1.0 — March 2026
# Read this before building any screen

---

## What We Are Building

Seatly is three products fused into one:

- A **booking platform** — customers find restaurants, reserve tables, and pre-order food from a mobile app
- A **restaurant operating system** — hosts, waiters, and managers run their entire floor from a web app in real time
- A **guest CRM with AI** — every guest becomes a permanent profile with full dining history, spending records, preferences, and AI-generated intelligence

The experience: a guest books on their phone, pre-orders the tasting menu, walks in and is greeted by name, finds their food already being prepared, and the waiter already knows they are allergic to nuts and prefer a window seat. After the visit, the CRM records every dish they ordered, what they spent, and any staff notes — permanently.

---

## User Types

| Role | Where they work | What they do |
|------|----------------|--------------|
| Customer / diner | Mobile app | Books tables, pre-orders food, chats with AI assistant |
| Front-of-house host | Web app | Manages floor plan, seats guests, handles walk-ins and waitlist |
| Waiter / server | Web app | Takes orders at the table, views guest CRM card, closes bills |
| Restaurant owner | Web app + mobile app | Runs the CRM, views analytics, manages menu and settings |
| Kitchen staff | Web app (kitchen screen only) | Views and updates kitchen display tickets |
| Seatly admin | Web app | Manages multiple restaurants, billing, platform settings |

---

## Tech Stack

| Layer | Tool |
|-------|------|
| Web app | Next.js (App Router) + Tailwind CSS |
| Mobile app | Expo SDK 52 + React Native |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Realtime | Supabase Realtime subscriptions |
| File storage | Supabase Storage |
| AI assistant | Claude API (claude-sonnet-4-6) |
| Emails | Resend |
| SMS | Twilio |
| Push notifications | Expo Push Notifications |
| Payments / billing | Stripe |
| Error monitoring | Sentry |
| Voice AI | VAPI |
| Shared design tokens | packages/tokens |

---

## Design Rules

- No hardcoded hex values or pixel values anywhere
- Everything comes from packages/tokens
- If it is not in the token file, it does not exist
- Both web and mobile must look like the same brand

---

## WEB APP — Every Screen

### Auth Screens
| Screen | What it does |
|--------|--------------|
| Login | Email and password. Role-based redirect on login. |
| Sign up | For new restaurant owners only. |
| Forgot password | Email reset flow. |
| Restaurant onboarding wizard | Step-by-step: floor plan, shifts, menu, staff. New restaurants complete this on first login. |

### Front-of-House Host Screens
| Screen | What it does |
|--------|--------------|
| Live floor plan | Full visual map of every table. Colour coded: grey = empty, yellow = arriving soon, green = seated, red = overdue. Tap any table to see the guest card and take action. |
| Today's reservations | Timeline view of all bookings today sorted by time. Each row: guest name, party size, time, table, allergy / VIP / birthday tags, status. |
| Guest arrival card | Popup when a guest checks in or is seated. Shows: name, visit number, tags, allergies in red, preferences, last visit, pre-order summary, pinned notes. |
| New reservation form | Used when a customer calls. Fields: name, phone, party size, date, time, occasion, special request. Creates reservation immediately. |
| Waitlist screen | Live queue of walk-in guests. Name, party size, wait time estimate. Buttons: seat now, notify by SMS, remove. |
| Seat and action panel | Mark a reservation as seated, no-show, or cancelled. Assign or change table. Updates floor plan live. |
| Guest search | Search any guest by name or phone. Pull up CRM profile mid-service. |

### Waiter / Server Screens
| Screen | What it does |
|--------|--------------|
| My tables | Only tables assigned to this server. Each table: guest name, time seated, party size, pre-order status, allergy flags. |
| Table order screen | Tap a table to open the order. Pre-ordered items already shown. Add new dishes. Submit to kitchen. |
| Menu browser | Full menu by category. Each item: name, price, photo, allergens. Add to order with quantity and modifications. |
| Guest CRM card | Sidebar on table screen. Guest name, tags, allergies in red, preferences, visit count, last visit note. |
| Kitchen ticket status | Live status of each dish: queued / in kitchen / ready / served. Colour coded. |
| Bill / check screen | Itemised check: dishes, quantities, prices, subtotal, tax, tip, total. Print, mark as paid, add discount, split bill. |
| Add visit note | Write a note about the guest after service. Saved to CRM permanently. |

### Restaurant Owner Screens
| Screen | What it does |
|--------|--------------|
| Owner dashboard | Today at a glance: covers tonight, revenue so far, VIPs arriving, no-show risk flags, AI-generated shift briefing. |
| Live floor plan | Same view as host plus waiter assignments. Read and write access. |
| Guest CRM — list view | Full searchable filterable list of every guest. Name, tags, visit count, last visit, total spend. |
| Guest CRM — profile page | Full history: every visit, every dish ordered, total spend, all notes, tags, preferences, risk scores. |
| Analytics dashboard | Revenue charts, cover counts, no-show rate, average spend, busiest days heatmap, top dishes, booking sources. |
| Most ordered items | Full menu performance: ranked by orders and revenue, best by day and time, ordered together patterns. |
| Menu management | Add, edit, remove dishes. Set prices, photos, toggle availability, mark pre-orderable, set allergens. |
| Floor plan editor | Drag-and-drop canvas. Add and remove tables, set numbers, capacity, sections, positions. |
| Shift management | Create and edit service periods. Days, times, slot duration, cover cap, turn times. |
| Staff management | Add or remove staff accounts. Assign roles. See who is clocked in tonight. |
| Staff scheduling | Weekly shift schedule. Assign staff to service periods. |
| Events management | Create special events with fixed-price tickets, capacity management, Stripe prepayment. |
| Gift cards and promos | Manage gift card codes and promo code discounts. |
| Corporate accounts | Set up corporate billing accounts for business clients. |
| Marketing messages | Compose and send SMS or email to filtered guest segments. |
| Communication history | View all messages sent to guests. Two-way SMS inbox. |
| Survey builder | Create custom post-visit survey questions. View aggregate results. |
| AI assistant | Natural language queries over the CRM and analytics. |
| Settings | Restaurant profile, booking window, turn times, no-show policy, deposit rules, loyalty config, notification preferences. |
| Billing | Seatly subscription plan, billing history, upgrade or downgrade. |

### Kitchen Screen
| Screen | What it does |
|--------|--------------|
| Kitchen display | Real-time order tickets. Table number, guest name, course, modifications, allergy flags. Mark dishes: received, in progress, ready, served. |

---

## MOBILE APP — Every Screen

### Customer Screens
| Screen | What it does |
|--------|--------------|
| Onboarding / splash | Brand intro. Sign up or log in buttons. |
| Sign up | Name, email, phone, password. Optional: dietary preferences and allergies upfront. |
| Log in | Email and password. Face ID / Touch ID on return visits. Stay logged in. |
| Explore / home | Browse restaurants. Search by name, cuisine, location. Available slots tonight. |
| Restaurant profile | Photos, description, hours, cuisine, address, map, available time slots. |
| Booking flow | Step 1: date. Step 2: party size. Step 3: time slots. Step 4: special request and occasion. Step 5: confirm. Under 60 seconds total. |
| Pre-order screen | After booking: browse menu by category. Add items to reservation. See cutoff time. |
| Pre-order summary | Itemised pre-order list with total. Submit or cancel. |
| My bookings | Upcoming and past reservations. Restaurant, date, status, party size. |
| Booking detail | Full booking info. Table number once assigned. Pre-order summary. Modify or cancel. QR check-in code. |
| Arrival screen | Push notification and in-app screen when table is ready. Guest name. Table number. One-tap check-in. |
| AI chat assistant | Conversational booking. Book me a romantic dinner Saturday for 2, quiet, budget $200. AI handles everything. |
| My profile | Edit name, phone, dietary preferences, allergies, seating preference, notification settings. |
| Visit history | Past visits: restaurant, date, dishes ordered, amount spent. Rate dishes and visit. |
| Loyalty | Points balance, tier badge, points history, available rewards, redeem rewards. |
| Saved restaurants | Favourites list for quick rebooking. |
| Events | Browse special events. Purchase tickets. |
| Waitlist | Join restaurant waitlist remotely. See real-time position. Confirm or decline table when notified. |

### Restaurant Owner Mobile Screens
| Screen | What it does |
|--------|--------------|
| Tonight summary | Quick stat cards: covers tonight, revenue so far, no-show flags, VIP count. AI briefing for the night. |
| Live floor (read-only) | Real-time table status. Owner can see what is happening from anywhere. |
| Reservations list | Today's full list. Tap any reservation to see the guest card. |
| Guest CRM (mobile) | Simplified guest profile: key stats, tags, last visit, allergy alert. |
| Notifications | Push alerts: new bookings, no-shows, large party arrivals, VIP check-ins, late staff clock-ins. |

---

## AI FEATURES

### Customer-Facing AI (Mobile Chat)
- Understand natural language booking intent
- Query available restaurants and time slots
- Know the customer's preferences — never ask what it already knows
- Suggest menu items based on past order history
- Complete a full booking inside the conversation
- Handle modifications (change party size, change time)
- Confirm booking and produce a summary card in chat

### Owner-Facing AI (Web Assistant)
- Answer CRM questions in natural language
- Generate nightly shift briefing automatically before service
- Suggest re-engagement targets (lapsed guests)
- Explain analytics in plain language
- Predict slow nights and suggest promotions
- Identify low-performing menu items
- Generate weekly performance summary email

### Backend AI Logic (Edge Functions)
- No-show risk score per guest — nightly
- Lifetime value score per guest — nightly
- Auto-tagging rules — nightly
- Guest profile duplicate detection
- Demand forecasting
- Menu scanning (extract items from photo or PDF)
- Voice AI receptionist via VAPI (answers calls, takes bookings)

### AI Hard Rule
The AI never handles money. Claude API is for conversation, suggestions, and natural language queries only. All financial calculations are done in PostgreSQL and Edge Functions.

---

## BUSINESS TYPES SUPPORTED

Must work for all of these without custom development per business:

- Fine dining restaurant
- Casual dining restaurant
- Fast casual
- Cafe and brunch spot
- Bar and lounge
- Nightclub (drinks only, no food)
- Food hall vendor
- Private members club
- Hotel restaurant
- Pop-up and temporary restaurant

---

## STAFF PERMISSIONS

| Role | Access |
|------|--------|
| Customer | Own profile and bookings only |
| Host | Guest profiles, notes, allergy alerts, floor plan, waitlist |
| Waiter | Guest profiles, notes, allergy alerts, orders, kitchen screen |
| Kitchen | Kitchen display screen only |
| Owner | Full access to everything for their restaurant |
| Admin | Full access to all restaurants (Seatly internal only) |

Rules:
- Only owners can send marketing communications
- Only owners can export data
- Only owners can configure loyalty, deposit, and survey rules
- Only owners can add or remove staff accounts
- No staff member can see another restaurant's data under any circumstance

---

## REALTIME REQUIREMENTS

These screens must update live across all devices without refresh:

- Floor plan — table status changes instantly
- Reservation list — new bookings appear instantly
- Order screen — new items appear instantly
- Kitchen screen — new tickets appear instantly
- Waitlist — new entries appear instantly

When a host seats a table on web, the owner sees it on mobile instantly. This is non-negotiable.

---

## PHASE BUILD ORDER

| Phase | What gets built |
|-------|----------------|
| 1 | Core tables: restaurants, user_profiles, tables, shifts |
| 2 | Auth: Supabase Auth + RLS + roles |
| 3 | Reservations: reservations, waitlist, availability engine |
| 4 | Menu: menu_items, menu_categories |
| 5 | Orders and arrival: orders, order_items, kitchen tickets |
| 6 | Guest CRM: guests, notes, loyalty, communications, surveys |
| 7 | Financial: events, gift cards, promos, corporate accounts |
| 8 | Staff: scheduling, clock in/out, performance |
| 9 | Analytics: nightly rollups and dashboards |
| 10 | AI layer: Claude API, VAPI, demand forecasting |
| 11 | Communications: automated messages, marketing |
| 12 | Launch: onboarding, billing, store submission |

---

## NON-NEGOTIABLE TEAM RULES

| Rule | Detail |
|------|--------|
| Backend first | The schema must exist before any UI is built |
| Tokens are law | Every colour, spacing value, and font size comes from packages/tokens |
| Types are shared | All TypeScript types live in packages/types — never define the same type twice |
| One PR per feature | Every feature goes through a pull request before merging to main |
| Realtime is required | Floor plan, reservation list, and order status must update live |
| CRM updates automatically | Financial totals on guest records are never manually entered — always from DB triggers |
| AI never handles money | Claude API for conversation only — all calculations in PostgreSQL |

---

*Seatly App Bible — Version 1.0 — March 2026*
*Confidential — For internal use only*
