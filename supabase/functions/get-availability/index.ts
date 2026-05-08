// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { jsonRes } from "../_shared/json-response.ts";
import { getAvailability } from "../_shared/availability.ts";
import { localBookingParts } from "../_shared/hours.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

type PublicAvailabilitySlot = {
  shift_id: string;
  shift_name: string;
  date_time: string;
  display_time: string;
  table_ids?: string[];
  duration_minutes?: number;
  floor_capacity?: number;
};

function numberParam(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getRestaurantTimezone(restaurantId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("restaurants")
    .select("timezone")
    .eq("id", restaurantId)
    .single();
  return data?.timezone || "UTC";
}

async function getFloorCapacity(restaurantId: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from("tables")
    .select("capacity")
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true);
  if (error || !data?.length) return null;
  return data.reduce((sum, row) => sum + (Number(row.capacity) || 0), 0);
}

// Resolve a table assignment for a slot. Uses the `find_available_table_group`
// RPC so large parties can combine multiple tables — a single-table lookup
// would falsely report "fully booked" any time the largest table is smaller
// than the requested party.
async function findAvailableTableGroup(params: {
  restaurantId: string;
  partySize: number;
  dateTime: string;
  durationMinutes: number;
}): Promise<string[]> {
  const { data, error } = await supabaseAdmin.rpc("find_available_table_group", {
    p_restaurant_id: params.restaurantId,
    p_reserved_at: params.dateTime,
    p_party_size: params.partySize,
    p_turn_minutes: params.durationMinutes,
  });
  if (error || !Array.isArray(data)) return [];
  return data.filter((id): id is string => typeof id === "string");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return jsonRes({ error: "Method not allowed" }, 405);
  }

  try {
    const url = new URL(req.url);
    const restaurantId = url.searchParams.get("restaurant_id")?.trim();
    const date = url.searchParams.get("date")?.trim();
    const partySize = Math.max(1, Math.floor(numberParam(url.searchParams.get("party_size"), 2)));

    if (!restaurantId || !date) {
      return jsonRes({ error: "restaurant_id and date required" }, 400);
    }

    // SPEED_PLAN Phase 4: when USE_SQL_AVAILABILITY=1, the entire slot list is
    // built by a single Postgres function call (`get_available_slots`). Old TS
    // path remains for one release as rollback insurance — unset the env to
    // revert.
    if (Deno.env.get("USE_SQL_AVAILABILITY") === "1") {
      const timezoneSql = await getRestaurantTimezone(restaurantId);
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc("get_available_slots_cached", {
        p_restaurant_id: restaurantId,
        p_date: date,
        p_party_size: partySize,
      });
      if (rpcError) throw rpcError;
      const result = (rpcData ?? {}) as {
        slots?: Array<{
          shift_id: string;
          shift_name: string;
          date_time: string;
          table_ids?: string[];
          duration_minutes?: number;
        }>;
        floor_capacity?: number | null;
        configured_hours_window?: string | null;
        unavailable_reason?: string | null;
        message?: string | null;
      };
      const sqlSlots: PublicAvailabilitySlot[] = (result.slots ?? []).map((slot) => ({
        shift_id: slot.shift_id,
        shift_name: slot.shift_name,
        date_time: slot.date_time,
        // Format display_time in TS using the same call as the legacy path so
        // V8's NARROW NO-BREAK SPACE between "7:00" and "PM" matches byte-for-
        // byte. Doing this in PG would emit a regular space and break parity.
        display_time: new Date(slot.date_time).toLocaleTimeString("en-US", {
          timeZone: timezoneSql,
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }),
        table_ids: slot.table_ids ?? [],
        duration_minutes: slot.duration_minutes,
        floor_capacity: result.floor_capacity ?? undefined,
      }));
      const hoursWindow = result.configured_hours_window
        ?? (sqlSlots.length
          ? `${sqlSlots[0].display_time} to ${sqlSlots[sqlSlots.length - 1].display_time}`
          : null);
      return jsonRes({
        slots: sqlSlots,
        floor_capacity: result.floor_capacity ?? null,
        hours_window: hoursWindow,
        unavailable_reason: result.unavailable_reason ?? null,
        message: result.message ?? null,
      });
    }

    const [availability, timezone, floorCapacity] = await Promise.all([
      getAvailability(restaurantId, date, partySize),
      getRestaurantTimezone(restaurantId),
      getFloorCapacity(restaurantId),
    ]);

    const shiftIds = Array.from(new Set((availability.slots ?? []).map((slot) => slot.shift_id)));
    const { data: shifts } = shiftIds.length
      ? await supabaseAdmin
        .from("shifts")
        .select("id,turn_time_minutes")
        .in("id", shiftIds)
      : { data: [] };
    const turnMinutesByShift = new Map(
      (shifts ?? []).map((shift) => [shift.id, Number(shift.turn_time_minutes) || 90]),
    );

    const slots: PublicAvailabilitySlot[] = [];
    let tableBlockedCount = 0;
    for (const slot of availability.slots ?? []) {
      const durationMinutes = turnMinutesByShift.get(slot.shift_id) ?? 90;
      const localParts = localBookingParts(slot.date_time, timezone);
      if (!localParts) continue;
      const tableIds = await findAvailableTableGroup({
        restaurantId,
        partySize,
        dateTime: slot.date_time,
        durationMinutes,
      });
      if (tableIds.length === 0) {
        tableBlockedCount += 1;
        continue;
      }
      slots.push({
        ...slot,
        table_ids: tableIds,
        duration_minutes: durationMinutes,
        floor_capacity: floorCapacity ?? undefined,
      });
    }

    const tableCapacityBlocked =
      slots.length === 0 &&
      (availability.slots ?? []).length > 0 &&
      tableBlockedCount >= (availability.slots ?? []).length;

    return jsonRes({
      slots,
      floor_capacity: floorCapacity,
      hours_window: availability.hours_window ?? null,
      unavailable_reason: tableCapacityBlocked ? "fully_booked" : availability.unavailable_reason ?? null,
      message: tableCapacityBlocked
        ? "The restaurant is fully booked for that date."
        : availability.message ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("get-availability error:", message);
    return jsonRes({ error: message || "availability_failed" }, 500);
  }
});
