-- Hardens DINER account deletion (edge fn: delete-account).
--
-- Before this migration, deleting a diner's user_profiles row was BLOCKED by
-- non-cascade foreign keys (diner_consent_log = RESTRICT; payments / waitlist /
-- subscription_consent_log / ai_conversations = NO ACTION). Because the edge
-- function never cleared those references, the user_profiles DELETE threw a FK
-- violation and the whole "delete my account" failed — after it had already
-- cancelled/refunded reservations and deleted the Stripe customer. Even when it
-- did succeed, denormalized diner PII (guest_full_name/email/phone, dietary
-- notes, payer name, the guests CRM row) was left behind.
--
-- This migration:
--   1. Makes the legally-retained consent record de-identifiable in place
--      (diner_consent_log.user_profile_id was NOT NULL; the other blocker
--      columns are already nullable).
--   2. Adds delete_diner_account(uuid) — a single atomic routine that scrubs all
--      denormalized PII, de-identifies legally-retained consent/payment records,
--      then deletes the user_profiles row (cascading chat/notifications/reviews/
--      cards/etc.). Running it as one function makes a partial failure roll back.

-- 1. Allow the consent record to be de-identified rather than deleted (CRA /
--    Law 25 retention: keep proof-of-consent, strip the identity + IP/UA).
alter table public.diner_consent_log alter column user_profile_id drop not null;

-- 2. Atomic diner erasure. SECURITY DEFINER so it can clear cross-table
--    references and bypass RLS; execution restricted to service_role.
create or replace function public.delete_diner_account(p_user_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guest_ids uuid[];
begin
  -- The diner's restaurant-CRM guest rows (used to also scrub guest-linked
  -- reservation/hold records that may have a null user_profile_id).
  select coalesce(array_agg(id), '{}'::uuid[]) into v_guest_ids
  from guests where user_profile_id = p_user_profile_id;

  -- ── Scrub denormalized diner PII on records that survive (de-identified) ──
  update reservations set
      guest_full_name = null, guest_email = null, guest_phone = null,
      special_request = null, dietary_notes = null, occasion = null,
      internal_notes = null, cancellation_reason = null
  where user_profile_id = p_user_profile_id or guest_id = any(v_guest_ids);

  update reservation_holds set
      guest_full_name = null, guest_email = null, guest_phone = null,
      special_request = null, dietary_notes = null, occasion = null
  where user_profile_id = p_user_profile_id or guest_id = any(v_guest_ids);

  update reservation_deposit_payments set
      payer_email = null, payer_full_name = null
  where payer_user_profile_id = p_user_profile_id;

  -- ── De-identify the restaurant-CRM guest record (keep anon aggregates) ──
  update guests set
      full_name = null, email = null, phone = null, birthday = null,
      anniversary = null, preferred_language = null, tags = null,
      dietary_restrictions = null, allergies = null, seating_preference = null,
      noise_preference = null, favourite_dishes = null, favourite_drinks = null,
      internal_notes = null, car_details_json = null,
      stripe_payment_method_id = null, last_contacted_at = null,
      acquisition_source = null, preferred_payment_method = null,
      user_profile_id = null
  where user_profile_id = p_user_profile_id;

  -- ── Clear the FK blockers that previously aborted the profile delete ──
  -- Legally-retained records: keep the row, de-identify + unlink.
  update diner_consent_log set
      user_profile_id = null, ip_address = null, user_agent = null
  where user_profile_id = p_user_profile_id;

  update subscription_consent_log set
      user_profile_id = null, ip_address = null, user_agent = null
  where user_profile_id = p_user_profile_id;

  update payments set user_profile_id = null
  where user_profile_id = p_user_profile_id;

  -- Diner waitlist entries: keep the operational row, strip contact PII.
  update waitlist set
      user_profile_id = null, guest_name = null, phone = null,
      guest_phone = null, guest_email = null, notes = null
  where user_profile_id = p_user_profile_id;

  -- Legacy diner AI conversations (not covered by a cascade): hard-delete.
  delete from ai_conversations where user_id = p_user_profile_id;

  -- Loyalty-waitlist signup captures the diner's email; the FK is SET NULL
  -- (would leave the email behind) so hard-delete the diner's rows instead.
  delete from loyalty_waitlist where user_id = p_user_profile_id;

  -- ── Finally delete the profile. Every blocking reference is now cleared, so
  --    this succeeds and cascades the CASCADE children (chat_conversations →
  --    chat_messages, notifications, availability_alerts, restaurant_reviews,
  --    saved_cards, data_correction_requests, user_restaurant_comm_prefs, …).
  delete from user_profiles where id = p_user_profile_id;
end;
$$;

revoke all on function public.delete_diner_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_diner_account(uuid) to service_role;

comment on function public.delete_diner_account(uuid) is
  'Atomic diner account erasure: scrubs denormalized PII, de-identifies legally-retained consent/payment records, then deletes user_profiles (cascading chat/notifications/reviews/cards). Called only by the delete-account edge function (service_role).';
