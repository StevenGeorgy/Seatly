/**
 * Design-token hex values for use inside Konva canvas shapes.
 * Konva cannot consume Tailwind classes — import from here instead.
 * All values mirror tailwind.config.ts exactly.
 */
export const CANVAS_COLORS = {
  /** Match Tailwind `bg-bg-base` / --background */
  bgBase: "#0A0A0A",
  /** Match Tailwind `bg-bg-surface` — must match HTML editor chrome so Konva doesn’t show a second “frame”. */
  bgSurface: "#1A1A1A",
  bgElevated: "#141414",
  border: "#2E2E2E",
  textPrimary: "#FFFFFF",
  textSecondary: "#AAAAAA",
  textMuted: "#666666",
  gold: "#C9A84C",
  /** Semi-transparent gold for marquee / selection overlay fills. */
  goldMarqueeFill: "rgba(201, 168, 76, 0.14)",
  goldLight: "#F5E6C8",
  goldDark: "#A8873A",
  /** Depth shadow for table shapes (Konva) */
  shadow: "#000000",
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#EF4444",
  info: "#3B82F6",
  cleaning: "#6B7280",
  blocked: "#374151",
  /**
   * Dot grid — slightly lighter than surface so it doesn’t read as a second “black”
   * against `bgSurface` (dark-on-dark looked like two shades).
   */
  gridDot: "rgba(255, 255, 255, 0.035)",
  /** Subtle radial wash — floor “zone” warmth without busy overlays */
  zoneAmbientCenter: "rgba(201, 168, 76, 0.055)",
  zoneAmbientEdge: "rgba(26, 26, 26, 0)",
  /** Same as room body — single flat floor colour (no darker “gutter” band). */
  zoneOuterGutter: "#0A0A0A",
  /**
   * Floor canvas + zone body — warm charcoal (wood/stone), distinct from `bgSurface` / chrome.
   * Mirrors the venue-floor intent; not a second UI panel grey.
   */
  zoneBodyFill: "#0A0A0A",
  /** Gold wash — warm room tint (not subtle) */
  zoneBodyGoldWash: "rgba(201, 168, 76, 0.38)",
  /** Outer frame — premium gold rail; reads in thumbnails */
  zonePanelStroke: "rgba(201, 168, 76, 0.95)",
  zonePanelStrokeSelected: "#D4B45C",
  /** Inner body edge — separates gutter from room */
  zoneInnerBodyStroke: "rgba(201, 168, 76, 0.42)",
  /** Inner rim highlight */
  zoneInnerRim: "rgba(255, 255, 255, 0.14)",
  /** Zone title — high-contrast gold (anchored header) */
  zoneLabel: "#F5E6C8",
  zoneLabelShadow: "rgba(0, 0, 0, 0.85)",
  /** Title band — obvious anchor strip at top of room */
  zoneLabelBandTop: "rgba(0, 0, 0, 0.68)",
  zoneLabelBandBottom: "rgba(0, 0, 0, 0.22)",
  /** Hairline under title band */
  zoneLabelBandRule: "rgba(201, 168, 76, 0.35)",
} as const;

export type TableStatus = "empty" | "reserved" | "occupied" | "cleaning" | "blocked";

export const STATUS_COLORS: Record<TableStatus, string> = {
  empty: CANVAS_COLORS.success,
  reserved: CANVAS_COLORS.gold,
  occupied: CANVAS_COLORS.danger,
  cleaning: CANVAS_COLORS.cleaning,
  blocked: CANVAS_COLORS.blocked,
};

export const STATUS_LABEL_KEYS: Record<TableStatus, string> = {
  empty: "dashboard.floorPlan.statusEmpty",
  reserved: "dashboard.floorPlan.statusReserved",
  occupied: "dashboard.floorPlan.statusOccupied",
  cleaning: "dashboard.floorPlan.statusCleaning",
  blocked: "dashboard.floorPlan.statusBlocked",
};

export function getStatusColor(status: string): string {
  return STATUS_COLORS[(status as TableStatus)] ?? STATUS_COLORS.empty;
}
