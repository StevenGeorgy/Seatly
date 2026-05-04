import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type TableAssignmentResult = {
  tableIds: string[];
  error: string | null;
};

type AssignmentParams = {
  reservationId: string;
  restaurantId: string;
  reservedAt: string;
  partySize: number;
  turnMinutes?: number;
};

export async function assignReservationTables({
  reservationId,
  restaurantId,
  reservedAt,
  partySize,
  turnMinutes,
}: AssignmentParams): Promise<TableAssignmentResult> {
  if (!isSupabaseConfigured()) {
    return { tableIds: [], error: "Supabase is not configured." };
  }

  const client = getSupabaseBrowserClient();
  const { data, error } = await client.rpc("assign_reservation_tables", {
    p_reservation_id: reservationId,
    p_restaurant_id: restaurantId,
    p_reserved_at: reservedAt,
    p_party_size: partySize,
    p_turn_minutes: turnMinutes ?? null,
  });

  if (error) return { tableIds: [], error: error.message };
  const tableIds = Array.isArray(data) ? data.filter((id): id is string => typeof id === "string") : [];
  return {
    tableIds,
    error: tableIds.length > 0 ? null : "No available table can fit this party at that time.",
  };
}

export async function releaseReservationTables(reservationId: string): Promise<TableAssignmentResult> {
  if (!isSupabaseConfigured()) {
    return { tableIds: [], error: "Supabase is not configured." };
  }

  const client = getSupabaseBrowserClient();
  const { data, error } = await client.rpc("release_reservation_tables", {
    p_reservation_id: reservationId,
  });

  if (error) return { tableIds: [], error: error.message };
  return {
    tableIds: Array.isArray(data) ? data.filter((id): id is string => typeof id === "string") : [],
    error: null,
  };
}

export async function markReservationTablesSeated(
  reservationId: string,
  partySize: number,
): Promise<TableAssignmentResult> {
  if (!isSupabaseConfigured()) {
    return { tableIds: [], error: "Supabase is not configured." };
  }

  const client = getSupabaseBrowserClient();
  const { data, error } = await client.rpc("mark_reservation_tables_seated", {
    p_reservation_id: reservationId,
    p_party_size: partySize,
  });

  if (error) return { tableIds: [], error: error.message };
  return {
    tableIds: Array.isArray(data) ? data.filter((id): id is string => typeof id === "string") : [],
    error: null,
  };
}
