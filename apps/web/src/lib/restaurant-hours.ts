import { formatCompactTimeLabel } from "@/lib/utils/time";

export const RESTAURANT_WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const RESTAURANT_WEEKDAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export const RESTAURANT_WEEKDAY_NUMBERS = [1, 2, 3, 4, 5, 6, 0] as const;

export type RestaurantDayHours = {
  open: boolean;
  from: string;
  to: string;
};

export type RestaurantSpecialDay = {
  id: string;
  date: string;
  dateMode: "single" | "range";
  startDate: string;
  endDate: string;
  label: string;
  description: string;
  closed: boolean;
  from: string;
  to: string;
};

export const RESTAURANT_TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h += 1) {
  for (const m of [0, 30]) {
    const ampm = h < 12 ? "AM" : "PM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    RESTAURANT_TIME_OPTIONS.push(`${h12}:${m === 0 ? "00" : "30"} ${ampm}`);
  }
}

export function defaultRestaurantHours(): RestaurantDayHours[] {
  return RESTAURANT_WEEKDAYS.map((_, i) => ({
    open: true,
    from: i < 5 ? "11:00 AM" : "10:00 AM",
    to: i < 5 ? "10:00 PM" : "11:00 PM",
  }));
}

function stringField(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function readHoursPair(value: unknown): { from: string; to: string } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.closed === true || row.is_closed === true || row.open === false) return null;

  const from = stringField(row, ["open", "from", "open_time", "openTime", "opens", "start"]);
  const to = stringField(row, ["close", "to", "close_time", "closeTime", "closes", "end"]);
  if (!from || !to) return null;
  return { from, to };
}

export function parseRestaurantHoursJson(
  json: Record<string, unknown> | null | undefined,
): { regular: RestaurantDayHours[]; special: RestaurantSpecialDay[] } {
  if (!json) return { regular: defaultRestaurantHours(), special: [] };

  const regular = RESTAURANT_WEEKDAY_KEYS.map((key) => {
    const pair = readHoursPair(json[key]);
    return pair
      ? { open: true, from: pair.from, to: pair.to }
      : { open: false, from: "11:00 AM", to: "10:00 PM" };
  });

  const rawSpecial = Array.isArray(json.special) ? json.special : [];
  const special: RestaurantSpecialDay[] = rawSpecial
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => {
      const startDate = String(entry.startDate ?? entry.start_date ?? entry.date ?? "");
      const endDate = String(entry.endDate ?? entry.end_date ?? entry.date ?? startDate);
      const dateMode = entry.dateMode === "range" || entry.date_mode === "range" || (startDate && endDate && endDate !== startDate)
        ? "range"
        : "single";
      return {
        id: String(entry.id ?? crypto.randomUUID()),
        date: String(entry.date ?? startDate),
        dateMode,
        startDate,
        endDate: endDate || startDate,
        label: String(entry.label ?? entry.name ?? ""),
        description: String(entry.description ?? ""),
        closed: Boolean(entry.closed),
        from: String(entry.from ?? "12:00 PM"),
        to: String(entry.to ?? "10:00 PM"),
      };
    });

  return { regular, special };
}

export function restaurantHoursToJson(
  hours: RestaurantDayHours[],
  special: RestaurantSpecialDay[],
): Record<string, unknown> {
  const result: Record<string, unknown> = Object.fromEntries(
    RESTAURANT_WEEKDAY_KEYS.map((key, i) => [
      key,
      hours[i]?.open ? { open: hours[i].from, close: hours[i].to } : null,
    ]),
  );
  if (special.length > 0) {
    result.special = special.flatMap(({ id, date, dateMode, startDate, endDate, label, description, closed, from, to }) => {
      const normalizedStart = startDate || date;
      if (!normalizedStart) return [];
      const normalizedEnd = dateMode === "range" ? endDate || normalizedStart : normalizedStart;
      return [{
        id,
        date: normalizedStart,
        dateMode,
        startDate: normalizedStart,
        endDate: normalizedEnd,
        label,
        description,
        closed,
        from,
        to,
      }];
    });
  }
  return result;
}

export function parseRestaurantTimeToMinutes(value: string): number | null {
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

export function minutesToPostgresTime(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`;
}

export function formatRestaurantHoursRows(
  json: Record<string, unknown> | null | undefined,
): Array<{ key: string; label: string; value: string; open: boolean }> {
  return RESTAURANT_WEEKDAY_KEYS.map((key, i) => {
    const pair = json ? readHoursPair(json[key]) : null;
    return {
      key,
      label: RESTAURANT_WEEKDAYS[i],
      value: pair ? `${formatCompactTimeLabel(pair.from)} - ${formatCompactTimeLabel(pair.to)}` : "Closed",
      open: Boolean(pair),
    };
  });
}
