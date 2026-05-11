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

## Headline state (2026-05-10)

- **Voice mic always-on + manual mute (2026-05-10).** Mic now auto-resumes
  in EVERY booking status except `paid` (which auto-closes 1.5s later).
  Previously gated 8 statuses (preorder/menu/checkout/tip/charging) — those
  paths are now hand-offs to the public restaurant page, so the mic
  never enters them via voice. Added a manual mute toggle on
  `<CenaivaVoiceShell>` (top-right, next to close X). When muted: mic
  off across turns, AI TTS still plays. `useCenaivaVoice.toggleMute`
  flips `isMuted` state; `AssistantProvider.muteRef` mirrors it for
  setTimeout-based auto-resume callbacks. Files:
  `assistantStoreConstants.ts` (set reduced to `{paid}`),
  `useCenaivaVoice.ts` (isMuted + toggleMute), `AssistantProvider.tsx`
  (muteRef + every auto-resume gate), `CenaivaVoiceShell.tsx` (mic
  toggle button using lucide Mic/MicOff icons).
- **Post-action "Anything else?" close prompt (2026-05-10).** After
  every successful book / modify / cancel, the orchestrator appends a
  randomized "Anything else?" pool to the spoken_text and queues
  `pending_action: { type: "session_end_check" }`. On the next turn,
  `confirmPendingAction` checks `session_end_check` BEFORE the standard
  affirmative/negative classifier (semantics flipped: "no" = end session).
  - "no" / "nope" / "I'm good" / "that's it" / "nothing else" / "all done"
    / "no thanks" → emit `ui_actions: [{ type: "close_assistant" }]` +
    goodbye line ("Anytime — talk soon!" / "Take care!" / etc.), pendingaction null, status idle.
  - Anything else → mutate `bookingState.pending_action = null` and
    return null so the caller falls through to the normal preflight/LLM
    flow. This lets pivots ("show me deals", "different restaurant")
    or new requests work without manually clearing the pending action.
- **Session-pivot intents — map / deals / different-restaurant
  (2026-05-10).** New block at the top of `buildPreflightResponse`,
  gated on `status in {idle, confirmed, post_booking}` so it only fires
  AFTER a successful action. Patterns:
  - `\b(?:show me|take me to|go to|back to|see)\s+(?:the\s+)?map\b` or
    `\b(?:back to|return to)\s+discover\b` → `ui_actions: [{ navigate
    "/discover" }, { close_assistant }]`.
  - `\b(?:show me|any|see|got)\s+(?:the\s+)?deals?\b` or `\b(?:are
    there|do you have)\s+any\s+deals?\b` → `navigate "/deals" + close`.
  - `\b(?:different|another|new)\s+restaurant\b` → resets booking,
    keeps assistant open, prompts "Sure — where to?".
  Client-side `simplePromptIntent.ts` adds `SESSION_PIVOT_PATTERN` so
  these phrases also short-circuit Stage 3 small-prompt and route to
  the orchestrator.
- **Voice declines preorder + deposit (hand-off pattern, 2026-05-10).**
  Voice no longer enters `offering_preorder` / `browsing_menu` /
  `reviewing_cart` / checkout / tipping / payment statuses. Those are
  HAND-OFFS to the public restaurant page (`/{slug}?...`).
  - **Preorder hand-off** (`buildPreflightResponse`, after session
    pivot, before `confirmPendingAction`): catches
    `pre[- ]?order|prepay|order ahead|skip the line|order now|menu|
    appetizers?|entrees?|mains?|kids?\s+menu|drink list|wine list|beer
    list` AND requires `bookingState.reservation_id` + `restaurant_id`.
    Looks up the slug, navigates to `/{slug}?confirmation={code}` and
    emits `close_assistant`. Spoken: "Pre-orders need the menu screen
    — I'll take you there to finish." (3 random variants).
  - **Deposit hand-off**: in the LLM-tool `complete_booking` branch
    (~line 6470) AND the post-loop auto-finalize path (~line 7103),
    BEFORE `completeBooking` runs, query `compute_deposit_for_party
    (restaurant_id, party_size)`. If > 0: don't book, push `navigate`
    + `close_assistant`, set `bookingDelta.handoff_reason =
    "deposit_required"`. The hard-override (~line 7270) replaces
    spoken_text with "This booking needs a $X-per-guest deposit — I
    can't process card details by voice. Sending you to the page with
    everything pre-filled.". URL prefill uses the existing public-page
    params: `?date=YYYY-MM-DD&time=HH:mm&people=N&shift_id=...`.
  - **System prompt updated** to tell the LLM: do NOT call
    `offer_preorder`, `get_menu`, `create_preorder_order`,
    `set_tip_choice`, `set_tip`, `set_payment_split`, or
    `charge_saved_card`. The orchestrator's preflight handles all
    those flows via hand-off.
  - **Client-side**: `AssistantStore.applyUIAction("show_confirmation")`
    now sets `status: "post_booking"` (was `offering_preorder`). The
    safety-net at line 567 (in `APPLY_RESPONSE`) also forces
    `post_booking` instead of `offering_preorder`. **Removed** the
    `AssistantProvider.tsx:572-579` preorder-prompt appender — the
    "Anything else?" block in the orchestrator owns the follow-up now.
- **Concurrent-user ceiling: ~2,250** active Discover/Deals browsers on
  Micro compute (Supabase ca-central-1), p95 < 1 s, 0 failures.
