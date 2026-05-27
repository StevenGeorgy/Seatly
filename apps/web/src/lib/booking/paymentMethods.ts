// 2026-05-28 — Card-display helpers for the diner-facing booking
// detail surfaces. Pulled out of BookingPaymentContactCard.tsx so the
// component file only exports the component (keeps react-refresh
// happy).

export type PaymentMethodDisplay = {
  key: string;
  label: string;
  context: string | null;
};

type PaymentMethodSource = {
  key: string;
  cardBrand: string | null;
  cardLast4: string | null;
  context: string | null;
};

/**
 * "Visa ending in 4242" when both brand+last4 are present; "Visa" when
 * only brand; "Card on file" when neither — keeps historical rows
 * (pre-2026-05-28, when stripe-webhook didn't populate the snapshot)
 * still presentable.
 */
export function formatCardLabel(
  brand: string | null,
  last4: string | null,
): string {
  if (!brand && !last4) return "Card on file";
  const niceBrand = brand
    ? brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase()
    : "Card";
  if (!last4) return niceBrand;
  return `${niceBrand} ending in ${last4}`;
}

/**
 * Dedupe payment-method sources on display label so two orders charged
 * to the same card collapse into one row in the UI. Context from the
 * first occurrence wins.
 */
export function formatPaymentMethods(
  sources: PaymentMethodSource[],
): PaymentMethodDisplay[] {
  const seen = new Map<string, PaymentMethodDisplay>();
  for (const s of sources) {
    const label = formatCardLabel(s.cardBrand, s.cardLast4);
    if (!seen.has(label)) {
      seen.set(label, { key: s.key, label, context: s.context });
    }
  }
  return [...seen.values()];
}
