/**
 * Seatly React Native Theme
 * Production-ready design tokens for the Expo mobile app.
 *
 * Usage:
 *   import { theme } from '@seatly/tokens/theme.native';
 *   // or: import { theme } from '../../packages/tokens/theme.native';
 *
 *   <View style={{ backgroundColor: theme.colors.backgroundDark }}>
 *   <Text style={{ color: theme.colors.textOnDark, fontSize: theme.typography.fontSize.base }}>
 *
 * If the package export is not configured, add to packages/tokens/package.json:
 *   "exports": { ".": "./index.ts", "./theme.native": "./theme.native.ts" }
 */

import { Platform } from 'react-native';

// =============================================================================
// TYPES
// =============================================================================

export interface ThemeColors {
  // Backgrounds
  backgroundDark: string;
  surfaceDarkAlt: string;
  surfaceDark: string;
  surfaceDarkElevated: string;
  goldTintBg: string;
  // Text
  textOnDark: string;
  textMutedOnDark: string;
  textOnGold: string;
  // Borders
  borderDark: string;
  borderCard: string;
  // Gold
  gold: string;
  goldMuted: string;
  goldDark: string;
  // Status
  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  error: string;
  errorMuted: string;
  info: string;
  infoMuted: string;
  // Floor plan
  floorPlanEmpty: string;
  floorPlanEmptyBorder: string;
  floorPlanSeated: string;
  floorPlanSeatedBorder: string;
  floorPlanArriving: string;
  floorPlanArrivingBorder: string;
  floorPlanOverdue: string;
  floorPlanOverdueBorder: string;
  floorPlanReserved: string;
  floorPlanReservedBorder: string;
}

export interface ThemeSpacing {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  '2xl': number;
  '3xl': number;
  '4xl': number;
}

export interface ThemeTypography {
  fontSize: {
    xs: number;
    sm: number;
    base: number;
    lg: number;
    xl: number;
    '2xl': number;
    '3xl': number;
    '4xl': number;
  };
  fontWeight: {
    normal: '400';
    medium: '500';
    semibold: '600';
    bold: '700';
    extrabold: '800';
  };
  lineHeight: {
    relaxed: number;
  };
  letterSpacing: {
    tightHero: number;
    tightSection: number;
    label: number;
  };
}

export interface ThemeBorderRadius {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  full: number;
}

export interface ThemeShadows {
  sm: {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation?: number;
  };
  md: {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation?: number;
  };
  goldGlow: {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation?: number;
  };
}

export interface Theme {
  colors: ThemeColors;
  spacing: ThemeSpacing;
  typography: ThemeTypography;
  borderRadius: ThemeBorderRadius;
  shadows: ThemeShadows;
}

// =============================================================================
// COLORS
// =============================================================================

export const colors: ThemeColors = {
  backgroundDark: '#0A0A0A',
  surfaceDarkAlt: '#0F0F0F',
  surfaceDark: '#141414',
  surfaceDarkElevated: '#1A1A1A',
  goldTintBg: 'rgba(212, 175, 55, 0.04)',
  textOnDark: '#fafafa',
  textMutedOnDark: '#9ca3af',
  textOnGold: '#0A0A0A',
  borderDark: '#262626',
  borderCard: '#2C2C2C',
  gold: '#D4AF37',
  goldMuted: '#B8962E',
  goldDark: '#8B6914',
  success: '#22c55e',
  successMuted: '#dcfce7',
  warning: '#f59e0b',
  warningMuted: '#fef3c7',
  error: '#ef4444',
  errorMuted: '#fee2e2',
  info: '#3b82f6',
  infoMuted: '#dbeafe',
  floorPlanEmpty: '#2A2A2A',
  floorPlanEmptyBorder: '#404040',
  floorPlanSeated: '#1A3A1A',
  floorPlanSeatedBorder: '#2A4A2A',
  floorPlanArriving: '#3A3000',
  floorPlanArrivingBorder: '#4A4000',
  floorPlanOverdue: '#3A1A1A',
  floorPlanOverdueBorder: '#4A2A2A',
  floorPlanReserved: '#1A1A3A',
  floorPlanReservedBorder: '#2A2A4A',
};

// =============================================================================
// SPACING (numeric values for React Native)
// =============================================================================

export const spacing: ThemeSpacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
  '4xl': 64,
};

// =============================================================================
// TYPOGRAPHY
// =============================================================================

export const typography: ThemeTypography = {
  fontSize: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 36,
  },
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  },
  lineHeight: {
    relaxed: 1.7,
  },
  letterSpacing: {
    tightHero: -0.48, // -0.02em at 24px
    tightSection: -0.42, // -0.03em at 14px
    label: 1.2, // 0.1em at 12px
  },
};

// =============================================================================
// BORDER RADIUS
// =============================================================================

export const borderRadius: ThemeBorderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

// =============================================================================
// SHADOWS (platform-specific)
// =============================================================================

export const shadows: ThemeShadows = {
  sm: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    ...(Platform.OS === 'android' && { elevation: 2 }),
  },
  md: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    ...(Platform.OS === 'android' && { elevation: 4 }),
  },
  goldGlow: {
    shadowColor: 'rgba(212, 175, 55, 0.3)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 20,
    ...(Platform.OS === 'android' && { elevation: 8 }),
  },
};

// =============================================================================
// THEME OBJECT (default export)
// =============================================================================

export const theme: Theme = {
  colors,
  spacing,
  typography,
  borderRadius,
  shadows,
};

// =============================================================================
// COMMON STYLE PRESETS (optional helpers)
// =============================================================================

export const presets = {
  screen: {
    flex: 1 as const,
    backgroundColor: colors.backgroundDark,
    paddingHorizontal: spacing.xl,
  },
  card: {
    backgroundColor: colors.surfaceDark,
    borderWidth: 1,
    borderColor: colors.borderCard,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
  },
  primaryButton: {
    backgroundColor: colors.gold,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.lg,
  },
  primaryButtonText: {
    color: colors.textOnGold,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  secondaryButtonText: {
    color: colors.gold,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
  },
  input: {
    backgroundColor: colors.surfaceDark,
    borderWidth: 1,
    borderColor: colors.borderDark,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.fontSize.base,
    color: colors.textOnDark,
  },
  inputFocused: {
    borderColor: colors.gold,
    borderWidth: 1,
  },
  inputError: {
    borderColor: colors.error,
    backgroundColor: colors.errorMuted,
  },
  screenTitle: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
    color: colors.textOnDark,
  },
  sectionHeading: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.textOnDark,
  },
  bodyText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.normal,
    color: colors.textOnDark,
    lineHeight: typography.fontSize.sm * typography.lineHeight.relaxed,
  },
  label: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.textMutedOnDark,
  },
  navItemActive: {
    borderLeftWidth: 2,
    borderLeftColor: colors.gold,
    backgroundColor: colors.goldTintBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  navItemInactive: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  badge: {
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: colors.goldTintBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  badgeText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.gold,
  },
  allergyBadge: {
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  allergyBadgeText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.error,
  },
} as const;
