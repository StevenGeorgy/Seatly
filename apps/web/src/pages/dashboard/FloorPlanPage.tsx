import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type Konva from "konva";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { FloorPlanCanvas } from "@/components/floor-plan/FloorPlanCanvas";
import { FloorPlanEmptyState } from "@/components/floor-plan/FloorPlanEmptyState";
import { FloorPlanToolbar } from "@/components/floor-plan/FloorPlanToolbar";
import { SectionTabs } from "@/components/floor-plan/SectionTabs";
import { StatusLegend } from "@/components/floor-plan/StatusLegend";
import { TableDetailDrawer } from "@/components/floor-plan/TableDetailDrawer";
import { TablePropertiesPanel } from "@/components/floor-plan/TablePropertiesPanel";
import { TableTooltip } from "@/components/floor-plan/TableTooltip";
import { ZoomControls } from "@/components/floor-plan/ZoomControls";
import type {
  FloorPlanMode,
  HoveredTableInfo,
  ToolMode,
} from "@/components/floor-plan/types";
import { FLOOR_PLAN_GRID_STEP } from "@/components/floor-plan/types";
import { useUser } from "@/hooks/useUser";
import { useFloorPlan, isDatabaseUuid } from "@/hooks/useFloorPlan";
import type { FloorPlanLayout, SectionRow, TableRow } from "@/hooks/useFloorPlan";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { Button } from "@/components/ui/button";

// ─── Undo / redo reducer ──────────────────────────────────────────────────────

type HistoryEntry = { tables: TableRow[]; layout: FloorPlanLayout };

type HistoryState = {
  past: HistoryEntry[];
  present: HistoryEntry;
  future: HistoryEntry[];
};

type HistoryAction =
  | { type: "PUSH"; entry: HistoryEntry }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "RESET"; entry: HistoryEntry };

const MAX_HISTORY = 30;

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "PUSH": {
      const past = [...state.past, state.present].slice(-MAX_HISTORY);
      return { past, present: action.entry, future: [] };
    }
    case "UNDO": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
      };
    }
    case "REDO": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
      };
    }
    case "RESET":
      return { past: [], present: action.entry, future: [] };
    default:
      return state;
  }
}

function emptyLayout(): FloorPlanLayout {
  return { walls: [], doors: [], windows: [], tableTransforms: {}, decorations: [] };
}

const LOCAL_TABLE_ID_PREFIX = "local-" as const;

