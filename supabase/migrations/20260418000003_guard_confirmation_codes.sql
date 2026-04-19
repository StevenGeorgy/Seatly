-- cenaiva-chat already writes confirmation_code but no migration existed.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS confirmation_code text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS confirmation_code text;
