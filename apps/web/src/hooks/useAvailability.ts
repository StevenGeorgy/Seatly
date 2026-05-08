import { useState, useEffect, useCallback } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type ConflictWindow = {
  start: Date;
  end: Date;
  reservationId?: string;
  restaurantId?: string;
  restaurantName?: string | null;
  isSameRestaurant?: boolean;
};

export interface AvailabilitySlot {
  shift_id: string;
  shift_name: string;
  date_time: string;
  display_time: string;
  table_ids?: string[];
  duration_minutes?: number;
  floor_capacity?: number;
  booking_date?: string;
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

// Customer surfaces re-render this on every date / time / party-size change,
// so we want short enough that two viewers a few seconds apart don't get a
// stale "available" view of a slot that just got booked. 10s is short enough
// to feel live, long enough to coalesce the usual burst of clicks.
const AVAILABILITY_CACHE_TTL_MS = 10_000;

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
      .map((slot) => ({
        ...slot,
        table_ids: slot.table_ids ? [...slot.table_ids] : undefined,
      })),
    floorCapacity: result.floorCapacity,
    error: result.error,
    unavailableReason: result.unavailableReason,
    message: result.message,
  };
}

// Calls `get_available_slots_cached` directly via PostgREST. The cached
// wrapper checks an UNLOGGED cache table for results computed within the last
// 7 seconds; on miss it computes fresh and upserts. Drops the same restaurant/
// date/party request from many concurrent users into one DB compute, which is
// the primary lever for raising the concurrent-availability ceiling.
async function fetchAvailabilityFromNetwork(
  restaurantId: string,
  date: string,
  partySize: number,
): Promise<AvailabilityResult> {
  const client = getSupabaseBrowserClient();
  const { data, error } = await client.rpc("get_available_slots_cached", {
    p_restaurant_id: restaurantId,
    p_date: date,
    p_party_size: partySize,
  });

  if (error) {
    return {
      slots: [],
      floorCapacity: null,
      error: error.message,
      unavailableReason: null,
      message: null,
    };
  }

  const result = (data ?? {}) as {
    slots?: Array<{
      shift_id: string;
      shift_name: string;
      date_time: string;
      table_ids?: string[] | null;
      duration_minutes?: number;
    }>;
    floor_capacity?: number | null;
    unavailable_reason?: AvailabilityUnavailableReason | null;
    message?: string | null;
    timezone?: string | null;
  };

  const timezone = result.timezone || "UTC";
  const floorCapacity = typeof result.floor_capacity === "number" ? result.floor_capacity : null;

  // display_time stays formatted in the browser using V8's en-US time
  // formatter (the same call the edge function used) so the output matches
  // what users were seeing before this swap.
  const slots: AvailabilitySlot[] = (result.slots ?? []).map((slot) => ({
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

  return {
    slots,
    floorCapacity,
    error: null,
    unavailableReason: result.unavailable_reason ?? null,
    message: result.message ?? null,
  };
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

/**
 * Drops cached availability for a restaurant (or all restaurants when
 * `restaurantId` is omitted). Called by realtime subscribers when a booking
 * lands so the next render fetches fresh slots.
 */
export function invalidateAvailabilityCache(restaurantId?: string): void {
  if (!restaurantId) {
    availabilityCache.clear();
    return;
  }
  const prefix = `${restaurantId}|`;
  for (const key of Array.from(availabilityCache.keys())) {
    if (key.startsWith(prefix)) availabilityCache.delete(key);
  }
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
 * Returns the set of dates within [startDate, endDate] (inclusive, max 62
 * days) that have ≥1 available slot for the given party size. Used by the
 * preview modal calendar to disable dates that have nothing — replaces the
 * old per-day fanout (~30 parallel `fetchAvailabilitySlots` calls per modal
 * open).
 */
export async function fetchAvailableDateSet(args: {
  restaurantId: string;
  partySize: number;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}): Promise<Set<string>> {
  const client = getSupabaseBrowserClient();
  const { data, error } = await client.rpc("restaurant_available_dates", {
    p_restaurant_id: args.restaurantId,
    p_party_size: Math.max(1, Math.floor(args.partySize)),
    p_start_date: args.startDate,
    p_end_date: args.endDate,
  });
  if (error || !Array.isArray(data)) return new Set();
  return new Set(data.filter((d): d is string => typeof d === "string"));
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
    .select("id, reserved_at, duration_minutes, restaurant_id, restaurants(name)")
    .eq("user_profile_id", args.userProfileId)
    .in("status", ["pending", "confirmed", "seated"])
    .gte("reserved_at", args.dayStartUtcIso)
    .lte("reserved_at", args.dayEndUtcIso);
  if (args.excludeReservationId) {
    query = query.neq("id", args.excludeReservationId);
  }
  const { data, error } = await query;
  if (error || !data) return [];
  const currentRestaurantId = args.currentRestaurantId;
  return data.map((row) => {
    const start = new Date(row.reserved_at);
    const minutes = typeof row.duration_minutes === "number" && row.duration_minutes > 0
      ? row.duration_minutes
      : 90;
    const joined = (row as { restaurants?: { name?: string | null } | null }).restaurants;
    return {
      start,
      end: new Date(start.getTime() + minutes * 60_000),
      reservationId: row.id as string,
      restaurantId: row.restaurant_id as string | undefined,
      restaurantName: joined?.name ?? null,
      isSameRestaurant: row.restaurant_id === currentRestaurantId,
    };
  });
}

/**
 * Formats a single conflict window as "Restaurant Name · 7:00–8:30 PM" in
 * the supplied IANA timezone. Returns null when restaurant info is missing.
 */
export function formatConflictWindow(
  conflict: ConflictWindow,
  timezone: string | null,
): string | null {
  if (!conflict.restaurantName) return null;
  const tz = timezone || "UTC";
  const fmt = (d: Date) =>
    d.toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  return `${conflict.restaurantName} · ${fmt(conflict.start)}–${fmt(conflict.end)}`;
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

/**
 * Customer-facing realtime invalidator. Subscribes to inserts / updates on
 * `reservations` for the active restaurant and clears the local availability
 * cache whenever a row changes, then invokes the optional `onInvalidate`
 * callback so the page can re-fetch.
 *
 * Scoped to a single restaurant only — Discover / Deals must NOT use this
 * (one socket per card would explode connection counts).
 */
export function useAvailabilityRealtimeInvalidate(
  restaurantId: string | null,
  onInvalidate?: () => void,
): void {
  useEffect(() => {
    if (!restaurantId || !isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`avail:public:${restaurantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservations",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => {
          invalidateAvailabilityCache(restaurantId);
          if (typeof document === "undefined" || document.visibilityState !== "hidden") {
            onInvalidate?.();
          }
        },
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [restaurantId, onInvalidate]);
}
