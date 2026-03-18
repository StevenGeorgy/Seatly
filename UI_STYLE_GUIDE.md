# Seatly UI Style Guide

Design system for the Seatly web and mobile apps. Use this guide to build with an identical look and feel across platforms.

---

## QUICK REFERENCE

**One-page cheat sheet — find answers in 10 seconds.**

| Need | Use |
|------|-----|
| **Screen background** | `backgroundDark` #0A0A0A |
| **Card/panel background** | `surfaceDark` #141414 |
| **Primary text** | `textOnDark` #fafafa |
| **Secondary text** | `textMutedOnDark` #9ca3af |
| **Primary button** | `gold` bg, `textOnGold` text, `borderRadius.md` |
| **Secondary button** | `gold` border, `gold` text, transparent bg |
| **Accent/highlight** | `gold` #D4AF37 |
| **Error** | `error` #ef4444 |
| **Success** | `success` #22c55e |
| **Warning** | `warning` #f59e0b |
| **Input bg** | `surfaceDark` #141414 |
| **Input border** | `borderDark` #262626 |
| **Focus ring** | 1px `gold` |
| **Card border** | `borderCard` #2C2C2C |
| **Card radius** | `borderRadius.lg` (12px) |
| **Button radius** | `borderRadius.md` (8px) |
| **Screen padding** | `spacing.xl` (24px) |
| **Card padding** | `spacing.xl` (24px) |
| **Section gap** | `spacing.2xl` (32px) |
| **Screen title** | `fontSize.2xl` (24px), `fontWeight.bold` |
| **Section heading** | `fontSize.lg` (18px), `fontWeight.semibold` |
| **Body text** | `fontSize.sm` (14px) or `fontSize.base` (16px) |
| **Labels** | `fontSize.xs` (12px), `fontWeight.medium` |
| **Transition** | 400ms ease-out |
| **Status bar** | Light (dark content) |

---

## 1. BRAND IDENTITY

| Attribute | Value |
|-----------|-------|
| **App name** | Seatly |
| **Theme** | Black and gold, Apple Mac sleek minimal |
| **Mode** | Dark mode only |
| **Design inspiration** | Linear.app aesthetic |
| **Core feeling** | Premium, clean, confident |

---

## 2. COLOUR SYSTEM

### Complete Colour Table

| Token Name | Hex Value | Usage | Example |
|------------|-----------|-------|---------|
| **Backgrounds** | | | |
| backgroundDark | #0A0A0A | Main app background, use on every screen | Screen root, body |
| surfaceDarkAlt | #0F0F0F | Alternate section background | Section dividers |
| surfaceDark | #141414 | Cards, panels, inputs | Card bg, input bg |
| surfaceDarkElevated | #1A1A1A | Elevated surfaces, modals | Modal bg, sidebar |
| surfaceGlass | rgba(20,20,20,0.6) | Glass overlay with blur | Navbar, overlays |
| goldTintBg | rgba(212,175,55,0.04) | Subtle gold highlight | Selected card, accent panel |
| **Surfaces (light theme — avoid in app)** | | | |
| background | #f8fafc | Light mode only | — |
| surface | #ffffff | Light mode only | — |
| surfaceMuted | #f1f5f9 | Light mode only | — |
| **Text** | | | |
| textOnDark | #fafafa | Primary text on dark | Headings, body |
| textMutedOnDark | #9ca3af | Secondary text | Labels, captions, hints |
| textOnGold | #0A0A0A | Text on gold buttons | Primary button label |
| **Borders** | | | |
| borderDark | #262626 | Default borders | Input border, divider |
| borderCard | #2C2C2C | Card borders | Card outline |
| **Gold brand** | | | |
| gold | #D4AF37 | Primary accent, buttons, highlights | CTA, active nav, icons |
| goldMuted | #B8962E | Hover state for gold | Button hover |
| goldDark | #8B6914 | Darker gold variant | — |
| **Status** | | | |
| success | #22c55e | Success state, seated | Confirmed, seated table |
| successMuted | #dcfce7 | Success background | — |
| warning | #f59e0b | Warning state | — |
| warningMuted | #fef3c7 | Warning background | — |
| error | #ef4444 | Error, destructive, allergy | Error text, delete, allergy badge |
| errorMuted | #fee2e2 | Error background | Error banner |
| info | #3b82f6 | Info state | — |
| infoMuted | #dbeafe | Info background | — |
| **Floor plan** | | | |
| floorPlanEmpty | #2A2A2A | Empty table fill | — |
| floorPlanEmptyBorder | #404040 | Empty table border | — |
| floorPlanSeated | #1A3A1A | Seated table fill | — |
| floorPlanSeatedBorder | #2A4A2A | Seated table border | — |
| floorPlanArriving | #3A3000 | Arriving table fill | — |
| floorPlanArrivingBorder | #4A4000 | Arriving table border | — |
| floorPlanOverdue | #3A1A1A | Overdue table fill | — |
| floorPlanOverdueBorder | #4A2A2A | Overdue table border | — |
| floorPlanReserved | #1A1A3A | Reserved table fill | — |
| floorPlanReservedBorder | #2A2A4A | Reserved table border | — |
| **Legacy (light theme)** | | | |
| primary | #2563eb | — | — |
| tableEmpty | #94a3b8 | — | — |
| tableArriving | #eab308 | — | — |
| tableSeated | #22c55e | — | — |
| tableOverdue | #ef4444 | — | — |
| tableReserved | #3b82f6 | — | — |

