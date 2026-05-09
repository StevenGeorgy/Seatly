# Public Launch Plan — Seatly

Reference doc for taking the booking system from "soft-launch ready" to "public-launch ready." Generated 2026-05-09 after a full booking-flow audit + a 2,250-VU load test.

## Headline state today

- **Verified concurrent-user ceiling:** 2,250 active browsers, p95 ~2.5 s, **0 failures** across 130,787 requests (k6 ramp test on Micro compute, 2026-05-09).
- **Booking correctness:** atomic via `book_reservation` RPC + advisory lock + 3 partial GiST exclusions + identifier CHECK constraint. 4/4 attack vectors blocked in live smoke tests.
- **Frontend booking widget:** unified `<AvailabilityPanel>` on RestaurantPublicPage, RestaurantPreviewModal, and ModifyBookingFields. Single source of conflict UX.
- **Calendar bugs (today):** all fixed — text contrast, outside-month days hidden, null-vs-empty-set distinction.

## Step 1 — Compute upgrade

Sizing is bounded by Supabase compute tier. From documented and measured behavior:

| Tier | RAM | Approximate concurrent ceiling | Monthly cost |
|---|---|---|---|
| Micro (current) | 1 GB | ~2,250 active | $10 |
| Small | 2 GB | ~4,500 active | $25 |
| Medium | 4 GB | ~9,000 active | $60 |
| **Large (recommended for launch)** | 8 GB | ~18,000 active | $110 |
| XL | 16 GB | ~35,000 active | $210 |

**Recommendation: launch on Large (8 GB).** Upgrade the night before launch. It's a one-click operation in the Supabase dashboard and provisions in ~5 minutes. If sustained traffic approaches 12,000+ concurrent (two-thirds of the 8 GB ceiling), upgrade to 16 GB. That upgrade is also one-click with ~30 seconds of downtime.

Do NOT upgrade weeks early — wasted money. Compute scales fast; provisioning is not a launch-day risk.

## Step 2 — What compute alone does NOT fix

The upgrade only addresses the "too much traffic" problem. It does not address:

