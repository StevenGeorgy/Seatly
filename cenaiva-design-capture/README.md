# Cenaiva.com — Full Visual Capture (index)

Captured live from **https://www.cenaiva.com** on 2026-05-30, desktop viewport
**1440×900**, dark mode, **full-page** screenshots (entire scroll height).
**82 screenshots** across every surface the site offers. Logged in as a combined
owner+diner account (restaurant "Georgy Inc" + diner "Steven").

Start with **`00-DESIGN-SPEC.md`** — the self-contained prompt for building the
mobile app identical to this web app. Use the images below as the visual targets.

> Capture notes: a multi-step **booking checkout** (Details → Menu → Payment) and
> the **15-min hold timer** were captured by driving a real booking on a test
> restaurant up to — but NOT through — "Place Order" (no real charge; the hold
> auto-expires). Setup-wizard steps 3–8 were captured by progressing a test draft
> ("Steven Test Cafe Inc") with minimal placeholder data. Nothing was published.

---

## marketing/ — public marketing & landing (no login)
| File | Route |
|---|---|
| 01-home.png | `/` |
| 02-features.png | `/features` |
| 03-hey-cenaiva.png | `/hey-cenaiva` |
| 04-loyalty.png | `/loyalty` |
| 05-restaurants.png | `/restaurants` (for-restaurants / pricing) |
| 06-book-a-demo.png | `/book-a-demo` |
| 07-about.png | `/about` |
| 08-support.png | `/support` |
| 09-not-found-404.png | unknown path → NotFound |

## legal/ — legal & compliance (no login)
| File | Route |
|---|---|
| 01-terms.png | `/terms` |
| 02-privacy.png | `/privacy` |
| 03-refund-policy.png | `/refund-policy` |
| 04-sub-processors.png | `/legal/sub-processors` |
| 05-partner-agreement.png | `/partners/agreement` |
| 06-partner-sub-processors.png | `/partners/sub-processors` |
| 07-partner-agreement-history.png | `/partners/agreement-history` |

## auth/ — authentication & onboarding
| File | Route |
|---|---|
| 01-login.png | `/login` (email/password expanded) |
| 02-login-phone.png | `/login/phone` |
| 03-register.png | `/register` |
| 04-forgot-password.png | `/forgot-password` |
| 05-reset-password.png | `/reset-password` (no token state) |
| 06-onboarding.png | `/onboarding` (diner profile completion) |
| 07-accept-invite.png | `/accept-invite` (no token state) |
| 08-oauth-google.png | "Continue with Google" → Google OAuth consent (external) |
| 09-oauth-apple.png | "Continue with Apple" → Apple OAuth sign-in (external) |

## diner/ — diner-facing app (logged in)
| File | Route |
|---|---|
| 01-find-reservation.png | `/find-reservation` |
| 02-discover.png | `/discover` (list + map) |
| 02b-discover-grid.png | `/discover` (grid view) |
| 03-deals.png | `/deals` (Promotions) |
| 04-bookings.png | `/bookings` (upcoming/past/cancelled) |
| 05-booking-details.png | `/bookings/:id` |
| 06-notifications.png | `/notifications` |
| 07-account.png | `/account` |
| 08-account-voice.png | `/account/voice` |
| 09-account-connected-accounts.png | `/account/connected-accounts` |
| 10-account-privacy.png | `/account/privacy` |
| 11-account-notifications-preferences.png | `/account/notifications-preferences` |
| 12-account-my-data.png | `/account/my-data` |
| 13-account-my-profile-data.png | `/account/my-profile-data` |
| 14-account-sign-in-history.png | `/account/sign-in-history` |
| 15-account-security.png | `/account/security` |
| 16-restaurant-public-page.png | `/:slug` (Blue Blood — booking step 1: Details) |
| 17-restaurant-public-page-nova.png | `/:slug` (nova ristorante) |
| 18-booking-step2-menu-preorder.png | booking step 2: Menu / pre-order (+ hold timer) |
| 19-booking-step3-payment.png | booking step 3: Review & Pay (fee breakdown + Stripe) |

