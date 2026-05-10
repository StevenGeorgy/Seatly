function localHourInTimeZone(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    if (Number.isFinite(hour)) return hour;
  } catch {
    // Fall through to the runtime's local clock if Intl rejects the timezone.
  }
  return new Date().getHours();
}

export function mealPeriodForTimeZone(
  timezone: string,
): "breakfast" | "lunch" | "dinner" {
  const hour = localHourInTimeZone(timezone);
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 16) return "lunch";
  return "dinner";
}
