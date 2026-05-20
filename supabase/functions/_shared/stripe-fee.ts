// Stripe processing-fee policy.
//
// Threshold-based pass-through (2026-05-20). The diner pays Stripe's
// processing fee on top of the deposit/pre-order/order total ONLY when
// the base amount is below the breakeven point. At or above breakeven,
// Cenaiva absorbs the Stripe fee out of its 5.5% commission.
//
// Why a threshold?
//   - Small charges (< $11.54): Stripe's $0.30 fixed fee + 2.9% eats more
//     than Cenaiva's 5.5% commission. If Cenaiva absorbed, we'd lose money
//     per transaction. So we gross up — the diner sees a "Processing fee"
//     line and pays it. We keep our full 5.5%.
//   - Larger charges (>= $11.54): 5.5% commission is bigger than Stripe's
//     fee, so Cenaiva can absorb the fee and still profit. The diner sees
//     a clean total with no surprise add-on — better UX, matches industry
//     standard (Resy, OpenTable, Tock, etc.).
//
// Breakeven math:
//   commission = 0.055 * base
//   stripe_fee = 0.029 * base + 0.30
//   net = commission - stripe_fee = 0.026 * base - 0.30
//   net >= 0  →  base >= $11.54
//
// We use $12 (1200¢) as the threshold instead of $11.54 to give Cenaiva
// a small positive margin at the boundary (~$0.31 at exactly $12).
//
// Stripe Canada card fee = 2.9% of the charged amount + $0.30 CAD per
// successful charge. Gross-up formula:
//   diner_total - (0.029 * diner_total + 0.30) = base
//   diner_total = (base + 0.30) / 0.971
//
// Application fee stays at 5.5% of base regardless of which branch.
// All amounts in integer cents.

export const STRIPE_CARD_PERCENT = 0.029;
export const STRIPE_CARD_FIXED_CENTS = 30; // $0.30 CAD
export const PLATFORM_FEE_PERCENT = 0.055; // 5.5%
/**
 * Breakeven threshold in cents. Below this, gross up so the diner pays
 * Stripe's fee. At or above, Cenaiva absorbs the fee. $12 CAD = 1200¢.
 */
export const ABSORB_FEE_THRESHOLD_CENTS = 1200;

export interface DinerCharge {
  /** Original deposit/order amount before any fee adjustment. */
  baseCents: number;
  /** What the diner actually pays at checkout (base + processing fee if grossed up, else just base). */
  dinerTotalCents: number;
  /** "Processing fee" line. Zero when Cenaiva absorbs (base >= threshold). */
  processingFeeCents: number;
  /** application_fee_amount on the PaymentIntent — 5.5% of the BASE either way. */
  applicationFeeCents: number;
  /** When true, the diner is paying Stripe's fee via gross-up. UI shows the fee line. */
  dinerPaysFee: boolean;
}

/**
 * Compute the diner-pays-Stripe-fee charge from a base amount.
 *
 * Caller is responsible for using `dinerTotalCents` as the PaymentIntent
 * `amount` and `applicationFeeCents` as `application_fee_amount`.
 *
 * Below the breakeven threshold ($12), grosses up so the diner pays the
 * Stripe processing fee on top. At or above the threshold, returns the
 * base unchanged — Cenaiva absorbs the Stripe fee out of its 5.5% cut.
 */
export function computeDinerCharge(baseCents: number): DinerCharge {
  if (!Number.isFinite(baseCents) || baseCents <= 0) {
    return {
      baseCents: 0,
      dinerTotalCents: 0,
      processingFeeCents: 0,
      applicationFeeCents: 0,
      dinerPaysFee: false,
    };
  }
  const base = Math.round(baseCents);
  // Stripe rejects application_fee_amount < 1¢; guard at 1¢ for tiny bases.
  const applicationFee = Math.max(Math.round(base * PLATFORM_FEE_PERCENT), 1);

  if (base >= ABSORB_FEE_THRESHOLD_CENTS) {
    // Above breakeven — Cenaiva absorbs Stripe's fee. Diner pays exactly
    // the base; Stripe takes its fee out of the platform's slice (which
    // shrinks our 5.5% commission take but stays positive).
    return {
      baseCents: base,
      dinerTotalCents: base,
      processingFeeCents: 0,
      applicationFeeCents: applicationFee,
      dinerPaysFee: false,
    };
  }

  // Below breakeven — gross up so the diner pays Stripe's fee. Otherwise
  // we'd lose money on the transaction. ceil() bias of at most 1¢ in our
  // favour to cover the recursive bump from charging on the higher amount.
  const grossed = Math.ceil(
    (base + STRIPE_CARD_FIXED_CENTS) / (1 - STRIPE_CARD_PERCENT),
  );
  const processingFee = grossed - base;
  return {
    baseCents: base,
    dinerTotalCents: grossed,
    processingFeeCents: processingFee,
    applicationFeeCents: applicationFee,
    dinerPaysFee: true,
  };
}
