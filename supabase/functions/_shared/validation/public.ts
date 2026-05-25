// public.ts — schemas for anon-callable diner / marketing surfaces.
// Phase C input-validation rollout (2026-05-20).

import { z } from "zod";
import { BoundedText, Uuid } from "./base.ts";

// validate-referral-code: { code }
// Accepts 1-50 chars; the function normalizes + regex-checks downstream
// and returns { valid: false } for any non-match. We keep the schema
// permissive on length so normalization (uppercase + trim) still
// produces "valid: false" rather than a 400 for typo-shape inputs.
export const ValidateReferralCodeSchema = z.object({
  code: BoundedText(50).optional(),
});
export type ValidateReferralCodeInput = z.infer<
  typeof ValidateReferralCodeSchema
>;

// find-reservation: dual-path lookup. The handler enforces
// `lookup_type === 'code' | 'contact'` and per-path required fields
// (and uses asText() to defensively trim inputs). We keep the schema
// permissive on shape — BoundedText for email/code so malformed
// values still pass through to the handler's existing 400 responses
// instead of triggering a Zod "Validation failed" frame the
// marketing client doesn't branch on.
export const FindReservationSchema = z.object({
  lookup_type: BoundedText(20).optional(),
  code: BoundedText(40).optional(),
  email: BoundedText(254).optional(),
  last_name: BoundedText(120).optional(),
  phone: BoundedText(40).optional(),
  confirmation_code: BoundedText(40).optional(),
});
export type FindReservationInput = z.infer<typeof FindReservationSchema>;

// get-deposit-payment-context: { payment_id }
export const GetDepositPaymentContextSchema = z.object({
  payment_id: Uuid,
});
export type GetDepositPaymentContextInput = z.infer<
  typeof GetDepositPaymentContextSchema
>;

// get-order-public: { order_id } (body path only — query path uses
// the URL parser). order_id is optional because the handler may fall
// back to the URL search-param.
export const GetOrderPublicSchema = z.object({
  order_id: Uuid.optional(),
});
export type GetOrderPublicInput = z.infer<typeof GetOrderPublicSchema>;

// loyalty-waitlist-signup: { email, source? }. We deliberately do NOT
// run email through EmailLower here — the handler returns a specific
// "Please enter a valid email address." error message that the
// marketing page branches on; preserve that behavior by accepting any
// bounded string at the gate and letting the legacy validation run.
// Source is a campaign tag (alphanumeric / dash / underscore, 1-64
// chars); we accept the looser BoundedText shape here and let the
// function regex-check on top — preserves the existing "invalid
// source = silently drop" UX.
export const LoyaltyWaitlistSignupSchema = z.object({
  email: BoundedText(254).optional(),
  source: BoundedText(64).optional(),
});
export type LoyaltyWaitlistSignupInput = z.infer<
  typeof LoyaltyWaitlistSignupSchema
>;

// submit-demo-request: form payload from the marketing /book-demo
// page. Keep email/phone loose (BoundedText) so the handler's
// existing field-specific 400 messages remain the source of truth.
// The 200/30/200/2000 caps still cut off abusive payloads at the gate.
export const SubmitDemoRequestSchema = z.object({
  // .nullish() — the client sends `field || null` for empty optional fields,
  // so the schema must accept both undefined and null. Plain .optional() only
  // permits undefined and would 400 on every form submission that left an
  // optional field blank.
  name: BoundedText(200).nullish(),
  email: BoundedText(320).nullish(),
  phone: BoundedText(30).nullish(),
  restaurant_name: BoundedText(200).nullish(),
  message: BoundedText(2000).nullish(),
});
export type SubmitDemoRequestInput = z.infer<typeof SubmitDemoRequestSchema>;
