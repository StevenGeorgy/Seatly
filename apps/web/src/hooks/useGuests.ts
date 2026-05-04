import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { MOCK_GUESTS } from "@/lib/mock-data";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type SupabaseBrowserClient = ReturnType<typeof getSupabaseBrowserClient>;

export type GuestRow = {
  id: string;
  restaurant_id: string;
  user_profile_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  anniversary: string | null;
  tags: string[] | null;
  dietary_restrictions: string[] | null;
  allergies: string[] | null;
  seating_preference: string | null;
  noise_preference?: string | null;
  favourite_dishes: string[] | null;
  favourite_drinks?: string[] | null;
  internal_notes: string | null;
  total_visits: number;
  total_spend: number;
  average_spend_per_visit: number | null;
  no_show_count: number;
  cancellation_count: number;
  is_vip: boolean;
  is_blocked: boolean;
  loyalty_points_balance: number;
  loyalty_tier: string | null;
  email_opt_in?: boolean | null;
  sms_opt_in?: boolean | null;
  acquisition_source?: string | null;
  last_contacted_at?: string | null;
  last_visit_at: string | null;
  first_visit_at: string | null;
  created_at: string | null;
};

export type GuestFilters = {
  search?: string;
  isVip?: boolean;
  tag?: string;
};

type ReservationHistoryRow = {
  guest_id: string | null;
  reserved_at: string | null;
};

function newerDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function olderDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

async function enrichGuestsWithReservationHistory(
  client: SupabaseBrowserClient,
  restaurantId: string,
  guests: GuestRow[],
): Promise<GuestRow[]> {
  const guestIds = guests.map((guest) => guest.id).filter(Boolean);
  if (guestIds.length === 0) return guests;

  const { data, error } = await client
    .from("reservations")
    .select("guest_id, reserved_at")
    .eq("restaurant_id", restaurantId)
    .in("guest_id", guestIds)
    .in("status", ["confirmed", "seated", "completed"])
    .lte("reserved_at", new Date().toISOString());

  if (error) return guests;

  const history = new Map<string, { visits: number; firstVisit: string | null; lastVisit: string | null }>();
  for (const reservation of (data ?? []) as ReservationHistoryRow[]) {
    if (!reservation.guest_id || !reservation.reserved_at) continue;
    const existing = history.get(reservation.guest_id) ?? { visits: 0, firstVisit: null, lastVisit: null };
    history.set(reservation.guest_id, {
      visits: existing.visits + 1,
      firstVisit: olderDate(existing.firstVisit, reservation.reserved_at),
      lastVisit: newerDate(existing.lastVisit, reservation.reserved_at),
    });
  }

  return guests.map((guest) => {
    const reservationHistory = history.get(guest.id);
    if (!reservationHistory) return guest;

    const totalVisits = Math.max(guest.total_visits ?? 0, reservationHistory.visits);
    const totalSpend = Number(guest.total_spend ?? 0);

    return {
      ...guest,
      total_visits: totalVisits,
      first_visit_at: olderDate(guest.first_visit_at, reservationHistory.firstVisit),
      last_visit_at: newerDate(guest.last_visit_at, reservationHistory.lastVisit),
      average_spend_per_visit:
        guest.average_spend_per_visit ?? (totalVisits > 0 && totalSpend > 0 ? totalSpend / totalVisits : null),
    };
  });
}

export function useGuests(filters?: GuestFilters) {
  const { selectedRestaurantId } = useRestaurantScope();
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchGuests = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setGuests([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    let query = client
      .from("guests")
      .select("*")
      .eq("restaurant_id", selectedRestaurantId)
      .order("total_visits", { ascending: false })
      .limit(200);

    if (filters?.isVip) query = query.eq("is_vip", true);
    if (filters?.tag) query = query.contains("tags", [filters.tag]);

    const { data, error: qErr } = await query;

    if (qErr) {
      setError(new Error(qErr.message));
      setGuests([]);
    } else {
      let rows = await enrichGuestsWithReservationHistory(
        client,
        selectedRestaurantId,
        (data ?? []) as GuestRow[],
      );
      if (filters?.search) {
        const s = filters.search.toLowerCase();
        rows = rows.filter(
          (g) =>
            g.full_name?.toLowerCase().includes(s) ||
            g.email?.toLowerCase().includes(s) ||
            g.phone?.includes(s) ||
            g.tags?.some((tag) => tag.toLowerCase().includes(s)) ||
            g.allergies?.some((allergy) => allergy.toLowerCase().includes(s)) ||
            g.dietary_restrictions?.some((restriction) => restriction.toLowerCase().includes(s)),
        );
      }
      setGuests(rows.length > 0 ? rows : MOCK_GUESTS);
    }
    setLoading(false);
  }, [selectedRestaurantId, filters?.search, filters?.isVip, filters?.tag]);

  useEffect(() => { void fetchGuests(); }, [fetchGuests]);

  return { guests, loading, error, refetch: fetchGuests };
}
