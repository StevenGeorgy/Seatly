import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { closureUnavailableMessage, findClosedSpecialDayForDate } from "../_shared/closures.ts";
import { localDayOfWeek, localToUTC } from "../_shared/time.ts";
import {
  formatReservationDate,
  sendReservationNotification,
} from "../_shared/reservation-notifications.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RequestBody = {
  reservation_id?: unknown;
  reservationId?: unknown;
  date?: unknown;
  time?: unknown;
  party_size?: unknown;
  partySize?: unknown;
  special_request?: unknown;
  specialRequest?: unknown;
};

type ReservationRow = {
  id: string;
  restaurant_id: string;
  guest_id: string;
  reserved_at: string;
  party_size: number;
  status: string | null;
  special_request: string | null;
  internal_notes: string | null;
  confirmation_code: string | null;
  guest_full_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
};

type GuestRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

type RestaurantSettings = {
  turnTimeMinutes?: number | null;
};

type RestaurantRow = {
  name: string | null;
  timezone: string | null;
  hours_json: unknown;
  settings_json: RestaurantSettings | null;
};

type ShiftRow = {
  id: string;
  start_time: string | null;
  end_time: string | null;
  turn_time_minutes: number | null;
  max_covers: number | null;
};

type ExistingReservationRow = {
  id: string;
  shift_id: string | null;
  reserved_at: string;
  party_size: number | null;
  duration_minutes: number | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseTimeToMinutes(value: string): number | null {
  const trimmed = value.trim();
  const meridiem = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (meridiem) {
    let hours = Number(meridiem[1]);
    const minutes = Number(meridiem[2] ?? 0);
    const period = meridiem[3].toLowerCase();
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (period === "pm" && hours !== 12) hours += 12;
    if (period === "am" && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  const [hourPart, minutePart] = trimmed.split(":");
  const hours = Number(hourPart);
  const minutes = Number(minutePart ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function shiftContainsMinute(shift: ShiftRow, minute: number): boolean {
  const start = parseTimeToMinutes(shift.start_time ?? "17:00");
  const end = parseTimeToMinutes(shift.end_time ?? "23:00");
  if (start == null || end == null) return false;
  if (end > start) return minute >= start && minute < end;
  return minute >= start || minute < end;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!bearerToken) return json({ error: "Authentication required" }, 401);

    const {
      data: { user },
      error: userError,
    } = await adminClient.auth.getUser(bearerToken);
    if (userError || !user) return json({ error: "Invalid or expired session" }, 401);

    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const reservationId = cleanString(body.reservation_id ?? body.reservationId);
    const date = cleanString(body.date);
    const time = cleanString(body.time);
    const partySize = Math.max(1, Math.floor(Number(body.party_size ?? body.partySize)));
    const specialRequest = cleanString(body.special_request ?? body.specialRequest);

    if (!reservationId) return json({ error: "reservation_id is required" }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Valid date is required" }, 400);
    if (!time || parseTimeToMinutes(time) == null) return json({ error: "Valid time is required" }, 400);
    if (!Number.isFinite(partySize) || partySize < 1) return json({ error: "Valid party size is required" }, 400);

    const { data: profile, error: profileError } = await adminClient
      .from("user_profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (profileError) return json({ error: profileError.message }, 400);
    if (!profile) return json({ error: "User profile not found" }, 403);

    const { data: reservation, error: reservationError } = await adminClient
      .from("reservations")
      .select("id, restaurant_id, guest_id, reserved_at, party_size, status, special_request, internal_notes, confirmation_code, guest_full_name, guest_email, guest_phone")
      .eq("id", reservationId)
      .maybeSingle<ReservationRow>();
    if (reservationError) return json({ error: reservationError.message }, 400);
    if (!reservation) return json({ error: "Reservation not found" }, 404);

    const { data: guest, error: guestError } = await adminClient
      .from("guests")
      .select("id, full_name, email, phone")
      .eq("id", reservation.guest_id)
      .eq("user_profile_id", profile.id)
      .maybeSingle<GuestRow>();
    if (guestError) return json({ error: guestError.message }, 400);
    if (!guest) return json({ error: "You can only modify your own reservations" }, 403);

    if (!["pending", "confirmed"].includes(reservation.status ?? "pending")) {
      return json({ error: "Only upcoming reservations can be modified" }, 400);
    }
    if (new Date(reservation.reserved_at).getTime() < Date.now()) {
      return json({ error: "Past reservations cannot be modified" }, 400);
    }

    const { data: restaurant, error: restaurantError } = await adminClient
      .from("restaurants")
      .select("name, timezone, hours_json, settings_json")
      .eq("id", reservation.restaurant_id)
      .maybeSingle<RestaurantRow>();
    if (restaurantError) return json({ error: restaurantError.message }, 400);

    const timezone =
      typeof restaurant?.timezone === "string" && restaurant.timezone.trim()
        ? restaurant.timezone
        : "America/Toronto";
    const restaurantName =
      typeof restaurant?.name === "string" && restaurant.name.trim()
        ? restaurant.name.trim()
        : "the restaurant";
    const previousDateLabel = formatReservationDate(new Date(reservation.reserved_at), timezone);
    const reservedAtIso = localToUTC(date, time, timezone);
    const reservedAt = new Date(reservedAtIso);
    if (Number.isNaN(reservedAt.getTime()) || reservedAt.getTime() < Date.now()) {
      return json({ error: "Reservation time must be in the future" }, 400);
    }
    const closure = findClosedSpecialDayForDate(restaurant?.hours_json, date);
    if (closure) {
      return json({ error: closureUnavailableMessage(closure), unavailable_reason: "closed" }, 409);
    }

    const { data: floorCapacityData } = await adminClient.rpc("restaurant_floor_capacity", {
      p_restaurant_id: reservation.restaurant_id,
    });
    const floorCapacity = Number.isFinite(Number(floorCapacityData)) ? Number(floorCapacityData) : 0;
    if (partySize > floorCapacity) {
      return json({ error: `Party size exceeds this restaurant's capacity of ${floorCapacity}` }, 400);
    }

    const dayOfWeek = localDayOfWeek(date, timezone);
    const requestedMinute = parseTimeToMinutes(time);
    const { data: shifts, error: shiftsError } = await adminClient
      .from("shifts")
      .select("id, start_time, end_time, turn_time_minutes, max_covers")
      .eq("restaurant_id", reservation.restaurant_id)
      .eq("is_active", true)
      .contains("days_of_week", [dayOfWeek])
      .returns<ShiftRow[]>();
    if (shiftsError) return json({ error: shiftsError.message }, 400);

    const selectedShift = (shifts ?? []).find((shift) =>
      requestedMinute == null ? false : shiftContainsMinute(shift, requestedMinute),
    );
    if (!selectedShift) return json({ error: "No active shift is available at that time" }, 400);

    const configuredTurnMinutes =
      typeof restaurant?.settings_json?.turnTimeMinutes === "number"
        ? restaurant.settings_json.turnTimeMinutes
        : null;
    const turnMinutes = configuredTurnMinutes || selectedShift.turn_time_minutes || 90;
    const maxCovers = selectedShift.max_covers || 100;
    const slotEnd = new Date(reservedAt.getTime() + turnMinutes * 60_000);
    const dayStart = localToUTC(date, "00:00", timezone);
    const dayEnd = localToUTC(date, "23:59", timezone);

    const { data: activeReservations, error: activeReservationError } = await adminClient
      .from("reservations")
      .select("id, shift_id, reserved_at, party_size, duration_minutes")
      .eq("restaurant_id", reservation.restaurant_id)
      .neq("id", reservationId)
      .in("status", ["pending", "confirmed", "seated"])
      .gte("reserved_at", dayStart)
      .lte("reserved_at", dayEnd)
      .returns<ExistingReservationRow[]>();
    if (activeReservationError) return json({ error: activeReservationError.message }, 400);

    const totalCovers = (activeReservations ?? []).reduce((total, row) => {
      if (row.shift_id !== selectedShift.id) return total;
      const existingStart = new Date(row.reserved_at);
      const existingEnd = new Date(existingStart.getTime() + (row.duration_minutes || turnMinutes) * 60_000);
      if (reservedAt < existingEnd && slotEnd > existingStart) {
        return total + (row.party_size || 0);
      }
      return total;
    }, partySize);
    if (totalCovers > maxCovers) {
      return json({ error: "That time is no longer available for this party size" }, 409);
    }

    const { data: tableIds, error: tableError } = await adminClient.rpc("find_available_table_group", {
      p_restaurant_id: reservation.restaurant_id,
      p_reserved_at: reservedAtIso,
      p_party_size: partySize,
      p_turn_minutes: turnMinutes,
      p_exclude_reservation_id: reservationId,
    });
    const assignedTableIds = Array.isArray(tableIds)
      ? tableIds.filter((id): id is string => typeof id === "string")
      : [];
    if (tableError || assignedTableIds.length === 0) {
      return json({ error: "That time is no longer available for this party size" }, 409);
    }

    const marker = `[Diner modified booking at ${new Date().toISOString()}]`;
    const previousNotes = reservation.internal_notes?.trim();
    const internalNotes = previousNotes ? `${previousNotes}\n${marker}` : marker;

    const { error: updateError } = await adminClient
      .from("reservations")
      .update({
        reserved_at: reservedAtIso,
        party_size: partySize,
        shift_id: selectedShift.id,
        special_request: specialRequest || null,
        internal_notes: internalNotes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reservationId);
    if (updateError) return json({ error: updateError.message }, 400);

    const { data: reassignedTables, error: assignmentError } = await adminClient.rpc("assign_reservation_tables", {
      p_reservation_id: reservationId,
      p_restaurant_id: reservation.restaurant_id,
      p_reserved_at: reservedAtIso,
      p_party_size: partySize,
      p_turn_minutes: turnMinutes,
    });
    const nextTableIds = Array.isArray(reassignedTables)
      ? reassignedTables.filter((id): id is string => typeof id === "string")
      : [];
    if (assignmentError || nextTableIds.length === 0) {
      return json({ error: "Reservation updated, but tables could not be reassigned" }, 409);
    }

    const guestName =
      reservation.guest_full_name?.trim() ||
      guest.full_name?.trim() ||
      "there";
    const guestEmail = reservation.guest_email?.trim() || guest.email?.trim() || null;
    const guestPhone = reservation.guest_phone?.trim() || guest.phone?.trim() || null;
    const nextDateLabel = formatReservationDate(reservedAt, timezone);
    const codeLine = reservation.confirmation_code?.trim()
      ? ` Confirmation code: ${reservation.confirmation_code.trim()}.`
      : "";
    const notification = await sendReservationNotification({
      supabase: adminClient,
      guestId: guest.id,
      restaurantId: reservation.restaurant_id,
      reservationId,
      type: "reservation_modification",
      email: guestEmail,
      phone: guestPhone,
      subject: `Your reservation at ${restaurantName} was updated`,
      body:
        `Hi ${guestName}, your reservation at ${restaurantName} was updated from ${previousDateLabel} ` +
        `to ${nextDateLabel} for ${partySize} ${partySize === 1 ? "guest" : "guests"}.` +
        codeLine,
    });

    return json({
      ok: true,
      reservation_id: reservationId,
      reserved_at: reservedAtIso,
      party_size: partySize,
      special_request: specialRequest || null,
      table_ids: nextTableIds,
      notification_delivery: notification.status,
      notification_delivery_channel: notification.channel,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
