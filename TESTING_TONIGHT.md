# Testing checklist — 2026-05-16 evening session

Manual testing checklist for the **reservation hold + Stripe + voice** features shipped today. Use this as your runbook for tonight's session.

---

## What shipped today

- **Reservation hold system** (`HAB_system_efficentsy.md` for the full picture):
  - New `reservation_holds` table + 7 RPCs + 6 edge functions
  - 30-min hold-then-confirm flow on the 3-step web booking
  - Sticky timer banner across all 3 steps
  - `CENAIVA_HOLDS_ENABLED=true` env flag (already set in production)
- **Stripe integration update** (`STRIPE_SETUP.md` Section 9):
  - PI metadata stamping with `hold_id`
  - `confirm-hold-paid` browser-side fast path
  - Webhook fallback with auto-refund on `P0011 hold_expired`
- **Trigger fix:** `generate_confirmation_code` now respects explicitly-set codes (was unconditionally overwriting)
- **Cron fix:** `expire-reservation-holds` uses the permissive-on-unset auth pattern (was returning 401)
- **Race fix:** heartbeat handler no longer overwrites `confirmed` state with `expired`
- **Dialog ref fix:** `DialogOverlay` in `apps/web/src/components/ui/dialog.tsx` now uses `React.forwardRef` so Radix's SlotClone can attach refs without the dev-mode warning

---

## Known issues to verify tonight

### 🟡 Cenaiva voice — multi-turn context loss

**Symptom:** during my Chrome E2E session today, the orchestrator asked the same clarifying question twice in a row over text input:
1. User: *"Book a table for 2 tonight at 8pm"*
2. Cenaiva: *"What restaurant or area should I book?"* ✅ correct
3. User: *"David Duncan House"*
4. Cenaiva: *"That sounds like a lovely choice! What restaurant or area should I book?"* ❌ asked twice

**Hypothesis:** the small-prompt LLM may be handling the second turn as off-topic casual chatter instead of routing to the booking collector. Or `planLocalBookingTurn` isn't picking up the restaurant name in the second turn's context.

**How to test tonight:**
1. Open Cenaiva (mic FAB on any restaurant page)
2. Use **voice** (not text — voice is the primary flow)
3. Say: *"Book a table for 2 tonight at 8pm"*
4. When asked about restaurant, say: *"David Duncan House"*
5. **Expected:** Cenaiva should advance to ask about diner name OR confirm the booking, NOT re-ask "what restaurant?"
6. If it loops: capture the chat_messages row IDs and the spoken_text values — that's the signal of which stage failed.

**Why this may be a test-environment thing only:**
- My test used **text input** (mic was failing to capture audio in Chrome MCP)
- Text input may route differently than voice
- Test was on a logged-in account that already had bookings at that restaurant — diner-double-book guard could have rejected silently

**Files to look at if it reproduces:**
- `apps/web/src/lib/cenaiva/localBookingCollector.ts` — Stage 1 client-side collector
- `supabase/functions/cenaiva-orchestrate/index.ts` — the orchestrator (~600KB, large file)
- `supabase/functions/cenaiva-small-prompt/index.ts` — small-prompt LLM that handles off-topic

### 🟡 Voice transcription — empty transcripts in test conditions

**Symptom:** logs show `[Cenaiva STT] heard: ""` after some voice attempts.

**Root cause:** `useDeepgramTranscription.ts:501` short-circuits to empty when `speechDetectedRef.current === false`. That ref is set to true only when audio RMS crosses `SPEECH_RMS_THRESHOLD = 0.015` (`useDeepgramTranscription.ts:59`).

**This is expected behavior** for quiet/no-audio captures. It's a feature, not a bug — it prevents pinging Deepgram with pure silence.

**Tonight:** verify in a quiet room. If voice transcription works for normal speech, this is healthy. If it FAILS for normal speech, the RMS threshold (0.015) may need to be lowered.

### 🟢 Stripe payment end-to-end (not yet verified live)

Verified in test:
- ✅ Hold has correct `deposit_amount_cents`
- ✅ Payment screen shows correct deposit + pre-order totals
- ✅ Stripe Elements mount with correct amount
- ✅ `create-public-payment-intent` accepts `hold_id`
- ✅ `confirm-hold-paid` RPC verified via backend smoke test

