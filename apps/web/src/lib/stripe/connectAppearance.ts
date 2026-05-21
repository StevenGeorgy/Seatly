// Shared appearance tokens for Stripe Connect embedded components.
//
// Used by both the wizard's first-time KYC surface
// (`components/onboarding/Step8PaymentSetup.tsx`) and the post-publish
// dashboard verify panel (`components/billing/StripeConnectVerifyPanel.tsx`).
// Centralized here so both Connect entrypoints look identical and a
// palette change is a one-line edit.

export const CENAIVA_CONNECT_APPEARANCE = {
  overlays: "dialog",
  variables: {
    colorPrimary: "#D4AF37",
    colorBackground: "#0A0A0A",
    colorText: "#FFFFFF",
    colorSecondaryText: "#B0B0B0",
    colorDanger: "#EF4444",
    buttonPrimaryColorBackground: "#D4AF37",
    buttonPrimaryColorText: "#0A0A0A",
    buttonPrimaryColorBorder: "#D4AF37",
    buttonSecondaryColorBackground: "#1A1A1A",
    buttonSecondaryColorText: "#FFFFFF",
    buttonSecondaryColorBorder: "#2A2A2A",
    formAccentColor: "#D4AF37",
    formHighlightColorBorder: "#D4AF37",
    colorBorder: "#2A2A2A",
    offsetBackgroundColor: "#121212",
    actionPrimaryColorText: "#D4AF37",
    fontFamily: "system-ui, -apple-system, sans-serif",
    fontSizeBase: "14px",
    borderRadius: "10px",
    spacingUnit: "4px",
  },
} as const;
