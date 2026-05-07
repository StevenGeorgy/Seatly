-- Public RPC to fetch a reservation summary by restaurant slug + confirmation code.
-- Used by the diner-facing manage page (RestaurantPublicPage when ?confirmation= is set).
-- Returns minimal columns; the cancel/modify edge functions independently re-verify
-- the code before any state-changing action.

create or replace function public.lookup_reservation_by_code(
  p_slug text,
  p_code text
)
returns table (
  id uuid,
  restaurant_id uuid,
  reserved_at timestamptz,
  party_size int,
  status text,
  guest_full_name text,
  duration_minutes int,
  special_request text,
  restaurant_name text,
  restaurant_timezone text
)
language sql
security definer
set search_path = public
as $$
  select
    r.id,
    r.restaurant_id,
    r.reserved_at,
    r.party_size,
    r.status,
    r.guest_full_name,
    r.duration_minutes,
    r.special_request,
    rt.name as restaurant_name,
    rt.timezone as restaurant_timezone
  from public.reservations r
  join public.restaurants rt on rt.id = r.restaurant_id
  where rt.slug = p_slug
    and r.confirmation_code is not null
    and lower(trim(r.confirmation_code)) = lower(trim(p_code))
  limit 1;
$$;

grant execute on function public.lookup_reservation_by_code(text, text) to anon, authenticated;