### Semantic Groups

- **Backgrounds**: backgroundDark, surfaceDarkAlt, surfaceDark, surfaceDarkElevated
- **Surfaces**: surfaceDark, surfaceDarkElevated, borderCard
- **Text**: textOnDark, textMutedOnDark, textOnGold
- **Gold**: gold, goldMuted, goldDark, goldTintBg
- **Status**: success, warning, error, info (+ muted variants)
- **Floor plan**: floorPlan* (5 states × 2 each)
- **Borders**: borderDark, borderCard

---

## 3. TYPOGRAPHY

### Font Families

| Use | Web | iOS | Android |
|-----|-----|-----|---------|
| Headings | system-ui, -apple-system | SF Pro Display | Roboto |
| Body | system-ui, -apple-system | SF Pro Text | Roboto |

### Font Size Scale

| Token | px | Use |
|-------|-----|-----|
| xs | 12 | Labels, captions, badges, table labels |
| sm | 14 | Body text, secondary content |
| base | 16 | Primary body, input text |
| lg | 18 | Card titles, section headings |
| xl | 20 | — |
| 2xl | 24 | Screen titles |
| 3xl | 30 | Hero headings |
| 4xl | 36 | Large hero |

### Font Weight Scale

| Token | Value | Use |
|-------|-------|-----|
| normal | 400 | Body text |
| medium | 500 | Labels, emphasis |
| semibold | 600 | Buttons, card titles |
| bold | 700 | Screen titles |
| extrabold | 800 | Hero headings |

### Letter Spacing

| Token | Value | Use |
|-------|-------|-----|
| tightHero | -0.02em | Hero headings |
| tightSection | -0.03em | Section headings |
| label | 0.1em | Uppercase labels |

### Line Height

| Token | Value | Use |
|-------|-------|-----|
| relaxed | 1.7 | Body paragraphs |

### Usage by Element

| Element | Size | Weight | Example |
|---------|------|--------|---------|
| Screen title | 2xl (24px) | bold | "Dashboard" |
| Section heading | 4xl (36px) | semibold | "Features" |
| Card title | lg (18px) | semibold | "Live Floor Plan" |
| Body text | sm (14px) or base (16px) | normal | Paragraphs |
| Labels | xs (12px) | medium | "Email", "Floor plan" |
| Buttons | sm (14px) or base (16px) | semibold | "Get Started" |
| Input text | base (16px) | normal | User input |

---

## 4. SPACING SYSTEM

| Token | px | Use |
|-------|-----|-----|
| xs | 4 | Tight gaps, icon-text gap |
| sm | 8 | Between related elements |
| md | 12 | Input padding, compact gaps |
| lg | 16 | Standard element padding |
| xl | 24 | Screen padding, card padding |
| 2xl | 32 | Between sections |
| 3xl | 48 | Large section gaps |
| 4xl | 64 | Hero spacing |

