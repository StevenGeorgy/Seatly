import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useUser } from "@/hooks/useUser";

export type MyReservationRow = {
  id: string;
  reserved_at: string;
  party_size: number;
  status: string;
  confirmation_code: string | null;
  restaurant: { id: string; name: string; slug: string; hero_image_url: string | null } | null;
  table: { label: string | null } | null;
};

export function useMyReservations() {
  const { profile } = useUser();
  const [upcoming, setUpcoming] = useState<MyReservationRow[]>([]);
  const [past, setPast] = useState<MyReservationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetch = useCallback(async () => {
    if (!profile?.id || !isSupabaseConfigured()) {
      setUpcoming([]);
      setPast([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    const { data: guestRows, error: gErr } = await client
      .from("guests")
      .select("id")
      .eq("user_profile_id", profile.id);

    if (gErr) {
      setError(new Error(gErr.message));
      setLoading(false);
      return;
    }

    const guestIds = (guestRows ?? []).map((g) => g.id);
    if (guestIds.length === 0) {
      setUpcoming([]);
      setPast([]);
      setLoading(false);
      return;
    }

    const { data, error: rErr } = await client
      .from("reservations")
      .select(
        "id, reserved_at, party_size, status, confirmation_code, restaurant:restaurants(id, name, slug, hero_image_url), table:tables(label)",
      )
      .in("guest_id", guestIds)
      .order("reserved_at", { ascending: false });

    if (rErr) {
      setError(new Error(rErr.message));
      setLoading(false);
      return;
    }

    type RawReservationRow = Omit<MyReservationRow, "restaurant" | "table"> & {
      restaurant:
        | MyReservationRow["restaurant"]
        | NonNullable<MyReservationRow["restaurant"]>[];
      table:
        | MyReservationRow["table"]
        | NonNullable<MyReservationRow["table"]>[];
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
      };
    });
    const now = new Date().toISOString();
    setUpcoming(rows.filter((r) => r.reserved_at >= now && r.status !== "cancelled"));
    setPast(rows.filter((r) => r.reserved_at < now || r.status === "cancelled"));
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  return { upcoming, past, loading, error, refresh: fetch };
}
