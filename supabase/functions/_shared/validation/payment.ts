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
