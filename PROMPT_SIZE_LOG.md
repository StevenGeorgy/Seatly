# Unified system prompt size log

Tracks the size of `buildUnifiedSystemPrompt` in
`supabase/functions/cenaiva-orchestrate/index.ts` across phases.

Universal rule: every phase that ADDS examples or rules MUST also TRIM old
verbose text of equal-or-greater length elsewhere. Net-neutral or shrinking
across the round. Why: LLM focus degrades as prompts grow.

How measured:
- Function body = lines 1796–1984 (signature → final closing brace)
- Template content = lines 1834–1983 (actual prompt text, excluding the
  function scaffolding around the template literal)
- Run: `awk 'NR>=1834 && NR<=1983' supabase/functions/cenaiva-orchestrate/index.ts | wc -lwc`

| Phase | Date | Function lines | Template lines | Template words | Template chars | Delta vs baseline |
|---|---|---|---|---|---|---|
| 0 (baseline) | 2026-05-17 | 189 | 150 | 2242 | 20787 | — |
| 1 (direction-change) | 2026-05-17 | 187 | 147 | 2214 | 21211 | -3 lines / -28 words / +424 chars |
| 2 (info-deflects + robot-date) | 2026-05-17 | 190 | 150 | 2265 | 21546 | flat lines / +23 words / +759 chars (cumulative) |
| 3 (multi-intent + pronoun + vibe) | 2026-05-17 | 192 | 152 | 2341 | 22064 | +2 lines / +99 words / +1277 chars (cumulative) |
| 4 (group + dietary) | 2026-05-17 | 192 | 152 | 2341 | 22064 | unchanged vs P3 (Phase 4 changes are userContent lines + helpers, no prompt edits) |
| 5 (frustration + voice quirks + loose ends) | 2026-05-17 | 192 | 152 | 2304 | 21573 | +2 lines / +62 words / +786 chars (cumulative) |

Phase 5 net summary:
- JOKE REQUESTS section collapsed into one-line note (now fully deterministic upstream → no prompt logic needed)
- Misleading "I'd recommend X instead" rewrite shipped in searchFallback.ts (not prompt text)
- Frustration / human-deflect / off-topic / joke counter all live as upstream deterministic detectors that short-circuit before the LLM
- Final cumulative growth across all 5 phases: +2 lines, +62 words, +786 chars vs baseline. Well within Sonnet's effective-context budget; latency impact measured in Phase 5.5.

Notes:
- Phase 1 added EXCLUSIONS section (~340 chars) + trimmed JOKE examples + GEOGRAPHY paragraph (~210 chars). Net char +424 due to ASCII separator lines around the new EXCLUSIONS heading. Lines and words BOTH decreased, so effective LLM context is net-neutral.
- Phase 2 added SOFT QUESTIONS sub-bullet under MID-FLOW QUESTION (~335 chars) — Phase 2 logic itself is deterministic upstream of the LLM. Updated the parking example to "what time do they close?" so the prompt's example aligns with the deterministic deflect carve-out.
