# Cenaiva Database & Booking System — Reference for Mobile Agents

> Single source of truth for an LLM-driven mobile dev agent. Read sections 1–12
> end-to-end the first time you implement booking on mobile. Every numbered
> checklist item at the bottom back-references a § in this doc, so the
> checklist stays grounded.
>
> Last updated: 2026-05-09. Web booking widget: `<AvailabilityPanel>` shipped
> at `apps/web/src/components/booking/AvailabilityPanel.tsx`. Mobile parity
> work tracked here.

---

## How to use this document

Two modes:

1. **Context** (sections 1–12 below) — the why, the schema, the contracts.
2. **Checklist** (bottom of file) — actionable ☐ items the mobile agent ticks
   off as it implements. Each item back-references a § for context.

When you're stuck, search for the symbol or table name in this file first
before grepping the codebase. This doc captures the load-bearing decisions
that aren't obvious from reading source.

---

## 1. Project shape

- Monorepo: `/Users/mark_habbi/Seatly-12`
  - `apps/web/` — Vite + React 18 + TypeScript strict + Tailwind + shadcn/ui.
  - `apps/mobile/` — Expo / React Native (currently a stub).
  - `packages/assistant/` — shared types (`BookingState`, `AssistantResponseType`,
    `AssistantMemory`, `OrchestratorRequest` zod schema, etc.). Both `apps/web`
    and `apps/mobile` consume this package.
  - `supabase/functions/` — Deno edge functions.
  - `supabase/migrations/` — SQL migrations.
- **Supabase project ref:** `exbjodmnpdiayfzrdyux` (region `ca-central-1`).
- **Concurrent-user ceiling:** ~2,250 active sessions on Micro compute. See
  `CONCURRENCY_PLAN.md` for the levers used to get there. Don't regress this.
- **Hard rule:** never bypass `book_reservation` or `modify_reservation_slot`
  for reservation writes. They own the advisory lock + cover-cap recheck +
  diner-overlap pre-check. Direct INSERTs fail the partial GiST exclusions
  with an opaque `23P01`; always go through the RPCs so users see the friendly
  `P0006 / diner_double_book` error instead.

---

## 2. Core schema (with column purpose)

These are the tables your mobile booking flow will touch. Column purposes
are non-obvious things that drove design decisions.

### `restaurants`
- `id uuid pk`
- `slug text` — public URL handle.
- `name`, `cuisine_type`, `description`, `address`, `city`, `province`,
  `country`, `lat`, `lng` — all human-facing public data.
- `timezone text` — IANA tz (`America/Toronto`). Used everywhere availability
  and slot times need to round-trip through wall-clock.
- `currency text` — three-letter ISO code (default `CAD`).
- `tax_rate numeric` — decimal (e.g. `0.13`).
- `hours_json jsonb` — week-of-day open/close times. See
  `apps/web/src/lib/restaurant-hours.ts` for the parser.
- `settings_json jsonb` — restaurant-level config: theme, dietary tags,
  `turnTimeMinutes` (default 90), `acceptsWalkins`, etc.
- `deposit_policy_json jsonb` — currently `{requires_deposit:false}` on every
  row. Phase 3 (deferred) will populate it with party-size thresholds.
- `is_active boolean` — gates customer-facing visibility. Public RLS shows
  `is_active = true` only.
- `cenaiva_tts_voice text` — per-user voice prefs live on `user_profiles`,
  NOT here. (No, this column is on user_profiles.)

### `shifts`
- `id uuid`, `restaurant_id`, `name`.
- `days_of_week int[]` — bitmask 0–6 (Sunday=0).
- `start_time time`, `end_time time`.
- `slot_duration_minutes int` — granularity of bookable times (default 30).
- `turn_time_minutes int` — how long each reservation locks the table
  (default 90). The `slot_range` on a reservation is
  `[reserved_at, reserved_at + turn)`.
- `max_covers int` — cover-pacing cap. `book_reservation` raises
  `over_cover_cap` when `total_covers + party_size > max_covers`. Default
  100; raise per shift via the dashboard if you want whole-restaurant
  bookings up to seat total.
