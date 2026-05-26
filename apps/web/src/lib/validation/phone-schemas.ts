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

/**
 * Live "format as the user types" helper for North American phone
 * inputs. Strips non-digits, drops a leading "1" country code if the
 * user typed it, hard-caps at 10 NA digits, and returns a partial
 * formatted string matching whatever segment they've reached:
 *   ""           → ""
 *   "289"        → "+1 (289"
 *   "2894"       → "+1 (289) 4"
 *   "289400"     → "+1 (289) 400"
 *   "2894000883" → "+1 (289) 400-0883"
 *
 * Used by the shared <PhoneInput /> component so every phone form in
 * the app behaves identically.
 */
export function formatNorthAmericanAsTyping(raw: string): string {
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  // North American area codes never start with 0 or 1 (NANP rule), so
  // a leading "1" in the digit string can only be the "+1" display
  // prefix that the formatter re-injects each keystroke. Strip exactly
  // one "1" — this is what makes backspace work cleanly: on delete,
  // the input still contains "+1 (...)" and that leading 1 would
  // otherwise get re-absorbed as if it were part of the user's number,
  // scrambling every subsequent digit. We only strip one so that
  // numbers like "+1 (212) 111-1111" survive intact.
  if (digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  if (digits.length > 10) digits = digits.slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `+1 (${digits}`;
  if (digits.length <= 6) return `+1 (${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Strip a formatted NA phone string down to bare digits (no country
 * code), for callers that need the 10-digit form (e.g. trimming a
 * draft value before storing).
 */
export function extractNorthAmericanDigits(raw: string): string {
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits.slice(0, 10);
}
