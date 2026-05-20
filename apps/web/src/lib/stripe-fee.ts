// Client-side mirror of supabase/functions/_shared/stripe-fee.ts so the
// checkout UI can preview the diner's grand total (base + Stripe fee) before
// hitting the edge function. Server is the source of truth — this is only
// for display.
//
// Threshold policy: below $12 base, diner pays Stripe's fee on top (gross-up).
// At or above $12 base, Cenaiva absorbs Stripe's fee out of its 5.5% cut and
// the diner sees a clean total. Keeps small bookings profitable for Cenaiva
// without surprising large-bill diners with a processing fee line.

export const STRIPE_CARD_PERCENT = 0.029;
export const STRIPE_CARD_FIXED_CENTS = 30;
export const PLATFORM_FEE_PERCENT = 0.055;
export const ABSORB_FEE_THRESHOLD_CENTS = 1200; // $12 CAD

export interface DinerCharge {
  baseCents: number;
  dinerTotalCents: number;
  processingFeeCents: number;
  applicationFeeCents: number;
  /** When true, UI should show the "Processing fee" line. */
  dinerPaysFee: boolean;
}

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
  const applicationFee = Math.max(Math.round(base * PLATFORM_FEE_PERCENT), 1);

  if (base >= ABSORB_FEE_THRESHOLD_CENTS) {
    return {
      baseCents: base,
      dinerTotalCents: base,
      processingFeeCents: 0,
      applicationFeeCents: applicationFee,
      dinerPaysFee: false,
    };
  }

  const grossed = Math.ceil(
    (base + STRIPE_CARD_FIXED_CENTS) / (1 - STRIPE_CARD_PERCENT),
  );
  return {
    baseCents: base,
    dinerTotalCents: grossed,
    processingFeeCents: grossed - base,
    applicationFeeCents: applicationFee,
    dinerPaysFee: true,
  };
}