- `min_party_size`, `max_party_size` — UI cap on what the form accepts.
- `advance_booking_days int` — how far ahead a guest can book.
- `blackout_dates date[]` — explicit closed dates.
- `is_active boolean` — soft-delete on edit.

### `tables`
- `id uuid`, `restaurant_id`, `label text`.
- `capacity int` — per-table seats. Sum across active tables = restaurant
  total seat capacity (surfaced in the dashboard via `useRestaurantSeatTotal`).
- `position_json` — floor-plan x/y for the staff view.
- `is_active boolean`.

### `reservations`
- `id uuid pk`.
- `restaurant_id`, `user_profile_id` (nullable for guest bookings),
  `confirmation_code text` (6-char uppercase, generated server-side).
- `party_size int`, `reserved_at timestamptz`, `duration_minutes int`,
  `slot_range tstzrange` — trigger-set from `reserved_at + duration` because
  `timestamptz + interval` is STABLE, not IMMUTABLE, so it can't go in a
  generated column. The slot_range is what the partial GiST exclusions
  enforce against.
- `status text` enum:
  - `pending` — booking created but not yet confirmed (guest path).
  - `confirmed` — staff or system has confirmed.
  - `seated` — guests have arrived; staff marks via host page.
  - `paid` — preorder + payment completed.
  - `post_booking` — after meal, awaiting reviews / clean-up.
  - `cancelled`, `no_show`.
  - **Phase 3 follow-up:** `pending_deposit` slots in between `pending` and
    `confirmed` while a Stripe deposit charge is in flight.
- `deposit_amount numeric` (cents, currently null).
- `deposit_status text` — null today; `required | paid | failed | refunded |
  expired` once Phase 3 ships.
- `deposit_stripe_payment_intent_id text` — populated after Stripe charge.
- `source text` — `'web' | 'cenaiva' | 'staff'` — provenance for analytics.
- `guest_email`, `guest_phone`, `guest_full_name` — for non-account diners.
- `special_request`, `occasion` — free-text from the booking form.

### `reservation_tables`
- Join row per (reservation, table) — large parties combine multiple tables
  via `find_available_table_group`. A second set of partial GiST exclusions
  on this table ensures two reservations can't both claim the same physical
  table at overlapping times.

### `orders` + `order_items`
- Pre-order cart for diners who want to pay before arriving. One order per
  reservation (1:1 via `orders.reservation_id`).
- `orders.status`: `cart → unpaid → paid` (or `cancelled`).
- `orders.stripe_payment_intent_id`, `paid_at`, `billed_at`.

### `saved_cards`
- Stripe payment-method cache. In test mode, populated locally; in live mode,
  pulled from Stripe on every `stripe-list-methods` call.

### `user_profiles`
- `auth_user_id uuid` — fk to Supabase auth.users.
- `full_name`, `email`, `phone`, `cenaiva_tts_voice` (`'female' | 'male' |
  null`), `allergies text[]`, `dietary_restrictions text[]`,
  `seating_preference text`, `preferred_language text`, `stripe_customer_id`.

### `staff_members` + `user_restaurant_roles`
- `user_restaurant_roles`: (user_profile_id, restaurant_id, role) — the RLS
  boundary for staff. Empty rows = customer.

### `payments`
- Stripe payment-intent ledger. Once Phase 3 ships, deposits + orders both
  insert here with a `payment_type` discriminator.

### `availability_cache`
- UNLOGGED Postgres table fronting `get_available_slots_cached`. 7-second
  TTL on the SQL side, 10-second TTL on the client side. UNLOGGED means it
  doesn't WAL → cheap to upsert under load. Opportunistic 5-min prune.
- Phase 10a from `CONCURRENCY_PLAN.md` is the canonical reference for this
  pattern; replicate it for any future read-heavy hot path.

---

## 3. Atomic booking RPCs (the only way to write reservations)

### `book_reservation(p_restaurant_id uuid, p_party_size int, p_reserved_at timestamptz, p_turn_minutes int, p_status text default 'pending', p_user_profile_id uuid default null, p_guest_email text default null, p_guest_phone text default null, p_guest_full_name text default null, p_special_request text default null, p_occasion text default null) returns table(out_reservation_id uuid, out_confirmation_code text, out_table_ids uuid[], out_duration_minutes int)`

