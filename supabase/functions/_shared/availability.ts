import { supabaseAdmin } from "./supabase.ts";
import { localToUTC, localDayOfWeek } from "./time.ts";
import { closureUnavailableMessage, findSpecialDayForDate } from "./closures.ts";

export interface AvailabilitySlot {
  shift_id: string;
  shift_name: string;
  date_time: string;   // UTC ISO — pass directly to complete_booking
  display_time: string; // Local time shown to user
  table_ids?: string[];
  duration_minutes?: number;
  floor_capacity?: number;
}

export interface AvailabilityResult {
  slots: AvailabilitySlot[];
  floor_capacity?: number;
  unavailable_reason?: "closed";
  /** Human-readable opening window ("5:00 PM to 10:00 PM") the assistant
   *  should speak INSTEAD of enumerating individual slots. Computed from
   *  the earliest and latest bookable slot across all matching shifts. */
  hours_window?: string | null;
  message?: string;
}

function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
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

function readHoursPair(value: unknown): { open: number; close: number; label: string } | "closed" | null {
  if (!value || typeof value !== "object") return "closed";
  const row = value as Record<string, unknown>;
  if (row.closed === true || row.is_closed === true || row.open === false) return "closed";
  const openValue = row.open ?? row.from ?? row.open_time ?? row.openTime ?? row.opens ?? row.start;
  const closeValue = row.close ?? row.to ?? row.close_time ?? row.closeTime ?? row.closes ?? row.end;
  if (typeof openValue !== "string" || typeof closeValue !== "string") return "closed";
  const open = parseTimeToMinutes(openValue);
  const close = parseTimeToMinutes(closeValue);
  if (open == null || close == null || close <= open) return "closed";
  return { open, close, label: `${openValue} to ${closeValue}` };
}

