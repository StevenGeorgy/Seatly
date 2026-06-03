# Cenaiva — Mobile App Design Spec (make it IDENTICAL to the web app)

> Paste this whole document to Claude (or any designer) when generating the
> mobile app. It encodes the exact design system of the Cenaiva web app
> (cenaiva.com) so the mobile build reads as the **same product** — same theme,
> same type, same components, same UX. Pair it with the screenshots in this
> folder (see `README.md` for the index). Every value below was pulled from the
> live frontend (`apps/web/src/index.css`, `tailwind.config.ts`, `index.html`,
> `components.json`, `package.json`, the shadcn `ui/` variants) and confirmed
> against the live site, including the in-product theme picker (wizard Step 6),
> which shows Primary `#C9A84C`, Accent `#22C55E`, Background `#0A0A0A`.

---

## 0. The one-paragraph brief

Cenaiva is a **dark-luxury restaurant-tech** product: a near-black canvas,
a single **champagne-gold** accent, **serif display headings** (Fraunces) over a
clean **sans body** (Geist), and flat surfaces layered by subtle greys and thin
borders — **no drop shadows except a faint gold glow on the primary button**.
It feels like a high-end Toronto steakhouse menu turned into software:
editorial, calm, expensive, confident. The mobile app must reproduce this exactly
— same tokens, same type pairing, same component shapes — and only *adapt
layout* for small screens (sidebar → tab bar, wide tables → stacked cards).

Two surfaces share the system: the **diner app** (discover, book, pre-order, pay,
manage reservations, account) and the **restaurant owner dashboard** (overview,
reservations, floor plan, menu, CRM, analytics, etc.). Both are dark-mode only.

---

## 1. Color tokens (EXACT — dark only; `:root` == `.dark`)

The web app is hardcoded dark (`<html class="dark">`); light and dark token
blocks are byte-identical. Use these literal HEX values as your theme constants.

### Core semantic tokens
| Token | Hex | Use |
|---|---|---|
| `background` | `#0A0A0A` | app canvas (near-black) |
| `foreground` | `#FFFFFF` | primary text on canvas |
| `card` / `popover` | `#1A1A1A` | cards, sheets, menus, surfaces |
| `card-foreground` | `#FFFFFF` | text on cards |
| `secondary` / `muted` / `accent` | `#242424` | elevated chips, inputs-bg, hover fills |
| `secondary-foreground` / `accent-foreground` | `#FFFFFF` | text on elevated |
| `muted-foreground` | `#666666` | secondary/disabled text, captions |
| `border` / `input` | `#2E2E2E` | hairline borders, dividers, input borders |
| `primary` | `#C9A84C` | **brand gold** — primary buttons, active nav, links, focus |
| `primary-foreground` | `#0A0A0A` | text/icon ON gold (black) |
| `ring` | `#C9A84C` | focus ring (gold) |
| `destructive` | `#EF4444` | errors, cancel/danger |

### Brand + themeable surface vars (keep these as runtime-overridable)
The web app exposes these so a restaurant can re-theme its own public page.
Mirror them as overridable theme variables, defaulting to:
| Var | Hex |
|---|---|
| `--gold` | `#C9A84C` |
| `--gold-light` | `#F5E6C8` |
| `--gold-dark` | `#A8873A` |
| `--bg-base` | `#0A0A0A` |
| `--bg-surface` | `#1A1A1A` |
| `--bg-elevated` | `#242424` |
| `--text-primary` | `#FFFFFF` |
| `--text-secondary` | `#AAAAAA` |
| `--text-muted` | `#666666` |
| `--tw-border` | `#2E2E2E` |

### Status / chart colors
| Name | Hex |
|---|---|
| success | `#22C55E` |
| warning | `#F59E0B` |
| danger / destructive | `#EF4444` |
| info | `#3B82F6` |
| cleaning (table state) | `#6B7280` |
| blocked (table state) | `#374151` |
| chart-1…5 | `#C9A84C`, `#22C55E`, `#3B82F6`, `#F59E0B`, `#666666` |

### Restaurant theme picker defaults (confirmed live)
Primary = **Gold `#C9A84C`**, Accent = **`#22C55E`**, Background = **`#0A0A0A`**.
The picker offers a Tailwind-style swatch palette (Gold, Red, Orange, Amber,
Yellow, Lime, Green, Emerald, Teal, Cyan, Sky, Blue, Indigo, Violet, Purple,
Fuchsia, Pink, Rose) for primary/accent, and dark-tone options for background.

