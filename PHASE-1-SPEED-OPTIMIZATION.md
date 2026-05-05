# Phase 1 Speed Optimization Plan

## Recommendation
Do Phase 1 now, then continue building the app.

Phase 1 is the safest optimization pass because it focuses on reducing repeated frontend and Edge Function calls. It should not change booking rules, table assignment logic, payments, CRM, or database schema.

The deeper work should wait:
- Phase 2, realtime cleanup, should happen after dashboard flows are more stable.
- Phase 3, backend/query tuning and load testing, should happen closer to launch when bottlenecks are measurable.

## Why This Matters
The database audit showed the app is not large or messy from a storage perspective. The database is small. The likely issue is repeated activity:

- Realtime calls are very high.
- Availability/table assignment calls are very hot.
- Discovery and preview flows can become expensive if every card asks the backend for too much data.

Phase 1 reduces waste without changing what the user can do.

## Phase 1 Goal
Make booking and discovery feel faster by reducing duplicate and unnecessary requests.

The app should not ask the backend the same question multiple times at once. Availability should be fetched intentionally, reused briefly, and only when the user has committed enough booking input.

## Scope
Phase 1 should include:

- Add short-lived client-side caching for availability requests.
- Deduplicate in-flight availability requests so the same restaurant/date/party request is not sent multiple times at once.
- Keep availability fetches tied to committed date and party size, not scroll-wheel movement or temporary card state.
- Avoid fetching heavy card data until the user opens a preview or interacts with booking controls.
- Preserve the existing booking and availability behavior.
- Keep all database schema and reservation assignment logic unchanged unless a bug requires otherwise.

## Booking System Optimization
The booking flow should work like this:

1. User chooses a date.
2. User chooses and commits party size.
3. Availability is fetched once for that restaurant/date/party combination.
4. If the same request is already running, the app reuses that request.
5. If the same request was just completed, the app uses the short-lived cache.
6. If no times are available, the UI shows unavailable instead of repeatedly retrying.

This should keep the booking system accurate while reducing backend pressure.

## Discovery And Preview Optimization
Restaurant cards should stay lightweight.

Cards should show core saved restaurant data:
- Name
- Cuisine
- Logo or cover photo
- Location summary
- Price level
- Dietary/religious tags
- Rating if real data exists

Cards should not eagerly trigger expensive availability/menu/stat calls for every restaurant unless needed.

Preview modals can load more data because the user has shown intent by opening them.

## Files Likely Involved
Likely files for Phase 1:

- `apps/web/src/hooks/useAvailability.ts`
- `apps/web/src/components/customer/RestaurantPreviewModal.tsx`
- `apps/web/src/pages/customer/DiscoverPage.tsx`
- `apps/web/src/pages/customer/DealsPage.tsx`
- `apps/web/src/pages/customer/RestaurantPublicPage.tsx`
- `apps/web/src/components/dashboard/DashboardSidebar.tsx`

These files are the most likely places where availability calls and preview/card booking state are coordinated.

## What Should Not Change In Phase 1
Do not change:

- Reservation assignment rules.
- Table merging logic.
- Turn-time calculation rules.
- Payment logic.
- CRM segmentation.
- Supabase database schema.
- Campaign logic.
- Public booking confirmation behavior.

Phase 1 is about fewer duplicate calls, not different business behavior.

## Verification Plan
After Phase 1 changes, verify:

- Selecting date, party, and time in a preview still carries correctly to the restaurant page.
- The selected time does not change because of timezone formatting.
- Availability only appears after required booking inputs are selected.
- Unavailable times remain hidden.
- Unavailable date/party combinations show an unavailable state.
- Booking still creates only one reservation.
- The dashboard reservations page still shows the booking.
- Browser network logs show fewer repeated availability calls.
- Focused lint passes for edited files.
- `npm run build` passes.

## Later Phase 2: Realtime Cleanup
Do this later, after the dashboard is more stable.

Goal:
Reduce ongoing database IO from live dashboard screens.

Scope:
- Audit realtime subscriptions in reservations, floor plan, orders, and notifications.
- Ensure every subscription is scoped by selected restaurant.
- Ensure subscriptions only run on pages that need them.
- Ensure subscriptions clean up on page leave or restaurant switch.
- Avoid realtime on public discovery/card pages unless truly needed.

## Later Phase 3: Backend And Launch Scaling
Do this closer to launch, after product flows are stable.

Goal:
Prepare for higher concurrency with measured database and backend improvements.

Scope:
- Load test discovery, preview, availability, booking, dashboard realtime, and campaign sends.
- Use `pg_stat_statements` and Supabase metrics to find real slow queries.
- Add or adjust indexes only where measured queries need them.
- Consider precomputed floor capacity if availability remains hot.
- Consider very short-lived server-side availability caching if needed.
- Review Supabase compute tier, connection pooling, Edge Function limits, backups, and monitoring.

## Success Criteria
Phase 1 is successful if:

- The app feels faster in discovery and booking.
- Availability requests are visibly reduced in network logs.
- Booking behavior remains the same.
- Build passes.
- No database migration is needed.
