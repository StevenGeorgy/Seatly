import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type Konva from "konva";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Loader2, Plus } from "lucide-react";

import { AddFloorDialog } from "@/components/floor-plan/AddFloorDialog";
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
import {
  FLOOR_PLAN_DEFAULT_WORLD_HEIGHT,
  FLOOR_PLAN_DEFAULT_WORLD_WIDTH,
  FLOOR_PLAN_GRID_STEP,
} from "@/components/floor-plan/types";
import { ensureTableNumbersForSave, nextSequentialTableNumber } from "@/lib/table-number";
import { isSupabaseConfigured } from "@/lib/supabase/client";
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

function parseLayoutFromFloorPlanRow(
  row: { layout: unknown } | null | undefined,
): FloorPlanLayout {
  const rawLayout = row?.layout as unknown;
  if (rawLayout == null) {
    return emptyLayout();
  }
  if (typeof rawLayout === "string") {
    try {
      const parsed = JSON.parse(rawLayout) as FloorPlanLayout;
      return parsed && typeof parsed === "object" ? parsed : emptyLayout();
    } catch {
      return emptyLayout();
    }
  }
  if (typeof rawLayout === "object") {
    return JSON.parse(JSON.stringify(rawLayout)) as FloorPlanLayout;
  }
  return emptyLayout();
}

const LOCAL_TABLE_ID_PREFIX = "local-" as const;

function buildLocalDraftTable(
  shape: string,
  x: number,
  y: number,
  restaurantId: string,
  sectionList: SectionRow[],
  existingTables: TableRow[],
  preferredSectionId: string | null,
): TableRow {
  const sectionId =
    preferredSectionId && sectionList.some((s) => s.id === preferredSectionId)
      ? preferredSectionId
      : sectionList[0]?.id ?? "";
  const sectionName = sectionList.find((s) => s.id === sectionId)?.name ?? null;
  return {
    id: `${LOCAL_TABLE_ID_PREFIX}${globalThis.crypto.randomUUID()}`,
    restaurant_id: restaurantId,
    table_number: nextSequentialTableNumber(existingTables),
    label: null,
    capacity: 4,
    min_party: 1,
    section: sectionName,
    section_id: sectionId || null,
    position_x: x,
    position_y: y,
    shape,
    status: "empty",
    seated_count: 0,
    combined_with: null,
    qr_code_url: null,
    notes: null,
    is_active: true,
    updated_at: null,
  };
}

// ─── Autosave indicator (self-contained — never re-renders the parent) ────────

type SaveStatus = "idle" | "saving" | "saved" | "error";

