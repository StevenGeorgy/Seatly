-- 2026-05-28 — restaurant_notification_log: add reservation_id + unique
-- index so per-reservation dedup is atomic.
--
-- Background: PR-D added owner-notification firing from both
-- confirm-deposit-paid AND stripe-webhook for split-tender (to fix the
-- race where stripe-webhook beats confirm-deposit-paid and the latter's
-- idempotent early-return skips the notification block). The 5-second
-- notification-log dedup window was supposed to swat duplicates.
--
-- Tonight we observed Mark received 2 emails for the same reservation,
-- both sent within 87 milliseconds of each other. The dedup window WAS
-- active (5s) but lost the TOCTOU race: both calls did the SELECT-then-
-- INSERT before the other's INSERT was visible. Result: 2 emails for 1
-- reservation.
--
-- Fix: add a `reservation_id` column + partial unique index. INSERT
-- becomes naturally idempotent via 23505 unique_violation. Callers that
-- pass reservation_id (the new path) get atomic per-reservation dedup;
-- legacy callers without reservation_id (subscription_* etc.) keep the
-- existing time-window dedup unchanged.

ALTER TABLE public.restaurant_notification_log
  ADD COLUMN IF NOT EXISTS reservation_id uuid REFERENCES public.reservations(id) ON DELETE RESTRICT;

-- Partial unique index: only enforce when reservation_id is set AND
-- status is 'sent' (failed attempts can re-fire on retry).
-- Combined with INSERT...ON CONFLICT or try/catch unique_violation,
-- gives us atomic dedup without TOCTOU race.
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_notification_log_per_reservation_uniq
  ON public.restaurant_notification_log (restaurant_id, notification_type, reservation_id)
  WHERE status = 'sent' AND reservation_id IS NOT NULL;
