# HAB System Efficiency — Booking Flow Updates (Web → Mobile Handoff)

**Date shipped:** 2026-05-16
**Project:** Cenaiva web (`apps/web/`) → mobile mirror
**Supabase project:** `exbjodmnpdiayfzrdyux` (ca-central-1)

This doc describes the **reservation-hold system** that just shipped on the Cenaiva web booking flow. The mobile app needs to mirror it so diners get the same experience and the database stays consistent (no half-booked ghost reservations, no double-bookings between web and mobile diners).

---

## TL;DR — what changed

**Before:** Diner clicks "Place Order" → reservation created instantly with `status='confirmed'` → Stripe payment happens AFTER. If diner abandons mid-payment, the slot is locked forever as a ghost reservation. Restaurant owners see fake "confirmed" bookings that never paid.

**After:** Diner enters the 3-step booking flow (Details → Menu → Payment) → a **30-minute hold** is created in a separate `reservation_holds` table (invisible to restaurant owners). A countdown timer runs across all 3 steps. Conversion to a real confirmed reservation happens only at the END: on "Place Order" click (no-payment) or after Stripe payment confirms (deposit/preorder). Abandoned holds auto-expire via a cron job that runs every 5 minutes.

**Same diner experience either way** — but now:
- ✅ Owners only ever see real (paid) bookings on their floor plan
- ✅ Abandoned booking attempts free up the slot automatically
- ✅ No ghost confirmations
- ✅ Diner-double-book is still prevented across BOTH active holds AND existing reservations

---

## Architecture — visual

```
Diner picks restaurant, date, time, party size
        │
        ▼
   Lands on /r/<slug> → "Book your table" Step 1 (Details)
        │
        ▼
   ┌─────────────────────────────────────────────┐
   │  HOLD CREATED on Step 1 page mount          │
   │  (anonymous — slot + party + tables only)   │
   │                                             │
   │  Sticky timer banner across all 3 steps:    │
   │  ┌───────────────────────────────────────┐  │
   │  │  ⏱  Holding your table — 28:42        │  │
   │  └───────────────────────────────────────┘  │
   └─────────────────────────────────────────────┘
        │
        ▼
   Step 1 Details: fill name/email/phone → submit → hold updated with diner info
        │
        ▼
   Step 2 Menu: pick optional pre-order items → cart_snapshot updated on hold
        │
        ▼
   Step 3 Payment:
       │
       ├─ No payment needed ──► "Place Order" → server converts hold to confirmed reservation
       │
       └─ Deposit OR pre-order ─► Stripe Payment Element → on success:
                                  - Browser calls /confirm-hold-paid (fast path)
                                  - Stripe webhook ALSO fires (backup path)
                                  - First caller wins, second sees idempotent=true
        │
        ▼
   Confirmed reservation appears on owner's floor plan, diner sees confirmation page

   IF 30 minutes elapse without conversion → hold silently expires, slot frees up
   IF diner refreshes payment page within 45 min → "Your hold ended" recovery modal
```

---

## What's in production (Supabase project `exbjodmnpdiayfzrdyux`)

### New DB objects

**Table:** `public.reservation_holds`
- Columns: `id`, `restaurant_id`, `shift_id`, `reserved_at`, `duration_minutes`, `slot_range` (tstzrange, trigger-set), `party_size`, `table_ids` (uuid[]), `user_profile_id`, `guest_id`, `guest_full_name`, `guest_email`, `guest_phone`, `confirmation_code`, `source` (`'web'|'cenaiva'|'app'|'host'`), `special_request`, `dietary_notes`, `occasion`, `seating_preference`, `event_id`, `promotion_id`, `applied_promo_code`, `cart_snapshot` (jsonb), `deposit_amount_cents`, `total_amount_cents`, `stripe_payment_intent_id`, `status` (`'active'|'converting'|'converted'|'expired'|'cancelled'`), `converted_reservation_id`, `created_at`, `expires_at`, `last_heartbeat_at`.
- Trigger: `reservation_holds_set_slot_range_trg` auto-computes `slot_range` from `reserved_at + duration_minutes` (mirrors reservations).
- Three GiST partial exclusion constraints prevent same diner from holding two overlapping slots (matching the same constraints on `reservations`).
- RLS: service-role full, diner self-select by `user_profile_id = auth.uid()`. **Owners explicitly excluded** — this is the whole point: holds invisible to restaurant dashboards.

