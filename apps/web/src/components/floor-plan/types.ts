import type { DecorationItem, FloorPlanLayout, SectionRow, TableRow } from "@/hooks/useFloorPlan";

// ─── Mode ────────────────────────────────────────────────────────────────────

export type FloorPlanMode = "live" | "edit";

// ─── Tool ────────────────────────────────────────────────────────────────────

export type ToolMode =
  | "select"
  | "add-rect-table"
  | "add-circle-table"
  | "add-square-table"
  | "add-wall"
  | "add-decoration"
  | "add-section-label"
  | "delete";

// ─── Snap ────────────────────────────────────────────────────────────────────

/** Floor-plan canvas snap step (matches grid); use when placing tables from pointer. */
export const FLOOR_PLAN_GRID_STEP = 20;

export type SnapLine = {
  id: string;
  points: [number, number, number, number];
  orientation: "horizontal" | "vertical";
};

// ─── Wall drawing state ───────────────────────────────────────────────────────

export type WallDraft = {
  active: boolean;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

// ─── Tooltip ─────────────────────────────────────────────────────────────────

export type HoveredTableInfo = {
  table: TableRow;
  screenX: number;
  screenY: number;
};

// ─── History snapshot ────────────────────────────────────────────────────────

export type HistorySnapshot = {
  tablesDraft: TableRow[];
  layoutDraft: FloorPlanLayout;
};

// ─── Canvas props (passed down to FloorPlanCanvas) ────────────────────────────

export type FloorPlanCanvasProps = {
  tables: TableRow[];
  layoutDraft: FloorPlanLayout;
  sections: SectionRow[];
  selectedSection: string;
  mode: FloorPlanMode;
  selectedTableIds: string[];
  activeTool: ToolMode;
  stageScale: number;
  onTableClick: (tableId: string, evt: import("konva").KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onTableHover: (info: HoveredTableInfo | null) => void;
  onCanvasClick: (worldX: number, worldY: number) => void;
  onTableDragEnd: (tableId: string, x: number, y: number) => void;
  onWallDrawn: (wall: { id: string; x1: number; y1: number; x2: number; y2: number }) => void;
  onDecorationDragEnd: (id: string, x: number, y: number) => void;
  onStageScaleChange: (scale: number) => void;
  onStageDragEnd: (x: number, y: number) => void;
  stagePos: { x: number; y: number };
  containerWidth: number;
  containerHeight: number;
};

// ─── Decoration preset ────────────────────────────────────────────────────────

export type DecorationPreset = {
  type: DecorationItem["type"];
  labelKey: string;
  width: number;
  height: number;
};