### Usage

| Context | Value |
|---------|-------|
| Screen padding | xl (24px) |
| Card padding | xl (24px) |
| Between sections | 2xl (32px) |
| Between elements in a row | md (12px) |
| Between form fields | lg (16px) |
| Icon sizes (small) | 16–20px |
| Icon sizes (medium) | 24px |
| Icon sizes (large) | 40px |

---

## 5. BORDER RADIUS

| Token | px | Use |
|-------|-----|-----|
| sm | 4 | Small elements |
| md | 8 | Buttons, inputs |
| lg | 12 | Cards |
| xl | 16 | Large cards |
| full | 9999px | Pills, badges, avatars |

### Usage by Component

| Component | Radius |
|-----------|--------|
| Cards | lg (12px) |
| Buttons | md (8px) |
| Inputs | md (8px) |
| Modals | lg (12px) |
| Pills/badges | full |
| Avatars | full |

---

## 6. SHADOWS AND GLOWS

### Shadow Tokens

| Token | CSS Value |
|-------|-----------|
| sm | `0 1px 2px 0 rgb(0 0 0 / 0.05)` |
| md | `0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)` |
| lg | `0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)` |

### Gold Glow Effects

| Token | Value | Use |
|-------|-------|-----|
| goldGlow | `0 0 20px rgba(212, 175, 55, 0.15)` | Card hover, premium cards |
| goldGlowHover | `0 0 24px rgba(212, 175, 55, 0.2)` | Interactive hover |
| goldGlowPricingCard | `0 0 24px rgba(212, 175, 55, 0.15), 0 0 48px rgba(212, 175, 55, 0.08)` | Premium card |
| goldBorderFocus | `0 0 0 1px rgba(212, 175, 55, 0.5)` | Input focus ring |
| insetShadowCard | `inset 0 1px 0 rgba(255, 255, 255, 0.03)` | Card top highlight |

### When to Use

- **Gold glow**: Premium cards, hover states, selected items
- **Card shadow**: Subtle elevation, use `insetShadowCard` for top edge
- **Modal shadow**: Use `lg` for depth

---

## 7. COMPONENT PATTERNS

### Primary Button

Primary CTA, gold background.

| Tailwind (Web) | React Native (StyleSheet) |
|---------------|--------------------------|
| `rounded-md bg-gold px-2xl py-lg text-base font-semibold text-text-on-gold hover:bg-gold-muted disabled:opacity-50` | `borderRadius: 8, backgroundColor: colors.gold, paddingHorizontal: 32, paddingVertical: 16, fontSize: 16, fontWeight: '600', color: colors.textOnGold` |

```tsx
// Web (Tailwind)
<button className="rounded-md bg-gold px-2xl py-lg text-base font-semibold text-text-on-gold hover:bg-gold-muted disabled:opacity-50">
  Get Started
</button>

// Mobile (React Native)
<TouchableOpacity style={[styles.primaryButton, disabled && styles.disabled]}>
  <Text style={styles.primaryButtonText}>Get Started</Text>
</TouchableOpacity>
// styles.primaryButton: { borderRadius: 8, backgroundColor: theme.colors.gold, paddingHorizontal: 32, paddingVertical: 16 }
// styles.primaryButtonText: { fontSize: 16, fontWeight: '600', color: theme.colors.textOnGold }
```

---

### Secondary Button

Outlined gold, transparent background.

| Tailwind (Web) | React Native (StyleSheet) |
|---------------|--------------------------|
| `rounded-md border border-gold px-lg py-sm text-sm font-medium text-gold hover:bg-gold/10` | `borderRadius: 8, borderWidth: 1, borderColor: colors.gold, paddingHorizontal: 16, paddingVertical: 8, fontSize: 14, fontWeight: '500', color: colors.gold` |