**RPCs (Postgres functions):**
- `create_reservation_hold(...)` — advisory lock + cover-cap + diner-overlap pre-check (against BOTH `reservations` AND active `reservation_holds`) + table assignment + INSERT. Returns `hold_id, confirmation_code, table_ids, duration_minutes, expires_at, deposit_amount_cents, server_now`.
- `update_reservation_hold_diner(...)` — attaches name/email/phone/notes; re-runs diner-overlap check (was anonymous at create).
- `update_reservation_hold_cart(hold_id, cart_snapshot, total_amount_cents)` — Step 2 cart updates.
- `extend_reservation_hold(hold_id, extend_seconds)` — heartbeat extends `expires_at`, capped at `created_at + 35 min` (original 30 + 5 max grace).
- `cancel_reservation_hold(hold_id)` — flips status to 'cancelled'.
- `expire_reservation_holds(grace_seconds)` — bulk job; flips expired-active rows to 'expired'; also drops terminal rows older than 7 days.
- `convert_reservation_hold_to_reservation(hold_id, payment_intent_id, grace_seconds)` — atomic conversion. `SELECT ... FOR UPDATE` serializes the cleanup job vs the webhook vs the browser. **Idempotent** — second caller returns the existing reservation with `idempotent: true`.
- Patched `find_available_table_group` — now UNIONs in active holds as blocked tables, so other diners can't pick a held slot.

**Trigger fix:** `generate_confirmation_code` patched to only generate when `NEW.confirmation_code IS NULL` (was unconditionally overwriting — latent bug that also affected `book_reservation`).

**Cron job:** `cenaiva_expire_reservation_holds` runs every 5 min via `pg_cron`, calls the `expire-reservation-holds` edge function which calls the RPC.

**Error codes (used by edge functions for HTTP status mapping):**
- `P0001 no_table` → 409
- `P0002 over_cover_cap` → 409
- `P0003 shift_not_found` → 404
- `P0006 diner_double_book` (or `23P01` exclusion backstop) → 409
- `P0010 hold_not_found` → 404
- `P0011 hold_expired` → 410 (caller should refund Stripe charge if it landed)
- `P0012 hold_not_convertible` → 409

### New edge functions

All anon-callable (`verify_jwt: false`); each instantiates its own Supabase admin client and applies per-IP rate limits via `_shared/rate-limit.ts`.

| Function | Method | Rate limit | Purpose |
|---|---|---|---|
| `create-reservation-hold` | POST | 30/min/IP | Creates a hold on Step 1 mount. Supports `idempotency_key` for safe retries. |
| `update-reservation-hold` | POST | 60/min/IP | Updates diner info (Step 1 submit) and/or cart (Step 2 changes). |
| `heartbeat-reservation-hold` | POST | 30/min/IP | Extends `expires_at` while user is active. |
| `cancel-reservation-hold` | POST | 30/min/IP | Explicit cancel (back button, page close beacon). |
| `confirm-hold-paid` | POST | 60/min/IP | Browser-side conversion after Stripe success. Re-verifies PI with Stripe before flipping. |
| `expire-reservation-holds` | POST | none (cron) | Called by pg_cron every 5 min. Cleans up expired holds. |

### Modified edge functions (deployed new versions)

- `create-public-booking` v61 — gated on `CENAIVA_HOLDS_ENABLED=true` env. When set + body has `hold_id`, it converts the hold instead of running `book_reservation`. **Legacy path unchanged** when flag off or no `hold_id` in body.
- `create-public-payment-intent` v19 — accepts `hold_id` in body. Stamps PI metadata with `{ hold_id }` so the webhook can identify it. Updates `reservation_holds.stripe_payment_intent_id` (partial unique index ensures one PI per hold).
- `stripe-webhook` v17 — `handlePaymentIntentSucceeded` branches on `pi.metadata.hold_id`. If set, calls `convert_reservation_hold_to_reservation`. If past grace (`P0011`), fires a Stripe refund. Legacy `reservation_id` path untouched.
- `cenaiva-orchestrate` v369 — voice booking path forks on payment requirement: payment-required goes through hold-based flow, returns `requires_payment_url` for hand-off to the public web page.
- `_shared/booking.ts` — `completeBooking()` updated to support hold flow for voice.
- `_shared/hold-conversion.ts` (new helper) — post-conversion side effects: creates orders+order_items from cart_snapshot, increments promotion usage, sets `reservations.preorder_order_id`. Best-effort; failures logged but don't block conversion.

### Environment variables (already set in production)

- `CENAIVA_HOLDS_ENABLED=true` — enables the new path on `create-public-booking` + `_shared/booking.ts`. Single-config rollback: set to `false` to revert to legacy flow.

