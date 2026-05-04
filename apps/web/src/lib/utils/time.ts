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

function formatTimeParts(hours: number, minutes: number): string {
  const suffix = hours >= 12 ? "pm" : "am";
  const displayHour = hours % 12 || 12;
  if (minutes === 0) return `${displayHour}${suffix}`;
  return `${displayHour}:${String(minutes).padStart(2, "0")}${suffix}`;
}
