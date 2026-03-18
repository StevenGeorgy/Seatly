/**
 * Seatly Design Tokens
 * All colours, spacing, fonts must be imported from here.
 * NEVER hardcode values in components.
 */

export const colours = {
  primary: "#2563eb",
  primaryHover: "#1d4ed8",
  secondary: "#64748b",
  secondaryHover: "#475569",
  background: "#f8fafc",
  surface: "#ffffff",
  surfaceMuted: "#f1f5f9",
  text: "#0f172a",
  textMuted: "#64748b",
  border: "#e2e8f0",
  borderMuted: "#f1f5f9",
  success: "#22c55e",
  successMuted: "#dcfce7",
  warning: "#f59e0b",
  warningMuted: "#fef3c7",
  error: "#ef4444",
  errorMuted: "#fee2e2",
  info: "#3b82f6",
  infoMuted: "#dbeafe",
  // Table status colours (floor plan)
  tableEmpty: "#94a3b8",
  tableArriving: "#eab308",
  tableSeated: "#22c55e",
  tableOverdue: "#ef4444",
  tableReserved: "#3b82f6",
  // Floor plan mockup - muted realistic tones
  floorPlanEmpty: "#2A2A2A",
  floorPlanEmptyBorder: "#404040",
  floorPlanSeated: "#1A3A1A",
  floorPlanSeatedBorder: "#2A4A2A",
  floorPlanArriving: "#3A3000",
  floorPlanArrivingBorder: "#4A4000",
  floorPlanOverdue: "#3A1A1A",
  floorPlanOverdueBorder: "#4A2A2A",
  floorPlanReserved: "#1A1A3A",
  floorPlanReservedBorder: "#2A2A4A",
  // Dark theme (login, premium screens)
  backgroundDark: "#0A0A0A",
  surfaceDarkAlt: "#0F0F0F",
  surfaceDark: "#141414",
  surfaceDarkElevated: "#1A1A1A",
  borderDark: "#262626",
  borderCard: "#2C2C2C",
  textOnDark: "#fafafa",
  textMutedOnDark: "#9ca3af",
  // Gold palette
  gold: "#D4AF37",
  goldMuted: "#B8962E",
  goldDark: "#8B6914",
  goldGlow: "0 0 20px rgba(212, 175, 55, 0.15)",
  goldBorderFocus: "0 0 0 1px rgba(212, 175, 55, 0.5)",
  textOnGold: "#0A0A0A",
  goldGradientHero: "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(212, 175, 55, 0.12), transparent 70%)",
  goldGlowHeroText: "0 0 48px rgba(212, 175, 55, 0.25)",
  goldGradientCardTop: "linear-gradient(to bottom, rgba(212, 175, 55, 0.12), transparent)",
  goldGlowHover: "0 0 24px rgba(212, 175, 55, 0.2)",
  goldGlowPricingCard: "0 0 24px rgba(212, 175, 55, 0.15), 0 0 48px rgba(212, 175, 55, 0.08)",
  goldTintBg: "rgba(212, 175, 55, 0.04)",
  // Linear-style landing
  surfaceGlass: "rgba(20, 20, 20, 0.6)",
  goldGlowSection: "radial-gradient(ellipse 100% 80% at 50% 50%, rgba(212, 175, 55, 0.06), transparent 70%)",
  radialGradientDarkCenter: "radial-gradient(ellipse 80% 60% at 50% 30%, rgba(20, 20, 20, 0.6), transparent 70%)",
  goldGradientText: "linear-gradient(to bottom, #fafafa, #b1b1b1)",
  goldGradientTextMuted: "linear-gradient(to bottom, #e5e5e5, #a3a3a3)",
  insetShadowCard: "inset 0 1px 0 rgba(255, 255, 255, 0.03)",
  goldBorderGradient: "linear-gradient(90deg, transparent, rgba(212, 175, 55, 0.5), transparent)",
  noiseOpacity: "0.025",
  goldShimmerLight: "rgba(255, 255, 255, 0.12)",
} as const;

export const spacing = {
  xs: "4px",
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  "2xl": "32px",
  "3xl": "48px",
  "4xl": "64px",
} as const;

export const fontSizes = {
  xs: "12px",
  sm: "14px",
  base: "16px",
  lg: "18px",
  xl: "20px",
  "2xl": "24px",
  "3xl": "30px",
  "4xl": "36px",
} as const;

export const fontWeights = {
  normal: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
  extrabold: "800",
} as const;

export const letterSpacing = {
  tightHero: "-0.02em",
  tightSection: "-0.03em",
  label: "0.1em",
} as const;

export const lineHeights = {
  relaxed: "1.7",
} as const;

export const borderRadius = {
  sm: "4px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  full: "9999px",
} as const;

export const shadows = {
  sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
  lg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
} as const;

export const tokens = {
  colours,
  spacing,
  fontSizes,
  fontWeights,
  letterSpacing,
  lineHeights,
  borderRadius,
  shadows,
} as const;

export type Colours = typeof colours;
export type Spacing = typeof spacing;
export type FontSizes = typeof fontSizes;
export type FontWeights = typeof fontWeights;
export type LetterSpacing = typeof letterSpacing;
export type LineHeights = typeof lineHeights;
export type BorderRadius = typeof borderRadius;
export type Shadows = typeof shadows;
