# CLAUDE.md — agent guardrails for Seatly

Auto-loaded by Claude Code (and `AGENTS.md` for Codex). Read this before
touching code. The longer plans (`CONCURRENCY_PLAN.md`, `SPEED_PLAN.md`,
`WORK_LOG.md`) are the durable source of truth — this file is only the
short ruleset that points to them.

## Keep this file fresh — it's part of every task

If a task you complete changes any of the headline numbers, hard rules,
existing patterns, or open follow-ups in this file, **update this file
in the same change** before reporting the task done. Same goes for
`WORK_LOG.md` and the relevant long plan (`CONCURRENCY_PLAN.md` or
`SPEED_PLAN.md`). Stale rules are worse than no rules.

Concrete triggers that require an update:
- Shipping a new phase, RPC, migration, or pattern.
- Changing the concurrent-user ceiling, latency numbers, or compute tier.
- Declining a previously-considered approach (record the decision +
  revisit criteria).
- Adding or removing a hard rule.
- Renaming or deprecating an existing pattern listed below.

If a task does NOT touch any of those, no update is needed — don't
churn the file. Codex sees this file via the `AGENTS.md` symlink, so
edits here propagate to both agents in one step.

## Headline state (2026-05-13)

- **17-capability /goal verification pass (v304–v309, 2026-05-13 late
  evening).** End-to-end Chrome MCP run against Mark's real account
  verified every Hey Cenaiva capability. Six orchestrator deploys + two
  client-side files touched. Confirmed reservations in DB (book / modify
  / cancel; event-linked FF2155CC, promo-linked E8D045FC). New bugs
  found and fixed:
  - **v304 — Events query phrasing widened.** Old regex matched only
    "events at X". Now also matches "what events ARE at X", "events
    happening at X", "show me events at X", "what's happening at X".
    File: `cenaiva-orchestrate/index.ts:5430` (factLookupMatch events
    patterns). Test phrase "what events are at jacobs" now returns
    "Jacobs & Co. Steakhouse has 2 events coming up — Wagyu Masterclass…
    Beaune Burgundy…" instead of "Looks like Jacobs & Co. Steakhouse.
    That's the spot?".
  - **v305 — Modify regex + restaurant-name disambig.** (a) Target-word
    regex widened to allow 0-3 word adjective between "my/the" and the
    noun, so "change my jacobs reservation to 7pm" matches. File:
    `cenaiva-orchestrate/index.ts:6449`. (b) When user has multiple
    active reservations and the transcript names a restaurant, narrow
    to that restaurant before the active.length==1 branch fires.
    `cenaiva-orchestrate/index.ts:6461-6485` (filteredByName logic with
    accent-strip + token-score). (c) Client-side mirror in
    `apps/web/src/lib/cenaiva/localBookingCollector.ts:862-873` —
    Stage 1 must `pass` modify/cancel verbs to the orchestrator, else
    Stage 1's missing-fields prompt fires on "change my X reservation
    to 7pm" because "7pm" makes hasLocalBookingDetail=true.
  - **v306 — Cancel handler gated on reservationId.** Old code: cancel
    early-handler at line 6415 fired with "I can help cancel, but I
    need the reservation details first." even when no reservationId
    was present, BLOCKING the no-reservation-in-state handler at line
    6446 that does the proper active-reservation lookup. Fix: require
    `reservationId &&` so the early handler only handles the
    in-flight case. `cenaiva-orchestrate/index.ts:6415-6437`.
  - **v307 — Deposit hand-off on casual path.** The casual handler's
    early-confirm at line 6136 called `completeBooking` directly with
    no deposit check, silently booking parties≥8 at Mark Testing for
    $0 (should be $80). Fix mirrors the LLM tool branch at line 9159:
    call `compute_deposit_for_party`; if depositCents>0, navigate to
    `/<slug>?date=&time=&people=&shift_id=` + close_assistant, with
    spoken reason "Parties of N need a $X deposit at <name>. Opening
    the booking page so you can add your card."
    `cenaiva-orchestrate/index.ts:6134-6184`.
  - **v309 — Pre-order intent hand-off.** New deterministic handler at
    the top of `buildPreflightResponse` (before casual booking patterns)
    that detects "pre-order food", "order ahead", "order food in
    advance", etc. Fuzzy-resolves restaurant from transcript (or uses
    booking_state), then navigates to `/<slug>?date=&time=&people=&step=menu`
    + close_assistant. Spoken reason: "Pre-orders need the menu page
    at <name>. Opening it now so you can pick dishes." File:
    `cenaiva-orchestrate/index.ts:4640-4700`. Lives inside
    `buildPreflightResponse` so only `bookingState`, `selectedRestaurantId`,
    and `opts.timezone` are in scope (NOT `currentRestaurantId` —
    that's in the outer handler).
  - **Dev-only test bridge (does NOT ship to prod).** Two
    `import.meta.env.DEV` guards added to enable headless harness-free
    testing: (1) `apps/web/src/components/cenaiva/AssistantProvider.tsx`
    exposes `window.__cenaivaTest = { send, open, close, getState,
    getSpoken, setTextMode }`. `send(transcript)` awaits the full
    Stage 1→4 pipeline and returns the spokenText + booking state.
    (2) `apps/web/src/hooks/useCenaivaVoice.ts` `speak()` returns
    early when `window.__cenaivaSilenceTTS = true` so test turns
    don't block on ElevenLabs audio playback.
- **Voice modify cross-session fixed (v301–v303, 2026-05-13).** Three-deploy
  fix for the modify handler at `cenaiva-orchestrate/index.ts` lines
  6440-6494 (the "modify/cancel verb with NO active reservation in
  booking_state" branch). Problem: when a user closed the assistant after
  booking and reopened it, then said "change my reservation to 8pm", the
  orchestrator replied "You don't have any active reservations to change"
  even though the reservation existed in the DB.
  Root cause was three layered gaps:
  1. The target-word regex at line 6443 required `it|that|the booking|the
     reservation` but DID NOT match `my booking|my reservation|my table|
     etc`. So the deterministic handler never fired for natural phrasings
     like "change **my** reservation to 8pm". The transcript fell through
     to the LLM tool flow, which hallucinated "no reservations on file"
     instead of calling `list_my_reservations`.
  2. Even when the regex matched, the handler at line 6470 only promoted
     `reservation_id + restaurant_id + restaurant_name` into booking_state.
     It did NOT promote `date / time / party_size / shift_id` from the
     reservation row, so subsequent modify turns (`if (currentRestaurantId
     && newDate && newTime && newParty != null)`) failed because
     newParty/newDate were null and the handler fell into "What date and
     time?" — confusing, since the user already provided a time.
  3. When the user named a new time in the SAME utterance as the modify
     verb ("change my reservation to 8pm"), the handler still asked "what
     day?" and then the LLM took over via `modify_reservation` tool —
     which only updates `special_request` text, not the actual slot. The
     reservation stayed at 7pm with a stale `special_request: "Change time
     to 8 PM"` note attached.
  Fixes applied as three small deploys:
  - **v301**: widened the target-word regex to also match
    `my\s+(?:booking|reservation|table|rez|res|dinner|date|time|party|
    spot|sitting)` and `the\s+(?:booking|reservation|table|...)`. Plus
    added `make\s+it|set\s+it` to the verb regex.
  - **v302**: the handler's SELECT now pulls `party_size, shift_id,
    restaurants(name, timezone)`. It computes `reservedDate` via
    `formatISODateInTimeZone` and `reservedTime` via `Intl.DateTimeFormat
    ({ timeZone, hour: '2-digit', minute: '2-digit', hour12: false })`,
    then promotes all of `date / time / party_size / shift_id` into
    booking_state.
  - **v303**: when `parseTime(transcript)` returns a new time AND
    `partySize` is known, the handler immediately calls
    `getAvailability(restaurant_id, reservedDate, partySize)` +
    `findNearestSlot(slots, requestedTime)`. If a slot is available, it
    queues `pending_action: { type: "modify_reservation", payload: {
    reservation_id, restaurant_id, party_size, date, time:
    slot.display_time, shift_id, slot_iso } }` directly. User says
    "yes" → `confirmPendingAction` → `modify_reservation_slot` RPC.
    Single-turn modify works. Cancel verbs follow the same pattern with
    `type: "cancel_reservation"`.
  Verified end-to-end in Chrome with Mark's real account:
  - "book mark testing for 2 friday at 7pm" → "yes confirm" → "yes" →
    confirmation BEA10E83 (DB confirmed).
  - Closed assistant, reopened. "change my reservation to 8pm" → "Want
    to move your Mark Testing booking from 7:00 PM to 8:00 PM on
    2026-05-15? Say yes." → "yes" → "Done, the change is in." DB
    `reserved_at` moved from `2026-05-15 23:00 UTC` to `2026-05-16 00:00
    UTC` (= 8pm local). ✓
  - "cancel my reservation" → "Just confirming: cancel your reservation
    at Mark Testing?" → "yes" → "Got it, that booking's cancelled." DB
    status=cancelled, reason="Cancelled via Cenaiva". ✓
- **CRITICAL — harness uses Mark's real account (2026-05-13).** The
  `harness_cleanup_test_user` RPC (defined in production) hardcodes
  `user_profile_id = 'de3fbe5e-0c7f-4d35-93f5-eaa2e0910209'`. That UUID
  is Mark Habbi's actual user_profiles.id (auth_user_id is
  `513676ec-...` but profile.id is `de3fbe5e-...` — they're not the
  same). So every harness run cancels Mark's real future
  reservations — 368 of them just from tonight's overnight cycles.
  **Do not run the harness against the live project** until this is
  fixed. The Plan agent's "B7 passes / B8 fails is a concurrency-race"
  diagnosis was correct in principle but the specific cancel pattern
  came from this cleanup RPC nuking the just-booked reservation 15–100
  ms after creation. Fix path: change `cleanupReservations()` in
  `apps/web/scripts/cenaiva-test-harness.mjs` to call a new
  `harness_cancel_by_ids(p_ids uuid[])` RPC scoped to the
  `CREATED_RESERVATIONS` map (already tracked client-side). Add the
  RPC with `WHERE id = ANY(p_ids) AND user_profile_id = 'de3fbe5e-...'`
  for safety. Until that lands, no harness runs.
- **Voice-side flows verified working in real browser (2026-05-13).**
  Beyond book/modify/cancel above:
  - **Promos query** — "any deals at harbour sixty" → "Harbour Sixty
    Steakhouse has 2 active promos — Three-Course Tasting Menu (code:
    TASTING95); Industry Night — 20% Off (code: INDUSTRY). Want me to
    book you a table?" ✓
  - **Joke / off-topic** — "tell me a joke" → "I'm more of a dinner date
    than a joke-teller, but I promise I've got a great table waiting!
    Want to pick a spot?" ✓ (on-brand persona redirect)
- **Known voice-side gaps (carry to tomorrow, 2026-05-13):**
  - **Events handler too narrow.** "what events are at Harbour Sixty"
    returns the restaurant card with "Found Harbour Sixty Steakhouse —
    that the one?" instead of listing the 2 active events. The
    fact-lookup events branch doesn't match this phrasing. Fix in the
    events handler regex (likely `factLookupMatch` or the events fact
    branch).
  - **Deposit hand-off doesn't fire on casual booking path.** Party of
    8 at Mark Testing (deposit tier kicks in at min_party_size=8,
    $10/person → $80 deposit) routes through the casual handler →
    "yes confirm" → directly calls `completeBooking` and fails with
    `promotion_not_available` instead of redirecting to the public
    restaurant page with deposit prefill. The CLAUDE.md pattern below
    documents the hand-off as living in the LLM tool `complete_booking`
    branch (~line 6470) and the post-loop auto-finalize path (~line
    7103). The casual handler at the confirm-pending-action step needs
    the same `compute_deposit_for_party` check before calling
    `completeBooking`.
  - **Pre-order hand-off** — likely affected by the same gap as
    deposit; untested in this session but lives in the same code path.
  - **Mid-flow change-of-mind ("actually nevermind", "wait change to 5
    people")** — untested in this session.

## Headline state (2026-05-12)

- **Casual handler — single-utterance slot resolution (2026-05-12,
  orchestrator v292).** When `bookReservePattern` / `wantToGoPattern` /
  etc match AND the same utterance includes party + date + time
  ("book mark testing for 2 thursday at 7pm"), the casual handler now
  calls `getAvailability(restId, inferredDate, inferredParty)` and
  matches the requested `time` against returned `display_time` slots.
  On a match it populates `shift_id` + `slot_iso` and flips
  `booking.status` to `confirming` + `step` to `confirm`. Without
  this, the follow-up "yes confirm" turn bailed at the confirmation
  handler with "I need the reservation details again. What date and
  time?" — fixed harness Group A regression A1–A10. Logic at
  `cenaiva-orchestrate/index.ts:4720-4775`.
- **Granular missing-field phrasing in casual handler (2026-05-12,
  v290).** When only one field is missing, ask for just that field —
  not the catch-all "What date and time?": all fields + slot resolved
  → "Confirming?"; all fields, slot not resolved → "Let me check
  availability."; missing party + date + time → "How many, and when?";
  missing party only → "How many guests?"; missing date + time →
  "What date and time?"; missing date only → "What date?"; missing
  time only → "What time?". Judge finding: "Dinner for 4 at STK
  Toronto tomorrow night" extracts date but vague time, was asking
  "what date and time?" which clobbers the date the user gave.
- **Colloquial party-size words (2026-05-12, v290).** `parsePartySize`
  `peopleMatch` regex extended to `amigos|pals|peeps|mates|buddies|
  friends|dudes|guys|chicas|gals|gents|fellas` alongside the existing
  `people|guests|ppl|pax|persons|heads|of us|adults`. Judge finding:
  "book mark testing for two amigos thursday at 7pm" was returning
  party=null because "amigos" wasn't in the noun list. Also: the
  casual handler now delegates to `parsePartySize(transcript)` instead
  of an inline digit-only regex, so it picks up `couple`, `couple of
  us`, `half a dozen`, `dozen`, `me and N others`, `the both of us`,
  `myself and one other`, etc. Range 1-99 enforced.
- **Event-theme filter in fact-lookup events handler (2026-05-12,
  v291).** Old behavior: "wagyu wednesday at jacobs" returned all 3
  upcoming events at Jacobs (Wagyu Masterclass + Beaune Burgundy + …).
  New: 24 theme keywords (wagyu/wine/live music/trivia/karaoke/comedy/
  dj/prix fixe/tasting/burgundy/champagne/whiskey/rib/industry/brunch/
  happy hour/jazz/salsa/country/rock/pairing/chef) match the
  transcript; when matched, the events query is filtered with
  `.or("name.ilike.%theme%,theme.ilike.%theme%")`. Empty result
  themed: "No wagyu events scheduled at Jacobs right now."
- **Deals routing widened + scope-checked (2026-05-12, v291/v294).**
  `globalAnswerCandidate` deals pivot now catches `any deals / promos /
  promotions / specials / offers / discounts / coupons` (was only
  `any deals?`). 4 randomized spoken_text variants ("Opening the deals
  page now.", "Sure — pulling up active deals.", "Here come the
  deals.", "Taking you to the deals page."). Scope check
  `dealsHasAtRestaurant` broader to avoid hijacking restaurant-scoped
  queries: catches `at|in|near|for|from <name>`, `does <name> have`,
  `<name>'s deals`, and `promo code`. Harness V8 regression: "does
  georgy inc have any specials" was being navigated to /deals instead
  of falling to the per-restaurant fact-lookup.
- **Hours-question handler reads hours_json (2026-05-12, v293).** The
  fact-lookup handler's hours branch (`/\bopen\b|\bhours\b|\bclose[ds]?
  \b|\bwhat time/`) used to deflect with "I'd need to pull up live
  hours for X — want me to check availability for a specific date?".
  Now reads `hours_json` directly. Shape: `{ monday: {open, close}|
  null, ... }`. Day inference: weekday name from transcript → that
  day; otherwise today in restaurant tz. Replies "Restaurant is open
  11:00 AM–10:00 PM on Tuesday. Want me to book a table?" or
  "Restaurant is closed on Sunday. Want to try a different day?". Also:
  factLookupMatch's `stateRestaurantName` shortcut now matches
  `your` (in addition to `the/their/its`) and catches `what time do
  they open/close` + `are they open/closed` patterns.
- **Modify-confirm pending_action without rid — fallback resolver
  (2026-05-12, v293).** `confirmPendingAction` used to dead-end with
  "I can't update that reservation from here yet. Please open the
  reservation details." when the queued pending_action had no
  reservation_id. Now: queries the user's active future reservations.
  If exactly one → use it. If multiple → "You have a few active
  bookings — which one should I update?". If none → "You don't have
  any active reservations to change. Want to book a new one?" 3 judge
  findings tonight on bare "yes" replies landing in this branch.
- **Harness final 280/281 (99.6%, 2026-05-12, v294).** Up from 219/281
  (78%) at iter21. The single remaining "fail" is P9: a 4-turn
  multi-booking sequence (book + confirm + book again + confirm) that
  exceeds the harness's 10s/call timeout. Edge function logs show all
  200s; the orchestrator served every request — the harness gave up
  waiting. Test-infra limit, not a real bug.

## Hard rules — never violate

- Never bypass `book_reservation` or `modify_reservation_slot` for
  reservation writes. They own the advisory lock + cover-cap recheck +
  diner-overlap pre-check. Direct INSERTs also fail the partial
  exclusion constraints, but the error is opaque (`23P01`) — always go
  through the RPCs so users see `P0006 / diner_double_book` instead.
- Never cache booking writes. The atomic RPC + exclusion constraint own
  correctness; cached writes break that.
- Never re-introduce `COALESCE(s.max_covers, 100)` in any reservation
  RPC. NULL means "no cap" (2026-05-10 cover-cap removal). Gate the
  cover-cap check on `IF v_max_covers IS NOT NULL THEN ...`. The
  default-to-100 pattern silently throttled real restaurants; reverting
  it would re-introduce that bug.
- Never insert into `reservation_deposit_payments` outside of the
  `prepare-deposit` edge function. The table has RLS that allows only
  service-role writes — direct client inserts will be rejected. The
  settle trigger that flips reservations to 'confirmed' fires only on
  rows it manages, so writing rows from random places breaks the state
  machine.
- Never deploy `confirm-deposit-stub` to production without flipping
  `DEPOSIT_STRIPE_STUB_MODE=false`. The stub flips deposits to 'charged'
  with no real money movement — leaving it on in prod would mean every
  customer gets a free deposit waive. Search `// STRIPE STUB` to find
  every spot the future real-Stripe wiring must replace.
- Never create migrations or run `DROP` / `DELETE` on the live project
  without explicit instruction.
- Never run `tmp-e2e/concurrent-booking.mjs` unmodified — it jams the DB
  pool at small compute tiers. Drop N to ≤ 5 if you must.
- Never bypass git pre-commit hooks (`--no-verify`) or migration order.
- Never write Supabase queries in components. Hooks only, in
  `apps/web/src/hooks/`.
- Never call the Claude/Anthropic API from the client. Edge Functions
  only.
- TypeScript strict — never use `any`.
- Never modify `apps/web/src/hooks/useCenaivaWakeWord.ts`. The recognizer
  works perfectly; touching it has historically broken Chrome's "one
  SpeechRecognition holds the mic" rule. Verify on every PR:
  `git diff --exit-code -- apps/web/src/hooks/useCenaivaWakeWord.ts`
  must be empty.
- Never bypass `planLocalBookingTurn` for booking-collection turns. It
  owns missing-field prompts, ambiguous-time disambiguation, and
  pending-option picks. Bypassing pushes those turns into the
  orchestrator's 5–35s tool loop.
- `voice_id` goes only to `/elevenlabs-tts` and `/cenaiva-small-prompt`.
  NEVER include `voice_id` on `/cenaiva-orchestrate` requests — the
  orchestrator returns text and the client picks the voice timbre.
- `NO_AUTO_RELISTEN_STATUSES` covers ONLY `paid` (since 2026-05-10).
  Voice never enters preorder/menu/checkout statuses — those are now
  hand-offs to the public restaurant page. Don't add other statuses
  back in unless you also revert the hand-off pattern. The mic also
  blocks when AI TTS is active (`voice.speak()` stops the recognizer)
  and when the user manually mutes via `voice.toggleMute()`.
- Mobile-shaped helpers under `apps/web/src/lib/cenaiva/` stay verbatim
  against mobile. Bridge schema drift at the call site (e.g.
  `toCollectorRestaurant` in `restaurantAdapter.ts`); editing helper
  internals to match web's snake_case breaks future mobile cherry-picks.
- **Self-service restaurant signup is open by design.**
  `signup-restaurant-owner` defaults `is_active=true`; new restaurants
  land customer-visible immediately. The activation gate WILL move to a
  Stripe paywall (planned, not built). Until that lands, do NOT add an
  admin-approval flow, `is_test` column, or any default-`false` change
  to the signup edge function. "Mark Testing"
  (`aaa5e3d3-d8f2-4bae-8615-dc4e6ea83d2c`) is an intentional live row.

## Before adding any feature with a backend call — checklist

Run through this every time. Skipping it is how the original ceiling
problems came back into the codebase.

1. **Per-row fetches in a list?** → Batch the RPC. Pattern:
   `get_available_slots_for_restaurants_compact(uuid[], …)`.
2. **Reads the same data repeatedly within seconds?** → Cache it.
   Pattern: UNLOGGED cache table + wrapper RPC, see Phase 10a.
3. **Writes something users could spam?** → Rate-limit it. Pattern:
   `enforceRateLimit(client, scope, identifier, { limit, windowSeconds })`.
4. **Queries a new column or new pattern?** → Add an index in the same
   migration that ships the feature.
5. **Opens a long-lived connection** (Supabase realtime, websockets)?
   → Reconsider. Polling is usually fine and doesn't eat the pool.
6. **Adds a new edge function?** → Identify auth (Bearer / confirmation
   code / service-role) explicitly and rate-limit it.

## Existing patterns to reuse

- **Multi-table combiner:** `find_available_table_group(uuid, timestamptz,
  integer, integer, uuid, double precision)` — recursive CTE up to 16
  tables. Strategy: (1) smallest single table that fits, (2) adjacent
  same-section combo, (3) any-combo fallback. Early-returns
  `ARRAY[]::uuid[]` when party_size > `restaurant_floor_capacity()`.
  Captured in `20260510000100_capture_find_available_table_group.sql`.
  Helpers: `restaurant_floor_capacity(uuid)` (sum of active table
  capacities) and `restaurant_turn_time_minutes(uuid, uuid)`
  (settings_json.turnTimeMinutes → shift.turn_time_minutes → 90,
  clamped [15, 480]).
- **Deposit policy:** `restaurants.deposit_tiers` JSONB array of
  `{min_party_size, amount_per_person_cents}` + `compute_deposit_for_party
  (uuid, integer) RETURNS integer` (highest tier wins, NOT additive).
  `reservation_deposit_payments` (RLS: owner-staff + diner read; service-
  role write). Settle trigger flips reservation to 'confirmed' once
  every payment row is 'charged'. Owner UI:
  `<DepositPolicyEditor>` at
  `apps/web/src/components/dashboard/DepositPolicyEditor.tsx`. Customer
  UI: deposit appears as a line item on the existing checkout step in
  `RestaurantPublicPage.tsx` (no separate step) — `previewDepositDollars`
  is added to `totalNow` and surfaced in the order summary as
  `Deposit (N × $X.XX)`. The menu step's "Continue" button label
  becomes "Continue to checkout · Deposit $X" when a deposit applies,
  so deposit-required parties always reach checkout. After
  `create-public-booking` returns `deposit_required`,
  `handlePlaceOrder` calls `prepare-deposit` then `confirm-deposit-stub`
  before transitioning to `step === "confirmed"`.
- **Read cache:** `availability_cache` UNLOGGED table +
  `get_available_slots_cached` (20 s TTL, opportunistic 5 min prune).
- **Batched listing:** `get_available_slots_for_restaurants_compact` —
  returns first 6 future slots per restaurant, strips `table_ids`.
- **Batched range scan:** `restaurant_available_dates(uuid, int, date,
  date) → text[]` — replaces N day-probes.
- **Rate limit:** `check_rate_limit(p_key, p_limit, p_window_seconds)` +
  `_shared/rate-limit.ts` helpers.
- **Atomic write:** advisory lock keyed on
  `(restaurant_id, reserved_at)` — same hash function for create and
  modify so they serialize against each other.
- **Diner double-book guard:** `reservations.slot_range` (trigger-set,
  not generated — `timestamptz + interval` is STABLE) +
  `reservations_user_no_overlap` /
  `reservations_guest_email_no_overlap` /
  `reservations_guest_phone_no_overlap` partial exclusions.
  `book_reservation` and `modify_reservation_slot` both pre-check and
  raise `P0006 'diner_double_book'`; edge function maps it (and the
  `23P01` backstop) to a 409 with `unavailable_reason: 'diner_double_book'`.
- **Live availability invalidation on customer pages:**
  `useAvailabilityRealtimeInvalidate(restaurantId, onInvalidate)` from
  `apps/web/src/hooks/useAvailability.ts` — multiplexed postgres_changes
  channel scoped to one restaurant. Multiple components on the same page
  may call it for the same `restaurantId`; the hook holds a module-level
  registry keyed by id, so they share ONE socket and each gets its own
  callback. Used by `RestaurantPreviewModal`, `RestaurantPublicPage`,
  and `AvailabilityPanel` (mounted inside the first two). Don't use it
  from Discover/Deals (one entry per card still explodes the connection
  count). Naive same-name `client.channel(...)` calls used to crash the
  modal subtree with `cannot add postgres_changes callbacks ... after
  subscribe()` — fixed 2026-05-09 by the registry, after the unified
  `<AvailabilityPanel>` started subscribing alongside the modal/public
  page that already did.

## Hey Cenaiva pipeline patterns (web mirror of mobile)

- **Four-stage `sendTranscript`** in `apps/web/src/components/cenaiva/AssistantProvider.tsx`:
  1. `planLocalBookingTurn` (pure TS, ~0–50ms) — missing-field prompts,
     ambiguous-time disambig, pending-option picks.
  2. `useCenaivaAvailability.check` (~200–800ms) — `cenaiva-availability`
     edge function with cached "One moment please." filler from IDB
     while the call is in flight; 20s `AbortController` timeout.
  3. `useCenaivaSmallPrompt.send` (~400–1500ms) — `cenaiva-small-prompt`
     edge function for off-topic Q&A; 8s timeout. Skipped when the turn
     is a confirmation reply or a process prompt.
  4. `useCenaivaOrchestrator.send` (~1.5–8s SSE) — full LLM tool loop,
     with `recommendation_mode` + `assistant_memory` + voice_id-less
     request body. Kill switch: `VITE_CENAIVA_FAST_PATH=false` skips
     Stages 1–3 and goes straight to Stage 4.
- **Wake greeting:** `buildWakeGreeting(user)` returns
  `"Good {morning|afternoon|evening}{, FirstName}. How may I help with
  your reservation?"`. Wired into `onWake` → `open(undefined, undefined,
  { autoListen: true, greetingText })`. The provider speaks the greeting,
  *then* opens the command recognizer.
- **Persistent TTS cache:** IndexedDB store `cenaivaTtsCache` keyed by
  `flash25-mp3-44100-128-v1-${djb2('${voiceId}:${normalizedText}')}`.
  Warmed on first `voice.primeTTS()` for `COMMON_TTS_CACHE_TEXTS`
  (9 phrases). Live-fetch fallback on IDB quota / private-mode /
  unavailable. Bumps the version suffix when the upstream codec / bitrate
  / sampling rate changes.
- **Per-user voice picker:** `useCenaivaVoicePreference()` returns
  `{ voicePreference, voiceId, isLoading, isSaving, needsSelection,
  refresh, setVoicePreference }`. Persists to
  `localStorage['@cenaiva/tts-voice/${authUserId}']` and
  `user_profiles.cenaiva_tts_voice` (text col, nullable). Provider mounts
  between `AuthProvider` and `AssistantProvider` in `App.tsx`. UI:
  `/account/voice` route + link from the Preferences section of
  `AccountPage`.
- **Latency observability:** `useCenaivaLatencyBudget()` is gated by
  `VITE_CENAIVA_VOICE_DEBUG=true`. Zero-overhead when off. Per-turn
  console summary: `t→firstSpeech / t→final / t→firstAudio / transport`.
  Wired into all four stages of `sendTranscript`.
- **Recommendation capping:** `getCenaivaRecommendationMode(transcript)`
  → `'single' | 'list' | null`. When `single`, Stage 4 wraps response
  with `normalizeSingleRestaurantRecommendationResponse` (one card +
  `"I'd go with X."`) and `applyClientDiscoveryMemory` keeps the full
  ranked list in `state.memory.discovery` so "show me more" follow-ups
  don't repeat already-shown cards.
- **Confirmation routing:** `shouldRouteAsCenaivaBookingConfirmation` +
  `transcriptForCenaivaBookingConfirmation` rewrite "yes" → "yes,
  confirm booking" before sending to the orchestrator when the booking
  is in `confirming` status.
- **Restaurant adapter:** `apps/web/src/lib/cenaiva/restaurantAdapter.ts`
  → `toCollectorRestaurant(webRestaurant)` maps web's snake_case
  `Restaurant` to mobile's camelCase `CollectorRestaurant`. Use at every
  call site that feeds restaurants into a ported helper.
- **Voice-shell map is Google Maps.** `apps/web/src/components/cenaiva/CustomerMap.tsx`
  uses `loadGoogleMaps()` + `CENAIVA_MAP_STYLES` from
  `apps/web/src/lib/google-maps.ts` (single source of truth — same styles
  on `DiscoverPage`). MapLibre is no longer used inside the assistant.
  Falls back to a "Add `VITE_GOOGLE_MAPS_API_KEY`…" message when the key
  is missing. Markers are imperative `new maps.Marker(...)` synced from
  `state.map.marker_restaurant_ids`.
- **Booking widget is `<AvailabilityPanel>`.**
  `apps/web/src/components/booking/AvailabilityPanel.tsx` is the unified
  date / time / party + 6-pill grid for the customer booking flow.
  Defaults on cold load: today (or `fetchNextAvailableDate`) / closest
  slot to "now" / 2 guests. Auto-refetches `get_available_slots_cached`
  on date or party change; time change re-windows the cached slot list
  via `centerSlotsAround(slots, time, 6)` without a fetch. Used on
  `RestaurantPublicPage`, `RestaurantPreviewModal`, AND
  `ModifyBookingFields` (unified 2026-05-09). All three sites pass the
  same shape (`restaurantId`, `restaurantTimezone`, `userProfileId`,
  `initial*`, `onSelectSlot`, `onStateChange`); modify additionally
  passes `excludeReservationId` so conflict windows skip the row being
  edited.
- **Conflict UX never silently filters.** `useDinerConflictWindows`
  returns the diner's overlapping reservations; render conflicting
  slot pills as DISABLED with a tooltip ("hidden — you have a 7:30
  booking at Mark Testing"), don't drop them. `formatConflictWindow`
  produces the tooltip label.
- **Restaurant total seat capacity** is `sum(tables.capacity) where
  is_active=true`. Use the `useRestaurantSeatTotal(restaurantId)` hook
  (`apps/web/src/hooks/useRestaurantSeatTotal.ts`). Surfaced in the
  dashboard SettingsPage as a read-only field next to turn-time, so
  owners know what `shifts.max_covers` could safely be raised to for
  whole-restaurant bookings.
- **Advance booking window is effectively unlimited (3650 days / 10
  years).** `shifts.advance_booking_days` is the per-shift cap that
  `get_available_slots` applies via `v_today + v_advance_days`. All
  active shifts are set to **3650**; the dashboard fallback for new
  shifts (`SettingsPage.tsx`) and the `<AvailabilityPanel>` calendar
  cap (`addDays(today, 3650)`) match. If you ever need to gate further-
  out bookings (e.g. owner-driven seasonal close), use
  `shifts.blackout_dates` rather than dropping the global cap — that
  preserves the calendar's "open by default" UX. Set 2026-05-09 in
  response to the user wanting unlimited lead time pending a Stripe
  paywall + per-shift dashboard control.
- **Calendar empty-set vs null distinction.** `fetchAvailableDateSet`
  returns `Set<string> | null`. **Empty Set** = "we asked, no openings
  this month" → grey out every date. **null** = fetch failed or hasn't
  completed → calendar stays permissive (predicate returns false).
  `unavailableDate` predicates must always handle null; without that,
  any RPC blip blanks the entire calendar and looks identical to "fully
  booked." Caught 2026-05-09 after a user reported all future dates
  appeared disabled.
- **Calendar day-button text contrast.** The shadcn `Button` ghost
  variant defaults to `text-muted-foreground` (#666666). `CalendarDayButton`
  uses ghost, so non-selected days inherit that color and become
  visually indistinguishable from `disabled` days (which only add
  `opacity-50` on top). The fix lives in `apps/web/src/components/ui/calendar.tsx`:
  `text-foreground` is added to the day button base className so enabled
  days render in foreground white, with `disabled:text-muted-foreground`
  + the inherited `disabled:opacity-50` (from Button base) handling the
  dim state. Caught 2026-05-09 after a screenshot showed every future
  date looking greyed-out even when the RPC returned 16 valid dates.

## Stack reminders

- Vite + React 18 + TypeScript strict + Tailwind + shadcn/ui.
- NOT Next.js, NOT App Router, NOT server components.
- Monorepo root: `/Users/mark_habbi/Seatly-12`. Web app:
  `apps/web/`. Edge functions: `supabase/functions/`.
- Supabase project ref: `exbjodmnpdiayfzrdyux` (ca-central-1).
- Type-check before claiming any task done:
  `npx tsc --noEmit -p apps/web/tsconfig.app.json`.
- Test runner: Vitest. Run from `apps/web/`:
  `npm run test:run` (CI-friendly, `--passWithNoTests`) or `npm test`
  (watch). 98 cenaiva tests under
  `apps/web/src/lib/cenaiva/__tests__/`.

## Pointers (read these for the why)

- `CONCURRENCY_PLAN.md` — capacity ceiling, scaling decisions, CDN
  deliberation, all ten Phase 10 + Phase F entries.
- `SPEED_PLAN.md` — per-user latency phases (1–9), frontend perf,
  remaining speed-only follow-ups.
- `WORK_LOG.md` — chronological decisions, gotchas, current production
  state, agent transfer notes.
- `PERFORMANCE_PATTERNS.md` — portable patterns for future projects.
- `jolly-prancing-clover.md` — full Hey Cenaiva mobile→web mirror spec
  (2,575 lines: pipeline architecture, gap matrix, edge-case behavior
  matrix, verification, perf targets, browser compat, PR conventions).
- `step2-source-handoff.md` — verbatim mobile source for the 3 large
  helpers (`recommendationIntent`, `filterRestaurants`,
  `localBookingCollector`) + their 3 test files. Kept for future
  cherry-picks from mobile when the upstream files change.
- `cenaiva-database.md` — single-context reference (~5,000 words) for
  any Claude agent working on a NEW Cenaiva client (mobile, internal
  tools, future SDKs). Schema, RPCs, edge functions, status enums,
  realtime publication, RLS layout, performance rules, error codes,
  migration ledger — plus an actionable checklist at the bottom.
- `DINER_MOBILE_GUIDE.md` — diner-side mobile-mirror handoff
  (2026-05-09, v1.1). Read this before building any iOS/Android/RN
  client that mirrors the web's diner surfaces. Covers every UI
  surface (Discover, Deals, Preview modal, Public page,
  AvailabilityPanel, My Reservations, Modify/Cancel, Account,
  Notifications), full table schemas for the diner-relevant subset,
  every RPC and edge function the diner consumes, the booking
  lifecycle state machine, search + auto-roll + filters, multiplexed
  realtime registry pattern, complete error-code reference
  (P0001–P0008), and a 12-step implementation order. **Hey Cenaiva
  voice assistant is intentionally OUT OF SCOPE** — mobile does NOT
  mirror the voice pipeline (no wake word, no `cenaiva-orchestrate`,
  no ElevenLabs/Deepgram, no `user_profiles.cenaiva_tts_voice`).
  Read-only directive: mobile consumes; never modifies schema.

## When in doubt

Stop and ask. Don't infer architectural decisions from old patterns —
the docs above are the source of truth, and they're updated after every
shipped phase. If something in code contradicts a doc, the doc is right
until proven otherwise.