```tsx
// Web (Tailwind)
<button className="rounded-md border border-gold px-lg py-sm text-sm font-medium text-gold hover:bg-gold/10">
  Login
</button>

// Mobile (React Native)
<TouchableOpacity style={styles.secondaryButton}>
  <Text style={styles.secondaryButtonText}>Login</Text>
</TouchableOpacity>
// styles.secondaryButton: { borderRadius: 8, borderWidth: 1, borderColor: theme.colors.gold, paddingHorizontal: 16, paddingVertical: 8 }
// styles.secondaryButtonText: { fontSize: 14, fontWeight: '500', color: theme.colors.gold }
```

---

### Destructive Button

Red, for delete/danger actions.

| Tailwind (Web) | React Native (StyleSheet) |
|---------------|--------------------------|
| `rounded-md bg-error px-lg py-sm text-sm font-medium text-white hover:opacity-90` | `borderRadius: 8, backgroundColor: colors.error, paddingHorizontal: 16, paddingVertical: 8, fontSize: 14, fontWeight: '500', color: '#FFFFFF'` |

```tsx
// Web (Tailwind)
<button className="rounded-md bg-error px-lg py-sm text-sm font-medium text-white hover:opacity-90">
  Delete
</button>

// Mobile (React Native)
<TouchableOpacity style={styles.destructiveButton}>
  <Text style={styles.destructiveButtonText}>Delete</Text>
</TouchableOpacity>
// styles.destructiveButton: { borderRadius: 8, backgroundColor: theme.colors.error, paddingHorizontal: 16, paddingVertical: 8 }
// styles.destructiveButtonText: { fontSize: 14, fontWeight: '500', color: '#FFFFFF' }
```

---

### Disabled Button

| Tailwind (Web) | React Native (StyleSheet) |
|---------------|--------------------------|
| `opacity-50` | `opacity: 0.5` |

---

### Input

| Tailwind (Web) | React Native (StyleSheet) |
|---------------|--------------------------|
| `rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark placeholder-text-muted-on-dark focus:border-gold focus:ring-1 focus:ring-gold` | `borderRadius: 8, borderWidth: 1, borderColor: colors.borderDark, backgroundColor: colors.surfaceDark, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, color: colors.textOnDark` |

```tsx
// Web (Tailwind)
<input
  className="w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark placeholder-text-muted-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
  placeholder="owner@restaurant.com"
/>

// Mobile (React Native)
<TextInput
  style={styles.input}
  placeholder="owner@restaurant.com"
  placeholderTextColor={theme.colors.textMutedOnDark}
/>
// styles.input: { borderRadius: 8, borderWidth: 1, borderColor: theme.colors.borderDark, backgroundColor: theme.colors.surfaceDark, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, color: theme.colors.textOnDark }
```

**Focus state**: `borderColor: colors.gold`, `borderWidth: 1` (or `shadowColor` on iOS for glow)

**Error state**: `borderColor: colors.error`, `backgroundColor: colors.errorMuted`

---

### Card

| Tailwind (Web) | React Native (StyleSheet) |
|---------------|--------------------------|
| `rounded-lg border border-border-card bg-surface-dark p-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]` | `borderRadius: 12, borderWidth: 1, borderColor: colors.borderCard, backgroundColor: colors.surfaceDark, padding: 24` |

```tsx
// Web (Tailwind)
<div className="rounded-lg border border-border-card bg-surface-dark p-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
  Card content
</div>

// Mobile (React Native)
<View style={styles.card}>
  <Text>Card content</Text>
</View>
// styles.card: { borderRadius: 12, borderWidth: 1, borderColor: theme.colors.borderCard, backgroundColor: theme.colors.surfaceDark, padding: 24 }
```

**Hover state**: `borderColor: gold/50`, `shadowColor: gold`, `shadowRadius: 20` (web)

---

### Badge / Pill (Default)

| Tailwind (Web) | React Native (StyleSheet) |
|---------------|--------------------------|
| `rounded-full border border-gold bg-gold/10 px-md py-xs text-xs font-medium text-gold` | `borderRadius: 9999, borderWidth: 1, borderColor: colors.gold, backgroundColor: 'rgba(212,175,55,0.1)', paddingHorizontal: 12, paddingVertical: 4, fontSize: 12, fontWeight: '500', color: colors.gold` |

