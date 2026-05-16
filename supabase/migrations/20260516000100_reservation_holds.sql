-- Reservation holds — 30-minute slot hold that precedes a confirmed reservation.
--
-- Lifecycle: a hold is created when a diner enters the 3-step web booking flow
-- (Details → Menu → Payment). The slot is blocked from other diners for up to
-- 30 minutes. On completion (Place Order for no-payment, Stripe success for
-- deposit/preorder), the hold is converted into a real reservations row.
-- On expiry, the cleanup job (pg_cron, every 5 min) silently flips status to
-- 'expired' so the slot is freed.
--
-- DESIGN: separate table (NOT a new reservations.status). Keeps the existing
-- status IN ('pending','confirmed','seated') filter on reservations untouched
-- so owner dashboards, analytics, RLS, floor plan queries, and voice flows
-- are zero-risk. Availability RPCs are patched separately to UNION in active
-- holds as blockers.

CREATE TABLE IF NOT EXISTS public.reservation_holds (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id            uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  shift_id                 uuid NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  reserved_at              timestamptz NOT NULL,
  duration_minutes         integer NOT NULL DEFAULT 90,
  slot_range               tstzrange NOT NULL,
  party_size               integer NOT NULL CHECK (party_size >= 1),
  table_ids                uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],

  -- Diner identity. Nullable on initial create (Step 1 page mount before form
  -- submit); populated via update_reservation_hold_diner once they submit.
  user_profile_id          uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  guest_id                 uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  guest_full_name          text,
  guest_email              text,
  guest_phone              text,

  -- Booking metadata mirrored from reservations.
  confirmation_code        text NOT NULL,
  source                   text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'cenaiva', 'app', 'host')),
  special_request          text,
  dietary_notes            text,
  occasion                 text,
  seating_preference       text,
  event_id                 uuid REFERENCES public.events(id) ON DELETE SET NULL,
  promotion_id             uuid REFERENCES public.promotions(id) ON DELETE SET NULL,
  applied_promo_code       text,

  -- Cart snapshot for pre-order. Empty object until Step 2 populates it.
  cart_snapshot            jsonb NOT NULL DEFAULT '{}'::jsonb,
  deposit_amount_cents     integer NOT NULL DEFAULT 0,
  total_amount_cents       integer NOT NULL DEFAULT 0,

  -- Set by create-public-payment-intent when a PI is created against the hold.
  stripe_payment_intent_id text,

  -- Lifecycle status. 'active' → 'converting' (during atomic conversion) →
  -- 'converted' (terminal, has converted_reservation_id) | 'expired' | 'cancelled'.
  status                   text NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'converting', 'converted', 'expired', 'cancelled')),
  converted_reservation_id uuid REFERENCES public.reservations(id) ON DELETE SET NULL,

  -- Lifecycle timestamps.
  created_at               timestamptz NOT NULL DEFAULT now(),
  expires_at               timestamptz NOT NULL,
  last_heartbeat_at        timestamptz NOT NULL DEFAULT now()
);

-- slot_range trigger — mirrors reservations_set_slot_range.
CREATE OR REPLACE FUNCTION public.reservation_holds_set_slot_range()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.slot_range := tstzrange(
    NEW.reserved_at,
    NEW.reserved_at + (COALESCE(NULLIF(NEW.duration_minutes, 0), 90) * interval '1 minute'),
    '[)'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservation_holds_set_slot_range_trg ON public.reservation_holds;
CREATE TRIGGER reservation_holds_set_slot_range_trg
  BEFORE INSERT OR UPDATE OF reserved_at, duration_minutes
  ON public.reservation_holds
  FOR EACH ROW
  EXECUTE FUNCTION public.reservation_holds_set_slot_range();

-- updated_at-style trigger NOT added — heartbeat updates are explicit via RPC.

-- Indexes.
CREATE INDEX IF NOT EXISTS reservation_holds_active_expires_idx
  ON public.reservation_holds (expires_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS reservation_holds_active_slot_gist
  ON public.reservation_holds USING gist (restaurant_id, slot_range)
  WHERE status IN ('active', 'converting');

CREATE INDEX IF NOT EXISTS reservation_holds_table_ids_gin
  ON public.reservation_holds USING gin (table_ids)
  WHERE status IN ('active', 'converting');

CREATE UNIQUE INDEX IF NOT EXISTS reservation_holds_pi_unique
  ON public.reservation_holds (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS reservation_holds_restaurant_idx
  ON public.reservation_holds (restaurant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS reservation_holds_user_profile_idx
  ON public.reservation_holds (user_profile_id)
  WHERE user_profile_id IS NOT NULL AND status IN ('active', 'converting');

-- Diner-double-book backstops. Same shape as the partial GiST exclusions on
-- reservations (20260508001400_reservations_diner_no_overlap.sql), but only
-- against active holds. RPCs pre-check; these are the race backstop raising
-- 23P01 → mapped to 'diner_double_book' by callers.

ALTER TABLE public.reservation_holds
  ADD CONSTRAINT holds_user_no_overlap
  EXCLUDE USING gist (user_profile_id WITH =, slot_range WITH &&)
  WHERE (user_profile_id IS NOT NULL AND status IN ('active', 'converting'));

ALTER TABLE public.reservation_holds
  ADD CONSTRAINT holds_guest_email_no_overlap
  EXCLUDE USING gist ((lower(guest_email)) WITH =, slot_range WITH &&)
  WHERE (user_profile_id IS NULL AND guest_email IS NOT NULL AND status IN ('active', 'converting'));

ALTER TABLE public.reservation_holds
  ADD CONSTRAINT holds_guest_phone_no_overlap
  EXCLUDE USING gist ((regexp_replace(COALESCE(guest_phone, ''), '\D', '', 'g')) WITH =, slot_range WITH &&)
  WHERE (user_profile_id IS NULL AND guest_phone IS NOT NULL AND status IN ('active', 'converting'));

-- RLS — owners are explicitly excluded so holds stay invisible on floor plans.
-- Diners can read their own active hold (matched by user_profile_id) so the
-- payment page survives a refresh.
ALTER TABLE public.reservation_holds ENABLE ROW LEVEL SECURITY;

CREATE POLICY reservation_holds_service_role_all ON public.reservation_holds
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY reservation_holds_diner_self_select ON public.reservation_holds
  FOR SELECT
  TO authenticated
  USING (user_profile_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies for authenticated/anon — all writes go
-- through SECURITY DEFINER edge functions. Owners (any restaurant role) have
-- NO read access, which is the entire point of this design.

COMMENT ON TABLE public.reservation_holds IS
  'Temporary 30-min slot holds that precede confirmed reservations for the web booking flow. Owner dashboards do NOT show these.';
