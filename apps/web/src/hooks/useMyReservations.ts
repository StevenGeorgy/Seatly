import { useCallback, useEffect, useState } from "react";

import { toUserFacingError } from "@/lib/errors";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useUser } from "@/hooks/useUser";
import { reservationDisplayStatus } from "@/lib/reservations/displayStatus";

export type MyReservationEventRef = {
  id: string;
  name: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  theme: string | null;
  price_per_person: number | null;
};

export type MyReservationPromotionRef = {
  id: string;
  title: string | null;
  promo_code: string | null;
  badge_color: string | null;
  discount_value: number | null;
  discount_unit: string | null;
};

export type MyReservationRow = {
  id: string;
  created_at: string | null;
  updated_at: string | null;
  reserved_at: string;
  duration_minutes: number | null;
  party_size: number;
  status: string;
  confirmation_code: string | null;
  cancellation_reason: string | null;
  special_request: string | null;
  internal_notes: string | null;
  // Event + promotion linkage (added 2026-05-11). When the booking was made
  // for a specific event or used a promo code, these surface on the booking
  // card as chips so customers can see what they booked for.
  event_id: string | null;
  promotion_id: string | null;
  applied_promo_code: string | null;
  event: MyReservationEventRef | null;
  promotion: MyReservationPromotionRef | null;
  restaurant: {
    id: string;
    name: string;
    slug: string;
    cuisine_type: string | null;
    city: string | null;
    address: string | null;
    phone: string | null;
    logo_url: string | null;
    cover_photo_url: string | null;
    timezone: string | null;
  } | null;
  table: { label: string | null } | null;
};

export function useMyReservations() {
  const { profile } = useUser();
  const profileId = profile?.id;
  const profileEmail = profile?.email ?? null;
  const profilePhone = profile?.phone ?? null;
  const [upcoming, setUpcoming] = useState<MyReservationRow[]>([]);
  const [past, setPast] = useState<MyReservationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetch = useCallback(async () => {
    if (!profileId || !isSupabaseConfigured()) {
      setUpcoming([]);
      setPast([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    // Query reservations directly by `user_profile_id` (and fallback by
    // `guest_email` / `guest_phone` for legacy rows or future guest-only
    // bookings made before the user signed in). The previous approach —
    // looking up `guests.id WHERE user_profile_id=…` then
    // `.in("guest_id", guestIds)` — used to 414 URI-too-long when a user
    // had hundreds of `guests` rows (one per public booking submit). The
    // direct query avoids the IN-list explosion and surfaces every
    // reservation the diner has rights to see.
    const orFilters: string[] = [`user_profile_id.eq.${profileId}`];
    if (profileEmail) orFilters.push(`guest_email.eq.${profileEmail}`);
    if (profilePhone) orFilters.push(`guest_phone.eq.${profilePhone}`);

    // Split the fetch into two passes so a diner who has accumulated
    // hundreds of cancellations (from rapid public-page resubmits or
    // long-running test sessions) doesn't push their actual active
    // bookings past the row limit when ordered by date.
    //   Pass A: every non-cancelled reservation (no date filter).
    //   Pass B: cancelled rows within the last 90 days (display-only).
    const selectFields = "id, created_at, updated_at, reserved_at, duration_minutes, party_size, status, confirmation_code, cancellation_reason, special_request, internal_notes, event_id, promotion_id, applied_promo_code, restaurant:restaurants(id, name, slug, cuisine_type, city, address, phone, logo_url, cover_photo_url, timezone), table:tables(label), event:events(id, name, date, start_time, end_time, theme, price_per_person), promotion:promotions(id, title, promo_code, badge_color, discount_value, discount_unit)";
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const [activeRes, cancelledRes] = await Promise.all([
      client
        .from("reservations")
        .select(selectFields)
        .or(orFilters.join(","))
        .neq("status", "cancelled")
        .order("reserved_at", { ascending: false })
        .limit(500),
      client
        .from("reservations")
        .select(selectFields)
        .or(orFilters.join(","))
        .eq("status", "cancelled")
        .gte("reserved_at", ninetyDaysAgo)
        .order("reserved_at", { ascending: false })
        .limit(200),
    ]);

    const rErr = activeRes.error ?? cancelledRes.error;
    if (rErr) {
      const friendly = toUserFacingError(rErr, "Couldn't load your reservations.");
      setError(new Error(friendly.message));
      console.error("[useMyReservations.fetch]", friendly.code, friendly.technical ?? rErr);
      setLoading(false);
      return;
    }
    const data = [...(activeRes.data ?? []), ...(cancelledRes.data ?? [])];

    type RawReservationRow = Omit<MyReservationRow, "restaurant" | "table" | "event" | "promotion"> & {
      restaurant:
        | MyReservationRow["restaurant"]
        | NonNullable<MyReservationRow["restaurant"]>[];
      table:
        | MyReservationRow["table"]
        | NonNullable<MyReservationRow["table"]>[];
      event:
        | MyReservationRow["event"]
        | NonNullable<MyReservationRow["event"]>[];
      promotion:
        | MyReservationRow["promotion"]
        | NonNullable<MyReservationRow["promotion"]>[];
    };
    const rows = (data ?? []).map((row) => {
      const raw = row as unknown as RawReservationRow;
      return {
        ...raw,
        restaurant: Array.isArray(raw.restaurant)
          ? raw.restaurant[0] ?? null
          : raw.restaurant,
        table: Array.isArray(raw.table)
          ? raw.table[0] ?? null
          : raw.table,
        event: Array.isArray(raw.event)
          ? raw.event[0] ?? null
          : raw.event,
        promotion: Array.isArray(raw.promotion)
          ? raw.promotion[0] ?? null
          : raw.promotion,
      };
    });
    const visibleRows = rows.filter(
      (row) => !row.cancellation_reason?.startsWith("Duplicate public booking submit"),
    );
    const dedupedRows = Array.from(
      visibleRows.reduce<Map<string, MyReservationRow>>((acc, row) => {
        const key = [
          row.restaurant?.id ?? "restaurant",
          row.reserved_at,
          row.party_size,
          row.status,
        ].join("|");
        const existing = acc.get(key);
        if (!existing || (row.created_at ?? row.reserved_at) < (existing.created_at ?? existing.reserved_at)) {
          acc.set(key, row);
        }
        return acc;
      }, new Map()).values(),
    );
    const now = new Date();
    setUpcoming(dedupedRows.filter((r) => {
      const status = reservationDisplayStatus(r, now);
      return status === "upcoming" || status === "current";
    }));
    setPast(dedupedRows.filter((r) => {
      const status = reservationDisplayStatus(r, now);
      return status === "past" || status === "cancelled";
    }));
    setLoading(false);
  }, [profileId, profileEmail, profilePhone]);

  useEffect(() => {
    void Promise.resolve().then(fetch);
  }, [fetch]);

  return { upcoming, past, loading, error, refresh: fetch };
}