---

## Web frontend architecture (mirror in mobile)

### New files

| File | Purpose |
|---|---|
| `apps/web/src/hooks/useReservationHold.ts` | Hook owning the entire hold lifecycle: auto-create on mount, sessionStorage hydration, 1-sec countdown timer with server-clock skew correction, activity-based heartbeat every 30s, `visibilitychange` resync, `grabAgain`, `cancelHold`, `confirmConverted` |
| `apps/web/src/components/booking/HoldTimerBanner.tsx` | Sticky banner across all 3 steps. Three visual states: calm (>5min), warning (1-5min), urgent (<1min, pulsing). |
| `apps/web/src/components/booking/HoldExpiredDialog.tsx` | Modal with "Grab it again" + "Pick a different time" buttons. |

### Modified files

- `apps/web/src/pages/customer/RestaurantPublicPage.tsx` — hook instantiated, timer banner mounted at top of booking flow, Step 1 submit wired to `updateDiner`, Step 2 cart wired to `updateCart` (debounced 500ms), Place Order passes `hold_id` to both `create-public-booking` (no-payment) and `confirm-hold-paid` (payment). HoldExpiredDialog mounted globally.
- `apps/web/src/components/booking/StripePaymentForm.tsx` — added optional `holdId` prop, threaded through to `create-public-payment-intent` body so Stripe PI metadata gets stamped.

### Hook API (mirror this exactly in mobile)

```ts
type HoldState =
  | { status: "idle" }
  | { status: "creating" }
  | { status: "active"; holdId: string; expiresAt: string; secondsLeft: number; serverSkewMs: number; depositAmountCents: number; confirmationCode: string; tableIds: string[]; durationMinutes: number }
  | { status: "expired"; holdId: string }
  | { status: "converting" }
  | { status: "confirmed"; reservationId: string; confirmationCode: string }
  | { status: "error"; message: string; reason: "no_table" | "over_cover_cap" | "diner_double_book" | "rate_limited" | "network" | "unknown" };

interface UseReservationHoldArgs {
  restaurantId: string | null;
  shiftId: string | null;
  dateTime: string | null;  // ISO timestamp
  partySize: number;
  enabled: boolean;  // true when on Details/Menu/Payment screens
  source?: "web" | "cenaiva" | "app";  // mobile uses "app"
  eventId?: string | null;
  promotionId?: string | null;
  appliedPromoCode?: string | null;
}

interface UseReservationHoldReturn {
  state: HoldState;
  visualState: "calm" | "warning" | "urgent";  // derived from secondsLeft
  createHold: () => Promise<{ holdId: string; expiresAt: string } | null>;
  updateDiner: (input: { name?: string; email?: string; phone?: string; specialRequest?: string; dietaryNotes?: string; occasion?: string; seatingPreference?: string }) => Promise<{ ok: boolean; reason?: string }>;
  updateCart: (cartSnapshot: Record<string, unknown>, totalAmountCents: number) => Promise<{ ok: boolean }>;
  grabAgain: () => Promise<boolean>;
  cancelHold: () => Promise<void>;
  confirmConverted: (reservationId: string, confirmationCode: string) => void;
}
```

### Mobile-specific adaptations

- **sessionStorage** → AsyncStorage (or MMKV) with same key format: `cenaiva:hold:<restaurantId>:<dateTime>`
- **`visibilitychange`** → React Native `AppState` listener. On `'active'` from `'background'`, immediately recompute `secondsLeft` from the stored `expiresAt`.
- **Activity tracking** (`keydown` / `pointerdown` / `input`) → wrap the booking screens in a touchable layer that records timestamps, or use `PanResponder` at the screen root.
- **`navigator.sendBeacon`** on unmount → use `fetch` with `keepalive: true` in React Native, OR fire from `useEffect` cleanup synchronously (the OS will deliver it during the brief moment before backgrounding).
- **Source = `"app"`** so server logs distinguish from web.

---

## Edge function contracts (for mobile to call)

All endpoints are at `https://exbjodmnpdiayfzrdyux.supabase.co/functions/v1/<name>`.
Headers required: `apikey: <SUPABASE_ANON_KEY>`, `Content-Type: application/json`. If diner is logged in, add `Authorization: Bearer <jwt>` so their `user_profile_id` flows to the hold.

### POST /create-reservation-hold

**Body:**
```json
{
  "restaurant_id": "uuid",
  "shift_id": "uuid",
  "date_time": "2026-05-25T22:00:00Z",
  "party_size": 4,
  "source": "app",
  "idempotency_key": "<uuid v4>",
  "event_id": null,
  "promotion_id": null,
  "applied_promo_code": null
}
```

