export interface SpecialDayMatch {
  startDate: string;
  endDate: string;
  label: string | null;
  description: string | null;
  closed: boolean;
  from: string | null;
  to: string | null;
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateValue(value: unknown): string | null {
  const text = textValue(value);
  if (!text) return null;
  const dateOnly = text.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : null;
}

function normalizeRange(row: Record<string, unknown>): { startDate: string; endDate: string } | null {
  const startDate = dateValue(row.startDate ?? row.start_date ?? row.date);
  if (!startDate) return null;
  const endDate = dateValue(row.endDate ?? row.end_date ?? row.date) ?? startDate;
  return endDate < startDate
    ? { startDate: endDate, endDate: startDate }
    : { startDate, endDate };
}

export function findSpecialDayForDate(
  hoursJson: unknown,
  dateOnly: string,
): SpecialDayMatch | null {
  const hours = recordFrom(hoursJson);
  const specialEntries = Array.isArray(hours?.special) ? hours.special : [];

  for (const entry of specialEntries) {
    const row = recordFrom(entry);
    if (!row) continue;
    const range = normalizeRange(row);
    if (!range || dateOnly < range.startDate || dateOnly > range.endDate) continue;

    return {
      ...range,
      label: textValue(row.label ?? row.name),
      description: textValue(row.description),
      closed: row.closed === true || row.is_closed === true || row.open === false,
      from: textValue(row.from ?? row.open ?? row.open_time ?? row.openTime ?? row.opens ?? row.start),
      to: textValue(row.to ?? row.close ?? row.close_time ?? row.closeTime ?? row.closes ?? row.end),
    };
  }

  return null;
}

export function findClosedSpecialDayForDate(
  hoursJson: unknown,
  dateOnly: string,
): SpecialDayMatch | null {
  const specialDay = findSpecialDayForDate(hoursJson, dateOnly);
  return specialDay?.closed ? specialDay : null;
}

export function closureUnavailableMessage(closure: SpecialDayMatch): string {
  return closure.label ? `Closed for ${closure.label}.` : "This restaurant is closed on that date.";
}

export function localDateForDateTime(value: Date | string, timezone: string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}
