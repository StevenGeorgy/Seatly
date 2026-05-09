# Mobile Backend Integration — Reference for the Mobile Claude Agent

**Audience:** the Claude agent wiring the Seatly mobile app frontend to this backend.
**Assumption:** the mobile app is mostly an empty scaffold. The backend is mature.
**Date:** 2026-05-09

This is the SHORT operational reference. For booking-specific data model, RPCs, status enums, and atomic-write contract, also read `cenaiva-database.md` at repo root.

---

## 1. Connection essentials

```
SUPABASE_URL          = https://exbjodmnpdiayfzrdyux.supabase.co
SUPABASE_ANON_KEY     = sb_publishable_i3_kEbKihLNgMfFsR6VN0Q_npEw-bNz
PROJECT_REF           = exbjodmnpdiayfzrdyux
REGION                = ca-central-1
POSTGRES              = 17.6.1
```

**Use the publishable (`sb_publishable_*`) key, not the legacy anon JWT.** The legacy JWT is disabled.

**Never embed the service-role key in the mobile app.** Service-role calls only happen from edge functions.

---

## 2. Auth — what the mobile app needs to wire

### Available flows

| Flow | Edge function | Verify-JWT | Notes |
|---|---|---|---|
| Email sign-up | none — Supabase Auth | n/a | Standard `supabase.auth.signUp()`. |
| Email sign-in | none — Supabase Auth | n/a | Standard `supabase.auth.signInWithPassword()`. |
| **Phone OTP login** | **`prepare-phone-login`** | false | Call this first to mint an OTP, then `supabase.auth.signInWithOtp()`. **Source not in repo** — verify against deployed code if behavior differs from expectation. |
| Restaurant-owner signup | `register-restaurant-owner` | false | Atomic create of auth user + user_profile + restaurant + initial shift. |
| Staff invite accept | `accept-staff-invite` | false | Token-based. |
| Host invite accept | `accept-host-invite` | true | Token-based. |
| Staff invite list | `get-my-staff-invites` | false | Returns pending invites for the logged-in user. |
| **Account deletion (GDPR)** | **`delete-account`** | true | **Source not in repo.** Mobile must call this for "Delete my account" UX. |

### Critical auth constraint (will hit you on launch)

**Auth max connections is capped at 10** at the Supabase project level. The advisor flagged this:

> "Project's Auth server is configured to use at most 10 connections. Increasing instance size won't improve Auth perf without switching to a percentage-based connection allocation strategy."

If 11+ users hit `signIn` simultaneously, the 11th waits or fails. Tell the human owner to flip auth pool to **percentage-based** in the Supabase dashboard before any big mobile launch.

### Session storage (mobile-specific)

- React Native: use `@react-native-async-storage/async-storage` as the storage adapter for `createClient`.
- iOS: persist via Keychain through the storage adapter; Supabase client handles refresh.
- Android: same pattern via EncryptedSharedPreferences.

### `auth.uid()` propagation

RLS policies depend on `auth.uid()`. The mobile client must always include the user's access token in the Authorization header for authenticated requests. The Supabase JS/RN client does this automatically.

---

## 3. Booking — atomic write path

**Read `cenaiva-database.md` § 3-5 for the full booking RPC contract.** Quick reference:

| What you want to do | Call | Notes |
|---|---|---|
| List restaurants | `from('restaurants').select(...).eq('is_active', true)` | RLS-restricted. Use the publishable key, not service role. |
| Get availability for one restaurant | `rpc('get_available_slots_cached', { p_restaurant_id, p_date, p_party_size })` | 20s TTL cache. First hit per (restaurant, date, party) is ~313ms; subsequent <10ms. |
| Get availability for many restaurants (batch) | `rpc('get_available_slots_for_restaurants_compact', { p_restaurant_ids, p_date, p_party_size, p_target_time? })` | Returns up to 6 slots per restaurant. **Use this for any list view; never per-row fetch.** |
| Get available dates for a calendar | `rpc('restaurant_available_dates', { p_restaurant_id, p_party_size, p_start_date, p_end_date })` | **Slow: ~1s avg.** Bound the range to 31 days max per call. Cache aggressively client-side. |
| Conflict windows for current diner | `rpc('reservation_diner_conflict_windows', { p_user_profile_id, p_date, p_timezone, p_exclude_reservation_id? })` | Returns the diner's overlapping reservations. **Render conflicting slots as DISABLED with a tooltip — don't silently filter.** |
| Create a booking | `POST /functions/v1/create-public-booking` | **Always go through this edge function. Never call `book_reservation` RPC directly from mobile.** |
| Modify a booking | `POST /functions/v1/modify-reservation` | Same atomicity contract. |
| Cancel a booking | `POST /functions/v1/cancel-reservation` | Sends notification on success. |