**Success 200:**
```json
{
  "hold_id": "uuid",
  "confirmation_code": "F82B45EC",
  "table_ids": ["uuid"],
  "duration_minutes": 90,
  "expires_at": "2026-05-25T22:30:00Z",
  "deposit_amount_cents": 4000,
  "server_now": "2026-05-25T22:00:00Z"
}
```

**Error 409 (race):** `{ "error": "...", "unavailable_reason": "no_table" | "over_cover_cap" | "diner_double_book" | "rate_limited" }`
**Error 404:** `{ "error": "Shift not found for this restaurant." }`

### POST /update-reservation-hold

**Body:**
```json
{
  "hold_id": "uuid",
  "full_name": "Alice",
  "email": "alice@example.com",
  "phone": "+14165551234",
  "cart_snapshot": { "items": [...], "subtotal": 50, "tax_amount": 6.5, "tip_amount": 5 },
  "total_amount_cents": 6150,
  "special_request": "...",
  "dietary_notes": "...",
  "occasion": "...",
  "seating_preference": "..."
}
```

At least one update field is required. Diner fields and cart fields can be sent together.

**Success 200:** `{ "ok": true }`
**Error 409:** `{ "error": "diner_double_book" | "hold_expired" }`

### POST /heartbeat-reservation-hold

**Body:** `{ "hold_id": "uuid", "extend_seconds": 120 }`
**Success 200:** `{ "expires_at": "2026-05-25T22:32:00Z" }`
**Error 410 (hold not active):** `{ "error": "hold_not_active" }` — mobile should stop the heartbeat interval.

### POST /cancel-reservation-hold

**Body:** `{ "hold_id": "uuid" }`
**Success 200:** `{ "ok": true }` (always, even on RPC error — fire-and-forget friendly)

### POST /confirm-hold-paid

**Body:** `{ "hold_id": "uuid", "payment_intent_id": "pi_xxx" }`

**Success 200:**
```json
{
  "reservation_id": "uuid",
  "confirmation_code": "F82B45EC",
  "table_ids": ["uuid"],
  "duration_minutes": 90,
  "idempotent": false
}
```

**Error 410:** `{ "error": "hold_expired" }` — caller should refund the Stripe charge via `/refund-payment-intent` (existing endpoint).
**Error 402:** `{ "error": "payment_not_succeeded" | "payment_amount_too_low", "pi_status": "..." }`

### POST /create-public-payment-intent (modified, accepts hold_id)

**Body adds:** `"hold_id": "uuid"` (existing fields unchanged).

The server stamps the PI's metadata with `{ hold_id }` so the webhook can recover. The hold row is updated with `stripe_payment_intent_id`. Idempotent — if hold already has a PI, returns that one.

### POST /create-public-booking (modified, accepts hold_id for no-payment flow)

**Body adds:** `"hold_id": "uuid"` for no-payment bookings.

When the flag is on AND `hold_id` is present, the server converts the hold instead of running the legacy `book_reservation`. **For no-payment bookings, this is the path mobile should use.**

---

## Mobile flow — step-by-step

1. **Restaurant page mount (Step 1 Details):**
   - Use the hook with `enabled: true`. Hook calls `create-reservation-hold` automatically.
   - Display the timer banner once `state.status === "active"`.
2. **Step 1 form submit:**
   - Call `hold.updateDiner({ name, email, phone, specialRequest, dietaryNotes, occasion, seatingPreference })`.
   - If returns `{ ok: false, reason: "diner_double_book" }`, show error toast — don't advance.
   - Otherwise advance to Step 2.
3. **Step 2 cart changes:**
   - On every cart mutation, debounce by 500ms then call `hold.updateCart(cartSnapshot, totalAmountCents)`.
4. **Step 3 Payment:**
   - **No payment required** (totalNow == 0): On "Place Order" click → POST `/create-public-booking` with `{ ...standard payload, hold_id: state.holdId }`. On success, call `hold.confirmConverted(reservation_id, confirmation_code)`.
   - **Deposit/preorder:** Initialize Stripe with `holdId` (mobile uses Stripe React Native SDK). On Stripe success → POST `/confirm-hold-paid` with `{ hold_id, payment_intent_id }`. On success, call `hold.confirmConverted(...)`.
5. **Timer hits 0:**
   - Hook transitions to `"expired"` state. Show the recovery modal.
   - `[Grab it again]` → call `hold.grabAgain()`. If returns `false`, the slot was taken — show the conflict copy.
   - `[Pick a different time]` → navigate back to the slot picker.
