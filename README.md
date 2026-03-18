# Seatly

OpenTable's biggest nightmare

---

## What Is Seatly

Seatly is a multi-restaurant CRM and booking platform. It is three products in one:

- A **booking platform** — customers find restaurants, reserve tables, and pre-order food from a mobile app
- A **restaurant operating system** — hosts, waiters, and managers run their entire floor from a web app in real time
- A **guest CRM with AI** — every guest becomes a permanent profile with full dining history, spending records, preferences, and AI-generated intelligence

---

## Who Is Building This

This is a solo build using Cursor with Claude Opus in Plan mode.

| App | Stack |
|-----|-------|
| Web app | Next.js + Tailwind CSS |
| Mobile app | Expo SDK 52 + React Native |
| Backend | Supabase + Edge Functions + Claude API |

---

## Project File Structure

```
seatly/
  apps/
    web/                Next.js web app
    mobile/             Expo mobile app
  packages/
    tokens/             Shared design tokens (colours, spacing, fonts)
    types/              Shared TypeScript types
    utils/              Shared helper functions
  docs/
    README.md           This file — start here
    BACKEND.md          Full database schema — read before every session
    CHECKLIST.md        Build progress tracker — update after every feature
    CURSORRULES.md      Rules reference (also copied to .cursorrules)
    APP_BIBLE.md        Full product spec — screens, features, user flows
    CRM_SPEC.md         Complete CRM feature specification for Cursor
  .cursorrules          Cursor reads this automatically every session
  .env.example          Environment variable names — safe to commit
  .gitignore            Files that never go to GitHub
```

---

## The 5 Files Cursor Needs

Before starting any Cursor session, make sure these files are in your project:

| File | Purpose |
|------|---------|
| `.cursorrules` | Rules Cursor follows automatically — never touch database structure, never hardcode values |
| `BACKEND.md` | Full database schema — Cursor reads this to know what tables exist |
| `CHECKLIST.md` | What is done and what is not — prevents rebuilding completed work |
| `APP_BIBLE.md` | Full product spec — screens, features, and user flows |
| `CRM_SPEC.md` | Full CRM spec to paste into Cursor for CRM build sessions |

---

## Build Order

**Always build backend first. Never build a screen before the database tables it needs exist.**

```
Phase 1  →  Core tables (restaurants, users, tables, shifts)
Phase 2  →  Auth (Supabase Auth + RLS + roles)
Phase 3  →  Reservations (reservations, waitlist, availability engine)
Phase 4  →  Menu (menu_items, menu_categories)
Phase 5  →  Orders (orders, order_items, kitchen tickets)
Phase 6  →  Guest CRM (guests, notes, loyalty, communications, surveys)
Phase 7  →  Financial (events, gift cards, promo codes, corporate accounts)
Phase 8  →  Staff (shifts, clock records, availability)
Phase 9  →  Analytics (restaurant_analytics, nightly cron jobs)
Phase 10 →  Edge Functions (all on-demand and cron functions live)
Phase 11 →  Realtime channels active
```

After each phase: update `[ ]` to `[x]` in BACKEND.md and CHECKLIST.md.

---

## The Golden Rules

1. **Read BACKEND.md before every session** — never build blind
2. **Use Plan mode first** — always review the plan before Cursor builds
3. **Never hardcode values** — all colours, spacing, and secrets use variables
4. **Never skip RLS** — Row Level Security must be on every table
5. **One phase at a time** — finish and test before moving to the next
6. **Update the checklist** — after every completed feature

---

## Tech Stack Reference

| Layer | Tool |
|-------|------|
| Web app | Next.js (App Router) + Tailwind CSS |
| Mobile app | Expo SDK 52 + React Native |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Realtime | Supabase Realtime |
| File storage | Supabase Storage |
| AI assistant | Claude API (claude-sonnet-4-6) |
| Emails | Resend |
| SMS | Twilio |
| Push notifications | Expo Push Notifications |
| Payments | Stripe |
| Error tracking | Sentry |
| Voice AI | VAPI |
| Design tokens | packages/tokens |

---

## Environment Variables

Never commit real values. Copy `.env.example` to `.env` and fill in your real keys locally.

See `.env.example` for the full list of required variables.

---

*Seatly Build — Version 1.0 — March 2026*