> **No CSS gradients in the theme.** The brand is flat gold + gold-tinted
> shadow/overlay. Text selection is `rgba(201,168,76,0.25)` (gold @ 25%) with
> white text.

---

## 2. Typography

Three families. **Headings/display = Fraunces (serif). Body/UI = Geist (sans).
Mono = JetBrains Mono.**

| Role | Family | Source | Weights |
|---|---|---|---|
| Heading / display | **Fraunces** (variable serif, optical size `opsz 9..144`) | Google Fonts | 400, 500, 600, 700 (+ italics) |
| Body / UI | **Geist Variable** | self-hosted `@fontsource-variable/geist` | variable |
| Mono (codes, numbers) | **JetBrains Mono** | Google Fonts | 400, 500 |

Rules:
- Page titles, card titles (`CardTitle`), section headers, restaurant names →
  **Fraunces** (`font-heading`). Larger headings should push optical size up for
  that high-contrast editorial serif look.
- Everything else (labels, buttons, body, inputs) → **Geist**.
- Confirmation codes, prices/amounts, timers → may use **JetBrains Mono**.
- Global: antialiased (`-webkit-font-smoothing: antialiased`). Tailwind v4
  default type scale; base ~16px; UI text often `text-sm` (14px).
- Uppercase micro-labels with letter-spacing are a signature (e.g.
  `TONIGHT'S COVERS`, `ORDER SUMMARY`, `STATUS`, `PRIMARY COLOR`) — small,
  `text-xs`, `muted-foreground`, tracked-wide, used as eyebrow labels above
  values across both diner and dashboard.

Mobile: load Fraunces + JetBrains Mono (e.g. expo-google-fonts) and bundle Geist.
Keep the serif-title / sans-body split exactly — it's the core of the identity.

---

## 3. Shape, elevation, motion

### Border radius (base `--radius: 14px`)
| Name | px | Applied to |
|---|---|---|
| sm | 6 | small inner elements |
| md | 10 | icon buttons, small controls |
| lg | 14 | **buttons** (default), inputs |
| xl | 20 | **cards** |
| 2xl–4xl | 20 | larger cards / sheets (all collapse to 20) |
| full | 9999 | **badges/pills**, avatars, slot chips, scrollbar |

### Elevation = layered greys + hairline borders (NOT shadows)
- Depth order: `#0A0A0A` (canvas) → `#1A1A1A` (card/surface) → `#242424`
  (elevated/hover) — separated by `#2E2E2E` 1px borders.
- **Only the primary (gold) button carries a shadow**: a soft gold glow
  (`shadow-primary/20`, hover `shadow-primary/25`). Everything else is flat.
- Custom scrollbar: 6px, transparent track, thumb `#2E2E2E` (hover `#444`),
  fully rounded. (On mobile, native scroll — just keep content flush.)
- No glassmorphism / blur in the theme.

### Motion
- Standard transition: `transition-all` ~200ms.
- Press feedback: scale to `0.98` on active (use on tappables in mobile too).
- Focus: 2px gold ring at ~30% opacity.
- Library on web: framer-motion + tw-animate-css (fade/zoom/slide-in). On mobile,
  mirror with Reanimated/Moti — keep motion subtle and quick.

---

## 4. Component system & primitives

Web uses **shadcn/ui** (style `radix-nova`, baseColor `neutral`, CSS variables)
with **lucide-react** icons, CVA variants, framer-motion. For mobile, rebuild
these as RN components but match the variants below exactly. **Icon set: Lucide**
(use `lucide-react-native`) — keep the same icons.

### Buttons (match these variants precisely)
Base: `rounded-lg` (14), `text-sm font-medium`, `transition-all ~200ms`,
`active:scale-[0.98]`, gold focus ring. Sizes: xs `h-7`, sm `h-8`, default `h-9`,
lg `h-11` (+ icon-only square variants).
- **default (primary):** `bg #C9A84C`, text `#0A0A0A`, soft gold glow shadow,
  hover/press → slightly darker gold (`#C9A84C` @ 90%) + stronger glow.