### Booking error codes you must handle

| Code | Meaning | Mobile UX |
|---|---|---|
| `409 unavailable_reason: "slot_taken"` | Two diners raced; the other won | "This time was just taken. Pick another slot." Refetch availability. |
| `409 unavailable_reason: "over_cover_cap"` | Shift filled up | "This shift no longer has capacity for your party size." |
| `409 unavailable_reason: "diner_double_book"` | Same diner has overlapping reservation | "You already have a reservation at this time. Cancel/modify the existing one first." |
| `409 unavailable_reason: "closed"` | Restaurant closed for that date | Show the closure label if returned. |
| `400 unavailable_reason: "missing_identifier"` | No name/email/phone provided | "Please enter your name, email, or phone." |
| `429 unavailable_reason: "rate_limited"` | 20 booking attempts/min/IP exceeded | "Too many attempts. Wait a moment." |

---

## 4. Voice (Cenaiva) — the four-stage pipeline

The mobile voice assistant should mirror the web's pipeline. **Web's `AssistantProvider.sendTranscript` is the canonical implementation** — see `apps/web/src/components/cenaiva/AssistantProvider.tsx`.

### Stages (in order, with kill-switch behavior)

1. **Local turn planner** (`planLocalBookingTurn`) — pure TS, ~0-50ms. Handles missing-field prompts, ambiguous-time disambiguation, pending-option picks. **Most utterances stop here without a network call.**
2. **Availability fast-path** (`POST /functions/v1/cenaiva-availability`) — ~200-800ms. Plays cached "One moment please." while in flight. 20s `AbortController` timeout.
3. **Small-prompt fast-path** (`POST /functions/v1/cenaiva-small-prompt`) — ~400-1500ms. Off-topic Q&A. 8s timeout. Skipped on confirmation replies.
4. **Orchestrator** (`POST /functions/v1/cenaiva-orchestrate`) — ~1.5-8s SSE. Full LLM tool loop. Carries `recommendation_mode` + `assistant_memory`.

### Voice stack edge functions

| Function | Purpose | Verify-JWT |
|---|---|---|
| `cenaiva-orchestrate` | LLM tool loop (Stage 4) | true |
| `cenaiva-availability` | Slot lookup (Stage 2) — **source not in repo, deployed only** | true |
| `cenaiva-small-prompt` | Off-topic Q&A (Stage 3) — **source not in repo, deployed only** | true |
| `cenaiva-chat` | Text-only chat fallback | false |
| `elevenlabs-tts` | TTS synthesis | true |
| `deepgram-live-token` | Mints a short-lived STT token | false |

### Voice-specific rules (HARD)

- **`voice_id` goes ONLY to `/elevenlabs-tts` and `/cenaiva-small-prompt`. NEVER include `voice_id` on `/cenaiva-orchestrate` requests.** The orchestrator returns text and the client picks the timbre.
- **Per-user voice picker:** persist to `user_profiles.cenaiva_tts_voice` (text col, nullable). Mobile equivalent of the web's `useCenaivaVoicePreference`.
- **TTS cache:** persistent KV cache keyed on `flash25-mp3-44100-128-v1-${djb2(voiceId+":"+normalizedText)}`. Web uses IndexedDB; mobile should use AsyncStorage or a small SQLite KV table. Bump the version suffix when upstream codec changes.
- **Wake word recognizer:** see `apps/web/src/hooks/useCenaivaWakeWord.ts`. **Do NOT port this verbatim — Web Speech API is browser-only.** Use Picovoice Porcupine or platform-native wake-word detection on mobile. The principles (one mic owner at a time; mute during TTS playback) carry over.
- **`NO_AUTO_RELISTEN_STATUSES`:** the mic must NOT auto-reopen during checkout/tip/payment flows. Statuses: `offering_preorder`, `browsing_menu`, `reviewing_cart`, `choosing_tip_timing`, `choosing_tip_amount`, `choosing_payment_split`, `charging`, `paid`, `post_booking`.
- **Mobile-shaped helpers (already exist in `apps/web/src/lib/cenaiva/`):** these were ported from mobile and kept verbatim. Re-port them back to mobile from the same files; do NOT modify their internals. Bridge schema drift at the call site (see `restaurantAdapter.ts:toCollectorRestaurant`).