```tsx
// Web (Tailwind)
<span className="rounded-full border border-gold bg-gold/10 px-md py-xs text-xs font-medium text-gold">
  VIP
</span>

// Mobile (React Native)
<View style={styles.badge}>
  <Text style={styles.badgeText}>VIP</Text>
</View>
// styles.badge: { borderRadius: 9999, borderWidth: 1, borderColor: theme.colors.gold, backgroundColor: 'rgba(212,175,55,0.1)', paddingHorizontal: 12, paddingVertical: 4 }
// styles.badgeText: { fontSize: 12, fontWeight: '500', color: theme.colors.gold }
```

---

### Allergy Alert Badge

**RED, exact style.**

| Tailwind (Web) | React Native (StyleSheet) |
|---------------|--------------------------|
| `rounded-md border border-error bg-error-muted px-md py-sm text-sm font-medium text-error` | `borderRadius: 8, borderWidth: 1, borderColor: colors.error, backgroundColor: colors.errorMuted, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, fontWeight: '500', color: colors.error` |

---

### Status Badges

| Status | Background | Text |
|--------|------------|------|
| Confirmed | gold/10 | gold |
| Seated | successMuted | success |
| Arriving | warningMuted | warning |
| Overdue | errorMuted | error |
| Reserved | infoMuted | info |

---

### Navigation (Sidebar)

| Tailwind (Web) | React Native (StyleSheet) |
|---------------|--------------------------|
| Active: `border-l-2 border-gold bg-gold/10 font-medium text-gold` | Active: `borderLeftWidth: 2, borderLeftColor: colors.gold, backgroundColor: 'rgba(212,175,55,0.1)', fontWeight: '500', color: colors.gold` |
| Inactive: `text-text-muted-on-dark` | Inactive: `color: colors.textMutedOnDark` |
| Hover: `hover:text-gold` | Pressed: `color: colors.gold` |

```tsx
// Web (Tailwind)
<nav className="space-y-xs px-md">
  <div className="rounded-md px-md py-sm text-sm border-l-2 border-gold bg-gold/10 font-medium text-gold">Floor</div>
  <div className="rounded-md px-md py-sm text-sm text-text-muted-on-dark">CRM</div>
</nav>

// Mobile (React Native)
<View style={styles.navItem}>
  <Text style={[styles.navText, isActive && styles.navTextActive]}>Floor</Text>
</View>
// styles.navItem: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }
// styles.navText: { fontSize: 14, fontWeight: '500', color: theme.colors.textMutedOnDark }
// styles.navTextActive: { borderLeftWidth: 2, borderLeftColor: theme.colors.gold, backgroundColor: 'rgba(212,175,55,0.1)', color: theme.colors.gold }
```

---

### Modal / Overlay

| Tailwind (Web) | React Native (StyleSheet) |
|---------------|--------------------------|
| `rounded-lg border border-border-dark bg-surface-dark-elevated p-xl backdrop-blur` | `borderRadius: 12, borderWidth: 1, borderColor: colors.borderDark, backgroundColor: colors.surfaceDarkElevated, padding: 24` |

```tsx
// Web (Tailwind)
<div className="rounded-lg border border-border-dark bg-surface-dark-elevated p-xl max-w-md">
  Modal content
</div>

// Mobile (React Native)
<View style={styles.modal}>
  <Text>Modal content</Text>
</View>
// styles.modal: { borderRadius: 12, borderWidth: 1, borderColor: theme.colors.borderDark, backgroundColor: theme.colors.surfaceDarkElevated, padding: 24, maxWidth: 448 }
```

**Backdrop**: `backgroundColor: 'rgba(0,0,0,0.6)'`, `blur` on iOS (BlurView)

---

### Table / List

| Element | Style |
|---------|-------|
| Header row | `backgroundColor: gold/10`, `color: gold`, `fontSize: 12`, `fontWeight: 500` |
| Row | `borderBottomWidth: 1`, `borderBottomColor: gold/10` |
| Row hover | `backgroundColor: goldTintBg` |
| Cell padding | `paddingHorizontal: 8`, `paddingVertical: 4` |

