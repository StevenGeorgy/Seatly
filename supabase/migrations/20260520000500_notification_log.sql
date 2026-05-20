-- Phase 3.7 — Owner email notification idempotency + audit log.

CREATE TABLE IF NOT EXISTS public.restaurant_notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  notification_type text NOT NULL
    CHECK (notification_type IN (
      'restaurant_live',
      'restaurant_deletion_scheduled',
      'restaurant_restored',
      'payment_failed',
      'payment_recovered',
      'trial_ending_soon'
    )),
  sent_to_email text NOT NULL,
  payload jsonb,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed')),
  failure_reason text,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS restaurant_notification_log_lookup_idx
  ON public.restaurant_notification_log (restaurant_id, notification_type, sent_at DESC);

ALTER TABLE public.restaurant_notification_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_log_owner_select ON public.restaurant_notification_log;
CREATE POLICY notif_log_owner_select ON public.restaurant_notification_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurant_roles urr
      JOIN public.user_profiles up ON up.id = urr.user_id
      WHERE up.auth_user_id = auth.uid()
        AND urr.role = 'owner'
        AND urr.restaurant_id = restaurant_notification_log.restaurant_id
    )
  );
