// Shared Stripe refund helper. Used by:
//   - refund-payment-intent (race-recovery: card charged, reservation write failed)
//   - cancel-reservation (diner cancels a paid pre-order or charged deposit)
//
// Both call sites use `npm:stripe@17` directly (apiVersion 2024-11-20.acacia)
// and need identical retry/idempotency behavior. Pass an already-constructed
// Stripe client so the caller controls SDK version + secret resolution.
//
// Why no reverse_transfer / refund_application_fee here: Cenaiva uses
// destination charges (`transfer_data.destination = stripe_account_id`).
// With both flags defaulting to false, Stripe pulls the refund amount from
// the connected restaurant account while the 5% application fee stays with
// Cenaiva. If product later wants to return the fee on cancel, flip
// refund_application_fee at the call site or extend the helper signature.

import type Stripe from "npm:stripe@17";

export type RefundOutcome =
  | { ok: true; refund_id: string; amount: number; status: string | null }
  | { ok: false; error: string; code?: string };

export async function refundPaymentIntent(
  stripe: Stripe,
  paymentIntentId: string,
  reason: string,
  amountCents?: number,
): Promise<RefundOutcome> {
  try {
    const refundParams: Record<string, unknown> = {
      payment_intent: paymentIntentId,
      reason: "requested_by_customer",
      metadata: { cenaiva_reason: reason },
    };
    // When amountCents is provided, do a partial refund. Used by Phase 8
    // (modify-reservation deposit recalc) when the party size shrinks
    // and only a portion of the deposit needs to be returned. Omit the
    // amount for a full refund (the default Phase 5 cancel flow).
    if (typeof amountCents === "number" && amountCents > 0) {
      refundParams.amount = amountCents;
    }
    const refund = await stripe.refunds.create(refundParams);
    return {
      ok: true,
      refund_id: refund.id,
      amount: refund.amount,
      status: refund.status,
    };
  } catch (err) {
    // Idempotent backstop: a retried cancel after Stripe succeeded but our
    // DB UPDATE failed would hit `charge_already_refunded`. Treat as success
    // so the caller can mark the row as 'refunded' without surfacing a user
    // error.
    const code = (err as { code?: string }).code;
    if (code === "charge_already_refunded") {
      return { ok: true, refund_id: "", amount: 0, status: "already_refunded" };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code,
    };
  }
}