```tsx
// Web (Tailwind)
<table className="w-full text-left text-xs">
  <thead>
    <tr className="border-b border-gold/20 bg-gold/10">
      <th className="px-sm py-xs font-medium text-gold">Guest</th>
    </tr>
  </thead>
  <tbody className="text-text-on-dark">
    <tr className="border-b border-gold/10">
      <td className="px-sm py-xs">Sarah Chen</td>
    </tr>
  </tbody>
</table>

// Mobile (React Native)
<View style={styles.tableHeader}>
  <Text style={styles.tableHeaderText}>Guest</Text>
</View>
<View style={styles.tableRow}>
  <Text style={styles.tableRowText}>Sarah Chen</Text>
</View>
// styles.tableHeader: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(212,175,55,0.1)', borderBottomWidth: 1, borderBottomColor: 'rgba(212,175,55,0.2)' }
// styles.tableHeaderText: { fontSize: 12, fontWeight: '500', color: theme.colors.gold }
// styles.tableRow: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: 'rgba(212,175,55,0.1)' }
// styles.tableRowText: { fontSize: 12, color: theme.colors.textOnDark }
```

---

### Status Indicators

| Floor Plan State | Fill | Border |
|------------------|------|--------|
| Empty | floorPlanEmpty #2A2A2A | floorPlanEmptyBorder #404040 |
| Seated | floorPlanSeated #1A3A1A | floorPlanSeatedBorder #2A4A2A |
| Arriving | floorPlanArriving #3A3000 | floorPlanArrivingBorder #4A4000 |
| Overdue | floorPlanOverdue #3A1A1A | floorPlanOverdueBorder #4A2A2A |
| Reserved | floorPlanReserved #1A1A3A | floorPlanReservedBorder #2A2A4A |

| State | Colour |
|-------|--------|
| Loading spinner | gold |
| Success | success #22c55e |
| Error | error #ef4444 |
| Warning | warning #f59e0b |

---

## 8. ANIMATION AND MOTION

| Token | Duration | Use |
|-------|----------|-----|
| Fast | 400ms | Hover, transitions |
| Normal | 600ms | Fade in, enter |
| Slow | — | — |

| Easing | Use |
|--------|-----|
| ease-out | Fade in, enter |
| ease-in-out | Toggle, pulse |

| Animation | Duration | Use |
|-----------|----------|-----|
| fadeInUp | 0.6s ease-out | Section enter |
| pulse | 2s ease-in-out infinite | Loading dot |
| hover scale | 1.02 | Button hover |

**Mobile screen transitions**: 300–400ms ease-out

---

## 9. MOBILE SPECIFIC NOTES

### Tailwind → React Native Mapping

| Tailwind | React Native |
|----------|--------------|
| `bg-*` | `backgroundColor: colors.*` |
| `text-*` | `color: colors.*` |
| `px-*` | `paddingHorizontal: spacing.*` (use numeric px) |
| `py-*` | `paddingVertical: spacing.*` |
| `rounded-md` | `borderRadius: 8` |
| `border border-gold` | `borderWidth: 1, borderColor: colors.gold` |

### Fonts

| Platform | Headings | Body |
|----------|----------|------|
| iOS | SF Pro Display | SF Pro Text |
| Android | Roboto | Roboto |

Use `Platform.select()` or `fontFamily` from theme.

### Shadows

React Native uses `shadowColor`, `shadowOffset`, `shadowOpacity`, `shadowRadius` (iOS) and `elevation` (Android). See `theme.native.ts` for `shadows.goldGlow`.

### Gold Glow in React Native

```ts
// iOS
shadowColor: 'rgba(212, 175, 55, 0.3)',
shadowOffset: { width: 0, height: 0 },
shadowOpacity: 1,
shadowRadius: 20,

// Android
elevation: 8,
// Use a wrapper with gold tint or border for similar effect
```

### Safe Area

Use `SafeAreaView` or `useSafeAreaInsets()` for top/bottom padding on notched devices.

### Tab Bar

- Background: `surfaceDark` or `surfaceDarkElevated`
- Active: `gold` icon and text
- Inactive: `textMutedOnDark`

