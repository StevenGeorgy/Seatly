import { fetchAvailabilitySlots, type AvailabilitySlot } from "@/hooks/useAvailability";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatCompactTimeLabel } from "@/lib/utils/time";

export type DisplayAvailabilityOptions = {
  forceRefresh?: boolean;
  maxSlots?: number;
};

const DEFAULT_PARTY_SIZE = 2;

export function normalizePartySize(value: string | number | null | undefined, fallback = DEFAULT_PARTY_SIZE): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }

  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "large group") return 25;

  const parsed = Number.parseInt(normalized, 10);
  if (Number.isFinite(parsed)) return Math.max(1, parsed);

  return fallback;
}

function timeLabelToMinutes(value: string): number | null {
  const compact = formatCompactTimeLabel(value)
    .replace(/\s+/g, "")
    .toLowerCase();
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(compact);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  const period = match[3];
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (period === "pm" && hours !== 12) hours += 12;
  if (period === "am" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

export function filterSlotsAtOrAfterTime(slots: AvailabilitySlot[], selectedTime: string): AvailabilitySlot[] {
  const selectedMinutes = timeLabelToMinutes(selectedTime);
  if (selectedMinutes == null) return slots;

  return slots.filter((slot) => {
    const slotMinutes = timeLabelToMinutes(slot.display_time);
    return slotMinutes == null || slotMinutes >= selectedMinutes;
  });
}

type BatchedAvailabilityPayload = {
  slots?: Array<{
    shift_id: string;
    shift_name: string;
    date_time: string;
    table_ids?: string[] | null;
    duration_minutes?: number;
  }>;
  floor_capacity?: number | null;
  timezone?: string | null;
};

function payloadToSlots(payload: BatchedAvailabilityPayload | null | undefined): AvailabilitySlot[] {
  if (!payload || !Array.isArray(payload.slots)) return [];
  const timezone = payload.timezone || "UTC";
  const floorCapacity = typeof payload.floor_capacity === "number" ? payload.floor_capacity : null;
  return payload.slots.map((slot) => ({
    shift_id: slot.shift_id,
    shift_name: slot.shift_name,
    date_time: slot.date_time,
    display_time: new Date(slot.date_time).toLocaleTimeString("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }),
    table_ids: slot.table_ids ?? [],
    duration_minutes: slot.duration_minutes,
    floor_capacity: floorCapacity ?? undefined,
  }));
}

function trimToDisplaySlots(
  slots: AvailabilitySlot[],
  selectedTime: string,
  date: string,
  maxSlots: number,
): AvailabilitySlot[] {
  const seen = new Set<string>();
  const matching: AvailabilitySlot[] = [];
  for (const slot of filterSlotsAtOrAfterTime(slots, selectedTime)) {
    if (new Date(slot.date_time).getTime() < Date.now()) continue;
    const key = `${slot.date_time}-${slot.display_time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matching.push({ ...slot, booking_date: date });
    if (matching.length === maxSlots) break;
  }
  return matching;
}

/**
 * Fetches availability for many restaurants in a single RPC. Replaces the
 * per-restaurant `Promise.all` fanout on Discover/Deals — 20 cards now go from
 * 20 round trips to 1. Each per-restaurant lookup still flows through the
 * server-side cache (`get_available_slots_cached`), so simultaneous viewers
 * also benefit from the 7-second result cache.
 */
export async function fetchDisplayAvailabilitySlotsForRestaurants(
  restaurantIds: string[],
  date: string,
  partySize: number,
  selectedTime: string,
  options: DisplayAvailabilityOptions = {},
): Promise<Record<string, AvailabilitySlot[]>> {
  const maxSlots = options.maxSlots ?? 6;
  if (restaurantIds.length === 0) return {};

  const client = getSupabaseBrowserClient();
  // Compact variant: returns the first 6 future slots per restaurant and
  // strips `table_ids` from each slot. The booking page re-fetches with full
  // slot data, so the listing doesn't need them.
  const { data, error } = await client.rpc("get_available_slots_for_restaurants_compact", {
    p_restaurant_ids: restaurantIds,
    p_date: date,
    p_party_size: Math.max(1, Math.floor(partySize)),
  });

  if (error || !data || typeof data !== "object") {
    return Object.fromEntries(restaurantIds.map((id) => [id, [] as AvailabilitySlot[]]));
  }

  const map = data as Record<string, BatchedAvailabilityPayload>;
  const result: Record<string, AvailabilitySlot[]> = {};
  for (const id of restaurantIds) {
    const slots = payloadToSlots(map[id]);
    result[id] = trimToDisplaySlots(slots, selectedTime, date, maxSlots);
  }
  return result;
}

export async function fetchDisplayAvailabilitySlots(
  restaurantId: string,
  date: string,
  partySize: number,
  selectedTime: string,
  options: DisplayAvailabilityOptions = {},
): Promise<AvailabilitySlot[]> {
  const maxSlots = options.maxSlots ?? 6;
  const result = await fetchAvailabilitySlots(
    restaurantId,
    date,
    partySize,
    { forceRefresh: options.forceRefresh },
  ).catch(() => ({ slots: [] as AvailabilitySlot[] }));

  const seen = new Set<string>();
  const matchingSlots: AvailabilitySlot[] = [];
  for (const slot of filterSlotsAtOrAfterTime(result.slots ?? [], selectedTime)) {
    if (new Date(slot.date_time).getTime() < Date.now()) continue;
    const key = `${slot.date_time}-${slot.display_time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matchingSlots.push({ ...slot, booking_date: date });
    if (matchingSlots.length === maxSlots) break;
  }

  return matchingSlots;
}
