// Format a Stripe card brand for display. Stripe returns lowercase
// codes (`visa`, `mastercard`, `amex`, etc.); we normalize to the
// title-case strings the marketing pages + email receipts use.
//
// Returns "Card" when no brand is provided (Stripe sometimes leaves
// `brand` null for unbranded test cards).

export function formatBrand(brand: string | null | undefined): string {
  if (!brand) return "Card";
  const lower = brand.toLowerCase();
  if (lower === "visa") return "Visa";
  if (lower === "mastercard") return "Mastercard";
  if (lower === "amex" || lower === "american_express" || lower === "american express") return "Amex";
  if (lower === "discover") return "Discover";
  if (lower === "unionpay") return "UnionPay";
  if (lower === "jcb") return "JCB";
  if (lower === "diners") return "Diners";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}
