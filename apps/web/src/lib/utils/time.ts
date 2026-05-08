export function formatCompactTimeLabel(value: Date | string): string {
  if (value instanceof Date) {
    return formatTimeParts(value.getHours(), value.getMinutes());
  }

  const trimmed = value.trim();
  const meridiemMatch = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?$/i.exec(trimmed);
  if (meridiemMatch) {
    let hours = Number(meridiemMatch[1]);
    const minutes = Number(meridiemMatch[2] ?? "0");
    const period = meridiemMatch[3].toLowerCase();
    if (period === "pm" || period === "p") {
      if (hours !== 12) hours += 12;
    } else if (hours === 12) {
      hours = 0;
    }
    return formatTimeParts(hours, minutes);
  }

  const twentyFourHourMatch = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
  if (twentyFourHourMatch) {
    return formatTimeParts(Number(twentyFourHourMatch[1]), Number(twentyFourHourMatch[2]));
  }

  return trimmed;
}

/**
 * Compact-time label rendered in a specific IANA timezone, e.g.
 * `formatCompactTimeLabelInTz(new Date("2026-05-08T01:00:00Z"), "America/Toronto")`
 * → `"9pm"` regardless of the browser's local timezone. Falls back to the
 * browser-local formatter when no timezone is provided.
 */
export function formatCompactTimeLabelInTz(
  date: Date,
  timeZone: string | null | undefined,
): string {
  if (!timeZone) {
    return formatCompactTimeLabel(date);
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const lookup = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hours = Number(lookup("hour"));
  const minutes = Number(lookup("minute"));
  const period = lookup("dayPeriod").toLowerCase().includes("p") ? "pm" : "am";
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return formatCompactTimeLabel(date);
  }
  if (minutes === 0) return `${hours}${period}`;
  return `${hours}:${String(minutes).padStart(2, "0")}${period}`;
}

/**
 * Returns the YYYY-MM-DD date for the given instant in the supplied IANA
 * timezone. Falls back to the browser's local date when no timezone is given.
 */
export function dateInTz(date: Date, timeZone: string | null | undefined): string {
  if (!timeZone) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
}

/**
 * Returns the HH:mm time for the given instant in the supplied IANA timezone.
 * Falls back to the browser's local time when no timezone is given.
 */
export function timeInTz(date: Date, timeZone: string | null | undefined): string {
  if (!timeZone) {
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const lookup = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${lookup("hour")}:${lookup("minute")}`;
}

function formatTimeParts(hours: number, minutes: number): string {
  const suffix = hours >= 12 ? "pm" : "am";
  const displayHour = hours % 12 || 12;
  if (minutes === 0) return `${displayHour}${suffix}`;
  return `${displayHour}:${String(minutes).padStart(2, "0")}${suffix}`;
}

/**
 * Normalises a time string to 24-hour `HH:MM` (zero-padded).
 *   "5:15pm"   → "17:15"
 *   "5pm"      → "17:00"
 *   "5:15 PM"  → "17:15"
 *   "17:15"    → "17:15"
 *   "9:30:00"  → "09:30"
 * Returns `null` for unparseable input. The modify-reservation /
 * create-public-booking edge functions build a UTC timestamp by string
 * concatenation (`new Date("${date}T${time}:00Z")`) so anything other than
 * `HH:MM` produces an Invalid Date and a 500 from the function.
 */
export function to24HourTime(value: string): string | null {
  const trimmed = value.trim();
  const meridiem = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?$/i.exec(trimmed);
  if (meridiem) {
    let hours = Number(meridiem[1]);
    const minutes = Number(meridiem[2] ?? "0");
    const period = meridiem[3].toLowerCase();
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (period === "p" && hours !== 12) hours += 12;
    else if (period === "a" && hours === 12) hours = 0;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }
  const twentyFour = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
  if (twentyFour) {
    const hours = Number(twentyFour[1]);
    const minutes = Number(twentyFour[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  }
  return null;
}
