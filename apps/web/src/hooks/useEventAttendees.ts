import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { toUserFacingError } from "@/lib/errors";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type EventTimelineRow = {
  id: string;
  name: string;
  description: string | null;
  date: string;
  start_time: string | null;
  end_time: string | null;
  capacity: number | null;
  tickets_sold: number;
  price_per_person: number | null;
  is_active: boolean;
  theme: string | null;
  cover_image_url: string | null;
};

export type EventAttendeeRow = {
  id: string;
  reservation_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  party_size: number;
  reserved_at: string;
  table_label: string;
  special_request: string | null;
  occasion: string | null;
  status: string;
};

/**
 * Fetches active events scheduled for a single local date (the restaurant's
 * "tonight") for the currently selected restaurant. Used by the OverviewPage
 * timeline to render purple event bars alongside reservations.
 *
 * Events whose date range spans `targetDate` (start ≤ targetDate ≤ end) are
 * included so a multi-day festival still shows up on each evening it runs.
 */
export function useTonightEvents(targetDate: string) {
  const { selectedRestaurantId } = useRestaurantScope();
  const [events, setEvents] = useState<EventTimelineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchEvents = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();
    const { data, error: qErr } = await client
      .from("events")
      .select(
        "id, name, description, date, end_date, start_time, end_time, capacity, tickets_sold, price_per_person, is_active, theme, cover_image_url",
      )
      .eq("restaurant_id", selectedRestaurantId)
      .eq("is_active", true)
      .lte("date", targetDate)
      .or(`end_date.gte.${targetDate},and(end_date.is.null,date.eq.${targetDate})`)
      .order("start_time", { ascending: true, nullsFirst: false });

    if (qErr) {
      const friendly = toUserFacingError(qErr, "Couldn't load tonight's events.");
      setError(new Error(friendly.message));
      console.error("[useEventAttendees.tonight]", friendly.code, friendly.technical ?? qErr);
      setEvents([]);
    } else {
      setEvents((data ?? []) as EventTimelineRow[]);
    }
    setLoading(false);
  }, [selectedRestaurantId, targetDate]);

  useEffect(() => {
    void Promise.resolve().then(fetchEvents);
  }, [fetchEvents]);

  return { events, loading, error, refetch: fetchEvents };
}

type RawAttendeeRow = {
  id: string;
  party_size: number;
  reserved_at: string;
  status: string;
  guest_full_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  special_request: string | null;
  occasion: string | null;
  guests?: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  reservation_tables?: Array<{
    is_primary: boolean;
    released_at: string | null;
    tables: {
      label: string | null;
      table_number: string | null;
      section: string | null;
    } | null;
  }> | null;
  tables?: {
    label: string | null;
    table_number: string | null;
    section: string | null;
  } | null;
};

function tableLabelFromRow(row: RawAttendeeRow): string {
  const assignments = (row.reservation_tables ?? []).filter(
    (assignment) => assignment.tables && assignment.released_at === null,
  );
  if (assignments.length > 0) {
    const sorted = [...assignments].sort(
      (a, b) => Number(b.is_primary) - Number(a.is_primary),
    );
    const labels = sorted.map(
      (assignment) =>
        assignment.tables?.label || assignment.tables?.table_number || "Table",
    );
    return labels.join(" + ");
  }
  if (row.tables) {
    return row.tables.label || row.tables.table_number || "Table";
  }
  return "Unassigned";
}

/**
 * Fetches every active reservation tied to a specific event_id, including
 * the joined guest record (for full_name/phone/email when the diner
 * booked through their account) and table assignments.
 */
export function useEventAttendees(eventId: string | null) {
  const [attendees, setAttendees] = useState<EventAttendeeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchAttendees = useCallback(async () => {
    if (!eventId || !isSupabaseConfigured()) {
      setAttendees([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();
    const { data, error: qErr } = await client
      .from("reservations")
      .select(
        "id, party_size, reserved_at, status, guest_full_name, guest_email, guest_phone, special_request, occasion, guests(full_name, email, phone), tables(label, table_number, section), reservation_tables(is_primary, released_at, tables(label, table_number, section))",
      )
      .eq("event_id", eventId)
      .neq("status", "cancelled")
      .neq("status", "no_show")
      .order("reserved_at", { ascending: true });

    if (qErr) {
      const friendly = toUserFacingError(qErr, "Couldn't load event attendees.");
      setError(new Error(friendly.message));
      console.error("[useEventAttendees.attendees]", friendly.code, friendly.technical ?? qErr);
      setAttendees([]);
    } else {
      const rows = (data ?? []) as unknown as RawAttendeeRow[];
      setAttendees(
        rows.map((row) => ({
          id: row.id,
          reservation_id: row.id,
          full_name:
            row.guests?.full_name ?? row.guest_full_name ?? "Walk-in guest",
          email: row.guest_email ?? row.guests?.email ?? null,
          phone: row.guest_phone ?? row.guests?.phone ?? null,
          party_size: row.party_size,
          reserved_at: row.reserved_at,
          table_label: tableLabelFromRow(row),
          special_request: row.special_request,
          occasion: row.occasion,
          status: row.status,
        })),
      );
    }
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    void Promise.resolve().then(fetchAttendees);
  }, [fetchAttendees]);

  return { attendees, loading, error, refetch: fetchAttendees };
}

/**
 * Fetches every active reservation that redeemed a specific promotion_id.
 * Mirrors the attendee shape so the same UI can render either group.
 */
export function usePromotionRedemptions(promotionId: string | null) {
  const [redemptions, setRedemptions] = useState<EventAttendeeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchRedemptions = useCallback(async () => {
    if (!promotionId || !isSupabaseConfigured()) {
      setRedemptions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();
    const { data, error: qErr } = await client
      .from("reservations")
      .select(
        "id, party_size, reserved_at, status, guest_full_name, guest_email, guest_phone, special_request, occasion, guests(full_name, email, phone), tables(label, table_number, section), reservation_tables(is_primary, released_at, tables(label, table_number, section))",
      )
      .eq("promotion_id", promotionId)
      .neq("status", "cancelled")
      .neq("status", "no_show")
      .order("reserved_at", { ascending: true });

    if (qErr) {
      const friendly = toUserFacingError(qErr, "Couldn't load promo redemptions.");
      setError(new Error(friendly.message));
      console.error("[useEventAttendees.redemptions]", friendly.code, friendly.technical ?? qErr);
      setRedemptions([]);
    } else {
      const rows = (data ?? []) as unknown as RawAttendeeRow[];
      setRedemptions(
        rows.map((row) => ({
          id: row.id,
          reservation_id: row.id,
          full_name:
            row.guests?.full_name ?? row.guest_full_name ?? "Walk-in guest",
          email: row.guest_email ?? row.guests?.email ?? null,
          phone: row.guest_phone ?? row.guests?.phone ?? null,
          party_size: row.party_size,
          reserved_at: row.reserved_at,
          table_label: tableLabelFromRow(row),
          special_request: row.special_request,
          occasion: row.occasion,
          status: row.status,
        })),
      );
    }
    setLoading(false);
  }, [promotionId]);

  useEffect(() => {
    void Promise.resolve().then(fetchRedemptions);
  }, [fetchRedemptions]);

  return { redemptions, loading, error, refetch: fetchRedemptions };
}
