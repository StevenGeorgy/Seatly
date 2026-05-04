import { supabaseAdmin } from "./supabase.ts";

export async function assignReservationTables(params: {
  reservation_id: string;
  restaurant_id: string;
  reserved_at: string;
  party_size: number;
  turn_minutes?: number;
}): Promise<{ tableIds: string[]; error: string | null }> {
  const { data, error } = await supabaseAdmin.rpc("assign_reservation_tables", {
    p_reservation_id: params.reservation_id,
    p_restaurant_id: params.restaurant_id,
    p_reserved_at: params.reserved_at,
    p_party_size: params.party_size,
    p_turn_minutes: params.turn_minutes ?? null,
  });

  if (error) return { tableIds: [], error: error.message };
  const tableIds = Array.isArray(data)
    ? data.filter((id): id is string => typeof id === "string")
    : [];
  return {
    tableIds,
    error: tableIds.length > 0 ? null : "No available table can fit this party at that time.",
  };
}

export async function releaseReservationTables(
  reservation_id: string,
): Promise<{ tableIds: string[]; error: string | null }> {
  const { data, error } = await supabaseAdmin.rpc("release_reservation_tables", {
    p_reservation_id: reservation_id,
  });

  if (error) return { tableIds: [], error: error.message };
  return {
    tableIds: Array.isArray(data)
      ? data.filter((id): id is string => typeof id === "string")
      : [],
    error: null,
  };
}
