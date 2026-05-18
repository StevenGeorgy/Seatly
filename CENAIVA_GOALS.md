# Hey Cenaiva — 5 Sequential Goals

Each goal below is a self-contained `/goal` sticky note. Copy ONE goal into `/goal`, let it run, verify it works, then move to the next.

**Run order matters.** Goal 1 fixes the biggest UX hole and unblocks the rest. Don't skip ahead.

**Universal "don't break" list** (applies to every goal):

- B1 — Send button race protection (button disables on 3rd rapid click)
- B2 — Natural spoken date/time everywhere ("Monday, June fifteenth at 7:00 PM" not "2026-06-15 at 19:00")
- B3 — Confirm-booking button spinner + double-click guard
- B4 — Past-reservation cancel rejection
- R1 — Cancel-after-booking works in ≤2 turns
- R2 — Deposit + pre-order redirect wording explains the why
- R3 — Full ordinal dates in spoken text
- R4 — Dish search ("where can I get sushi") returns restaurants
- R5 — Joke handler tells brief food-themed joke + soft pivot
- R6 — Events + promos search per restaurant AND city-wide
- After-midnight wraparound — restaurants closing past midnight stay bookable
- Header city — shows actual user city (GUELPH) not "TORONTO"
- Booking flow — book → status:"confirming" → 1× "yes" → "Booked!" (no double-yes)

**Universal kill-switch rules** (every goal):

- **Chrome verification is MANDATORY** before marking any item done. Use the `claude-in-chrome` MCP tools to open `http://localhost:5173/discover`, click the Concierge button, reproduce the test scenario through the actual UI (not direct API calls), and capture the result. Direct API tests are fine for debugging during development, but they DO NOT count as "done." If you cannot test in Chrome for any reason, do not mark the item done.
- If you can't finish an item, skip it. Write the reason to `GOAL_<N>_TODO.md` and move on.
- Don't rabbit-hole. If an item takes more than 30 minutes without progress, skip it.
- After every 2 items, run this Chrome regression: open Cenaiva → "book mark testing for 2 monday at 7pm" → click Confirm booking → "You're booked!" card appears with a confirmation code. If broken, fix BEFORE continuing.
- Only touch files in `apps/web/src/components/cenaiva/`, `apps/web/src/hooks/useCenaiva*`, `supabase/functions/cenaiva-*`, and `supabase/functions/_shared/`.
- Never bypass git hooks (`--no-verify`).
- Never run `--force` push or `reset --hard`.

---

## GOAL 1 — Direction-change handling

**Why**: Today users get stuck when they change their mind mid-conversation. The orchestrator writes a "sticky note" of the chosen restaurant into `booking_state` and never erases it. Even saying "forget that" doesn't reliably clear it. This is the single biggest UX hole.

**What to do**:

1. Add a deterministic reset-trigger detector at the top of `cenaiva-orchestrate/index.ts` (before the LLM-first path). Detect these phrases when there's no in-flight booking commit: `forget that`, `forget it`, `never mind`, `scratch that`, `no wait`, `actually no`, `start over`, `clear that`, `different restaurant`, `not that one`, `forget X` (where X fuzzy-matches a known restaurant name). On match → wipe `booking_state` to `initialBooking`, respond: "Cleared. What would you like?"

2. When the user names a NEW restaurant in mid-flow (different from `booking_state.restaurant_id`), auto-clear collected fields (party, date, time, slot_iso, shift_id, pending_action) but keep the new restaurant_id. Today switching restaurants inherits stale fields.

3. Add a "negatives memory" to `assistant_memory.discovery`. When user says "I don't want X" / "not X" / "no X", store X (cuisine, restaurant name, vibe) in a `excluded` array. Next `search_restaurants` call passes this as an exclusion filter so excluded items don't get re-suggested.