- **outline:** transparent bg, `1px #2E2E2E` border, text white; hover → `white @ 5%` fill, border brightens.
- **secondary:** `bg #242424`, text white; hover → `#242424` @ 80%.
- **ghost:** no bg, text `#666666`; hover → `white @ 5%` fill, text → white.
- **destructive:** `bg destructive @ 10%`, text `#EF4444`; hover → `@ 20%`
  (tinted, NOT solid red).
- **link:** gold text, underline.
- Disabled: `opacity 50%`, no pointer events.
- Recurring hover/press wash = **`white @ 5%`** over dark — use it for list rows,
  ghost/outline buttons, nav items.

### Cards
`rounded-xl` (20), `1px #2E2E2E` border, `bg #1A1A1A`, `text-sm`, internal
`gap-4`, vertical padding ~`py-4` (sm size `py-3/px-3/gap-3`). **CardTitle uses
Fraunces.** Footer variant: top border + faintly tinted `bg muted @ 30%`. Images
inside cards round to match the card's top/bottom corners.

### Badges / pills
`h-5`, pill (`rounded-full`/4xl), `text-xs font-medium`. Tinted variants like
buttons (e.g. destructive = `@10%` bg + colored text). Status pills:
Upcoming/Current/Past/Cancelled use the status palette above.

### Inputs / selects / sheets
- Inputs: `bg #242424` (or transparent w/ border), `1px #2E2E2E` border,
  `rounded-lg`, white text, `#666` placeholder, gold focus ring.
- Dialogs/sheets: `bg #1A1A1A`, `1px #2E2E2E` border, `rounded-xl`/2xl, title in
  Fraunces, a `✕` close, dim backdrop. On mobile, prefer bottom sheets / modals
  with the same surface + radius.
- Dropdown menus (account, notifications): `bg #1A1A1A`, hairline border, rows
  with `white @ 5%` hover.
- Toasts: sonner (top-right on web). On mobile, a matching dark toast.

---

## 5. Layout & navigation (web → mobile mapping)

### Diner shell
- **Web:** top bar — left wordmark `CENAIVA`, center primary nav (Discover,
  Promotions, Bookings, Loyalty, Concierge), right Notifications bell + My
  account avatar menu. A floating **"Start listening"** voice control sits bottom
  area; the **Concierge** opens the Hey-Cenaiva voice shell overlay.
- **Mobile:** convert the center nav to a **bottom tab bar**: Discover ·
  Promotions · Bookings · Loyalty, with a prominent **mic/Concierge** action
  (center FAB or tab). Put Notifications + Account in a top bar. Keep the gold
  active-state on the selected tab.

### Owner dashboard shell
- **Web:** left **sidebar** with wordmark, a "Switch restaurant" workspace
  selector, and nav: Overview, Reservations, Floor plan, Staff Invites,
  Pre-orders, Menu, CRM, Analytics, Income & Expenses, Events, Promotions,
  Export, Restaurant info, Settings. Collapsible to an **icon rail** (⌘B). Footer
  has My account, Notifications, Sign out, Exit dashboard, Preview.
- **Mobile:** sidebar → a **drawer** (hamburger) or scrollable tab set; collapse
  the icon rail concept into the drawer. Multi-column tables (reservations list,
  CRM, analytics) → **stacked cards / list rows** with the same eyebrow-label +
  value pattern. The reservations "floor timeline" is desktop-dense; on mobile
  show an agenda/list view, keep the timeline as an optional horizontal-scroll.

### Density
Web is information-dense (KPI cards in rows, tables, timelines). On mobile,
stack KPI cards vertically or 2-up, keep the same card shape and eyebrow labels,
and lean on the dark surfaces + gold accents to keep hierarchy.

---

## 6. Signature patterns to reproduce (from the captures)

- **Eyebrow labels:** tiny uppercase tracked `#666` labels above every value
  (`DATE`, `TIME`, `GUESTS`, `CONFIRMATION`, `TONIGHT'S COVERS`, `ORDER SUMMARY`).
- **Booking flow = 3 numbered steps** on the restaurant page: **1 Details → 2
  Menu (pre-order) → 3 Payment**, with a **hold countdown timer** (e.g.
  `Holding your table — 14:42`) once a slot is taken. Reproduce the stepper + the
  live timer.
