# Seatly — Full Backend Status Report
**Generated:** March 2026

---

## 1. TABLES CONFIRMED BUILT AND LIVE IN SUPABASE

| Table | RLS | Rows |
|-------|-----|------|
| restaurants | ✓ | 2 |
| user_profiles | ✓ | 4 |
| shifts | ✓ | 4 |
| tables | ✓ | 10 |
| guests | ✓ | 0 |
| reservations | ✓ | 0 |
| waitlist | ✓ | 0 |
| menu_categories | ✓ | 8 |
| menu_items | ✓ | 20 |
| orders | ✓ | 0 |
| order_items | ✓ | 0 |
| guest_notes | ✓ | 0 |
| allergy_incidents | ✓ | 0 |
| loyalty_transactions | ✓ | 0 |
| communication_log | ✓ | 0 |
| guest_surveys | ✓ | 0 |
| events | ✓ | 0 |
| event_tickets | ✓ | 0 |
| gift_cards | ✓ | 0 |
| promo_codes | ✓ | 0 |
| corporate_accounts | ✓ | 0 |
| staff_shifts | ✓ | 0 |
| staff_clock_records | ✓ | 0 |
| staff_availability | ✓ | 0 |
| restaurant_analytics | ✓ | 0 |
| seatly_cron_config | ✓ | 1 |

**Total: 26 tables — all built and live.**

---

## 2. TABLES NOT BUILT YET

**None.** Every table in BACKEND.md exists in Supabase.

---

## 3. EDGE FUNCTIONS DEPLOYED

**None.** Zero Edge Functions are currently deployed to Supabase.

---

## 4. EDGE FUNCTIONS NOT DEPLOYED YET

### Nightly Cron (8 functions — code exists locally, not deployed)

| Function | Status | Schedule |
|----------|--------|----------|
| calculate-no-show-risk | Code exists, NOT deployed | 2am UTC daily |
| calculate-lifetime-value | Code exists, NOT deployed | 2am UTC daily |
| run-auto-tagging | Code exists, NOT deployed | 3am UTC daily |
| compute-analytics | Code exists, NOT deployed | 4am UTC daily |
| generate-shift-briefing | Code exists, NOT deployed | 5am UTC daily |
| send-birthday-messages | Code exists, NOT deployed | 8am UTC daily |
| send-anniversary-messages | Code exists, NOT deployed | 8am UTC daily |
| expire-loyalty-points | Code exists, NOT deployed | Midnight 1st of month |

### On-Demand (13 functions — not built, not deployed)

| Function | Status |
|----------|--------|
| get_availability | Not built |
| create_booking | Not built |
| check_in_guest | Not built |
| close_bill | Not built |
| ai_chat | Not built |
| ai_crm_query | Not built |
| detect_duplicates | Not built |
| merge_guests | Not built |
| send_communication | Not built |
| calculate_demand_forecast | Not built |
| process_deposit_refund | Not built |
| forfeit_deposit | Not built |
| scan_menu | Not built |

**Total: 21 Edge Functions — 0 deployed, 8 built locally, 13 not built.**

---

## 5. DATABASE TRIGGERS LIVE

| Trigger | Table | What it does |
|---------|-------|--------------|
| trg_update_guest_totals | orders | Increments guest.total_visits, total_spend, average_spend_per_visit, last_visit_at when orders.paid_at is set |
| trg_increment_no_show | reservations | Increments guest.no_show_count when reservation.status = no_show |
| trg_increment_cancellation | reservations | Increments guest.cancellation_count when reservation.status = cancelled |
| trg_update_loyalty_balance | loyalty_transactions | Updates guest.loyalty_points_balance when loyalty_transactions row inserted |
| trg_update_tickets_sold | event_tickets | Increments events.tickets_sold when event_tickets row inserted |

**Total: 5 triggers — all live.**

---

## 6. REALTIME CHANNELS ACTIVE

| Channel | Table | In Publication |
|---------|-------|----------------|
| reservations:{restaurant_id} | reservations | ✓ |
| tables:{restaurant_id} | tables | ✓ |
| orders:{restaurant_id} | orders | ✓ |
| order_items:{restaurant_id} | order_items | ✓ |
| waitlist:{restaurant_id} | waitlist | ✓ |

**Total: 5 tables in supabase_realtime publication — all active.**

---

## 7. STORAGE BUCKETS EXIST

| Bucket | Public | Status |
|--------|--------|--------|
| restaurant-logos | Yes | ✓ Exists |
| menu-photos | Yes | ✓ Exists |
| user-avatars | No | ✓ Exists |
| cover-photos | Yes | ✓ Exists |

**Total: 4 buckets — all exist.**

---

## 8. CRON JOBS SCHEDULED