**Not yet verified live (Chrome MCP can't drive the Stripe iframe):**
- Actually paying with `4242 4242 4242 4242` (test card)
- The browser-confirm path firing `confirm-hold-paid` after Stripe success
- The webhook fallback firing `convert_reservation_hold_to_reservation`

**Tonight:** do a real Stripe checkout with the test card. Verify:
1. Card form submits
2. Confirmation screen shows with confirmation code
3. DB has `reservations` row with `deposit_status='charged'`
4. DB has `reservation_holds` row with `status='converted'`

---

## Smoke checklist — do these in order

| # | Scenario | Restaurant | Party | Expected |
|---|----------|-----------|-------|----------|
| 1 | No-payment booking | David Duncan House | 2 | Timer shows, Place Order converts, confirmation screen |
| 2 | Deposit only | Harbour Sixty Steakhouse | 8 | Timer shows, $80 deposit on payment screen, Stripe with `4242…` → confirm |
| 3 | Pre-order only | David Duncan House | 2 + 2 menu items | Timer shows, cart total + tax on payment screen, Stripe with `4242…` → confirm |
| 4 | Deposit + pre-order | Harbour Sixty Steakhouse | 8 + 1 menu item | Timer shows, both amounts visible, Stripe with `4242…` → confirm |
| 5 | Voice — quick booking | Any | 2, no payment | Cenaiva collects time/restaurant, confirms |
| 6 | Voice — deposit hand-off | Harbour Sixty Steakhouse | 8 | Cenaiva returns hand-off URL `?hold=...`, web page picks up the hold |
| 7 | Browse availability | Any | 2 | Times shown reflect existing holds (held slots disabled) |
| 8 | Diner double-book guard | Any | 2 | Try to book overlapping slot — get "You already have a reservation or hold" error |
| 9 | Recovery — let timer hit 0 | Any | 2 | Wait 30 min mid-booking; should see "Your hold ended" modal with Grab it again |
| 10 | Owner dashboard | Owner account | n/a | Confirm holds are INVISIBLE on floor plan (only confirmed bookings show) |

---

## Quick SQL for verification after each test

Run via Supabase MCP or direct SQL:

```sql
-- Recent hold lifecycle
SELECT id, status, expires_at, party_size, deposit_amount_cents, total_amount_cents,
       converted_reservation_id, guest_email, created_at
FROM reservation_holds
WHERE created_at > now() - interval '1 hour'
ORDER BY created_at DESC LIMIT 10;

-- Recently created reservations + their source hold
SELECT r.id, r.status, r.confirmation_code, r.deposit_status,
       h.id AS hold_id, h.status AS hold_status
FROM reservations r
LEFT JOIN reservation_holds h ON h.converted_reservation_id = r.id
WHERE r.created_at > now() - interval '1 hour'
ORDER BY r.created_at DESC LIMIT 10;

-- Cron health
SELECT public.expire_reservation_holds(120) AS expired_count;
-- Should run silently, return 0 most of the time.
```

---

## Rollback if anything breaks

Single env var toggle:

```bash
supabase secrets unset CENAIVA_HOLDS_ENABLED --project-ref exbjodmnpdiayfzrdyux
```

This reverts `create-public-booking` and `_shared/booking.ts` (voice) to the legacy `book_reservation`-immediate-confirm path. The new edge functions stay deployed but unused. New reservations from the moment of unset will be confirmed immediately again.

---

## What to flag if you find a new bug

1. **Capture the network request body** that failed (browser DevTools → Network → the failing call → Copy as cURL).
2. **Capture the `reservation_holds` row state** via the SQL queries above.
3. **Capture the relevant edge function log entry** via:
   ```
   mcp__plugin_supabase_supabase__get_logs project_id=exbjodmnpdiayfzrdyux service=edge-function
   ```
4. **Note the time** so it can be cross-referenced.

Save findings here at the bottom of the file (append; don't rewrite).

---

## Findings (append as you go)

<!-- 2026-05-16 evening session — append issues here -->