- **SMS confirmations wired into voice book/modify/cancel
  (2026-05-10).** The voice flow bypasses the public edge functions
  (`create-public-booking`, `modify-reservation`,
  `cancel-reservation`) where SMS sending lived, so users got SMS
  for web bookings but NOT for voice-assistant bookings. Fixed:
  - `_shared/reservation-notifications.ts`'s
    `sendReservationNotification` now also accepts
    `type: "reservation_confirmation"` (was modify/cancel only).
  - `_shared/booking.ts` `completeBooking` calls
    `sendReservationNotification` after the `book_reservation` RPC
    succeeds. Builds the SMS body inline (mirrors create-public-
    booking's wording) including manage link.
  - `cenaiva-orchestrate/index.ts` `confirmPendingAction` now
    sends SMS in BOTH the cancel branch (after
    `release_reservation_tables`) and the modify branch (after
    `modify_reservation_slot` + optional special_request update).
    Each fetches the latest reservation row + guest record and
    builds a body with the new/updated/cancelled time.
  All three calls wrapped in try/catch — notification failure
  must NOT block the booking response. Verified end-to-end via
  computer-use: book → SMS, modify → SMS, cancel → SMS, all
  visible in `communication_log` with `channel='sms'`,
  `status='sent'`. Twilio env vars (`TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`) already configured;
  user phone is normalized to `+1<10 digits>` before sending.
- **Stale `reservation_tables` cleanup pattern.** When a cancel
  fails to call `release_reservation_tables` (orphaned by an old
  bug, manual SQL update, etc.), `reservation_tables.released_at`
  stays NULL and the partial-exclusion `reservation_tables_no_overlap`
  blocks new bookings at that slot — surfacing as 23P01. Recovery
  query (safe — only releases tables for already-cancelled rows):
  ```sql
  UPDATE reservation_tables SET released_at = now()
  WHERE released_at IS NULL
    AND reservation_id IN (
      SELECT id FROM reservations WHERE status = 'cancelled'
    );
  ```
- **Cancelled-only reservation history → safe state (2026-05-10).**
  When `singleReservationKind` / list handlers picked a CANCELLED row
  (no active rows exist), they used to promote
  `reservation_id` + `status="post_booking"` into booking_state. Result:
  the UI rendered "You're booked!" for a cancelled row, AND a follow-up
  "modify it" / "cancel it" tried to act on the cancelled rid, surfacing
  errors. Both handlers now check `isActive = status !== "cancelled"
  && !isPastActive(row)` and return `booking: { status: "idle" }` for
  cancelled/past picks. The spoken text still describes the cancelled
  reservation ("Most recent on file: X — but it's cancelled") so the
  user knows what happened.
- **Modify/cancel referencing prior context with no rid → helpful
  fallback (2026-05-10).** When the user says "modify it" / "cancel
  it" / "change that" but `booking_state` has NO active reservation
  (because the most-recent was cancelled), the orchestrator now runs
  a deterministic check that:
  1. Queries the user's active future reservations.
  2. Returns "You don't have any active reservations to change. Want
     to book a new one?" if none.
  3. Promotes the only active row + asks for confirmation if exactly
     one exists.
  4. Asks the user to pick if multiple.
  Without this, the request fell through to the LLM tool flow which
  responded with the generic "What restaurant or area should I book?"
  — confusing because the user clearly meant to act on an existing
  reservation.
- **AssistantProvider Stage 1 skip for modify/cancel/list intents
  (2026-05-10).** `planLocalBookingTurn` was parsing "5pm" out of
  "modify it to 5pm" as a new booking time and emitting the local
  collector's "What restaurant or area should I book?" prompt. Added
  `isModifyOrCancelRef` and `isReservationListQuery` regex guards so
  these requests skip Stage 1 entirely and reach the orchestrator's
  modify / cancel / list handlers (which know how to look up the
  reservation).
- **Mic auto-resumes on `post_booking` (2026-05-10).** Removed
  `post_booking` from `NO_AUTO_RELISTEN_STATUSES`. After the assistant
  shows a reservation card (whether from "what's my next reservation"
  or after a fresh book), the mic auto-reopens so the user can say
  "modify it" / "cancel it" / "show me my next one" hands-free. The
  previous gate forced the user to click the mic — broke the
  voice-first flow. Checkout / payment / menu statuses still gate the
  mic because button taps are faster there and the mic could pick up
  card-entry chatter.
- **Party-size parsing — colloquial coverage (2026-05-10).** Added
  patterns for "the both of us" / "both of us" / "us two" → 2;
  "myself and one other" / "me and another" → 2; "a couple" /
  "a duo" / "a pair" → 2; "half a dozen" → 6; "dozen" → 12;
  "me and N others/friends/people" → 1+N; "just the (two|three|four)
  of us" → that number. Added validation: `peopleMatch` rejects 0 or
  >99 (so "0 people" / "200 people" route back to "How many guests?"
  instead of accepting nonsense). Reordered "couple" check to run
  BEFORE the older `(party of|table for|for|...)\s+(...|a|couple|...)`
  pattern so "for a couple" doesn't get captured as bare "a" → 1.
- **Modify-verb expansion + parser robustness pass (2026-05-10).**
  The orchestrator's deterministic modify branch and the upstream
  routing both failed on "modify it to 5pm" because **`modify`
  itself wasn't in the verb regex** (only `change|move|switch|update|
  make it|add|reschedule`). Added `modify|push|bump|shift|adjust|
  edit` everywhere a modify-verb regex appears (modify branch first
  test, `bookingProcessIntent` fallback, client `simplePromptIntent`).
  Same pass also extended:
  - **`parsePartySize`**: catches `2 ppl` / `party 2` / `couple of us` /
    `two of us` / `me and a friend` / `me and 2 others`. Reordered so
    "me and a friend" wins over "just me" — was returning party=1 for
    "just me and a friend" before.
  - **`parseDateInTimeZone`**: catches abbreviations `weds`/`wed`/
    `thurs`/`fri`/etc (table maps each weekday to its short forms).
  - **`parseTime`**: catches "saturday eight pm" / "tomorrow nine pm"
    (DAY-name as preposition before bare-word time), and bare-word
    time `eight pm` anywhere when followed by explicit am/pm.
- **AssistantStore reducer full-reset on transition to idle from
  cancel (2026-05-10).** The reducer used to keep `time`/`date`/
  `party_size`/`restaurant_id` after cancel-success transitioned
  `status=post_booking → idle`. Result: "book mark testing for 2
  thursday at 6pm" right after a cancel inherited the cancelled
  reservation's 4PM time. Now resets the booking to `initialBooking`
  with only the patch overlaid (and preserves `restaurant_id` only
  if the patch explicitly set it — fact-lookup still highlights
  the Q'd restaurant). Verified end-to-end via UI: cancel → "book
  X for N day at TIME" picks up the new TIME correctly.
- **Mic auto-resume already wired (Option A).** After a turn,
  `voice.startListening` is called via `setTimeout` (260ms delay,
  `RELISTEN_AFTER_RESPONSE_MS`) **unless** booking_state.status is
  in `NO_AUTO_RELISTEN_STATUSES` (offering_preorder, browsing_menu,
  reviewing_cart, choosing_tip_*, charging, paid, post_booking) OR
  the user is in text input mode. Voice mode → mic auto-reopens
  after AI speaks. Text mode → mic stays off (user is typing).
  Don't change this; matches mobile behavior + the user's
  preference.
- **Voice-assistant fact/global question routing — 4-stage skip
  (2026-05-10).** The `simplePromptIntent` client classifier now catches
  the wider fact-lookup vocabulary (`about`, `like`, `kind`, `type`,
  `sort`, `reviews?`, `rating`, plus vibe words: `quiet`, `loud`,
  `trendy`, `hip`, `cozy`, `kid-friendly`, `family-friendly`) AND a
  new `GLOBAL_DISCOVERY_QUERY_PATTERN` for `closest`/`nearest`/
  `near me`/`nearby`/`best cuisines`/`promotions`/`deals`/`events`.
  Without these, "what is X about" / "any deals tonight" / "best
  cuisines" routed to Stage 3 small-prompt LLM (no DB access) and
  the user got generic "I'm not sure" replies instead of the
  orchestrator's deterministic answers. **AssistantProvider Stage 1
  also skips `planLocalBookingTurn` for these queries via
  `isFactOrGlobalQuery` regex** — otherwise the local collector
  parses "tonight" as a date in "any deals tonight" and routes to
  Stage 2 availability check, which returns the restaurant's HOURS
  instead of the deals message. The guard is in
  `AssistantProvider.tsx` right next to `isPureGreeting`. Don't
  remove it.
- **AssistantStore reducer auto-clears post_booking on transition
  to idle (2026-05-10).** When a fact-lookup or global-question
  response patches `booking.status === "idle"` AND the prior state
  was `post_booking` / `paid` / `confirmed`, the reducer now
  explicitly nulls `reservation_id`, `confirmation_code`,
  `slot_iso`, `shift_id`, `pending_action`, `special_request`, and
  resets `customerAccepted = false`. Without this, the previous
  reservation's "You're booked!" success card stayed on screen
  even after the user asked an unrelated question — the new
  patch only added new fields, never cleared the rid that drove
  the card. The check is in `AssistantStore.tsx:497-525`. Apply
  it any time the new orchestrator response intent is
  question-shaped (general_question, answer_restaurant_question)
  rather than booking-progressing.
- **Cancel success response now sets `status: "idle"` (2026-05-10).**
  Was setting `status: "confirmed"` after a successful cancel,
  which kept the cancelled reservation visible as "You're booked!"
  on the post_booking card. Changed to `"idle"` so the new reducer
  trigger above clears the card. The cancelled DB row still has
  `status="cancelled"`; this is just the client-side booking_state
  status the orchestrator reports back.
- **Global question handlers in orchestrator return
  `booking: { status: "idle" }` (2026-05-10).** Without an explicit
  booking patch, the orchestrator's globalAnswerCandidate response
  left booking_state untouched — so the prior reservation_id and
  status="post_booking" persisted through fact-lookup turns. Now
  every global-question return path includes `booking: { status:
  "idle" }` to trigger the AssistantStore's transition-to-idle
  cleanup.
- **Live deposit flow verified end-to-end (2026-05-10).** Browser-
  tested party of 8 at Mark Testing → /echoria-3 public page →
  party picker → 5:30PM slot → details → menu step shows
  "Continue to checkout · Deposit CA$80.00" → checkout step shows
  `Deposit (8 × CA$10.00) CA$80.00` line item + total CA$80.00 →
  Place Order (test card 4242…) → Table Booked + confirmation code
  0DB9423E. DB verified: `reservations.deposit_amount_cents=8000`,
  `deposit_status='charged'`, `status='confirmed'`. The Stripe stub
  (`confirm-deposit-stub`) flips deposit rows to 'charged' on click,
  and the `reservation_deposit_payments` settle trigger flips the
  parent reservation to 'confirmed' once all rows hit 'charged'.
- **Booking caps removed (2026-05-10).** Per-shift `max_covers` cap is now
  optional: when `shifts.max_covers IS NULL`, the cover-cap check is
  skipped entirely. The only ceiling is `restaurant_floor_capacity()`
  (sum of active table capacities), enforced via the multi-table combiner
  early-return. All four booking RPCs (`book_reservation`,
  `modify_reservation_slot`, `create_staff_reservation`,
  `get_available_slots`) gate the cover-cap check on `IS NOT NULL`. A
  one-time `UPDATE shifts SET max_covers = NULL` ran on 2026-05-10 so
  every existing shift benefits. `SettingsPage.tsx:1111` no longer seeds
  `max_covers: 100` on new shifts (NULL instead). Owners who want a
  kitchen/staff throttle can set a number directly on `shifts.max_covers`
  until a future dashboard control exposes it. Migration:
  `20260510000200_remove_max_covers_cap.sql`. Don't reintroduce the
  `COALESCE(s.max_covers, 100)` pattern — NULL means "no cap" now.
- **Multi-table combiner captured as a migration (2026-05-10).** The
  deployed `find_available_table_group` was a sophisticated multi-table
  combiner (recursive CTE up to 16 tables, two strategies: adjacent
  same-section first, then any-combo fallback) but the local migration
  at `20260503000001_add_reservation_table_assignments.sql` was the OLD
  1-2-3-table version. Migration drift was caught while debugging "47
  people fails at Georgy Inc". Captured as
  `20260510000100_capture_find_available_table_group.sql` along with
  the `restaurant_floor_capacity(uuid)` and
  `restaurant_turn_time_minutes(uuid, uuid)` helpers. CREATE OR REPLACE
  → no-op for prod; restores parity for fresh local DBs. Lesson: when
  investigating "this should be broken but seems to work", grab
  `pg_get_functiondef(p.oid)` from prod before assuming the local file
  represents the live state. Local migration files can lag behind prod.
- **Deposit policy with Stripe-stubbed UI (2026-05-10).** Owners can set
  per-tier deposits keyed on party-size threshold via the new
  `<DepositPolicyEditor>` card on Settings → Restaurant info. Schema:
  `restaurants.deposit_tiers JSONB` (array of
  `{min_party_size, amount_per_person_cents}`),
  `reservations.deposit_amount_cents` + `deposit_status`
  (`none|pending|charged|waived|failed`), and
  `reservation_deposit_payments` (split-tender support, RLS-protected).
  `compute_deposit_for_party(uuid, integer) RETURNS integer` computes
  the deposit using the **highest applicable tier × party size** — NOT
  additive (a party of 25 at the 20+ tier of $20/person pays $500, not
  $750). **Deposit is collected on the existing checkout step (Step 3
  Payment)** as a line item alongside the preorder cart and tip — there
  is no separate "deposit" step. The single/split-tender card UI in
  `RestaurantPublicPage.tsx` handles the combined total. Client-side
  `previewDepositDollars` is computed from `restaurant.deposit_tiers` ×
  party size for display before the booking is created; the server
  re-computes and writes the canonical value via
  `compute_deposit_for_party()` inside `create-public-booking`. The
  menu step's "Continue" button reads "Continue to checkout · Deposit
  $X" instead of "Skip preorder · Confirm booking" when a deposit
  applies, so the customer always reaches the checkout step. Two new
  edge functions: `prepare-deposit` (creates payment rows in 'pending')
  and `confirm-deposit-stub` (STRIPE STUB — flips rows to 'charged' on
  click; **gated behind `DEPOSIT_STRIPE_STUB_MODE` env, default true,
  set to `false` in prod once Stripe is wired**). After booking
  creation, `handlePlaceOrder` calls both functions sequentially when
  `deposit_required`; the settle trigger on
  `reservation_deposit_payments` flips the parent reservation to
  `confirmed` once every row hits 'charged'. Migration:
  `20260510000400_deposit_policy.sql`. End-to-end verified in browser
  on 2026-05-10: party of 8 at Mark Testing → menu shows "Continue to
  checkout · Deposit CA$80.00" → checkout shows deposit line item +
  total CA$80.00 → Place Order → confirmation code 51063919,
  status='confirmed', deposit_status='charged'. Search `// STRIPE STUB`
  to find every spot the future Stripe wiring needs to touch. Don't
  re-introduce a separate "deposit" step or a `<DepositStep>` component
  — the user explicitly asked for the deposit to live inside checkout
  using the existing single/split-tender UI (2026-05-10).
- **Turn-time consistency fix (2026-05-10).** `get_available_slots` was
  reading `v_shift.turn_time_minutes` directly while every other booking
  RPC used `restaurant_turn_time_minutes()` (which prefers
  `settings_json.turnTimeMinutes`). Fixed in
  `20260510000300_get_available_slots_canonical_turn_time.sql` —
  `get_available_slots` now also calls the helper. SettingsPage's save
  handler (line ~820) additionally syncs `turn_time_minutes` to every
  active shift on save, so the column stays aligned with
  `settings_json.turnTimeMinutes`. Caught at Georgy Inc lunch where
  dashboard said 90 but the lunch shift's column was a stale 60.
- **Single Cherry Inc → service shift (2026-05-10, data fix).** Georgy
  Inc had a manually-created lunch (12-3) + dinner (5-9) two-shift
  setup, with a dead 3-5pm gap and 11am hours_json open never reaching
  the booking grid. Collapsed to a single `service` shift covering
  11:00-22:00 (matches `restaurants.hours_json`), turn=90. The
  SettingsPage "Save Hours" flow already creates one shift per day
  matching hours_json — only existing manual setups drift. If a future
  agent finds another restaurant with the same drift, the fix is the
  same: deactivate extra shifts and broaden one to cover the
  hours_json window.
- **Single-reservation-lookup deterministic handler (2026-05-10).** Added
  to `cenaiva-orchestrate/index.ts` `buildPreflightResponse` BEFORE the
  list handler. Catches "what's my most recent / latest / newest / last
  / next / first / current / active reservation" — singular queries
  expecting ONE row, not a list. Distinguishes 4 kinds: `most_recent`
  (prefer future-active, then past-active, then most recent cancelled);
  `next` (future-active only); `last_past` (past-active or past-cancelled);
  `first` (oldest non-cancelled). Sub-1s, no LLM round-trip. Without
  this, "what's my most recent reservation" hit the list handler and
  returned 3 rows + "And N more" — burying the answer. Promotes the
  picked row's `reservation_id` / `restaurant_id` / etc. into
  `booking_state` so the next turn ("change to 8pm" / "cancel it")
  works without re-naming the booking.
- **Restaurant fact-lookup widened to about/kind/type/drinks/reviews/
  events/price/vibe (2026-05-10).** The deterministic fact-lookup
  handler now covers:
  - "tell me about X" / "what is X about" / "what's X like" — describes
    the row using cuisine + business_type + price tier
  - "what kind/type/sort of food/place is X" — answers from `cuisine_type`
    + `business_type`
  - "what drinks does X serve" — answers if `business_type` is bar /
    brewery / pub / lounge / izakaya, otherwise defers to menu
  - "is X expensive / cheap / pricey / how much" — uses `price_range`
    column (1-4 → budget-friendly / moderate / upscale / fine dining)
  - "is X a cafe / bar / brewery / pub / bistro / lounge" — yes/no on
    `business_type` match
  - "is X fancy / romantic / quiet / cozy / casual / kid-friendly /
    family / good for a date" — defers to vibe-judgment; surfaces
    cuisine + price tier as context
  - "any reviews of X" — gracefully says reviews aren't surfaced
  - "any events at X" — defers to restaurant phone
  Pattern order matters: specific patterns FIRST, catch-all
  `what {city|state|...} {of|...} X` LAST. Otherwise the catch-all
  swallows "what kind of place is X" with name="place is X" — bad
  fuzzy match → falls through to LLM. Same for "what type of food
  does X serve". Restaurant SELECT now includes `price_range` (was
  missing earlier so price answers always returned "no tier on file").
