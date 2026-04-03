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
import { SnapGuides } from "./SnapGuides";
import { getTableWorldBounds, TableShape, worldRectsIntersect } from "./TableShape";
import type { FloorPlanMode, HoveredTableInfo, SnapLine, ToolMode, WallDraft } from "./types";
import { FLOOR_PLAN_GRID_STEP } from "./types";
import { WallSegment } from "./WallSegment";

// ─── Dot-grid helper ─────────────────────────────────────────────────────────

const GRID_STEP = FLOOR_PLAN_GRID_STEP;
const DOT_RADIUS = 1;

function buildGridDots(width: number, height: number) {
  const dots: { x: number; y: number }[] = [];
  for (let x = 0; x <= width; x += GRID_STEP) {
    for (let y = 0; y <= height; y += GRID_STEP) {
      dots.push({ x, y });
    }
  }
  return dots;
}

// ─── Snap helpers ─────────────────────────────────────────────────────────────

function snapToGrid(v: number): number {
  return Math.round(v / GRID_STEP) * GRID_STEP;
}

function computeSnapGuides(
  movedId: string,
  newX: number,
  newY: number,
  allTables: TableRow[],
): SnapLine[] {
  const guides: SnapLine[] = [];
  const THRESHOLD = 6;
  allTables.forEach((t) => {
    if (t.id === movedId) return;
    const tx = t.position_x ?? 0;
    const ty = t.position_y ?? 0;
    if (Math.abs(newY - ty) < THRESHOLD) {
      guides.push({ id: `h-${t.id}`, points: [0, newY, 2000, newY], orientation: "horizontal" });
    }
    if (Math.abs(newX - tx) < THRESHOLD) {
      guides.push({ id: `v-${t.id}`, points: [newX, 0, newX, 2000], orientation: "vertical" });
    }
  });
  return guides.slice(0, 4);
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

const MARQUEE_MIN_DRAG_PX = 8;

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

// ─── Section centroid ────────────────────────────────────────────────────────

function sectionCentroid(tables: TableRow[], sectionId: string): { x: number; y: number } | null {
  const matching = tables.filter((t) => t.section_id === sectionId && t.position_x && t.position_y);
  if (matching.length === 0) return null;
  const cx = matching.reduce((s, t) => s + (t.position_x ?? 0), 0) / matching.length;
  const cy = matching.reduce((s, t) => s + (t.position_y ?? 0), 0) / matching.length;
  return { x: cx - 40, y: cy - 50 };
}

// ─── Props ────────────────────────────────────────────────────────────────────

type Wall = { id: string; x1: number; y1: number; x2: number; y2: number };

type FloorPlanCanvasProps = {
  tables: TableRow[];
  walls: Wall[];
  decorations: DecorationModel[];
  sections: SectionRow[];
  selectedSection: string;
  mode: FloorPlanMode;
  selectedTableIds: string[];
  selectedDecorationId: string | null;
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
  /** Owners: Shift+drag on empty canvas to box-select tables. */
  marqueeSelectEnabled?: boolean;
  onMarqueeSelect?: (ids: string[]) => void;
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
  onDecorationClick: onDecorationClickProp,
  onDecorationDragEnd,
  onStageScaleChange,
  onStagePosChange,
  tableTransforms,
  resizeEnabled = false,
  onTableTransformEnd,
  marqueeSelectEnabled = false,
  onMarqueeSelect,
}: FloorPlanCanvasProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const selectedTableInnerRef = useRef<Konva.Group | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapLine[]>([]);
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

  const isEditing = mode === "edit";
  const isWallTool = activeTool === "add-wall";

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
        const ids = tables
          .filter((t) =>
            worldRectsIntersect(box, getTableWorldBounds(t, tableTransforms[t.id] ?? null)),
          )
          .map((t) => t.id);
        onMarqueeSelect?.(ids);
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
      onWallDrawn({
        id: `wall-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        x1: startX,
        y1: startY,
        x2: endX,
        y2: endY,
      });
    }
    const wallCleared = { active: false, startX: 0, startY: 0, endX: 0, endY: 0 };
    wallDraftRef.current = wallCleared;
    setWallDraft(wallCleared);
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

  // Dot grid (memoised — only recomputes when container size changes)
  const gridDots = useMemo(
    () => buildGridDots(Math.max(containerWidth, 1400), Math.max(containerHeight, 1000)),
    [containerWidth, containerHeight],
  );

  // Table opacity based on section filter
  function tableOpacity(table: TableRow): number {
    if (!selectedSection || selectedSection === "all") return 1;
    return table.section_id === selectedSection ? 1 : 0.18;
  }

  // Zoom via scroll wheel
  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const scaleBy = 1.06;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const newScale = e.evt.deltaY < 0
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
    if (!marqueeSelectEnabled || !isEditing || activeTool !== "select") return;
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

  // Wall drawing + owner marquee (Shift+drag on empty stage)
  function handleMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (isEditing && isWallTool) {
      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getRelativePointerPosition();
      if (!pos) return;
      setWallDraft({ active: true, startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y });
      return;
    }
    if (
      isEditing &&
      marqueeSelectEnabled &&
      activeTool === "select" &&
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
    setWallDraft((d) => ({ ...d, endX: snapped.x2, endY: snapped.y2 }));
    e.evt.preventDefault();
  }

  // Table drag (snap to 20px grid + snap guides)
  const handleTableDragMove = useCallback(
    (tableId: string, rawX: number, rawY: number) => {
      const snappedX = snapToGrid(rawX);
      const snappedY = snapToGrid(rawY);
      const guides = computeSnapGuides(tableId, snappedX, snappedY, tables);
      setSnapGuides(guides);
      return { x: snappedX, y: snappedY };
    },
    [tables],
  );

  const handleTableDragEnd = useCallback(
    (tableId: string, rawX: number, rawY: number) => {
      setSnapGuides([]);
      onTableDragEnd(tableId, snapToGrid(rawX), snapToGrid(rawY));
    },
    [onTableDragEnd],
  );

  // Section labels — one per active section that has tables
  const sectionLabels = useMemo(() => {
    return sections
      .filter((s) => s.is_active)
      .map((s) => ({ section: s, centroid: sectionCentroid(tables, s.id) }))
      .filter((item): item is { section: SectionRow; centroid: { x: number; y: number } } => item.centroid !== null);
  }, [sections, tables]);

  const stagePanBlocked =
    marqueeSelectEnabled && isEditing && activeTool === "select" && shiftHeld;
  const cursorStyle =
    isWallTool ? "crosshair" : stagePanBlocked ? "crosshair" : isEditing ? "default" : "grab";

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
        draggable={!isWallTool && !stagePanBlocked}
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
          {/* Canvas background */}
          <Rect
            name={CANVAS_BG_HIT_NAME}
            x={-stagePos.x / stageScale}
            y={-stagePos.y / stageScale}
            width={containerWidth / stageScale + 400}
            height={containerHeight / stageScale + 400}
            fill={CANVAS_COLORS.bgBase}
            listening
          />

          {/* Dot grid */}
          {gridDots.map((d, i) => (
            <Circle
              key={i}
              x={d.x}
              y={d.y}
              radius={DOT_RADIUS}
              fill={CANVAS_COLORS.bgSurface}
              listening={false}
            />
          ))}

          {/* Section background labels */}
          {sectionLabels.map(({ section, centroid }) => (
            <SectionLabel
              key={section.id}
              text={section.name}
              x={centroid.x}
              y={centroid.y}
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
              draggable={isEditing}
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

          {/* Decorations */}
          {decorations.map((d) => (
            <DecorationItem
              key={d.id}
              item={d}
              selected={d.id === selectedDecorationId}
              draggable={isEditing}
              onClick={onDecorationClickProp ? () => onDecorationClickProp(d.id) : undefined}
              onDragEnd={onDecorationDragEnd}
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
              opacity={tableOpacity(t)}
              draggable={isEditing}
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

          {/* Snap guides */}
          {isEditing && <SnapGuides guides={snapGuides} />}
        </Layer>
      </Stage>
    </div>
  );
}