4. Strengthen the unified system prompt with 2 worked dialogue examples showing reset handling. Example 1: "book X" → "actually forget X, book Y" → orchestrator confirms Y. Example 2: "I want Italian" → "actually I don't want pasta" → next suggestion excludes pasta-heavy options.

5. Add a `soft_reset` UI action that the BookingSheet listens to. When emitted, the BookingSheet visually clears its in-progress card so the user can see state was wiped.

**How to know it's done** (ALL must be verified IN CHROME via the actual UI, not just direct API):

- Chrome: open Cenaiva → type "book Mark Testing for 4 Friday 7pm" → wait for "Confirming?" → type "forget that, book Harbour Sixty Saturday 8pm" → response confirms Harbour Sixty Saturday 8pm with NO mention of Mark Testing. Screenshot the confirmation card.
- Chrome: type "I don't want sushi" → then "find me dinner" → returned restaurants do NOT include sushi places. Read the spoken response + restaurant cards via `read_page`.
- Chrome: book Mark Testing partway (party + date set) → type "start over" → BookingSheet visually clears, spoken response confirms reset.
- Chrome regression: full booking flow still works (`book mark testing for 2 monday at 7pm` → Confirm button → "You're booked!" with code).

**If stuck**: Skip item 5 first (UI flash is nice-to-have). Item 3 (negatives memory) is the second most-skippable. Items 1, 2, 4 are core — don't skip those.

---

## GOAL 2 — Information lookup

**Why**: Users ask "what time does X open", "is there parking", "what's the dress code" constantly. Today Cenaiva either doesn't know or makes things up (hallucinates). Real diners need accurate answers or honest "I don't know."

**What to do**:

1. Add an `info_query` deterministic detector in `cenaiva-orchestrate/index.ts`. Patterns to catch: `what time does X open`, `are they open Y`, `do they have parking`, `valet`, `wheelchair accessible`, `dress code`, `kid friendly`, `do they take cash/apple pay`, `is there a patio`, `phone number`. When matched, force-call `get_restaurant_snapshot` first, never answer from LLM memory.

2. Extend `restaurant.settings_json` to support these fields (no schema migration needed — JSON is flexible): `parking` (none/free/valet/street), `dress_code` (casual/smart-casual/business/formal), `accessibility_notes` (string), `kid_friendly` (boolean), `payment_methods` (array), `private_dining` (boolean + capacity). Add a SettingsPage UI section so owners can fill these in.

3. Update `_shared/restaurant-snapshot.ts` to include these fields in the snapshot response.

4. Update the unified system prompt: when an info question is asked AND the field is missing in the snapshot, the LLM MUST say "I don't have that info — try calling the restaurant at <phone>" instead of guessing. Add 2 worked examples showing this behavior.

5. Phone number deflection: when user asks for a phone number, return the restaurant's `phone` field directly. If missing, say "I don't have a phone number on file."

**How to know it's done** (ALL must be verified IN CHROME via the actual UI):

- Chrome: open Cenaiva → type "what time does Mark Testing open Friday?" → spoken response gives correct hours (from `hours_json`). Screenshot.
- Chrome: type "do they have parking at Mark Testing?" with parking unset → spoken response says "I don't have that info, call them at <phone>" — NO hallucination.
- Chrome: type "dress code at Harbour Sixty?" → answers if data set, deflects honestly if not.
- Chrome: log in as a restaurant owner, open SettingsPage, set parking + dress_code → reload Cenaiva, ask the question → reflects the new data.
- Chrome regression: full booking flow still works.

**If stuck**: Skip the SettingsPage UI (item 2 UI side) if it gets complex — Mark can fill these via SQL temporarily, and you can verify by querying directly. The deterministic detector (item 1) + honest "I don't know" (item 4) are the must-haves.

---

## GOAL 3 — Multi-intent + complex search

**Why**: Real users compress multiple intents into one sentence: "book Mark Testing Friday 7 and tell me the dress code" or "find Italian under $40 with patio". Today the orchestrator handles ONE intent per turn and drops the rest.

**What to do**:

1. Strengthen the unified system prompt with explicit multi-intent handling rules + 3 worked examples. Rule: "If the user mentions multiple intents (book + question, search + book, modify + ask), handle ALL of them in a single response. Execute actions first, then answer questions inline."

2. Add multi-filter combination in `search_restaurants` tool. Today filters like `cuisine`, `price_range_min/max`, `with_active_promotion`, `event_keyword`, `menu_item_keyword` work singly. Verify they combine correctly when the LLM passes multiple. Test: "Italian under $40 with patio" should pass cuisine=italian, price_range_max=2, AND a vibe/patio filter.

3. Add `vibe` filter to `search_restaurants` and to `restaurant.settings_json`. Vibes: `romantic`, `lively`, `quiet`, `fancy`, `casual`, `business`, `family`, `date_night`, `outdoor_patio`. Owners set these in SettingsPage. The LLM maps natural language ("somewhere romantic") to the vibe filter.

4. Pronoun resolution: track the last set of restaurants the user was offered in `assistant_memory.discovery.last_offered_ids`. When user says "the cheaper one" / "the first one" / "that one" / "the second", resolve against this list. Update the system prompt with examples.

5. Compound booking + info: when user books AND asks an info question in same turn ("Book Friday 7 and what's the dress code"), execute the booking, THEN answer the info question, both in one spoken response.

**How to know it's done** (ALL must be verified IN CHROME via the actual UI):

- Chrome: type "find me Italian under $40 with patio" → restaurants list returns matching all 3 filters. Verify by reading the cards.
- Chrome: type "book Mark Testing Friday 7 and what's their dress code" → reservation creates AND dress code answered in same spoken response. Verify both happen.
- Chrome: type "find me a steakhouse" → assistant offers 2-3 names → type "the cheaper one" → response confirms the lower-priced one. Screenshot.
- Chrome: type "somewhere romantic for 2 Friday" → results filter by vibe=romantic (if vibe data set on restaurants).
- Chrome regression: full booking flow still works.

**If stuck**: Skip vibe (item 3) if owner UI is too big — can ship just multi-filter combination + pronoun resolution. Items 1, 2, 4 are the must-haves.

---

## GOAL 4 — Group + dietary + special requests

**Why**: Groups of 8+ and dietary restrictions are the messiest real-world cases. Today Cenaiva treats every booking the same — doesn't handle "we need a private room for 12" or "find me somewhere fully vegan" well.

**What to do**:

1. Verify and extend deposit hand-off: when `party_size >= 8` AND restaurant has `deposit_tiers`, the orchestrator already triggers deposit. Make sure the spoken text mentions the deposit amount clearly. Extend to handle parties 12+ that may need a private room.

