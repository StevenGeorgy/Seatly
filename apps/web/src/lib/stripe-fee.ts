// Client mirror of supabase/functions/_shared/stripe-fee.ts.
// Server is the source of truth — this is only for cart display.
//
// Option B (visible-fees model): diner pays food + tax + Cenaiva 2% (on
// food only) + Stripe fee as visible line items. Refund returns
// food + tax — Cenaiva and Stripe fees are non-refundable, disclosed at
// checkout.

export const STRIPE_CARD_PERCENT = 0.029;
export const STRIPE_CARD_FIXED_CENTS = 30;
export const PLATFORM_FEE_PERCENT = 0.02;

export interface DinerCharge {
  foodCents: number;
  taxCents: number;
  baseCents: number;
  cenaivaFeeCents: number;
  processingFeeCents: number;
  dinerTotalCents: number;
  applicationFeeCents: number;
  /** Always true in Option B — kept for callers that check the flag. */
  dinerPaysFee: boolean;
}

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
  const cenaivaFee = food > 0 ? Math.max(Math.round(food * PLATFORM_FEE_PERCENT), 1) : 0;
  const subtotal = food + tax + cenaivaFee;
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
    applicationFeeCents: cenaivaFee + processingFee,
    dinerPaysFee: true,
  };
}
