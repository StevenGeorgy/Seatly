# Cenaiva eval harness

Automated test suite that fires real conversations at the deployed orchestrator and grades responses with a 4-layer assertion model. Catches regressions across all 17 /goal capabilities + edge cases.

## What's in it

**3 files** under `apps/web/src/lib/cenaiva/__tests__/`:
- `orchestratorEvalHelpers.ts` — auth, SSE parser, judge LLM, assertion helpers
- `orchestratorEvalScenarios.ts` — 25 starter scenarios (booking, info, search, list/cancel, off-topic, ambiguity, help)
- `orchestratorEval.test.ts` — vitest runner gated on `CENAIVA_EVAL=1`

**1 npm script** added: `npm run eval`

## The 4-layer assertion model

Per turn, any combination of these can be checked:

| Layer | What it checks | Reliability |
|---|---|---|
| 1. `tool_called` / `no_tool_called` | Did the right tool fire? (from `chat_messages` DB rows) | 100% deterministic |
| 2. `tool_input_contains` | Did the tool get the right params? (regex supported) | 100% deterministic |
| 3. `booking_field` / `max_words` | Did state change correctly? Is the response concise? | 100% deterministic |
| 4. `judge` | Did the natural-language response actually answer the user? (GPT-4o-mini judge) | ~95% reliable |

Together: catches wrong tool, wrong params, wrong state, AND wrong wording — even when the AI varies phrasing turn to turn.

## Setup (one-time)

Add these to your `.env` (not `.env.example` — these are secrets):

```bash
# Required
CENAIVA_EVAL=1
CENAIVA_EVAL_USER_EMAIL=your-test-user@example.com   # diner account that exists in user_profiles
CENAIVA_EVAL_USER_PASSWORD=...

# Already present from your existing setup
VITE_SUPABASE_URL=https://exbjodmnpdiayfzrdyux.supabase.co
VITE_SUPABASE_ANON_KEY=...
OPENAI_API_KEY=...    # used for both orchestrator + Layer 4 judge

# Optional
CENAIVA_EVAL_JUDGE_MODEL=gpt-4o-mini   # default; use gpt-4o for harder judging
```

**Test user setup:** create a dedicated diner account (sign up at `/register` or `/phone-login`). The account just needs a `user_profiles` row. Don't reuse your owner account — eval runs may create real reservations on this user.

## How to run

```bash
cd apps/web
npm run eval
```

Output looks like:

```
 ✓ [book] book-skip-ahead-jacobs-tomorrow-8pm-party-2 (2240ms)
 ✓ [book] book-skip-ahead-mark-testing-friday-7pm-party-4 (1890ms)
 ✗ [book] book-slot-by-slot (4280ms)
     Scenario FAILED (1 issue).
     Latency p50=2140ms p95=2140ms.

       Turn 1/2 (user: "I want to book a table at Jacobs") — Layer 4 (judge, high confidence): The reply asked for party size AND date in the same sentence, violating one-question-per-turn rule.
       Response was: "Great — for how many guests and what date and time?"

 ✓ [info] info-jacobs-hours (1820ms)
 ✓ [info] info-jacobs-dietary (2200ms)
 ...

 Test Files  1 failed (1)
      Tests  1 failed | 24 passed (25)
```

Each failure tells you EXACTLY which layer broke and why.

## Workflow for fixing failures

1. Run `npm run eval`
2. Read the failure messages
3. Edit the orchestrator system prompt or tool description in `supabase/functions/cenaiva-orchestrate/index.ts`
4. Re-deploy: `supabase functions deploy cenaiva-orchestrate --project-ref exbjodmnpdiayfzrdyux`
5. Re-run `npm run eval` — see if it now passes
6. Repeat until green

## Adding scenarios

Open `apps/web/src/lib/cenaiva/__tests__/orchestratorEvalScenarios.ts` and append to `SCENARIOS`:

```ts
{
  id: "my-new-scenario",
  capability: "booking",  // free-form label, used in test names
  description: "What this tests, in one sentence.",
  turns: [
    {
      user: "what the user says",
      expect: {
        tool_called: "check_availability",
        tool_input_contains: { tool: "check_availability", expect: { party_size: 4 } },
        booking_field: { field: "party_size", equals: 4 },
        judge: "Did NOT ask follow-up questions. Mentioned 4 people. Reply was warm and brief.",
        max_words: 30,
      },
    },
    {
      user: "follow-up turn",
      expect: { judge: "..." },
    },
  ],
},
```

All `expect.*` fields are optional. Use as many or as few layers as makes sense for the test.

## Cost per run

- **25 scenarios × ~1.5 turns avg** = ~38 orchestrator calls × $0.001 = **$0.04**
- **~30 judge calls** × $0.0005 = **$0.015**
- **Total: ~$0.06 per full eval run.** Negligible. Run as often as you want.

## Scale-up

Starting set is 25 scenarios. To reach the 500 you wanted:
- Booking variants: ~80 (every combination of slot-filling, ambiguity, time formats, party sizes, restaurants)
- Restaurant info Q&A: ~100 (every snapshot field × every phrasing)
- Search/discovery: ~80
- Modify/cancel: ~50
- Off-topic / out-of-pocket: ~100 (jokes, flirty, philosophy, profanity, complaints, identity, accents, mis-spellings)
- Multi-turn edge cases: ~50
- Ambiguity / disambiguation: ~40

I can generate batches when you're ready. Each batch of ~50 scenarios takes me ~15 minutes to write.

## What this DOESN'T test (be honest)

- **Voice/STT/TTS path** — eval hits the orchestrator HTTP endpoint directly. Wake word, Deepgram, ElevenLabs are out of scope. Test those manually in browser.
- **UI rendering** — assertions check the response shape from the orchestrator, not what gets painted to screen.
- **Real Stripe flows** — modify/cancel only verify the orchestrator's TOOL call, not the downstream payment side-effects.

For end-to-end voice + UI testing, use the Playwright `smoke` suite OR Chrome MCP manually.

## Files reference

- `/Users/mark_habbi/Seatly-12/apps/web/src/lib/cenaiva/__tests__/orchestratorEvalHelpers.ts`
- `/Users/mark_habbi/Seatly-12/apps/web/src/lib/cenaiva/__tests__/orchestratorEvalScenarios.ts`
- `/Users/mark_habbi/Seatly-12/apps/web/src/lib/cenaiva/__tests__/orchestratorEval.test.ts`
- npm script: `apps/web/package.json:14` (`npm run eval`)
