/**
 * Design-token hex values for use inside Konva canvas shapes.
 * Konva cannot consume Tailwind classes — import from here instead.
 * All values mirror tailwind.config.ts exactly.
 */
export const CANVAS_COLORS = {
  bgBase: "#0C0C0C",
  bgSurface: "#181818",
  bgElevated: "#222222",
  border: "#2E2E2E",
  textPrimary: "#FFFFFF",
  textSecondary: "#AAAAAA",
  textMuted: "#666666",
  gold: "#C9A84C",
  /** Semi-transparent gold for marquee / selection overlay fills. */
  goldMarqueeFill: "rgba(201, 168, 76, 0.14)",
  goldLight: "#F5E6C8",
  goldDark: "#A8873A",
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#EF4444",
  info: "#3B82F6",
  cleaning: "#6B7280",
  blocked: "#374151",
  /** Subtle dot grid colour */
  gridDot: "#1E1E1E",
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
