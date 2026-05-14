# Notify Me — Mobile Implementation Guide

Hand-off doc for porting the Cenaiva "Notify Me" feature from web to mobile
(React Native / iOS / Android). **The backend is fully shipped and shared
between web and mobile** — you only need to build the mobile UI + wire it to
the existing RPCs.

Source of truth on web:
- `apps/web/src/components/customer/NotifyMeButton.tsx` — the dialog
- `apps/web/src/components/customer/CustomerBellDropdown.tsx` — bell inbox
- `apps/web/src/hooks/useAvailabilityAlerts.ts` — list + cancel + realtime
- `apps/web/src/pages/customer/NotificationsPage.tsx` — `/notifications`
  full-page surface (Inbox + My alerts tabs)

---

## 1. What Notify Me does (UX in one paragraph)

A diner browsing restaurants or events sees "Booked up tonight" / "Sold out"
on a card. They tap **Notify me**. A short dialog says *"We'll watch
[restaurant] for Sun, May 24 · 7pm · 2 guests"* with two action buttons:
**Notify me** (creates a one-shot alert) and **Look for available day**
(navigates to the restaurant page so they can pick a different date). When a
matching slot frees up — because someone cancels or modifies their reservation
— a notification gets pushed to the user via Supabase Realtime. The user sees
the bell badge increment, taps it, and is deep-linked to the booking flow with
the date/time/party pre-filled. **One-shot semantics:** an alert fires exactly
once, then auto-resolves. The user re-arms manually if they want more.

Pattern mirror: OpenTable + Resy "Notify Me" — same mental model, same UX
beats. Diners coming from those apps will immediately understand.

---

## 2. Backend — already shipped, fully shared with web

You do not need to change ANY backend code. Everything below already exists
in production at project ref `exbjodmnpdiayfzrdyux`. Mobile consumes these
RPCs and the `availability_alerts` + `notifications` tables via the same
Supabase client.

### 2.1 Tables

#### `public.availability_alerts`
The user's saved alerts. One row per active watch.

```sql
id uuid PRIMARY KEY                     -- alert id
user_id uuid NOT NULL                   -- → user_profiles.id (RLS-scoped)
restaurant_id uuid                      -- nullable; either this OR event_id
event_id uuid                           -- nullable; XOR with restaurant_id
date date                               -- NULL for event alerts (event has fixed date)
party_size integer NOT NULL             -- 1..40
preferred_time time                     -- NULL for event alerts
window_minutes integer NOT NULL         -- default 120 (±2hr), 15..480
status text                             -- 'active' | 'fulfilled' | 'cancelled' | 'expired'
created_at timestamptz
expires_at timestamptz                  -- auto-set by RPC; rows auto-stale after this
fulfilled_at timestamptz                -- set when an alert fires
fulfilled_notification_id uuid          -- → notifications.id (backlink)
```

**RLS:** users can SELECT + UPDATE their own rows. INSERTs go through the
`create_availability_alert` RPC (no INSERT policy).

**Realtime:** the table is in the `supabase_realtime` publication. Mobile can
subscribe to postgres_changes filtered by `user_id` to see alerts flip from
`active` to `fulfilled` in real time.

#### `public.notifications`
The existing notification table reused for slot-opened alerts. Mobile reuses
whatever notification list/bell already exists in the app (if any) — there's
no separate "alerts inbox" needed.

```sql
id uuid PRIMARY KEY
user_id uuid NOT NULL
restaurant_id uuid
type text                               -- 'slot_opened' is the new type for Notify Me
title text                              -- "Table just opened at Bâton Rouge"
body text                               -- "8:30 PM for 2 on May 16. Tap to book."
data jsonb                              -- deep-link payload (see §2.4)
is_read boolean DEFAULT false
sent_push boolean DEFAULT false         -- unused today; reserved for FCM/APNs
created_at timestamptz
```

Two notification `type` values matter for Notify Me:
- `'slot_opened'` — fired when a watched slot becomes available.

All other types (`'crm_campaign'`, `'reservation_review_request'`, etc.)
exist for other features but flow through the same table + realtime channel.

### 2.2 RPCs (mobile calls these directly via Supabase client)

#### `create_availability_alert(p_restaurant_id, p_event_id, p_date, p_party_size, p_preferred_time, p_window_minutes) RETURNS jsonb`

Diner-callable. Creates a new active alert.

