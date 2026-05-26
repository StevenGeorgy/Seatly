# Hold Timer — Mobile Port Guide

**For:** the mobile-side developer (Claude Code, Opus 4.7 1M context).
**Source of truth web commits:** `2b24aa9` (page-scoped timer + Stripe race safety net), `e18d08c` (P0011 refund helper).
**Web file references:** `apps/web/src/hooks/useReservationHold.ts`, `apps/web/src/pages/customer/RestaurantPublicPage.tsx`, `apps/web/src/components/booking/HoldTimerBanner.tsx`, `supabase/functions/stripe-webhook/index.ts`.
**Companion docs:** `DINER_MOBILE_GUIDE.md`, `MOBILE_STRIPE_GUIDE.md`, `RESERVATION_HOLDS_AUDIT.md`.

---

## Context — what we shipped on web

The "Holding your table — X:XX" countdown banner on the booking page used to **survive navigation**: leave the page, come back, the same timer would resume mid-tick. Underneath, every leak became a "phantom-active" `reservation_holds` row on the server that blocked the same diner from booking adjacent times forever (combined with two server-side gaps documented in `RESERVATION_HOLDS_AUDIT.md`).

We rewrote the web behaviour to be **page-scoped**: timer starts fresh on entry, dies on exit, server hold is reliably cancelled. Then we discovered a Stripe race where closing the tab mid-payment could leave the user charged with no reservation — fixed that with a checkout-step guard on the client and an auto-refund safety net in the webhook.

Mobile needs the **client-side** half of this. The **server-side** half (`stripe-webhook` P0011 + P0012 refund paths) is already deployed and benefits all clients — you do NOT need to redo it.

---

## The spec (user-validated)

1. **Start fresh every time** the user enters the booking screen (Details / Menu / Checkout).
2. **One timer across the three steps** — same hold, same countdown. Stepping doesn't reset it.
3. **Tab hide / app backgrounded briefly is NOT leaving** — timer keeps ticking against the same server-side `expires_at`.
4. **Leaving the screen (navigation away, app fully killed, force-close, deep navigation back) = die**: cancel server hold + clear local persisted entry.
5. **Slot change releases the old slot's hold immediately** and starts fresh for the new slot.
6. **Voice handoff stays alive**: when arriving with `?hold=<id>` (deep link param), hydrate THAT specific hold. Silent rehydrate is killed; explicit URL signal is the only resume.
7. **Skip the cancel during the payment step.** This is the Stripe-race protection — see "Lessons learned #5" below.

---

## Server-side context (already done — do not redo)

- `create-reservation-hold` — unchanged. Accepts `restaurant_id`, `shift_id`, `date_time`, `party_size`, optional `idempotency_key`, optional `event_id`/`promotion_id`/`applied_promo_code`. Returns `hold_id`, `expires_at`, `confirmation_code`, `table_ids`, `deposit_amount_cents`, `duration_minutes`, `server_now`.
- `cancel-reservation-hold` — requires `Authorization: Bearer <jwt>` + `apikey`. Body: `{ hold_id }`.
- `heartbeat-reservation-hold` — same auth. Body: `{ hold_id, extend_seconds }`. Returns new `expires_at`.
- `convert_reservation_hold_to_reservation` RPC — fired by `confirm-hold-paid` AND by `stripe-webhook`. Either client can call it; the webhook is the authoritative backstop.
- **Stripe race safety net (already live):** if a deposit PI succeeds but the hold is non-convertible (cancelled or expired-past-grace), the webhook auto-refunds via `_shared/stripe-refund.ts` (sets `reverse_transfer: true` so the connected restaurant gets debited, not Cenaiva).
- **Phantom-active holds auto-cleaned within ≤5 min** (2026-05-26 fix). Two crons now flip `status='active' AND expires_at < now()` rows to `'expired'`: an inline-SQL pg_cron job (`cenaiva_expire_holds_inline`, independent of any edge-fn auth) plus the original edge-fn-based cron (now working after the CRON_SECRET / `verify_jwt = false` fix). **Mobile does NOT need defensive logic** to detect or work around stale "you already have a hold" errors — server keeps state accurate within seconds.

---

## Web → Mobile API mapping

