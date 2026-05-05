import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { localDayOfWeek, localToUTC } from "../_shared/time.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

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

function readHoursPair(value: unknown): { open: number; close: number } | "closed" | null {
  if (!value || typeof value !== "object") return "closed";
  const row = value as Record<string, unknown>;
  if (row.closed === true || row.is_closed === true || row.open === false) return "closed";
  const openValue = row.open ?? row.from ?? row.open_time ?? row.openTime ?? row.opens ?? row.start;
  const closeValue = row.close ?? row.to ?? row.close_time ?? row.closeTime ?? row.closes ?? row.end;
  if (typeof openValue !== "string" || typeof closeValue !== "string") return "closed";
  const open = parseTimeToMinutes(openValue);
  const close = parseTimeToMinutes(closeValue);
  if (open == null || close == null || close <= open) return "closed";
  return { open, close };
}

function configuredHoursForDate(
  hoursJson: Record<string, unknown> | null,
  dateOnly: string,
  dayOfWeek: number,
): { open: number; close: number } | "closed" | null {
  if (!hoursJson) return null;
  const specialEntries = Array.isArray(hoursJson.special)
    ? (hoursJson.special as Array<Record<string, unknown>>)
    : [];
  const special = specialEntries.find((entry) => String(entry.date ?? "") === dateOnly);
  if (special) {
    if (special.closed === true) return "closed";
    return readHoursPair({
      open: special.from,
      close: special.to,
      closed: false,
    });
  }
  return readHoursPair(hoursJson[DAY_NAMES[dayOfWeek] ?? "monday"]);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const restaurantId = url.searchParams.get("restaurant_id");
    const dateStr = url.searchParams.get("date");
    const partySize = parseInt(url.searchParams.get("party_size") || "2", 10);

    if (!restaurantId || !dateStr) {
      return new Response(
        JSON.stringify({ error: "restaurant_id and date required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const dateOnly = dateStr.slice(0, 10);

    const { data: restaurantRow } = await supabase
      .from("restaurants")
      .select("settings_json, hours_json, timezone")
      .eq("id", restaurantId)
      .single();
    const timezone =
      typeof restaurantRow?.timezone === "string" && restaurantRow.timezone.trim()
        ? restaurantRow.timezone
        : "America/Toronto";
    const dayOfWeek = localDayOfWeek(dateOnly, timezone);
    const { data: floorCapacityData } = await supabase.rpc("restaurant_floor_capacity", {
      p_restaurant_id: restaurantId,
    });
    const floorCapacity = Number.isFinite(Number(floorCapacityData)) ? Number(floorCapacityData) : 0;
    if (partySize < 1 || partySize > floorCapacity) {
      return new Response(
        JSON.stringify({ slots: [], floor_capacity: floorCapacity }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const configuredTurnMinutes =
      typeof restaurantRow?.settings_json?.turnTimeMinutes === "number"
        ? restaurantRow.settings_json.turnTimeMinutes
        : null;
    const hoursJson =
      restaurantRow?.hours_json && typeof restaurantRow.hours_json === "object"
        ? restaurantRow.hours_json as Record<string, unknown>
        : null;
    const configuredHours = configuredHoursForDate(hoursJson, dateOnly, dayOfWeek);
    if (configuredHours === "closed") {
      return new Response(
        JSON.stringify({ slots: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: shifts } = await supabase
      .from("shifts")
      .select("id, name, start_time, end_time, slot_duration_minutes, turn_time_minutes, min_party_size, max_party_size, max_covers")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .contains("days_of_week", [dayOfWeek]);

    if (!shifts?.length) {
      return new Response(
        JSON.stringify({ slots: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const start = localToUTC(dateOnly, "00:00", timezone);
    const end = localToUTC(dateOnly, "23:59", timezone);
    const { data: reservations } = await supabase
      .from("reservations")
      .select("shift_id, reserved_at, party_size, duration_minutes")
      .eq("restaurant_id", restaurantId)
      .in("status", ["pending", "confirmed", "seated"])
      .gte("reserved_at", start)
      .lte("reserved_at", end);

    const slots: {
      shift_id: string;
      shift_name: string;
      time: string;
      date_time: string;
      display_time: string;
      table_ids: string[];
      duration_minutes: number;
      floor_capacity: number;
    }[] = [];

    for (const shift of shifts) {
      const [sH, sM] = (shift.start_time || "17:00").split(":").map(Number);
      const [eH, eM] = (shift.end_time || "23:00").split(":").map(Number);
      const slotMins = shift.slot_duration_minutes || 30;
      const turnMins = configuredTurnMinutes || shift.turn_time_minutes || 90;
      const maxCovers = shift.max_covers || 100;

      let slotMin = sH * 60 + sM;
      let endMin = eH * 60 + eM;
      if (configuredHours) {
        slotMin = Math.max(slotMin, configuredHours.open);
        endMin = Math.min(endMin, configuredHours.close);
      }
      if (endMin <= slotMin) continue;

      while (slotMin + slotMins <= endMin) {
        const slotTime = `${String(Math.floor(slotMin / 60)).padStart(2, "0")}:${String(slotMin % 60).padStart(2, "0")}`;
        const slotStart = new Date(localToUTC(dateOnly, slotTime, timezone));
        const slotEnd = new Date(slotStart.getTime() + turnMins * 60 * 1000);

        const shiftResvs = (reservations || []).filter((r) => r.shift_id === shift.id);
        let totalCovers = partySize;
        let available = true;
        for (const r of shiftResvs) {
          const resvStart = new Date(r.reserved_at);
          const resvDuration = r.duration_minutes || turnMins;
          const resvEnd = new Date(resvStart.getTime() + resvDuration * 60 * 1000);
          if (slotStart < resvEnd && slotEnd > resvStart) {
            totalCovers += r.party_size || 0;
            if (totalCovers > maxCovers) {
              available = false;
              break;
            }
          }
        }
        if (available && totalCovers <= maxCovers) {
          const { data: tableIds, error: assignmentErr } = await supabase.rpc("find_available_table_group", {
            p_restaurant_id: restaurantId,
            p_reserved_at: slotStart.toISOString(),
            p_party_size: partySize,
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
            shift_name: shift.name || "Shift",
            time: slotStart.toISOString().slice(0, 19).replace("T", " "),
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

    return new Response(JSON.stringify({ slots, floor_capacity: floorCapacity }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