**Args:**
- Exactly ONE of `p_restaurant_id` / `p_event_id` must be non-null.
- Restaurant variant: pass `date`, `preferred_time` (24h "HH:MM"), `window_minutes` (default 120).
- Event variant: pass `event_id` + `party_size`; the rest can be null/0 EXCEPT
  pass `window_minutes=120` to satisfy the BETWEEN 15 AND 480 validation
  (the value is stored but unused for events).

**Returns:**
```json
// Success
{ "ok": true, "alert_id": "uuid" }

// Errors — handle each case in mobile UI:
{ "ok": false, "error": "not_authenticated" }
{ "ok": false, "error": "invalid_party_size" }       // <1 or >40
{ "ok": false, "error": "invalid_window" }           // <15 or >480
{ "ok": false, "error": "date_in_past" }
{ "ok": false, "error": "restaurant_not_found" }
{ "ok": false, "error": "event_not_found" }
{ "ok": false, "error": "event_in_past" }
{ "ok": false, "error": "duplicate" }                // same user/target/date/party already active
{ "ok": false, "error": "invalid_target" }           // neither restaurant_id nor event_id provided

// Closure / past-cutoff rejections — these include a suggestion:
{ "ok": false, "error": "closed_on_this_date",
  "message": "Restaurant is closed on that date.",
  "suggested_next_date": "2026-05-25" }
{ "ok": false, "error": "past_last_seating",
  "message": "Tonight's service has ended — try tomorrow.",
  "suggested_next_date": "2026-05-25" }
{ "ok": false, "error": "beyond_booking_window",
  "message": "That date is past the restaurant's booking window.",
  "suggested_next_date": null }
```

**UX pattern for the suggestion errors:** show a banner inside the dialog with
the `message`, then a button labeled "Use Mon, May 25" that re-submits using
`suggested_next_date`. Same one-tap retry pattern OpenTable uses for full
restaurants.

#### `cancel_availability_alert(p_id uuid) RETURNS boolean`