| Job Name | Schedule (UTC) | Command |
|----------|----------------|---------|
| seatly_calculate_no_show_risk | 0 2 * * * (2am daily) | seatly_call_cron_function('calculate-no-show-risk') |
| seatly_calculate_lifetime_value | 0 2 * * * (2am daily) | seatly_call_cron_function('calculate-lifetime-value') |
| seatly_run_auto_tagging | 0 3 * * * (3am daily) | seatly_call_cron_function('run-auto-tagging') |
| seatly_compute_analytics | 0 4 * * * (4am daily) | seatly_call_cron_function('compute-analytics') |
| seatly_generate_shift_briefing | 0 5 * * * (5am daily) | seatly_call_cron_function('generate-shift-briefing') |
| seatly_send_birthday_messages | 0 8 * * * (8am daily) | seatly_call_cron_function('send-birthday-messages') |
| seatly_send_anniversary_messages | 0 8 * * * (8am daily) | seatly_call_cron_function('send-anniversary-messages') |
| seatly_expire_loyalty_points | 0 0 1 * * (midnight 1st) | seatly_call_cron_function('expire-loyalty-points') |

**Total: 8 cron jobs — all scheduled.** (Will fail until Edge Functions are deployed.)

---

## 9. CURRENT BUILD STATUS OF EVERY PHASE

| Phase | Database | Backend Logic | Web App | Mobile App |
|-------|----------|---------------|---------|------------|
| **Foundation** | — | — | [ ] | [ ] |
| **Phase 1 — Core Tables** | [x] Complete | — | [ ] | [ ] |
| **Phase 2 — Auth** | [x] RLS done | [ ] Role assignment EF | [ ] | [ ] |
| **Phase 3 — Reservations** | [x] Complete | [ ] get_availability, create_booking | [ ] | [ ] |
| **Phase 4 — Menu** | [x] Complete | — | [ ] | [ ] |
| **Phase 5 — Orders** | [x] Complete | [ ] check_in_guest, close_bill | [ ] | [ ] |
| **Phase 6 — Guest CRM** | [x] Complete | [ ] detect_duplicates, merge_guests | [ ] | [ ] |
| **Phase 7 — Financial** | [x] Complete | [ ] Stripe deposit, refund, forfeit | [ ] | [ ] |
| **Phase 8 — Staff** | [x] Complete | — | [ ] | [ ] |
| **Phase 9 — Analytics** | [x] Complete | [~] 8 cron EFs built, 0 deployed | [ ] | [ ] |
| **Phase 10 — AI** | — | [ ] ai_chat, ai_crm_query, scan_menu | [ ] | [ ] |
| **Phase 11 — Communications** | — | [ ] send_communication | [ ] | [ ] |
| **Phase 12 — Launch Prep** | — | [ ] Stripe billing, rate limiting, Sentry | [ ] | [ ] |

---

## 10. WHAT STILL NEEDS TO BE DONE BEFORE BACKEND IS 100% COMPLETE

### Critical (blocks core flows)

1. **Deploy 8 nightly cron Edge Functions** — Code exists in `supabase/functions/`, deploy with `verify_jwt: false`
2. **Build and deploy get_availability** — Returns available slots for restaurant/date/party size
3. **Build and deploy create_booking** — Creates reservation, guest, charges deposit, sends confirmation
4. **Build and deploy check_in_guest** — Marks checked in, generates kitchen ticket
5. **Build and deploy close_bill** — Sets order.paid_at, triggers CRM update
6. **Build and deploy send_communication** — SMS via Twilio, email via Resend

### Important (CRM and AI)

7. **Build and deploy ai_chat** — Customer booking via Claude
8. **Build and deploy ai_crm_query** — Owner natural language queries via Claude
9. **Build and deploy detect_duplicates** — Find duplicate guests by phone/email
10. **Build and deploy merge_guests** — Merge two guest profiles
11. **Build and deploy scan_menu** — Extract menu items from PDF/image via AI

### Financial

12. **Build and deploy process_deposit_refund** — Refund via Stripe on cancellation
13. **Build and deploy forfeit_deposit** — Mark forfeited on no-show
14. **Stripe deposit charge** — On create_booking when required
15. **Stripe billing** — Seatly subscription plans

### Analytics

16. **Build and deploy calculate_demand_forecast** — Project busy periods

### Auth

17. **Role assignment Edge Function** — On signup, set user_profiles.role and restaurant_id

### Hardening

18. **Rate limiting** — On all Edge Functions
19. **Sentry** — Error logging configured
20. **Webhook signature verification** — Stripe, Twilio
21. **VAPI integration** — Voice AI receptionist (optional)

---

## Summary

| Category | Done | Remaining |
|----------|------|-----------|
| Tables | 26 | 0 |
| Triggers | 5 | 0 |
| Realtime | 5 tables | 0 |
| Storage | 4 buckets | 0 |
| Cron jobs | 8 scheduled | 0 |
| Edge Functions | 0 deployed | 21 (8 built, 13 not built) |
| Backend completion | ~60% (DB + infra) | ~40% (Edge Functions) |