---

## 5. Payments (Stripe)

| Function | Purpose | When mobile uses it |
|---|---|---|
| `stripe-setup-intent` | Attach a card to the user's Stripe customer | "Save card" flow before booking deposits ship |
| `stripe-list-methods` | List the user's saved cards | Payment method picker |
| `stripe-charge-order` | Charge a saved card for an `orders.id` | Preorder checkout |

**Phase 3 deposits are NOT built yet.** When they ship, mobile sequence will be: SetupIntent → `book_reservation(pending_deposit)` → `stripe-charge-deposit`. Do NOT charge before booking; the slot must be locked first.

Use the Stripe React Native SDK (`@stripe/stripe-react-native`) for paymentSheet flows — bridges to native Apple/Google Pay automatically.

---

## 6. Realtime — subscribe these 8 tables, no others

The `supabase_realtime` publication includes:

```
chat_messages          ← Cenaiva voice/chat history
notifications          ← inbox badges
order_item_modifiers   ← cart modifications
order_items            ← cart line items
orders                 ← payment status / order lifecycle
reservations           ← booking lifecycle (most important)
tables                 ← floor plan changes (staff app)
waitlist               ← waitlist position
```

### Subscription pattern

```ts
// One channel per restaurant, server-side filtered. NEVER one channel per row.
const channel = supabase
  .channel(`reservations:${restaurantId}`)
  .on("postgres_changes", {
    event: "*", schema: "public", table: "reservations",
    filter: `restaurant_id=eq.${restaurantId}`,
  }, (payload) => { /* refetch */ })
  .subscribe();
```

### Connection budget (HARD)

- One channel per UI surface, not per row. Don't open a channel per restaurant card on a list view — that's a connection storm.
- Realtime slots are shared with auth + db connections on Micro tier. **Close subscriptions on screen unmount.**
- Background app lifecycle: subscriptions die when iOS/Android puts the app to sleep. Don't trust them to survive backgrounding; refetch on `AppState.active`.

---

## 7. Storage buckets

The platform has storage buckets for restaurant logos, cover photos, event/promotion media, menu items, and floor plan thumbnails.

### Mobile pattern

- **Always use direct object URLs.** Format: `${SUPABASE_URL}/storage/v1/object/public/<bucket>/<path>`.
- **NEVER call `supabase.storage.from(bucket).list(...)`.** The advisor flagged the `event-media` bucket as listing-enabled — this is a known issue being fixed. Don't depend on listing for app logic.
- For uploads (e.g. owner-side restaurant photo), use signed upload URLs minted server-side, not direct mobile uploads with the anon key.

---

## 8. Server-side rate limits (what mobile must back off from)

The `_shared/rate-limit.ts` helper enforces rate limits per `(scope, identifier)` via `check_rate_limit` RPC. Active scopes:

| Scope | Limit | Window | Identifier |
|---|---|---|---|
| `book` | 20 | 60s | user_id or IP |
| (others vary by edge function — check each function source) |

On 429, the mobile client should:
1. Show a friendly toast.
2. Back off exponentially (start 1s, double up to 30s).
3. Never auto-retry without user interaction beyond the first retry.

---

## 9. RPCs the mobile app should call directly (read-only)

These are safe to call from the client with the publishable key. Each is `SECURITY DEFINER` so RLS doesn't apply inside the function body — but the function checks `auth.uid()` itself where needed.

