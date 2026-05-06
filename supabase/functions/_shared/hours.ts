export const DOW_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const DOW_SHORT_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export interface ParsedHoursWindow {
  open: number;
  close: number;
  label: string;
}

export interface LocalBookingParts {
  dateOnly: string;
  timeMinutes: number;
  dayOfWeek: number;
}

type ParsedClockTime = {
  hour: number;
  minute: number;
  minutes: number;
  hasMeridiem: boolean;
};

function parseClockTime(value: string | null | undefined): ParsedClockTime | null {
  const cleaned = String(value ?? "").trim().toLowerCase().replace(/\./g, "");
  const match = cleaned.match(/^(\d{1,2})(?::(\d{1,2}))?(?::\d{1,2})?\s*(am|pm)?$/);
  if (!match) return null;

  const rawHour = Number(match[1]);
  const minute = match[2] == null ? 0 : Number(match[2]);
  const meridiem = match[3] as "am" | "pm" | undefined;
  if (!Number.isFinite(rawHour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }
  if (!meridiem && (rawHour < 0 || rawHour > 23)) return null;
  if (meridiem && (rawHour < 1 || rawHour > 12)) return null;

  let hour = rawHour;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  return {
    hour,
    minute,
    minutes: hour * 60 + minute,
    hasMeridiem: Boolean(meridiem),
  };
}

function normalizeHours(openLabel: string, closeLabel: string): ParsedHoursWindow | null {
  const open = parseClockTime(openLabel);
  const close = parseClockTime(closeLabel);
  if (!open || !close) return null;

  let closeMinutes = close.minutes;
  if (!close.hasMeridiem && closeMinutes <= open.minutes) {
    closeMinutes += open.minutes < 12 * 60 && close.hour <= 12 ? 12 * 60 : 24 * 60;
    if (closeMinutes <= open.minutes) closeMinutes += 12 * 60;
  } else if (closeMinutes <= open.minutes) {
    closeMinutes += 24 * 60;
  }

  return {
    open: open.minutes,
    close: closeMinutes,
    label: `${formatMinutesForDisplay(open.minutes)} to ${formatMinutesForDisplay(closeMinutes)}`,
  };
}

function formatMinutesForDisplay(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
}

function readHoursRange(raw: unknown): ParsedHoursWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  if (entry.closed === true) return null;
  const open = typeof entry.open === "string" ? entry.open : entry.from;
  const close = typeof entry.close === "string" ? entry.close : entry.to;
  if (typeof open !== "string" || typeof close !== "string") return null;
  return normalizeHours(open, close);
}

export function resolveRestaurantHoursForDate(
  hoursJson: Record<string, unknown> | null,
  dateOnly: string,
  dayOfWeek: number,
): { hasHoursJson: boolean; closed: boolean; window: ParsedHoursWindow | null } {
  if (!hoursJson) return { hasHoursJson: false, closed: false, window: null };

  const specialEntries = Array.isArray(hoursJson.special)
    ? (hoursJson.special as Array<Record<string, unknown>>)
    : [];
  const special = specialEntries.find((entry) => String(entry.date ?? "") === dateOnly);
  if (special) {
    const window = readHoursRange(special);
    return { hasHoursJson: true, closed: !window, window };
  }

  const dayName = DOW_NAMES[dayOfWeek] ?? "monday";
  const shortDayName = DOW_SHORT_NAMES[dayOfWeek] ?? dayName.slice(0, 3);
  const weeklyKey =
    Object.prototype.hasOwnProperty.call(hoursJson, dayName)
      ? dayName
      : Object.prototype.hasOwnProperty.call(hoursJson, shortDayName)
        ? shortDayName
        : dayName;
  const window = readHoursRange(hoursJson[weeklyKey]);
  return { hasHoursJson: true, closed: !window, window };
}

export function localBookingParts(
  dateTimeIso: string,
  timezone: string,
): LocalBookingParts | null {
  const date = new Date(dateTimeIso);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = Number(values.get("hour"));
  const minute = Number(values.get("minute"));
  const weekday = values.get("weekday");
  const dayOfWeek = weekday ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday) : -1;

  if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute) || dayOfWeek < 0) {
    return null;
  }

  return {
    dateOnly: `${year}-${month}-${day}`,
    timeMinutes: hour * 60 + minute,
    dayOfWeek,
  };
}

export function isMinuteInsideWindow(timeMinutes: number, window: ParsedHoursWindow): boolean {
  return (
    (timeMinutes >= window.open && timeMinutes < window.close) ||
    (window.close > 1440 && timeMinutes + 1440 < window.close)
  );
}
