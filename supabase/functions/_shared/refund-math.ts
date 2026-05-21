// Refund policy — Option B (visible-fees model).
//
// Pricing (see _shared/stripe-fee.ts): diner pays base + Cenaiva 5.5% +
// Stripe gross-up at checkout, with each fee disclosed as its own line
// item.
//
// Refund rule: the diner gets back exactly the BASE (the "deposit" they
// saw on the cart). Both the Cenaiva platform fee and the Stripe
// processing fee are non-refundable and were disclosed upfront.
//
// Final settlement on refund:
//   Diner:      −cenaivaFee − stripeFee   (the fees they paid at checkout)
//   Cenaiva:    +cenaivaFee               (kept — disclosed platform fee)
//   Stripe:     +stripeFee                (kept — non-refundable processor cost)
//   Restaurant: $0                        (received `base`, refunded `base`)
//
// This policy is consistent across every refund trigger: Seated,
// Mark Arrived, auto-cron, Cancel, party-size shrink.

export type BreakEvenRefund = {
  refundCents: number;
  /** Kept for type-compat with prior callers. Always true under Option B. */
  aboveBreakEven: boolean;
  /** Always 0 under Option B (fee disclosure happens at checkout, not refund). */
  standaloneStripeFee: number;
  /** Always 0 under Option B (Cenaiva fee already kept). */
  standaloneCenaivaFee: number;
  /** Always 0 under Option B (caller doesn't need it). */
  dinerPaidForRow: number;
};

/**
 * Refund amount = the deposit/order base. Both fees are non-refundable.
 *
 * Despite the legacy name `computeBreakEvenRefund` (kept for caller
 * stability), there is no break-even branching under Option B — every
 * refund returns exactly the base.
 */
export function computeBreakEvenRefund(baseCents: number): BreakEvenRefund {
  const amount = Math.max(Math.floor(baseCents), 0);
  return {
    refundCents: amount,
    aboveBreakEven: true,
    standaloneStripeFee: 0,
    standaloneCenaivaFee: 0,
    dinerPaidForRow: 0,
  };
}
