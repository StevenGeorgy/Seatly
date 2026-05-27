export function formatCents(cents: number, currency = "$"): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  return `${currency}${(safe / 100).toFixed(2)}`;
}