| Web concept | React Native equivalent |
|---|---|
| `sessionStorage` (tab-scoped) | `AsyncStorage` keyed by a screen-instance ID, OR in-memory ref cleared on unmount. SessionStorage's tab-scope doesn't translate cleanly — use in-memory state primarily, persist only if you need cross-launch resume. |
| `pagehide` event | `AppState.addEventListener('change', ...)` listening for transitions to `background` / `inactive`. ALSO React Navigation's `beforeRemove` / `blur` events for in-app screen exits. |
| `document.cookie` for Supabase JWT | `supabase.auth.getSession()` returning the JWT from in-memory client state. Always cached; safe to call synchronously-enough inside an AppState change handler. |
| `fetch(..., { keepalive: true })` | React Native's fetch has no `keepalive` equivalent. Just fire `fetch` normally — RN keeps the JS thread alive briefly during backgrounding so most requests complete. For force-close, request is lost (same as web tab-close beyond keepalive's window). |
| URL search params `?hold=<id>` | Linking deep-link params + React Navigation route params. |

---

## Implementation checklist

1. **Locate the equivalent of `useReservationHold` in mobile** — probably `apps/mobile/src/hooks/useReservationHold.ts` or similar. If it doesn't exist, port the web file structure: state machine of `idle | creating | active | expired | converting | confirmed | error`, `createHold` callback, `updateDiner`/`updateCart` callbacks, `cancelHold`, `grabAgain`.