- **Checkout fee breakdown (Option B fee model):** Subtotal → `Tax (HST 13%)` →
  `Platform fee (2%)` → `Processing fee` → **Total due now**, then a Stripe card
  field + "Save this card" + "Place Order", with Terms/Refund links. (See
  `diner/19-booking-step3-payment.png`.) Keep this exact line-item order.
- **Time-slot chips:** small pill buttons (`7:15pm`, `7:30pm`…); unavailable ones
  render **disabled with a tooltip** ("Hidden — already booked…"), never hidden.
- **Restaurant cards (Discover):** cover image, save/favorite icons, name in
  Fraunces, `$ $ $` price, cuisine + city tags, a row of time-slot pills, and a
  walk-in/reservations-only note. Map+list split on web; on mobile, list with a
  toggle to map.
- **Review prompt modal:** "Rate your experience" with 5 star buttons + optional
  text, Later/Submit (`diner-modals/01-review-prompt.png`).
- **Owner KPI cards:** "Tonight's covers", "Paid pre-order income (CA$)",
  "Today's pre-orders" + a "Tonight's timeline" and live service summary.
- **Theme picker (owner):** Primary/Accent/Background swatch pickers + hex input
  + a live PREVIEW of primary/outline buttons & accent text
  (`owner-wizard/06-step6-photos.png`).
- **Setup wizard:** 8 steps grouped into 4 phases (DETAILS · SETUP · CONTENT ·
  PAYMENT) with a top stepper, Back/Save-&-exit footer, and a "Preview as diner"
  modal that renders the full public page.
- **Empty states:** calm, centered, muted copy (e.g. "No reservations in the next
  two hours.").

---

## 7. Brand facts that show up in copy (keep consistent)

- Wordmark: **CENAIVA** (all caps, often gold or white).
- Voice assistant: **"Hey Cenaiva"** — mic/Concierge entry points; greeting like
  "Hey, Steven! How can I help?" / time-of-day "Good evening, Steven."
- Currency shown as **CA$** / `$199.99 CAD/month`. Tax = **HST 13%**.
- Owner pricing line: **$199.99/mo + $1 per confirmed booking, 2% on pre-orders &
  deposits, 90-day free trial, zero commission on menu prices.**
- Made-in-Canada framing ("Made in Toronto, on purpose", `ca-central-1`).

---

## 8. Quick token reference (drop-in)

```jsonc
// Cenaiva theme (dark-only)
{
  "color": {
    "background": "#0A0A0A",
    "foreground": "#FFFFFF",
    "card": "#1A1A1A",
    "elevated": "#242424",
    "border": "#2E2E2E",
    "mutedText": "#666666",
    "secondaryText": "#AAAAAA",
    "primary": "#C9A84C",        // gold
    "primaryFg": "#0A0A0A",
    "goldLight": "#F5E6C8",
    "goldDark": "#A8873A",
    "ring": "#C9A84C",
    "destructive": "#EF4444",
    "success": "#22C55E",
    "warning": "#F59E0B",
    "info": "#3B82F6"
  },
  "radius": { "sm": 6, "md": 10, "lg": 14, "xl": 20, "pill": 9999, "base": 14 },
  "font": {
    "heading": "Fraunces",       // serif, variable opsz, wts 400/500/600/700
    "body": "Geist",             // sans, variable
    "mono": "JetBrains Mono"     // 400/500
  },
  "icons": "lucide",
  "motion": { "duration": 200, "pressScale": 0.98, "focusRing": "#C9A84C@30%" },
  "elevation": "flat surfaces + 1px #2E2E2E borders; gold glow ONLY on primary button"
}
```

---

## 9. How to use this with the screenshots

1. Feed this spec + the matching screenshots from each folder (see `README.md`).
2. Build the **theme constants** from §1/§8 first; wire Fraunces/Geist/JetBrains
   Mono (§2).
3. Build the **primitives** (Button, Card, Badge, Input, Sheet, eyebrow Label)
   from §4 — get these pixel-right before screens.
4. Build screens folder-by-folder, using the screenshot as the visual target and
   §5 for the small-screen layout adaptation. Keep tokens/typography identical;
   only re-flow layout.
5. Reproduce the §6 signature patterns exactly (3-step booking + hold timer, fee
   breakdown order, eyebrow labels, disabled-not-hidden slot chips).
