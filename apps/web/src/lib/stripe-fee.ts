// Client mirror of supabase/functions/_shared/stripe-fee.ts.
// Server is the source of truth — this is only for cart display.
//
// Option B (visible-fees model): diner pays base + Cenaiva 2.2% + Stripe fee
// as three visible line items. Refund returns the base only — both fees
// are non-refundable and disclosed at checkout.

export const STRIPE_CARD_PERCENT = 0.029;
export const STRIPE_CARD_FIXED_CENTS = 30;
export const PLATFORM_FEE_PERCENT = 0.022;

export interface DinerCharge {
  baseCents: number;
  cenaivaFeeCents: number;
  processingFeeCents: number;
  dinerTotalCents: number;
  applicationFeeCents: number;
  /** Always true in Option B — kept for callers that check the flag. */
  dinerPaysFee: boolean;
}

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
  const cenaivaFee = Math.max(Math.round(base * PLATFORM_FEE_PERCENT), 1);
  const subtotal = base + cenaivaFee;
  const dinerTotal = Math.ceil(
    (subtotal + STRIPE_CARD_FIXED_CENTS) / (1 - STRIPE_CARD_PERCENT),
  );
  return {
    baseCents: base,
    cenaivaFeeCents: cenaivaFee,
    processingFeeCents: dinerTotal - subtotal,
    dinerTotalCents: dinerTotal,
    applicationFeeCents: cenaivaFee,
    dinerPaysFee: true,
  };
}
