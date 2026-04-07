import type { DecorationItem, FloorPlanLayout, FloorPlanZone, TableRow } from "@/hooks/useFloorPlan";
import { getTableWorldBounds } from "@/components/floor-plan/TableShape";

type WallLike = { x1: number; y1: number; x2: number; y2: number };

function expandBounds(
  left: number,
  top: number,
  right: number,
  bottom: number,
  next: { left: number; top: number; right: number; bottom: number },
): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Math.min(left, next.left),
    top: Math.min(top, next.top),
    right: Math.max(right, next.right),
    bottom: Math.max(bottom, next.bottom),
  };
}

function wallLineBounds(w: WallLike, pad = 8): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Math.min(w.x1, w.x2) - pad,
    top: Math.min(w.y1, w.y2) - pad,
    right: Math.max(w.x1, w.x2) + pad,
    bottom: Math.max(w.y1, w.y2) + pad,
  };
}

function decorationBounds(d: DecorationItem): { left: number; top: number; right: number; bottom: number } {
  const hw = d.width / 2;
  const hh = d.height / 2;
  return {
    left: d.x - hw,
    top: d.y - hh,
    right: d.x + hw,
    bottom: d.y + hh,
  };
}

function zoneRectBounds(z: FloorPlanZone): { left: number; top: number; right: number; bottom: number } {
  return {
    left: z.x,
    top: z.y,
    right: z.x + z.width,
    bottom: z.y + z.height,
  };
}

/**
 * Union of table / wall / fixture / **room zone** bounds in world space, clamped to the canvas rect.
 * Including zones makes the viewport frame the visible “room” instead of an oversized empty canvas.
 * Returns null when there is nothing to frame (no finite bounds).
 */
export function computeFloorPlanContentBounds(
  tables: TableRow[],
  layout: Pick<FloorPlanLayout, "walls" | "doors" | "windows" | "decorations" | "zones">,
  tableTransforms: FloorPlanLayout["tableTransforms"],
  worldW: number,
  worldH: number,
  /** Extra breathing room around the content (world px). Lower = tighter framing / larger room on screen. */
  paddingWorld = 20,
): { left: number; top: number; width: number; height: number } | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const t of tables) {
    const b = getTableWorldBounds(t, tableTransforms[t.id] ?? null);
    ({ left, top, right, bottom } = expandBounds(left, top, right, bottom, b));
  }
  for (const w of layout.walls) {
    const b = wallLineBounds(w);
    ({ left, top, right, bottom } = expandBounds(left, top, right, bottom, b));
  }
  for (const w of layout.doors ?? []) {
    const b = wallLineBounds(w, 6);
    ({ left, top, right, bottom } = expandBounds(left, top, right, bottom, b));
  }
  for (const w of layout.windows ?? []) {
    const b = wallLineBounds(w, 6);
    ({ left, top, right, bottom } = expandBounds(left, top, right, bottom, b));
  }
  for (const d of layout.decorations) {
    const b = decorationBounds(d);
    ({ left, top, right, bottom } = expandBounds(left, top, right, bottom, b));
  }
  for (const z of layout.zones ?? []) {
    const b = zoneRectBounds(z);
    ({ left, top, right, bottom } = expandBounds(left, top, right, bottom, b));
  }

  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    return null;
  }

  left = Math.max(0, left - paddingWorld);
  top = Math.max(0, top - paddingWorld);
  right = Math.min(worldW, right + paddingWorld);
  bottom = Math.min(worldH, bottom + paddingWorld);

  const width = right - left;
  const height = bottom - top;
  if (width < 24 || height < 24) {
    return null;
  }

  return { left, top, width, height };
}

/**
 * Union of **room zones only** (the floor surface), clamped to the canvas.
 * Use this for camera framing so perimeter walls / furniture don’t expand bounds to the full canvas.
 */
export function computeZoneUnionBounds(
  zones: FloorPlanZone[],
  worldW: number,
  worldH: number,
  paddingWorld = 4,
): { left: number; top: number; width: number; height: number } | null {
  if (zones.length === 0) return null;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const z of zones) {
    const b = zoneRectBounds(z);
    ({ left, top, right, bottom } = expandBounds(left, top, right, bottom, b));
  }

  left = Math.max(0, left - paddingWorld);
  top = Math.max(0, top - paddingWorld);
  right = Math.min(worldW, right + paddingWorld);
  bottom = Math.min(worldH, bottom + paddingWorld);

  const width = right - left;
  const height = bottom - top;
  if (width < 24 || height < 24) {
    return null;
  }

  return { left, top, width, height };
}

/**
 * When the zone union is only a small part of the canvas, keep using **full-world** zoom limits and
 * fit logic. Otherwise the first placed zone (small default rect) forces cover-fit on a tiny box and
 * `fitWorldToViewport` zooms in massively.
 */
export function zoneUnionCoversEnoughOfWorld(
  zoneFrame: { width: number; height: number },
  worldW: number,
  worldH: number,
  minAreaRatio = 0.1,
): boolean {
  const worldArea = worldW * worldH;
  if (worldArea < 1) return false;
  const ratio = (zoneFrame.width * zoneFrame.height) / worldArea;
  return ratio >= minAreaRatio;
}

/**
 * Whether to zoom/center the view on {@link computeFloorPlanContentBounds} instead of the full room.
 *
 * Uses both **area** and **span**: a layout can use most of the *area* (e.g. L-shape) while still
 * leaving a large empty band on the right or bottom — span catches that so the camera isn’t stuck
 * showing a big void.
 */
export function shouldFitViewToContent(
  content: { width: number; height: number },
  worldW: number,
  worldH: number,
  areaRatioThreshold = 0.62,
  /** If content doesn’t cover this fraction of room width or height, prefer framing content. */
  spanRatioThreshold = 0.82,
): boolean {
  const worldArea = worldW * worldH;
  if (worldArea < 1) return false;
  const areaRatio = (content.width * content.height) / worldArea;
  if (areaRatio < areaRatioThreshold) return true;
  if (content.width < worldW * spanRatioThreshold) return true;
  if (content.height < worldH * spanRatioThreshold) return true;
  return false;
}

/**
 * Use {@link computeFloorPlanContentBounds} for the camera (not the full canvas world) when:
 * - content is sparse vs the world, or
 * - layout has room zones and the framed union does not span the full canvas (so the room fills the view).
 */
export function shouldFrameRoomInViewport(
  content: { width: number; height: number },
  worldW: number,
  worldH: number,
  hasZones: boolean,
): boolean {
  if (shouldFitViewToContent(content, worldW, worldH)) return true;
  if (hasZones) {
    if (content.width < worldW * 0.995 || content.height < worldH * 0.995) return true;
  }
  return false;
}
