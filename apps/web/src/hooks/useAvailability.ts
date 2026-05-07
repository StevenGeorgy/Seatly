import { useState, useEffect, useCallback } from "react";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

export type ConflictWindow = { start: Date; end: Date };

export interface AvailabilitySlot {
  shift_id: string;
  shift_name: string;
  date_time: string;
  display_time: string;
  table_ids?: string[];
  duration_minutes?: number;
  floor_capacity?: number;
}

export type AvailabilityUnavailableReason =
  | "closed"
  | "no_shifts"
  | "party_size_out_of_range"
  | "fully_booked"
  | "no_future_slots"
  | "no_slots";

export interface AvailabilityResult {
  slots: AvailabilitySlot[];
  floorCapacity: number | null;
  error: string | null;
  unavailableReason: AvailabilityUnavailableReason | null;
  message: string | null;
}

export type AvailabilityFetchOptions = {
  forceRefresh?: boolean;
};

const AVAILABILITY_CACHE_TTL_MS = 45_000;

type CachedAvailability = {
  expiresAt: number;
  result: AvailabilityResult;
};

const availabilityCache = new Map<string, CachedAvailability>();
const availabilityRequests = new Map<string, Promise<AvailabilityResult>>();

function availabilityCacheKey(restaurantId: string, date: string, partySize: number): string {
  return `${restaurantId}|${date}|${Math.max(1, Math.floor(partySize))}`;
}

function cloneAvailabilityResult(result: AvailabilityResult): AvailabilityResult {
  return {
    slots: result.slots
      .filter((slot) => new Date(slot.date_time).getTime() >= Date.now())
      .map((slot) => ({ ...slot, table_ids: slot.table_ids ? [...slot.table_ids] : undefined })),
    floorCapacity: result.floorCapacity,
    error: result.error,
    unavailableReason: result.unavailableReason,
    message: result.message,
  };
}

