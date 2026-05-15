// Phase 2 of diner auth overhaul (2026-05-15): light phone-number
// normalization for the OTP signup flow. We deliberately do NOT pull in
// libphonenumber-js (100 KB+ gzip) because the vast majority of Cenaiva
// signups will be Canadian/US numbers — a regex + country-code prefix
// covers that cleanly. International diners who paste an E.164 number
// with a leading `+` pass through unchanged.
//
// Stripe Twilio + Supabase Auth both accept E.164 format (`+15551234567`),
// so we always normalize to that shape before calling `signInWithOtp`.

/**
 * Strip every non-digit character. If the result has 10 digits, assume
 * North American and prefix with `+1`. If 11 and starts with `1`,
 * prefix with `+`. If the input already started with `+`, preserve the
 * full international format.
 *
 * Returns the normalized E.164 string, or `null` if the input doesn't
 * look like a phone number we can safely send to Twilio.
 */
export function normalizeE164Phone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Preserve explicit international format.
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    // Minimum 7 digits to be plausibly real (per ITU E.164). Max 15.
    if (digits.length < 7 || digits.length > 15) return null;
    return `+${digits}`;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) {
    // NA-style: 416 555 1234 → +14165551234
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    // NA with the 1 prefix: 14165551234 → +14165551234
    return `+${digits}`;
  }
  // 7-digit local, 12+ digit unknown country — reject. The user can
  // paste with a leading `+` to be explicit.
  return null;
}

/**
 * Quick "looks like a 6-digit OTP code" check. Twilio + Supabase both
 * use 6-digit numeric codes by default.
 */
export function isValidOtpCode(value: string): boolean {
  return /^\d{6}$/.test(value.trim());
}

/**
 * Display formatter for E.164: `+14165551234` → `+1 (416) 555-1234`.
 * Only formats NA-style numbers. Other regions show as `+CC XXXX...`.
 */
export function formatE164ForDisplay(e164: string): string {
  if (!e164.startsWith("+")) return e164;
  const digits = e164.slice(1);
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return e164;
}
