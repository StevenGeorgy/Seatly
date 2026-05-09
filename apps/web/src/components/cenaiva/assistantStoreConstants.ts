import type { BookingState } from "@cenaiva/assistant";

// Statuses where the assistant should NOT auto-reopen the mic after a turn.
// Mirrors mobile (lib/cenaiva/CenaivaAssistantProvider.tsx). Web previously
// gated only `offering_preorder`/`browsing_menu`; expanding this set fixes
// the regression where the mic reopened during checkout/tipping/payment.
export const NO_AUTO_RELISTEN_STATUSES: ReadonlySet<BookingState["status"]> = new Set([
  "offering_preorder",
  "browsing_menu",
  "reviewing_cart",
  "choosing_tip_timing",
  "choosing_tip_amount",
  "choosing_payment_split",
  "charging",
  "paid",
  "post_booking",
]);

export const RELISTEN_AFTER_RESPONSE_MS = 260;
