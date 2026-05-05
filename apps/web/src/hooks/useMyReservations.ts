import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useUser } from "@/hooks/useUser";

export type MyReservationRow = {
  id: string;
  created_at: string | null;
  reserved_at: string;
  party_size: number;
  status: string;
  confirmation_code: string | null;
  cancellation_reason: string | null;
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
  } | null;
  table: { label: string | null } | null;
};

export function useMyReservations() {
  const { profile } = useUser();
  const profileId = profile?.id;
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

    const { data: guestRows, error: gErr } = await client
      .from("guests")
      .select("id")
      .eq("user_profile_id", profileId);

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
        "id, created_at, reserved_at, party_size, status, confirmation_code, cancellation_reason, restaurant:restaurants(id, name, slug, cuisine_type, city, address, phone, logo_url, cover_photo_url), table:tables(label)",
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
    const now = new Date().toISOString();
    setUpcoming(dedupedRows.filter((r) => r.reserved_at >= now && r.status !== "cancelled"));
    setPast(dedupedRows.filter((r) => r.reserved_at < now || r.status === "cancelled"));
    setLoading(false);
  }, [profileId]);

  useEffect(() => {
    void Promise.resolve().then(fetch);
  }, [fetch]);

  return { upcoming, past, loading, error, refresh: fetch };
}
