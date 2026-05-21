// reservation-hold.ts — schemas for the reservation_holds lifecycle
// (create / update / heartbeat / cancel) and the post-payment confirm
// path. Phase C input-validation rollout (2026-05-20).

import { z } from "zod";
import { BoundedText, PositiveInt, Uuid } from "./base.ts";

// create-reservation-hold: anon-callable. The function calls the
// create_reservation_hold RPC; the RPC itself enforces table availability,
// cover cap, and double-book guards.
export const CreateReservationHoldSchema = z.object({
  restaurant_id: Uuid,
  shift_id: Uuid,
  // The handler defensively runs `new Date(date_time)` and rejects
  // non-finite values, so we keep this loose (BoundedText) and let
  // the handler's "date_time must be a valid ISO timestamp" 400
  // remain the canonical client-facing error. Strict Iso8601 here
  // would reject timezone-less formats that `new Date` accepts.
  date_time: BoundedText(64),
  party_size: PositiveInt(30),
  // .nullish() (not .optional()) — the client sends `null` for empty
  // event_id / promotion_id / applied_promo_code on the diner-checkout
  // path. Without nullish() the Zod schema 400s the pre-flight hold
  // create, which is non-fatal (checkout proceeds without a hold) but
  // pollutes the console and breaks the deferred-PI optimisation.
  source: BoundedText(40).nullish(),
  idempotency_key: BoundedText(128).nullish(),
  event_id: Uuid.nullish(),
  promotion_id: Uuid.nullish(),
  applied_promo_code: BoundedText(64).nullish(),
});
export type CreateReservationHoldInput = z.infer<
  typeof CreateReservationHoldSchema
>;

// update-reservation-hold: either diner fields, cart fields, or both.
// The handler enforces "at least one of …" downstream.
export const UpdateReservationHoldSchema = z.object({
  hold_id: Uuid,
  full_name: BoundedText(120).optional(),
  // Accept raw email/phone strings (the handler still normalizes via
  // toLowerCase / North-American digit-fixup). EmailLower would reject
  // already-uppercased entries pre-normalization — keep BoundedText so
  // we don't change the legacy behavior.
  email: BoundedText(254).optional(),
  phone: BoundedText(40).optional(),
  cart_snapshot: z.unknown().optional(),
  total_amount_cents: z.number().int().nonnegative().max(10_000_000).optional(),
  special_request: BoundedText(500).optional(),
  dietary_notes: BoundedText(500).optional(),
  occasion: BoundedText(100).optional(),
  seating_preference: BoundedText(200).optional(),
});
export type UpdateReservationHoldInput = z.infer<
  typeof UpdateReservationHoldSchema
>;

// heartbeat-reservation-hold: { hold_id, extend_seconds? }
export const HeartbeatReservationHoldSchema = z.object({
  hold_id: Uuid,
  // Server defaults to 120s if omitted/invalid. Cap upper bound to keep
  // a hostile client from extending forever in one shot.
  extend_seconds: z.number().int().positive().max(3600).optional(),
});
export type HeartbeatReservationHoldInput = z.infer<
  typeof HeartbeatReservationHoldSchema
>;

// cancel-reservation-hold: { hold_id }
export const CancelReservationHoldSchema = z.object({
  hold_id: Uuid,
});
export type CancelReservationHoldInput = z.infer<
  typeof CancelReservationHoldSchema
>;

// confirm-hold-paid: { hold_id, payment_intent_id }
export const ConfirmHoldPaidSchema = z.object({
  hold_id: Uuid,
  payment_intent_id: BoundedText(200).regex(
    /^pi_[A-Za-z0-9_]+$/,
    "payment_intent_id must start with pi_",
  ),
});
export type ConfirmHoldPaidInput = z.infer<typeof ConfirmHoldPaidSchema>;

// check-in-guest: { reservation_id }. Auth + role-check happen
// downstream of body parsing.
export const CheckInGuestSchema = z.object({
  reservation_id: Uuid,
});
export type CheckInGuestInput = z.infer<typeof CheckInGuestSchema>;

// close-bill: post-meal pay-the-bill close. Service-role write.
// Field shape mirrors the existing handler.
export const CloseBillSchema = z.object({
  order_id: Uuid,
  tip_amount: z.number().finite().nonnegative().max(10000).optional(),
  payment_method: BoundedText(40).optional(),
});
export type CloseBillInput = z.infer<typeof CloseBillSchema>;

// confirm-deposit-stub: STUB stripe deposit confirmation. Outcome
// defaults to 'charged'; 'failed' available for failure testing.
export const ConfirmDepositStubSchema = z.object({
  payment_id: Uuid,
  outcome: z.enum(["charged", "failed"]).optional(),
});
export type ConfirmDepositStubInput = z.infer<typeof ConfirmDepositStubSchema>;

