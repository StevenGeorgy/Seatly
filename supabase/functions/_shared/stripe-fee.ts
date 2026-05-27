// Stripe + Cenaiva platform-fee policy — "Option B" (visible-fees model).
//
// The diner pays the deposit/order PLUS two visible add-on fees:
//   1. Cenaiva platform fee (2.2% of base)
//   2. Stripe processing fee (2.9% + 30¢ CAD of the grossed-up total)
//
// At checkout the cart shows three line items: Deposit · Platform fee ·
// Processing fee. Total charged to the diner = base + cenaivaFee +
// processingFee. Restaurant Connect ends up net 100% of the base (no
// silent commission haircut). Cenaiva keeps the visible 2%. Stripe
// keeps its processing fee.
//
// On refund (any path — Seated, Cancel, Modify-shrink): the diner gets
// the BASE back. The two fees were disclosed upfront and are
// non-refundable. See _shared/refund-math.ts.
//
// Why this model?
//   - Total transparency — no hidden costs, refund amount matches the
//     "deposit" label the diner saw at booking.
//   - Restaurant always nets 100% of the deposit value (cleanest UX for
//     them too — no surprise commission deduction).
//   - Cenaiva margin is constant: 2% of every transaction.
//   - Matches marketplace pattern (Airbnb, Eventbrite, StubHub) — diners
//     are trained to expect visible service fees.
//
// Math (per row, integer cents):
//   cenaivaFee     = max(round(base * 0.022), 1)              // visible
//   subtotal       = base + cenaivaFee
//   dinerTotal     = ceil((subtotal + 30) / 0.971)             // grossed up
//   processingFee  = dinerTotal − subtotal                     // visible
//   applicationFee = cenaivaFee  // routed to platform via Stripe
//
// Example for $20 deposit:
//   cenaivaFee     = $0.44
//   subtotal       = $20.44
//   dinerTotal     = ceil((2044 + 30) / 0.971) = $21.37
//   processingFee  = $21.37 − $20.44 = $0.93
//   Diner sees: Deposit $20.00 + Platform fee $0.44 + Processing $0.93 = $21.37

export const STRIPE_CARD_PERCENT = 0.029;
export const STRIPE_CARD_FIXED_CENTS = 30; // $0.30 CAD
export const PLATFORM_FEE_PERCENT = 0.022; // 2.2%

export interface DinerCharge {
  /** Original deposit/order amount (the refundable portion). */
  baseCents: number;
  /** Cenaiva platform fee — 2.2% of base. Visible line item. */
  cenaivaFeeCents: number;
  /** Stripe processing fee — visible line item. */
  processingFeeCents: number;
  /** What the diner's card is charged: base + cenaivaFee + processingFee. */
  dinerTotalCents: number;
  /** `application_fee_amount` on the PaymentIntent — equals cenaivaFeeCents. */
  applicationFeeCents: number;
  /** Always true in Option B — kept for callers/UI that check the flag. */
  dinerPaysFee: boolean;
}

/**
 * Compute the diner-pays-all-fees charge from a base amount.
 *
 * Caller passes:
 *   - `dinerTotalCents` as the PaymentIntent `amount`
 *   - `applicationFeeCents` as `application_fee_amount`
 *
 * The cart UI shows three lines (base · cenaivaFeeCents · processingFeeCents)
 * adding up to dinerTotalCents.
 */
export function computeDinerCharge(baseCents: number): DinerCharge {
  if (!Number.isFinite(baseCents) || baseCents <= 0) {
    return {
      baseCents: 0,
      cenaivaFeeCents: 0,
      processingFeeCents: 0,
      dinerTotalCents: 0,
      applicationFeeCents: 0,
      dinerPaysFee: false,
    };
  }
  const base = Math.round(baseCents);
  // Stripe rejects application_fee_amount < 1¢; clamp at 1¢ for tiny bases.
  const cenaivaFee = Math.max(Math.round(base * PLATFORM_FEE_PERCENT), 1);
  const subtotal = base + cenaivaFee;
  // Gross-up so Stripe's 2.9% + 30¢ comes off the top of dinerTotal,
  // leaving exactly `subtotal` (= base + cenaivaFee) to settle.
  const dinerTotal = Math.ceil(
    (subtotal + STRIPE_CARD_FIXED_CENTS) / (1 - STRIPE_CARD_PERCENT),
  );
  const processingFee = dinerTotal - subtotal;
  return {
    baseCents: base,
    cenaivaFeeCents: cenaivaFee,
    processingFeeCents: processingFee,
    dinerTotalCents: dinerTotal,
    applicationFeeCents: cenaivaFee,
    dinerPaysFee: true,
  };
}