export async function getAvailability(
  restaurant_id: string,
  date: string, // YYYY-MM-DD
  party_size: number,
): Promise<AvailabilityResult> {
  const dateOnly = date.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  // Fetch restaurant timezone + owner-configured hours. `hours_json` is the
  // source of truth for what the customer sees as "store hours" (set in the
  // Settings page). Shape: { monday: { open, close } | null, ..., special: [] }
  // in 12-hour strings ("11:00 AM", "10:00 PM").
  const { data: restaurantRow } = await supabaseAdmin
    .from("restaurants")
    .select("timezone, hours_json, settings_json")
    .eq("id", restaurant_id)
    .single();
  const timezone = restaurantRow?.timezone || "UTC";
  const configuredTurnMinutes =
    typeof restaurantRow?.settings_json?.turnTimeMinutes === "number"
      ? restaurantRow.settings_json.turnTimeMinutes
      : null;
  const { data: floorCapacityData } = await supabaseAdmin.rpc("restaurant_floor_capacity", {
    p_restaurant_id: restaurant_id,
  });
  const floorCapacity = Number.isFinite(Number(floorCapacityData)) ? Number(floorCapacityData) : 0;
  if (party_size < 1 || party_size > floorCapacity) {
    return {
      slots: [],
      floor_capacity: floorCapacity,
      message: floorCapacity > 0
        ? `This restaurant can take parties up to ${floorCapacity}.`
        : "This restaurant does not have a saved floor plan yet.",
    };
  }

  const dayOfWeek = localDayOfWeek(dateOnly, timezone);
  // localDayOfWeek returns JS-style 0-6 (0=Sun ... 6=Sat) — the same
  // convention used by `shifts.days_of_week` in Postgres, so this value can
  // be passed straight to the `.contains` query below. hours_json keys are
  // lowercase day names, so map the number to the corresponding key.
  const DOW_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayOfWeekName = DOW_NAMES[dayOfWeek] ?? "monday";

  // Resolve the configured booking window for THIS date. Special-day entries
  // take precedence over the recurring weekly schedule.
  let configuredHoursWindow: string | null = null;
  let configuredHours:
    | { open: number; close: number }
    | "closed"
    | null = null;
  const hoursJson =
    restaurantRow?.hours_json && typeof restaurantRow.hours_json === "object"
      ? (restaurantRow.hours_json as Record<string, unknown>)
      : null;
  if (hoursJson) {
    const special = findSpecialDayForDate(hoursJson, dateOnly);
    if (special) {
      if (special.closed === true) {
        configuredHours = "closed";
      } else {
        const pair = readHoursPair({ open: special.from, close: special.to, closed: false });
        if (pair && pair !== "closed") {
          configuredHours = { open: pair.open, close: pair.close };
          configuredHoursWindow = pair.label;
        } else {
          configuredHours = "closed";
        }
      }
    } else {
      const pair = readHoursPair(hoursJson[dayOfWeekName]);
      if (pair === "closed") {
        configuredHours = "closed";
      } else if (pair) {
        configuredHours = { open: pair.open, close: pair.close };
        configuredHoursWindow = pair.label;
      }
    }
  }

  if (configuredHours === "closed") {
    const special = hoursJson ? findSpecialDayForDate(hoursJson, dateOnly) : null;
    return {
      slots: [],
      floor_capacity: floorCapacity,
      hours_window: null,
      unavailable_reason: "closed",
      message: special?.closed ? closureUnavailableMessage(special) : "No availability on that date.",
    };
  }

  // Fetch matching shifts — also select blackout_dates and advance_booking_days
  const { data: shifts } = await supabaseAdmin
    .from("shifts")
    .select(
      "id, name, start_time, end_time, slot_duration_minutes, turn_time_minutes, min_party_size, max_party_size, max_covers, blackout_dates, advance_booking_days",
    )
    .eq("restaurant_id", restaurant_id)
    .eq("is_active", true)
    .contains("days_of_week", [dayOfWeek]);

  if (!shifts?.length) {
    return { slots: [], floor_capacity: floorCapacity, message: "No availability on that date." };
  }

  // Query reservations using UTC bounds for the restaurant's local day
  const dayStartUTC = localToUTC(dateOnly, "00:00", timezone);
  const dayEndUTC = localToUTC(dateOnly, "23:59", timezone);

  const { data: reservations } = await supabaseAdmin
    .from("reservations")
    .select("shift_id, reserved_at, party_size, duration_minutes")
    .eq("restaurant_id", restaurant_id)
    .in("status", ["pending", "confirmed", "seated"])
    .gte("reserved_at", dayStartUTC)
    .lte("reserved_at", dayEndUTC);

  const slots: AvailabilitySlot[] = [];
  const todayDate = new Date(today);
  const requestDate = new Date(dateOnly);

  for (const shift of shifts) {
    // Enforce advance_booking_days — don't show if booking window hasn't opened
    const advanceDays = shift.advance_booking_days ?? 30;
    const maxBookingDate = new Date(todayDate.getTime() + advanceDays * 86_400_000);
    if (requestDate > maxBookingDate) continue;

    // Enforce blackout_dates
    const blackouts: string[] = shift.blackout_dates ?? [];
    if (blackouts.includes(dateOnly)) continue;

    const [sH, sM] = (shift.start_time ?? "17:00").split(":").map(Number);
    const [eH, eM] = (shift.end_time ?? "23:00").split(":").map(Number);
    const slotMins = shift.slot_duration_minutes ?? 30;
    const turnMins = configuredTurnMinutes ?? shift.turn_time_minutes ?? 90;
    const maxCovers = shift.max_covers ?? 100;

    let slotMin = sH * 60 + sM;
    let endMin = eH * 60 + eM;
    if (configuredHours && configuredHours !== "closed") {
      slotMin = Math.max(slotMin, configuredHours.open);
      endMin = Math.min(endMin, configuredHours.close);
    }
    if (endMin <= slotMin) continue;

    while (slotMin + slotMins <= endMin) {
      const slotHour = Math.floor(slotMin / 60);
      const slotMinute = slotMin % 60;
      const timeStr = `${String(slotHour).padStart(2, "0")}:${String(slotMinute).padStart(2, "0")}`;

      const slotDateTimeUTC = localToUTC(dateOnly, timeStr, timezone);
      const slotStart = new Date(slotDateTimeUTC);
      const slotEnd = new Date(slotStart.getTime() + turnMins * 60_000);

      const shiftResvs = (reservations ?? []).filter((r: any) => r.shift_id === shift.id);
      let totalCovers = party_size;
      let available = true;

      for (const r of shiftResvs) {
        const resvStart = new Date(r.reserved_at);
        const resvDuration = r.duration_minutes ?? turnMins;
        const resvEnd = new Date(resvStart.getTime() + resvDuration * 60_000);
        if (slotStart < resvEnd && slotEnd > resvStart) {
          totalCovers += r.party_size ?? 0;
          if (totalCovers > maxCovers) {
            available = false;
            break;
          }
        }
      }

      if (available) {
        const { data: tableIds, error: assignmentErr } = await supabaseAdmin.rpc("find_available_table_group", {
          p_restaurant_id: restaurant_id,
          p_reserved_at: slotStart.toISOString(),
          p_party_size: party_size,
          p_turn_minutes: turnMins,
        });
        const assignedTableIds = Array.isArray(tableIds)
          ? tableIds.filter((id): id is string => typeof id === "string")
          : [];
        if (assignmentErr || assignedTableIds.length === 0) {
          slotMin += slotMins;
          continue;
        }

        slots.push({
          shift_id: shift.id,
          shift_name: shift.name ?? "Shift",
          date_time: slotStart.toISOString(),
          display_time: slotStart.toLocaleTimeString("en-US", {
            timeZone: timezone,
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }),
          table_ids: assignedTableIds,
          duration_minutes: turnMins,
          floor_capacity: floorCapacity,
        });
      }

      slotMin += slotMins;
    }
  }

  const limited = slots.slice(0, 15);
  // Prefer the owner-configured hours. Fall back to the slot-derived window
  // only when hours_json is missing or the day is marked closed (otherwise
  // the assistant would read a misleading narrow range like "12 PM to 8:30
  // PM" that just reflects the shift configuration, not real store hours).
  const hours_window =
    configuredHoursWindow ??
    (limited.length
      ? `${limited[0].display_time} to ${limited[limited.length - 1].display_time}`
      : null);
  return { slots: limited, floor_capacity: floorCapacity, hours_window };
}
