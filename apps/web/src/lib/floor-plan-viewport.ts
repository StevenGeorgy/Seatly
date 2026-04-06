/**
 * Default contain factor for full-canvas / content framing (~98% of the limiting axis).
 * Used for fit-to-view and zoom bounds so framing stays consistent.
 */
export const FLOOR_PLAN_VIEWPORT_CONTAIN_PAD = 0.98;

/** When framing room zones only — 1.0 fills the viewport edge-to-edge on the limiting axis (no letterboxing). */
export const FLOOR_PLAN_ZONE_VIEWPORT_CONTAIN_PAD = 1;

/**
 * Scale the world so it **contains** the container (like CSS `object-fit: contain`):
 * the entire floor rectangle stays visible with optional padding; no cropping.
 */
export function scaleWorldToContainViewport(
  containerWidth: number,
  containerHeight: number,
  worldW: number,
  worldH: number,
  padding = FLOOR_PLAN_VIEWPORT_CONTAIN_PAD,
): number {
  const cw = Math.max(0, containerWidth);
  const ch = Math.max(0, containerHeight);
  if (cw < 1 || ch < 1 || worldW < 1 || worldH < 1) return 1;
  const sx = (cw * padding) / worldW;
  const sy = (ch * padding) / worldH;
  return Math.min(sx, sy);
}

/**
 * Scale the world so it **covers** the container (like CSS `object-fit: cover`):
 * the viewport is filled; the rect may crop on one axis. Use for room zones so there is no letterboxing.
 */
export function scaleWorldToCoverViewport(
  containerWidth: number,
  containerHeight: number,
  worldW: number,
  worldH: number,
  padding = FLOOR_PLAN_ZONE_VIEWPORT_CONTAIN_PAD,
): number {
  const cw = Math.max(0, containerWidth);
  const ch = Math.max(0, containerHeight);
  if (cw < 1 || ch < 1 || worldW < 1 || worldH < 1) return 1;
  const sx = (cw * padding) / worldW;
  const sy = (ch * padding) / worldH;
  return Math.max(sx, sy);
}

export type FloorPlanScaleBounds = {
  /** Reference fit scale (contain or cover depending on options). */
  fitScale: number;
  min: number;
  max: number;
};

/**
 * Professional zoom range: cannot zoom out far past “fit entire room”, cannot zoom in without a sane cap.
 * Bounds are derived from the **full** world size so zoom limits stay stable when framing content.
 */
export function getFloorPlanScaleBounds(
  containerWidth: number,
  containerHeight: number,
  worldW: number,
  worldH: number,
  options?: {
    containPadding?: number;
    /** When true, fitScale uses cover (fill viewport); when false, contain (letterbox if aspect differs). */
    useCoverFit?: boolean;
    /** Minimum scale as a fraction of fitScale (e.g. 0.88 = at most ~12% zoom-out past fit). */
    minZoomOutFactor?: number;
    /** Maximum scale as a multiple of fitScale (capped by absoluteMaxScale). */
    maxZoomInFactor?: number;
    absoluteMaxScale?: number;
    absoluteMinScale?: number;
  },
): FloorPlanScaleBounds {
  const pad = options?.containPadding ?? FLOOR_PLAN_VIEWPORT_CONTAIN_PAD;
  const fitScale = options?.useCoverFit
    ? scaleWorldToCoverViewport(containerWidth, containerHeight, worldW, worldH, pad)
    : scaleWorldToContainViewport(containerWidth, containerHeight, worldW, worldH, pad);
  const minF = options?.minZoomOutFactor ?? 0.88;
  const maxF = options?.maxZoomInFactor ?? 4.5;
  /** Hard ceiling for zoom-in *beyond* fit; must not cap below {@link fitScale} or cover/contain reset never reaches fit. */
  const absMax = options?.absoluteMaxScale ?? 12;
  const absMin = options?.absoluteMinScale ?? 0.12;

  let min = Math.max(absMin, fitScale * minF);
  const zoomCeiling = Math.min(absMax, fitScale * maxF);
  /** Always allow at least ~5% zoom past reference fit (small zones need scale ≫ absMax in px/world terms). */
  let max = Math.max(fitScale * 1.05, zoomCeiling);
  /** Guarantee reset/fit can always reach reference {@link fitScale} (cover or contain). */
  max = Math.max(max, fitScale + 1e-6);
  if (max <= min) {
    max = min + 1e-4;
  }

  return { fitScale, min, max };
}

/**
 * When stage scale changes, new position so the world point that was under
 * `(screenX, screenY)` (container/stage pixel coords) stays fixed — zoom pivot.
 */
export function stagePositionAfterZoomAtScreenPoint(
  screenX: number,
  screenY: number,
  oldPos: { x: number; y: number },
  oldScale: number,
  newScale: number,
): { x: number; y: number } {
  const wx = (screenX - oldPos.x) / oldScale;
  const wy = (screenY - oldPos.y) / oldScale;
  return {
    x: screenX - wx * newScale,
    y: screenY - wy * newScale,
  };
}

/**
 * Clamp Konva Stage (x, y) so the floor plan world rect (0…worldW × 0…worldH) in screen space
 * cannot be panned completely off-screen — a minimum strip must stay visible (Figma / map-like).
 */
export function clampFloorPlanStagePosition(
  pos: { x: number; y: number },
  scale: number,
  worldW: number,
  worldH: number,
  containerWidth: number,
  containerHeight: number,
  margin = 32,
  /** Minimum fraction of the scaled world width/height that must remain inside the viewport. */
  minVisibleFraction = 0.28,
): { x: number; y: number } {
  const cw = Math.max(0, containerWidth);
  const ch = Math.max(0, containerHeight);
  const scaledW = worldW * scale;
  const scaledH = worldH * scale;

  function axisRange(scaled: number, c: number): { min: number; max: number } {
    if (scaled <= c - 2 * margin) {
      return { min: margin, max: c - margin - scaled };
    }
    const minVisible = Math.max(
      margin,
      Math.min(scaled * minVisibleFraction, c * 0.4),
    );
    return { min: minVisible - scaled, max: c - minVisible };
  }

  const xr = axisRange(scaledW, cw);
  const yr = axisRange(scaledH, ch);

  let minX = xr.min;
  let maxX = xr.max;
  let minY = yr.min;
  let maxY = yr.max;

  if (minX > maxX) {
    const cx = (minX + maxX) / 2;
    minX = maxX = cx;
  }
  if (minY > maxY) {
    const cy = (minY + maxY) / 2;
    minY = maxY = cy;
  }

  return {
    x: Math.max(minX, Math.min(maxX, pos.x)),
    y: Math.max(minY, Math.min(maxY, pos.y)),
  };
}
