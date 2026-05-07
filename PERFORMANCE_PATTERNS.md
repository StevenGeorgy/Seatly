# Performance patterns — portable playbook

A reusable checklist for any new web or mobile app. Patterns are durable; specific tools change.

> **Rule zero: measure first.** Every section below is "potentially worth doing." None of it is worth doing without a measurement showing it's the bottleneck. Lighthouse, Chrome DevTools Performance tab, server logs (p95 latency), and APM tools (Sentry, Datadog) tell you where to focus. Don't optimize from a hunch.

---

## 1. Frontend — universal

### Cache layer
- Pick a query library (TanStack Query, SWR, Apollo, RTK Query) and use it for **every** server fetch.
- Configure sensible defaults: `staleTime` 30-60s, no `refetchOnWindowFocus`, `gcTime` ~5 min.
- **Gotcha:** when wrapping fetch hooks, return a stable empty reference (`const EMPTY = []` outside the hook) instead of `data ?? []`. Otherwise downstream `useMemo`s and effects re-fire on every render → infinite loops.

### Defer non-critical fetches
- Add `enabled:` (or equivalent) gates so queries fire only when their data is visible. Tab/route/step state are common gates.
- Step 1 of a multi-step flow should fetch *only* what step 1 renders.

### Lazy load code by route
- Every route gets `React.lazy()` (or framework equivalent). Above-the-fold content stays in the entry; everything else is fetched on demand.
- For heavy components inside a route (maps, charts, PDF viewers), nest a *second* lazy boundary so they only load when the user actually triggers them.

### Prefetch on intent
- Hover (150ms debounce) → prefetch destination data.
- IntersectionObserver (50% threshold) → prefetch as cards scroll into view.
- Dedupe with a per-element `firedRef` so hover and observer don't both fire.
- Both write to the cache layer's keyspace, so when the user clicks, the data is already there.

### Optimistic UI
- For navigation: navigate first, re-validate in parallel, surface a banner if the validation fails.
- For mutations: update the cache immediately, roll back on error.

### Bundle audits (web only)
- Run a bundle visualizer once a quarter or after big dep changes. Look for:
  - Catch-all chunks > 100 KB gzipped
  - Heavy deps loaded eagerly that are only used on specific routes
  - Shared monorepo packages eagerly importing heavy validators (zod, joi)
- **The trap:** lazy-loading a component doesn't help if its chunk is in the entry's `<link rel="modulepreload">` list. Verify by grepping the entry chunk for static imports of the chunk name.

---

## 2. Backend — universal

### Database indexes
- Index every column you filter or join on in a hot query.
- Partial indexes (`WHERE status IN (...)`) are huge if your hot queries always include the same predicate.
- Verify with `EXPLAIN ANALYZE` — confirm `Index Scan` not `Seq Scan`.

### Atomic operations
- Multi-step writes that must succeed or fail together → wrap in a single SQL function / transaction.
- Pair with advisory locks or exclusion constraints when concurrent users could race for the same resource.
- One DB round trip is always faster than five, and removes a whole class of partial-failure bugs.

### Query consolidation
- A common slowness pattern: edge function loops `for restaurant in list: query availability`. Each iteration = one round trip = ~30-100ms latency. 30 iterations = 1-3 seconds.
- Push the loop into a single SQL function that returns everything at once. Often gives a 5-10× win and simpler code.

### Cache invalidation strategy
- Decide upfront how invalidation happens: TTL, event-driven (realtime sub), explicit API call, or a combination.
- Stale data is a common source of "ghost bugs" — make the policy obvious in the codebase.

---

## 3. Mobile-specific (React Native, Flutter, native)

These don't apply to web; web-specific items in section 1 don't apply here.

### App launch time
- Measure cold start, warm start, and resume separately. They have different bottlenecks.
- Defer non-critical providers / contexts until after first paint.
- Avoid running heavy work in `App.tsx` / `MainActivity` startup.

### Image / asset handling
- Use the platform's native image cache (FastImage on RN, NetworkImage with cache on Flutter, `UIImage(named:)` on iOS).
- Lazy-load images on scroll using a `windowSize` virtualized list.
- Pre-size images server-side (or via a CDN like Cloudflare Images) — mobile networks shouldn't be downloading 4MB JPEGs.

### Memory pressure
- Release subscriptions, listeners, and large objects when components unmount.
- Profile with Xcode Instruments / Android Profiler. RSS that grows without bound = leak.

### Offline-first
- Decide which screens work offline (often: read-only views) and which require network.
- Cache reads to local storage (SQLite, MMKV, Realm). Sync writes via a queue with retry.

### Bundle size (RN/Flutter)
- iOS apps over 200 MB get download warnings. Android limits depend on Play Store config.
- Audit large native dependencies, especially crash reporters and ad SDKs.

### Battery
- Avoid background timers / polling. Use push notifications or pull-to-refresh.
- Stop animations and video playback when the app is backgrounded.

---

## 4. Deploy / infra checklist

These are platform-config items, often free wins. Verify they're on:

- [ ] **Compression** (gzip + brotli) on all text responses. ~3× transfer-time reduction. Vercel / Netlify / Cloudflare Pages enable this by default; custom servers don't.
- [ ] **CDN edge caching** for static assets with hashed filenames. Set `Cache-Control: public, max-age=31536000, immutable`. Vercel / Netlify auto-configure this.
- [ ] **HTTP/2 or HTTP/3** at the edge. Modern hosts default to this.
- [ ] **Geographic distribution.** If your DB is in one region and your users are global, every API call costs round-trip latency. Either replicate the DB or cache aggressively at the edge.
- [ ] **Image CDN** with format negotiation (webp / avif). Saves 30-70% per image.
- [ ] **Sentry / error tracking** so you actually find out when prod is slow or broken.

---

## 5. Anti-patterns (don't do these)

- **Optimizing from a hunch.** Always measure first.
- **Caching invalidation as an afterthought.** Decide the strategy upfront.
- **Over-splitting bundles.** Each chunk = HTTP request. Past a point, more chunks slows things down on round-trip-heavy networks.
- **Lazy-loading data that's always needed.** If 95% of users see the data, eagerly fetch it. Lazy is for the *long tail*.
- **Premature SSR.** SSR adds operational complexity. Only worth it for SEO-critical or LCP-critical pages.
- **Trusting Lighthouse single runs.** Variance is high — average 3+ runs before claiming a delta.
- **Optimizing the home page when conversions happen on a different page.** Measure the page that matters to your business.

---

## 6. Order of operations for a new project

If you're starting fresh, do them in this order:

1. **Pick a query library on day one.** Retrofitting later is mechanical work; doing it from the start is free.
2. **Index the hot query columns** as soon as you have a real query.
3. **Lazy-load every route** — basically free if you do it from the start.
4. **Use a host with compression + CDN by default** (Vercel, Netlify, Cloudflare Pages). Free 3× speedup.
5. **Add error tracking + simple p95 latency logging.** You can't improve what you can't see.
6. **Defer everything else until you measure a real bottleneck.**

The order matters: cache layer first because it makes everything else cheaper to reason about. Indexes second because they're the highest-leverage backend change. Lazy loading third because it's free if done early. The rest is reactive — wait for a measurement to tell you what's slow.
