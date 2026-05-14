-- Latent-bug fix discovered during Notify Me planning: `events.tickets_sold`
-- is read by the web UI to drive the "Sold out" badge on event cards, but
-- no code path in the repo (migrations, edge functions, RPCs) updates it.
-- The counter has only ever moved via seed data. Without this trigger,
-- event-side Notify Me alerts would never fire on cancellation because the
-- sold-out status would be frozen.
--
-- Trigger keeps `events.tickets_sold` in sync with `reservations.party_size`
-- summed across non-cancelled, non-no-show event-linked reservations. Runs
-- AFTER INSERT (new event booking) and AFTER UPDATE OF status (cancel /
-- reactivate / mark no-show).

CREATE OR REPLACE FUNCTION public.adjust_event_tickets_sold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- INSERT of a new event-linked reservation that counts toward capacity.
  IF TG_OP = 'INSERT' THEN
    IF NEW.event_id IS NOT NULL
       AND NEW.status NOT IN ('cancelled', 'no_show') THEN
      UPDATE public.events
         SET tickets_sold = COALESCE(tickets_sold, 0) + NEW.party_size
       WHERE id = NEW.event_id;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE that flips status into or out of a non-counting state. We don't
  -- look at every status change — only the boundary between "counts" and
  -- "doesn't count". Also handles event_id changes defensively (rare in
  -- practice but possible if staff edits a reservation).
  IF TG_OP = 'UPDATE' THEN
    -- Old reservation was counted but new state isn't → decrement.
    IF OLD.event_id IS NOT NULL
       AND OLD.status NOT IN ('cancelled', 'no_show')
       AND (
         NEW.status IN ('cancelled', 'no_show')
         OR NEW.event_id IS NULL
         OR NEW.event_id <> OLD.event_id
       ) THEN
      UPDATE public.events
         SET tickets_sold = GREATEST(0, COALESCE(tickets_sold, 0) - OLD.party_size)
       WHERE id = OLD.event_id;
    END IF;

    -- New state is counted but old wasn't → increment (un-cancellation, or
    -- staff just linked an event to a previously unrelated reservation).
    IF NEW.event_id IS NOT NULL
       AND NEW.status NOT IN ('cancelled', 'no_show')
       AND (
         OLD.status IN ('cancelled', 'no_show')
         OR OLD.event_id IS NULL
         OR OLD.event_id <> NEW.event_id
       ) THEN
      UPDATE public.events
         SET tickets_sold = COALESCE(tickets_sold, 0) + NEW.party_size
       WHERE id = NEW.event_id;
    END IF;

    -- Party-size change within the same counted event (e.g. add a guest).
    IF NEW.event_id IS NOT NULL
       AND OLD.event_id = NEW.event_id
       AND NEW.status NOT IN ('cancelled', 'no_show')
       AND OLD.status NOT IN ('cancelled', 'no_show')
       AND OLD.party_size <> NEW.party_size THEN
      UPDATE public.events
         SET tickets_sold = GREATEST(0, COALESCE(tickets_sold, 0) + (NEW.party_size - OLD.party_size))
       WHERE id = NEW.event_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservations_event_tickets_sold ON public.reservations;
CREATE TRIGGER reservations_event_tickets_sold
  AFTER INSERT OR UPDATE OF status, party_size, event_id ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.adjust_event_tickets_sold();

-- One-time reconciliation: recompute tickets_sold from current reservations
-- so seed/manual drift gets corrected. Future inserts/updates stay in sync
-- via the trigger above.
WITH live_counts AS (
  SELECT event_id, SUM(party_size)::int AS sold
  FROM public.reservations
  WHERE event_id IS NOT NULL
    AND status NOT IN ('cancelled', 'no_show')
  GROUP BY event_id
)
UPDATE public.events e
   SET tickets_sold = COALESCE(lc.sold, 0)
  FROM (
    SELECT id FROM public.events
  ) ids
  LEFT JOIN live_counts lc ON lc.event_id = ids.id
 WHERE e.id = ids.id;

COMMENT ON FUNCTION public.adjust_event_tickets_sold IS
  'Keeps events.tickets_sold in sync with live event-linked reservations. Required for the Sold Out badge and Notify Me event-side alerts to be correct.';
