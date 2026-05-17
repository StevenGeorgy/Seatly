# Cenaiva Voice Agent Rebuild — Master Plan

Date: 2026-05-16. Status: PLANNED → EXECUTING.

## Decisions (locked)

- **Model**: `gpt-4.1-mini` (OpenAI, 90-93% tool accuracy, ~500ms TTFT, $4.5K/mo at 180K turns/day)
- **Cutover**: rip-and-replace (just-me testing, no real diners)
- **Architecture**: single-prompt + tools + injected user context + flow rules in prompt + skip-ahead slot fill (Vapi pattern)

## Architecture diff

```
BEFORE                              AFTER
─────────                            ─────────
Stage 1: planLocalBookingTurn        DELETED (rules absorbed into prompt §9)
Stage 2: client-side availability    DELETED (orchestrator already has tool)
Stage 3: useCenaivaSmallPrompt       DELETED (orchestrator handles inline)
Stage 4: useCenaivaOrchestrator      → THE ONLY STAGE (with bigger context)
```

## New tools added (12 total: 8 existing + 4 new)

| Tool | Purpose | Wraps |
|---|---|---|
| `modify_reservation` | Move existing reservation | existing `modify-reservation` edge fn |
| `cancel_reservation` | Cancel with confirmation | existing `cancel-reservation` edge fn (actor:"diner" hardcoded) |
| `get_restaurant_snapshot` | Full info card for ANY restaurant Q&A | new helper at `_shared/restaurant-snapshot.ts` |
| `transfer_to_human` | Escape hatch | logs + navigates to `/find-reservation?support=1` |

## System prompt structure (~2200 tokens, OpenAI prefix-cached)

Rendered order: §1 IDENTITY → §2 RESPONSE → §3 GUARDRAILS → §6 TOOLS → §7 FLOWS → §8 EDGE CASES → §9 SKIP-AHEAD → §4 CALLER CONTEXT (dynamic) → §5 RESTAURANT SNAPSHOT (dynamic)

Cached prefix ~1785 tokens. Dynamic suffix ~500 tokens.

## User context injected per session (NEW)

- First name (greeting)
- Upcoming reservations (up to 3) — model can reference "your Jacobs booking Saturday"
- Dietary preferences / allergies
- Saved card last 4
- Location (lat/lng)
- Timezone + local time + meal context

## Restaurant snapshot (NEW)

Loaded via `get_restaurant_snapshot(restaurant_id)` tool when restaurant becomes active. Includes:
- Hours (today + weekly)
- Address/phone/website/social
- Cuisine / business type / price / rating
- Dietary tags, dress code, parking (when populated in settings_json)
- Top 3 reviews
- Up to 5 active events
- Up to 5 active promotions
- Up to 6 featured menu items
- Deposit policy
- 5-min in-process cache

## Files changed

### NEW
- `supabase/functions/_shared/restaurant-snapshot.ts` — helper
- `apps/web/src/lib/cenaiva/__tests__/orchestratorEval.test.ts` — eval harness (Phase B, optional)

### MODIFIED
- `supabase/functions/cenaiva-orchestrate/index.ts` — new system prompt + 4 new tools + 4 new handlers + emit `tool_use` SSE frame for eval observability
- `supabase/functions/_shared/openai.ts` — change `ORCHESTRATOR_MODEL` to `gpt-4.1-mini`
- `apps/web/src/components/cenaiva/AssistantProvider.tsx` — delete Stages 1/2/3, trim ~190 lines, slim request body

### LEFT ALONE (per CLAUDE.md hard rules)
- `apps/web/src/hooks/useCenaivaWakeWord.ts`
- `apps/web/src/lib/cenaiva/localBookingCollector.ts`
- `apps/web/src/lib/cenaiva/simplePromptIntent.ts`
- `apps/web/src/lib/cenaiva/restaurantAdapter.ts`
- All other `apps/web/src/lib/cenaiva/*.ts`
- All 98 cenaiva tests under `apps/web/src/lib/cenaiva/__tests__/`

## Test fixtures (real DB rows)

- Primary: `Jacobs & Co. Steakhouse` (id `a1000007-1111-1111-1111-000000000007`, Toronto, 28 menu items, 2 events, 2 promos)
- Secondary: `Mark Testing` (id `aaa5e3d3-d8f2-4bae-8615-dc4e6ea83d2c`, Guelph, deposit tiers)
- Tertiary: `Georgy Inc` (id `428964af-02b8-45ca-8973-3617b91bd718`, Milton, low-data edge case)

## Pre-existing test failures to leave unchanged

1. `sessionPivotIntent.test.ts:69` — `"do you have a girlfriend"` over-matches BOOKING_ADJACENT
2. `localBookingCollector.test.ts` (2 tests) — restaurant-name prompt phrasing drift

These should STILL fail after rebuild. Not regressions.

## Pass criteria

- `npx tsc --noEmit -p apps/web/tsconfig.app.json` clean (only pre-existing `AssistantProvider.tsx:1201` error)
- `npm run test:run` — same pass count as before (3 pre-existing failures unchanged)
- `git diff --exit-code -- apps/web/src/hooks/useCenaivaWakeWord.ts` empty
- `git diff --exit-code -- apps/web/src/lib/cenaiva/` empty (all mobile-mirror files)
- Chrome smoke 7/7 (if time permits)

## Rollback

```bash
git revert <rebuild-commit-range>
# OR for unpushed:
git reset --hard <pre-rebuild-sha>
# Edge fn re-deploy:
git checkout <pre-rebuild-sha> -- supabase/functions/cenaiva-orchestrate
supabase functions deploy cenaiva-orchestrate --project-ref exbjodmnpdiayfzrdyux
```

---

Detailed planner outputs preserved in agent transcripts. This doc is the canonical summary.
