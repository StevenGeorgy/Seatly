// payment.ts — schemas for Stripe-adjacent edge fns (attach/detach card,
// SetupIntent, refund, mark-order-paid). Phase C input-validation rollout
// (2026-05-20).

import { z } from "zod";
import { BoundedText, Uuid } from "./base.ts";

const PaymentIntentId = BoundedText(200).regex(
  /^pi_[A-Za-z0-9_]+$/,
  "payment_intent_id must start with pi_",
);

const PaymentMethodId = BoundedText(200).regex(
  /^pm_[A-Za-z0-9_]+$/,
  "payment_method_id must start with pm_",
);

const SetupIntentId = BoundedText(200).regex(
  /^seti_[A-Za-z0-9_]+$/,
  "setup_intent_id must start with seti_",
);

// stripe-attach-payment-method: accepts either a payment_intent_id (legacy
// booking-checkout path — diner just confirmed a PI and ticked "save card")
// OR a setup_intent_id (new /account flow — diner explicitly saving a card
// via SetupIntent without paying). Exactly one must be present.
export const StripeAttachPaymentMethodSchema = z
  .object({
    payment_intent_id: PaymentIntentId.optional(),
    setup_intent_id: SetupIntentId.optional(),
  })
  .refine(
    (v) => Boolean(v.payment_intent_id) !== Boolean(v.setup_intent_id),
    {
      message:
        "Pass exactly one of payment_intent_id or setup_intent_id (not both).",
    },
  );
export type StripeAttachPaymentMethodInput = z.infer<
  typeof StripeAttachPaymentMethodSchema
>;

// stripe-detach-method: { payment_method_id }
export const StripeDetachMethodSchema = z.object({
  payment_method_id: PaymentMethodId,
});
export type StripeDetachMethodInput = z.infer<
  typeof StripeDetachMethodSchema
>;

// stripe-setup-intent: { restaurant_id? } — Branch A targets the
// restaurant's customer, Branch B (no restaurant_id) targets the diner's
// own customer for saved-card flow.
export const StripeSetupIntentSchema = z.object({
  restaurant_id: Uuid.optional(),
});
export type StripeSetupIntentInput = z.infer<typeof StripeSetupIntentSchema>;

// refund-payment-intent: { payment_intent_id, reason? }
export const RefundPaymentIntentSchema = z.object({
  payment_intent_id: PaymentIntentId,
  reason: BoundedText(200).optional(),
});
export type RefundPaymentIntentInput = z.infer<
  typeof RefundPaymentIntentSchema
>;

// mark-order-paid: { order_id, payment_intent_id }
export const MarkOrderPaidSchema = z.object({
  order_id: Uuid,
  payment_intent_id: PaymentIntentId,
});
export type MarkOrderPaidInput = z.infer<typeof MarkOrderPaidSchema>;

// confirm-deposit-paid: { payment_id, payment_intent_id } — payment_id is
// the reservation_deposit_payments.id (UUID).
export const ConfirmDepositPaidSchema = z.object({
  payment_id: Uuid,
  payment_intent_id: PaymentIntentId,
});
export type ConfirmDepositPaidInput = z.infer<typeof ConfirmDepositPaidSchema>;

// create-public-payment-intent: creates a Stripe PaymentIntent for a diner
// to pay a deposit / pre-order. `amount_cents` is the FOOD-only base
// (commission-bearing). `tax_cents` is the pass-through HST/GST portion
// (no commission). Both are folded into the diner-pays-all-fees gross-up
// via computeDinerCharge(food, tax) on the server.
// NOTE: the edge fn currently does handcrafted validation; this schema is
// provided for future migration to parseJsonBody and for type sharing.
export const CreatePublicPaymentIntentSchema = z.object({
  restaurant_id: Uuid,
  amount_cents: z.number().int().nonnegative().max(10_000_000),
  tax_cents: z.number().int().nonnegative().max(10_000_000).optional(),
  saved_card_id: BoundedText(200).optional(),
  deposit_payment_ids: z.array(Uuid).max(16).optional(),
  hold_id: Uuid.optional(),
  save_card: z.boolean().optional(),
  idempotency_key: BoundedText(240).optional(),
});
export type CreatePublicPaymentIntentInput = z.infer<
  typeof CreatePublicPaymentIntentSchema
>;

// confirm-modify-payment: finalizes a reservation modification AFTER the
// diner has paid the deposit delta via Stripe. Mirrors modify-reservation's
// auth shape (bearer OR confirmation_code + email).
//
// 2026-05-27: now supports two change_type branches:
//   - "party_delta" (default, legacy): finalize a slot/party-size change.
//     Requires date + time + party_size.
//   - "cart_delta": finalize a pre-order cart change. Reads the cart
//     snapshot from reservation_deposit_payments.pending_cart_snapshot
//     (JSONB) which modify-reservation stamped. date/time/party_size
//     are not required in this branch.
export const ConfirmModifyPaymentSchema = z
  .object({
    reservation_id: Uuid,
    deposit_payment_row_id: Uuid,
    payment_intent_id: PaymentIntentId,
    change_type: z.enum(["party_delta", "cart_delta"]).optional(),
    date: BoundedText(20)
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
      .optional(),
    time: BoundedText(10)
      .regex(/^([01]?\d|2[0-3]):[0-5]\d(\s?[apAP][mM])?$/, "invalid time")
      .optional(),
    party_size: z.number().int().min(1).max(30).optional(),
    special_request: BoundedText(500).optional(),
    // Guest path auth (mirrors modify-reservation). Ignored when a valid
    // bearer token is present.
    confirmation_code: BoundedText(40).optional(),
    email: BoundedText(254).optional(),
  })
  .refine(
    (b) => {
      if (b.change_type === "cart_delta") return true;
      // Default branch (party_delta) requires the slot fields.
      return (
        b.date !== undefined &&
        b.time !== undefined &&
        b.party_size !== undefined
      );
    },
    {
      message: "date, time and party_size are required for party_delta",
      path: ["date"],
    },
  );
export type ConfirmModifyPaymentInput = z.infer<
  typeof ConfirmModifyPaymentSchema
>;
