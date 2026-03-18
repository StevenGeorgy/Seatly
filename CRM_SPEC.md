# Seatly — CRM_SPEC.md
# Full CRM Feature Specification
# Paste the content from the CURSOR PROMPT section into Cursor for CRM build sessions
# Version 1.0 — March 2026

---

## HOW TO USE THIS FILE

When building any CRM-related screen, open Cursor in Plan mode and paste the
CURSOR PROMPT section below. This tells Cursor everything it needs to know
about what the CRM must do before it writes a single line of code.

Always combine this with a reference to BACKEND.md so Cursor knows what
tables to use.

---

## CURSOR PROMPT — PASTE THIS INTO CURSOR FOR CRM SESSIONS

```
Build a complete restaurant CRM system for a multi-restaurant
platform. Every piece of data is scoped to a specific
restaurant. One restaurant can NEVER see another restaurant's
guests, orders, or data. Do not create any new database
tables — use only what exists in BACKEND.md.

MULTI-RESTAURANT SCOPE
- Every guest profile belongs to a specific restaurant
- The same person can be a guest at multiple restaurants
  but each restaurant sees only their own version of that
  guest with their own visit history and notes
- Owners only see data for their own restaurant
- Seatly admins can see all restaurants for platform
  management only

GUEST PROFILE
Every guest has a permanent profile per restaurant:
- Full name, email, phone number, birthday, anniversary date
- Profile photo / avatar
- Preferred language
- Dietary restrictions (vegetarian, vegan, halal, gluten
  free, kosher, pescatarian, dairy free etc)
- Allergies — displayed as RED ALERTS everywhere they appear
- Seating preference (window, booth, patio, quiet area,
  bar, private room)
- Noise preference (quiet, lively, no preference)
- Favourite dishes and drinks (manually added or AI
  suggested from order history)
- Internal staff notes (long form, permanent)
- Tags (VIP, Regular, Loyal, New Guest, Lapsed, Birthday
  this month, Anniversary this month, High Spender,
  No-show Risk plus any custom tags the restaurant creates)
- Is VIP flag (manual or auto-assigned)
- Is Blocked flag (for abusive or fraudulent guests)
- Occasion history (birthday dinners, anniversaries,
  business dinners, date nights logged per visit)
- Loyalty points balance (updated after every paid visit)
- Loyalty tier (Bronze, Silver, Gold, Platinum)
- Communication preferences (SMS opt in, email opt in)
- Communication history (every SMS and email ever sent)
- Post-visit survey responses stored on profile
- Internal satisfaction rating history (1-5 stars per visit)
- Deposit history (all deposits paid, refunded, or forfeited)
- Car details for valet service (make, model, colour, plate)
- Card on file for faster checkout (stored via Stripe)

FINANCIAL METRICS ON EVERY PROFILE
- Total visits (auto incremented, never manually entered)
- Total lifetime spend (auto updated after every paid bill)
- Average spend per visit (recalculated automatically)
- Highest single bill ever
- No-show count (auto incremented)
- Cancellation count (auto incremented)
- No-show risk score 0-100 (calculated nightly by backend)
- Lifetime value score 0-100 (calculated nightly by backend)
- First visit date
- Last visit date
- Preferred payment method (inferred from history)
- Total loyalty points earned all time
- Total loyalty points redeemed all time
- Current points balance
- Total deposits paid
- Total deposits forfeited (no-shows)

FOOD INTELLIGENCE PER GUEST
- Most ordered dishes ranked by frequency
- Most ordered drinks ranked by frequency
- Dishes never ordered (useful for upsell suggestions)
- Average spend on food vs drinks split
- Whether they typically pre-order or order on arrival
- Whether they typically order dessert
- Whether they typically order alcohol
- Course preferences (always orders starter, skips dessert)
- Individual dish ratings if submitted after visit

VISIT HISTORY
Every profile shows a full timeline of every past visit:
- Restaurant name and date
- Party size
- Table number and section
- Every dish and drink ordered with price at time of order
- Bill total including tax and tip
- Payment method
- Staff notes written during that visit
- Reservation source (app, phone, walk-in, AI chat, widget)
- Occasion if one was noted
- Whether they pre-ordered
- Which waiter served them
- Internal satisfaction rating if submitted
- Survey response if submitted
- Deposit paid, refunded, or forfeited for this visit
- Individual dish ratings if submitted

GUEST NOTES
- Any staff member can write a note during or after a visit
- Notes are permanent and never deleted
- Notes attached to the specific visit they were written on
- Pinned notes always appear at the top of the profile
- Every note shows who wrote it and when
- Notes appear on every future visit
- Note categories: preference, complaint, compliment,
  incident, general

AUTO TAGGING
Tags applied automatically by backend. Staff can add
custom tags manually. Restaurants can create their own:
- Regular: total visits >= 5
- Loyal: total visits >= 15
- VIP: lifetime value score >= 80
- New Guest: total visits == 1
- Lapsed: last visit more than 90 days ago AND total
  visits >= 3
- No-show Risk: no-show risk score >= 60
- High Spender: average spend in top 10% for that restaurant
- Birthday This Month: birthday month matches current month
- Anniversary This Month: anniversary month matches
  current month
- Corporate: manually assigned for business accounts
- Influencer: manually assigned
- Press: manually assigned
- Loyalty Gold / Platinum: based on loyalty tier
- Custom tags: restaurant creates and names their own

MENU MANAGEMENT
Restaurants set up and manage their full menu:

Menu setup options:
- Manual entry: add dishes one by one
- Bulk CSV upload: import from spreadsheet
- Menu scanning: upload a photo or PDF of physical menu,
  AI extracts dishes, prices, and categories automatically,
  staff review and confirm before publishing
- Copy from previous menu: duplicate and edit

Menu categories:
- Restaurant creates their own categories in any order
- Categories reorderable by drag and drop
- Items within categories reorderable

Menu item fields:
- Name, description, price, category
- Photo (upload from device or URL)
- Allergens (nuts, dairy, gluten, shellfish, eggs, soy,
  sesame etc)
- Dietary flags (vegetarian, vegan, halal, kosher,
  gluten free, dairy free)
- Preparation time in minutes
- Is available tonight toggle
- Is pre-orderable toggle
- Is active toggle
- Sort order
- Spice level (optional)
- Pairing suggestions (optional)
- Loyalty points value (how many points this item earns)
- Cost price (for margin calculation)

Menu analytics per item:
- Total times ordered all time
- Total revenue generated all time
- Times ordered this week and month
- Average quantity per order
- Most common modifications
- Which guest segments order it most
- Whether it gets pre-ordered or ordered on arrival

PLATFORM MENU INTELLIGENCE
Across all restaurants on the platform:
- Most popular dishes by cuisine type (anonymous)
- Most common allergen combinations
- Most popular dietary flags
- Used only for AI suggestions and platform insights
- Never shared between competing restaurants

ALLERGY SYSTEM
- RED ALERT badges everywhere the guest appears
- On the floor plan when their table is selected
- On the guest arrival card when they walk in
- On the waiter's table screen
- On the reservation list next to their name
- On any pre-order confirmation
- On the kitchen display screen
- On the kitchen ticket for every dish ordered by
  an allergic guest
- Never hidden or minimised
- WARNING shown if a guest orders an item containing
  one of their logged allergies before it is added
- Allergy incident log: if a guest has an allergic
  reaction it is logged permanently — this record
  can never be deleted

KITCHEN AND OPERATIONS
Kitchen display screen:
- Orders appear on a dedicated kitchen screen in real time
- Each dish shown as a ticket with table number,
  guest name, course, modifications, and allergy flags
- Kitchen staff mark each dish as: received, in progress,
  ready, served
- Allergy alerts shown in red on every relevant ticket
- Course firing: waiter triggers when kitchen should
  start the next course

Kitchen performance tracking:
- Average ticket time per dish
- Average ticket time per shift
- Most delayed dishes
- Dishes most frequently sent back or comped

DEPOSITS AND PREPAYMENTS
- Restaurant configures deposit rules per party size
- Deposit required for special events always
- Deposit charged automatically via Stripe on booking
- Guest enters card details during the booking flow
- Deposit refunded automatically if cancelled within
  the cancellation window
- Deposit forfeited automatically if guest no-shows
  or cancels outside the window
- Deposit applied to the final bill if guest arrives
- Deposit history on every guest profile
- Restaurant configures their own cancellation window

TABLE MANAGEMENT
- Combining tables for large parties
- Split bill by item (each guest pays for what they ordered)
- Split bill evenly (divide total by number of guests)
- Table transfer mid-service
- Table turnover timer (how long seated vs expected turn)
- Bill to room (for hotel restaurants)
- Corporate account billing (company invoiced monthly)

BOOKING MANAGEMENT
- Overbooking management (book beyond capacity based
  on historical no-show rate)
- Booking blackout dates
- Max advance booking window
- Min and max party size per shift
- VIP priority booking (book before slots open to public)
- Group bookings with bill split

WAITLIST INTELLIGENCE
- Real-time wait time on guest's phone
- Guest can join waitlist remotely from mobile app
- Auto-notify guest by SMS when table is ready
- Guest confirms or declines from phone
- If declined automatically moves to next person
- Host sees full queue with estimated wait per party

LOYALTY AND REWARDS
- Points per dollar spent (restaurant configures rate)
- Reward tiers: Bronze, Silver, Gold, Platinum
- Each tier has configurable thresholds and benefits
- Rewards: free dishes, discounts, complimentary items,
  priority booking
- Points visible on profile and mobile app
- Guest redeems rewards in app
- Points expire after configurable inactivity period
- Loyalty leaderboard in analytics

CUSTOMER COMMUNICATION
SMS and email marketing directly from the CRM:
- Owner composes message and sends to filtered segment
- Two-way SMS: guest replies and staff see it in platform
- Communication history on every guest profile
- Unsubscribe management: guests opt out per channel
- Opt-out guests automatically excluded from all sends

Automated messages configured by restaurant owner:
- Birthday email or SMS on birthday
- Anniversary email or SMS on anniversary
- Post-visit thank you after bill is closed
- Re-engagement message after 90 days of no visit
- Booking confirmation on reservation creation
- Booking reminder 2 hours before reservation
- Deposit receipt when deposit is charged
- Table ready SMS when host marks table available
- Loyalty points update after every visit
- Event ticket confirmation after purchase
- Post-visit survey request after visit
- Review request after visit with Google Review link

REPUTATION AND REVIEWS
- After visit automatically send review request
- Internal satisfaction rating: guest rates visit
  privately 1-5 stars in the app
- Guest can rate each dish individually after a visit
- Aggregate satisfaction score in analytics
- Flag guests who gave 1-2 stars for owner follow up
  before they post publicly
- Owner responds to low ratings internally

FEEDBACK AND SURVEYS
- Owner creates custom post-visit survey questions
- Survey sent automatically after visit
- Survey responses stored on guest profile
- Aggregate survey results in analytics
- Flag guests who gave low scores for follow up

EVENTS AND SPECIAL EXPERIENCES
- Restaurant creates special events with fixed price tickets
- Event capacity managed separately from regular reservations
- Guest books event from mobile app
- Stripe prepayment required
- Events shown on guest profile visit history
- Recurring events supported

FINANCIAL AND BILLING
- Gift cards: purchase and redeem
- Vouchers and promo codes
- Tax configuration per restaurant (different rates by
  province or country)
- Multi-currency support
- Food cost tracking: restaurant enters ingredient costs,
  system calculates margin per dish
- End of day report automatically generated and emailed
- End of shift report per waiter
- Monthly financial summary report
- GDPR and PIPEDA compliance: guest can request data
  deletion

REPORTING AND COMPLIANCE
- End of day report auto-emailed to owner nightly
- End of shift report per waiter at shift end
- Monthly financial summary auto-emailed
- Health and safety allergy incident log (permanent,
  never deletable, available for health inspections)
- GDPR and PIPEDA compliance with anonymised deletion

STAFF AND SCHEDULING
- Staff clock in and clock out with timestamp
- Weekly shift scheduling
- Staff availability management
- Labour cost tracking per shift
- Clock records export for payroll
- Owner sees who is currently clocked in tonight
- Late clock-in alerts (15 minutes before shift)

STAFF PERFORMANCE
- Revenue per waiter tracked automatically
- Average tip percentage per waiter
- Guest satisfaction scores per waiter from surveys
- Tables turned per shift per waiter
- Which waiter has served a guest most
- Staff leaderboard in analytics

INTEGRATIONS
- Google Reserve: guests book from Google Maps
- Instagram: link in bio booking button
- Website booking widget: embeddable via iframe
- POS import: Square, Toast, or Lightspeed
- VAPI voice AI receptionist: answers phone calls,
  takes bookings, answers questions about hours and menu,
  adds guests to waitlist

CRM LIST SCREEN
Main screen shows all guests in searchable sortable
paginated table:
- Guest name and avatar
- Tags as colour coded pills
- Total visits
- Last visit date
- Total lifetime spend
- Average spend per visit
- No-show risk score
- VIP badge if applicable
- Allergy alert icon
- Most ordered dish
- Loyalty tier badge
- Points balance

SMART FILTERS — filter individually or combined:
- By tag (any single or combination)
- By last visit date range
- By total spend range
- By visit count range
- By birthday this month
- By anniversary this month
- By allergy or dietary restriction
- By booking source
- By no-show risk score range
- By VIP status
- By blocked status
- By most ordered item
- By occasion type
- By waiter
- By section preference
- By loyalty tier
- By points balance range
- By communication opt in status
- By survey score range
- By deposit history (has forfeited deposit before)
- Free text search across name, phone, and email

SORTING — sortable by:
- Total lifetime spend
- Total visits
- Last visit date
- No-show risk score
- Lifetime value score
- Average spend per visit
- Loyalty points balance
- Survey satisfaction score
- Alphabetical by name

RESTAURANT ANALYTICS — pre-computed nightly:
- Revenue today, this week, this month, this year
- Total covers by period
- Average spend per cover by period
- No-show rate and cancellation rate by period
- Walk-in vs reservation count
- Pre-order rate
- Booking source breakdown
- Revenue per table, section, and waiter
- Busiest days and time slots heatmap
- Top 10 dishes by orders and revenue
- Top 10 guests by spend and frequency
- New vs returning guest ratio
- Lapsed guest count and retention rate
- Deposit revenue collected and forfeited
- Loyalty points issued and redeemed
- Communication open rates
- Survey completion rate and average score
- Event revenue and attendance rate
- Staff performance leaderboard
- Labour cost per shift
- Food cost and margin per dish

MOST ORDERED ITEMS DASHBOARD:
- Every menu item ranked by orders and revenue
- Most modified items
- Items with lowest order rate
- Items most commonly ordered together
- Best performing items by day and time
- Items most ordered by VIPs and new guests
- Items most frequently out of stock

GUEST ARRIVAL CARD — shown automatically on check-in:
- Full name large and prominent
- Visit number
- All tags as colour coded pills
- ALL allergies in red alert boxes at the top
- Seating and noise preferences
- Last visit and what they ordered last time
- Pre-order summary if applicable
- All pinned notes
- Occasion if noted
- Loyalty tier and points balance
- Car details if valet applicable
- Quick actions: seat now, assign table, add note

DUPLICATE DETECTION:
- Check for duplicates by phone and email on every
  new profile
- Flag for owner review and merge
- Merging combines visit history, spend totals, notes,
  and loyalty points
- Keep oldest profile as primary

AI FEATURES:
- AI suggests optimal table assignments
- AI detects ungreeted regulars and alerts host
- AI predicts slow nights and suggests promotions
- AI identifies low-performing menu items
- AI generates weekly performance summary email
- AI suggests most likely lapsed guests to return
- AI answers CRM questions in natural language
- AI generates nightly shift briefing before service
- Voice AI receptionist via VAPI
- AI NEVER handles money — all financial calculations
  in PostgreSQL and Edge Functions only

EXPORT:
- Full or filtered guest list to CSV
- Visit history per guest or all guests
- Menu performance report
- Communication history
- Loyalty report
- Deposit report
- Staff performance report
- Survey results
- Staff clock records for payroll
- End of day and monthly financial reports

RE-ENGAGEMENT:
- List of lapsed guests (90+ days)
- Last visit, total spend, favourite dish, contact info
- One click to send re-engagement SMS or email
- Owner marks guests as contacted
- Re-engagement rate tracked

BUSINESS TYPES — must work for all without custom dev:
- Fine dining, casual dining, fast casual, cafe, bar,
  lounge, nightclub, food hall, private members club,
  hotel restaurant, pop-up

STAFF PERMISSIONS:
- Hosts: profiles, notes, allergy alerts, waitlist
- Waiters: profiles, notes, allergy, orders, kitchen
- Kitchen staff: kitchen display screen only
- Owners: full access to everything
- Only owners send marketing, export data, configure
  loyalty and deposit rules, add or remove staff
- No staff sees another restaurant's data ever
```

---

*Seatly CRM Spec — Version 1.0 — March 2026*
*Confidential — For internal use only*