function AutosaveIndicator({
  statusRef,
  listenersRef,
}: {
  statusRef: React.RefObject<SaveStatus>;
  listenersRef: React.RefObject<Set<() => void>>;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    const update = () => setStatus(statusRef.current);
    listenersRef.current.add(update);
    return () => { listenersRef.current.delete(update); };
  }, [statusRef, listenersRef]);

  if (status === "idle") return null;

  return (
    <span className="flex items-center gap-1.5 text-xs text-text-muted">
      {status === "saving" && (
        <>
          <Loader2 className="size-3 animate-spin text-gold" />
          <span className="text-text-secondary">Saving…</span>
        </>
      )}
      {status === "saved" && (
        <>
          <Check className="size-3 text-success" />
          <span className="text-success">Saved</span>
        </>
      )}
      {status === "error" && (
        <span className="text-danger">Save failed</span>
      )}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FloorPlanPage() {
  const { t } = useTranslation();
  const { rolesAtRestaurant } = useUser();
  const { selectedRestaurantId } = useRestaurantScope();

  // ── Page mode (declared before useFloorPlan so pauseRealtime can read it) ──
  const [mode, setMode] = useState<FloorPlanMode>("live");

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
    createSectionAndFloor,
  } = useFloorPlan({ pauseRealtime: mode === "edit" });

  // ── Derived permissions (scoped to selected restaurant; matches dashboard floor-plan route) ──
  const rolesHere = selectedRestaurantId
    ? rolesAtRestaurant(selectedRestaurantId)
    : [];
  const canEdit = rolesHere.some(
    (r) =>
      r.role === "owner" ||
      r.role === "manager" ||
      r.role === "host" ||
      r.role === "server",
  );
  const canResizeTables = rolesHere.some((r) => r.role === "owner");
  const [activeTool, setActiveTool] = useState<ToolMode>("select");
  const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
  const [selectedDecorationId, setSelectedDecorationId] = useState<string | null>(null);
  const [selectedWallIds, setSelectedWallIds] = useState<string[]>([]);
  const [selectedSection, setSelectedSection] = useState<string>("");
  const [addFloorOpen, setAddFloorOpen] = useState(false);
  const [addFloorPending, setAddFloorPending] = useState(false);
  const [hoveredTable, setHoveredTable] = useState<HoveredTableInfo | null>(null);

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

  // Keep a valid floor tab selected whenever sections load or change
  useEffect(() => {
    const active = sections.filter((s) => s.is_active);
    if (active.length === 0) return;
    setSelectedSection((prev) => {
      if (prev && active.some((s) => s.id === prev)) return prev;
      return active[0].id;
    });
  }, [sections]);

  // ── Undo / redo — active layout row follows selected section tab (never fall back to another floor) ──
  const activeFloorPlan = useMemo(() => {
    if (floorPlans.length === 0 || !selectedSection) return null;
    return floorPlans.find((fp) => fp.section_id === selectedSection) ?? null;
  }, [floorPlans, selectedSection]);

  /** Matches FloorPlanCanvas world size (floor_plans.canvas_* or compact defaults). */
  const worldBounds = useMemo(() => {
    const w = Math.max(320, activeFloorPlan?.canvas_width ?? FLOOR_PLAN_DEFAULT_WORLD_WIDTH);
    const h = Math.max(240, activeFloorPlan?.canvas_height ?? FLOOR_PLAN_DEFAULT_WORLD_HEIGHT);
    return { w, h };
  }, [activeFloorPlan?.canvas_width, activeFloorPlan?.canvas_height]);

  const initialLayout = useMemo(
    () => parseLayoutFromFloorPlanRow(activeFloorPlan),
    [activeFloorPlan],
  );

  const [historyState, dispatch] = useReducer(historyReducer, {
    past: [],
    present: { tables: dbTables, layout: initialLayout },
    future: [],
  });

  // Sync history present when DB data loads, section tab changes, or layout row changes (live mode)
  useEffect(() => {
    if (mode === "live") {
      dispatch({ type: "RESET", entry: { tables: dbTables, layout: initialLayout } });
    }
  }, [dbTables, mode, initialLayout]);

  const tablesDraft = historyState.present.tables;
  const layoutDraft = historyState.present.layout;

  /** Viewport: one floor at a time (state still holds all tables for save). */
  const tablesForCanvas = useMemo(() => {
    if (!selectedSection) return [];
    return tablesDraft.filter((t) => t.section_id === selectedSection);
  }, [tablesDraft, selectedSection]);

  // Drop selection / hover when they reference tables hidden on another floor.
  useEffect(() => {
    setSelectedTableIds((prev) =>
      prev.filter((id) => {
        const row = tablesDraft.find((t) => t.id === id);
        if (!row) return false;
        return row.section_id === selectedSection;
      }),
    );
  }, [selectedSection, tablesDraft]);

  // Hover tooltip: clear if table removed, or if that table belongs to another floor tab.
  useEffect(() => {
    setHoveredTable((prev) => {
      if (!prev) return null;
      if (!tablesDraft.some((t) => t.id === prev.table.id)) return null;
      if (!selectedSection) return null;
      return prev.table.section_id === selectedSection ? prev : null;
    });
  }, [tablesDraft, selectedSection]);

  function pushHistory(tables: TableRow[], layout: FloorPlanLayout) {
    dispatch({ type: "PUSH", entry: { tables, layout } });
    setEditSeq((n) => n + 1);
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "UNDO" });
        setEditSeq((n) => n + 1);
      }
      if ((e.key === "Z" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        dispatch({ type: "REDO" });
        setEditSeq((n) => n + 1);
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

  /** Fit world 0…W × 0…H into the Stage so the room border stays visible (e.g. when the properties panel opens). */
  const fitWorldToViewport = useCallback(() => {
    const w = worldBounds.w;
    const h = worldBounds.h;
    const cw = containerSize.w;
    const ch = containerSize.h;
    if (cw < 1 || ch < 1 || w < 1 || h < 1) return;
    const padding = 0.96;
    const raw = Math.min((cw * padding) / w, (ch * padding) / h);
    const scale = Math.min(3, Math.max(0.3, raw));
    const px = cw / 2 - (w / 2) * scale;
    const py = ch / 2 - (h / 2) * scale;
    setStageScale(scale);
    setStagePos({ x: px, y: py });
  }, [worldBounds.w, worldBounds.h, containerSize.w, containerSize.h]);

  const selectedKey =
    selectedTableIds.length === 1 ? (selectedTableIds[0] ?? "") : "";

  const prevModeForFitRef = useRef<FloorPlanMode>(mode);
  useEffect(() => {
    if (!selectedKey) return;
    if (containerSize.w < 20) return;
    fitWorldToViewport();
  }, [selectedKey, containerSize.w, containerSize.h, fitWorldToViewport]);

  useEffect(() => {
    if (containerSize.w < 20) return;
    fitWorldToViewport();
  }, [selectedSection, worldBounds.w, worldBounds.h, containerSize.w, containerSize.h, fitWorldToViewport]);

  useEffect(() => {
    const wasEdit = prevModeForFitRef.current === "edit";
    const nowEdit = mode === "edit";
    if (!wasEdit && nowEdit) {
      const t = window.setTimeout(() => fitWorldToViewport(), 0);
      const t2 = window.setTimeout(() => fitWorldToViewport(), 150);
      prevModeForFitRef.current = mode;
      return () => {
        clearTimeout(t);
        clearTimeout(t2);
      };
    }
    prevModeForFitRef.current = mode;
  }, [mode, fitWorldToViewport]);

  // Restore edit mode after navigating away / refresh while sessionStorage still marks edit (not on tab blur alone).
  useEffect(() => {
    if (!selectedRestaurantId || loading) return;
    if (mode !== "live") return;
    let shouldRestore = false;
    try {
      shouldRestore = sessionStorage.getItem(`seatly:floor-plan-edit-${selectedRestaurantId}`) === "1";
    } catch {
      return;
    }
    if (!shouldRestore) return;
    enterEditMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot when layout data is ready
  }, [loading, selectedRestaurantId, mode]);

  // ── Mode switching ─────────────────────────────────────────────────────────
  function enterEditMode() {
    const layoutSnapshot = parseLayoutFromFloorPlanRow(activeFloorPlan);
    editBaselineRef.current = {
      tables: dbTables.map((row) => ({ ...row })),
      layout: JSON.parse(JSON.stringify(layoutSnapshot)) as FloorPlanLayout,
    };
    dispatch({ type: "RESET", entry: { tables: dbTables, layout: layoutSnapshot } });
    hasEditedRef.current = false;
    idMapRef.current.clear();
    notifySaveStatus("idle");
    setMode("edit");
    setActiveTool("select");
    setSelectedTableIds([]);
    setSelectedDecorationId(null);
    setSelectedWallIds([]);
    try {
      if (selectedRestaurantId) {
        sessionStorage.setItem(`seatly:floor-plan-edit-${selectedRestaurantId}`, "1");
      }
    } catch {
      /* ignore */
    }
  }

  async function exitEditMode() {
    try {
      if (selectedRestaurantId) {
        sessionStorage.removeItem(`seatly:floor-plan-edit-${selectedRestaurantId}`);
      }
    } catch {
      /* ignore */
    }
    // Flush any pending autosave
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      await persistDraftRef.current();
    }
    editBaselineRef.current = null;
    hasEditedRef.current = false;
    idMapRef.current.clear();
    setEditSeq(0);
    setMode("live");
    setActiveTool("select");
    setSelectedTableIds([]);
    setSelectedDecorationId(null);
    setSelectedWallIds([]);
    // Refetch once on exit so live mode has fresh DB data
    await refetch();
  }

  async function handleAddFloor(name: string) {
    setAddFloorPending(true);
    try {
      const result = await createSectionAndFloor(name);
      if (!result) {
        toast.error(t("dashboard.floorPlan.addFloorFailed"));
        return;
      }
      if (mode === "live") {
        toast.success(t("dashboard.floorPlan.floorAdded"));
        setSelectedSection(result.sectionId);
      } else {
        toast.success(t("dashboard.floorPlan.floorAddedWhileEditing"));
      }
      setAddFloorOpen(false);
    } finally {
      setAddFloorPending(false);
    }
  }

  // ── Autosave ──────────────────────────────────────────────────────────────────

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasEditedRef = useRef(false);
  const draftRef = useRef({ tables: tablesDraft, layout: layoutDraft });
  draftRef.current = { tables: tablesDraft, layout: layoutDraft };

  const idMapRef = useRef<Map<string, string>>(new Map());
  const isSavingRef = useRef(false);

  // Mutable refs for values the save closure reads — no dependency churn.
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const activeFloorPlanRef = useRef(activeFloorPlan);
  activeFloorPlanRef.current = activeFloorPlan;

  /** Notify the status indicator without re-rendering the page. */
  const saveStatusRef = useRef<SaveStatus>("idle");
  const saveStatusListenersRef = useRef<Set<() => void>>(new Set());
  function notifySaveStatus(status: SaveStatus) {
    saveStatusRef.current = status;
    saveStatusListenersRef.current.forEach((fn) => fn());
  }

  /** Persist current draft to DB. Zero state updates in this component. */
  async function persistDraft() {
    if (isSavingRef.current) return;
    const draft = draftRef.current;
    const baseline = editBaselineRef.current;
    if (!baseline) return;

    isSavingRef.current = true;
    notifySaveStatus("saving");
    try {
      const idMap = idMapRef.current;
      const curSections = sectionsRef.current;
      const curFloorPlan = activeFloorPlanRef.current;

      const resolvedTables = draft.tables.map((t) => {
        const realId = idMap.get(t.id);
        return realId ? { ...t, id: realId } : t;
      });

      const tablesToPersist = ensureTableNumbersForSave(resolvedTables, baseline.tables);

      const draftIds = new Set(tablesToPersist.map((t) => t.id));
      const baselineIds = new Set(baseline.tables.map((t) => t.id));

      for (const tbl of baseline.tables) {
        if (!draftIds.has(tbl.id) && isDatabaseUuid(tbl.id)) {
          await deleteTable(tbl.id, { refetchAfter: false });
        }
      }

      for (const tbl of tablesToPersist) {
        if (tbl.id.startsWith(LOCAL_TABLE_ID_PREFIX)) {
          const created = await createTable({
            sectionId: tbl.section_id ?? curSections[0]?.id ?? "",
            label: tbl.label ?? "",
            tableNumber: tbl.table_number,
            shape: tbl.shape,
            capacity: tbl.capacity,
            x: tbl.position_x ?? 0,
            y: tbl.position_y ?? 0,
            minParty: tbl.min_party,
            status: tbl.status,
            notes: tbl.notes,
          });
          if (!created) throw new Error("create failed");
          const originalLocalId = draft.tables.find(
            (d) => (idMap.get(d.id) ?? d.id) === tbl.id,
          )?.id ?? tbl.id;
          idMap.set(originalLocalId, created.id);
          continue;
        }
        if (isDatabaseUuid(tbl.id) && baselineIds.has(tbl.id)) {
          await updateTable(tbl.id, {
            position_x: tbl.position_x,
            position_y: tbl.position_y,
            shape: tbl.shape,
            capacity: tbl.capacity,
            min_party: tbl.min_party,
            label: tbl.label,
            table_number: tbl.table_number,
            section_id: tbl.section_id,
            notes: tbl.notes,
            status: tbl.status,
            seated_count: tbl.seated_count,
          });
        }
      }

      if (curFloorPlan) {
        await updateLayout(curFloorPlan.id, draft.layout);
      }

      editBaselineRef.current = {
        tables: tablesToPersist.map((row) => {
          const realId = row.id.startsWith(LOCAL_TABLE_ID_PREFIX)
            ? (idMap.get(row.id) ?? row.id)
            : row.id;
          return { ...row, id: realId };
        }),
        layout: JSON.parse(JSON.stringify(draft.layout)) as FloorPlanLayout,
      };

      notifySaveStatus("saved");
      setTimeout(() => notifySaveStatus("idle"), 2000);
    } catch {
      notifySaveStatus("error");
      toast.error(t("dashboard.floorPlan.saveFailed"));
    } finally {
      isSavingRef.current = false;
    }
  }

  const persistDraftRef = useRef(persistDraft);
  persistDraftRef.current = persistDraft;

  const [editSeq, setEditSeq] = useState(0);

  // Debounced autosave: triggers 1s after the last edit
  useEffect(() => {
    if (mode !== "edit" || editSeq === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persistDraftRef.current();
    }, 1000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [editSeq, mode]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (mode === "edit" && saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        void persistDraftRef.current();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [mode]);

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

  const removeWallsFromDraft = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      const updatedWalls = layoutDraft.walls.filter((w) => !idSet.has(w.id));
      dispatch({
        type: "PUSH",
        entry: { tables: tablesDraft, layout: { ...layoutDraft, walls: updatedWalls } },
      });
      setSelectedWallIds((prev) => prev.filter((wid) => !idSet.has(wid)));
    },
    [tablesDraft, layoutDraft],
  );

  useEffect(() => {
    if (mode !== "edit" || !canEdit) return;
    if (selectedTableIds.length === 0 && !selectedDecorationId && selectedWallIds.length === 0) return;

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
      if (selectedWallIds.length > 0) {
        e.preventDefault();
        removeWallsFromDraft(selectedWallIds);
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
    selectedWallIds,
    deleteTablesFromDraft,
    removeDecoration,
    removeWallsFromDraft,
  ]);

  function handleDecorationClick(id: string) {
    if (activeTool === "delete") {
      removeDecoration(id);
      return;
    }
    setSelectedTableIds([]);
    setSelectedWallIds([]);
    setSelectedDecorationId((prev) => (prev === id ? null : id));
  }

  function handleWallClick(wallId: string) {
    setSelectedTableIds([]);
    setSelectedDecorationId(null);
    if (activeTool === "delete") {
      removeWallsFromDraft([wallId]);
      return;
    }
    setSelectedWallIds((prev) => (prev.length === 1 && prev[0] === wallId ? [] : [wallId]));
  }

  function handleTableClick(id: string, e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    setSelectedDecorationId(null);
    setSelectedWallIds([]);
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
      activeTool === "extend-wall" ||
      activeTool === "delete"
    ) {
      setSelectedTableIds([]);
      setSelectedDecorationId(null);
      setSelectedWallIds([]);
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
    const px = Math.max(0, Math.min(worldBounds.w, gx));
    const py = Math.max(0, Math.min(worldBounds.h, gy));

    const newTable = buildLocalDraftTable(
      shape,
      px,
      py,
      selectedRestaurantId,
      sections,
      tablesDraft,
      selectedSection || null,
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

  async function handleLiveStatusChange(tableId: string, status: string, seatedCount?: number) {
    const patch: Partial<TableRow> = { status };
    if (seatedCount !== undefined) patch.seated_count = seatedCount;
    await updateTable(tableId, patch);
    await refetch();
  }

  // ── Wall / decoration ──────────────────────────────────────────────────────

  type Wall = { id: string; x1: number; y1: number; x2: number; y2: number };

  function handleWallDrawn(wall: Wall) {
    const updatedLayout = { ...layoutDraft, walls: [...layoutDraft.walls, wall] };
    pushHistory(tablesDraft, updatedLayout);
  }

  function handleWallEndpointUpdate(wallId: string, endpoint: "start" | "end", x: number, y: number) {
    const updatedWalls = layoutDraft.walls.map((w) => {
      if (w.id !== wallId) return w;
      return endpoint === "start"
        ? { ...w, x1: x, y1: y }
        : { ...w, x2: x, y2: y };
    });
    pushHistory(tablesDraft, { ...layoutDraft, walls: updatedWalls });
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
    fitWorldToViewport();
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
    <div className="flex min-h-0 h-full min-w-0 flex-col">
      {/* ── Top bar: sticky + high z-index so Konva canvas (sibling below) never steals clicks ── */}
      <div className="sticky top-0 z-50 flex min-w-0 items-center gap-3 border-b border-border bg-bg-base px-4 py-2.5 shadow-sm shadow-black/20">
        <h1 className="shrink-0 text-sm font-semibold text-text-primary">
          {t("dashboard.floorPlan.title")}
        </h1>

        {mode === "edit" && (
          <span className="shrink-0 rounded-md bg-gold/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
            Editing
          </span>
        )}

        {/* Section tabs + add floor — must shrink (min-w-0) so the Edit column keeps a real hit target */}
        <div className="min-w-0 flex flex-1 items-center gap-2 overflow-hidden">
          <div className="min-w-0 flex-1">
            <SectionTabs
              sections={sections.filter((s) => s.is_active)}
              selected={selectedSection}
              onChange={setSelectedSection}
              disabled={mode === "edit"}
            />
          </div>
          {canEdit &&
            isSupabaseConfigured() &&
            selectedRestaurantId != null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1"
                onClick={() => setAddFloorOpen(true)}
                aria-label={t("dashboard.floorPlan.addFloorAriaLabel")}
              >
                <Plus className="size-4 shrink-0" />
                <span className="hidden sm:inline">{t("dashboard.floorPlan.addFloor")}</span>
              </Button>
            )}
        </div>

        <div className="relative z-[60] flex shrink-0 items-center gap-2 pointer-events-auto">
          {canEdit && mode === "live" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                enterEditMode();
              }}
            >
              {t("common.actions.edit")}
            </Button>
          )}
          {mode === "edit" && (
            <>
              <AutosaveIndicator statusRef={saveStatusRef} listenersRef={saveStatusListenersRef} />
              <Button type="button" size="sm" onClick={() => void exitEditMode()}>
                Done
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Canvas area (z-0 so it stays under the sticky control bar) ─────── */}
      <div className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
        {/* Left toolbar (edit mode only) */}
        {mode === "edit" && (
          <div className="flex shrink-0 flex-col overflow-y-auto border-r border-border bg-bg-surface px-3 py-3">
            <FloorPlanToolbar activeTool={activeTool} onToolChange={setActiveTool} />
          </div>
        )}

        {/* Main canvas */}
        <div ref={containerRef} className="relative flex-1 overflow-hidden">
          {isEmpty && mode === "live" ? (
            <FloorPlanEmptyState canEdit={canEdit} onEnterEdit={enterEditMode} />
          ) : (
            <FloorPlanCanvas
              tables={tablesForCanvas}
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
              worldWidth={activeFloorPlan?.canvas_width}
              worldHeight={activeFloorPlan?.canvas_height}
              containerWidth={containerSize.w}
              containerHeight={containerSize.h}
              onTableClick={handleTableClick}
              onTableHover={setHoveredTable}
              onCanvasClick={(x, y) => void handleCanvasClick(x, y)}
              onTableDragEnd={handleTableDragEnd}
              onWallDrawn={handleWallDrawn}
              onWallEndpointUpdate={handleWallEndpointUpdate}
              onDecorationClick={mode === "edit" && canEdit ? handleDecorationClick : undefined}
              onDecorationDragEnd={handleDecorationDragEnd}
              onStageScaleChange={setStageScale}
              onStagePosChange={setStagePos}
              tableTransforms={layoutDraft.tableTransforms}
              resizeEnabled={canResizeTables}
              onTableTransformEnd={handleTableTransformEnd}
              marqueeSelectEnabled={canEdit}
              onMarqueeSelect={({ tableIds, wallIds }) => {
                setSelectedTableIds(tableIds);
                setSelectedWallIds(wallIds);
                setSelectedDecorationId(null);
              }}
              selectedWallIds={selectedWallIds}
              onWallClick={mode === "edit" && canEdit ? handleWallClick : undefined}
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
                  onClick={() => { dispatch({ type: "UNDO" }); setEditSeq((n) => n + 1); }}
                >
                  {t("dashboard.floorPlan.undo")}
                </Button>
                <Button
                  className="pointer-events-auto"
                  variant="outline"
                  size="sm"
                  disabled={historyState.future.length === 0}
                  onClick={() => { dispatch({ type: "REDO" }); setEditSeq((n) => n + 1); }}
                >
                  {t("dashboard.floorPlan.redo")}
                </Button>
              </div>
              {canEdit && (
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
          onUpdateStatus={(id, status, seatedCount) => void handleLiveStatusChange(id, status, seatedCount)}
        />
      )}

      {/* Tooltip */}
      <TableTooltip info={hoveredTable} />

      <AddFloorDialog
        open={addFloorOpen}
        onOpenChange={setAddFloorOpen}
        onConfirm={handleAddFloor}
        isPending={addFloorPending}
      />
    </div>
  );
}