Diner-callable. Flips the alert's status from `active` to `cancelled`. Returns
`true` if a row was changed, `false` otherwise (already cancelled, or not the
caller's). Use this for the "Cancel" button in the My Alerts list.

#### Match RPCs (called by edge functions, NOT by mobile — listed for awareness)

- `match_availability_alerts_for_restaurant(restaurant_id, freed_at, freed_party_size)`
- `match_availability_alerts_for_event(event_id)`

These are server-side only. They fire when a reservation is cancelled or
modified (via `cancel-reservation` / `modify-reservation` edge functions),
atomically claim any matching active alerts (`UPDATE … WHERE status='active'`
guarantees one-shot), and INSERT a notification row with `type='slot_opened'`.

### 2.3 Edge function hooks (already done — no mobile action needed)

- `supabase/functions/cancel-reservation/index.ts` — calls the match RPCs
  before each success return.
- `supabase/functions/modify-reservation/index.ts` — same, using the OLD
  reserved_at (the freed slot).
- A trigger on `reservations` keeps `events.tickets_sold` in sync so the
  Sold Out badge stays accurate and event-side Notify Me fires correctly on
  event-linked cancellations.

### 2.4 `slot_opened` notification payload

When the match RPC fires, the row it inserts looks like this:

**Restaurant alert fulfilled:**
```jsonb
{
  "id": "<uuid>",
  "user_id": "<uuid>",
  "restaurant_id": "<uuid>",
  "type": "slot_opened",
  "title": "Table just opened at Bâton Rouge",
  "body": "May 16 for 2 near 07:00pm. Tap to book.",
  "data": {
    "restaurant_id": "<uuid>",
    "slug": "baton-rouge-eaton-centre",
    "date": "2026-05-16",
    "preferred_time": "19:00:00",
    "window_minutes": 60,
    "party_size": 2,
    "alert_id": "<uuid>",
    "route": "/baton-rouge-eaton-centre?date=2026-05-16&time=19:00&party=2"
  },
  "is_read": false,
  "created_at": "2026-05-14T03:54:55Z"
}
```

**Event alert fulfilled:**
```jsonb
{
  "type": "slot_opened",
  "title": "Seats just opened at Wagyu Masterclass",
  "body": "2 seats on May 31. Tap to book.",
  "data": {
    "event_id": "<uuid>",
    "restaurant_id": "<uuid>",
    "party_size": 2,
    "alert_id": "<uuid>",
    "route": "/deals?event=<uuid>&party=2"
  }
}
```

`data.route` is the canonical deep-link path. On web it maps directly to React
Router. On mobile you'll need to translate it to your navigation system —
typically something like `Linking.openURL(...)` or a navigation action that
parses the path and pushes the right screen with the right params.

---

## 3. Mobile implementation tasks

### 3.1 Reusable `<NotifyMeButton>` component

Two variants — `restaurant` and `event`. Props mirror the web component:

```ts
type NotifyMeButtonProps = {
  variant: "restaurant" | "event";
  restaurantId?: string;
  restaurantName?: string;
  restaurantSlug?: string;       // needed for the "Look for available day" deep-link
  eventId?: string;
  eventName?: string;
  defaultDate?: string;          // YYYY-MM-DD
  defaultTime?: string;          // "HH:MM" (24h)
  defaultPartySize?: number;
  showLookForDay?: boolean;      // default true; pass false from booking widgets
};
```

**Behavior:**

1. Tap → open a modal/bottom-sheet.
2. Auth check: if no user, navigate to the sign-in screen with a `return` flag
   that re-opens the dialog when the user comes back.
3. Modal body — KEEP IT SIMPLE. The web design is one summary box + 2 buttons:

   ```
   ┌─ Notify me when a spot opens ─────────────┐
   │ We'll ping you the moment a table opens   │
   │ at Mark Testing.                          │
   │                                           │
   │ ┌─ WE'LL WATCH ───────────────────────┐  │
   │ │ Sun, May 24 · 7pm · 2 guests        │  │
   │ │ ± 2 hr window                       │  │
   │ └─────────────────────────────────────┘  │
   │                                           │
   │ [Look for available day]   [Notify me]   │
   └───────────────────────────────────────────┘
   ```

   Don't add inline date/time/party pickers. The values come from the host
   screen state (Discover filter, AvailabilityPanel state, etc.). If the user
   wants different values they hit "Look for available day" to escape.

4. **"Notify me" button** — calls `create_availability_alert` via Supabase
   client. Handle the response per §2.2:
   - `ok: true` → toast "Got it. We'll ping you when a spot opens." + close.
   - `error: 'duplicate'` → toast "You're already watching this." + close.
   - `error: 'closed_on_this_date' | 'past_last_seating' | 'beyond_booking_window'`
     → show inline banner with `message` + if `suggested_next_date` is non-null,
     show a "Use [date]" button that re-submits with the suggested date.
   - `error: 'not_authenticated'` → toast "Please sign in" + route to sign-in.
   - Other errors → toast the message.

5. **"Look for available day" button** — only rendered when:
   - `variant === "restaurant"` AND
   - `showLookForDay !== false` AND
   - `restaurantSlug` is non-empty.

   On tap, close the modal and navigate to the public restaurant screen,
   passing `date`, `time` (24h), `party` as route params or query string —
   whatever your navigation system uses. Reuse the same deep-link format as
   web's `route` field: `/<slug>?date=...&time=06:00&party=N`.

6. **Time normalization** — before sending `preferred_time` to the RPC OR
   building the navigate route, convert any 12h-style time (e.g. "6:00 AM") to
   24h ("06:00"). Postgres accepts AM/PM but consistency matters for downstream
   queries.

7. **Hide rules** — don't render the "Look for available day" button on:
   - Events (any kind — one-day events have no other day; multi-day events
     already have a date picker on their detail screen).
   - One-day promotions.
   - Surfaces where the user is already inside a booking widget with a
     calendar visible (the equivalent of AvailabilityPanel on mobile — pass
     `showLookForDay={false}` from those screens).

### 3.2 `useAvailabilityAlerts` hook (mobile equivalent)

Mirror the web hook. Mobile needs:
- A function that SELECTs from `availability_alerts` filtered by `user_id`,
  ordered `created_at DESC`, joined with `restaurants(id, name, slug)` and
  `events(id, name, date)`.
- A realtime subscription on `postgres_changes` with
  `filter: 'user_id=eq.<your-user-id>'` so the list updates live when an
  alert is fulfilled or cancelled.
- A `cancel(id)` function that calls `cancel_availability_alert(p_id)` RPC
  with optimistic UI update.

### 3.3 Bell + notifications screen

Mobile likely already has a bell + inbox somewhere (most apps do). The
existing `notifications` table is reused — you just need to make sure
`type='slot_opened'` is recognized + rendered. The notification's
`data.route` field holds the deep-link path to navigate when tapped.

If mobile doesn't have a notifications inbox yet:
- Mirror web's `NotificationsPage` two-tab layout:
  - **Inbox** — recent notifications, mark-read on tap, navigate to
    `data.route`.
  - **My alerts** — `availability_alerts` rows where `status='active'`, with a
    Cancel button per row.
- Subscribe to `postgres_changes` on the `notifications` table filtered by
  `user_id` for the badge count + realtime push.

### 3.4 Surface integration — where to mount the button

On web, Notify Me appears on 8 surfaces. Map each to your mobile equivalent:

| Web surface | Mobile equivalent | Variant | `showLookForDay` |
|---|---|---|---|
| Discover grid card (booked-up) | Discover/Explore list card with "Booked up tonight" | restaurant | `true` |
| Discover map popover | Map view popup | restaurant | `true` |
| Restaurant preview modal | Restaurant detail bottom sheet | restaurant | `true` |
| Restaurant public page | Full restaurant detail screen | restaurant | `true` (if separate from preview) |
| AvailabilityPanel empty state | The big calendar/booking widget when zero slots | restaurant | **`false`** — calendar already visible |
| Deals/Promotions sold-out card | Events list "Sold out" card | event | n/a (always false for events) |
| Deals/Promotions map popover | Events map popup | event | n/a |
| EventPromotionDetailDialog | Event detail screen when sold out | event | n/a |

### 3.5 Auth-gated UX

If the user taps Notify Me without being logged in:
- Web: routes to `/auth?return=<currentPath>&notifyMe=1`, then auto-re-opens
  the dialog after sign-in via a `useEffect` checking `notifyMe=1`.
- Mobile: same idea — push the sign-in screen with a `returnTo` param +
  `intent: 'notifyMe'`. After successful sign-in, navigate back to the
  original screen and trigger the modal automatically.

---

## 4. Deep-link routing (must match web exactly)

When the user taps a `slot_opened` notification, they should land on the
correct screen with the booking pre-filled. The notification's `data.route`
field holds the path:

- **Restaurant:** `/<slug>?date=YYYY-MM-DD&time=HH:MM&party=N`
  → Mobile: open the restaurant detail / booking screen with these params
    pre-filled into the date/time/party pickers. The user can confirm with
    one tap.
- **Event:** `/deals?event=<event_id>&party=N`
  → Mobile: open the event detail screen with the party-size pre-filled.

Implementation tip: write a single `parseRoute(routeString)` helper that
extracts these params, and use it both for in-app navigation when tapping a
notification AND for web→mobile deep-link handoff (universal links / app
links). If a user gets the notification on iOS and taps from outside the app,
the OS routes the URL into the app — same parser handles it.

---

## 5. Edge cases to handle

These are baked into the backend already — your mobile UI just needs to
handle the responses gracefully:

- **Duplicate alert** — unique partial index on the table blocks duplicates.
  RPC returns `{ok:false, error:'duplicate'}`. Show a friendly toast.
- **Not logged in** — handled via auth redirect (§3.5).
- **Race: two cancellations <1s apart** — `UPDATE ... WHERE status='active'
  RETURNING` guarantees exactly one fan-out wins the row. The other call's
  CTE returns zero rows; no second notification.
- **User cancels their alert mid-fire** — same row lock.
- **Restaurant timezone vs user timezone** — match RPC computes the matching
  date in `restaurants.timezone`. No off-by-one near midnight.
- **Past-date submission** — RPC blocks with `error:'date_in_past'`.
- **Closed-date submission** — RPC blocks with `error:'closed_on_this_date'`
  + `suggested_next_date`. Show the inline retry banner.
- **Past last seating today** — RPC blocks with `error:'past_last_seating'`
  + `suggested_next_date`.
- **Cancellations on closed days** — never happen (you can't have a reservation
  on a closed day), so no spurious matches.

---

## 6. Testing checklist for mobile

After implementing, walk through these:

### Restaurant variant
1. Open the app, log in. Find a restaurant on Discover that shows "Booked up
   tonight." Tap Notify me.
2. Confirm the modal shows: summary line + "Look for available day" +
   "Notify me" buttons.
3. Tap Notify me. Expected: success toast + alert lands in DB.
4. In a separate tab/admin tool, cancel a real reservation at that restaurant
   on that date. Within ~5 seconds, the bell/notification badge increments.
5. Tap the notification. Expected: deep-link opens the restaurant detail
   with date/time/party pre-filled.
6. Try Notify me again on the same combo. Expected: "You're already watching
   this" toast.
7. Pick a closed-day restaurant (e.g. a Sunday at a steakhouse that's closed
   Sundays). Submit. Expected: inline banner with rejection message +
   "Use Mon, [date]" button. Tap → alert lands on Monday.

### Event variant
8. Open a sold-out event (e.g. an event with `tickets_sold >= capacity`).
   Tap Notify me. Modal should ONLY show "Cancel" and "Notify me" (no
   "Look for available day").
9. Submit. Alert lands with `event_id` populated, `restaurant_id` null.
10. Cancel an event-linked reservation in admin. Notification fires.

### "Look for available day"
11. On a Discover card, tap Notify me. Tap "Look for available day" instead.
    Expected: navigate to the restaurant detail with date/time/party pre-filled.

### Sign-in flow
12. Log out. Tap Notify me on a card. Expected: route to sign-in. After
    signing in, the modal should auto-reopen on the original screen.

---

## 7. Out of scope for v1

- **Web push (FCM/APNs)** — the `notifications.sent_push` column exists for
  future use but no push pipeline is wired. In-app realtime is sufficient
  while the app is open. Add push for background notifications when the
  business case requires it.
- **Owner-side analytics** — "X users are watching this restaurant on this
  date" is computable from the table but no UI exists yet.
- **Multi-fire alerts** — explicitly scoped to one-shot per OpenTable's
  pattern. Re-arming is a manual second submit.
- **Auto-expiry pg_cron** — alerts auto-stale via `expires_at > now()` filter
  in the match RPCs. Add a nightly cleanup cron only if dashboards need
  accurate `expired` row counts.
- **Cross-restaurant cuisine alerts** — alerts are pinned to a specific
  restaurant or event. "Notify me about ANY steakhouse in Toronto on Saturday"
  is out of scope.

---

## 8. Open questions for the mobile team

Drop the answers in this section as you decide them; web doesn't need to know
how mobile handles these:

- Modal vs bottom-sheet for the Notify Me dialog?
- Where does the bell icon live in your nav? Existing pattern or new?
- Does mobile already have a notifications inbox screen, or do you need to
  build one?
- Universal links / app links setup for deep-linking from `data.route` when
  the OS surfaces a notification while the app is backgrounded?
- How does the sign-in `returnTo` + intent pattern work in your nav stack?
  (Web uses a query param + `useEffect` re-open.)

---

## 9. Why the backend is "done" — quick summary

This is the most important thing for the mobile team to internalize: **you
do not need any backend changes.** Specifically:

- The `availability_alerts` table, indexes, RLS, and realtime publication are
  applied to prod.
- The 4 RPCs (`create_availability_alert`, `cancel_availability_alert`,
  `match_availability_alerts_for_restaurant`, `match_availability_alerts_for_event`)
  are deployed and stable.
- The `cancel-reservation` and `modify-reservation` edge functions already
  call the match RPCs after every cancel/modify success, so any cancellation
  from web OR mobile OR the staff dashboard fans out alerts correctly.
- The `notifications` table's CHECK constraint allows `slot_opened`.
- The `events.tickets_sold` trigger keeps that counter accurate.

You build the UI + the client calls. The data + the fan-out logic are there
waiting.

---

## 10. Quick code starter — RPC call from React Native

Assuming you're using `@supabase/supabase-js` (works identically on mobile):

```ts
import { supabase } from '@/lib/supabase';

// Restaurant alert
const { data, error } = await supabase.rpc('create_availability_alert', {
  p_restaurant_id: restaurantId,
  p_event_id: null,
  p_date: '2026-05-24',
  p_party_size: 2,
  p_preferred_time: '19:00',
  p_window_minutes: 120,
});

if (error) {
  showToast('Network error', error.message);
  return;
}

const result = data as {
  ok: boolean;
  error?: string;
  message?: string;
  suggested_next_date?: string | null;
  alert_id?: string;
};

if (!result.ok) {
  if (result.error === 'duplicate') {
    showToast("You're already watching this");
  } else if (
    result.error === 'closed_on_this_date' ||
    result.error === 'past_last_seating' ||
    result.error === 'beyond_booking_window'
  ) {
    showRetryBanner(result.message, result.suggested_next_date);
  } else if (result.error === 'not_authenticated') {
    navigateToSignIn();
  } else {
    showToast('Something went wrong', result.error);
  }
  return;
}

showToast("Got it. We'll ping you when a spot opens.");
closeModal();
```

Realtime subscription for the bell badge:

```ts
const channel = supabase
  .channel(`notifications:${userId}`)
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${userId}`,
    },
    () => {
      refetchNotifications();
    },
  )
  .subscribe();

return () => { supabase.removeChannel(channel); };
```

---

Good luck. The hardest part is already done (the backend, the matching
logic, the one-shot atomicity guarantee). Mobile work is purely about
mounting the button in the right places + handling the response codes.