- Code bugs not yet found
- Deployed-vs-local source drift (today's biggest production bug)
- Lack of automated end-to-end tests
- Lack of alerting on errors and latency
- Missing owner dashboard controls (advance booking days, deposit thresholds)
- The pre-existing 1 orphan reservation row was already cleaned up; verify weekly that no new orphans appear (the CHECK constraint should prevent them)

These are addressed in Steps 3–6.

## Step 3 — Pre-launch hardening (4 days)

### Day 1: Stop today's class of bug from recurring (~3 hours)

- [ ] **CI auto-deploy of edge functions.** GitHub Action that runs `supabase functions deploy <name> --project-ref exbjodmnpdiayfzrdyux` whenever a PR merges to `main` and changed `supabase/functions/**`. Today's `create-public-booking` v29 disaster (deployed code 30+ days behind local) becomes structurally impossible.
- [ ] **Edge-function drift detector.** Script that, for each function in `supabase/functions/`, calls the management API for the deployed version and compares the entry-file SHA. Run before any manual deploy. Fails loudly if drift exists.
- [ ] **Migration drift detector.** Verify every migration file in `supabase/migrations/` is registered in the live project's `supabase_migrations.schema_migrations` table. Today's `promotions.is_private` was a missed migration; same class of bug.

### Day 2: One robot customer test (~4 hours)

- [ ] **Install Playwright** in `apps/web/` (Vitest already there but doesn't do browser automation).
- [ ] **Single end-to-end happy-path test:** open `/r/mark-testing`, click an availability pill, fill in name + email + phone, click Confirm, assert a confirmation code is rendered on the success page. Cleanup: cancel the created reservation by confirmation code.
- [ ] **Wire it into CI** so every PR runs the test. Block merges on failure.

This single test catches 80% of the bugs we found today. Highest ROI item in the entire plan.

### Day 3: Observability (~5 hours)

- [ ] **Sentry on every edge function.** Free tier covers 5,000 errors/month — plenty. Configure to ping a Slack channel for any 500. (~2 hours)
- [ ] **Database-level alert** via `pg_cron` that ticks every 5 minutes and posts to a Slack webhook if `book_reservation` failure count in the last interval exceeds a threshold. (~1 hour)
- [ ] **UptimeRobot** ($0/mo) hitting `https://cenaiva.com` every 5 minutes. SMS on outage. (~10 min)
- [ ] **Grafana / Supabase Studio dashboard** showing: bookings/hour, error rate, p95 latency, current concurrent users, top-5 restaurants by booking volume. (~2 hours)

### Day 4: Launch dress rehearsal (~6 hours)

- [ ] **Re-run k6 against the new compute tier.** Push to 5,000 / 10,000 / 15,000 VUs after upgrading to Large. Confirm the actual new ceiling — don't trust extrapolation alone.
- [ ] **Test the full reservation lifecycle** end-to-end manually: create → modify → cancel → no-show. We have only verified create today.
- [ ] **Mobile compatibility check.** iOS Safari + Android Chrome. Tap targets, calendar interaction, voice (Hey Cenaiva) wake word. Use BrowserStack or actual devices.
- [ ] **Cache warm-up script.** First availability request per `(restaurant, date, party_size)` is slow (~1 second extra) because the `availability_cache` table is cold. Write a script that hits the compact RPC for every active restaurant 5 minutes before launch.
- [ ] **Rollback drill.** Practice rolling back the Vercel (or hosting) deployment once. Know the exact button to click. Time it. Should be under 60 seconds.

## Step 4 — Launch day playbook

### Morning of launch
- Upgrade Supabase compute to Large (8 GB) via dashboard. Wait 5 minutes.
- Verify the upgrade with: `select setting from pg_settings where name = 'shared_buffers'` (Large = ~2 GB).
- Run the cache warm-up script.
- Tail the postgres logs in one tab.
- Open the Sentry dashboard in another tab.
- Open the custom Grafana board in a third tab.

### 30 minutes before public traffic
- Final smoke test: log into the production site, book a table at a low-traffic restaurant, confirm code received.
- Cancel that booking.
- Verify the cancel landed in the dashboard view.

### During launch
- One person on monitoring duty for the first 4 hours minimum. That's you, ideally.
- Watch the three tabs. Don't context-switch.
- Have the rollback command ready in a terminal.

### If things start failing
- Error rate climbs above 1% → investigate, don't panic. Most likely cause: rate limit too tight (`enforceRateLimit` in edge functions — currently 20/min/user for booking).
- Error rate climbs above 5% → roll back the deployment. Investigate offline.
- Latency p95 climbs above 3 seconds → upgrade compute one tier (Large → XL). One click, ~30 seconds.
- Database connections exhaust (look for "remaining connection slots" in postgres logs) → upgrade compute. Pool size scales with tier.

## Step 5 — Post-launch (first 72 hours)

- Watch metrics every 30 minutes.
- Triage every Sentry alert within 1 hour.
- Daily 9 AM standup with yourself: "what broke yesterday, what's the trend, what's queued."
- After 72 hours of stability, drop monitoring cadence to twice daily.

## Step 6 — Things to defer until after launch (real, but not launch-blockers)

- **Phase 3 deposits** — not built yet. Deferred per user direction (2026-05-09). Will require a Stripe SetupIntent → `book_reservation(pending_deposit)` → `stripe-charge-deposit` sequence + a `pg_cron` expiry sweep. Plan in `CONCURRENCY_PLAN.md` (or to be written when scoped).
- **Staff dashboard `advance_booking_days` control** — owners can't adjust the booking window from the UI. Currently global at 3,650 days (effectively unlimited).
- **`create_staff_reservation` friendly error** — raises raw 23514 instead of P0007 when staff submit without an identifier. Cosmetic — staff form requires a name.
- **Staging environment** — every change ships straight to production. Acceptable for a small team but a real liability long-term.

## Total cost

| Item | One-time | Recurring |
|---|---|---|
| Supabase Large compute | $0 | +$100/mo over Micro |
| Sentry (free tier) | $0 | $0 |
| UptimeRobot (free tier) | $0 | $0 |
| Engineering work (4 days) | ~$0 (in-house) | $0 |

## Open questions for the user

1. Confirm 8 GB Large is the right initial tier (vs. 16 GB XL).
2. Confirm willingness to invest ~4 engineering days in pre-launch hardening, or accept higher launch risk.
3. Sentry vs. self-hosted error tracking — Sentry is the lowest-friction default.

## Update history

- 2026-05-09 — Initial plan written after booking-flow audit, 2,250-VU k6 ramp, edge-function drift fix (`create-public-booking` v29 → v30), and unifying `<AvailabilityPanel>` across all 3 booking surfaces.
