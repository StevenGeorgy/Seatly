# Friendly errors — web app pass (2026-05-16)

Mobile-team handoff for mirroring the friendly-error system shipped on the
web app today. Web behavior is now: every raw error from Supabase / Stripe /
edge fns / storage / network gets mapped to plain-language, before it ever
hits a toast or a banner. Raw error codes never reach diners.

---

## What we built

A single `apps/web/src/lib/errors/` module + an app-root `<AppErrorBoundary>`.
Two helpers do 95% of the work:

```ts
// In a React component:
const { errorToast } = useErrorToast();
try { ... }
catch (err) {
  errorToast(err, {
    fallback: "Couldn't save your menu. Try again.",
    logTag: "[Step5Menu.save]",
  });
}

// Outside React (hooks, utilities):
import { toUserFacingError, showErrorToast } from "@/lib/errors";

const friendly = toUserFacingError(err, "Couldn't load floor plan.");
setError(new Error(friendly.message));
console.error("[useFloorPlan.load]", friendly.code, friendly.technical ?? err);
```

The helper returns:

```ts
type UserFacingError = {
  code: string;       // stable code, safe for analytics / future i18n
  message: string;    // plain-language, ready for toast/banner
  source: "pg" | "auth" | "edge-fn" | "stripe" | "storage" | "network" | "voice" | "unknown";
  retryable: boolean; // hint — "try again" or "fix something"
  technical?: unknown; // raw error, for console.error only
};
```

---

## Mapping table (what gets translated)

| Source           | Inputs the mapper recognizes                             | Example output                                                                 |
|------------------|----------------------------------------------------------|--------------------------------------------------------------------------------|
| Postgres / PostgREST | `P0001`, `P0002`, `P0006`, `P0010`–`P0012`, `23505`, `23P01`, `42501`, `PGRST116`, `PGRST301` | "No table is open at that time. Try another time or party size."               |
| Supabase Auth    | OTP expired/invalid, SMS send failed, weak password, account exists, session expired, rate limit | "That code expired. Tap "Resend code" to get a new one."                       |
| Edge fn response | `unavailable_reason`, `reason`, `code`, `error` fields + HTTP status (401/403/404/409/410/429/5xx) | "Someone just grabbed that time. Pick another slot."                           |
| Stripe           | `decline_code`, `code`, `type` (insufficient_funds, expired_card, incorrect_cvc, 3DS, etc.) | "That card doesn't have enough funds. Try a different card."                   |
| Supabase Storage | 413, MIME, RLS, missing bucket                           | "That file is too big. Pick something under 5 MB."                             |
| Network          | `TypeError("Failed to fetch")`, `AbortError`, `navigator.onLine === false` | "You're offline. Check your connection and try again."                         |

Unknown errors fall through to a generic fallback you control via the
`fallback` option. Original error always preserved in `.technical` for
console.

---

## Mobile equivalents

The mapping logic is platform-agnostic — only the toast surface is different.
For React Native:

| Web                        | Mobile equivalent                                        |
|----------------------------|----------------------------------------------------------|
| `useErrorToast()` (sonner) | Build a `useErrorToast()` that wraps your `Snackbar` / `Toast.show` / `Alert.alert` |
| `showErrorToast()`         | Same, but non-hook (for utilities)                       |
| `toUserFacingError()`      | **Identical** — pure function, drop in as-is             |
| `toUserFacingEdgeError()`  | **Identical** — pure function, drop in as-is             |
| `<AppErrorBoundary>`       | Use `react-native`'s `ErrorBoundary` pattern; same shape |

The pure-function helpers (`toUserFacingError`, `toUserFacingEdgeError`,
`tryMapStripeError`, `tryMapPostgresError`, etc.) have **zero web/DOM
dependencies**. Copy the files directly:

- `lib/errors/types.ts` — drop in
- `lib/errors/postgresErrors.ts` — drop in
- `lib/errors/supabaseAuthErrors.ts` — drop in (but the i18n import would
  need a mobile-side equivalent or just remove if you're not using i18n)
- `lib/errors/stripeErrors.ts` — drop in
- `lib/errors/edgeFnErrors.ts` — drop in
- `lib/errors/storageErrors.ts` — drop in
- `lib/errors/networkErrors.ts` — drop in (uses `navigator.onLine` —
  swap for `NetInfo.fetch()` from `@react-native-community/netinfo`)
- `lib/errors/friendlyError.ts` — drop in
- `lib/errors/useErrorToast.ts` — REWRITE this thin wrapper to call your
  mobile toast lib instead of sonner; same API surface

---

## Pattern cheat-sheet for new code

### 1. Catching errors in components

```ts
const { errorToast } = useErrorToast();

try {
  await doThing();
} catch (err) {
  errorToast(err, {
    fallback: "Couldn't do the thing. Try again.",
    logTag: "[Component.doThing]",
  });
}
```

### 2. Catching errors in hooks (no toast, just setError)

```ts
const [error, setError] = useState<Error | null>(null);

try {
  await doThing();
} catch (err) {
  const friendly = toUserFacingError(err, "Couldn't do the thing.");
  setError(new Error(friendly.message));
  console.error("[useThing.doThing]", friendly.code, friendly.technical ?? err);
}
```

### 3. Edge function responses (raw `fetch`)

```ts
const res = await fetch(url, { ... });
const body = await res.json().catch(() => null);
if (!res.ok) {
  const friendly = toUserFacingEdgeError(res, body);
  errorToast(friendly, { logTag: "[edge-fn-name]" });  // pass the UFE directly
  return;
}
```

### 4. Branching on error type

```ts
const friendly = errorToast(err, { fallback: "Couldn't save." });
if (friendly.code === "diner_double_book") {
  setShowAlternateTimesDialog(true);
}
if (friendly.retryable) {
  setShowRetryButton(true);
}
```

### 5. Composing context

```ts
errorToast(err, {
  context: `Couldn't save category "${name}"`,
  // → toast says: "Couldn't save category "Wine list" — That already exists. Try a different value."
});
```

---

## Patterns to AVOID

```ts
// ❌ Don't do these:
toast.error(err.message);
toast.error(error instanceof Error ? error.message : "Default");
setError(err.message);
throw new Error(error.message);   // raw bubbles to outer catch

