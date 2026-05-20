-- Schedule the bill-booking-fees edge function to run hourly.
-- The edge function sweeps pending restaurant_booking_fees rows into Stripe
-- invoice_items on each restaurant's subscription customer, which then roll
-- into the next monthly subscription invoice.
--
-- Hourly cadence keeps the lag between booking and bill modest without
-- hammering the Stripe API. Each run processes up to 500 pending rows.

SELECT cron.schedule(
  'cenaiva_bill_booking_fees',
  '0 * * * *',
  $$SELECT seatly_call_cron_function('bill-booking-fees')$$
);
