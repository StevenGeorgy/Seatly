import type { RestaurantTheme } from "@/hooks/useStaffRestaurants";

// Default Seatly theme
const DEFAULT_PRIMARY = "#C9A84C";
const DEFAULT_BG = "#0A0A0A";

/**
 * Parse a hex color to RGB components.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

/**
 * Convert RGB to hex string.
 */
function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Lighten a hex color by mixing with white.
 */
function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(
    rgb.r + (255 - rgb.r) * amount,
    rgb.g + (255 - rgb.g) * amount,
    rgb.b + (255 - rgb.b) * amount,
  );
}

/**
 * Darken a hex color by mixing with black.
 */
function darken(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(rgb.r * (1 - amount), rgb.g * (1 - amount), rgb.b * (1 - amount));
}

/**
 * Determine if a color is light (for choosing foreground contrast).
 */
function isLightColor(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.5;
}

/**
 * Apply a restaurant's theme colors to the document root as CSS custom properties.
 */
export function applyRestaurantTheme(theme: RestaurantTheme | null | undefined): void {
  const root = document.documentElement;
  const primary = theme?.primaryColor || DEFAULT_PRIMARY;
  const bg = theme?.backgroundColor || DEFAULT_BG;
  const primaryLight = lighten(primary, 0.55);
  const primaryDark = darken(primary, 0.2);
  const primaryFg = isLightColor(primary) ? "#0A0A0A" : "#FFFFFF";

  // Primary / brand color (affects buttons, rings, sidebar, charts)
  root.style.setProperty("--primary", primary);
  root.style.setProperty("--primary-foreground", primaryFg);
  root.style.setProperty("--ring", primary);
  root.style.setProperty("--sidebar-primary", primary);
  root.style.setProperty("--sidebar-primary-foreground", primaryFg);
  root.style.setProperty("--sidebar-ring", primary);
  root.style.setProperty("--chart-1", primary);

  // Gold aliases (used by Tailwind utilities like bg-gold, text-gold)
  root.style.setProperty("--gold", primary);
  root.style.setProperty("--gold-light", primaryLight);
  root.style.setProperty("--gold-dark", primaryDark);

  // Background & surface colors — derive card/surface/elevated/border from base
  const bgLight = isLightColor(bg);
  const surface = bgLight ? darken(bg, 0.05) : lighten(bg, 0.06);
  const elevated = bgLight ? darken(bg, 0.09) : lighten(bg, 0.1);
  const borderColor = bgLight ? darken(bg, 0.15) : lighten(bg, 0.14);
  const inputColor = borderColor;
  const fgColor = bgLight ? "#0A0A0A" : "#FFFFFF";
  const fgSecondary = bgLight ? "#555555" : "#AAAAAA";
  const fgMuted = bgLight ? "#888888" : "#666666";

  root.style.setProperty("--background", bg);
  root.style.setProperty("--foreground", fgColor);
  root.style.setProperty("--card", surface);
  root.style.setProperty("--card-foreground", fgColor);
  root.style.setProperty("--popover", surface);
  root.style.setProperty("--popover-foreground", fgColor);
  root.style.setProperty("--secondary", elevated);
  root.style.setProperty("--secondary-foreground", fgColor);
  root.style.setProperty("--muted", elevated);
  root.style.setProperty("--muted-foreground", fgMuted);
  root.style.setProperty("--accent", elevated);
  root.style.setProperty("--accent-foreground", fgColor);
  root.style.setProperty("--border", borderColor);
  root.style.setProperty("--input", inputColor);
  root.style.setProperty("--sidebar", surface);
  root.style.setProperty("--sidebar-foreground", fgColor);
  root.style.setProperty("--sidebar-accent", elevated);
  root.style.setProperty("--sidebar-accent-foreground", fgColor);
  root.style.setProperty("--sidebar-border", borderColor);

  // Tailwind custom colors for bg-base, bg-surface, bg-elevated, text-*, border
  root.style.setProperty("--bg-base", bg);
  root.style.setProperty("--bg-surface", surface);
  root.style.setProperty("--bg-elevated", elevated);
  root.style.setProperty("--text-primary", fgColor);
  root.style.setProperty("--text-secondary", fgSecondary);
  root.style.setProperty("--text-muted", fgMuted);
  root.style.setProperty("--tw-border", borderColor);
}

/**
 * Reset theme to Seatly defaults.
 */
export function resetTheme(): void {
  applyRestaurantTheme(null);
}
