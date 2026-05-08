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

## Headline state (2026-05-08)

- **Concurrent-user ceiling: ~2,250** active Discover/Deals browsers on
  Micro compute (Supabase ca-central-1), p95 < 1 s, 0 failures.
- **Booking writes are atomic and double-booking-proof** via
  `book_reservation` + `modify_reservation_slot` + the
  `reservation_tables_no_overlap` exclusion constraint.
- **Concurrency engineering is done.** The only remaining ceiling lever
  is compute upgrade (Small ~$5/mo) — only do that when production
  traffic regularly approaches 1,500+ concurrent.
- **CDN was evaluated and declined.** Revisit criteria are documented in
  `CONCURRENCY_PLAN.md` → "CDN deliberation".

## Hard rules — never violate

- Never bypass `book_reservation` or `modify_reservation_slot` for
  reservation writes. They own the advisory lock + cover-cap recheck.
- Never cache booking writes. The atomic RPC + exclusion constraint own
  correctness; cached writes break that.
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

- **Read cache:** `availability_cache` UNLOGGED table +
  `get_available_slots_cached` (20 s TTL, opportunistic 5 min prune).
- **Batched listing:** `get_available_slots_for_restaurants_compact` —
  returns first 3 future slots per restaurant, strips `table_ids`.
- **Batched range scan:** `restaurant_available_dates(uuid, int, date,
  date) → text[]` — replaces N day-probes.
- **Rate limit:** `check_rate_limit(p_key, p_limit, p_window_seconds)` +
  `_shared/rate-limit.ts` helpers.
- **Atomic write:** advisory lock keyed on
  `(restaurant_id, reserved_at)` — same hash function for create and
  modify so they serialize against each other.

## Stack reminders

- Vite + React 18 + TypeScript strict + Tailwind + shadcn/ui.
- NOT Next.js, NOT App Router, NOT server components.
- Monorepo root: `/Users/mark_habbi/Seatly-12`. Web app:
  `apps/web/`. Edge functions: `supabase/functions/`.
- Supabase project ref: `exbjodmnpdiayfzrdyux` (ca-central-1).
- Type-check before claiming any task done:
  `npx tsc --noEmit -p apps/web`.

## Pointers (read these for the why)

- `CONCURRENCY_PLAN.md` — capacity ceiling, scaling decisions, CDN
  deliberation, all ten Phase 10 + Phase F entries.
- `SPEED_PLAN.md` — per-user latency phases (1–9), frontend perf,
  remaining speed-only follow-ups.
- `WORK_LOG.md` — chronological decisions, gotchas, current production
  state, agent transfer notes.
- `PERFORMANCE_PATTERNS.md` — portable patterns for future projects.

## When in doubt

Stop and ask. Don't infer architectural decisions from old patterns —
the docs above are the source of truth, and they're updated after every
shipped phase. If something in code contradicts a doc, the doc is right
until proven otherwise.
