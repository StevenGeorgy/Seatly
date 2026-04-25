// Returns how many minutes UTC is ahead of the given timezone at `date`.
// e.g. America/Toronto in EDT → 240 (UTC is 4h ahead of local EDT time).
export function getUTCOffsetMinutes(date: Date, timezone: string): number {
  const utcMs = new Date(date.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  const tzMs = new Date(date.toLocaleString("en-US", { timeZone: timezone })).getTime();
  return (utcMs - tzMs) / 60_000;
}

// Convert a restaurant-local YYYY-MM-DD date + HH:MM time to a UTC ISO string.
// e.g. ("2026-04-15", "19:00", "America/Toronto") → "2026-04-15T23:00:00.000Z"
export function localToUTC(dateStr: string, timeStr: string, timezone: string): string {
  const tempDate = new Date(`${dateStr}T${timeStr}:00Z`);
  const offsetMinutes = getUTCOffsetMinutes(tempDate, timezone);
  return new Date(tempDate.getTime() + offsetMinutes * 60_000).toISOString();
}

// Map locale weekday abbreviation → JS day-of-week (0=Sun … 6=Sat).
// This matches both `Date.prototype.getDay()` and the convention stored in
// `shifts.days_of_week` in Postgres, so a value returned here can be used
// directly as the lookup key against the DB without translation.
const DOW_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

// Return the JS-style day-of-week (0=Sun … 6=Sat) for a YYYY-MM-DD string in
// the given timezone.
export function localDayOfWeek(dateStr: string, timezone: string): number {
  const anchor = new Date(`${dateStr}T12:00:00Z`);
  const localDow = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(anchor);
  return DOW_MAP[localDow] ?? anchor.getUTCDay();
}
