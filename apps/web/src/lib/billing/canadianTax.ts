// Canadian provincial tax rates for restaurant food and beverage.
//
// These rates apply to the "prepared food, restaurant meals, and
// beverages" category specifically — not all goods. Some provinces
// (BC, MB, SK) have PST/RST that does NOT apply to restaurant food,
// so the effective rate is GST only.
//
// Rates verified for 2025/2026. Update when CRA / provincial finance
// authorities change them.
//
// Province codes follow ISO 3166-2:CA. Server stores either the
// 2-letter code ("ON") or the full name ("Ontario") on
// `restaurants.province`. Helper normalizes both inputs.

export interface ProvincialTax {
  /** ISO 3166-2 2-letter code. */
  code: string;
  /** Effective combined tax rate applied to restaurant food (decimal). */
  rate: number;
  /** Display label shown on cart line, e.g. "HST 13%". */
  label: string;
  /** Human-readable province name. */
  fullName: string;
}

const PROVINCES: Record<string, ProvincialTax> = {
  AB: { code: "AB", rate: 0.05,    label: "GST 5%",            fullName: "Alberta" },
  BC: { code: "BC", rate: 0.05,    label: "GST 5%",            fullName: "British Columbia" },
  MB: { code: "MB", rate: 0.05,    label: "GST 5%",            fullName: "Manitoba" },
  NB: { code: "NB", rate: 0.15,    label: "HST 15%",           fullName: "New Brunswick" },
  NL: { code: "NL", rate: 0.15,    label: "HST 15%",           fullName: "Newfoundland and Labrador" },
  NS: { code: "NS", rate: 0.14,    label: "HST 14%",           fullName: "Nova Scotia" },
  NT: { code: "NT", rate: 0.05,    label: "GST 5%",            fullName: "Northwest Territories" },
  NU: { code: "NU", rate: 0.05,    label: "GST 5%",            fullName: "Nunavut" },
  ON: { code: "ON", rate: 0.13,    label: "HST 13%",           fullName: "Ontario" },
  PE: { code: "PE", rate: 0.15,    label: "HST 15%",           fullName: "Prince Edward Island" },
  QC: { code: "QC", rate: 0.14975, label: "GST + QST 14.975%", fullName: "Quebec" },
  SK: { code: "SK", rate: 0.05,    label: "GST 5%",            fullName: "Saskatchewan" },
  YT: { code: "YT", rate: 0.05,    label: "GST 5%",            fullName: "Yukon" },
};

// Full-name → code lookup so DB rows storing "Ontario" still resolve.
const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.values(PROVINCES).map((p) => [p.fullName.toLowerCase(), p.code]),
);

/**
 * Resolve a province string (code or full name) to its tax info.
 * Falls back to Ontario (HST 13%) when unknown — matches the legacy
 * default used across the app.
 */
export function getProvincialTax(province: string | null | undefined): ProvincialTax {
  if (!province) return PROVINCES.ON;
  const trimmed = province.trim();
  if (!trimmed) return PROVINCES.ON;
  const upper = trimmed.toUpperCase();
  if (PROVINCES[upper]) return PROVINCES[upper];
  const fromName = NAME_TO_CODE[trimmed.toLowerCase()];
  if (fromName && PROVINCES[fromName]) return PROVINCES[fromName];
  return PROVINCES.ON;
}

/** Convenience: just the rate. */
export function getTaxRate(province: string | null | undefined): number {
  return getProvincialTax(province).rate;
}

/** Convenience: just the label, e.g. "HST 13%". */
export function getTaxLabel(province: string | null | undefined): string {
  return getProvincialTax(province).label;
}