2. **Add the page-scope guards:**
   - `resumeHoldId` prop. Hydrate from persisted entry only when `resumeHoldId === persisted.holdId`. Otherwise, drop the persisted entry and let auto-create mint a fresh hold.
   - On screen unmount / `AppState` → `background`, clear persisted entry AND call `cancel-reservation-hold` with auth header.
   - On slot change (party_size, date_time, or shift_id change), debounced 400ms: cancel old server hold, clear old persisted entry, mint fresh one.
   - Auto-create effect must fire on **both** `idle` AND `error` status when inputs change (otherwise a single failure freezes the screen — see lesson #4).
   - On hydrate success, seed the drift-detection sentinel (`lastSyncedInputsRef` in web) so subsequent slot changes trigger cancel+recreate (see lesson #3).

3. **Add the checkout-step guard.** New optional prop `inPaymentFlow: boolean`. When true, the unmount/background cleanup **skips** the server cancel (still wipes local state). Wire it from the screen as `inPaymentFlow={step === 'checkout'}`.

4. **Make the banner have three modes:** `active` (countdown), `creating` (spinner + "Reserving your table…"), `error` (red banner with `message`). Without the `creating` mode, the brief sub-second mount before the hold lands looks like a broken UI.

5. **Verify the deep-link path.** Diner taps a `cenaiva://restaurant/:slug?hold=<id>&slot=...` link from voice handoff → screen mounts → resume the specific hold.

---

## Lessons learned (mistakes I made — avoid them)

### 1. `sendBeacon` (web) / fire-and-forget cancel (mobile) without auth silently 401s
The first cut of the web fix used `navigator.sendBeacon` for the cancel-on-unload. **sendBeacon can't carry custom headers** — including `Authorization`. The cancel-reservation-hold edge fn rejects unauthenticated calls. Result: the cancel call landed at the server but did nothing; the hold stayed alive; my "page-scoped timer" was a lie.

The fix was `fetch(..., { keepalive: true })` which DOES support headers. **On mobile, this is moot** — RN's fetch is normal fetch, and backgrounding gives you a brief window to complete the request. Just remember to **always include the JWT** when calling cancel-reservation-hold.

### 2. React unmount cleanup ≠ all-leaving paths
My first version put the cancel inside a React `useEffect` return. That only fires when React tears down the component. It does NOT fire on hard navigation, F5, or tab close — the browser destroys the JS context before React gets a chance. I had to add a `pagehide` listener as a parallel path.

**On mobile**, the equivalent split is:
- **In-app navigation away** (user taps Back, or another tab) → React Navigation's `beforeRemove` / `blur` event.
- **App backgrounded / killed** (user goes home, force-closes app) → `AppState` change to `background`/`inactive`.

You need BOTH listeners. Calling the cleanup twice is fine — it's idempotent.

### 3. Hydrate path skips the drift sentinel — subsequent slot changes silently break
This was caught by the Plan-agent review during the web work, not me. Setup: voice handoff hydrates a hold via `?hold=<id>`. The hook sets `status='active'` but never seeds `lastSyncedInputsRef` (only `createHold` seeds it on success). Later, when the diner changes party size, the drift effect sees `last === null` and early-returns, AND the auto-create effect sees `status !== 'idle'` and early-returns too. Net result: hold is for old party size, screen UI for new party size, server rejects at checkout.

**Mirror the fix on mobile:** when the hydrate path successfully sets `active`, also seed your equivalent of `lastSyncedInputsRef.current = { partySize, dateTime, shiftId }` so subsequent input changes trigger drift detection.

### 4. Error state is sticky if you only retry from `idle`
Original auto-create effect gate was `if (status !== 'idle') return`. When the first attempt failed (e.g. diner_double_book on a phantom hold), state became `error` and stayed there forever. Changing the slot didn't retry because the gate blocked.

**Fix:** retry from `error` too, AND reset the idempotency key when retrying from error (server may have cached the failure by key).

```ts
if (cur !== "idle" && cur !== "error") return;
if (cur === "error") idempotencyKeyRef.current = null;
void createHold();
```

### 5. The Stripe race — most important lesson
Closing the page (or backgrounding the app) at the wrong millisecond can charge the card with no reservation. Sequence:

1. Diner taps Pay.
2. Stripe processes → PI status `succeeded` → card charged.
3. Client is about to call `confirm-hold-paid` to finalise.
4. **In the 1–2 sec gap, the diner closes the tab / backgrounds the app / kills it.**
5. Our cleanup fires `cancel-reservation-hold` → hold status flips to `cancelled`.
6. Stripe webhook fires (lag typically <500ms but SLA allows minutes).
7. Webhook calls the convert RPC — RPC sees `status='cancelled'`, rejects with P0012.
8. **Old behaviour:** webhook silently returns. Diner charged, no reservation, no refund.

**Two-layer fix:**
- **Client (this guide):** when the user is on the checkout/payment step, skip the cancel. Let the hold expire naturally if abandoned. The webhook will still convert it as soon as Stripe confirms payment.
- **Server (already deployed):** when the webhook gets P0012, auto-refund via the canonical `_shared/stripe-refund.ts` helper with `reverse_transfer: true`. Belt + suspenders so a charged card always either gets a reservation or a refund.

Mobile must implement the client half. Without it, the server safety net catches the race, but the diner sees "your card was charged" then a refund later — bad UX. With both layers, the booking just completes normally.

### 6. CLAUDE.md hard rule on refunds
If for any reason you call `stripe.refunds.create()` directly on the mobile side (you shouldn't — refunds are server-only), it MUST use `reverse_transfer: true` for destination charges. The canonical path is `_shared/stripe-refund.ts` on the backend. Mobile-side never refunds directly.

### 7. Same-restaurant same-time on two devices ≠ two holds
The server's create-reservation-hold returns the EXISTING hold if the same diner already has one at that slot, instead of erroring. This means two devices (or two tabs) on the same restaurant + same time + same diner share ONE server hold. If device A cancels the hold (closes/backgrounds), device B's UI keeps ticking down a hold that no longer exists server-side. Device B will discover this only on next heartbeat (within 30s of activity) or when they hit Place Order.

**On mobile**, consider:
- Showing a "this booking is in progress on another device" inline notice (lower priority).
- Or accepting the UX as-is — it's rare and self-correcting via heartbeat.

---

## Verification checklist (manual, mobile)

1. **Fresh entry:** open booking screen, see "Reserving…" → "Holding your table — 29:XX".
2. **Background + foreground in <5s:** timer continues, no fresh hold created.
3. **Background, wait 30s, foreground:** timer continues against same `expires_at`. May see the recovery dialog if hold expired.
4. **Navigate Back to slot picker:** server hold cancelled (verify via DB query), local state cleared.
5. **Re-enter same slot:** brand-new hold ID, fresh 29:XX timer.
6. **Slot change within same screen (party size +1):** old hold cancelled, new hold for new slot, fresh 29:XX.
7. **Force-close app on Details step:** AppState change fires cleanup, server hold cancelled within seconds.
8. **Force-close app on Checkout step:** cleanup SKIPS server cancel. Hold remains alive. Webhook still able to convert on Stripe success.
9. **Open with deep link `?hold=<valid-id>`:** if the same session created that hold, it resumes. If not, falls back to fresh create.

---

## Files to expect to touch on mobile

- `apps/mobile/src/hooks/useReservationHold.ts` (or equivalent) — the bulk of the change.
- The booking screen container that calls this hook — add `inPaymentFlow={step === 'checkout'}` prop, `resumeHoldId={route.params.hold}` prop.
- The hold-timer banner component — extend with the `creating` and `error` modes.

Server-side touched ZERO files. The deploy is already live.

---

## Open follow-ups (not blocking)

Originally flagged in `RESERVATION_HOLDS_AUDIT.md`; resolution status as of 2026-05-26:

1. ~~No cron to flip clock-expired holds to `status='expired'`.~~ **Resolved.** Two crons running every 5 min (inline SQL + edge-fn-based, both functional).
2. The diner-double-book guard's slot_range exclusion constraint still doesn't filter by `expires_at` (Postgres limitation — `now()` isn't immutable so it can't appear in a partial constraint). Mitigated by #1's cleanup keeping the constraint's filter set accurate within seconds. No further action needed unless cron lag becomes operationally relevant.

Mobile work doesn't depend on either.
