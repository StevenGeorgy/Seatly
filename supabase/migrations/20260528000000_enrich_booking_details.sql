-- 2026-05-28 — Enrich booking details + payment-method snapshot
--
-- Adds:
--   1. card_brand + card_last4 columns on orders and reservation_deposit_payments
--      (populated by stripe-webhook on payment_intent.succeeded going forward;
--      historical rows stay NULL until they're re-charged or refunded).
--   2. lookup_reservation_details(p_slug, p_code, p_email) — enriched lookup
--      RPC that returns the full booking detail bundle for guest-facing
--      views. Requires (code + email) two-factor to match the same security
--      model that modify-reservation + cancel-reservation enforce.
--      Returns nested JSONB so the client gets everything in one round-trip.
--
-- The existing lookup_reservation_by_code(p_slug, p_code) RPC stays
-- unchanged for backwards compatibility — callers can migrate over
-- when they're ready.

BEGIN;

-- ── Card brand + last4 columns ──
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS card_brand text,
  ADD COLUMN IF NOT EXISTS card_last4 text;

ALTER TABLE public.reservation_deposit_payments
  ADD COLUMN IF NOT EXISTS card_brand text,
  ADD COLUMN IF NOT EXISTS card_last4 text;

COMMENT ON COLUMN public.orders.card_brand IS
  'Stripe card brand snapshot (visa/mastercard/amex/etc) populated by stripe-webhook on PI succeeded.';
COMMENT ON COLUMN public.orders.card_last4 IS
  'Last 4 digits of the card used to pay this order. Populated by stripe-webhook on PI succeeded.';
COMMENT ON COLUMN public.reservation_deposit_payments.card_brand IS
  'Stripe card brand snapshot for this deposit payer.';
COMMENT ON COLUMN public.reservation_deposit_payments.card_last4 IS
  'Last 4 digits of this deposit payer''s card.';

-- ── New enriched lookup RPC ──
-- Returns a single JSONB blob with all booking details for the guest
-- manage-view. Requires email second-factor match (case-insensitive,
-- whitespace-trimmed) — RPC returns NULL if (code, email) doesn't
-- resolve to a single reservation.

CREATE OR REPLACE FUNCTION public.lookup_reservation_details(
  p_slug text,
  p_code text,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email_norm text;
  v_reservation reservations%ROWTYPE;
  v_restaurant restaurants%ROWTYPE;
  v_result jsonb;
  v_orders jsonb;
  v_deposits jsonb;
  v_deposit_tier jsonb;
BEGIN
  v_email_norm := lower(NULLIF(trim(COALESCE(p_email, '')), ''));
  IF v_email_norm IS NULL OR p_code IS NULL OR p_slug IS NULL THEN
    RETURN NULL;
  END IF;

  -- Fetch reservation by (slug, code, email) — match cancel/modify pattern
  SELECT r.* INTO v_reservation
  FROM reservations r
  JOIN restaurants rt ON rt.id = r.restaurant_id
  WHERE rt.slug = p_slug
    AND r.confirmation_code IS NOT NULL
    AND lower(trim(r.confirmation_code)) = lower(trim(p_code))
    AND (
      -- Logged-in diner path: user_profile_id's email matches
      EXISTS (
        SELECT 1 FROM user_profiles up
        WHERE up.id = r.user_profile_id
          AND lower(up.email) = v_email_norm
      )
      OR
      -- Guest path: guest_email matches directly
      lower(r.guest_email) = v_email_norm
    )
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_restaurant FROM restaurants WHERE id = v_reservation.restaurant_id;

  -- Compute deposit tier breakdown for this party size
  SELECT to_jsonb(t.*) INTO v_deposit_tier
  FROM (
    SELECT
      (tier->>'min_party_size')::int AS min_party_size,
      (tier->>'amount_per_person_cents')::int AS amount_per_person_cents,
      (tier->>'amount_per_person_cents')::int * v_reservation.party_size AS total_cents
    FROM jsonb_array_elements(COALESCE(v_restaurant.deposit_tiers, '[]'::jsonb)) AS tier
    WHERE (tier->>'min_party_size')::int <= v_reservation.party_size
    ORDER BY (tier->>'min_party_size')::int DESC
    LIMIT 1
  ) t;

  -- Aggregate orders + items
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', o.id,
      'status', o.status,
      'subtotal', o.subtotal,
      'tax_amount', o.tax_amount,
      'tip_amount', o.tip_amount,
      'total_amount', o.total_amount,
      'is_preorder', o.is_preorder,
      'stripe_payment_intent_id', o.stripe_payment_intent_id,
      'card_brand', o.card_brand,
      'card_last4', o.card_last4,
      'items', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', oi.id,
          'menu_item_id', oi.menu_item_id,
          'name', oi.name,
          'quantity', oi.quantity,
          'unit_price', oi.unit_price,
          'line_total', oi.line_total
        ) ORDER BY oi.added_at), '[]'::jsonb)
        FROM order_items oi
        WHERE oi.order_id = o.id
      )
    )
  ), '[]'::jsonb) INTO v_orders
  FROM orders o
  WHERE o.reservation_id = v_reservation.id;

  -- Aggregate deposit payments (split-tender or single)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'payer_full_name', d.payer_full_name,
      'payer_email', d.payer_email,
      'amount_cents', d.amount_cents,
      'status', d.status,
      'paid_at', d.paid_at,
      'card_brand', d.card_brand,
      'card_last4', d.card_last4,
      'stripe_payment_intent_id', d.stripe_payment_intent_id
    ) ORDER BY d.created_at
  ), '[]'::jsonb) INTO v_deposits
  FROM reservation_deposit_payments d
  WHERE d.reservation_id = v_reservation.id;

  -- Build the final response blob
  v_result := jsonb_build_object(
    'reservation', jsonb_build_object(
      'id', v_reservation.id,
      'confirmation_code', v_reservation.confirmation_code,
      'status', v_reservation.status,
      'reserved_at', v_reservation.reserved_at,
      'party_size', v_reservation.party_size,
      'duration_minutes', v_reservation.duration_minutes,
      'special_request', v_reservation.special_request,
      'guest_full_name', v_reservation.guest_full_name,
      'guest_email', v_reservation.guest_email,
      'guest_phone', v_reservation.guest_phone,
      'applied_promo_code', v_reservation.applied_promo_code,
      'cancelled_at', v_reservation.cancelled_at,
      'cancellation_reason', v_reservation.cancellation_reason,
      'seated_at', v_reservation.seated_at,
      'no_show_at', v_reservation.no_show_at,
      'completed_at', v_reservation.completed_at,
      'deposit_amount_cents', v_reservation.deposit_amount_cents,
      'deposit_status', v_reservation.deposit_status
    ),
    'restaurant', jsonb_build_object(
      'id', v_restaurant.id,
      'name', v_restaurant.name,
      'slug', v_restaurant.slug,
      'address', v_restaurant.address,
      'phone', v_restaurant.phone,
      'city', v_restaurant.city,
      'province', v_restaurant.province,
      'timezone', v_restaurant.timezone,
      'tax_rate', v_restaurant.tax_rate,
      'logo_url', v_restaurant.logo_url,
      'cover_photo_url', v_restaurant.cover_photo_url
    ),
    'deposit_tier', v_deposit_tier,
    'orders', v_orders,
    'deposits', v_deposits
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_reservation_details(text, text, text)
  TO anon, authenticated;

COMMIT;