2. Add `private_dining` filter to `search_restaurants` (from Goal 2 — verify it's wired). When user says "private room", "private dining", "we need our own space", "back room", filter to restaurants where `settings_json.private_dining = true`.

3. Plumb the user's `user_profiles.dietary_restrictions` into `search_restaurants` automatically. If the user profile has `dietary_restrictions: ['vegan']`, every search auto-passes a dietary filter unless the user explicitly overrides ("ignore my preferences").

4. Inline dietary acceptance: when user says "I'm vegan", "I'm gluten-free", "no peanuts" during the conversation, save it to `assistant_memory.session_dietary` AND apply to all subsequent searches that turn.

5. Menu allergen Q&A: when user asks "does X have peanuts" / "is the burger gluten-free", call `get_restaurant_snapshot` and check `menu_items.allergens` if present. If allergens not populated, say "I don't have allergen info — please confirm with the restaurant when you arrive." Never guess.

**How to know it's done** (ALL must be verified IN CHROME via the actual UI):

- Chrome: type "book Harbour Sixty for 12 Friday 7" → if `deposit_tiers` set, response includes deposit amount AND mentions hand-off to public page. Screenshot the deposit message.
- Chrome: type "find me a private room for 8" → results filter to restaurants with `private_dining: true`. Read the cards.
- Chrome: type "I'm vegan, find me dinner" → results filter to vegan-friendly places. If user profile has dietary_restrictions, verify that applies automatically.
- Chrome: type "is the ribeye gluten-free at Mark Testing?" → either looks up allergen data OR deflects honestly with "please confirm with the restaurant."
- Chrome regression: full booking flow still works.

**If stuck**: If menu allergen data isn't populated for any restaurant, skip item 5 — just deflect honestly. Items 1–4 are the must-haves.

---

## GOAL 5 — Frustration recovery + voice quirks

**Why**: Real users get frustrated, mumble, mis-pronounce names, ask off-topic things. Voice transcription drops letters. Cenaiva should recover gracefully, not double down.

**What to do**:

1. Frustration-signal detector in `cenaiva-orchestrate/index.ts`. Patterns: `no`, `no no`, `that's not right`, `you're not getting it`, `stop`, `wait wait wait`, `ugh`, repeated negatives within 2 turns. On detection: pause, brief apology, ask what the user wants, DO NOT proceed with last interpretation.

2. "Talk to human" deflection. Patterns: `talk to a person`, `real human`, `manager`, `customer service`. Response: "I'm Cenaiva, I handle bookings via voice. For other help call the restaurant directly at <phone>" (use restaurant phone if in booking_state, else generic).

3. Fix joke counter (currently broken — same joke every time). Track `session_joke_count` in `assistant_memory`. Joke 1 → tell joke + soft pivot. Joke 2 → tell different joke + harder pivot. Joke 3+ → "Save it for the comedy show — what's for dinner?"

4. Fuzzy matcher: add Levenshtein-distance fallback (max edit distance 1) when token-match scoring fails to find a strong match. So "book mrk testing" (missing 'a') still matches "Mark Testing" with score 1 missing-letter penalty.

5. Off-topic acknowledgment for: weather, jokes (use the fixed counter), "are you a robot", "who made you", general chitchat. Brief on-brand response + redirect to booking. Add examples to unified prompt.

6. Remove the misleading "I'd recommend X instead" fallback in `searchFallback.ts`. When dish search returns empty, say "I don't have any restaurants serving X in my list — want me to check their menus anyway?" Do NOT default-recommend an unrelated restaurant.

**How to know it's done** (ALL must be verified IN CHROME via the actual UI):

- Chrome: type "no no no" → orchestrator pauses, asks "what would you like instead?" or similar. Does NOT proceed with prior interpretation. Screenshot the response.
- Chrome: type "talk to a human" → polite deflect with phone number for the relevant restaurant.
- Chrome: type "tell me a joke" → joke 1 + soft pivot. Type "another" → DIFFERENT joke + harder pivot. Type "one more" → polite refusal ("save it for the comedy show"). Confirm joke text differs across turns.
- Chrome: type "book mrk testing for 2 monday 7pm" → matches Mark Testing (was returning nothing before).
- Chrome: type "any burger places" → if zero results, spoken response says "no restaurants in my list serve burgers — want me to check menus anyway?" — NOT "I recommend Mark Testing instead."
- Chrome regression: full booking flow still works.

**If stuck**: Skip item 4 (Levenshtein) if it gets gnarly — can stay with current token matching. Items 1, 3, 6 are the highest UX value.

---

## After all 5 goals

Do a final full Chrome E2E pass:

1. Open Cenaiva → greeting
2. Book a restaurant via voice → confirm card → "Booked!"
3. Cancel via the success card link
4. Search by dish → results
5. Ask info question → snapshot answer
6. Multi-intent ("book + tell me hours") → both handled
7. "I'm vegan, find dinner" → filtered results
8. "Forget that, different restaurant" → reset works
9. "no no" → frustration deflect
10. "Tell me a joke" / "another" / "one more" → escalates correctly

If all pass, Cenaiva is at ~9.5/10 and ready for real beta users.