### Status Bar

Always `light-content` (light icons on dark background).

---

## 10. REACT NATIVE TOKENS FILE

Import from `packages/tokens/theme.native.ts`:

```ts
import { colors, spacing, typography, borderRadius, shadows } from '@seatly/tokens/theme.native';
```

See `packages/tokens/theme.native.ts` for the full implementation.

---

## 11. DO AND DO NOT

### DO

- Always use dark backgrounds (`backgroundDark`, `surfaceDark`)
- Use gold only on key elements (CTAs, active nav, highlights)
- Keep layouts minimal and breathable
- Use consistent spacing from the scale
- Show loading and empty states
- Handle errors with clear messaging
- Use tokens — never hardcode values

### DO NOT

- Never use white or light backgrounds
- Never use light mode
- Never hardcode colours
- Never use more than 2 font weights on a single screen
- Never use harsh drop shadows
- Never expose API keys or secrets to the frontend

---

## 12. SCREEN TEMPLATES

Layout patterns for common screen types. These are structure only, not full components.

### Mobile Screen Template

```
┌─────────────────────────────────┐
│ SafeAreaView (top)               │
│ ┌─────────────────────────────┐ │
│ │ Screen (flex: 1)            │ │
│ │   backgroundColor: backgroundDark │
│ │   paddingHorizontal: xl     │ │
│ │                             │ │
│ │   [Header / Title]          │ │
│ │   [Content]                  │ │
│ │   [ScrollView if needed]   │ │
│ └─────────────────────────────┘ │
│ SafeAreaView (bottom)            │
└─────────────────────────────────┘
```

- Root: `View` with `flex: 1`, `backgroundColor: backgroundDark`
- Padding: `paddingHorizontal: 24` (xl)
- Wrap in `SafeAreaView` or apply insets

### Web Page Template

```
┌─────────────────────────────────────────────┐
│ Navbar (sticky)                              │
├─────────────────────────────────────────────┤
│ main (min-h-screen)                          │
│   backgroundColor: backgroundDark            │
│   max-w-6xl mx-auto px-xl                   │
│                                             │
│   [Page title - 2xl bold]                    │
│   [Page content]                             │
│   [Sections with gap-2xl]                    │
└─────────────────────────────────────────────┘
```

- Root: `min-h-screen bg-background-dark`
- Container: `max-w-6xl mx-auto px-xl`
- Section gap: `gap-2xl` or `mb-2xl`

### Modal Template

```
┌─────────────────────────────────┐
│ Backdrop (overlay, blur)         │
│   backgroundColor: rgba(0,0,0,0.6) │
│   flex: 1, justifyContent: center │
│   alignItems: center            │
│                                 │
│   ┌─────────────────────────┐ │
│   │ Modal (maxWidth: 448)    │ │
│   │   backgroundColor: surfaceDarkElevated │
│   │   borderRadius: lg       │ │
│   │   padding: xl             │ │
│   │   border: borderDark     │ │
│   │                           │ │
│   │   [Title]                 │ │
│   │   [Content]               │ │
│   │   [Actions]               │ │
│   └─────────────────────────┘ │
└─────────────────────────────────┘
```

- Backdrop: full screen, semi-transparent, optional blur
- Modal: centered, max-width 448px, `surfaceDarkElevated`, `borderRadius.lg`, `padding.xl`

### List Screen Template

```
┌─────────────────────────────────┐
│ [Header: title + optional action]│
├─────────────────────────────────┤
│ FlatList / ScrollView            │
│   contentContainerStyle:         │
│     paddingBottom: 2xl           │
│                                 │
│   [List item 1]                 │
│   [Divider]                     │
│   [List item 2]                 │
│   [Divider]                     │
│   ...                           │
│                                 │
│   [Empty state if no items]     │
└─────────────────────────────────┘
```

- Root: `flex: 1`, `backgroundColor: backgroundDark`
- List items: `backgroundColor: surfaceDark`, `borderRadius: lg`, `padding: xl`, `marginBottom: md`
- Divider: `height: 1`, `backgroundColor: borderDark`
- Empty state: centered, `textMutedOnDark`
