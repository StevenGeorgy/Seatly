import { z } from "zod";

import { BoundedText, Uuid } from "./base.ts";

// PaymentIntent ID format: stripe namespaces with the `pi_` prefix and
// limits the random body to alphanumerics + underscores. We accept
// optional/nullable because some failed-transaction flows didn't get
// far enough to mint a PI.
const PaymentIntentId = BoundedText(120)
  .regex(/^pi_[A-Za-z0-9_]+$/, "payment_intent_id must look like 'pi_…'");

export const RequestRefundSchema = z.object({
  reservation_id: Uuid,
  payment_intent_id: PaymentIntentId.nullish(),
  reason_code: z.enum(["duplicate", "failed", "other"]),
  reason_text: BoundedText(2000).nullish(),
});

export type RequestRefundInput = z.infer<typeof RequestRefundSchema>;
