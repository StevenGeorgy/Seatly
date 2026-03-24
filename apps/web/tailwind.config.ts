import type { Config } from "tailwindcss";

/**
 * Seatly design tokens — SEATLY-MASTER-BIBLE.md §08.
 * Hex values live only here; UI references Tailwind utilities / CSS variables.
 *
 * Border-radius px in `src/index.css` `@theme inline` (`--radius-sm` … `--radius-4xl`) must stay
 * identical to `theme.borderRadius` below — Tailwind v4 cannot use `theme()` inside `@theme inline`.
 */
export default {
  theme: {
    spacing: {
      px: "1px",
      0: "0px",
      1: "4px",
      2: "8px",
      3: "12px",
      4: "16px",
      5: "20px",
      6: "24px",
      8: "32px",
      10: "40px",
      12: "48px",
    },
    borderRadius: {
      sm: "6px",
      md: "10px",
      lg: "14px",
      xl: "20px",
      "2xl": "20px",
      "3xl": "20px",
      "4xl": "20px",
      full: "9999px",
    },
    extend: {
      colors: {
        gold: "#C9A84C",
        "gold-light": "#F5E6C8",
        "gold-dark": "#A8873A",
        "bg-base": "#0A0A0A",
        "bg-surface": "#1A1A1A",
        "bg-elevated": "#242424",
        border: "#2E2E2E",
        "text-primary": "#FFFFFF",
        "text-secondary": "#AAAAAA",
        "text-muted": "#666666",
        success: "#22C55E",
        warning: "#F59E0B",
        danger: "#EF4444",
        info: "#3B82F6",
        cleaning: "#6B7280",
        blocked: "#374151",
      },
    },
  },
} satisfies Config;
