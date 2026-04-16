import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type Konva from "konva";
import { Circle, Layer, Line, Rect, Stage, Transformer } from "react-konva";

import type {
  DecorationItem as DecorationModel,
  FloorPlanLayout,
  FloorPlanZone,
  SectionRow,
  TableRow,
} from "@/hooks/useFloorPlan";
import { CANVAS_COLORS } from "@/lib/canvas-colors";
import {
  clampFloorPlanStagePosition,
  stagePositionAfterZoomAtScreenPoint,
} from "@/lib/floor-plan-viewport";

import { DecorationItem } from "./DecorationItem";
import { FloorPlanZoneShape } from "./FloorPlanZoneShape";
import { getTableWorldBounds, TableShape, worldRectsIntersect } from "./TableShape";
import type { FloorPlanMode, HoveredTableInfo, ToolMode, WallDraft } from "./types";
import {
  FLOOR_PLAN_DEFAULT_WORLD_HEIGHT,
  FLOOR_PLAN_DEFAULT_WORLD_WIDTH,
  FLOOR_PLAN_GRID_STEP,
  FLOOR_PLAN_GRID_VISUAL_STEP,
} from "./types";
import { WallSegment } from "./WallSegment";

// ─── Dot-grid helper ─────────────────────────────────────────────────────────

const SNAP_STEP = FLOOR_PLAN_GRID_STEP;
const GRID_VISUAL_STEP = FLOOR_PLAN_GRID_VISUAL_STEP;
const DOT_RADIUS = 0.35;

