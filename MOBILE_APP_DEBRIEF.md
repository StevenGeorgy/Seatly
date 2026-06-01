# Cenaiva Mobile App — Discussion Brief (Capacitor)

**Status:** Discussion only. **Nothing built, no decisions locked.** This captures
the debrief so the team can weigh in before any code is written.
**Date:** 2026-05-31

---

## The one fact that explains everything

We'd build the app with **Capacitor**, which **wraps our existing web app inside a
thin native shell**. The app is literally our site running in the phone's built-in
browser engine (WKWebView on iOS, the system WebView on Android), with a bridge to
native features (camera, push, etc.).

We are **not** bundling a browser (that's Electron, on desktop). Phones already have
a WebView built in. This single fact answers most of the questions below.

---

## Part 1 — The core questions answered

### 1. Will the backend still work?
**Yes.** Every backend call (Supabase, edge functions, Stripe) is just an HTTPS
request to our servers — the server can't tell whether it came from Safari or the
app. Auth, bookings, payments, etc. keep working unchanged.

Items that need **configuration** (not breakage):
- **Google/Apple sign-in** — Google blocks its login inside embedded webviews for
  security. OAuth must use the phone's real browser + a **deep link** back into the
  app. **This is the #1 item to wire up.** Phone-OTP (SMS) login is unaffected.
- **Email / magic links** — confirmation & reset links open a web page today. To
  bounce the user back *into* the app we set up **universal links**. Otherwise they
  open the browser (still works, just less seamless).
- **Allowed origins** — the app's internal address isn't our real domain, so
  Supabase's redirect/allow-list (and Stripe's) needs the app origin added.
- **Apple Pay** — won't work in a plain webview without extra native work. Regular
  card entry via Stripe.js works fine.

### 2. Will the app take too much space?
**No — it's small.** We're not shipping a browser engine; the phone provides the
WebView. The download is the thin shell + our built web files:
- **iOS: ~5–20 MB. Android: ~3–10 MB.** Tiny by app-store standards (many apps are
  50–200 MB).
- Photos load from Supabase/CDN (remote), not bundled, so the app stays lean.

### 3. Can we make it work for iOS and Android?
**Yes — that's the whole point of Capacitor.** One web codebase → both platforms.
- We build/test both from a Mac (iOS needs Xcode, Android needs Android Studio —
  both free).
- To **publish**: Apple Developer account ($99/yr) and Google Play account ($25
  one-time).
- ~95% of code is shared; per-platform bits are just icons, splash, permission text,
  and signing.

### 4. If I add changes, will I have to specify where?
**Almost never.** Normal workflow: edit the React code exactly like today → run one
**sync** command → both iOS and Android pick it up. In development there's a
**live-reload** mode where the app points at the running dev server, so changes
appear instantly with no rebuild.

Native side is touched only occasionally: app icon, splash, permissions, adding a
native feature (e.g. push), or release/signing. A few "is this the app or a
browser?" behaviors live in our **web** code via a one-line platform check — not in
two places.

### 5. Things we might not see coming (concerns)
- **App Store review is the biggest risk, not the tech.** Apple rejects apps that
  feel like "just a website in a wrapper" (Guideline 4.2). Mitigation: add genuine
  native touches (push, native splash, biometric login, offline handling) so it
  reads as an app. *(Removing marketing pages — see Part 3 — directly helps here.)*
- **Apple's payment rules.** Apple takes 30% on *digital* goods bought in-app, but
  **real-world services are exempt** — reservations, deposits, and food are
  real-world, so **Stripe is allowed** there. The grey area is the restaurant's
  **$199/mo subscription** (B2B SaaS billing is generally allowed externally, like
  OpenTable/Uber-style tools). **Confirm before submitting.**
- **Permissions + privacy labels** — location ("near you"), camera (visit
  photos/receipts), mic (if voice ships), notifications. Each needs a prompt and an
  App Store privacy disclosure.
- **Push notifications aren't automatic** — the in-app bell is web-based. Native
  push (booking reminders, "payment failed", etc.) is a separate integration.
- **Voice (Hey Cenaiva)** — our own docs mark voice **out of scope for mobile**. If
  we wrap the same build, the voice UI is still present and would need mic
  permissions. We should deliberately switch it off in the app unless we want it.
- **Maintenance overhead** — two store listings, expiring signing certificates,
  OS/tooling updates, review cycles (hours–days) per release. Web deploys instantly;
  native goes through review. *(An "over-the-air update" option lets web-layer fixes
  skip review — worth setting up later.)*
- **Test on real devices** — simulators don't fully cover camera, push, performance,
  or the notch.

### 6. Later, a separate repo — difficult?
**Not difficult.** Capacitor only needs our **built web folder** — that's its single
dependency on our code.
- **Lowest friction now:** add the app *inside this monorepo* (e.g. `apps/mobile`)
  so web and app never drift.
- **Splitting later:** copy the few Capacitor files + native folders into a new repo
  and feed it the web build (submodule, published package, or a build step). Roughly
  **a day of plumbing, not a rewrite.** Nothing about starting here locks us in.

---

## Part 2 — One app or two?

**Recommendation: two apps, but ONE shared codebase.**

### The cost insight
"Two apps" does **not** mean two projects to maintain. Both apps wrap the **same web
build**. The difference is just: a different name/icon, a different bundle ID, which
screen they open to, and a feature flag or two. A second app is mostly a **second
store listing + a thin config**, not a second codebase.

### Why two apps (it's the industry norm)
Every comparable product splits consumer and operator:
- **OpenTable** (diners) + **OpenTable for Restaurants** (staff)
- **Resy** + **Resy OS**
- **Uber** + **Uber Driver**

