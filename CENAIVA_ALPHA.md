# Cenaiva — Alpha Operations Runbook

Last updated: 2026-05-12

## What this is

The Cenaiva voice booking assistant has been smoke-tested on 132 multi-turn
scenarios. This doc covers what you need to operate it safely with an alpha
cohort (5-50 friendly users) and the kill switches available when things go
wrong.

---

## Alpha cohort onboarding

Send each alpha tester:

> Hey! Trying out Cenaiva voice booking. Open `seatly.app` on Chrome desktop,
> sign in, click **Concierge** in the nav (top right). Try things like:
> - "Book Harbour Sixty for 2 tomorrow at 7"
> - "Any deals tonight?"
> - "Show me my reservations"
>
> If the AI says something weird, click the **thumbs-down** button at the top
> of the drawer — that captures the conversation for me to review.

### What to ask testers to look for
- Did the AI understand your intent?
- Did the booking actually go through?
- Did the response sound natural or robotic?
- Were there awkward pauses?

### What you'll watch
- `cenaiva_feedback` table — every thumbs-down lands here
- `chat_messages` table — full conversation history per user
- `reservations` table — completed bookings (status=confirmed)
- Supabase function logs — search for `kind: "cenaiva_turn"` to see latency

---

## Kill switches

### 1. Disable the AI entirely (UI hide)

Set in Vercel/host env vars:
```
VITE_CENAIVA_AI_DISABLED=true
```
Rebuild + redeploy. The Concierge button disappears. Users still get the
public restaurant pages.

### 2. Disable a specific edge function

Via Supabase dashboard → Edge Functions → cenaiva-orchestrate → Pause.
Voice still opens but every turn returns an error. Use only if cost/abuse
spiking.

### 3. Switch model (cost or quality emergency)

In Supabase env vars:
```
CENAIVA_ORCHESTRATOR_MODEL=gpt-4o-mini   # default
CENAIVA_SMALL_PROMPT_MODEL=gpt-4.1-nano  # default
```
Cheaper: drop both to nano. Smarter: upgrade orchestrator to `gpt-4o`
(~16x cost). No code deploy needed; takes effect on next function cold
start (~1 min).

### 4. Disable a specific Restaurant from voice bookings

```sql
UPDATE restaurants SET is_active = false WHERE id = '...';
```
The fuzzy matcher will skip this row. Restaurant still appears via direct
URL but not in voice search.

---

## Monitoring checklist (run daily during alpha)

### 1. Check feedback dashboard
```sql
SELECT created_at, ai_response, booking_state
FROM cenaiva_feedback
WHERE reviewed = false
ORDER BY created_at DESC
LIMIT 20;
```
For each new entry: read the AI response, decide if it's a real bug.
If yes → add the user's transcript as a new test fixture in
`apps/web/e2e/multi-turn.spec.ts`. Mark `reviewed = true`.

### 2. Check latency
Search Supabase function logs for `"kind":"cenaiva_turn"`. Look at
`total_ms`. Acceptable thresholds:
- p50 < 3000ms
- p95 < 8000ms

If p95 > 10000ms consistently, the LLM is slow — investigate or upgrade
model.

### 3. Check booking completion rate
```sql
-- How many voice-originated bookings completed?
SELECT
  COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
  COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
  COUNT(*) AS total
FROM reservations
WHERE created_at >= now() - interval '24 hours'
  AND source LIKE '%voice%';  -- adjust if you tag source differently
```
Goal: confirmed/total > 0.7

### 4. Check error logs
Supabase function logs → filter by `level: error` or `cenaiva-orchestrate error:`.
Any patterns? Repeating errors = real bug.

### 5. Check Twilio SMS delivery
```sql
SELECT
  channel,
  status,
  COUNT(*) AS cnt
FROM communication_log
WHERE created_at >= now() - interval '24 hours'
GROUP BY channel, status;
```
SMS status='sent' should dominate. 'failed' entries = users not getting
notifications.

---

## Bug triage workflow

When a tester reports a problem:

1. **Reproduce it.** Open browser, log in as your dev account, try the exact
   phrasing. Does it fail the same way?
2. **Capture it as a test.** Add to `apps/web/e2e/multi-turn.spec.ts` under
   Section 1 (regression guards):
   ```ts
   test('user bug DATE: "exact phrasing"', async ({ page }) => {
     const flow: MultiTurnFlow = {
       label: "...",
       turns: [
         { send: "...", expect: /.../, notExpect: /.../ },
       ],
     };
     await runFlow(page, flow);
   });
   ```
3. **Run the smoke locally:** `cd apps/web && npm run smoke -- multi-turn.spec.ts`
4. **Fix the underlying issue** (usually a regex in orchestrator or client
   routing in AssistantProvider).
5. **Re-run.** Confirm green.
6. **Deploy:** `supabase functions deploy cenaiva-orchestrate --no-verify-jwt`
   for backend; push to main for client.

---

## When to escalate from alpha → wider launch

Don't open to broader users until:
- [ ] 7 consecutive days of alpha with <3 thumbs-downs per week
- [ ] All thumbs-downs converted to tests + fixed
- [ ] Smoke test pass rate ≥ 90%
- [ ] p95 latency < 5s consistently
- [ ] Stripe deposit flow tested with real payment (~$1)
- [ ] SMS delivery confirmed working for ≥ 5 different real numbers
- [ ] Booking completion rate ≥ 80%

---

## File reference

| What | Where |
|---|---|
| Voice orchestrator (LLM tool loop) | `supabase/functions/cenaiva-orchestrate/index.ts` |
| Voice shell UI | `apps/web/src/components/cenaiva/CenaivaVoiceShell.tsx` |
| Client routing (Stage 1-4 pipeline) | `apps/web/src/components/cenaiva/AssistantProvider.tsx` |
| Intent classifier | `apps/web/src/lib/cenaiva/simplePromptIntent.ts` |
| Smoke tests | `apps/web/e2e/multi-turn.spec.ts` |
| Feedback table | `cenaiva_feedback` (in Supabase) |
| Mobile mirror guide | `Habbi_The_One.md` (Addendum E for this session) |

---

## Cost budget

At alpha scale (5-50 users, ~5-20 bookings/day):

| Component | Cost per booking | Daily est (20 bookings) | Monthly est |
|---|---|---|---|
| OpenAI (orchestrator + small-prompt) | ~$0.01-0.03 | ~$0.50 | ~$15 |
| ElevenLabs (TTS) | ~$0.05 | ~$1 | ~$30 |
| Deepgram (STT) | ~$0.01 | ~$0.20 | ~$6 |
| Supabase (DB + edge fn) | ~$0.001 | ~$0.02 | ~$0.60 |
| Twilio (SMS) | ~$0.01 | ~$0.20 | ~$6 |
| **Total** | **~$0.07** | **~$1.90** | **~$58** |

If usage spikes 10x without proportional bookings, an attacker may be
abusing voice — check `rate_limit_buckets` and consider tightening rate
limits.