/** Corners of the Stage viewport mapped into world space (inverse of stage pan/zoom). */
function viewportCornersToWorldBounds(
  stageX: number,
  stageY: number,
  scale: number,
  viewportW: number,
  viewportH: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const inv = 1 / scale;
  const corners = [
    { x: (0 - stageX) * inv, y: (0 - stageY) * inv },
    { x: (viewportW - stageX) * inv, y: (0 - stageY) * inv },
    { x: (0 - stageX) * inv, y: (viewportH - stageY) * inv },
    { x: (viewportW - stageX) * inv, y: (viewportH - stageY) * inv },
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** World-space rect that covers both the editable floor and whatever of the viewport maps outside it (no letterbox band). */
function unionFloorPaintBounds(
  worldW: number,
  worldH: number,
  vw: { minX: number; maxX: number; minY: number; maxY: number },
): { x: number; y: number; width: number; height: number } {
  const minX = Math.min(0, vw.minX);
  const minY = Math.min(0, vw.minY);
  const maxX = Math.max(worldW, vw.maxX);
  const maxY = Math.max(worldH, vw.maxY);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}


// ─── Snap helpers ─────────────────────────────────────────────────────────────

function snapToGrid(v: number): number {
  return Math.round(v / SNAP_STEP) * SNAP_STEP;
}

function snapWallAngle(x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const norm = ((angle % 360) + 360) % 360;
  const SNAP_THRESHOLD = 5;
  for (const snap of [0, 90, 180, 270]) {
    if (Math.abs(norm - snap) < SNAP_THRESHOLD || Math.abs(norm - snap - 360) < SNAP_THRESHOLD) {
      const len = Math.sqrt(dx * dx + dy * dy);
      const rad = (snap * Math.PI) / 180;
      return { x2: x1 + Math.cos(rad) * len, y2: y1 + Math.sin(rad) * len };
    }
  }
  return { x2, y2 };
}

// ─── Wall endpoint snap ──────────────────────────────────────────────────────

const WALL_SNAP_THRESHOLD = 15;

type WallEndpoint = { wallId: string; endpoint: "start" | "end"; x: number; y: number };

/** Collect all endpoints from all walls except the one being dragged. */
function collectWallEndpoints(
  walls: Wall[],
  excludeWallId?: string,
  excludeEndpoint?: "start" | "end",
): WallEndpoint[] {
  const pts: WallEndpoint[] = [];
  for (const w of walls) {
    if (w.id === excludeWallId && excludeEndpoint === "start") {
      pts.push({ wallId: w.id, endpoint: "end", x: w.x2, y: w.y2 });
    } else if (w.id === excludeWallId && excludeEndpoint === "end") {
      pts.push({ wallId: w.id, endpoint: "start", x: w.x1, y: w.y1 });
    } else {
      pts.push({ wallId: w.id, endpoint: "start", x: w.x1, y: w.y1 });
      pts.push({ wallId: w.id, endpoint: "end", x: w.x2, y: w.y2 });
    }
  }
  return pts;
}

/** Find nearest wall endpoint within threshold. */
function findNearestEndpoint(
  x: number,
  y: number,
  endpoints: WallEndpoint[],
  threshold: number = WALL_SNAP_THRESHOLD,
): WallEndpoint | null {
  let best: WallEndpoint | null = null;
  let bestDist = threshold;
  for (const ep of endpoints) {
    const d = Math.hypot(ep.x - x, ep.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = ep;
    }
  }
  return best;
}

const MARQUEE_MIN_DRAG_PX = 8;

/** Mouse wheel notches are often ~100px per tick; trackpad scroll uses smaller pixel deltas. */
const WHEEL_ZOOM_PIXEL_DELTA_THRESHOLD = 100;

/**
 * Zoom only for: trackpad pinch (ctrl/meta + wheel), line/page scroll, or chunky vertical
 * deltas (typical USB mouse wheel). Smooth pixel deltas without modifiers → pan (2-finger trackpad).
 */
function wheelShouldZoom(ev: WheelEvent): boolean {
  if (ev.ctrlKey || ev.metaKey) return true;
  if (ev.deltaMode === WheelEvent.DOM_DELTA_LINE) return true;
  if (ev.deltaMode === WheelEvent.DOM_DELTA_PAGE) return true;
  if (
    ev.deltaMode === WheelEvent.DOM_DELTA_PIXEL &&
    Math.abs(ev.deltaY) >= WHEEL_ZOOM_PIXEL_DELTA_THRESHOLD &&
    Math.abs(ev.deltaX) < Math.abs(ev.deltaY) * 0.5
  ) {
    return true;
  }
  return false;
}

function pointerToStageCoords(stage: Konva.Stage, clientX: number, clientY: number) {
  const rect = stage.container().getBoundingClientRect();
  const scale = stage.scaleX();
  const inv = 1 / scale;
  return {
    x: (clientX - rect.left - stage.x()) * inv,
    y: (clientY - rect.top - stage.y()) * inv,
  };
}

const CANVAS_BG_HIT_NAME = "canvas-bg-hit";

function isCanvasBackgroundTarget(node: Konva.Node): boolean {
  if (node.name() === CANVAS_BG_HIT_NAME) return true;
  const st = node.getStage();
  return st !== undefined && node === st;
}

// ─── Section title placement (fixed canvas center — does not follow table drags) ──

function tableDragBoundsForWorld(
  table: TableRow,
  transform: { scaleX?: number; scaleY?: number } | null | undefined,
  worldW: number,
  worldH: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const b = getTableWorldBounds(table, transform);
  const halfW = (b.right - b.left) / 2;
  const halfH = (b.bottom - b.top) / 2;
  return {
    minX: halfW,
    maxX: Math.max(halfW, worldW - halfW),
    minY: halfH,
    maxY: Math.max(halfH, worldH - halfH),
  };
}

function clampPointToWorld(x: number, y: number, worldW: number, worldH: number) {
  return {
    x: Math.max(0, Math.min(worldW, x)),
    y: Math.max(0, Math.min(worldH, y)),
  };
}

function clampTableCenterAfterSnap(
  cx: number,
  cy: number,
  table: TableRow,
  transform: { scaleX?: number; scaleY?: number } | null | undefined,
  worldW: number,
  worldH: number,
) {
  const b = getTableWorldBounds({ ...table, position_x: cx, position_y: cy }, transform);
  const halfW = (b.right - b.left) / 2;
  const halfH = (b.bottom - b.top) / 2;
  return {
    x: Math.max(halfW, Math.min(worldW - halfW, cx)),
    y: Math.max(halfH, Math.min(worldH - halfH, cy)),
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────

type Wall = { id: string; x1: number; y1: number; x2: number; y2: number };

function getWallWorldBounds(w: Wall): { left: number; top: number; right: number; bottom: number } {
  const pad = 8;
  return {
    left: Math.min(w.x1, w.x2) - pad,
    right: Math.max(w.x1, w.x2) + pad,
    top: Math.min(w.y1, w.y2) - pad,
    bottom: Math.max(w.y1, w.y2) + pad,
  };
}

/**
 * Dot grid rendered as a tiled canvas pattern — zero per-frame arc calls, GPU-accelerated tiling.
 * Replaces the previous arc-drawing approach that generated up to 48k dot positions per render.
 */
function FloorPlanDotGrid({
  worldW,
  worldH,
  fill,
  stagePixelRatio,
}: {
  worldW: number;
  worldH: number;
  fill: string;
  stagePixelRatio: number;
}) {
  const dpr = Math.min(Math.max(1, stagePixelRatio), 2);
  const step = GRID_VISUAL_STEP;

  const patternCanvas = useMemo(() => {
    const sz = Math.max(2, Math.round(step * dpr));
    const c = document.createElement("canvas");
    c.width = sz;
    c.height = sz;
    const ctx = c.getContext("2d");
    if (!ctx) return c;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(sz / 2, sz / 2, Math.max(0.5, DOT_RADIUS * dpr), 0, Math.PI * 2);
    ctx.fill();
    return c;
  }, [fill, dpr, step]);

  if (worldW < 1 || worldH < 1) return null;

  return (
    <Rect
      x={0}
      y={0}
      width={worldW}
      height={worldH}
      fillPatternImage={patternCanvas as unknown as HTMLImageElement}
      fillPatternScaleX={1 / dpr}
      fillPatternScaleY={1 / dpr}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

type FloorPlanCanvasProps = {
  tables: TableRow[];
  walls: Wall[];
  decorations: DecorationModel[];
  sections: SectionRow[];
  selectedSection: string;
  mode: FloorPlanMode;
  selectedTableIds: string[];
  selectedDecorationId: string | null;
  /** Edit mode: which walls are selected (outline + delete). */
  selectedWallIds?: string[];
  activeTool: ToolMode;
  stageScale: number;
  stagePos: { x: number; y: number };
  /** Same range as toolbar zoom / fit — wheel zoom must stay in band. */
  scaleMin: number;
  scaleMax: number;
  containerWidth: number;
  containerHeight: number;
  onTableClick: (id: string, e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onTableHover: (info: HoveredTableInfo | null) => void;
  /** World / layer-space coordinates where the user clicked the background grid. */
  onCanvasClick: (worldX: number, worldY: number) => void;
  onTableDragEnd: (id: string, x: number, y: number) => void;
  onWallDrawn: (wall: Wall) => void;
  /** Called when a wall endpoint is dragged to a new position (with snapping applied). */
  onWallEndpointUpdate?: (wallId: string, endpoint: "start" | "end", x: number, y: number) => void;
  /** Called when the wall body is dragged — dx/dy are the world-space offset to apply to both endpoints. */
  onWallDragEnd?: (wallId: string, dx: number, dy: number) => void;
  /** Edit mode: wall line/handle clicked (select / delete tool) — not used during add-wall / extend-wall. */
  onWallClick?: (wallId: string) => void;
  /** Edit mode only — omit in live mode so decorations do not capture selection */
  onDecorationClick?: (id: string) => void;
  onDecorationDragEnd: (id: string, x: number, y: number) => void;
  onStageScaleChange: (scale: number) => void;
  onStagePosChange: (pos: { x: number; y: number }) => void;
  /** From floor plan layout JSON — scaled table visuals */
  tableTransforms: FloorPlanLayout["tableTransforms"];
  /** Owners only: Konva Transformer on selected table (edge = one axis, corner = both). */
  resizeEnabled?: boolean;
  onTableTransformEnd?: (tableId: string, scaleX: number, scaleY: number) => void;
  /** Shift+drag on empty canvas to box-select tables and walls. */
  marqueeSelectEnabled?: boolean;
  onMarqueeSelect?: (selection: { tableIds: string[]; wallIds: string[] }) => void;
  /** World size (px) from floor_plans.canvas_width / canvas_height — bounds grid and editing. */
  worldWidth?: number;
  worldHeight?: number;
  /** Dot grid visibility (edit + live). */
  showGrid?: boolean;
  /** When false, table/wall placement uses raw coordinates (no grid snap). */
  snapEnabled?: boolean;
  /** Visual room zones (layout JSON). */
  zones?: FloorPlanZone[];
  selectedZoneId?: string | null;
  onZoneSelect?: (id: string) => void;
  onZoneDragEnd?: (id: string, x: number, y: number) => void;
  onZoneTransformEnd?: (id: string, patch: Partial<Pick<FloorPlanZone, "x" | "y" | "width" | "height">>) => void;
  /** Allow Konva resize on selected zone (edit mode). */
  zoneTransformEnabled?: boolean;
  /** Fired when the canvas wrapper is measured — keeps viewport math aligned with the real Stage size. */
  onViewportPixelSize?: (width: number, height: number) => void;
};

// ─── Component ───────────────────────────────────────────────────────────────

export function FloorPlanCanvas({
  tables,
  walls,
  decorations,
  sections,
  selectedSection,
  mode,
  selectedTableIds,
  selectedDecorationId,
  selectedWallIds = [],
  activeTool,
  stageScale,
  stagePos,
  scaleMin,
  scaleMax,
  containerWidth,
  containerHeight,
  onTableClick,
  onTableHover,
  onCanvasClick,
  onTableDragEnd,
  onWallDrawn,
  onWallEndpointUpdate,
  onWallDragEnd,
  onWallClick: onWallClickProp,
  onDecorationClick: onDecorationClickProp,
  onDecorationDragEnd,
  onStageScaleChange,
  onStagePosChange,
  tableTransforms,
  resizeEnabled = false,
  onTableTransformEnd,
  marqueeSelectEnabled = false,
  onMarqueeSelect,
  worldWidth: worldWidthProp,
  worldHeight: worldHeightProp,
  showGrid = true,
  snapEnabled = true,
  zones: zonesProp,
  selectedZoneId = null,
  onZoneSelect,
  onZoneDragEnd,
  onZoneTransformEnd,
  zoneTransformEnabled = false,
  onViewportPixelSize,
}: FloorPlanCanvasProps) {
  const zones = zonesProp ?? [];
  const worldW = Math.max(320, worldWidthProp ?? FLOOR_PLAN_DEFAULT_WORLD_WIDTH);
  const worldH = Math.max(240, worldHeightProp ?? FLOOR_PLAN_DEFAULT_WORLD_HEIGHT);

  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const [viewportPx, setViewportPx] = useState({ w: 0, h: 0 });
  const viewportW = viewportPx.w > 0 ? viewportPx.w : Math.max(1, containerWidth);
  const viewportH = viewportPx.h > 0 ? viewportPx.h : Math.max(1, containerHeight);

  useLayoutEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const apply = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      if (w < 1 || h < 1) return;
      setViewportPx((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      onViewportPixelSize?.(w, h);
    };
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
    return () => ro.disconnect();
  }, [onViewportPixelSize]);

  const applySnap = useCallback(
    (v: number) => (snapEnabled ? snapToGrid(v) : v),
    [snapEnabled],
  );

  const stageRef = useRef<Konva.Stage | null>(null);
  /** Match device pixels so world units stay visually proportional on HiDPI screens. */
  const [pixelRatio, setPixelRatio] = useState(1);
  useEffect(() => {
    const update = () => {
      setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const selectedTableInnerRef = useRef<Konva.Group | null>(null);
  const zoneTransformerRef = useRef<Konva.Transformer | null>(null);
  const selectedZoneInnerRef = useRef<Konva.Group | null>(null);
  const [draggingTableId, setDraggingTableId] = useState<string | null>(null);
  const [snapPulse, setSnapPulse] = useState<{ x: number; y: number } | null>(null);
  const [wallDraft, setWallDraft] = useState<WallDraft>({
    active: false,
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
  });
  const [marquee, setMarquee] = useState({
    active: false,
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
  });
  const [shiftHeld, setShiftHeld] = useState(false);
  const justFinishedMarqueeRef = useRef(false);
  const marqueeRef = useRef(marquee);
  const wallDraftRef = useRef(wallDraft);
  marqueeRef.current = marquee;
  wallDraftRef.current = wallDraft;

  const mouseUpHandlerRef = useRef<() => void>(() => {});
  /** Snap indicator: shows a small ring where a wall endpoint will snap to. */
  const [wallSnapTarget, setWallSnapTarget] = useState<{ x: number; y: number } | null>(null);

  const isEditing = mode === "edit";
  const isAddWallTool = activeTool === "add-wall";
  const isWallDrawingTool = isAddWallTool;

  function emitWallSelectClick(wallId: string) {
    if (!isEditing || isWallDrawingTool) return;
    onWallClickProp?.(wallId);
  }

  const singleSelectedTableId =
    selectedTableIds.length === 1 ? (selectedTableIds[0] ?? null) : null;

  const showTableTransformer =
    isEditing &&
    activeTool === "select" &&
    resizeEnabled &&
    singleSelectedTableId !== null &&
    selectedZoneId == null;

  const showZoneTransformer =
    isEditing &&
    activeTool === "select" &&
    zoneTransformEnabled &&
    selectedZoneId != null &&
    selectedZoneId !== "";

  const tablesRef = useRef(tables);
  tablesRef.current = tables;
  const onTableClickRef = useRef(onTableClick);
  onTableClickRef.current = onTableClick;
  const onTableHoverRef = useRef(onTableHover);
  onTableHoverRef.current = onTableHover;

  const tableShapeClick = useCallback(
    (id: string, ev: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      onTableClickRef.current(id, ev);
    },
    [],
  );

  const tableShapeMouseEnter = useCallback((id: string, sx: number, sy: number) => {
    const row = tablesRef.current.find((r) => r.id === id);
    if (row) onTableHoverRef.current({ table: row, screenX: sx, screenY: sy });
  }, []);

  const tableShapeMouseLeave = useCallback(() => {
    onTableHoverRef.current(null);
  }, []);

  const tableDragBoundsById = useMemo(() => {
    const m = new Map<string, ReturnType<typeof tableDragBoundsForWorld>>();
    if (!isEditing) return m;
    for (const t of tables) {
      m.set(t.id, tableDragBoundsForWorld(t, tableTransforms[t.id] ?? null, worldW, worldH));
    }
    return m;
  }, [isEditing, tables, tableTransforms, worldW, worldH]);

  useEffect(() => {
    const syncShift = (e: KeyboardEvent) => {
      setShiftHeld(e.shiftKey);
    };
    const onBlur = () => setShiftHeld(false);
    window.addEventListener("keydown", syncShift);
    window.addEventListener("keyup", syncShift);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", syncShift);
      window.removeEventListener("keyup", syncShift);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    if (!marquee.active) return;
    const move = (ev: MouseEvent) => {
      const st = stageRef.current;
      if (!st) return;
      const pos = pointerToStageCoords(st, ev.clientX, ev.clientY);
      setMarquee((d) => (d.active ? { ...d, x2: pos.x, y2: pos.y } : d));
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, [marquee.active]);

  mouseUpHandlerRef.current = () => {
    const m = marqueeRef.current;
    if (m.active) {
      const dist = Math.hypot(m.x2 - m.x1, m.y2 - m.y1);
      if (dist > MARQUEE_MIN_DRAG_PX) {
        const box = {
          left: Math.min(m.x1, m.x2),
          top: Math.min(m.y1, m.y2),
          right: Math.max(m.x1, m.x2),
          bottom: Math.max(m.y1, m.y2),
        };
        const tableIds = tables
          .filter((t) =>
            worldRectsIntersect(box, getTableWorldBounds(t, tableTransforms[t.id] ?? null)),
          )
          .map((t) => t.id);
        const wallIds = walls
          .filter((w) => worldRectsIntersect(box, getWallWorldBounds(w)))
          .map((w) => w.id);
        onMarqueeSelect?.({ tableIds, wallIds });
        justFinishedMarqueeRef.current = true;
      }
      const cleared = { active: false, x1: 0, y1: 0, x2: 0, y2: 0 };
      marqueeRef.current = cleared;
      setMarquee(cleared);
      return;
    }
    const w = wallDraftRef.current;
    if (!w.active) return;
    const { startX, startY, endX, endY } = w;
    const dist = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
    if (dist > 10) {
      const s = clampPointToWorld(startX, startY, worldW, worldH);
      const e = clampPointToWorld(endX, endY, worldW, worldH);
      onWallDrawn({
        id: `wall-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        x1: applySnap(s.x),
        y1: applySnap(s.y),
        x2: applySnap(e.x),
        y2: applySnap(e.y),
      });
    }
    const wallCleared = { active: false, startX: 0, startY: 0, endX: 0, endY: 0 };
    wallDraftRef.current = wallCleared;
    setWallDraft(wallCleared);
    setWallSnapTarget(null);
  };

  useEffect(() => {
    const fn = () => mouseUpHandlerRef.current();
    window.addEventListener("mouseup", fn);
    return () => window.removeEventListener("mouseup", fn);
  }, []);

  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const node = selectedTableInnerRef.current;
    if (showTableTransformer && node) {
      tr.nodes([node]);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [showTableTransformer, singleSelectedTableId, tables]);

  useEffect(() => {
    const tr = zoneTransformerRef.current;
    if (!tr) return;
    const node = selectedZoneInnerRef.current;
    if (showZoneTransformer && node) {
      tr.nodes([node]);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [showZoneTransformer, selectedZoneId, zones]);

  useEffect(() => {
    if (!snapPulse) return;
    const t = window.setTimeout(() => setSnapPulse(null), 200);
    return () => clearTimeout(t);
  }, [snapPulse]);

  function handleTransformerEnd() {
    const node = selectedTableInnerRef.current;
    const tid = singleSelectedTableId;
    if (!node || !tid || !onTableTransformEnd) return;
    let sx = node.scaleX();
    let sy = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    const row = tables.find((r) => r.id === tid);
    if (row && (row.shape === "circle" || row.shape === "square")) {
      const u = (sx + sy) / 2;
      sx = u;
      sy = u;
    }
    const clamp = (v: number) => Math.max(0.35, Math.min(4, v));
    onTableTransformEnd(tid, clamp(sx), clamp(sy));
  }

  function handleZoneTransformerEnd() {
    const node = selectedZoneInnerRef.current;
    const zid = selectedZoneId;
    if (!node || !zid || !onZoneTransformEnd) return;
    const z = zones.find((q) => q.id === zid);
    if (!z) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const w = Math.max(96, z.width * scaleX);
    const h = Math.max(72, z.height * scaleY);
    node.scaleX(1);
    node.scaleY(1);
    let nx = node.x();
    let ny = node.y();
    nx = Math.max(0, Math.min(worldW - w, nx));
    ny = Math.max(0, Math.min(worldH - h, ny));
    onZoneTransformEnd(zid, { x: nx, y: ny, width: w, height: h });
  }

  /** Floor paint + grid extend to the full visible viewport in world space so margins match (no darker band, grid everywhere). */
  const floorPaintBounds = useMemo(() => {
    const vw = viewportCornersToWorldBounds(
      stagePos.x,
      stagePos.y,
      stageScale,
      viewportW,
      viewportH,
    );
    return unionFloorPaintBounds(worldW, worldH, vw);
  }, [worldW, worldH, stagePos.x, stagePos.y, stageScale, viewportW, viewportH]);

  const clampStagePos = useCallback(
    (pos: { x: number; y: number }, scale: number) =>
      clampFloorPlanStagePosition(pos, scale, worldW, worldH, viewportW, viewportH),
    [worldW, worldH, viewportW, viewportH],
  );

  const stagePosRef = useRef(stagePos);
  stagePosRef.current = stagePos;
  const stageScaleRef = useRef(stageScale);
  stageScaleRef.current = stageScale;
  const blockStagePropSyncRef = useRef(false);
  const pendingStageFlushRef = useRef<{ scale: number; pos: { x: number; y: number } } | null>(
    null,
  );
  const stageFlushRafRef = useRef<number | null>(null);
  const clampStagePosRef = useRef(clampStagePos);
  clampStagePosRef.current = clampStagePos;
  const onStagePosChangeRef = useRef(onStagePosChange);
  onStagePosChangeRef.current = onStagePosChange;
  const onStageScaleChangeRef = useRef(onStageScaleChange);
  onStageScaleChangeRef.current = onStageScaleChange;

  const scheduleStageFlushToParent = useCallback(() => {
    if (stageFlushRafRef.current != null) return;
    stageFlushRafRef.current = requestAnimationFrame(() => {
      stageFlushRafRef.current = null;
      const pending = pendingStageFlushRef.current;
      pendingStageFlushRef.current = null;
      if (!pending) {
        blockStagePropSyncRef.current = false;
        return;
      }
      blockStagePropSyncRef.current = false;
      onStageScaleChangeRef.current(pending.scale);
      onStagePosChangeRef.current(pending.pos);
    });
  }, []);

  useEffect(
    () => () => {
      if (stageFlushRafRef.current != null) {
        cancelAnimationFrame(stageFlushRafRef.current);
      }
    },
    [],
  );

  /** Wheel/pan reads must match React props — Konva's internal x/y can drift from controlled props. */
  useLayoutEffect(() => {
    const st = stageRef.current;
    if (!st) return;
    if (blockStagePropSyncRef.current) {
      st.scale({ x: stageScaleRef.current, y: stageScaleRef.current });
      st.position({ x: stagePosRef.current.x, y: stagePosRef.current.y });
      return;
    }
    const sx = st.scaleX();
    const sy = st.scaleY();
    if (st.x() !== stagePos.x || st.y() !== stagePos.y) {
      st.position({ x: stagePos.x, y: stagePos.y });
    }
    if (sx !== stageScale || sy !== stageScale) {
      st.scale({ x: stageScale, y: stageScale });
    }
  }, [stagePos.x, stagePos.y, stageScale]);

  const canvasHoveredRef = useRef(false);
  const justFinishedPanRef = useRef(false);
  const spacePressedRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [viewportPanning, setViewportPanning] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      if (!canvasHoveredRef.current) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      setSpaceHeld(true);
      spacePressedRef.current = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpaceHeld(false);
        spacePressedRef.current = false;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    const startViewportPan = (clientX: number, clientY: number) => {
      const sx0 = stagePosRef.current.x;
      const sy0 = stagePosRef.current.y;
      blockStagePropSyncRef.current = true;
      setViewportPanning(true);
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - clientX;
        const dy = ev.clientY - clientY;
        const next = clampStagePosRef.current(
          { x: sx0 + dx, y: sy0 + dy },
          stageScaleRef.current,
        );
        stagePosRef.current = next;
        const st = stageRef.current;
        if (st) st.position(next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        justFinishedPanRef.current = true;
        blockStagePropSyncRef.current = false;
        onStagePosChangeRef.current(stagePosRef.current);
        setViewportPanning(false);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };

    const onPointerDown = (e: PointerEvent) => {
      const root = canvasContainerRef.current;
      if (!root || !root.contains(e.target as Node)) return;
      if (e.pointerType !== "mouse") return;
      if (e.button === 1) {
        e.preventDefault();
        startViewportPan(e.clientX, e.clientY);
        return;
      }
      if (e.button === 0 && spacePressedRef.current) {
        e.preventDefault();
        startViewportPan(e.clientX, e.clientY);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => document.removeEventListener("pointerdown", onPointerDown, { capture: true });
  }, []);

  const beginLiveBackgroundPan = useCallback((clientX: number, clientY: number) => {
    const sx0 = stagePosRef.current.x;
    const sy0 = stagePosRef.current.y;
    let moved = false;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - clientX;
      const dy = e.clientY - clientY;
      if (!moved && Math.hypot(dx, dy) <= 5) return;
      if (!moved) {
        moved = true;
        blockStagePropSyncRef.current = true;
        setViewportPanning(true);
      }
      const next = clampStagePosRef.current(
        { x: sx0 + dx, y: sy0 + dy },
        stageScaleRef.current,
      );
      stagePosRef.current = next;
      const st = stageRef.current;
      if (st) st.position(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (moved) {
        justFinishedPanRef.current = true;
        blockStagePropSyncRef.current = false;
        onStagePosChangeRef.current(stagePosRef.current);
      }
      setViewportPanning(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // Pinch / mouse wheel → zoom; 2-finger trackpad scroll (smooth pixels) → pan
  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    const ev = e.evt;
    ev.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    if (!wheelShouldZoom(ev)) {
      if (!panAllowed) return;
      const oldScale = stageScaleRef.current;
      const raw = {
        x: stagePosRef.current.x - ev.deltaX,
        y: stagePosRef.current.y - ev.deltaY,
      };
      const next = clampStagePos(raw, oldScale);
      stagePosRef.current = next;
      stage.position(next);
      blockStagePropSyncRef.current = true;
      pendingStageFlushRef.current = { scale: oldScale, pos: next };
      scheduleStageFlushToParent();
      return;
    }

    const scaleBy = 1.06;
    const oldScale = stageScaleRef.current;
    const oldPos = stagePosRef.current;
    /** Zoom about viewport center so the frame stays fixed; only content scales. */
    const cx = viewportW / 2;
    const cy = viewportH / 2;
    const lo = Math.min(scaleMin, scaleMax);
    const hi = Math.max(scaleMin, scaleMax);
    const newScale = ev.deltaY < 0
      ? Math.min(hi, oldScale * scaleBy)
      : Math.max(lo, oldScale / scaleBy);
    const newPos = stagePositionAfterZoomAtScreenPoint(cx, cy, oldPos, oldScale, newScale);
    const clampedPos = clampStagePos(newPos, newScale);
    stageScaleRef.current = newScale;
    stagePosRef.current = clampedPos;
    stage.scale({ x: newScale, y: newScale });
    stage.position(clampedPos);
    blockStagePropSyncRef.current = true;
    pendingStageFlushRef.current = { scale: newScale, pos: clampedPos };
    scheduleStageFlushToParent();
  }

  // Stage click (background) — deselect / place table / start wall
  function handleStageClick(e: Konva.KonvaEventObject<MouseEvent>) {
    if (justFinishedPanRef.current) {
      justFinishedPanRef.current = false;
      return;
    }
    if (justFinishedMarqueeRef.current) {
      justFinishedMarqueeRef.current = false;
      return;
    }
    if (!isCanvasBackgroundTarget(e.target)) return;
    const stage = stageRef.current;
    const pos = stage?.getRelativePointerPosition();
    if (!pos) return;
    onCanvasClick(pos.x, pos.y);
  }

  // Wall drawing + Shift+marquee on empty stage (any edit tool except shift+add-wall, which reserves marquee)
  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    const ev = e.evt;
    const canPanWithBgDrag =
      panAllowed &&
      (mode === "live" || (isEditing && activeTool === "select")) &&
      isCanvasBackgroundTarget(e.target) &&
      ev.button === 0 &&
      !ev.shiftKey &&
      !isWallDrawingTool;
    if (canPanWithBgDrag) {
      beginLiveBackgroundPan(ev.clientX, ev.clientY);
      return;
    }
    if (isEditing && isAddWallTool) {
      // add-wall: only start from the floor background.
      if (!isCanvasBackgroundTarget(e.target)) return;
      // Shift+drag = box select; plain click-drag = new wall segment
      if (marqueeSelectEnabled && e.evt.shiftKey) {
        // fall through to marquee handler below
      } else {
        const stage = stageRef.current;
        if (!stage) return;
        const pos = stage.getRelativePointerPosition();
        if (!pos) return;
        // Snap start point to nearby wall endpoint
        const endpoints = collectWallEndpoints(walls);
        const nearest = findNearestEndpoint(pos.x, pos.y, endpoints);
        const rawX = nearest ? nearest.x : pos.x;
        const rawY = nearest ? nearest.y : pos.y;
        const c = clampPointToWorld(rawX, rawY, worldW, worldH);
        const sx = applySnap(c.x);
        const sy = applySnap(c.y);
        setWallDraft({ active: true, startX: sx, startY: sy, endX: sx, endY: sy });
        return;
      }
    }
    if (
      isEditing &&
      marqueeSelectEnabled &&
      e.evt.shiftKey &&
      isCanvasBackgroundTarget(e.target)
    ) {
      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getRelativePointerPosition();
      if (!pos) return;
      const next = { active: true, x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y };
      marqueeRef.current = next;
      setMarquee(next);
      e.evt.preventDefault();
    }
  }

  function handleMouseMove(e: Konva.KonvaEventObject<MouseEvent>) {
    if (marquee.active) {
      const stage = stageRef.current;
      if (!stage) return;
      const pos = pointerToStageCoords(stage, e.evt.clientX, e.evt.clientY);
      setMarquee((d) => ({ ...d, x2: pos.x, y2: pos.y }));
      e.evt.preventDefault();
      return;
    }
    if (!wallDraft.active) return;
    const stage = stageRef.current;
    if (!stage) return;
    const pos = stage.getRelativePointerPosition();
    if (!pos) return;
    const snapped = snapWallAngle(wallDraft.startX, wallDraft.startY, pos.x, pos.y);
    // Check if the end point is near an existing wall endpoint
    const endpoints = collectWallEndpoints(walls);
    const nearest = findNearestEndpoint(snapped.x2, snapped.y2, endpoints);
    if (nearest) {
      const c = clampPointToWorld(nearest.x, nearest.y, worldW, worldH);
      setWallDraft((d) => ({ ...d, endX: c.x, endY: c.y }));
      setWallSnapTarget({ x: c.x, y: c.y });
    } else {
      const c = clampPointToWorld(snapped.x2, snapped.y2, worldW, worldH);
      setWallDraft((d) => ({ ...d, endX: c.x, endY: c.y }));
      setWallSnapTarget(null);
    }
    e.evt.preventDefault();
  }

  const handleTableDragEnd = useCallback(
    (tableId: string, rawX: number, rawY: number) => {
      setDraggingTableId(null);
      const t = tables.find((r) => r.id === tableId);
      let x = applySnap(rawX);
      let y = applySnap(rawY);
      if (t) {
        const c = clampTableCenterAfterSnap(x, y, t, tableTransforms[t.id] ?? null, worldW, worldH);
        x = applySnap(c.x);
        y = applySnap(c.y);
      }
      onTableDragEnd(tableId, x, y);
      if (snapEnabled) {
        setSnapPulse({ x, y });
      }
    },
    [applySnap, onTableDragEnd, tables, tableTransforms, worldW, worldH, snapEnabled],
  );

  const handleTableDragEndRef = useRef(handleTableDragEnd);
  handleTableDragEndRef.current = handleTableDragEnd;

  const tableShapeDragEnd = useCallback((id: string, rx: number, ry: number) => {
    handleTableDragEndRef.current(id, rx, ry);
  }, []);

  const tableShapeDragStart = useCallback((id: string) => {
    setDraggingTableId(id);
  }, []);

  const handleZoneDragEnd = useCallback(
    (zoneId: string, rawX: number, rawY: number) => {
      const x = applySnap(rawX);
      const y = applySnap(rawY);
      onZoneDragEnd?.(zoneId, x, y);
      if (snapEnabled) {
        const z = zones.find((q) => q.id === zoneId);
        setSnapPulse({
          x: x + (z?.width ?? 0) / 2,
          y: y + (z?.height ?? 0) / 2,
        });
      }
    },
    [applySnap, onZoneDragEnd, snapEnabled, zones],
  );

  const handleDecorationDragEndClamped = useCallback(
    (id: string, x: number, y: number) => {
      const d = decorations.find((de) => de.id === id);
      if (!d) {
        onDecorationDragEnd(id, x, y);
        return;
      }
      const hw = d.width / 2;
      const hh = d.height / 2;
      const nx = Math.max(hw, Math.min(worldW - hw, x));
      const ny = Math.max(hh, Math.min(worldH - hh, y));
      onDecorationDragEnd(id, nx, ny);
    },
    [decorations, onDecorationDragEnd, worldW, worldH],
  );

  /** Current floor name — rendered in screen space (HTML overlay) so it does not pan/zoom with the plan. */
  const activeSectionLabel = useMemo(() => {
    if (!selectedSection) return null;
    const s = sections.find((x) => x.id === selectedSection);
    if (!s?.is_active) return null;
    const raw = s.name?.trim();
    return raw ? raw : null;
  }, [sections, selectedSection]);

  /** Pan is only useful when the scaled floor plan is larger than the viewport in at least one axis. */
  const panAllowed =
    worldW * stageScale > viewportW + 2 || worldH * stageScale > viewportH + 2;

  const stagePanBlocked =
    marqueeSelectEnabled && isEditing && !isWallDrawingTool && shiftHeld;
  const cursorStyle =
    isWallDrawingTool
      ? "crosshair"
      : stagePanBlocked
        ? "crosshair"
        : spaceHeld
          ? viewportPanning
            ? "grabbing"
            : "grab"
          : viewportPanning
            ? "grabbing"
            : mode === "live" || (isEditing && activeTool === "select")
              ? "grab"
              : "default";

  return (
    <div
      ref={canvasContainerRef}
      className="relative h-full w-full min-h-0 overflow-hidden rounded-sm ring-1 ring-inset ring-gold/20"
      style={{ cursor: cursorStyle, backgroundColor: CANVAS_COLORS.zoneBodyFill }}
      onMouseEnter={() => {
        canvasHoveredRef.current = true;
      }}
      onMouseLeave={() => {
        canvasHoveredRef.current = false;
      }}
    >
      {/* Ultra-light grain — reads as material depth, not pattern */}
      <div
        className="pointer-events-none absolute inset-0 z-[2] rounded-sm opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E")`,
        }}
        aria-hidden
      />
      <Stage
        ref={stageRef}
        width={viewportW}
        height={viewportH}
        pixelRatio={pixelRatio}
        style={{
          width: viewportW,
          height: viewportH,
          display: "block",
          backgroundColor: CANVAS_COLORS.zoneBodyFill,
        }}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        draggable={false}
        onWheel={handleWheel}
        onClick={handleStageClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => mouseUpHandlerRef.current()}
        onTouchEnd={() => mouseUpHandlerRef.current()}
      >
        <Layer perfectDrawEnabled={false}>
          {/* Floor plan bounds: finite room (clickable), not an infinite grid */}
          <Rect
            name={CANVAS_BG_HIT_NAME}
            x={floorPaintBounds.x}
            y={floorPaintBounds.y}
            width={floorPaintBounds.width}
            height={floorPaintBounds.height}
            fill={CANVAS_COLORS.zoneBodyFill}
            listening
          />

          {/* Dot grid — single Shape (+ optional cache) instead of N Circle nodes */}
          {showGrid && (
            <FloorPlanDotGrid
              worldW={worldW}
              worldH={worldH}
              fill={CANVAS_COLORS.gridDot}
              stagePixelRatio={pixelRatio}
            />
          )}

          {/* Room zones — under furniture, above grid */}
          {zones.map((z) => (
            <FloorPlanZoneShape
              key={z.id}
              zone={z}
              isSelected={z.id === selectedZoneId}
              isEditing={isEditing}
              worldW={worldW}
              worldH={worldH}
              innerRef={z.id === selectedZoneId ? selectedZoneInnerRef : undefined}
              onSelect={() => onZoneSelect?.(z.id)}
              onDragEnd={(nx, ny) => handleZoneDragEnd(z.id, nx, ny)}
            />
          ))}

          {/* Walls */}
          {walls.map((w) => (
            <WallSegment
              key={w.id}
              id={w.id}
              x1={w.x1}
              y1={w.y1}
              x2={w.x2}
              y2={w.y2}
              selected={selectedWallIds.includes(w.id)}
              draggable={isEditing}
              showHandles={isEditing}
              onDragEnd={onWallDragEnd}
              onWallSelect={onWallClickProp && !isWallDrawingTool ? emitWallSelectClick : undefined}
              onEndpointDragMove={(wallId, endpoint, x, y) => {
                // Show snap indicator if near another endpoint
                const eps = collectWallEndpoints(walls, wallId, endpoint);
                const nearest = findNearestEndpoint(x, y, eps);
                setWallSnapTarget(nearest ? { x: nearest.x, y: nearest.y } : null);
              }}
              onEndpointDragEnd={(wallId, endpoint, x, y) => {
                const eps = collectWallEndpoints(walls, wallId, endpoint);
                const nearest = findNearestEndpoint(x, y, eps);
                const rawX = nearest ? nearest.x : applySnap(x);
                const rawY = nearest ? nearest.y : applySnap(y);
                const c = clampPointToWorld(rawX, rawY, worldW, worldH);
                setWallSnapTarget(null);
                onWallEndpointUpdate?.(wallId, endpoint, applySnap(c.x), applySnap(c.y));
              }}
            />
          ))}

          {/* Wall draft (in progress) */}
          {wallDraft.active && (
            <Line
              points={[wallDraft.startX, wallDraft.startY, wallDraft.endX, wallDraft.endY]}
              stroke={CANVAS_COLORS.gold}
              strokeWidth={5}
              dash={[8, 4]}
              lineCap="round"
              listening={false}
            />
          )}

          {/* Wall snap indicator */}
          {wallSnapTarget && (
            <Circle
              x={wallSnapTarget.x}
              y={wallSnapTarget.y}
              radius={10}
              stroke={CANVAS_COLORS.gold}
              strokeWidth={2}
              fill="transparent"
              dash={[4, 3]}
              listening={false}
            />
          )}

          {/* Decorations */}
          {decorations.map((d) => (
            <DecorationItem
              key={d.id}
              item={d}
              selected={d.id === selectedDecorationId}
              draggable={isEditing}
              onClick={onDecorationClickProp ? () => onDecorationClickProp(d.id) : undefined}
              onDragEnd={handleDecorationDragEndClamped}
            />
          ))}

          {/* Tables */}
          {tables.map((t) => (
            <TableShape
              key={t.id}
              table={t}
              x={t.position_x ?? 100}
              y={t.position_y ?? 100}
              isSelected={selectedTableIds.includes(t.id)}
              isEditing={isEditing}
              tableTransform={tableTransforms[t.id] ?? null}
              innerGroupRef={
                showTableTransformer && t.id === singleSelectedTableId
                  ? selectedTableInnerRef
                  : undefined
              }
              opacity={1}
              draggable={isEditing}
              dragBounds={isEditing ? (tableDragBoundsById.get(t.id) ?? null) : null}
              onClick={tableShapeClick}
              onMouseEnter={tableShapeMouseEnter}
              onMouseLeave={tableShapeMouseLeave}
              onDragEnd={tableShapeDragEnd}
              dragging={draggingTableId === t.id}
              onDragStart={tableShapeDragStart}
            />
          ))}

          {snapPulse && (
            <Circle
              x={snapPulse.x}
              y={snapPulse.y}
              radius={16}
              stroke={CANVAS_COLORS.gold}
              strokeWidth={1.5}
              fill="transparent"
              opacity={0.55}
              listening={false}
            />
          )}

          {marquee.active && (
            <Rect
              x={Math.min(marquee.x1, marquee.x2)}
              y={Math.min(marquee.y1, marquee.y2)}
              width={Math.abs(marquee.x2 - marquee.x1)}
              height={Math.abs(marquee.y2 - marquee.y1)}
              stroke={CANVAS_COLORS.gold}
              strokeWidth={1}
              dash={[6, 4]}
              fill={CANVAS_COLORS.goldMarqueeFill}
              listening={false}
            />
          )}

          <Transformer
            ref={transformerRef}
            rotateEnabled={false}
            enabledAnchors={[
              "top-left",
              "top-center",
              "top-right",
              "middle-right",
              "middle-left",
              "bottom-left",
              "bottom-center",
              "bottom-right",
            ]}
            anchorFill={CANVAS_COLORS.goldDark}
            anchorStroke={CANVAS_COLORS.gold}
            anchorSize={9}
            anchorCornerRadius={3}
            borderStroke={CANVAS_COLORS.gold}
            borderStrokeWidth={1}
            boundBoxFunc={(oldBox, newBox) => {
              const minW = 44;
              const minH = 36;
              if (newBox.width < minW || newBox.height < minH) return oldBox;
              return newBox;
            }}
            onTransformEnd={resizeEnabled ? handleTransformerEnd : undefined}
          />

          <Transformer
            ref={zoneTransformerRef}
            rotateEnabled={false}
            enabledAnchors={[
              "top-left",
              "top-center",
              "top-right",
              "middle-right",
              "middle-left",
              "bottom-left",
              "bottom-center",
              "bottom-right",
            ]}
            borderStroke={CANVAS_COLORS.gold}
            borderStrokeWidth={0.9}
            borderDash={[6, 4]}
            anchorFill="rgba(20,20,20,0.95)"
            anchorStroke={CANVAS_COLORS.gold}
            anchorSize={8}
            anchorCornerRadius={2}
            padding={4}
            boundBoxFunc={(oldBox, newBox) => {
              if (newBox.width < 96 || newBox.height < 72) return oldBox;
              return newBox;
            }}
            onTransformEnd={zoneTransformEnabled ? handleZoneTransformerEnd : undefined}
          />
        </Layer>
      </Stage>
      {activeSectionLabel != null && (
        <div
          className="pointer-events-none absolute inset-x-0 top-7 z-[8] select-none text-center text-lg font-semibold uppercase tracking-[0.35em] text-text-muted opacity-[0.32]"
          aria-hidden
        >
          {activeSectionLabel.toUpperCase()}
        </div>
      )}
    </div>
  );
}