| RPC | Returns | Use case |
|---|---|---|
| `get_available_slots_cached` | `{ slots, floor_capacity, message, unavailable_reason, timezone }` | Single restaurant availability |
| `get_available_slots_for_restaurants_compact` | `[{ restaurant_id, slots[6] }, ...]` | Batched list view |
| `restaurant_available_dates` | `text[]` of YYYY-MM-DD | Calendar disabled-dates |
| `restaurant_floor_capacity` | int | Max party size |
| `restaurant_turn_time_minutes` | int | Default reservation duration |
| `canonical_guest_id` | uuid | Find or pick guest row by email/phone |
| `restaurant_public_reviews` | jsonb[] | Review feed |
| `restaurant_review_summaries` | jsonb | Aggregate rating |
| `check_rate_limit` | boolean | Don't call this client-side; called from edge functions only |

**RPCs the mobile app must NEVER call directly** — go through the edge function:
- `book_reservation` → `/functions/v1/create-public-booking`
- `modify_reservation_slot` → `/functions/v1/modify-reservation`
- `create_staff_reservation` → only from staff/dashboard surfaces, not customer mobile

---

## 10. Schema fields mobile will need to know

### `restaurants`
- `id, name, slug, cuisine_type, city, area, timezone, currency, tax_rate`
- `is_active` — RLS visibility gate. Inactive restaurants don't show.
- `hours_json` — operating hours + special-day overrides (closures, holidays). Schema: `{ monday: {open, close, closed?}, ..., special: [{ startDate, endDate, label, closed, from, to }] }`.
- `deposit_policy_json` — placeholder, all rows default `{requires_deposit: false}`. Phase 3 future use.
- `settings_json.turnTimeMinutes` — overrides shift default.
- `latitude, longitude` — for distance calculations on mobile (use PostGIS or compute client-side).
- `cover_photo_url, logo_url` — direct URLs, no signing needed.

### `reservations`
- `status` enum: `pending → confirmed → seated → completed | cancelled | no_show`. Phase 3 will add `pending_deposit` between pending and confirmed.
- `slot_range` (tstzrange, trigger-set, GiST-indexed) — used by exclusion constraints. Don't write to it directly.
- **Identifier requirement (HARD):** every row must have at least one of `user_profile_id`, `guest_email` (non-empty), or `guest_phone` (digits-only non-empty). Enforced by `reservations_must_have_identifier` CHECK + `book_reservation` early raise (P0007). `guest_id` alone is NOT enough.
- `confirmation_code` — 8-char auto-generated token. Used for unauthenticated cancel/modify (`confirmation` query param flow).
- `source` enum-like: `web | cenaiva | dashboard | app | staff`. Mobile customer should send `app`. Voice should send `cenaiva`.
- `duration_minutes` — copied from shift turn-time at insert time. The trigger maintains `slot_range` from `reserved_at + duration_minutes`.

### `user_profiles`
- `id, auth_user_id, full_name, email, phone, allergies, dietary_restrictions, seating_preference, noise_preference`
- `cenaiva_tts_voice` — text, nullable. Per-user ElevenLabs voice ID.
- `is_blocked` — server-set; if true, RLS hides the user's data.

### `guests`
- One row per (restaurant, contact identity) pairing. NOT auth users.
- `duplicate_of` — soft dedup pointer; `canonical_guest_id` RPC follows it.
- `dietary_restrictions, allergies, vip, lifetime_value, last_visit_at` — CRM-style annotations.

### `availability_cache`, `rate_limit_buckets`
- **Don't query directly.** RLS denies all. Only the SECURITY DEFINER RPCs touch them.

---

## 11. Things known to be slow / cached / quirky

| Thing | Latency | Note |
|---|---|---|
| First availability fetch per (restaurant, date, party) | ~313ms | Cold cache path. Subsequent hits within 20s are <10ms. |
| `restaurant_available_dates` (calendar fetch) | ~1050ms | Slowest RPC on the platform. Bound to a single month per call. Cache the result client-side for the visible month. |
| `book_reservation` write | ~340-470ms | Includes advisory lock + table search. Acceptable. |
| `cenaiva-availability` edge fn cold start | ~500-800ms | Subsequent warm calls ~200ms. Pre-warm by calling on app launch. |
| `cenaiva-orchestrate` SSE | 1.5-8s | LLM tool loop. Show "thinking" indicator. Use the cached "One moment please." filler. |

---

## 12. DO NOT touch list (HARD rules from `CLAUDE.md`)