// ✅ Do these instead:
errorToast(err, { fallback: "Default", logTag: "[...]" });
const friendly = toUserFacingError(err, "Default");
setError(new Error(friendly.message));
throw new Error(toUserFacingError(error).message);
```

---

## What was converted in the web pass

**Total: ~200 raw-error surfaces across 105 files** converted from raw
`err.message` / `error.message` extractions to friendly mapped messages.

Highlights:
- **Auth & OTP** — PhoneLoginPage, OnboardingPage, AcceptInvitePage, useUpdateProfile
- **Stripe payment** — StripePaymentForm (SCA + decline handling), DepositPayPage, Step8PaymentSetup (Connect + subscription), ConnectedAccountsPage
- **Booking flow** — RestaurantPublicPage (Place Order + paid booking compound), BookingsPage, BookingDetailsPage, ManageBookingView, AccountPage
- **Owner dashboard** — FloorPlanPage (10 raw throws + 2 toasts), ReservationsPage, SettingsPage (image upload), EventsPage, PromotionsPage, OrdersPage, ExportPage
- **Onboarding wizard** — Step1Basics through Step7DepositPolicy (Step8 covered by payment phase)
- **Data hooks** — useFloorPlan, useReservations, useMenuItems, useExpenses, useReceipts, useEvents, useAnalytics, useMyReviewsAndSnaps, useOrders, useStaffRoster, usePromotions, useAvailability, useCenaivaChat, useMyOrders, useMyStaffInvites, useAvailabilityAlerts, useCrmCampaigns, useRestaurantPhotos, useStaffRestaurants, useHostInvites, useOverviewStats, useGuests, useNotifications, useReservationById, useReservationReviewRequests
- **Voice / Cenaiva** — AssistantProvider (orchestrator + STT unavailable toasts), CenaivaVoiceShell (feedback), BookingSheet, CustomerMap (Google Maps load)
- **Misc** — ReceiptsLibrary (upload + scan + delete), DiscoverReviewBanner, ReservationReviewPrompt, NotifyMeButton, AvatarUploadCard, AccountLinkPrompt, PaymentMethodsSection, DepositPolicyEditor, SuggestionPreviewDialog
- **App-root** — `<AppErrorBoundary>` wraps the entire React tree; renders friendly fallback instead of white-screen-of-death on any unhandled render exception

### Untouched on purpose

- `useCenaivaWakeWord.ts` (CLAUDE.md hard rule)
- `useReservationHold.ts` / `useScanReceipt.ts` (already had gold-standard `mapErrorReason` / `friendlyMessage` patterns the new helper was modeled on)
- Pure validation messages (`"Pick at least one day"`, `"Add at least one table"`) — already user-friendly, not error surfaces
- `isSupabaseConfigured()` dev-only guards — config-level, not runtime errors
- Existing `t("auth.errors.signIn.*")` i18n surfaces — already translated and friendly

---

## Verification

- `npx tsc --noEmit -p tsconfig.app.json` — passes with only pre-existing `AssistantProvider.tsx:1201` error (unrelated to this work; line shifted from 1195 → 1201 because new `useErrorToast()` calls added 6 lines above)
- `useCenaivaWakeWord.ts` git diff exit-code 0 (CLAUDE.md hard rule confirmed)
- 142/145 vitest tests pass; 3 failures pre-existing in `sessionPivotIntent.test.ts` + `simplePromptIntent.test.ts` (intent classification, unrelated to error handling)

---

## Not yet done (future)

- **i18n migration** — the helper returns English strings today. To go
  multi-locale, swap each literal message for a `t(key)` call inside the
  per-source mappers, and add the matching keys under `errors.*` in
  `apps/web/src/locales/en/common.ts` + `fr/common.ts`. The `code` field
  on `UserFacingError` is already stable — it doubles as the i18n key
  with no further changes.
- **Sentry / error tracking** — `toUserFacingError` already aggregates
  source + code + technical detail; wire the `console.error` calls (or
  the `useErrorToast` hook itself) into Sentry's `captureException` once
  Sentry is added. The `code` field is the natural Sentry tag.
- **A few hardcoded "Supabase is not configured" guards** were left as-is
  in onboarding steps — these are dev-environment checks that fire only
  if the env is misconfigured (so a real diner never hits them). Folding
  them through the helper is low-priority.

---

## Single source of truth

If you change a friendly message, change it in `apps/web/src/lib/errors/`
NOT at the call site. Call sites only specify `fallback` (unknown errors)
and `logTag` (analytics) — the mapped messages live in one place so they
stay consistent across the app.
