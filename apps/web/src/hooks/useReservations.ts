import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { MOCK_RESERVATIONS } from "@/lib/mock-data";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type ReservationRow = {
  id: string;
  restaurant_id: string;
  guest_id: string | null;
  table_id: string | null;
  shift_id: string | null;
  party_size: number;
  reserved_at: string;
  status: string;
  source: string | null;
  confirmation_code: string | null;
  special_request: string | null;
  occasion: string | null;
  dietary_notes: string | null;
  internal_notes: string | null;
  no_show_risk_score: number | null;
  waiter_id: string | null;
  deposit_amount: number | null;
  deposit_status: string | null;
  is_guest_checkout: boolean;
  guest_email: string | null;
  guest_phone: string | null;
  guest_full_name: string | null;
  confirmed_at: string | null;
  checked_in_at: string | null;
  seated_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string | null;
  guests?: { full_name: string | null; email: string | null; phone: string | null } | null;
};

export type ReservationFilters = {
  status?: string;
  date?: string;
  search?: string;
};

export function useReservations(filters?: ReservationFilters) {
  const { selectedRestaurantId } = useRestaurantScope();
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchReservations = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setReservations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    let query = client
      .from("reservations")
      .select("*, guests(full_name, email, phone)")
      .eq("restaurant_id", selectedRestaurantId)
      .order("reserved_at", { ascending: true });

    if (filters?.status && filters.status !== "all") {
      query = query.eq("status", filters.status);
    }

    if (filters?.date) {
      const dayStart = `${filters.date}T00:00:00`;
      const dayEnd = `${filters.date}T23:59:59`;
      query = query.gte("reserved_at", dayStart).lte("reserved_at", dayEnd);
    }

    const { data, error: qErr } = await query;

    if (qErr) {
      setError(new Error(qErr.message));
      setReservations([]);
    } else {
      let rows = (data ?? []) as ReservationRow[];
      if (filters?.search) {
        const s = filters.search.toLowerCase();
        rows = rows.filter(
          (r) =>
            r.guests?.full_name?.toLowerCase().includes(s) ||
            r.guest_full_name?.toLowerCase().includes(s) ||
            r.confirmation_code?.toLowerCase().includes(s),
        );
      }
      setReservations(rows.length > 0 ? rows : MOCK_RESERVATIONS);
    }
    setLoading(false);
  }, [selectedRestaurantId, filters?.status, filters?.date, filters?.search]);

  useEffect(() => {
    void fetchReservations();
  }, [fetchReservations]);

  useEffect(() => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) return;

    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`reservations:${selectedRestaurantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservations",
          filter: `restaurant_id=eq.${selectedRestaurantId}`,
        },
        () => { void fetchReservations(); },
      )
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [selectedRestaurantId, fetchReservations]);

  return { reservations, loading, error, refetch: fetchReservations };
}