function buildLocalDraftTable(
  shape: string,
  x: number,
  y: number,
  restaurantId: string,
  sectionList: SectionRow[],
): TableRow {
  const sectionId = sectionList[0]?.id ?? "";
  const sectionName = sectionList.find((s) => s.id === sectionId)?.name ?? null;
  return {
    id: `${LOCAL_TABLE_ID_PREFIX}${globalThis.crypto.randomUUID()}`,
    restaurant_id: restaurantId,
    table_number: null,
    label: null,
    capacity: 4,
    min_party: 1,
    section: sectionName,
    section_id: sectionId || null,
    position_x: x,
    position_y: y,
    shape,
    status: "empty",
    combined_with: null,
    qr_code_url: null,
    notes: null,
    is_active: true,
    updated_at: null,
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FloorPlanPage() {
  const { t } = useTranslation();
  const { hasStaffRole } = useUser();
  const { selectedRestaurantId } = useRestaurantScope();
  const {
    tables: dbTables,
    sections,
    floorPlans,
    loading,
    error,
    updateTable,
    createTable,
    deleteTable,
    updateLayout,
    refetch,
  } = useFloorPlan();

  // ── Derived permissions ────────────────────────────────────────────────────
  const canEdit =
    hasStaffRole("owner") || hasStaffRole("manager") || hasStaffRole("host");
  const canResizeTables = hasStaffRole("owner");

  // ── Page mode ──────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<FloorPlanMode>("live");
  const [activeTool, setActiveTool] = useState<ToolMode>("select");
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [selectedDecorationId, setSelectedDecorationId] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string>("all");
  const [hoveredTable, setHoveredTable] = useState<HoveredTableInfo | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // ── Zoom / pan ─────────────────────────────────────────────────────────────
  const [stageScale, setStageScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

  /** Snapshot when entering edit mode — used on Save to diff creates/updates/deletes (draft stays local until then). */
  const editBaselineRef = useRef<{ tables: TableRow[]; layout: FloorPlanLayout } | null>(null);

  // Container size for Stage
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setContainerSize({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Undo / redo ────────────────────────────────────────────────────────────
  const activeFloorPlan = floorPlans[0] ?? null;
  const initialLayout: FloorPlanLayout =
    (activeFloorPlan?.layout as FloorPlanLayout | null) ?? emptyLayout();

  const [historyState, dispatch] = useReducer(historyReducer, {
    past: [],
    present: { tables: dbTables, layout: initialLayout },
    future: [],
  });

  // Sync history present when DB data loads or changes (live mode)
  useEffect(() => {
    if (mode === "live") {
      dispatch({ type: "RESET", entry: { tables: dbTables, layout: initialLayout } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbTables, mode]);

  const tablesDraft = historyState.present.tables;
  const layoutDraft = historyState.present.layout;

  // Hover tooltip keeps a snapshot of the table; if that row is deleted (or undone off the canvas),
  // Konva may not fire mouseLeave — clear so the popover does not float over empty grid.
  useEffect(() => {
    setHoveredTable((prev) => {
      if (!prev) return null;
      return tablesDraft.some((t) => t.id === prev.table.id) ? prev : null;
    });
  }, [tablesDraft]);

  function pushHistory(tables: TableRow[], layout: FloorPlanLayout) {
    dispatch({ type: "PUSH", entry: { tables, layout } });
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "UNDO" });
      }
      if ((e.key === "Z" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        dispatch({ type: "REDO" });
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ── Selected table object ──────────────────────────────────────────────────
  const selectedTable =
    selectedTableIds.length === 1
      ? tablesDraft.find((t) => t.id === selectedTableIds[0]) ?? null
      : null;

  // ── Mode switching ─────────────────────────────────────────────────────────
  function enterEditMode() {
    const layoutSnapshot =
      (activeFloorPlan?.layout as FloorPlanLayout | null) ?? emptyLayout();
    editBaselineRef.current = {
      tables: dbTables.map((row) => ({ ...row })),
      layout: JSON.parse(JSON.stringify(layoutSnapshot)) as FloorPlanLayout,
    };
    dispatch({ type: "RESET", entry: { tables: dbTables, layout: layoutSnapshot } });
    setMode("edit");
    setActiveTool("select");
    setSelectedTableIds([]);
    setSelectedDecorationId(null);
  }

  function cancelEditMode() {
    editBaselineRef.current = null;
    setMode("live");
    setActiveTool("select");
    setSelectedTableIds([]);
    setSelectedDecorationId(null);
    dispatch({ type: "RESET", entry: { tables: dbTables, layout: initialLayout } });
  }

  // ── Save — persist only on explicit Save; diff against edit baseline ──────────
  async function saveAll() {
    setIsSaving(true);
    try {
      const baseline = editBaselineRef.current ?? {
        tables: dbTables,
        layout: initialLayout,
      };
      const draftIds = new Set(tablesDraft.map((t) => t.id));
      const baselineIds = new Set(baseline.tables.map((t) => t.id));

      for (const t of baseline.tables) {
        if (!draftIds.has(t.id) && isDatabaseUuid(t.id)) {
          const ok = await deleteTable(t.id, { refetchAfter: false });
          if (!ok) throw new Error("delete failed");
        }
      }

      for (const t of tablesDraft) {
        if (t.id.startsWith(LOCAL_TABLE_ID_PREFIX)) {
          const created = await createTable({
            sectionId: t.section_id ?? sections[0]?.id ?? "",
            label: t.label ?? "",
            tableNumber: t.table_number,
            shape: t.shape,
            capacity: t.capacity,
            x: t.position_x ?? 0,
            y: t.position_y ?? 0,
            minParty: t.min_party,
            status: t.status,
            notes: t.notes,
          });
          if (!created) throw new Error("create failed");
          continue;
        }
        if (isDatabaseUuid(t.id) && baselineIds.has(t.id)) {
          const ok = await updateTable(t.id, {
            position_x: t.position_x,
            position_y: t.position_y,
            shape: t.shape,
            capacity: t.capacity,
            min_party: t.min_party,
            label: t.label,
            table_number: t.table_number,
            section_id: t.section_id,
            notes: t.notes,
            status: t.status,
          });
          if (!ok) throw new Error("update failed");
        }
      }

      if (activeFloorPlan) {
        const ok = await updateLayout(activeFloorPlan.id, layoutDraft);
        if (!ok) throw new Error("layout failed");
      }

      await refetch();
      editBaselineRef.current = null;
      toast.success(t("dashboard.floorPlan.tableSaved"));
      setMode("live");
    } catch {
      toast.error(t("dashboard.floorPlan.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  // ── Table interactions ─────────────────────────────────────────────────────

  const deleteTablesFromDraft = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      const updated = tablesDraft.filter((t) => !idSet.has(t.id));
      dispatch({ type: "PUSH", entry: { tables: updated, layout: layoutDraft } });
      setSelectedTableIds((prev) => prev.filter((tid) => !idSet.has(tid)));
    },
    [tablesDraft, layoutDraft],
  );

  const handleDeleteTable = useCallback(
    (id: string) => {
      deleteTablesFromDraft([id]);
    },
    [deleteTablesFromDraft],
  );

  const removeDecoration = useCallback(
    (id: string) => {
      const decorations = layoutDraft.decorations.filter((d) => d.id !== id);
      dispatch({
        type: "PUSH",
        entry: { tables: tablesDraft, layout: { ...layoutDraft, decorations } },
      });
      setSelectedDecorationId((prev) => (prev === id ? null : prev));
    },
    [tablesDraft, layoutDraft],
  );

  useEffect(() => {
    if (mode !== "edit" || !canEdit) return;
    if (selectedTableIds.length === 0 && !selectedDecorationId) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.isComposing) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable=true]")
      ) {
        return;
      }
      if (selectedDecorationId) {
        e.preventDefault();
        removeDecoration(selectedDecorationId);
        return;
      }
      if (selectedTableIds.length > 0) {
        e.preventDefault();
        deleteTablesFromDraft(selectedTableIds);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    mode,
    canEdit,
    selectedTableIds,
    selectedDecorationId,
    deleteTablesFromDraft,
    removeDecoration,
  ]);

  function handleDecorationClick(id: string) {
    if (activeTool === "delete") {
      removeDecoration(id);
      return;
    }
    setSelectedTableIds([]);
    setSelectedDecorationId((prev) => (prev === id ? null : id));
  }

  function handleTableClick(id: string, e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    setSelectedDecorationId(null);
    if (activeTool === "delete") {
      handleDeleteTable(id);
      return;
    }
    const shiftHeld = "shiftKey" in e.evt && e.evt.shiftKey;
    if (mode === "live") {
      setSelectedTableIds((prev) => (prev.length === 1 && prev[0] === id ? [] : [id]));
      return;
    }
    if (shiftHeld && canResizeTables) {
      setSelectedTableIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      );
      return;
    }
    setSelectedTableIds((prev) => (prev.length === 1 && prev[0] === id ? [] : [id]));
  }

  function handleCanvasClick(worldX: number, worldY: number) {
    // Place new table when an add-tool is active (draft-only until Save)
    if (
      mode !== "edit" ||
      activeTool === "select" ||
      activeTool === "add-wall" ||
      activeTool === "delete"
    ) {
      setSelectedTableIds([]);
      setSelectedDecorationId(null);
      return;
    }
    const shapeMap: Record<string, string> = {
      "add-rect-table": "rectangle",
      "add-circle-table": "circle",
      "add-square-table": "square",
    };
    const shape = shapeMap[activeTool];
    if (!shape || !selectedRestaurantId) return;

    const gx = Math.round(worldX / FLOOR_PLAN_GRID_STEP) * FLOOR_PLAN_GRID_STEP;
    const gy = Math.round(worldY / FLOOR_PLAN_GRID_STEP) * FLOOR_PLAN_GRID_STEP;

    const newTable = buildLocalDraftTable(
      shape,
      gx,
      gy,
      selectedRestaurantId,
      sections,
    );
    pushHistory([...tablesDraft, newTable], layoutDraft);
  }

  function handleTableDragEnd(id: string, x: number, y: number) {
    const updated = tablesDraft.map((t) =>
      t.id === id ? { ...t, position_x: x, position_y: y } : t,
    );
    pushHistory(updated, layoutDraft);
  }

  function handleTablePatch(id: string, patch: Partial<TableRow>) {
    const updated = tablesDraft.map((t) => (t.id === id ? { ...t, ...patch } : t));
    pushHistory(updated, layoutDraft);
  }

  function handleTableTransformEnd(tableId: string, scaleX: number, scaleY: number) {
    const prev = layoutDraft.tableTransforms[tableId] ?? {
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    };
    const tableTransforms = {
      ...layoutDraft.tableTransforms,
      [tableId]: { ...prev, scaleX, scaleY },
    };
    pushHistory(tablesDraft, { ...layoutDraft, tableTransforms });
  }

  async function handleLiveStatusChange(tableId: string, status: string) {
    await updateTable(tableId, { status });
    await refetch();
  }

  // ── Wall / decoration ──────────────────────────────────────────────────────

  type Wall = { id: string; x1: number; y1: number; x2: number; y2: number };

  function handleWallDrawn(wall: Wall) {
    const updatedLayout = { ...layoutDraft, walls: [...layoutDraft.walls, wall] };
    pushHistory(tablesDraft, updatedLayout);
  }

  function handleDecorationDragEnd(id: string, x: number, y: number) {
    const updatedDecorations = layoutDraft.decorations.map((d) =>
      d.id === id ? { ...d, x, y } : d,
    );
    pushHistory(tablesDraft, { ...layoutDraft, decorations: updatedDecorations });
  }

  // ── Zoom helpers ───────────────────────────────────────────────────────────

  const ZOOM_STEP = 0.15;

  function zoomIn() {
    setStageScale((s) => Math.min(3, s + ZOOM_STEP));
  }

  function zoomOut() {
    setStageScale((s) => Math.max(0.3, s - ZOOM_STEP));
  }

  function resetZoom() {
    setStageScale(1);
    setStagePos({ x: 0, y: 0 });
  }

  // ── Loading / error ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <div className="h-7 w-44 animate-pulse rounded-lg bg-bg-elevated" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-bg-elevated" />
        </div>
        <div className="flex-1 animate-pulse rounded-xl bg-bg-elevated" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-danger">{error.message}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          {t("common.actions.retry")}
        </Button>
      </div>
    );
  }

  const isEmpty = dbTables.length === 0;

  return (
    <div className="flex h-full flex-col">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <h1 className="text-sm font-semibold text-text-primary">
          {t("dashboard.floorPlan.title")}
        </h1>

        {/* Section tabs */}
        <div className="flex-1 overflow-hidden">
          <SectionTabs
            sections={sections.filter((s) => s.is_active)}
            selected={selectedSection}
            onChange={setSelectedSection}
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Edit / save / cancel */}
          {canEdit && mode === "live" && (
            <Button variant="outline" size="sm" onClick={enterEditMode}>
              {t("common.actions.edit")}
            </Button>
          )}
          {mode === "edit" && (
            <>
              <Button variant="ghost" size="sm" onClick={cancelEditMode}>
                {t("dashboard.floorPlan.cancelEdit")}
              </Button>
              <Button size="sm" disabled={isSaving} onClick={() => void saveAll()}>
                {isSaving ? t("dashboard.floorPlan.statusSaving") : t("common.actions.save")}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Canvas area ─────────────────────────────────────────────────── */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Left toolbar (edit mode only) */}
        {mode === "edit" && (
          <div className="flex shrink-0 flex-col items-center gap-2 border-r border-border bg-bg-surface px-2 py-3">
            <FloorPlanToolbar activeTool={activeTool} onToolChange={setActiveTool} />
          </div>
        )}

        {/* Main canvas */}
        <div ref={containerRef} className="relative flex-1 overflow-hidden">
          {isEmpty && mode === "live" ? (
            <FloorPlanEmptyState canEdit={canEdit} onEnterEdit={enterEditMode} />
          ) : (
            <FloorPlanCanvas
              tables={tablesDraft}
              walls={layoutDraft.walls}
              decorations={layoutDraft.decorations}
              sections={sections}
              selectedSection={selectedSection}
              mode={mode}
              selectedTableIds={selectedTableIds}
              selectedDecorationId={selectedDecorationId}
              activeTool={activeTool}
              stageScale={stageScale}
              stagePos={stagePos}
              containerWidth={containerSize.w}
              containerHeight={containerSize.h}
              onTableClick={handleTableClick}
              onTableHover={setHoveredTable}
              onCanvasClick={(x, y) => void handleCanvasClick(x, y)}
              onTableDragEnd={handleTableDragEnd}
              onWallDrawn={handleWallDrawn}
              onDecorationClick={mode === "edit" && canEdit ? handleDecorationClick : undefined}
              onDecorationDragEnd={handleDecorationDragEnd}
              onStageScaleChange={setStageScale}
              onStagePosChange={setStagePos}
              tableTransforms={layoutDraft.tableTransforms}
              resizeEnabled={canResizeTables}
              onTableTransformEnd={handleTableTransformEnd}
              marqueeSelectEnabled={canResizeTables}
              onMarqueeSelect={(ids) => {
                setSelectedTableIds(ids);
                setSelectedDecorationId(null);
              }}
            />
          )}

          {/* Bottom overlays */}
          <div className="pointer-events-none absolute bottom-4 left-4 flex flex-col items-start gap-2">
            <div className="pointer-events-auto">
              <StatusLegend />
            </div>
          </div>

          <div className="pointer-events-none absolute bottom-4 right-4">
            <div className="pointer-events-auto">
              <ZoomControls
                scale={stageScale}
                onZoomIn={zoomIn}
                onZoomOut={zoomOut}
                onReset={resetZoom}
              />
            </div>
          </div>

          {/* Undo / redo hint in edit mode */}
          {mode === "edit" && (
            <div className="pointer-events-none absolute right-4 top-4 flex flex-col items-end gap-2">
              <div className="flex gap-1">
                <Button
                  className="pointer-events-auto"
                  variant="outline"
                  size="sm"
                  disabled={historyState.past.length === 0}
                  onClick={() => dispatch({ type: "UNDO" })}
                >
                  {t("dashboard.floorPlan.undo")}
                </Button>
                <Button
                  className="pointer-events-auto"
                  variant="outline"
                  size="sm"
                  disabled={historyState.future.length === 0}
                  onClick={() => dispatch({ type: "REDO" })}
                >
                  {t("dashboard.floorPlan.redo")}
                </Button>
              </div>
              {canResizeTables && (
                <p className="max-w-[14rem] text-right text-xs text-text-muted">
                  {t("dashboard.floorPlan.marqueeSelectHint")}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right panel: properties (edit) or nothing (live detail drawer handles it) */}
        {mode === "edit" && selectedTable && (
          <TablePropertiesPanel
            table={selectedTable}
            sections={sections}
            onPatch={handleTablePatch}
            onDelete={handleDeleteTable}
          />
        )}
      </div>

      {/* Live mode: detail drawer */}
      {mode === "live" && (
        <TableDetailDrawer
          table={selectedTable}
          sections={sections}
          onClose={() => setSelectedTableIds([])}
          onUpdateStatus={(id, status) => void handleLiveStatusChange(id, status)}
        />
      )}

      {/* Tooltip */}
      <TableTooltip info={hoveredTable} />
    </div>
  );
}