Reasons that map onto Cenaiva:
- **Different users** — a diner never needs the floor plan/CRM/expenses; an owner
  doesn't browse "available tonight near you."
- **App Store positioning** — a diner searching "restaurant reservations" should
  find a clean consumer app, not a business dashboard. Two listings = two clear
  pitches/screenshots/review stories.
- **Lower rejection risk** — Apple dislikes unfocused apps. Two focused apps each
  pass more easily.
- **Cleaner payment lane** — diner app = real-world services (Apple-exempt); owner
  app = the B2B subscription (different policy lane). Splitting isolates the risk.
- **Different permissions & push** — diner wants location + "table confirmed"; owner
  wants "new booking / payment failed" + maybe camera for receipts.
- **Size/performance** — the owner dashboard (charts, floor-plan canvas) is heavy;
  diners shouldn't carry it.

### Why one combined app is weaker
A single app that flips diner/owner by login *works technically* (the web already
does this), but for the **public stores** it's worse: muddled positioning, bigger
download for everyone, mixed permissions, harder review, tangled push logic. The web
can be role-adaptive; the **store apps** shouldn't be.

### Sequencing
Build them **one at a time**, not both at once.
- **Diner-first case:** growth lever (more users), simpler screens, clean payment
  policy, lowest-risk way to learn the store/signing/push pipeline once. Owners keep
  using the responsive web meanwhile.
- **Owner-first case (the honest counterpoint):** owners are often **on the floor
  with a phone**, so a native owner app with push for new bookings is genuinely
  valuable.

→ **Open decision:** who do we most want on a phone first — **diners or owners?**

---

## Part 3 — Making it feel like an app (no marketing pages)

Dropping the marketing pages is not only possible — it's the **right instinct**, and
it directly helps with Apple's "is this just a website?" review.

### We fully control what the app shows
Even though the app wraps the same codebase, **we decide where it boots and which
screens exist.** Marketing pages are just React routes — in the app we don't register
them. Levers:
- **Boot point** — the app opens straight into Discover (or login/onboarding), never
  a marketing homepage.
- **An "am I the app?" flag** (`Capacitor.isNativePlatform()`) — any web-only surface
  is hidden/removed when running natively.
- **Optional, cleanest** — build a leaner app bundle that **excludes the marketing
  code entirely** (smaller download, zero chance it appears).

### What gets dropped in the app
Marketing HomePage, the marketing "Restaurants"/"Hey Cenaiva"/Loyalty landing pages,
the marketing nav + footer, cookie/consent banner, "Sign up to learn more" CTAs, and
(for the diner app) the entire owner dashboard.
**Kept, but in Settings:** legal docs (Terms/Privacy) — Apple **requires** a privacy
policy link.

### Where marketing lives instead
On the **web** — its proper home (acquisition funnel + SEO), linking out to the App
Store/Play. The app is the "already downloaded, already a customer" experience.

### "Feel like an app" is more than removing marketing
- **Boot:** native splash → straight into content (or login). No web hero.
- **Navigation:** bottom tabs as the spine (already built), app-style transitions,
  swipe-back.
- **Kill web-isms:** no page-zoom, no text long-press menus, no "install our app"
  banners, no address-bar feel.
- **Native touches:** push notifications, Face ID / biometric login, camera for
  photos/receipts, native share sheet, haptics, status-bar styling, safe-area insets
  (already done).
- **App-like empty/offline states** instead of a broken-looking web page.

### How far to take it — two approaches
- **(A) Reuse screens, hide the web-only bits.** Fastest, one source of truth. Reuse
  Discover/Bookings/Account/restaurant pages, skip marketing, add native polish.
- **(B) App-tuned versions of a few high-traffic flows** (login/onboarding, booking)
  while reusing the same data/hooks. More work, but those screens stop feeling
  "webby." **Even (B) only adds app-specific UI — backend/hooks/data stay
  single-source.**

→ **Recommendation:** start with **(A)** everywhere, then selectively apply **(B)** to
the 2–3 screens that matter most (likely onboarding/login + booking).

### Honest caveat
A polished wrapped app can feel *very* close to native, but isn't 100%
indistinguishable from a ground-up Swift/Kotlin app on the most gesture-heavy
screens. For a reservations product that's almost always a fine trade. If a specific
screen ever feels off, approach (B) fixes that screen without rewriting the app.

---

## Open decisions for the team

1. **One app or two?** (Recommendation: **two apps, one codebase.**)
2. **Which app first — diners or owners?**
3. **How far on native-feel for v1?**
   - **Lightweight:** drop marketing, native boot/splash/tabs, hide web chrome.
   - **Polished:** + push notifications + biometric login + camera/share.
   - **Polished + app-tuned key screens:** + native-feeling onboarding/booking.
4. **Voice in the app — off (recommended, matches our docs) or on?**
5. **Native push notifications — now or later?**
6. **App identity** — app name(s) + bundle ID(s) (e.g. `com.cenaiva.app`,
   `com.cenaiva.restaurants`), and who owns the Apple/Google developer accounts.
7. **Repo layout** — start in this monorepo as `apps/mobile` (recommended) vs.
   separate repo now.

---

## Quick glossary
- **Capacitor** — tool that wraps a web app as a native iOS/Android app.
- **WebView** — the OS's built-in browser component the app runs inside.
- **Bundle ID / appId** — the app's unique identity in the stores (e.g.
  `com.cenaiva.app`).
- **Deep link / universal link** — a link that opens the app instead of the browser
  (needed for OAuth/email flows).
- **OTA / live update** — pushing a web-layer change to installed apps without a full
  store review.
- **Sync** — the command that copies the latest web build into the native projects.
