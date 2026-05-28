# Split-Tender Feature-Flag Summary
**Date:** 2026-05-28  
**Branch:** `feature-flag-split-tender-off`  
**Decision:** Feature-flag split-tender OFF — keep code compiled + dormant, never delete

---

## Why we flagged it off

Split-tender (multiple cards at booking time) was shipped in PR-K but the team decided it's not worth keeping active:

- No major competitor does split-tender *at booking* — industry standard is split-the-bill *at the table* after the meal
- Carried a permanent ~1.5–2× engineering and QA tax on every future payment/reservation change
- Diner demand is marginal: the booker covers a small deposit ($1.50–$10) and settles with friends via Venmo/etc.
- Risk to existing systems: **2/10** — all split logic sits behind clean `if (split_tender_payers)` / `if (activeRows.length >= 2)` conditionals; solo flows never enter them

---

## What was completed (on branch `feature-flag-split-tender-off`)

| File | Status | Change |
|------|--------|--------|
| `apps/web/src/lib/featureFlags.ts` | ✅ Done | NEW file — exports `SPLIT_TENDER_ENABLED = import.meta.env.VITE_SPLIT_TENDER_ENABLED === "true"` |
| `apps/web/src/vite-env.d.ts` | ✅ Done | Added `readonly VITE_SPLIT_TENDER_ENABLED?: string` to `ImportMetaEnv` |
| `CLAUDE.md` | ✅ Done | Added "2026-05-28 Split-tender FEATURE-FLAGGED OFF" current-state entry + dormant-code rule |
| `STRIPE_TEST_SESSION_PLAN.md` | ✅ Done | Added SKIPPED banner; Phase S marked SKIPPED |

---

## What was completed in the 2026-05-28 continuation pass

All gate code is now applied and the build is green (`tsc --noEmit` clean + `vite build` succeeds). The TS6133 build-breaker is resolved.

### Frontend gates applied ✅

| File | Gate applied |
|------|--------------|
| `apps/web/src/pages/dashboard/ReservationsPage.tsx` | `SPLIT_TENDER_ENABLED &&` on the "Split N/M paid" badge logic AND on the `ReservationDepositBreakdown` mount in the detail dialog. **Resolves TS6133.** Note: solo deposits no longer render the detail-dialog deposit breakdown while off (matches the documented "owner dashboard never shows split badges/breakdown" decision). |
| `apps/web/src/pages/customer/RestaurantPublicPage.tsx` | Added `SPLIT_TENDER_ENABLED` import; wrapped the entire "Split tender" toggle card + party-count input in `{SPLIT_TENDER_ENABLED && (…)}`; added `SPLIT_TENDER_ENABLED &&` to the `SplitTenderPaymentForm` mount condition. Diner only ever sees single-card. `createSplitTenderReservation` (only called from the gated form's `onPreCheckout`) is now unreachable while off, so no `split_tender_payers` payload is sent. |
| `apps/web/src/pages/customer/BookingDetailsPage.tsx` | Added import; `SPLIT_TENDER_ENABLED &&` on split dialog title, explanation text, payer breakdown, and the `SplitTenderPaymentForm` mount (falls to solo `StripePaymentForm`). |
| `apps/web/src/components/customer/ManageBookingView.tsx` | Same gating pattern as BookingDetailsPage. |
| `apps/web/src/components/customer/EditPreorderModal.tsx` | Same gating pattern (explanation, breakdown, form mount). |

### Server gates applied ✅

| File | Gate applied |
|------|--------------|
| `supabase/functions/create-public-booking/index.ts` | Reads `SPLIT_TENDER_ENABLED = Deno.env.get("SPLIT_TENDER_ENABLED") === "true"` right after body parse; returns `400 { unavailable_reason: "split_tender_disabled" }` when off and `payload.split_tender_payers` is present. |
| `supabase/functions/modify-reservation/index.ts` | Module-level `SPLIT_TENDER_ENABLED` const + `splitTenderDisabledResponse()` helper; returns `400 split_tender_disabled` when off and an existing booking is split-tender (`isSplitTenderModify` party-delta path AND `isSplitTenderCart` cart-delta path, both `≥2 charged RDP rows`). Solo deposit modifies unaffected. |

**Note:** the flag defaults OFF when the secret is unset (`=== "true"` is false), so deploying these functions without setting `SPLIT_TENDER_ENABLED` keeps split-tender rejected — exactly the desired off state.

### Still pending (outward-facing — awaiting go-ahead)

- Deploy `create-public-booking` + `modify-reservation` to Supabase prod
- curl-verify `split_tender_payers:2` → `400 split_tender_disabled`
- Push branch + merge to `main` (triggers Amplify prod build)

---

## How to revive split-tender when the time comes

1. Set `VITE_SPLIT_TENDER_ENABLED=true` in Amplify (frontend env)
2. Set `SPLIT_TENDER_ENABLED=true` in Supabase secrets
3. Redeploy `create-public-booking` + `modify-reservation`
4. Rebuild and redeploy the web app

All split-tender code (`SplitTenderPaymentForm`, `ReservationDepositBreakdown`, `proportional-split.ts`, `reservation_deposit_payments`, the settle trigger) stays compiled and type-checked — one env var flip re-enables everything.

---

## What is safe as-is (no changes needed)

- `reservation_deposit_payments` table — shared with solo deposit flows, untouched
- `convert_reservation_hold_to_reservation` RPC — untouched
- Settle trigger (`settle_deposit_on_charge`) — untouched
- All solo booking / deposit / preorder / modify / cancel flows — zero impact

---

## Remaining work to finish the flag-off

1. ~~Fix build: apply `SPLIT_TENDER_ENABLED &&` gate usage in `ReservationsPage.tsx` (resolve TS6133)~~ ✅ done
2. ~~Apply frontend gates to the 4 other files above (read each file first, then edit)~~ ✅ done
3. Apply server gates to both edge functions ✅ done — **redeploy still pending**
4. ~~Run `npx tsc --noEmit` + `npm run build` to confirm clean build~~ ✅ done — both clean
5. Verify curl to `create-public-booking` with `split_tender_payers:2` returns `400 split_tender_disabled` — **pending (needs deploy first)**
6. Commit + push + merge to `main` for Amplify deploy — **commit done on branch; push/merge pending**
