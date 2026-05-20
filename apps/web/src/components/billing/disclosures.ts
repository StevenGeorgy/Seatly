// Disclosure copy for the owner-billing UI.
//
// Phase 3 (2026-05-20 lifecycle rework) decouples "save a card" from
// "start the 90-day free trial." Both surfaces — the onboarding wizard
// (Step 8) and the Settings page — render the same disclosure strings
// so legal/marketing copy stays consistent.
//
// SAVE_CARD_DISCLOSURE is shown next to the "Save card" button on the
// subscription card form. PUBLISH_CONFIRM_DISCLOSURE is shown inside
// the publish-confirmation modal that gates the actual trial start.

export const SAVE_CARD_DISCLOSURE =
  "Your card stays on file. We won't charge anything until you publish — your 90-day free trial starts then. Then $199.99 CAD/month. Cancel anytime.";

export function PUBLISH_CONFIRM_DISCLOSURE(previewEndDate: string): string {
  return `Your 90-day free trial starts now. You won't be charged until ${previewEndDate}. Then $199.99 CAD/month, cancel anytime.`;
}
