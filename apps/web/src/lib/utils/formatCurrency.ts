/**
 * Seatly money display — SEATLY-MASTER-BIBLE.md (MONEY RULE).
 * DB amounts are decimal dollars; never format money with template strings.
 */
export function formatCurrency(amount: number, currencyCode: "cad"): string {
  if (!Number.isFinite(amount)) {
    throw new Error("formatCurrency: amount must be a finite number");
  }

  switch (currencyCode) {
    case "cad": {
      const formatted = new Intl.NumberFormat("en-CA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
      return `$${formatted}`;
    }
    default: {
      const _exhaustive: never = currencyCode;
      return _exhaustive;
    }
  }
}
