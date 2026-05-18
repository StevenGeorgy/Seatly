# Cenaiva orchestrator latency baseline — 2026-05-17

Baseline for `/cenaiva-orchestrate` end-to-end latency before Round 4.
Compare against in Phase 5.5 to catch regressions from added detectors.

## Status: DEFERRED

The orchestrator requires a JWT (per CLAUDE.md "Hey Cenaiva is logged-in
users only"), and synthetic curl benchmarks don't reflect real-world latency
(missing pre-LLM filler, TTS warmup, etc.).

**Capture in Chrome instead during Phase 1 verification**: use the
`/cenaiva` debug overlay (`VITE_CENAIVA_VOICE_DEBUG=true`) to read
`useCenaivaLatencyBudget()` stage timings during the 4 Phase 1 acceptance
tests + a clean booking. Record p50 per stage:

| Stage | p50 target | Phase 0 measured | Phase 5.5 re-measured | Delta |
|---|---|---|---|---|
| planLocalBookingTurn | 0-50ms | TBD | TBD | TBD |
| cenaiva-availability | 200-800ms | TBD | TBD | TBD |
| cenaiva-small-prompt | 400-1500ms | TBD | TBD | TBD |
| cenaiva-orchestrate (SSE) | 1.5-8s | TBD | TBD | TBD |

Acceptable Phase 5.5 regression: < 20% increase on any single stage.
If regression > 20%, root-cause before Phase 6.

## Phase 5.5 status — 2026-05-17

Phase 0 baseline not captured (Chrome FAB-open path was non-obvious in the
initial pass and the team chose to capture latency live during Phase 6 instead
of synthesizing it upfront). Capture both baseline AND post-deploy timings
during Phase 6 by enabling `VITE_CENAIVA_VOICE_DEBUG=true` and reading the
`useCenaivaLatencyBudget()` overlay during Section B (clean booking flow).

Prompt size deltas — see PROMPT_SIZE_LOG.md:
- Cumulative growth: +2 lines / +62 words / +786 chars (3.8% chars) vs Phase 0
- Phase 5 trimmed the JOKE section by collapsing to a single line (joke handling
  is now fully deterministic upstream) — recovered ~470 chars vs Phase 3 peak
- Net effective context impact: minimal; below thresholds where Sonnet focus
  degrades in observed practice (~25% growth on a >5000-word prompt)
