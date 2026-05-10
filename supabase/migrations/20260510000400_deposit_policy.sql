-- Deposit policy: per-restaurant tiered deposits keyed on party-size threshold.
--
-- Owner can configure tiers like "8+ pay $10/person, 20+ pay $20/person".
-- Customer pays the HIGHEST applicable tier × party_size (not additive).
-- Booking lands in 'pending' status until deposit rows hit 'charged'; a trigger
-- flips the reservation to 'confirmed' once all payment rows are settled.
--
-- Stripe wiring is deferred (the prepare-deposit edge function and the
-- /deposit/:paymentId page are stubbed for now). All real payment intent IDs
-- are stored in stripe_payment_intent_id when Stripe is wired in a future phase.

-- ---------------------------------------------------------------------------
-- 1. restaurants.deposit_tiers — owner-configured tiered deposits.
-- Shape: array of {min_party_size: int, amount_per_person_cents: int}.
-- Empty array means no deposit policy (default for all restaurants).
-- ---------------------------------------------------------------------------

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS deposit_tiers jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Postgres CHECK constraints can't contain subqueries, so the shape validation
-- lives in a helper function called from the constraint.
CREATE OR REPLACE FUNCTION public.validate_deposit_tiers(p_tiers jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_tier jsonb;
BEGIN
  IF p_tiers IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(p_tiers) <> 'array' THEN RETURN false; END IF;
  FOR v_tier IN SELECT * FROM jsonb_array_elements(p_tiers) LOOP
    IF jsonb_typeof(v_tier) <> 'object' THEN RETURN false; END IF;
    IF (v_tier ->> 'min_party_size') IS NULL THEN RETURN false; END IF;
    IF (v_tier ->> 'amount_per_person_cents') IS NULL THEN RETURN false; END IF;
    BEGIN
      IF (v_tier ->> 'min_party_size')::int < 1 THEN RETURN false; END IF;
      IF (v_tier ->> 'amount_per_person_cents')::int < 0 THEN RETURN false; END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN false;
    END;
  END LOOP;
  RETURN true;
END;
$function$;

ALTER TABLE public.restaurants
  DROP CONSTRAINT IF EXISTS restaurants_deposit_tiers_shape;

ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_deposit_tiers_shape
  CHECK (public.validate_deposit_tiers(deposit_tiers));

-- ---------------------------------------------------------------------------
-- 2. reservations: deposit columns.
-- ---------------------------------------------------------------------------

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS deposit_amount_cents integer;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS deposit_status text NOT NULL DEFAULT 'none';

ALTER TABLE public.reservations
  DROP CONSTRAINT IF EXISTS reservations_deposit_status_check;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_deposit_status_check
  CHECK (deposit_status IN ('none', 'pending', 'charged', 'waived', 'failed'));

CREATE INDEX IF NOT EXISTS reservations_deposit_status_pending_idx
  ON public.reservations (deposit_status)
  WHERE deposit_status = 'pending';

-- ---------------------------------------------------------------------------
-- 3. reservation_deposit_payments — split-tender support.
-- One row per payer; reservation transitions to 'charged' overall when every
-- row is 'charged'.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.reservation_deposit_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  payer_email text,
  payer_user_profile_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  payer_full_name text,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'charged', 'failed', 'refunded')),
  stripe_payment_intent_id text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservation_deposit_payments_payer_required
    CHECK (
      payer_email IS NOT NULL OR payer_user_profile_id IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS reservation_deposit_payments_reservation_idx
  ON public.reservation_deposit_payments (reservation_id);

CREATE INDEX IF NOT EXISTS reservation_deposit_payments_status_idx
  ON public.reservation_deposit_payments (status);

CREATE INDEX IF NOT EXISTS reservation_deposit_payments_email_idx
  ON public.reservation_deposit_payments (lower(payer_email))
  WHERE payer_email IS NOT NULL;

-- updated_at trigger.
CREATE OR REPLACE FUNCTION public.reservation_deposit_payments_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservation_deposit_payments_updated_at ON public.reservation_deposit_payments;
CREATE TRIGGER reservation_deposit_payments_updated_at
  BEFORE UPDATE ON public.reservation_deposit_payments
  FOR EACH ROW EXECUTE FUNCTION public.reservation_deposit_payments_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS for reservation_deposit_payments.
-- Owner-of-restaurant: see all rows for their restaurant's reservations.
-- Diner: see their own payment rows (matched by email or user_profile_id).
-- Service-role: full access (all writes go through edge functions).
-- ---------------------------------------------------------------------------

ALTER TABLE public.reservation_deposit_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rdp_owner_select ON public.reservation_deposit_payments;
CREATE POLICY rdp_owner_select ON public.reservation_deposit_payments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reservations r
      WHERE r.id = reservation_deposit_payments.reservation_id
        AND public.user_has_restaurant_staff_access(r.restaurant_id)
    )
  );

