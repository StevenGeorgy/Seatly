import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { Circle, Layer, Line, Rect, Stage, Transformer } from "react-konva";

import type {
  DecorationItem as DecorationModel,
  FloorPlanLayout,
  SectionRow,
  TableRow,
} from "@/hooks/useFloorPlan";
import { CANVAS_COLORS } from "@/lib/canvas-colors";

import { DecorationItem } from "./DecorationItem";
import { SectionLabel } from "./SectionLabel";
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

function buildGridDots(width: number, height: number) {
  const dots: { x: number; y: number }[] = [];
  for (let x = 0; x <= width; x += GRID_VISUAL_STEP) {
    for (let y = 0; y <= height; y += GRID_VISUAL_STEP) {
      dots.push({ x, y });
    }
  }
  return dots;
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
  containerWidth,
  containerHeight,
  onTableClick,
  onTableHover,
  onCanvasClick,
  onTableDragEnd,
  onWallDrawn,
  onWallEndpointUpdate,
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
}: FloorPlanCanvasProps) {
  const worldW = Math.max(320, worldWidthProp ?? FLOOR_PLAN_DEFAULT_WORLD_WIDTH);
  const worldH = Math.max(240, worldHeightProp ?? FLOOR_PLAN_DEFAULT_WORLD_HEIGHT);

  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const selectedTableInnerRef = useRef<Konva.Group | null>(null);
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
  const isExtendWallTool = activeTool === "extend-wall";
  const isWallDrawingTool = isAddWallTool || isExtendWallTool;

  function emitWallSelectClick(wallId: string) {
    if (!isEditing || isWallDrawingTool) return;
    onWallClickProp?.(wallId);
  }

  const singleSelectedTableId =
    selectedTableIds.length === 1 ? (selectedTableIds[0] ?? null) : null;

  const showTableTransformer =
    isEditing && activeTool === "select" && resizeEnabled && singleSelectedTableId !== null;

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
        x1: snapToGrid(s.x),
        y1: snapToGrid(s.y),
        x2: snapToGrid(e.x),
        y2: snapToGrid(e.y),
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

  // Dot grid — bounded to floor plan world size (not an infinite plane)
  const gridDots = useMemo(() => buildGridDots(worldW, worldH), [worldW, worldH]);

  // Pinch / mouse wheel → zoom; 2-finger trackpad scroll (smooth pixels) → pan
  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    const ev = e.evt;
    ev.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    if (!wheelShouldZoom(ev)) {
      onStagePosChange({
        x: stage.x() - ev.deltaX,
        y: stage.y() - ev.deltaY,
      });
      return;
    }

    const scaleBy = 1.06;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const newScale = ev.deltaY < 0
      ? Math.min(3, oldScale * scaleBy)
      : Math.max(0.3, oldScale / scaleBy);
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };
    onStageScaleChange(newScale);
    onStagePosChange(newPos);
  }

  // Stage drag end — only sync pan when the Stage itself was dragged.
  // Table/wall/decoration dragend bubbles here; e.target would be the child,
  // and using its x/y would corrupt viewport position (grid "teleports").
  function handleStageDragStart(e: Konva.KonvaEventObject<DragEvent>) {
    // Marquee uses stage drag when the stage is draggable (not add-/extend-wall).
    if (!marqueeSelectEnabled || !isEditing || isWallDrawingTool) return;
    const st = stageRef.current;
    if (!st) return;
    const evt = e.evt;
    if (!("shiftKey" in evt) || !evt.shiftKey) return;
    const dragNode = e.target;
    if (dragNode !== st && !isCanvasBackgroundTarget(dragNode)) return;
    st.stopDrag();
    const pos = st.getRelativePointerPosition();
    if (!pos) return;
    const next = { active: true, x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y };
    marqueeRef.current = next;
    setMarquee(next);
  }

  function handleStageDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    const st = node.getStage();
    if (!st || node !== st) return;
    onStagePosChange({ x: st.x(), y: st.y() });
  }

  // Stage click (background) — deselect / place table / start wall
  function handleStageClick(e: Konva.KonvaEventObject<MouseEvent>) {
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
    if (isEditing && isAddWallTool) {
      // add-wall: only start from the floor background (extend-wall uses handle pointerdown).
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
        const sx = snapToGrid(c.x);
        const sy = snapToGrid(c.y);
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
      const t = tables.find((r) => r.id === tableId);
      let x = snapToGrid(rawX);
      let y = snapToGrid(rawY);
      if (t) {
        const c = clampTableCenterAfterSnap(x, y, t, tableTransforms[t.id] ?? null, worldW, worldH);
        x = snapToGrid(c.x);
        y = snapToGrid(c.y);
      }
      onTableDragEnd(tableId, x, y);
    },
    [onTableDragEnd, tables, tableTransforms, worldW, worldH],
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

  // Section watermark — current floor name only
  const sectionLabels = useMemo(() => {
    if (!selectedSection) return [];
    const s = sections.find((x) => x.id === selectedSection);
    if (!s?.is_active) return [];
    return [{ section: s, position: { x: worldW / 2, y: worldH / 2 } }];
  }, [sections, worldW, worldH, selectedSection]);

  const stagePanBlocked =
    marqueeSelectEnabled && isEditing && !isWallDrawingTool && shiftHeld;
  const cursorStyle =
    isWallDrawingTool ? "crosshair" : stagePanBlocked ? "crosshair" : "grab";

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ cursor: cursorStyle }}>
      <Stage
        ref={stageRef}
        width={containerWidth}
        height={containerHeight}
        scaleX={stageScale}
        scaleY={stageScale}
        x={stagePos.x}
        y={stagePos.y}
        draggable={!isWallDrawingTool && !stagePanBlocked}
        onWheel={handleWheel}
        onDragStart={handleStageDragStart}
        onDragEnd={handleStageDragEnd}
        onClick={handleStageClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => mouseUpHandlerRef.current()}
        onTouchEnd={() => mouseUpHandlerRef.current()}
      >
        <Layer>
          {/* Floor plan bounds: finite room (clickable), not an infinite grid */}
          <Rect
            name={CANVAS_BG_HIT_NAME}
            x={0}
            y={0}
            width={worldW}
            height={worldH}
            fill={CANVAS_COLORS.bgBase}
            listening
          />
          <Rect
            x={0}
            y={0}
            width={worldW}
            height={worldH}
            stroke={CANVAS_COLORS.border}
            strokeWidth={2}
            fill="transparent"
            listening={false}
          />

          {/* Dot grid */}
          {gridDots.map((d, i) => (
            <Circle
              key={i}
              x={d.x}
              y={d.y}
              radius={DOT_RADIUS}
              fill={CANVAS_COLORS.gridDot}
              listening={false}
            />
          ))}

          {/* Section background labels */}
          {sectionLabels.map(({ section, position }) => (
            <SectionLabel
              key={section.id}
              text={section.name}
              x={position.x}
              y={position.y}
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
              endpointHandlesDraggable={!isExtendWallTool}
              onWallSelect={onWallClickProp && !isWallDrawingTool ? emitWallSelectClick : undefined}
              onEndpointPointerDown={
                isEditing && isExtendWallTool
                  ? (_wallId, _ep, wx, wy) => {
                      const c = clampPointToWorld(wx, wy, worldW, worldH);
                      const sx = snapToGrid(c.x);
                      const sy = snapToGrid(c.y);
                      setWallDraft({
                        active: true,
                        startX: sx,
                        startY: sy,
                        endX: sx,
                        endY: sy,
                      });
                    }
                  : undefined
              }
              onEndpointDragMove={(wallId, endpoint, x, y) => {
                // Show snap indicator if near another endpoint
                const eps = collectWallEndpoints(walls, wallId, endpoint);
                const nearest = findNearestEndpoint(x, y, eps);
                setWallSnapTarget(nearest ? { x: nearest.x, y: nearest.y } : null);
              }}
              onEndpointDragEnd={(wallId, endpoint, x, y) => {
                const eps = collectWallEndpoints(walls, wallId, endpoint);
                const nearest = findNearestEndpoint(x, y, eps);
                const rawX = nearest ? nearest.x : snapToGrid(x);
                const rawY = nearest ? nearest.y : snapToGrid(y);
                const c = clampPointToWorld(rawX, rawY, worldW, worldH);
                setWallSnapTarget(null);
                onWallEndpointUpdate?.(wallId, endpoint, snapToGrid(c.x), snapToGrid(c.y));
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
              dragBounds={isEditing ? tableDragBoundsForWorld(t, tableTransforms[t.id] ?? null, worldW, worldH) : null}
              onClick={(ev) => onTableClick(t.id, ev)}
              onMouseEnter={(sx, sy) => onTableHover({ table: t, screenX: sx, screenY: sy })}
              onMouseLeave={() => onTableHover(null)}
              onDragEnd={(rx, ry) => handleTableDragEnd(t.id, rx, ry)}
            />
          ))}

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
            anchorSize={10}
            anchorCornerRadius={2}
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
        </Layer>
      </Stage>
    </div>
  );
}
