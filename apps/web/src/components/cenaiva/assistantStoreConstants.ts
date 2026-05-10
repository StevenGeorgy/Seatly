import type { BookingState } from "@cenaiva/assistant";

// Statuses where the assistant should NOT auto-reopen the mic after a turn.
// Mirrors mobile (lib/cenaiva/CenaivaAssistantProvider.tsx). Web previously
// gated only `offering_preorder`/`browsing_menu`; expanding this set fixes
// the regression where the mic reopened during checkout/tipping/payment.
//
// `post_booking` is INTENTIONALLY EXCLUDED here: the user has just been shown
// their reservation card and may immediately want to say "modify it" /
// "cancel it" / "show me my next one" — gating the mic forced them to click
// to talk again, which broke the voice-first flow. Checkout / payment / menu
// statuses still gate the mic because button taps are faster there and the
// mic could pick up card-entry chatter.
export const NO_AUTO_RELISTEN_STATUSES: ReadonlySet<BookingState["status"]> = new Set([
  "offering_preorder",
  "browsing_menu",
  "reviewing_cart",
  "choosing_tip_timing",
  "choosing_tip_amount",
  "choosing_payment_split",
  "charging",
  "paid",
]);

export const RELISTEN_AFTER_RESPONSE_MS = 260;