async function fetchAvailabilityFromNetwork(
  restaurantId: string,
  date: string,
  partySize: number,
): Promise<AvailabilityResult> {
  const url = `${getSupabaseProjectUrl()}/functions/v1/get-availability?restaurant_id=${restaurantId}&date=${date}&party_size=${partySize}`;

  let token: string | null = null;
  if (isSupabaseConfigured()) {
    const client = getSupabaseBrowserClient();
    const { data } = await client.auth.getSession();
    token = data.session?.access_token ?? null;
  }

  const res = await fetch(url, {
    headers: {
      apikey: getSupabaseAnonKey(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  const json = await res.json() as {
    slots?: AvailabilitySlot[];
    floor_capacity?: number;
    error?: string;
    unavailable_reason?: AvailabilityUnavailableReason | null;
    message?: string | null;
  };
  const nextFloorCapacity =
    typeof json.floor_capacity === "number"
      ? json.floor_capacity
      : json.slots?.find((slot) => typeof slot.floor_capacity === "number")?.floor_capacity ?? null;
  const unavailableReason = json.unavailable_reason ?? null;
  const message = typeof json.message === "string" ? json.message : null;

  if (json.error) {
    return { slots: [], floorCapacity: nextFloorCapacity, error: json.error, unavailableReason, message };
  }

  return { slots: json.slots ?? [], floorCapacity: nextFloorCapacity, error: null, unavailableReason, message };
}

export async function fetchAvailabilitySlots(
  restaurantId: string,
  date: string,
  partySize: number,
  options: AvailabilityFetchOptions = {},
): Promise<AvailabilityResult> {
  const key = availabilityCacheKey(restaurantId, date, partySize);
  const cached = availabilityCache.get(key);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cloneAvailabilityResult(cached.result);
  }

  const activeRequest = availabilityRequests.get(key);
  if (!options.forceRefresh && activeRequest) {
    return cloneAvailabilityResult(await activeRequest);
  }

  const request = fetchAvailabilityFromNetwork(restaurantId, date, Math.max(1, Math.floor(partySize)))
    .then((result) => {
      availabilityCache.set(key, {
        expiresAt: Date.now() + AVAILABILITY_CACHE_TTL_MS,
        result: cloneAvailabilityResult(result),
      });
      return result;
    })
    .finally(() => {
      availabilityRequests.delete(key);
    });

  availabilityRequests.set(key, request);
  return cloneAvailabilityResult(await request);
}

export function useAvailability() {
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [floorCapacity, setFloorCapacity] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<AvailabilityUnavailableReason | null>(null);
  const [unavailableMessage, setUnavailableMessage] = useState<string | null>(null);

  const fetchSlots = useCallback(
    async (
      restaurantId: string,
      date: string,
      partySize: number,
      options: AvailabilityFetchOptions = {},
    ): Promise<AvailabilityResult> => {
      setLoading(true);
      setError(null);
      setSlots([]);
      setUnavailableReason(null);
      setUnavailableMessage(null);

      try {
        const result = await fetchAvailabilitySlots(restaurantId, date, partySize, options);
        setFloorCapacity(result.floorCapacity);
        setUnavailableReason(result.unavailableReason);
        setUnavailableMessage(result.message);
        if (result.error) {
          setError(result.error);
          return result;
        }
        setSlots(result.slots);
        return result;
      } catch (err) {
        const message = String(err);
        setError(message);
        setFloorCapacity(null);
        return { slots: [], floorCapacity: null, error: message, unavailableReason: null, message: null };
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const clearSlots = useCallback(() => {
    setSlots([]);
    setFloorCapacity(null);
    setError(null);
    setUnavailableReason(null);
    setUnavailableMessage(null);
  }, []);

  return {
    slots,
    floorCapacity,
    loading,
    error,
    unavailableReason,
    unavailableMessage,
    fetchSlots,
    clearSlots,
  };
}

/**
 * Fetches a logged-in diner's existing reservations on the given local date so
 * the booking UI can hide conflicting time slots. Covers both the same
 * restaurant and any other restaurant — the diner shouldn't double-book
 * themselves anywhere. Returns conflict windows in UTC; safe to call even when
 * no diner is logged in (returns []).
 */
export async function fetchDinerConflictWindows(args: {
  userProfileId: string | null;
  currentRestaurantId: string | null;
  dayStartUtcIso: string;
  dayEndUtcIso: string;
  excludeReservationId?: string | null;
}): Promise<ConflictWindow[]> {
  if (!args.userProfileId || !args.currentRestaurantId) return [];
  if (!isSupabaseConfigured()) return [];
  const client = getSupabaseBrowserClient();
  let query = client
    .from("reservations")
    .select("id, reserved_at, duration_minutes")
    .eq("user_profile_id", args.userProfileId)
    .in("status", ["pending", "confirmed", "seated"])
    .gte("reserved_at", args.dayStartUtcIso)
    .lte("reserved_at", args.dayEndUtcIso);
  if (args.excludeReservationId) {
    query = query.neq("id", args.excludeReservationId);
  }
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((row) => {
    const start = new Date(row.reserved_at);
    const minutes = typeof row.duration_minutes === "number" && row.duration_minutes > 0
      ? row.duration_minutes
      : 90;
    return { start, end: new Date(start.getTime() + minutes * 60_000) };
  });
}

/**
 * Hides slots whose [start, start+duration] overlaps any conflict window.
 * No-ops when the conflict list is empty.
 */
export function filterSlotsByConflicts(
  slots: AvailabilitySlot[],
  conflicts: ConflictWindow[],
): AvailabilitySlot[] {
  if (!conflicts.length) return slots;
  return slots.filter((slot) => {
    const start = new Date(slot.date_time);
    const minutes = typeof slot.duration_minutes === "number" && slot.duration_minutes > 0
      ? slot.duration_minutes
      : 90;
    const end = new Date(start.getTime() + minutes * 60_000);
    return !conflicts.some((c) => start < c.end && c.start < end);
  });
}

/**
 * Convenience hook: fetches conflict windows for a logged-in diner whenever
 * the inputs change. Returns the windows; the caller filters slots themselves.
 *
 * Pass `excludeReservationId` when this hook drives an "edit existing
 * reservation" UI so the booking being modified doesn't block its own slot.
 */
export function useDinerConflictWindows(args: {
  userProfileId: string | null;
  currentRestaurantId: string | null;
  date: string | null; // YYYY-MM-DD in restaurant local time
  timezone: string | null;
  excludeReservationId?: string | null;
}): ConflictWindow[] {
  const [windows, setWindows] = useState<ConflictWindow[]>([]);
  const { userProfileId, currentRestaurantId, date, timezone, excludeReservationId } = args;

  useEffect(() => {
    let cancelled = false;
    if (!userProfileId || !currentRestaurantId || !date) {
      void Promise.resolve().then(() => {
        if (!cancelled) setWindows([]);
      });
      return;
    }
    // Build local 00:00 → 23:59 in the restaurant's tz, then convert via Date()
    // by computing the offset for that day.
    const dayStartLocal = new Date(`${date}T00:00:00`);
    const dayEndLocal = new Date(`${date}T23:59:59`);
    // Best-effort UTC bounds: pad +/- 1 day to cover any tz edge cases. The
    // server returns whatever falls in the actual restaurant-local day; we err
    // on the side of fetching slightly more.
    const dayStartUtcIso = new Date(dayStartLocal.getTime() - 24 * 60 * 60_000).toISOString();
    const dayEndUtcIso = new Date(dayEndLocal.getTime() + 24 * 60 * 60_000).toISOString();
    void fetchDinerConflictWindows({
      userProfileId,
      currentRestaurantId,
      dayStartUtcIso,
      dayEndUtcIso,
      excludeReservationId: excludeReservationId ?? null,
    }).then((result) => {
      if (!cancelled) setWindows(result);
    });
    return () => {
      cancelled = true;
    };
  }, [userProfileId, currentRestaurantId, date, timezone, excludeReservationId]);

  return windows;
}