6. **Page unmount or back gesture:**
   - Hook fires a `fetch(keepalive: true)` to `/cancel-reservation-hold`. Cleanup happens server-side without a response needed.

---

## Owner-facing changes (zero impact)

The owner-facing dashboard (`apps/web/src/pages/dashboard/*` and equivalent mobile screens):
- Floor plan: NO change — queries `reservations` directly, never sees holds.
- Reservation list: NO change.
- Analytics: NO change.
- All existing RPCs (`book_reservation`, `modify_reservation_slot`, `cancel-reservation`, etc.) unchanged.

The whole point of the separate `reservation_holds` table is that owner-side code keeps working without modification.

---

## Voice booking (Cenaiva)

`cenaiva-orchestrate` now forks on payment requirement when `CENAIVA_HOLDS_ENABLED=true`:
- **No-payment voice booking:** voice completes the booking directly via `book_reservation` (no hold needed since there's no payment window).
- **Payment-required voice booking:** voice creates a hold via `create_reservation_hold`, then responds with a hand-off URL `https://cenaiva.com/<slug>/checkout?hold=<id>`. The diner finishes on web with the timer already running.

Mobile voice (if/when added) should follow the same fork.

---

## Testing & rollback

- **Feature flag:** `CENAIVA_HOLDS_ENABLED` env var on Supabase project. Currently `true` in production. Set to `false` to revert to legacy flow (single-config rollback).
- **Backend smoke-tested:** all 6 new edge functions return correct responses. RPC chain (create → update_diner → update_cart → convert) verified end-to-end with `confirmation_code` matching between RPC return and DB row.
- **DB integrity:** advisor pass with 0 ERRORs, all WARNs resolved via security hardening migration (search_path fix + REVOKE EXECUTE FROM PUBLIC on hold RPCs).
- **Cron tested:** `expire-reservation-holds` HTTP endpoint returns 200, RPC returns count of expired rows.
- **Voice path tested:** `cenaiva-orchestrate` redeployed with `_shared/booking.ts` updates; existing voice tests pass.
- **Owner regression:** `book_reservation` legacy path still works; floor plan queries unchanged; `find_available_table_group` now sees holds (verified — a held table is excluded from the next call's result).

---

## Open follow-ups for mobile

1. **Stripe React Native:** pass `hold_id` when creating PaymentIntents. The web equivalent uses `PaymentElement` + `confirm-public-payment-intent` body.
2. **AppState heartbeat:** ensure the timer doesn't drift while app is backgrounded (recompute from `expires_at` on `'active'` event).
3. **Background fetch:** if the diner backgrounds the app for 30+ minutes, no need to do anything proactive — the cron expires the hold on its own. UI just needs to detect on resume that `expires_at < now()` and show the recovery sheet.
4. **Deep-link from voice hand-off:** if mobile handles `https://cenaiva.com/<slug>/checkout?hold=<id>` deep links, hydrate the hook from the URL `hold` param and skip auto-create on mount.

---

## File reference — what to mirror

| Web (already shipped) | Mobile target |
|---|---|
| `apps/web/src/hooks/useReservationHold.ts` | New hook in mobile, same API |
| `apps/web/src/components/booking/HoldTimerBanner.tsx` | New React Native component |
| `apps/web/src/components/booking/HoldExpiredDialog.tsx` | New React Native modal (`Modal` from RN) |
| `apps/web/src/pages/customer/RestaurantPublicPage.tsx` integration | Update the booking screens to instantiate the hook + render the banner + dialog |
| `apps/web/src/components/booking/StripePaymentForm.tsx` `holdId` prop | Pass `holdId` to Stripe RN integration when creating PaymentIntent |

Edge functions are server-side, so mobile just calls them — no client-side mirror needed. The same 6 new endpoints + 3 modified endpoints serve both web and mobile.

---

## Contact / debugging

- Production logs: `mcp__plugin_supabase_supabase__get_logs` with `type='edge-function'`.
- Hold inspection (admin only): `SELECT id, status, expires_at, party_size, guest_email FROM reservation_holds WHERE created_at > now() - interval '1 hour' ORDER BY created_at DESC;`
- Cron health: `SELECT count(*) FROM reservation_holds WHERE expires_at < now() - interval '5 min' AND status = 'active'` — should be 0 (cron is keeping up).
- Rollback: `supabase secrets unset CENAIVA_HOLDS_ENABLED --project-ref exbjodmnpdiayfzrdyux` (or set to anything other than `"true"`).
