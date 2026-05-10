// @ts-nocheck
// Reservation confirmation code generator. Previously two functions had
// two implementations:
//   - _shared/booking.ts: 4 chars base36 (~1.7M codes — collision-prone)
//   - create-public-booking/index.ts: 6 chars Crockford-like
// Use the longer 6-char Crockford alphabet everywhere; the DB
// `reservations.confirmation_code` column should be UNIQUE so we can
// retry on the rare collision rather than trust uniqueness blindly.
//
// Legacy codes from earlier builds use the prefixes `SEAT-`, `PRE-`,
// `CEN-XXXX` (4 chars), and `CNV-NNNNNN` (digits). They are stored as-is
// in `reservations.confirmation_code` / `orders.confirmation_code` and
// remain valid for lookup — only NEW codes are generated with the
// CEN- prefix below. Use `isValidConfirmationCode(code)` if you need to
// accept any legacy variant.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
const PREFIX = "CEN";
const LENGTH = 6;

export function makeConfirmationCode(): string {
  let code = `${PREFIX}-`;
  for (let i = 0; i < LENGTH; i += 1) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

export function isValidConfirmationCode(code: string): boolean {
  return /^(CEN|SEAT|PRE|CNV)-[A-Z0-9]{4,8}$/i.test(code.trim());
}
