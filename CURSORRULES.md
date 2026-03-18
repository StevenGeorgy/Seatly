# Seatly — .cursorrules
# Copy the contents below into a file called .cursorrules in your project root
# Cursor reads this file automatically before every session
# Last updated: March 2026

---

## COPY EVERYTHING BELOW THIS LINE INTO .cursorrules

```
# Seatly — Cursor Rules
# Read this entire file before writing any code

## Project Overview
Seatly is a multi-restaurant CRM and booking platform.
Web app: Next.js + Tailwind CSS
Mobile app: Expo SDK 52 + React Native
Backend: Supabase + Edge Functions + Claude API

## Before Every Session
1. Read BACKEND.md — know what tables exist before touching anything
2. Read CHECKLIST.md — never rebuild something already done
3. Use Plan mode — always show a plan and wait for approval
4. Reference the nearest existing screen as a template for new screens

## Database Rules — Non-Negotiable
NEVER create a new Supabase table that is not in BACKEND.md
NEVER add a column that is not documented in BACKEND.md
NEVER modify or delete an existing table
NEVER disable Row Level Security on any table
NEVER suggest disabling RLS to fix a bug — find the real fix
If a screen needs something not in BACKEND.md, STOP and tell
the developer instead of creating it yourself

## Security Rules — Non-Negotiable
NEVER hardcode API keys, passwords, or secrets in any file
ALL secrets must use environment variables (process.env.VARIABLE)
NEVER commit .env files — they are in .gitignore
NEVER use NEXT_PUBLIC_ prefix for secret keys
NEVER expose the Supabase service role key to the frontend

## Design Rules — Non-Negotiable
NEVER hardcode hex colour values anywhere in the codebase
NEVER hardcode pixel values, spacing numbers, or font sizes
ALL colours must be imported from packages/tokens
ALL spacing must be imported from packages/tokens
ALL font sizes must be imported from packages/tokens
If a value is not in the tokens file, ask before creating it

## Code Rules
TypeScript only — no .js or .jsx files
Functional components only — no class components
Named exports only — no default exports for components
Always handle three states on every screen:
  - Loading state (data is being fetched)
  - Empty state (no data exists yet)
  - Error state (something went wrong)
Never use inline styles — always use Tailwind classes (web)
  or StyleSheet.create with token values (mobile)

## AI Rules — Non-Negotiable
Claude API is for conversation, suggestions, and natural
language queries ONLY
NEVER send financial calculations to the Claude API
NEVER send tax calculations to the Claude API
NEVER let Claude API write directly to the database
ALL money calculations happen in PostgreSQL and Edge Functions
Claude API calls go through Supabase Edge Functions only
Never call the Claude API directly from the frontend

## Multi-Restaurant Rules
Every database query MUST filter by restaurant_id
A restaurant can NEVER see another restaurant's data
Always verify RLS is enforcing restaurant isolation
Never query a table without a restaurant_id filter

## New Screens Rule
When creating a new screen:
1. Check BACKEND.md — confirm all tables needed exist
2. Copy the structure from the nearest existing screen
3. Never start from a blank component
4. Apply the correct role permission for this screen
5. Import all values from packages/tokens
```

---

## What Each Rule Prevents

| Rule | What it prevents |
|------|-----------------|
| Never create new tables | Cursor inventing database structure that breaks the schema |
| Never disable RLS | Security holes where one restaurant sees another's data |
| Never hardcode secrets | API keys accidentally committed to GitHub |
| Never hardcode colours | UI inconsistency between screens and platforms |
| Always use Plan mode | Cursor building the wrong thing without review |
| Always handle 3 states | Broken screens that crash on empty data or network errors |
| AI never handles money | Financial calculation errors from language model hallucination |
| Always filter by restaurant_id | Data leaks between restaurant accounts |

---

## Reminder: How to Use Plan Mode in Cursor

1. Open a new Cursor chat
2. Switch from Agent to Plan at the top of the chat
3. Paste your prompt
4. Read the plan Cursor produces
5. Check it against BACKEND.md — is it only using existing tables?
6. Check it against CHECKLIST.md — is this already done?
7. If the plan looks correct, type "approved, build it"
8. If something is wrong, tell Cursor what to change before approving

---

*Seatly .cursorrules reference — Version 1.0 — March 2026*
