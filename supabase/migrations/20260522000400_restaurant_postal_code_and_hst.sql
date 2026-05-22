-- Block 1: Stripe Tax enablement on Cenaiva-side revenue. Needs postal_code
-- to determine jurisdiction. hst_registration_number is optional for B2B
-- Input Tax Credit support on Cenaiva invoices.

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS hst_registration_number text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'restaurants_postal_code_len'
  ) THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_postal_code_len
        CHECK (postal_code IS NULL OR char_length(postal_code) <= 20) NOT VALID;
    ALTER TABLE public.restaurants VALIDATE CONSTRAINT restaurants_postal_code_len;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'restaurants_hst_reg_len'
  ) THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_hst_reg_len
        CHECK (hst_registration_number IS NULL OR char_length(hst_registration_number) <= 40) NOT VALID;
    ALTER TABLE public.restaurants VALIDATE CONSTRAINT restaurants_hst_reg_len;
  END IF;
END $$;

COMMENT ON COLUMN public.restaurants.postal_code IS
  'Canadian postal code (e.g. M5V 3A8). Required by Stripe Tax automatic_tax.';
COMMENT ON COLUMN public.restaurants.hst_registration_number IS
  'Optional GST/HST registration number. Sent to Stripe as tax_id_data for B2B invoicing.';
