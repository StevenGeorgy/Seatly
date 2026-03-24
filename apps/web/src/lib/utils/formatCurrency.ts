/**
 * Seatly money display — SEATLY-MASTER-BIBLE.md (MONEY RULE).
 * DB amounts are decimal dollars; never format money with template strings.
 *
 * Currency comes from restaurants.currency (ISO 4217) — never hardcode "cad".
 * The viewer's browser locale drives symbol placement / grouping automatically.
 */
export function formatCurrency(amount: number, currencyCode: string): string {
  if (!Number.isFinite(amount)) {
    throw new Error("formatCurrency: amount must be a finite number");
  }

  return new Intl.NumberFormat(navigator.language, {
    style: "currency",
    currency: currencyCode.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