- **NEVER bypass `book_reservation` or `modify_reservation_slot`** for reservation writes. They own the advisory lock + cover-cap recheck + diner-overlap pre-check.
- **NEVER cache booking writes.** The atomic RPC + exclusion constraint own correctness.
- **NEVER call the Anthropic API directly from the mobile client.** Edge functions only.
- **NEVER include `voice_id` on `/cenaiva-orchestrate` requests.**
- **NEVER reduce `NO_AUTO_RELISTEN_STATUSES`.** The mic must NOT auto-reopen during checkout/tip/payment.
- **NEVER store the service-role key on the client.**
- **NEVER use `localStorage.getItem` or `localStorage.setItem` directly** — RN doesn't have it. Use AsyncStorage. (Web's localStorage references in shared helpers should be wrapped on mobile.)

---

## 13. Things the backend is missing or known-quirky (mobile dev should know)

- **Phase 3 deposits not built.** When mobile design calls for deposit collection, surface "coming soon" or feature-flag. The schema has `reservations.deposit_amount` / `deposit_status` columns but no consumer code today.
- **`advance_booking_days` is set to 3650 (10 years)** globally. Mobile UI shouldn't artificially cap dates below that.
- **Staff-flow opaque error:** `create_staff_reservation` raises raw 23514 instead of friendly P0007 when staff submit without a name+email+phone. Mobile customer flow doesn't hit this — only staff-side does.
- **5 edge functions deployed but not in repo:** `cenaiva-availability`, `cenaiva-small-prompt`, `delete-account`, `prepare-phone-login`, `register-restaurant-owner`. If their behavior surprises you, the live deployed code is the source of truth — pull it via `supabase functions download <name>` to inspect.
- **42 migrations applied to live but not in `supabase/migrations/`.** If a column or function exists in production but isn't in the schema, treat the production schema as authoritative.
- **Auth pool capped at 10 connections.** Sign-in storm on launch will be the first thing to break — back off and retry on auth errors.
- **Realtime budget shared with auth + db connections on Micro.** Mobile launch likely needs Large compute (8 GB) to avoid contention.

---

## 14. Reference docs (in repo root)

| File | What it covers |
|---|---|
| `cenaiva-database.md` | Schema + RPCs + edge functions + status enums + RLS layout + error codes + a Part-B checklist for implementing booking on a new client. **Read this first for the booking flow.** |
| `CLAUDE.md` | Hard rules + existing patterns + lessons learned. The mobile agent should follow the same hard rules where applicable. |
| `LAUNCH_PLAN.md` | Public-launch playbook. Mobile launch will follow the same compute-upgrade and monitoring pattern. |
| `WORK_LOG.md` | Chronological history of decisions. Useful for "why was X done this way" questions. |
| `CONCURRENCY_PLAN.md` | Capacity ceiling + scaling decisions. |
| `SPEED_PLAN.md` | Per-user latency phases. |
| `PERFORMANCE_PATTERNS.md` | Portable patterns (batched RPC, UNLOGGED cache, advisory locks). |

---

## 15. The minimal "first integration" milestone

If the mobile app is empty and the agent is starting fresh, ship in this order:

1. **Auth wiring** — sign-up, sign-in, session persistence to AsyncStorage.
2. **Restaurant list** — `from('restaurants').select(...).eq('is_active', true)`.
3. **Single-restaurant availability** — `get_available_slots_cached` + a basic 6-pill picker mirroring `<AvailabilityPanel>`.
4. **Booking write** — POST to `/functions/v1/create-public-booking`. Handle the 7 error codes in §3.
5. **My bookings** — `from('reservations').select(...).eq('user_profile_id', profile.id)`.
6. **Realtime** — one `reservations` channel filtered by `user_profile_id` so the bookings list updates live.

Stop there for V1. Voice (Cenaiva), modify, cancel, deposits, staff features, deep-linking — all V2+.

---

## When in doubt

Stop and ask. The web client (`apps/web/`) is the canonical reference for what the backend expects. If something contradicts this doc or `cenaiva-database.md`, the docs are right until proven otherwise — but do verify against the live deployed edge function source via `supabase functions download <name>`, since deployed code can drift from the repo.
