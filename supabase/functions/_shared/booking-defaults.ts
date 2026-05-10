// @ts-nocheck
// Server-side defaults that mirror lib/booking/bookingDefaults.ts on the
// client. Edge functions should import from here rather than re-declaring
// `?? 90` / `?? 30` / `?? "UTC"` etc. inline.

export const DEFAULT_TURN_MINUTES = 90;
export const DEFAULT_SLOT_DURATION_MINUTES = 30;
export const DEFAULT_TIMEZONE = "UTC";
export const DEFAULT_CURRENCY = "CAD";
export const DEFAULT_MAX_COVERS = 100;
export const DEFAULT_MAX_PARTY_SIZE = 20;
export const DEFAULT_MIN_PARTY_SIZE = 1;
export const DEFAULT_ADVANCE_BOOKING_DAYS = 30;
export const DEFAULT_SERVICE_START = "17:00";
export const DEFAULT_SERVICE_END = "23:00";

// Deprecated: do not rely on this fallback. The `restaurants.tax_rate`
// column is the source of truth; if NULL, the call site should surface a
// configuration error and refuse to proceed rather than silently applying
// 13% to a restaurant in QC/AB/BC/etc.
export const DEFAULT_TAX_RATE_FALLBACK = 0.13;