- **Global-question handlers — closest / best / promotions / events
  (2026-05-10).** New `globalAnswerCandidate` block in
  `buildPreflightResponse` (after fact-lookup, before small-prompt
  short-circuit) catches questions NOT tied to a specific restaurant:
  - "closest / nearest / near me / nearby / walking distance" → asks
    for city/area
  - "best / top / popular / favorite cuisines / foods" → asks for
    mood instead
  - "best / top / popular restaurants" → asks for city + cuisine
  - "promotions / deals / discounts / specials / offers / coupons"
    → routes to `/deals` page
  - "events / live music / trivia (without a restaurant name)" → says
    not tracked, redirects to booking
  All sub-1s, no LLM. Without these, the LLM either declined ("I'm
  not sure...") or wandered into a tool loop.
- **Cancel + modify deterministic verbs widened (2026-05-10).** The
  deterministic cancel branch now matches `(cancel|scrap|drop|kill|
  nuke|trash|abort|nix|delete|remove)` + a noun, OR "I need/want/
  wanna/gotta to cancel" without a noun, OR bare "cancel". The modify
  branch first regex matches `(change|move|switch|update|make it|add|
  reschedule)` and the time keyword regex was rewritten as
  `\b\d{1,2}(:\d{2})?\s*(am|pm|...)?\b` (the old `\d{1,2}:?\d{0,2}`
  required a `\b` after digits and so didn't match "7pm" — `\b`
  doesn't fire between a digit and a letter). `bookingProcessIntent`
  fallback regex was extended to include `switch|update|reschedule|
  make it|drop|scrap|kill` and a standalone `\d+(am|pm)` pattern so
  these phrases reach the orchestrator preflight instead of the
  small-prompt LLM. `parseTime` now also accepts `to/for/by` as a
  preposition before `noon`/`midnight`/etc, and matches bare
  `noon`/`midnight` anywhere — so "change it to noon" works.
- **`reservation_tables_no_overlap`-aware modify routing.** Modify
  flows route through `modify_reservation_slot` (not direct UPDATE)
  per the existing CLAUDE.md hard rule. The deterministic handler
  sets up `pending_action.type = "modify_reservation"` with the new
  slot, and `confirmPendingAction` calls the RPC on user "yes". Same
  pattern as cancel.
- **Cenaiva voice persona is now warm + varied (2026-05-10).** The
  small-prompt edge function and the orchestrator's internal small-prompt
  path were both rewritten with a human persona ("You are Cenaiva — a warm,
  witty restaurant booking assistant who talks like a friend who knows
  every great spot in town."). The reply shape is 1-2 short sentences,
  reacts specifically to the user's message, and only adds a follow-up
  nudge when it makes sense — NOT a hard-coded "What restaurant or area
  should I book?" suffix on every reply (which made every off-topic
  response sound identical). Both prompts include explicit examples for
  greetings, status checks, off-topic, frustration, hesitation,
  inappropriate/flirty, and identity questions about the user vs about
  Cenaiva. Temperature on cenaiva-small-prompt was bumped from 0.1 → 0.7
  for variety. Don't drop the persona examples from either system prompt;
  the LLM defaults back to robotic if they're absent.
- **Hardcoded fallback prompts are randomized (2026-05-10).** Every
  deterministic spoken_text in the orchestrator that could repeat across
  turns (`buildOptionsPrompt`, `buildSingleCandidatePrompt`,
  `buildRecommendationPrompt`, `nextSmallPromptBookingQuestion`,
  `fallbackSpokenTextForContext`, `scrubGenericLookupPrompt`, the cancel
  success message, the modify success message, the reservation-list
  intro/follow-up) now picks from a 2-4 phrasing pool. Without that, the
  same exact closing line appeared on EVERY reply and the assistant
  felt like a phone tree. If you add a new deterministic spoken_text, use
  the local `pick`/`pickRand` pattern rather than a single literal string.
- **Restaurant fact-lookup deterministic handler (2026-05-10).** The
  orchestrator's `buildPreflightResponse` now has a fact-lookup early-return
  (right after `confirmPendingAction`, before the
  reservation-list handler). It catches "is X in Y", "where is X",
  "what city/cuisine/hours/address is X", "is X halal/vegan/kosher",
  "does X have/serve Y", "tell me about X" patterns, runs a fuzzy token
  lookup against `restaurants`, and answers using the row's actual
  `city` / `address` / `cuisine_type` / `business_type` / `phone`. Sub-1s
  response, no LLM round-trip. Without this, the LLM's single-result
  auto-confirm template ("Found Mark Testing — that the one?") was
  hijacking the response and the user's actual factual question went
  unanswered. Examples that now work: "Yep, Mark Testing is in Guelph",
  "Mark Testing is in Guelph — 64 Clairfields Drive East", "Actually,
  Mark Testing is in Guelph, not milton", "I don't have halal
  certification on file… they're at +1-416-555-0333."
- **Pure-greeting guard skips Stage 1 client-side (2026-05-10).**
  `apps/web/src/components/cenaiva/AssistantProvider.tsx` now checks an
  `isPureGreeting` regex BEFORE calling `planLocalBookingTurn`. Without
  that, "how are you doing today" / "good morning" / "what's up tonight"
  had the local booking collector parse "today" / "morning" / "tonight"
  out as a date and falsely emit "What restaurant or area should I book?"
  — overriding the warm small-prompt LLM reply that came later. The
  guard requires a leading greeting word AND no booking verb in the same
  message, so "hi can you book me at X" still flows through Stage 1
  normally. Don't remove the guard.
- **`SPECIFIC_PLACE_FACT_PATTERN` widens client-side process-prompt
  routing (2026-05-10).**
  `apps/web/src/lib/cenaiva/simplePromptIntent.ts` adds a second
  fact-lookup pattern alongside the original `SPECIFIC_PLACE_LOOKUP_PATTERN`
  ("is X in Y..."). The new pattern catches "where is X", "what
  city/state/cuisine is X in", "how much/expensive/busy is X", "does X
  have/serve", "tell me about X" — so they ALL route to the orchestrator
  and hit the deterministic fact-lookup handler. Pre-2026-05-10 these
  fell through to the small-prompt LLM which has no DB access and would
  say "I'm not sure about Mark Testing — sounds like a name I haven't
  heard of."
- **Booking writes are atomic and double-booking-proof** via
  `book_reservation` + `modify_reservation_slot` + the
  `reservation_tables_no_overlap` exclusion constraint.
- **Cenaiva voice booking is now `book_reservation`-backed end-to-end
  (2026-05-10).** `_shared/booking.ts` `completeBooking` used to do a
  direct `INSERT INTO reservations` with status `'confirmed'`, bypassing
  the advisory lock + cover-cap recheck + diner-overlap pre-check +
  close-time guard + table assignment. Direct INSERTs ALSO tripped the
  `reservation_tables_no_overlap` partial-exclusion constraint with the
  opaque 23P01 — so `cenaiva-orchestrate` returned
  `"I couldn't confirm that booking. Want another time?"` while no row
  was created. Fixed by routing through `book_reservation` RPC (same
  contract as `create-public-booking` and `cenaiva-chat`). The RPC also
  returns the trigger-persisted `confirmation_code`, so the value the
  client sees now matches the row that was actually persisted. Don't
  re-introduce direct `reservations.insert(...)` writes from any
  Cenaiva path.
- **`pending_action` is fully wired client→server (2026-05-10).** The
  voice modify and cancel flows depend on `confirmPendingAction` in
  the orchestrator (`cenaiva-orchestrate/index.ts:2536`). For that
  handler to fire, three things must all be true:
  1. The orchestrator emits `booking.pending_action = { type, payload,
     confirmation_text }` on the first turn (it does).
  2. The client merges that into `state.booking.pending_action` via
     `APPLY_RESPONSE` (it does).
  3. The client echoes `pending_action` back in the next request's
     `booking_state` — `AssistantProvider.tsx:400-420`. **This was
     missing pre-2026-05-10**, so modify and cancel sat in an infinite
     "Just confirming…" loop. Don't drop `pending_action` from the
     `booking_state` field list. Also: when `pending_action` is set,
     the client MUST skip Stage 3 small-prompt (`AssistantProvider.tsx`
     `hasPendingAction` flag) — otherwise bare "yes" replies hit the
     small-prompt LLM and never reach the orchestrator.
- **`isSmallPromptTurn` (orchestrator) is gated on `pending_action`
  (2026-05-10).** Even when the client sends `pending_action`, the
  orchestrator's `isSmallPromptTurn` check at line 4357 used to flip
  TRUE for bare "yes" / "no" because none of the standard intent
  matchers (booking-process, booking-field-reply) catch a single
  affirmative word. That skipped `buildPreflightResponse` and so
  `confirmPendingAction` never ran. Now the gate reads
  `hasPendingActionInState` and stays FALSE whenever `pending_action`
  is queued. Don't remove that check.
- **`confirmPendingAction` strips action-topic words before classifying
  (2026-05-10).** `isAffirmativeText("yes cancel it")` previously
  returned FALSE because `isNegativeText` matched the word "cancel"
  (a generic "you want to abort" signal). For a queued
  `cancel_reservation`, the word "cancel" IS the topic — strip it
  before evaluating. Same for `change|modify|update|switch|move|
  reschedule` (modify), `late|running late|delay` (late note),
  `remember|save|prefer` (save preference). Don't undo this.
- **`list_my_reservations` exists as both an LLM tool AND a deterministic
  early-return (2026-05-10).** The orchestrator now exposes a
  `list_my_reservations` tool with `status_filter` of
  `active|past|cancelled|all`. There's also a deterministic handler in
  `buildPreflightResponse` (after `confirmPendingAction`, before the
  small-prompt short-circuit) that bypasses the LLM, queries
  `reservations` directly, names 1-3 rows in `spoken_text`, and
  promotes the first active row's `reservation_id`,
  `confirmation_code`, `restaurant_id`, `date`, `time`, `slot_iso`,
  `party_size` into `booking_state`. That last bit is what lets the
  next turn ("change to 8:30 PM" / "cancel it") work without the user
  re-naming the booking. The intent matcher requires a leading
  list-verb (`show|list|see|view|review|tell me|pull up|bring up|
  give me|read out|what are|what's`) — DON'T loosen it to bare
  `\bmy\b reservation`, that misclassifies `change my reservation`
  and `cancel my reservation` as list intents.
- **Client + orchestrator process-prompt regexes match plurals
  (2026-05-10).** Both `apps/web/src/lib/cenaiva/simplePromptIntent.ts`
  `BOOKING_PROCESS_DETAIL_PATTERN` and the orchestrator's
  `bookingProcessIntent` fallthrough now use `reservations?` /
  `bookings?` so `"show me my reservations"` (plural) routes to the
  orchestrator instead of the small-prompt LLM. Pre-2026-05-10 the
  pattern was `\breservation\b` which only matched the singular —
  plural-form requests fell through to small-prompt and got the
  refusal `"I can't see your reservations right now"`.
- **`restaurantFactLookupIntent` covers more interrogatives
  (2026-05-10).** The original v174 regex only matched `"is X in/at/
  near/halal Y"` patterns. Extended on 2026-05-10 to also catch
  `"where is X"` / `"where's X"`, `"what city/state/area/
  neighborhood/address/cuisine/hours/price"`, `"how
  much/expensive/busy/popular/far"`, `"does X have/serve/allow"`,
  `"tell me about X (restaurant|cafe|bar)"`. Routed BEFORE
  `clearlySmallPromptIntent` in `bookingProcessIntent` so the
  `^(what|who|why|how)…` short-circuit can't reject restaurant fact
  questions. Don't reorder.
- **Diner double-book is enforced at the DB layer** via three partial
  GiST exclusions on `reservations` keyed on `user_profile_id`,
  `lower(guest_email)`, and digits-only `guest_phone` against an active
  `slot_range`. Both RPCs raise `P0006 / diner_double_book` ahead of the
  exclusion as a friendlier error.
- **Every reservation must carry at least one identifier.** A CHECK
  constraint (`reservations_must_have_identifier`) enforces that
  `user_profile_id`, `guest_email`, or `guest_phone` is non-empty.
  All three reservation writers raise `missing_identifier` (P0007)
  up front: `book_reservation`, `create_staff_reservation` (staff
  path — at least email or phone since there's no profile), and
  `modify_reservation_slot` (defensive — reads the existing row's
  identifiers, only fires for pre-CHECK grandfathered rows). Fixed
  2026-05-09 after two all-null inserts via the mobile/voice path
  bypassed every overlap check (the partial GiSTs all require at least
  one of those three fields). `guest_id` alone is NOT enough — pair it
  with email or phone. Dashboard staff forms (`ReservationsPage`
  drawer, `FloorPlanPage` host quick-add + floor service form) also
  validate "email or phone required" client-side so users see a form
  message instead of a raw RPC error.
- **No booking can run past its shift's close time.** All three
  reservation writers raise `past_shift_close` (P0008) when
  `reserved_at + turn_minutes` would exceed the shift's `end_time`,
  or when `reserved_at` is before `start_time`. Same-day shifts only
  (`start <= end`); overnight shifts are not yet enforced. Edge
  functions `create-public-booking` and `modify-reservation` map P0008
  to 409 with `unavailable_reason: 'past_shift_close'`. Fixed
  2026-05-09 after a smoke test showed a 22:45 start at an 11pm-close
  shift booking successfully via direct `date_time` POST, bypassing
  the slot-grid validation that lived only in `get_available_slots`.
- **`book_reservation` returns the trigger-persisted
  `confirmation_code`.** A BEFORE INSERT trigger
  (`reservations_confirmation_code`) unconditionally overrides
  `NEW.confirmation_code` with a generated 8-hex value. The RPC now
  captures that via `RETURNING id, confirmation_code INTO …` so the
  function output matches what the row actually has. Without this,
  callers (edge function, SMS, email, customer self-serve modify)
  received the input placeholder and customers couldn't manage their
  bookings via confirmation code. Fixed 2026-05-09 in the same
  migration as the close-time guard.
- **Voice modify and cancel route through the safe RPCs.**
  `cenaiva-orchestrate` (the voice assistant) used to handle modify
  and cancel intents with direct `reservations.update(...)` calls,
  bypassing the advisory lock, diner-overlap guard, cover-cap recheck,
  close-time guard, and `find_available_table_group` table
  reassignment. As of v169 (deployed 2026-05-09): voice modify routes
  through `modify_reservation_slot` RPC; voice cancel does the
  status flip + `release_reservation_tables` RPC (mirrors
  `cancel-reservation/index.ts`). Voice now has the same safety
  invariants as the public web flow. Don't reintroduce direct
  `reservations.update(...)` writes for slot/party/shift fields in
  the orchestrator — always go through the RPC.
- **Voice deploy hygiene.** `cenaiva-orchestrate` v168 had drift:
  `verify_jwt: true` deployed while `supabase/config.toml` had
  `verify_jwt: false`. Per the config.toml header note, voice
  functions must be `false` because they decode JWTs themselves
  (otherwise the gateway rejects ES256 tokens with
  `UNSUPPORTED_TOKEN_ALGORITHM`). The 2026-05-09 redeploy aligned
  prod with config. If a future deploy resets it to `true`, voice
  users on ES256 sessions will silently break.
- **Voice search query splitter strips stop words.** The
  `search_restaurants` SQL implementation in `cenaiva-orchestrate`
  builds an OR of `name.ilike.%w%, cuisine_type.ilike.%w%,
  city.ilike.%w%` for every word in `toolInput.query`. Without
  filtering, words like "in"/"of"/"to" matched anything containing
  them — e.g. "restaurants in guelph" returned **Georgy Inc** because
  `name.ilike.%in%` matches "Georgy Inc" (contains "in"). v172
  (2026-05-09) introduced `QUERY_STOP_WORDS` (60+ items including
  "in", "is", "the", "and", "restaurants", "near", common
  prepositions) plus a length≥3 floor. Stop-word filter MUST stay —
  removing it reintroduces the off-city pollution. Also: the
  system prompt's PARAMETER USAGE section explicitly tells the LLM
  to put cities in `city`, venue styles in `business_type`, cuisines
  in `cuisine_type`, and NEVER dump sentence fragments into `query`.
  Don't relax that guidance.
- **Factual restaurant questions are NOT identity questions.** The
  system prompt's "personal/identity question" rule used to say
  "if the user asks you to determine something, give a respectful
  one-sentence answer such as you cannot determine that" — the LLM
  generalised that to "Isn't Georgy Inc in Milton?" and refused
  with "I can't determine that for you." v172 splits the rule:
  identity questions ABOUT THE USER (their sexuality, looks, etc.)
  are off-limits; factual questions ABOUT A RESTAURANT (city,
  hours, business_type) ARE answerable via search_restaurants.
  Don't merge these two categories again.
- **Voice search supports `business_type` AND any city.** As of
  `cenaiva-orchestrate` v170 (2026-05-09) extended in v173 (also
  2026-05-09): the `search_restaurants` tool has both `cuisine_type`
  (food, e.g. Italian) AND `business_type` (venue style, e.g. cafe,
  bar, brewery, bistro, bakery, lounge, pub) parameters. The system
  prompt explicitly lists smaller Canadian cities (Guelph, Milton,
  Oakville, Burlington, Cambridge, Hamilton, Kitchener, Kingston,
  Saskatoon, etc.) as valid `city` values so the LLM doesn't drop
  them as transcription noise. The SQL query SELECTs + ILIKE-filters
  both columns. The zero-result fallback in `searchFallback.ts` no
  longer hard-returns `[]` when an explicit `city` has no matches —
  it soft-falls-back to nearby and the orchestrator's spoken text
  frames it honestly ("I don't see any in {city} — I'd recommend
  {fallback_name} instead"). Don't drop this fallback; the
  silent-empty UX was the bug. Adding new cities to the list is
  always safe — the LLM treats them as optional hints, not a
  whitelist.
- **Wake-word auto-listen workaround.** When `Hey Cenaiva` fires,
  `AssistantProvider.open(..., { autoListen: true, greetingText })`
  runs the greeting then opens the mic. Two safety nets in the
  greeting-then-listen block (`AssistantProvider.tsx:745–800`):
  (1) defensive `voice.stopListening()` before `startListening()`
  to clear any half-released session, (2) 200ms `setTimeout` between
  greeting end and `startListening()` so Chrome can release the mic
  from the wake recognizer. If `startListening()` rejects we surface
  it via a TTS prompt ("Tap the mic to start when ready.") instead
  of failing silently. `useCenaivaWakeWord.ts` is still off-limits
  per the existing hard rule — these workarounds avoid touching it.
- **ElevenLabs disable is a 60-second cooldown, never session-permanent.**
  `useCenaivaVoice.ts` tracks ElevenLabs availability as React state
  (`elevenAvailable`, default true). After two consecutive
  `elevenlabs.speak()` failures we set it to `false` AND schedule a
  `setTimeout(..., 60_000)` that flips it back to `true`. The previous
  behaviour — `elevenDisabledRef.current = true` set permanently for
  the session — was the root cause of the 2026-05-09 TTS regression:
  a single transient 429 / network blip silently disabled ElevenLabs
  for the rest of the browser session, dropping the user back to the
  browser Web Speech voice with no UI signal until they hard-refreshed.
  The cooldown self-heals. Never reintroduce a session-permanent
  disable. The `console.warn("[Cenaiva TTS] ElevenLabs failed twice
  — falling back to Web Speech for 60s")` MUST stay so the fallback
  path is visible in DevTools. `useElevenLabsTTS.ts` also rate-limits
  status-code-keyed warnings (`warnedStatuses` set) so a long outage
  doesn't spam the console.
- **Map load errors must surface in UI, not be swallowed.**
  `apps/web/src/lib/google-maps.ts` installs a `window.gm_authFailure`
  global handler on first `loadGoogleMaps()` call. It writes to a
  module-scoped `cenaivaMapsLoadError` and dispatches a
  `cenaiva:google-maps-error` window event. `<CustomerMap>` listens
  via `useEffect` and renders "Map unavailable" + the captured
  reason instead of an empty div. Do NOT reintroduce a silent
  `.catch(() => undefined)` on `loadGoogleMaps()` — auth errors
  (referrer restriction, billing not enabled, key invalid) MUST
  show up in the UI. This was caught 2026-05-09 after the user
  reported "the map system does not work it still says it has no
  access" and the silent error swallow gave no signal to debug.
- **"is X in Y" queries must reach the FULL orchestrator system prompt,
  not the small-prompt short-circuit.** Two parallel classifiers control
  this:
  1. Client `simplePromptIntent.ts` `SPECIFIC_PLACE_LOOKUP_PATTERN` ensures
     Stage 3 (cenaiva-small-prompt) is skipped — but this only handles
     the client-side fast path.
  2. Orchestrator `cenaiva-orchestrate/index.ts:1997-2030`
     `clearlySmallPromptIntent` + `bookingProcessIntent` (line 2040)
     decide whether `isSmallPromptTurn` (line 4137-4144) routes the
     LLM call to `buildSmallPromptSystemPrompt` (line 4197) or to the
     full system prompt with the v172 "factual restaurant questions are
     NEVER personal" rule.
  v174 (2026-05-09) fixed a hijack: "is mark testing in guelph" was
  being classified as a small prompt because no intent in the disjunction
  recognized "is X in Y" patterns, so `isSmallPromptTurn = true` and
  the LLM saw the small-prompt system prompt — which has the legacy
  "if personal identity/self-judgment, say you can't determine that
  for them" rule. The LLM over-generalized that to restaurant facts
  and the user heard "I can't determine that for you. What restaurant
  or area should I book?" — the EXACT small-prompt response shape.
  Fix: added `restaurantFactLookupIntent(transcript)` to
  `bookingProcessIntent` so "is X in/at/open/closed/popular Y" patterns
  flag as a booking-process turn → `isSmallPromptTurn = false` →
  full orchestrator path runs → v172 system prompt is the one the LLM
  reads → search_restaurants is called → row's city is read → answer
  is produced. **Never trust that a system prompt fix runs unless you
  trace which prompt actually reaches the LLM for that turn.** The
  small-prompt path is silent — it doesn't log "I picked the small
  prompt" — so check `isSmallPromptTurn` in DevTools or grep the
  Postgres `assistant_logs` for `metadata.fast_small_prompt = true`.
- **Customer-facing price meter is menu-derived only.**
  `apps/web/src/lib/restaurant-price-level.ts` `deriveRestaurantPriceLevel`
  computes the price level **solely from the median price of items in a
  "Mains/Entrées" category** (`PRICE_LEVEL_CATEGORY_NAMES` =
  `{main, mains, entree, entrees}`). The owner-set `restaurants.price_range`
  column is **not consulted for the meter**; it remains a hint for the
  voice orchestrator's `price_range_max` filter and for promotion/event
  metadata, but never overrides the meter. Reason: previously owner-set
  was authoritative, which let stale or accidentally-set values (e.g.
  `price_range=2` on a restaurant whose menu has no Mains category)
  override the actual menu-derived signal — surprising customers who
  expected the meter to reflect what they'll actually pay. When no
  Mains/Entrées items exist, the meter renders as 3 outlined `$` (empty
  placeholder) via `RestaurantPriceMeter` — owners populate it by
  categorizing items under "Mains" or "Entrées" in the dashboard.
- **Vapi-style per-tool filler is wired in the orchestrator.** Don't
  reinvent. `cenaiva-orchestrate/index.ts:215-222` defines `TOOL_FILLERS`
  mapping `search_restaurants`, `check_availability`, `complete_booking`,
  `patch_post_booking`, `get_menu`, `create_preorder_order`,
  `charge_saved_card` to "One moment please." The instant the LLM
  emits a `tool_calls` finish_reason (line 4787-4799), the orchestrator
  picks the filler for the FIRST tool and sends it as a `speech_chunk`
  SSE event. Lines 4801-4809 add a 2.5s watchdog that fires a SECOND
  filler if the tool round drags on (DB cold start, Stripe, OSM).
  This is the same pattern the user described from their Vapi voice
  agents — the architecture already matches. If a filler isn't
  audible, the bug is downstream (ElevenLabs disabled, streaming TTS
  guard, etc.), not in the orchestrator. Do NOT add a parallel
  filler-emit path on the client; one source of truth.
- **Concurrency engineering is done.** The only remaining ceiling lever
  is compute upgrade (Small ~$5/mo) — only do that when production
  traffic regularly approaches 1,500+ concurrent.
- **CDN was evaluated and declined.** Revisit criteria are documented in
  `CONCURRENCY_PLAN.md` → "CDN deliberation".
- **Hey Cenaiva web↔mobile parity shipped (2026-05-09).** Web's
  `AssistantProvider.sendTranscript` now mirrors mobile's four-stage
  pipeline (local collector → availability → small-prompt →
  orchestrator). Most utterances skip the LLM; only Stage 4 hits
  `cenaiva-orchestrate`. `useCenaivaWakeWord.ts` left untouched per
  user direction. 98 helper tests under `apps/web/src/lib/cenaiva/__tests__/`.
- **`get_available_slots` close-time bound fixed (2026-05-09).** The
  inner loop checked `v_slot_min + v_slot_inc <= v_end_min` (15-min
  slot increment) instead of `v_slot_min + v_turn_mins <= v_end_min`
  (90-min turn time), so a 23:00 close emitted 22:45 starts whose
  bookings ran to 00:15 the next day. Migration
  `20260509100000_get_available_slots_close_time_turn.sql`. Last
  bookable Saturday slot for a 23:00 / 90-turn shift is now 21:30
  (verified against Mark Testing / 2026-05-09 / party=2 → 43 slots,
  first 11:00, last 21:30).
- **Dashboard reservation date filter is restaurant-tz aware
  (2026-05-09).** `useReservations({ date | dateFrom | dateTo })` now
  takes an optional `timezone` and uses `localDayBoundsUtcIso(date,
  tz)` (`apps/web/src/lib/utils/time.ts`) to convert local-date strings
  to UTC bounds. Without this, `T00:00:00` strings got interpreted as
  UTC by PostgREST and Sat-night bookings (22:45 Toronto = 02:45 UTC)
  spilled onto Sunday's reservations view. `ReservationsPage` and
  `OverviewPage` pass `selectedRestaurant.timezone`.

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

## Lessons from the mobile→web mirror (2026-05-09)

- **`react-refresh/only-export-components`** fires on any non-component
  export from a `.tsx` file. Constants → move to a sibling
  `*Constants.ts` (e.g. `assistantStoreConstants.ts`). Provider + hook +
  context value → split into `Provider.tsx` (component) +
  `*-context.ts` (`createContext` + value type) + `useX.ts` (consumer
  hook). Mirrors the existing `auth-context*` / `useUser` triad.
- **Never assign refs in render.** `voiceIdRef.current = props.voiceId ??
  null` outside `useEffect` trips
  `react-hooks/Cannot access refs during render`. Wrap in `useEffect`
  keyed on the source dep.
- **Backend functions can be deployed but uncommitted.** Mobile owned
  `cenaiva-availability` + `cenaiva-small-prompt` — ACTIVE in the live
  project but absent from `supabase/functions/`. Don't conclude
  "missing" from `ls` alone; verify with
  `mcp__plugin_supabase_supabase__list_edge_functions(project_id=…)`.
- **Deployed edge functions can drift from local source.** Caught
  2026-05-09: `create-public-booking` v29 was an old hand-rewrite that
  did `INSERT INTO reservations` directly, bypassing `book_reservation`
  and surfacing raw 23514 CHECK violations to users. Local `index.ts`
  had been correct for weeks but never deployed. **Always cross-check
  the deployed source** with `mcp__plugin_supabase_supabase__get_edge_function`
  when investigating "the path I'm reading doesn't match the error
  signature." Postgres logs alone are not enough — the function ID +
  version in edge-function logs tells you which deployed code ran.
  After any edit to a booking/reservation edge function, redeploy
  before reporting fixed.
- **Vitest config:** explicit imports (`import { describe, it, expect }
  from 'vitest'`) with `globals: false` avoids needing `vitest/globals`
  in `tsconfig.app.json` `types`. Keeps strict TS clean without having
  to re-list every `@types/*` we still want auto-included.
- **Pre-existing build/lint baseline.** `npm run build` was already
  failing on `main` due to 5 errors in `RestaurantPublicPage.tsx`;
  `npm run lint` had 127 problems. Always capture baseline first via
  `git stash --include-untracked` then re-run, so you don't conflate
  pre-existing breakage with new work.
- **Schema drift adapters live at parse boundaries, not in ported
  helpers.** Mobile's `FiltersDelta.cuisine` is `string`; web's is
  `string[]`. Adapted with a `firstCuisine()` helper at the parse site
  inside `recommendationIntent.ts`, not by changing the port's input
  type.
- **Plan files belong outside CLAUDE.md.** When the user provides a
  large source-handoff doc (e.g. `step2-source-handoff.md`,
  `jolly-prancing-clover.md`), keep it as a sibling pointer — don't try
  to inline 1,200-line helper bodies into this file. Reference it from
  the Pointers section.
- **`VITE_*` flags are baked at Vite startup.** Editing `.env` requires
  killing and restarting `npm run dev`. The Cenaiva voice fell back to
  Web Speech for an unknown stretch because the local `.env` had
  `VITE_ELEVENLABS_ENABLED=false`. Always check `.env` for unexpected
  `false` overrides before chasing client-side bugs.
- **Two map libraries shipped concurrently is a smell.** The web app
  loaded both `maplibre-gl` (voice shell) and the Google Maps JS API
  (Discover / Deals) until 2026-05-09. The voice-shell migration to
  Google Maps unifies them; track removal of `maplibre-gl` /
  `react-map-gl` from `package.json` if no other consumer surfaces.

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
