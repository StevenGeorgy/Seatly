# Reservation Holds — Phantom-Active Audit

**Date:** 2026-05-26 (findings, while running the page-scoped-timer Chrome verification)
**Status:** 🟡 **Open.** Two server-side gaps surfaced during E2E testing. Neither is caused by the page-scoped-timer fix; both predate it.
**Scope:** `reservation_holds` table + `create-reservation-hold` / `cancel-reservation-hold` edge functions + RPCs.

## TL;DR

A hold's lifecycle should be **active → (converted | cancelled | expired)**. There's no path that flips `'active'` to `'expired'` once `expires_at` passes — and the diner-double-book guard doesn't filter by `expires_at`. Result: every leaked hold (every time `cancel-reservation-hold` fails to actually land, every time the user closes the laptop before heartbeat fires) becomes a permanent "phantom-active" row that blocks the diner from booking that time forever.

**During the page-scoped-timer verification on 2026-05-26**, Mark accumulated 4 phantom rows across May 22 / May 24 (×2) / May 26 that blocked legitimate booking attempts at every overlapping time. Each had `created_at` and `expires_at` exactly 30 min apart (the default TTL) with NO heartbeat extension — i.e. user landed on the page, hold created, user left within 30s, sendBeacon-based cancel silently failed, row stuck forever.

The page-scoped-timer fix (`fetch + keepalive: true + Authorization` cookie token) **prevents new leaks** going forward. It can't heal rows already in the DB, and it doesn't address the underlying server-side gaps.

---

## Issue #1 — No background cleanup of clock-expired `active` holds

**Where:** Postgres schema + (missing) `pg_cron` job.

**The gap:**
```sql
-- Today, this query returns leaked rows in production:
SELECT id, status, expires_at, now() - expires_at AS overdue_by
FROM reservation_holds
WHERE status = 'active' AND expires_at < now();
```

Rows in this set are "phantom-active": the application has moved on (TTL elapsed, user gone, heartbeat dead), but the row's `status` field still claims `'active'`. There's no transition that fires when wall-clock crosses `expires_at`.

**What it breaks:**
- **Diner-double-book guard** (Issue #2) treats them as live conflicts.
- Operator dashboards / queries that filter `status = 'active'` mis-report the actual hold load on a restaurant.
- Over time, the table grows unboundedly with rows that should be tombstoned.

**Severity:** ⚠️ **Medium.** No money loss, but the user-visible symptom (red "you already have a hold at this time" banner blocking legitimate bookings) is high-friction and indistinguishable from a genuine double-book.

**Fix shape:**
- Add a `pg_cron` job (e.g. every 5 min):
  ```sql
  UPDATE reservation_holds
  SET status = 'expired'
  WHERE status = 'active' AND expires_at < now() - interval '30 seconds';
  ```
  The 30 s grace tolerates clock-skew between Postgres and the heartbeat fn.
- Mirror the same logic in the `create-reservation-hold` RPC's pre-check so that an in-flight create doesn't race against the cron.

**Alternative:** add a generated column / view `is_currently_active = (status = 'active' AND expires_at > now())` and refactor every consumer to use that. More invasive but eliminates the cron coupling.

---

## Issue #2 — Diner-double-book guard ignores `expires_at`

**Where:**
- `reservation_holds` table's `slot_range` exclusion constraint (partial, keyed on `user_profile_id` / `guest_email` / `guest_phone`).
- `create_reservation_hold` RPC's pre-insert conflict check.

**The gap:** Both the constraint and the in-RPC check filter by `status = 'active'` only. They do NOT also filter `AND expires_at > now()`. A phantom-active row (per Issue #1) is treated as a live block.

**What it breaks:**
- Diner gets the red "You already have a reservation or hold at this time" banner trying to book a slot whose only conflict is a row that should have died hours/days/weeks ago.
- They can't progress unless: (a) the phantom expires (it won't — see Issue #1), (b) someone manually flips the row, or (c) they pick a time outside the phantom's `slot_range`.

**Severity:** ⚠️ **Medium.** Same blast radius as #1 — combined they create a permanent denial of service for the affected (user, time) pair. Always-on UI friction with no real conflict behind it.

**Fix shape:**
- Update the partial exclusion constraint:
  ```sql
  ALTER TABLE reservation_holds DROP CONSTRAINT <existing_partial_excl>;
  ALTER TABLE reservation_holds ADD CONSTRAINT <name> EXCLUDE USING GIST (
    user_profile_id WITH =,
    slot_range WITH &&
  ) WHERE (status = 'active' AND expires_at > now());
  ```
  (Same shape for the guest_email / guest_phone variants.)
- Update the RPC's pre-check to add the `AND expires_at > now()` clause.

**Dependency:** Cleaner to fix Issue #1 first so the constraint update doesn't suddenly unblock thousands of legitimate-but-currently-phantom rows in a single migration. With cron in place, the population shrinks over time and the constraint change is safer.

---

## Operational observations from the 2026-05-26 verification

- `cancel-reservation-hold` edge fn always returns `{ ok: true }` even when the RPC fails. Confirmed via investigation. Already flagged in 2026-05-19 investigation report. Worth a separate small fix.
- `sendBeacon`-based cancel never carries auth headers; the edge fn rejected our unmount cancellations as unauthenticated. Fixed in client (`useReservationHold.ts` now uses `fetch + keepalive: true` with Bearer token extracted from the `sb-*-auth-token` cookie). Server still 401s if anon — fine, that's the right behavior.
- Heartbeat fn is rate-limited per-user; we don't see this firing in our test data because we always navigate away before the first 30 s heartbeat tick. That's working as designed.

## Recommended order

1. Ship Issue #1 cron (low risk; isolated; backfills the steady-state population).
2. Wait one full day of the cron running so the phantom population drops to roughly zero.
3. Ship Issue #2 constraint + RPC update.
4. (Optional cleanup) Backfill remaining ancient phantoms with a one-off `UPDATE ... WHERE expires_at < now() - interval '7 days'`.

Do NOT bundle #1 and #2 in the same deploy. The constraint update wants a clean steady-state.
