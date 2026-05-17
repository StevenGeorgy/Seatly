// Vitest runner for the Cenaiva orchestrator eval harness.
//
// USAGE:
//   1. Ensure these env vars are set (in .env or shell):
//        VITE_SUPABASE_URL
//        VITE_SUPABASE_ANON_KEY
//        OPENAI_API_KEY                (for the Layer 4 LLM judge)
//        CENAIVA_EVAL=1                (enables this suite)
//        CENAIVA_EVAL_USER_EMAIL=...   (test user — must have a user_profiles row)
//        CENAIVA_EVAL_USER_PASSWORD=...
//   2. Optionally: CENAIVA_EVAL_JUDGE_MODEL (default: gpt-4o-mini)
//   3. Run: `cd apps/web && npm run eval`
//
// Each scenario runs as its own test. Per-turn assertions use the four layers:
//   1. tool_called          — deterministic, from chat_messages
//   2. tool_input_contains  — deterministic
//   3. booking_field        — deterministic
//   4. judge                — LLM judge for natural-language quality

import { describe, it, expect } from "vitest";

import {
  EVAL_ENABLED,
  checkBookingField,
  checkNoToolCalled,
  checkSpokenLength,
  checkToolCalled,
  checkToolInputContains,
  freshContext,
  judgeResponse,
  runTurn,
} from "./orchestratorEvalHelpers";
import { SCENARIOS } from "./orchestratorEvalScenarios";

const TURN_TIMEOUT_MS = 30000;
const PER_TURN_BUDGET_MS = 30000;

if (!EVAL_ENABLED) {
  describe.skip("orchestrator eval (CENAIVA_EVAL=1 + creds required)", () => {
    it("disabled", () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe("Cenaiva orchestrator eval", () => {
    for (const scenario of SCENARIOS) {
      it(
        `[${scenario.capability}] ${scenario.id}`,
        async () => {
          const ctx = await freshContext();
          const failures: string[] = [];
          let allLatencies: number[] = [];

          for (let i = 0; i < scenario.turns.length; i++) {
            const turn = scenario.turns[i];
            const turnLabel = `Turn ${i + 1}/${scenario.turns.length} (user: "${turn.user}")`;

            const result = await runTurn(turn.user, ctx, {
              timeoutMs: TURN_TIMEOUT_MS,
              overrides: {
                transcript_alternatives: turn.transcript_alternatives,
                visible_restaurant_ids: turn.visible_restaurant_ids,
                user_location: turn.user_location,
              },
            });
            allLatencies.push(result.latencyMs);

            // Layer 1 + 2: tool calls (deterministic)
            if (turn.expect.tool_called) {
              const r = checkToolCalled(result, turn.expect.tool_called);
              if (!r.pass) failures.push(`${turnLabel} — Layer 1 (tool_called): ${r.reason}`);
            }
            if (turn.expect.no_tool_called) {
              const r = checkNoToolCalled(result, turn.expect.no_tool_called);
              if (!r.pass) failures.push(`${turnLabel} — Layer 1 (no_tool_called): ${r.reason}`);
            }
            if (turn.expect.tool_input_contains) {
              const { tool, expect: expectedInput } = turn.expect.tool_input_contains;
              const r = checkToolInputContains(result, tool, expectedInput);
              if (!r.pass) failures.push(`${turnLabel} — Layer 2 (tool_input): ${r.reason}`);
            }

            // Layer 3: booking state
            if (turn.expect.booking_field) {
              const { field, equals } = turn.expect.booking_field;
              const r = checkBookingField(result, field, equals);
              if (!r.pass) failures.push(`${turnLabel} — Layer 3 (booking_field): ${r.reason}`);
            }

            if (turn.expect.max_words) {
              const r = checkSpokenLength(result, turn.expect.max_words);
              if (!r.pass) failures.push(`${turnLabel} — Layer 3 (max_words): ${r.reason}`);
            }

            // Layer 4: judge (LLM)
            if (turn.expect.judge) {
              const verdict = await judgeResponse(turn.user, result.spokenText, turn.expect.judge);
              if (!verdict.pass) {
                failures.push(
                  `${turnLabel} — Layer 4 (judge, ${verdict.confidence} confidence): ${verdict.reasoning}\n    Response was: "${result.spokenText}"`,
                );
              }
            }

            // Latency soft warning
            if (result.latencyMs > PER_TURN_BUDGET_MS) {
              failures.push(
                `${turnLabel} — latency ${result.latencyMs.toFixed(0)}ms exceeded soft budget ${PER_TURN_BUDGET_MS}ms.`,
              );
            }
          }

          const p50 = percentile(allLatencies, 0.5);
          const p95 = percentile(allLatencies, 0.95);

          if (failures.length > 0) {
            throw new Error(
              `Scenario FAILED (${failures.length} issue${failures.length === 1 ? "" : "s"}).\nLatency p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms.\n\n  ${failures.join("\n\n  ")}`,
            );
          }
        },
        // Per-test timeout: enough for 5 turns + judge calls
        scenario.turns.length * (TURN_TIMEOUT_MS + 5000) + 10000,
      );
    }
  });
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}