Atomicity guarantees:
1. Acquires `pg_advisory_xact_lock(hashtextextended(restaurant_id || ':' || reserved_at))` — ensures any concurrent attempt at the same slot serializes.
2. Re-fetches `shifts.max_covers` and re-counts `total_covers` for the slot
   inside the lock; raises `over_cover_cap` (P0001) if the addition would exceed.
3. Pre-checks the diner's overlapping reservations (any restaurant, any
   identifier — user_profile_id / `lower(email)` / digits-only phone) and
   raises `diner_double_book` (P0006) before the partial GiST exclusion
   would do so with the opaque `23P01`.
4. Calls `find_available_table_group` to pick tables for the party.
5. Inserts the reservation + `reservation_tables` rows with `slot_range`
   trigger-set to `[reserved_at, reserved_at + turn_minutes)`.

### `modify_reservation_slot(p_reservation_id uuid, p_restaurant_id uuid, p_shift_id uuid, p_new_reserved_at timestamptz, p_new_party_size int, p_turn_minutes int) returns table(out_reservation_id uuid, out_table_ids uuid[], out_duration int)`

Same advisory-lock hash function as `book_reservation` so create vs modify
serialize against each other. Releases the old `reservation_tables`
assignments and claims new ones in the same transaction.

### `compute_deposit_cents(p_restaurant_id uuid, p_party_size int) returns int` — Phase 3 follow-up

Reads `restaurants.deposit_policy_json` and returns the deposit amount in
cents for the given party size. Returns 0 when `requires_deposit=false`.

---

## 4. Availability RPCs (read-only)

### `get_available_slots_cached(p_restaurant_id uuid, p_date text, p_party_size int) returns jsonb`

Single restaurant. Returns:

```jsonc
{
  "slots": [
    {
      "shift_id": "uuid",
      "shift_name": "Dinner",
      "date_time": "2026-05-09T19:30:00.000Z",  // UTC ISO
      "table_ids": ["uuid", ...],                 // optional
      "duration_minutes": 90                      // optional
    }
    // ...
  ],
  "floor_capacity": 391,                          // sum of bookable seats today
  "hours_window": "11:00 AM to 10:00 PM",         // optional
  "unavailable_reason": null,                     // or one of the codes below
  "message": null,                                // human-readable, optional
  "timezone": "America/Toronto"
}
```

Internally consults `availability_cache` for sub-7-second results, computes
fresh on miss, upserts. The web client adds another 10-second TTL on top —
both layers dedupe burst clicks for the same (restaurant, date, party).

### `get_available_slots_for_restaurants_compact(p_restaurant_ids uuid[], p_date text, p_party_size int, p_target_time text default null) returns jsonb`

Multi-restaurant batch (used by the Discover rail and Cenaiva voice
recommendations). Returns up-to-6 centered slots per restaurant. The
target_time enables centered windowing — 3 before, 3 at-or-after, backfilled
from whichever side has more.

```jsonc
{
  "<restaurant_id>": {
    "slots": [...],            // up to 6
    "floor_capacity": 391,
    "timezone": "America/Toronto"
  },
  // ...
}
```

### `restaurant_available_dates(p_restaurant_id uuid, p_party_size int, p_start_date date, p_end_date date) returns text[]`

Returns YYYY-MM-DD[] of dates with at least one available slot in the
window. Window is capped at 62 days. Used by:

- Calendar pickers to disable dates that have no availability.
- The mobile-side `<AvailabilityPanel>` to compute "next closest day" on
  cold load.

### `find_available_table_group(p_restaurant_id uuid, p_reserved_at timestamptz, p_party_size int, p_turn_minutes int, p_exclude_reservation_id uuid default null, p_adjacency_distance double default 170) returns uuid[]`

Internal to `book_reservation`. Picks a set of tables that combine to seat
the party, preferring adjacent tables (within `adjacency_distance` units on
the floor plan). Don't call this directly from a client.

---

## 5. Edge functions (web/mobile clients call these)

