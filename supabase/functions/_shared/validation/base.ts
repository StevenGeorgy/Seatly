import { z } from "zod";

// Permissive UUID format check. Zod 4's `.uuid()` enforces UUID v4 (the
// version nibble must be '4'), which rejects our seed restaurant IDs
// (e.g. `a1000006-1111-1111-1111-000000000006`) and any externally-issued
// non-v4 UUID. The DB doesn't care about the version byte — only the
// 8-4-4-4-12 hex shape — so we mirror that here. Single source of truth
// for every edge-function body schema.
const UUID_ANY_VERSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const Uuid = z
  .string()
  .regex(UUID_ANY_VERSION, "Must be a UUID");

export const NonEmptyText = (max: number) =>
  z.string().trim().min(1).max(max);

export const BoundedText = (max: number) =>
  z.string().trim().max(max);

export const EmailLower = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254);

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

export const E164Phone = z
  .string()
  .trim()
  .max(20)
  .regex(E164_REGEX, "Phone must be E.164 format (e.g. +14165551234)");

export const Money = z.number().finite().nonnegative().max(100000);

export const Percent01 = z.number().finite().min(0).max(100);

export const Iso8601 = z.string().datetime({ offset: true });

export const PositiveInt = (max: number) =>
  z.number().int().positive().max(max);

export const ConfirmationCode = z
  .string()
  .trim()
  .toUpperCase()
  // Matches the DB CHECK on reservations.confirmation_code. Allows the
  // `SEAT-XXXX` / `CEN-XXXX` etc. formats produced by book_reservation.
  .regex(/^[A-Z0-9-]{4,20}$/, "Invalid confirmation code format");

export const PromoCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{3,32}$/, "Invalid promo code format");