## diner-modals/ — overlays & dropdowns (not their own routes)
| File | Surface |
|---|---|
| 01-review-prompt.png | "Rate your experience" review modal |
| 02-modify-booking.png | Modify booking dialog |
| 03-cancel-booking.png | Cancel reservation confirm dialog |
| 04-restaurant-preview-modal.png | Restaurant preview modal (from Discover) |
| 05-date-picker-calendar.png | Booking date-picker calendar popover |
| 06-discover-filters-panel.png | Discover Filters panel (price/features/radius) |
| 07-account-menu-dropdown.png | Top-bar "My account" menu |
| 08-notifications-dropdown.png | Top-bar Notifications panel |
| 09-cenaiva-voice-shell.png | "Hey Cenaiva" Concierge voice shell overlay |

## owner-wizard/ — restaurant setup wizard + drafts (8 steps / 4 phases)
| File | Step |
|---|---|
| 01-step1-basics.png | Step 1 — Basics (name, address, cuisine, walk-ins, dietary) |
| 02-step2-hours.png | Step 2 — Hours (all closed) |
| 02b-step2-hours-open.png | Step 2 — Hours (a day open → time-range UI) |
| 03-step3-floor-plan.png | Step 3 — Tables / floor plan |
| 04-step4-booking-rules.png | Step 4 — Booking rules (turn time) |
| 05-step5-menu.png | Step 5 — Menu (categories + items + price tier) |
| 06-step6-photos.png | Step 6 — Photos + **Theme color picker** |
| 07-step7-deposit-policy.png | Step 7 — Deposit policy (no deposits) |
| 07b-step7-deposit-tiers.png | Step 7 — Deposit policy (tiers config) |
| 08-step8-payment-setup.png | Step 8 — Payments & publish (Stripe + subscription) |
| 09-preview-as-diner-modal.png | "Preview as diner" full public-page modal |
| 10-drafts.png | `/drafts` |

## owner-dashboard/ — restaurant owner dashboard (`/dashboard/*`)
| File | Route / surface |
|---|---|
| 01-overview.png | `/dashboard` (Overview / service tonight) |
| 02-reservations.png | `/dashboard/reservations` (floor timeline + table) |
| 03-floor-plan.png | `/dashboard/floor-plan` (Konva canvas) |
| 04-staff-invites.png | `/dashboard/staff-invites` |
| 05-orders-preorders.png | `/dashboard/orders` (Pre-orders) |
| 06-menu.png | `/dashboard/menu` |
| 07-crm.png | `/dashboard/crm` |
| 08-analytics.png | `/dashboard/analytics` |
| 09-income-expenses.png | `/dashboard/expenses` (Income & Expenses) |
| 10-events.png | `/dashboard/events` |
| 11-promotions.png | `/dashboard/promotions` |
| 12-export.png | `/dashboard/export` |
| 13-restaurant-info.png | `/dashboard/restaurant` |
| 14-settings.png | `/dashboard/settings` |
| 15-sidebar-collapsed-rail.png | Dashboard with collapsed icon-rail sidebar (⌘B) |
| 16-switch-restaurant-dialog.png | "Switch restaurant" workspace dialog |
| 17-reservation-detail-dialog.png | Reservation detail dialog |
| 18-add-reservation-dialog.png | "Add reservation" dialog (owner manual booking) |

---

## OAuth provider screens — CAPTURED (auth/08, auth/09)
"Continue with Google" and "Continue with Apple" now captured (the external
provider sign-in screens diners land on).

## Surfaces still NOT captured (each needs an explicit authorization or a pasted link)
- **`/reset-password` valid-token form** — without a recovery token the page
  shows an endless **"Loading…"** (that's its true no-token state; see auth/05).
  The set-new-password form only renders after clicking a single-use recovery
  link emailed to the account (stevenhgeorgy@gmail.com) — an inbox we can't read.
  → Paste the reset link, or forward the email, to capture the real form.
- **`/accept-invite` valid-token form** — needs a real staff-invite link. Sending
  one emails a real person and grants restaurant access, so it was blocked as
  out-of-scope for a capture task. → Authorize sending an invite to an address
  you control, or paste an accept-invite link.
- **`/deposit/:id` pay-link** — this is the split-tender / multi-payer magic-link
  page; split-tender is feature-flagged OFF in prod and the account had no
  outstanding deposit. Creating one means a real deposit booking (real charge).
  → Provide a live `/deposit/:id` link, or authorize a deposit booking.
- **Payment-failed modal** (`PaymentFailedModal`) — only renders for a *published*
  restaurant with an actually-failed subscription. Both restaurants here are
  unpublished drafts with no active subscription, so it cannot render without
  changing production subscription data (not permitted).