Always call edge functions for **writes** (booking, modify, cancel, charge).
Read RPCs you can call directly from the client.

### `create-public-booking` — primary booking entrypoint
- POST `/functions/v1/create-public-booking`
- Auth: Bearer (signed-in user) **or** anon for guest bookings, in which
  case the function captures `guest_email`/`guest_phone`/`guest_full_name`.
- Body:
  ```json
  {
    "restaurant_id": "uuid",
    "shift_id": "uuid",
    "reserved_at": "2026-05-09T19:30:00.000Z",
    "party_size": 2,
    "duration_minutes": 90,
    "guest_email": "...",
    "guest_phone": "...",
    "guest_full_name": "...",
    "special_request": "...",
    "occasion": "...",
    "preorder": { "items": [...] }
  }
  ```
- Response: `{ reservation_id, confirmation_code, order_id?, table_ids[], duration_minutes }`
- Errors: HTTP 409 with `{ unavailable_reason, message }`. See § 11.
- Rate-limit key: `public_booking:<ip>` (5/min default).

### `modify-reservation` — modify entrypoint
- POST `/functions/v1/modify-reservation`
- Auth: Bearer + reservation ownership check.
- Body: `{ reservation_id, new_reserved_at, new_party_size, turn_minutes }`
- Response: `{ reservation_id, table_ids[], duration }`

### `cancel-reservation`
- POST `/functions/v1/cancel-reservation`
- Auth: Bearer or anon-with-confirmation-code.
- Body: `{ reservation_id }` or `{ confirmation_code }`
- Idempotent: cancelling an already-cancelled reservation returns the same
  shape with status='cancelled'.

### `get-availability` — legacy
- POST `/functions/v1/get-availability`
- Currently bypassed when `USE_SQL_AVAILABILITY=1` (the default). Web calls
  the RPC directly; mobile should do the same.

### Stripe family
- `stripe-setup-intent` — creates a Stripe SetupIntent so the client can
  attach a card without charging. Returns `{ client_secret, mode }`.
- `stripe-charge-order` — charges a saved card for an `orders.id`. Sets
  `orders.status='paid'`. Returns `{ ok, total_charged, paid_at }`.
- `stripe-list-methods` — lists saved cards.
- `stripe-charge-deposit` — **Phase 3 follow-up only.** Mirrors
  `stripe-charge-order` but for `reservations.deposit_amount`.

### Cenaiva voice family (mobile already consumes most of these)
- `cenaiva-orchestrate` — full LLM tool loop with SSE streaming.
  Augmented request body: `transcript, screen, booking_state, map_state,
  filters, visible_restaurant_ids, selected_restaurant_id,
  recommendation_mode?, assistant_memory?, user_location, timezone,
  conversation_id, has_saved_card, guest_id, reservation_id`.
- `cenaiva-availability` — orchestrator-internal availability fast-path.
- `cenaiva-small-prompt` — orchestrator-internal Q&A fast-path. Skip when
  the turn is a confirmation reply or a process prompt.
- `elevenlabs-tts` — TTS audio streaming.
- `deepgram-live-token` — short-lived STT token vendor.

### Cron-triggered (no client call needed)
- `send-booking-reminder`, `send-anniversary-messages`,
  `send-birthday-messages`.

---

## 6. Status enums (the ones you'll switch on)

```ts
// reservations.status
type ReservationStatus =
  | 'pending'
  | 'pending_deposit'   // Phase 3 follow-up
  | 'confirmed'
  | 'seated'
  | 'paid'
  | 'post_booking'
  | 'cancelled'
  | 'no_show';

// reservations.deposit_status (Phase 3 follow-up)
type DepositStatus =
  | null
  | 'required'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'expired';

// orders.status
type OrderStatus = 'cart' | 'unpaid' | 'paid' | 'cancelled';

// payments.payment_type (Phase 3 follow-up)
type PaymentType = 'order' | 'deposit';
```

The web mapper `apps/web/src/lib/reservations/displayStatus.ts` collapses
these into UI states (`upcoming | current | past | cancelled`). Mobile
should mirror that mapper, not invent its own.

---

## 7. Realtime publication

