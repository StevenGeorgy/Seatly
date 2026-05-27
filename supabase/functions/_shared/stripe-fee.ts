// Stripe + Cenaiva platform-fee policy — "Option B" (visible-fees model).
//
// The diner pays the deposit/order PLUS two visible add-on fees:
//   1. Cenaiva platform fee (2% of FOOD only — not tax, not tip)
//   2. Stripe processing fee (2.9% + 30¢ CAD of the grossed-up total)
//
// At checkout the cart shows: Deposit · Tax · Platform fee · Processing fee.
// Total charged to the diner = food + tax + cenaivaFee + processingFee.
//
// FEE-ROUTING MECHANISM (verified against Stripe docs, 2026-05-27):
// Destination charges ALWAYS make the platform pay the Stripe fee — no
// setting (including `on_behalf_of`) changes that. To honor the philosophy
// "diner covers everything, Cenaiva nets exactly 2%, restaurant nets
// exactly food+tax", we set `application_fee_amount = cenaivaFee +
// processingFee` so the platform pulls back enough from the connected
// account to absorb Stripe's actual debit. Math:
//   - Charge captured on platform: dinerTotal
//   - Connected (restaurant) receives initially: dinerTotal
//   - Application fee transferred back to platform: cenaivaFee + processingFee
//   - Connected nets: dinerTotal − (cenaivaFee + processingFee) = food + tax ✓
//   - Stripe fee debited from platform balance: ~processingFee
//   - Platform nets: (cenaivaFee + processingFee) − processingFee = cenaivaFee ✓
//
// On refund (any path — Seated, Cancel, Modify-shrink): the diner gets
// the food+tax back (refund_application_fee: false in stripe-refund.ts —
// Cenaiva keeps the full app fee, including the processing-fee portion;
// the disclosed "Platform fee" + "Processing fee" lines are non-refundable
// per the visible-fees disclosure shown at checkout).
//
// Why this model?
//   - Diner sees every line item before paying.
//   - Restaurant always nets 100% of food + tax (no commission haircut).
//   - Cenaiva margin is constant: 2% of food on every transaction.
//   - Tax (HST/GST) passes through cleanly to the restaurant.
//
// Math (per row, integer cents):
//   cenaivaFee     = max(round(foodCents * 0.02), 1)            // commission on food only
//   subtotal       = foodCents + taxCents + cenaivaFee
//   dinerTotal     = ceil((subtotal + 30) / 0.971)              // grossed up for Stripe
//   processingFee  = dinerTotal − subtotal
//   applicationFee = cenaivaFee + processingFee                 // absorbs Stripe debit
//
// Example for $3 food + $0.39 HST (Ontario):
//   cenaivaFee     = $0.06 (2% of $3)
//   subtotal       = $3.45
//   dinerTotal     = ceil((345 + 30) / 0.971) = 387¢ = $3.87
//   processingFee  = $0.42
//   applicationFee = $0.06 + $0.42 = $0.48
//   Diner sees: Food $3.00 + Tax $0.39 + Platform fee $0.06 + Processing fee $0.42 = $3.87

export const STRIPE_CARD_PERCENT = 0.029;
export const STRIPE_CARD_FIXED_CENTS = 30; // $0.30 CAD
export const PLATFORM_FEE_PERCENT = 0.02; // 2% (of food only)

export interface DinerCharge {
  /** Food-only portion (commission base). */
  foodCents: number;
  /** Tax portion (passes through to restaurant, no commission). */
  taxCents: number;
  /** Restaurant's net = foodCents + taxCents. */
  baseCents: number;
  /** Cenaiva platform fee — 2% of food only. Visible line item. */
  cenaivaFeeCents: number;
  /** Stripe processing fee — visible line item. */
  processingFeeCents: number;
  /** What the diner's card is charged: food + tax + cenaivaFee + processingFee. */
  dinerTotalCents: number;
  /**
   * `application_fee_amount` on the PaymentIntent.
   * Equals cenaivaFee + processingFee — sized so the platform's app-fee
   * pull-back absorbs Stripe's actual fee debit, leaving Cenaiva with
   * exactly cenaivaFee net.
   */
  applicationFeeCents: number;
  /** Always true in Option B — kept for callers/UI that check the flag. */
  dinerPaysFee: boolean;
}

/**
 * Compute the diner-pays-all-fees charge.
 *
 * @param foodCents  the commission-bearing portion (food / deposit / pre-order subtotal)
 * @param taxCents   the tax portion (HST/GST) that passes through to the
 *                   restaurant. Cenaiva does NOT take commission on tax.
 *
 * Caller passes:
 *   - `dinerTotalCents` as the PaymentIntent `amount`
 *   - `applicationFeeCents` as `application_fee_amount`
 *
 * The cart UI shows four lines (food · tax · cenaivaFeeCents · processingFeeCents)
 * adding up to dinerTotalCents.
 */
export function computeDinerCharge(foodCents: number, taxCents: number = 0): DinerCharge {
  const food = Math.max(0, Math.round(Number.isFinite(foodCents) ? foodCents : 0));
  const tax = Math.max(0, Math.round(Number.isFinite(taxCents) ? taxCents : 0));
  if (food + tax <= 0) {
    return {
      foodCents: 0,
      taxCents: 0,
      baseCents: 0,
      cenaivaFeeCents: 0,
      processingFeeCents: 0,
      dinerTotalCents: 0,
      applicationFeeCents: 0,
      dinerPaysFee: false,
    };
  }
  // Stripe rejects application_fee_amount < 1¢; clamp at 1¢ for tiny food bases.
  // For tax-only or zero-food edge cases, still emit 1¢ commission so the
  // app_fee path is exercised consistently.
  const cenaivaFee = food > 0 ? Math.max(Math.round(food * PLATFORM_FEE_PERCENT), 1) : 0;
  const subtotal = food + tax + cenaivaFee;
  // Gross-up so Stripe's 2.9% + 30¢ comes off the top of dinerTotal,
  // leaving exactly `subtotal` (= food + tax + cenaivaFee) to settle.
  const dinerTotal = Math.ceil(
    (subtotal + STRIPE_CARD_FIXED_CENTS) / (1 - STRIPE_CARD_PERCENT),
  );
  const processingFee = dinerTotal - subtotal;
  return {
    foodCents: food,
    taxCents: tax,
    baseCents: food + tax,
    cenaivaFeeCents: cenaivaFee,
    processingFeeCents: processingFee,
    dinerTotalCents: dinerTotal,
    // KEY: app_fee absorbs the Stripe-fee gross-up so the routing math
    // ends up: connected nets food+tax exactly, platform nets cenaivaFee.
    applicationFeeCents: cenaivaFee + processingFee,
    dinerPaysFee: true,
  };
}
