import { useCallback, useEffect, useState } from "react";

import { toUserFacingError } from "@/lib/errors";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { MyReservationRow } from "@/hooks/useMyReservations";

// Fetches a single reservation by id with the same joined shape as
// `useMyReservations` exposes. RLS already restricts visibility to rows the
// diner owns, so we don't apply an additional user filter here.
//
// Why this exists separate from useMyReservations: the list hook fetches +
// dedups + partitions hundreds of rows and is the right shape for the
// /bookings page. The detail page (`/bookings/:id`) only needs ONE row and
// needs it to stay viewable even right after a cancel, where the list
// hook's refresh might lag behind the actual DB state. Fetching directly by
// id sidesteps that race and means the detail page renders the cancelled
// + refunded state as soon as the row exists.

const selectFields =
  "id, created_at, updated_at, reserved_at, duration_minutes, party_size, status, confirmation_code, cancellation_reason, special_request, internal_notes, event_id, promotion_id, applied_promo_code, restaurant:restaurants(id, name, slug, cuisine_type, city, address, phone, logo_url, cover_photo_url, timezone), table:tables(label), event:events(id, name, date, start_time, end_time, theme, price_per_person), promotion:promotions(id, title, promo_code, badge_color, discount_value, discount_unit)";

type RawReservationRow = Omit<MyReservationRow, "restaurant" | "table" | "event" | "promotion"> & {
  restaurant: MyReservationRow["restaurant"] | NonNullable<MyReservationRow["restaurant"]>[];
  table: MyReservationRow["table"] | NonNullable<MyReservationRow["table"]>[];
  event: MyReservationRow["event"] | NonNullable<MyReservationRow["event"]>[];
  promotion: MyReservationRow["promotion"] | NonNullable<MyReservationRow["promotion"]>[];
};

function normalizeRow(row: RawReservationRow): MyReservationRow {
  return {
    ...row,
    restaurant: Array.isArray(row.restaurant) ? row.restaurant[0] ?? null : row.restaurant,
    table: Array.isArray(row.table) ? row.table[0] ?? null : row.table,
    event: Array.isArray(row.event) ? row.event[0] ?? null : row.event,
    promotion: Array.isArray(row.promotion) ? row.promotion[0] ?? null : row.promotion,
  };
}

export function useReservationById(reservationId: string | null) {
  const [reservation, setReservation] = useState<MyReservationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchOne = useCallback(async () => {
    if (!reservationId || !isSupabaseConfigured()) {
      setReservation(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();
    const { data, error: rErr } = await client
      .from("reservations")
      .select(selectFields)
      .eq("id", reservationId)
      .maybeSingle();
    if (rErr) {
      const friendly = toUserFacingError(rErr, "Couldn't load that reservation.");
      setError(new Error(friendly.message));
      console.error("[useReservationById.fetch]", friendly.code, friendly.technical ?? rErr);
      setReservation(null);
      setLoading(false);
      return;
    }
    setReservation(data ? normalizeRow(data as unknown as RawReservationRow) : null);
    setLoading(false);
  }, [reservationId]);

  useEffect(() => {
    void fetchOne();
  }, [fetchOne]);

  return { reservation, loading, error, refresh: fetchOne };
}