These tables broadcast row-level changes via Postgres logical replication →
Supabase Realtime channels:

- `reservations`
- `orders`
- `order_items`
- `tables`
- `waitlist`
- `notifications`

Subscription pattern (web + mobile, identical):

```ts
const channel = client
  .channel(`reservations:${restaurantId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'reservations',
    filter: `restaurant_id=eq.${restaurantId}`,
  }, () => {
    // refetch the dashboard query OR invalidate the slot cache
  })
  .subscribe();
```

The owner dashboard's reservations refetch trigger lives at
`apps/web/src/hooks/useReservations.ts:188-207`. The customer-side
availability cache invalidator lives at
`apps/web/src/hooks/useAvailability.ts:431-460`.

---

## 8. RLS layout

| Surface | Read | Write |
|---|---|---|
| Customers | own reservations (`auth.uid() = user_profiles.auth_user_id` join), public restaurants where `is_active=true` | reservations only via edge functions (service-role bypass) |
| Staff | rows where `restaurant_id` matches their `user_restaurant_roles` | reservations (with role gates), tables, shifts, menu items, etc. |
| Service-role | bypasses RLS entirely; only edge functions hold this key | atomic writes via supabaseAdmin.rpc(...) |

`anon` and `authenticated` get explicit `EXECUTE` grants on the public RPCs
(`book_reservation`, `get_available_slots_cached`, etc.). Function bodies
enforce ownership and rate limits internally.

---

## 9. Performance & concurrency rules (HARD)

These are non-negotiable. Breaking them is how the original 100-user
ceiling came back during the Phase 10 work.

1. **Never per-row fetch in a list.** Always batch. The canonical pattern
   for restaurants on a list page is
   `get_available_slots_for_restaurants_compact(uuid[], …)`.
2. **Always cache reads with bounded TTL.** The 10-s availability cache is
   the canonical pattern. Write the cache invalidation alongside the cache.
3. **Always rate-limit writes.** `_shared/rate-limit.ts` +
   `check_rate_limit(p_key, p_limit, p_window_seconds)` RPC.
4. **Don't open long-lived connections** unless you have a reason.
   `postgres_changes` on the dashboard is the only acceptable always-on
   socket; everything else should be polled or fetched on demand.
5. **Hooks only, never queries in components.** Web rule, mobile follows
   the same pattern.

---

## 10. OpenTable-equivalent flows on this stack

How the OpenTable patterns map to our primitives:

| OpenTable behavior | Cenaiva primitive |
|---|---|
| Single-restaurant page lands with today / current time / 2 guests pre-populated | `<AvailabilityPanel>` `useEffect` mount-only bootstrap: `fetchNextAvailableDate` → `closestSlotTimeToNow` → default party 2 |
| 5–7 time-pill row centered around requested time | `centerSlotsAround(slots, time, 6)` inside the panel |
| Any control change re-fetches | `<AvailabilityPanel>` `useEffect` keyed on `(date, partySize)`; time change re-windows in-cache without a fetch |
| Conflict prevention (own bookings) | `useDinerConflictWindows` + per-pill `classifySlot(slot, conflicts)` → disabled pill with tooltip |
| Modify flow uses same surface | Same `<AvailabilityPanel>` with `excludeReservationId` prop; backend writes via `modify_reservation_slot` |
| Whole-restaurant bookings | Owner raises `shifts.max_covers` to `sum(tables.capacity)`. Dashboard surfaces this number via `useRestaurantSeatTotal`. |
| Per-restaurant deposit thresholds (Phase 3 follow-up) | `restaurants.deposit_policy_json.thresholds[]` → `compute_deposit_cents` → `stripe-charge-deposit` |
| System-of-record (no double-bookings) | `pg_advisory_xact_lock` + 3 partial GiST exclusions on `reservations.slot_range` keyed on `(user_profile_id, slot_range)`, `(lower(guest_email), slot_range)`, `(digits_only(guest_phone), slot_range)` |
| "No availability — try X" suggestion | `fetchNextAvailableDate({ fromDate: tomorrow })` rendered as a pill in the panel's empty state |

---

## 11. Error codes the mobile client must handle

| Source | Code / shape | Meaning | Recommended UX |
|---|---|---|---|
| RPC | `P0001 'over_cover_cap'` | Party + existing covers > shift `max_covers` | "This time is fully booked. Pick another time." |
| RPC | `P0006 'diner_double_book'` | Diner has overlapping reservation (any restaurant) | "This conflicts with another reservation you already have." Surface the conflicting restaurant name + window from `useDinerConflictWindows`. |
| Postgres | `23P01` | Partial-exclusion backstop fired (race past pre-check) | Treat as `diner_double_book`. |
| Edge fn | HTTP 409 `{ unavailable_reason: 'closed' }` | Restaurant closed on requested date | "Closed on this date." |
| Edge fn | HTTP 409 `{ unavailable_reason: 'no_shifts' }` | No service hours configured | "No service hours configured." |
| Edge fn | HTTP 409 `{ unavailable_reason: 'party_size_out_of_range' }` | Party exceeds shift `max_party_size` or restaurant capacity | "Party size {N} exceeds this restaurant's capacity ({max})." |
| Edge fn | HTTP 409 `{ unavailable_reason: 'insufficient_capacity' }` | Not enough seats at this exact time | Show alternatives from same response. |
| Edge fn | HTTP 409 `{ unavailable_reason: 'fully_booked' }` | Date sold out | "Fully booked for this date." |
| Edge fn | HTTP 409 `{ unavailable_reason: 'no_future_slots' }` | All slots for today already past | "No more times remaining today." |
| Edge fn | HTTP 409 `{ unavailable_reason: 'no_slots' }` | Generic empty | "No times available." |
| Stripe | `card_declined`, `insufficient_funds` | Phase 3 deposit | Prompt for a different card. |
| Stripe | `payment_intent_authentication_failure` | 3DS challenge needed | Re-trigger the `confirmCardPayment` UI. |
| Stripe | `api_connection_error` | Stripe outage | Show retry; on second failure, surface a fallback flow. |

---

## 12. Migration ledger (load-bearing events)

Reading the migrations in chronological order tells you why the schema
looks the way it does. Cenaiva's history:

- **2026-03** — initial schema. `restaurants`, `reservations`, `shifts`,
  `tables`, `user_profiles`, `staff_members`.
- **2026-04** — partial GiST exclusions on `reservations` keyed on
  `(user_profile_id, slot_range)`, `(lower(guest_email), slot_range)`,
  `(digits_only(guest_phone), slot_range)`. Backstop against double-book
  races.
- **2026-04** — atomic `book_reservation` RPC with advisory lock.
- **2026-05** — `book_reservation` status param (so callers can choose
  `pending` vs `confirmed`); `modify_reservation_slot` introduced; diner
  overlap pre-check returns `P0006` ahead of the exclusion.
- **2026-05** (this PR, no DDL) — web `<AvailabilityPanel>` rebuild.
- **2026-?? (Phase 3 follow-up)** — `compute_deposit_cents` SQL function +
  `reservations.deposit_due_by` column + `pg_cron` expiry sweep + new
  `pending_deposit` status value + `stripe-charge-deposit` edge function.

---

# Mobile agent checklist — implementing the Cenaiva booking flow

> Tick ☑ as you ship. Each item back-references a § for context.
>
> Section A is bootstrap; B–E is the booking flow itself; F is deposits
> (DO NOT IMPLEMENT until web ships first); G is voice (already partially
> wired); H is verification.

## A. Bootstrap

- [ ] **A.1 [§ 1]** Confirm the RN app has Supabase client wired with
      `VITE_SUPABASE_URL` + the **publishable** key (NOT secret). Mobile
      apps should ship the publishable key.
- [ ] **A.2 [§ 1]** Confirm `@cenaiva/assistant` is in `apps/mobile/package.json`
      and `BookingState`, `AssistantResponseType`, `AvailabilitySlot` types
      import cleanly.
- [ ] **A.3 [§ 8]** Verify `auth.uid()` works in your test harness via a
      small SELECT through Supabase JS. If it returns null, your auth
      session isn't propagating.

## B. Read paths (~1–2 days)

- [ ] **B.1 [§ 4]** Implement `fetchSlots(restaurantId, date, partySize)`
      wrapping RPC `get_available_slots_cached`. Cache responses in-memory
      for 10 s, dedupe burst calls. Web reference:
      `apps/web/src/hooks/useAvailability.ts:fetchAvailabilitySlots`.
- [ ] **B.2 [§ 4]** Implement `fetchAvailableDateSet(restaurantId,
      partySize, startDate, endDate)` wrapping `restaurant_available_dates`.
- [ ] **B.3 [§ 4]** Implement `fetchNextAvailableDate({ restaurantId,
      partySize, fromDate })` — short-circuits to `fromDate` when today has
      slots; falls through to `restaurant_available_dates` for the 60-day
      scan otherwise. Web reference:
      `apps/web/src/hooks/useAvailability.ts:fetchNextAvailableDate`.
- [ ] **B.4 [§ 10]** Implement `closestSlotTimeToNow(slots, timezone)` —
      rounds wall-clock to nearest 15 min, walks to nearest actual slot.
      Returns "HH:MM" 24h. Web reference: same file.
- [ ] **B.5 [§ 10]** Implement `centerSlotsAround(slots, targetTime, 6)` —
      3 before target + 3 at-or-after, backfill from larger side. Web
      reference: `apps/web/src/components/booking/AvailabilityPanel.tsx`.
- [ ] **B.6 [§ 7]** Subscribe to `postgres_changes` on `reservations`
      filtered by `restaurant_id=eq.${restaurantId}`; on any change, drop
      the local slot cache for that restaurant.
- [ ] **B.7 [§ 4]** Implement `useDinerConflictWindows({ userProfileId,
      restaurantId, date, timezone, excludeReservationId? })` returning
      conflicting reservations for the diner across all restaurants. Used
      to render disabled pills, never to silently filter. Web reference:
      `apps/web/src/hooks/useAvailability.ts:useDinerConflictWindows`.

## C. AvailabilityPanel (mobile, RN-equivalent)

- [ ] **C.1 [§ 10]** Build the panel with three controls (date / time /
      party) + 6-pill slot grid + loading + empty + error states. Match
      `apps/web/src/components/booking/AvailabilityPanel.tsx` for parity.
- [ ] **C.2 [§ 10]** On mount: default party = 2; default date =
      `fetchNextAvailableDate(today)` (today short-circuits if available);
      default time = `closestSlotTimeToNow(slots, timezone)`.
- [ ] **C.3 [§ 10]** On any control change: re-derive cache key, hit cache
      first; fetch on miss.
- [ ] **C.4 [§ 11]** Render each slot pill in three states: available
      (solid), conflict (disabled with tooltip referencing the diner's
      other reservation), past/outside-window (not rendered).
- [ ] **C.5 [§ 5]** Click an available pill → call props.`onSelectSlot(slot)`.
      Parent advances flow (contact form, etc.).
- [ ] **C.6 [§ 11]** Empty state: render "No availability for {N} guests
      on {date}" + a "Try {nextAvailableDate}" pill that updates `date`.

## D. Booking write

- [ ] **D.1 [§ 5]** POST to `/functions/v1/create-public-booking` with the
      slot, party, and contact info. Auth: Bearer JWT from
      `supabase.auth.getSession()`.
- [ ] **D.2 [§ 11]** On HTTP 409, parse `unavailable_reason` and surface a
      friendly message. On `P0006/23P01`, surface "This conflicts with
      another reservation you already have." with the conflict window from
      `useDinerConflictWindows`.
- [ ] **D.3 [§ 5]** Show `confirmation_code` returned from the edge
      function on the success screen.
- [ ] **D.4 [§ 7]** On the bookings list page, subscribe to
      `postgres_changes` so a staff-side modify or cancel is reflected
      without a manual refresh.

## E. Modify flow

- [ ] **E.1 [§ 3]** Reuse `<AvailabilityPanel>`; pass `excludeReservationId
      = reservation.id`, `initialDate / initialTime / initialPartySize`
      from the row.
- [ ] **E.2 [§ 5]** POST to `/functions/v1/modify-reservation`. Same auth
      model.
- [ ] **E.3 [§ 9]** While the user has the page open, the realtime
      subscription forces a refetch if staff modifies the reservation
      first.

## F. Deposits — Phase 3 follow-up (DO NOT IMPLEMENT until web ships first)

- [ ] **F.1 [§ 5]** Add `stripe-setup-intent` integration on RN
      (Stripe RN SDK's `presentPaymentSheet`).
- [ ] **F.2 [§ 6]** Read `restaurants.deposit_policy_json` from the
      restaurant row; mirror `compute_deposit_cents` client-side so the
      UI shows the amount before booking. Server is still authoritative.
- [ ] **F.3 [§ 10]** Sequence: SetupIntent → `book_reservation(pending_deposit)`
      → `stripe-charge-deposit`. **Never charge before the slot is locked.**
- [ ] **F.4 [§ 6]** Surface `deposit_status` in the bookings list with a
      colored badge (yellow=required, green=paid, red=failed, grey=refunded).
- [ ] **F.5 [§ 6]** Handle `'expired'` status (the `pg_cron` sweep
      auto-cancelled the reservation). Customer should see "Deposit timed
      out — please book again."

## G. Voice integration (already wired on mobile)

- [ ] **G.1 [§ 5]** `cenaiva-orchestrate` / `cenaiva-availability` /
      `cenaiva-small-prompt` are deployed and consumed from
      `lib/cenaiva/CenaivaAssistantProvider.tsx` on mobile. No changes
      needed for booking work; just verify they still respond.
- [ ] **G.2 [§ 2]** ElevenLabs voice picker — see
      `apps/web/src/contexts/CenaivaVoicePreferenceProvider.tsx` for the
      `localStorage` + `user_profiles.cenaiva_tts_voice` pattern. Mobile
      uses AsyncStorage instead of localStorage.

## H. Verification

- [ ] **H.1 [§ 10]** Manual smoke: open Mark Testing → defaults populate →
      6 pills appear → book → confirmation_code returned → row appears on
      owner dashboard within ~1 s without manual reload.
- [ ] **H.2 [§ 11]** Conflict UX: book one slot, then try to book an
      overlapping slot at a second restaurant → conflict pill is disabled
      with tooltip naming the conflicting restaurant.
- [ ] **H.3 [§ 5]** Modify: change party size → pills re-fetch → save →
      row updates on dashboard via realtime.
- [ ] **H.4 [§ 9]** Network panel verification: ONE
      `rpc/get_available_slots_cached` POST per (date, party) combo. ZERO
      per-row fetches.
- [ ] **H.5 MCP** `mcp execute_sql` "select status, deposit_status from
      reservations order by created_at desc limit 5" after a booking —
      confirm fields populate as expected.
- [ ] **H.6 MCP** `mcp get_advisors security` and `mcp get_advisors
      performance` — expect 0 ERRORs and no NEW WARN findings (baseline
      must be unchanged).
- [ ] **H.7 [§ 9]** Run a 5-minute soak test with N=20 simulated diners
      hammering `get_available_slots_cached` — confirm latency stays p95 < 1 s.

---

## Quick reference card

| Need to … | Use this |
|---|---|
| Read slots for a date | `get_available_slots_cached` (single) or `get_available_slots_for_restaurants_compact` (batch) |
| Find next bookable date | `restaurant_available_dates` |
| Book | `create-public-booking` edge fn → `book_reservation` RPC |
| Modify | `modify-reservation` edge fn → `modify_reservation_slot` RPC |
| Cancel | `cancel-reservation` edge fn |
| List staff reservations | `from('reservations').select(...).eq('restaurant_id', id)` + realtime sub |
| Find diner's other reservations | `useDinerConflictWindows` |
| Sum restaurant capacity | `sum(tables.capacity) where is_active=true` (or `useRestaurantSeatTotal`) |
| Deposit amount (P3) | `compute_deposit_cents(restaurant_id, party_size)` |

---

*End of mobile-agent reference. Update this file alongside any schema or
RPC change. The web's `CLAUDE.md` is the authoritative source for hard
rules; this file is the cross-app reference.*
