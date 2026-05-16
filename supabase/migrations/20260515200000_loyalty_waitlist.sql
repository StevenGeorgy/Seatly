-- Loyalty waitlist: emails captured on the /loyalty Coming Soon page so we
-- can announce when the loyalty programme launches. Inserts happen only via
-- the loyalty-waitlist-signup edge function (service-role); no client-side
-- access. Matches the security pattern of account_merge_audit.

create table public.loyalty_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  user_id uuid references public.user_profiles(id) on delete set null,
  source text,
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness so "Foo@bar.com" and "foo@bar.com" don't both
-- land. Email normalization to lowercase happens in the edge fn as well.
create unique index loyalty_waitlist_email_unique_lower
  on public.loyalty_waitlist (lower(email));

create index loyalty_waitlist_created_at_idx
  on public.loyalty_waitlist (created_at desc);

alter table public.loyalty_waitlist enable row level security;

-- Deny all client-side access. Inserts happen via service-role through the
-- loyalty-waitlist-signup edge fn; reads happen only via support/admin tools
-- with service-role credentials.
revoke all on public.loyalty_waitlist from anon, authenticated;