DROP POLICY IF EXISTS rdp_diner_select ON public.reservation_deposit_payments;
CREATE POLICY rdp_diner_select ON public.reservation_deposit_payments
  FOR SELECT
  TO authenticated
  USING (
    payer_user_profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.reservations r
      WHERE r.id = reservation_deposit_payments.reservation_id
        AND r.user_profile_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 5. compute_deposit_for_party — pure helper used by booking flow + dashboard
-- preview. Returns total deposit in cents for a given party size at a
-- restaurant. Returns 0 if no tier applies.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.compute_deposit_for_party(
  p_restaurant_id uuid,
  p_party_size integer
)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH tiers AS (
    SELECT
      (tier ->> 'min_party_size')::int AS min_party_size,
      (tier ->> 'amount_per_person_cents')::int AS amount_per_person_cents
    FROM public.restaurants r,
         LATERAL jsonb_array_elements(COALESCE(r.deposit_tiers, '[]'::jsonb)) AS tier
    WHERE r.id = p_restaurant_id
  ),
  applicable AS (
    SELECT amount_per_person_cents
    FROM tiers
    WHERE p_party_size >= min_party_size
    ORDER BY min_party_size DESC
    LIMIT 1
  )
  SELECT COALESCE(
    (SELECT amount_per_person_cents * p_party_size FROM applicable),
    0
  )::integer;
$function$;

GRANT EXECUTE ON FUNCTION public.compute_deposit_for_party(uuid, integer)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Trigger: when ALL reservation_deposit_payments rows for a reservation
-- reach status='charged', flip the reservation's deposit_status to 'charged'
-- and (if currently 'pending') status to 'confirmed' + confirmed_at.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reservation_deposit_settle_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer;
  v_charged integer;
  v_failed integer;
  v_reservation_id uuid;
BEGIN
  v_reservation_id := COALESCE(NEW.reservation_id, OLD.reservation_id);
  IF v_reservation_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE status = 'charged')::int,
    COUNT(*) FILTER (WHERE status = 'failed')::int
  INTO v_total, v_charged, v_failed
  FROM public.reservation_deposit_payments
  WHERE reservation_id = v_reservation_id;

  IF v_total = 0 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_charged = v_total THEN
    UPDATE public.reservations
    SET deposit_status = 'charged',
        status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
        confirmed_at = COALESCE(confirmed_at, now()),
        updated_at = now()
    WHERE id = v_reservation_id
      AND deposit_status <> 'charged';
  ELSIF v_failed > 0 AND v_failed = v_total THEN
    UPDATE public.reservations
    SET deposit_status = 'failed',
        updated_at = now()
    WHERE id = v_reservation_id
      AND deposit_status <> 'failed';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS reservation_deposit_settle ON public.reservation_deposit_payments;
CREATE TRIGGER reservation_deposit_settle
  AFTER INSERT OR UPDATE OF status OR DELETE
  ON public.reservation_deposit_payments
  FOR EACH ROW EXECUTE FUNCTION public.reservation_deposit_settle_trigger();
