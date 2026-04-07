import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type Konva from "konva";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Check, Loader2, Plus } from "lucide-react";

import { AddFloorDialog } from "@/components/floor-plan/AddFloorDialog";
import { FloorPlanCommandBar } from "@/components/floor-plan/FloorPlanCommandBar";
import { FloorPlanCanvas } from "@/components/floor-plan/FloorPlanCanvas";
import { FloorPlanEmptyState } from "@/components/floor-plan/FloorPlanEmptyState";
import { FloorInspectorEmpty } from "@/components/floor-plan/FloorInspectorEmpty";
import { FloorPlanNoSectionState } from "@/components/floor-plan/FloorPlanNoSectionState";
import { FloorPlanToolbar } from "@/components/floor-plan/FloorPlanToolbar";
import { LiveServiceTablePanel } from "@/components/floor-plan/LiveServiceTablePanel";
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
import { getZoneLabelForTable } from "@/lib/floor-plan-zone";
import {
  FLOOR_PLAN_DEFAULT_WORLD_HEIGHT,
  FLOOR_PLAN_DEFAULT_WORLD_WIDTH,
  FLOOR_PLAN_GRID_STEP,
} from "@/components/floor-plan/types";
import {
  computeFloorPlanContentBounds,
  computeZoneUnionBounds,
  shouldFrameRoomInViewport,
  zoneUnionCoversEnoughOfWorld,
} from "@/lib/floor-plan-content-bounds";
import {
  clampFloorPlanStagePosition,
  FLOOR_PLAN_VIEWPORT_CONTAIN_PAD,
  FLOOR_PLAN_ZONE_VIEWPORT_CONTAIN_PAD,
  getFloorPlanScaleBounds,
  scaleWorldToContainViewport,
  stagePositionAfterZoomAtScreenPoint,
} from "@/lib/floor-plan-viewport";
import { CANVAS_COLORS } from "@/lib/canvas-colors";
import { ensureTableNumbersForSave, nextSequentialTableNumber } from "@/lib/table-number";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { useUser } from "@/hooks/useUser";
import { useFloorPlan, isDatabaseUuid } from "@/hooks/useFloorPlan";
import type { FloorPlanLayout, FloorPlanZone, SectionRow, TableRow } from "@/hooks/useFloorPlan";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  return {
    walls: [],
    doors: [],
    windows: [],
    tableTransforms: {},
    decorations: [],
    zones: [],
  };
}

function normalizeLayout(layout: FloorPlanLayout): FloorPlanLayout {
  const z = layout.zones;
  return {
    ...layout,
    zones: Array.isArray(z) ? z : [],
  };
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
      return parsed && typeof parsed === "object"
        ? normalizeLayout(parsed)
        : emptyLayout();
    } catch {
      return emptyLayout();
    }
  }
  if (typeof rawLayout === "object") {
    return normalizeLayout(JSON.parse(JSON.stringify(rawLayout)) as FloorPlanLayout);
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
  const { t } = useTranslation();
  const [status, setStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    const update = () => setStatus(statusRef.current ?? "idle");
    listenersRef.current?.add(update);
    return () => {
      listenersRef.current?.delete(update);
    };
  }, [statusRef, listenersRef]);

  if (status === "idle") return null;

  return (
    <span className="flex items-center gap-1.5 text-xs text-text-muted">
      {status === "saving" && (
        <>
          <Loader2 className="size-3 animate-spin text-gold" />
          <span className="text-text-secondary">{t("dashboard.floorPlan.statusSaving")}</span>
        </>
      )}
      {status === "saved" && (
        <>
          <Check className="size-3 text-success" />
          <span className="text-success">{t("dashboard.floorPlan.statusSaved")}</span>
        </>
      )}
      {status === "error" && (
        <span className="text-danger">{t("dashboard.floorPlan.saveFailed")}</span>
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
  /** Drives right panel: single focused table (independent of multi-select for canvas). */
  const [selectedPanelTableId, setSelectedPanelTableId] = useState<string | null>(null);
  const [selectedDecorationId, setSelectedDecorationId] = useState<string | null>(null);
  const [selectedWallIds, setSelectedWallIds] = useState<string[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string>("");
  const [addFloorOpen, setAddFloorOpen] = useState(false);
  const [addFloorPending, setAddFloorPending] = useState(false);
  const [hoveredTable, setHoveredTable] = useState<HoveredTableInfo | null>(null);
  const pendingHoverRef = useRef<HoveredTableInfo | null>(null);
  const hoverFlushRafRef = useRef<number | null>(null);

  /** Coalesce hover updates to one React commit per frame (fewer full-page re-renders while skimming tables). */
  const queueTableHover = useCallback((info: HoveredTableInfo | null) => {
    pendingHoverRef.current = info;
    if (hoverFlushRafRef.current != null) return;
    hoverFlushRafRef.current = requestAnimationFrame(() => {
      hoverFlushRafRef.current = null;
      setHoveredTable(pendingHoverRef.current);
    });
  }, []);

  useEffect(
    () => () => {
      if (hoverFlushRafRef.current != null) {
        cancelAnimationFrame(hoverFlushRafRef.current);
      }
    },
    [],
  );
  const [showGrid, setShowGrid] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  /** Edit mode: right rail tabs (service control vs layout form) */
  const [editRightTab, setEditRightTab] = useState<"control" | "layout">("control");

  // ── Zoom / pan ─────────────────────────────────────────────────────────────
  const [stageScale, setStageScale] = useState(1);
  /** Scale after last "full view" fit — zoom % is shown relative to this so 100% = proportional to the fitted view. */
  const [fullViewBaselineScale, setFullViewBaselineScale] = useState(1);
  const [stagePos, setStagePos] = useState({ x: 0, y: 0 });

  /** Snapshot when entering edit mode — used on Save to diff creates/updates/deletes (draft stays local until then). */
  const editBaselineRef = useRef<{ tables: TableRow[]; layout: FloorPlanLayout } | null>(null);

  /** Konva viewport size — driven by {@link FloorPlanCanvas} ResizeObserver on the actual canvas wrapper (authoritative). */
  const canvasSlotRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const onCanvasViewportSize = useCallback((w: number, h: number) => {
    const nw = Math.max(0, Math.round(w));
    const nh = Math.max(0, Math.round(h));
    setContainerSize((prev) => (prev.w === nw && prev.h === nh ? prev : { w: nw, h: nh }));
  }, []);

  // Keep a valid floor tab selected whenever sections load or change
  useEffect(() => {
    const active = sections.filter((s) => s.is_active);
    if (active.length === 0) {
      setSelectedSection("");
      return;
    }
    setSelectedSection((prev) => {
      if (prev && active.some((s) => s.id === prev)) return prev;
      return active[0].id;
    });
  }, [sections]);

  const needsFloorFirst =
    isSupabaseConfigured() &&
    selectedRestaurantId != null &&
    sections.filter((s) => s.is_active).length === 0;

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

  /**
   * Zoom limits and “full view” baseline are always tied to the **full DB canvas**, not the zone
   * union. Switching to zone-based min/max when zones appear caused {@link setStageScale} clamp
   * effects to jump the camera (often zoom in) on every new zone — see second-room-zone report.
   * Zone-only cover scale is computed only inside {@link fitWorldToViewport} when framing zones.
   */
  const floorPlanScaleBounds = useMemo(() => {
    const cw = Math.max(1, containerSize.w);
    const ch = Math.max(1, containerSize.h);
    return getFloorPlanScaleBounds(cw, ch, worldBounds.w, worldBounds.h);
  }, [containerSize.w, containerSize.h, worldBounds.w, worldBounds.h]);

  /**
   * Editable floor size: at least DB canvas, and large enough that at minimum zoom the scaled world
   * still covers the viewport. Otherwise letterboxing maps the bottom/top margins to coordinates
   * outside 0…world (tables cannot be dropped there).
   */
  const effectiveWorld = useMemo(() => {
    const baseW = worldBounds.w;
    const baseH = worldBounds.h;
    const cw = Math.max(1, containerSize.w);
    const ch = Math.max(1, containerSize.h);
    const minScale = floorPlanScaleBounds.min;
    if (cw < 2 || ch < 2 || minScale < 1e-9) {
      return { w: baseW, h: baseH };
    }
    const needW = Math.ceil(cw / minScale);
    const needH = Math.ceil(ch / minScale);
    return {
      w: Math.max(baseW, needW),
      h: Math.max(baseH, needH),
    };
  }, [worldBounds.w, worldBounds.h, containerSize.w, containerSize.h, floorPlanScaleBounds.min]);

  const clampedSetStageScale = useCallback(
    (s: number) => {
      setStageScale(
        Math.max(floorPlanScaleBounds.min, Math.min(floorPlanScaleBounds.max, s)),
      );
    },
    [floorPlanScaleBounds.min, floorPlanScaleBounds.max],
  );

  /** After resize, keep zoom inside the current band (same limits as wheel / buttons). */
  useEffect(() => {
    setStageScale((s) =>
      Math.max(floorPlanScaleBounds.min, Math.min(floorPlanScaleBounds.max, s)),
    );
  }, [floorPlanScaleBounds.min, floorPlanScaleBounds.max]);

  /** Viewport: one floor at a time (state still holds all tables for save). */
  const tablesForCanvas = useMemo(() => {
    if (!selectedSection) return [];
    return tablesDraft.filter((t) => t.section_id === selectedSection);
  }, [tablesDraft, selectedSection]);

  const tablesForCanvasRef = useRef(tablesForCanvas);
  tablesForCanvasRef.current = tablesForCanvas;
  const layoutDraftRef = useRef(layoutDraft);
  layoutDraftRef.current = layoutDraft;

  // Drop selection / hover when they reference tables hidden on another floor.
  useEffect(() => {
    setSelectedTableIds((prev) =>
      prev.filter((id) => {
        const row = tablesDraft.find((t) => t.id === id);
        if (!row) return false;
        return row.section_id === selectedSection;
      }),
    );
    setSelectedPanelTableId((pid) => {
      if (!pid) return null;
      const row = tablesDraft.find((t) => t.id === pid);
      if (!row || row.section_id !== selectedSection) return null;
      return pid;
    });
  }, [selectedSection, tablesDraft]);

  // If the focused table row disappears from draft, clear panel selection.
  useEffect(() => {
    if (!selectedPanelTableId) return;
    if (!tablesDraft.some((t) => t.id === selectedPanelTableId)) {
      setSelectedPanelTableId(null);
    }
  }, [tablesDraft, selectedPanelTableId]);

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

  // ── Selected table for right panel (explicit id → always matches user click) ──
  const selectedTable = useMemo((): TableRow | null => {
    if (!selectedPanelTableId) return null;
    return tablesDraft.find((t) => t.id === selectedPanelTableId) ?? null;
  }, [selectedPanelTableId, tablesDraft]);

  const floorStatusCounts = useMemo(() => {
    const c = { empty: 0, reserved: 0, occupied: 0, cleaning: 0, blocked: 0 };
    for (const row of tablesForCanvas) {
      const k = row.status as keyof typeof c;
      if (k in c) c[k]++;
    }
    return c;
  }, [tablesForCanvas]);

  const zoneCountForInspector = (layoutDraft.zones ?? []).length;

  const totalSeatsForInspector = useMemo(
    () => tablesForCanvas.reduce((sum, t) => sum + (t.capacity ?? 0), 0),
    [tablesForCanvas],
  );

  const selectedZoneLabel = useMemo(() => {
    if (!selectedTable) return null;
    return getZoneLabelForTable(selectedTable, layoutDraft.zones ?? []);
  }, [selectedTable, layoutDraft.zones]);

  useEffect(() => {
    setEditRightTab("control");
  }, [selectedTable?.id]);

  /**
   * Fit the view: when room zones exist, frame **only the zone union** (the floor surface) so it fills
   * the editor — walls/tables must not inflate bounds to the full canvas. Otherwise fall back to
   * content union or full world.
   */
  const fitWorldToViewport = useCallback(() => {
    const w = effectiveWorld.w;
    const h = effectiveWorld.h;
    const cw = containerSize.w;
    const ch = containerSize.h;
    if (cw < 1 || ch < 1 || w < 1 || h < 1) return;

    const bounds = floorPlanScaleBounds;
    const layout = layoutDraftRef.current;
    const tables = tablesForCanvasRef.current;

    const zoneFrame = computeZoneUnionBounds(layout.zones ?? [], w, h, 4);
    const zoneSubstantial =
      zoneFrame != null && zoneUnionCoversEnoughOfWorld(zoneFrame, w, h);
    if (zoneFrame && zoneSubstantial) {
      const zoneBounds = getFloorPlanScaleBounds(cw, ch, zoneFrame.width, zoneFrame.height, {
        containPadding: FLOOR_PLAN_ZONE_VIEWPORT_CONTAIN_PAD,
        useCoverFit: true,
      });
      /** Zone cover “fit” but never outside world zoom band (bounds = full canvas). */
      const targetScale = zoneBounds.fitScale;
      const scale = Math.min(bounds.max, Math.max(bounds.min, targetScale));
      const focusCx = zoneFrame.left + zoneFrame.width / 2;
      const focusCy = zoneFrame.top + zoneFrame.height / 2;
      const px = cw / 2 - focusCx * scale;
      const py = ch / 2 - focusCy * scale;
      setFullViewBaselineScale(scale);
      setStageScale(scale);
      setStagePos(
        clampFloorPlanStagePosition({ x: px, y: py }, scale, w, h, cw, ch),
      );
      return;
    }

    const content = computeFloorPlanContentBounds(
      tables,
      {
        walls: layout.walls,
        doors: layout.doors,
        windows: layout.windows,
        decorations: layout.decorations,
        zones: layout.zones ?? [],
      },
      layout.tableTransforms,
      w,
      h,
    );

    const hasZones = (layout.zones?.length ?? 0) > 0;
    /** Avoid aggressive “has zones” framing until the union is a meaningful slice of the floor. */
    const hasEstablishedZoneViewport = hasZones && zoneSubstantial;

    let scale: number;
    let focusCx: number;
    let focusCy: number;

    if (content && shouldFrameRoomInViewport(content, w, h, hasEstablishedZoneViewport)) {
      const effW = Math.max(content.width, 200);
      const effH = Math.max(content.height, 140);
      scale = scaleWorldToContainViewport(cw, ch, effW, effH, FLOOR_PLAN_VIEWPORT_CONTAIN_PAD);
      scale = Math.max(bounds.min, Math.min(bounds.max, scale));
      focusCx = content.left + content.width / 2;
      focusCy = content.top + content.height / 2;
    } else {
      scale = Math.max(bounds.min, Math.min(bounds.max, bounds.fitScale));
      focusCx = w / 2;
      focusCy = h / 2;
    }

    const px = cw / 2 - focusCx * scale;
    const py = ch / 2 - focusCy * scale;

    setFullViewBaselineScale(scale);
    setStageScale(scale);
    setStagePos(
      clampFloorPlanStagePosition({ x: px, y: py }, scale, w, h, cw, ch),
    );
  }, [
    containerSize.w,
    containerSize.h,
    effectiveWorld.w,
    effectiveWorld.h,
    floorPlanScaleBounds.fitScale,
    floorPlanScaleBounds.max,
    floorPlanScaleBounds.min,
  ]);

  /** Keep stage position valid when zoom buttons change scale or layout resizes (canvas only clamps during drag/wheel). */
  useEffect(() => {
    if (containerSize.w < 1 || containerSize.h < 1) return;
    setStagePos((prev) =>
      clampFloorPlanStagePosition(
        prev,
        stageScale,
        effectiveWorld.w,
        effectiveWorld.h,
        containerSize.w,
        containerSize.h,
      ),
    );
  }, [
    stageScale,
    effectiveWorld.w,
    effectiveWorld.h,
    containerSize.w,
    containerSize.h,
  ]);

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
  }, [selectedSection, effectiveWorld.w, effectiveWorld.h, containerSize.w, containerSize.h, fitWorldToViewport]);

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
    setSelectedPanelTableId(null);
    setSelectedDecorationId(null);
    setSelectedWallIds([]);
    setSelectedZoneId(null);
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
    setSelectedPanelTableId(null);
    setSelectedDecorationId(null);
    setSelectedWallIds([]);
    setSelectedZoneId(null);
    // Refetch once on exit so live mode has fresh DB data (no full-page loading flash)
    await refetch({ silent: true });
  }

  // Session restore or edge cases: cannot stay in edit mode without a real section row
  useEffect(() => {
    if (loading || mode !== "edit") return;
    if (sections.filter((s) => s.is_active).length > 0) return;
    void exitEditMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: run when sections/mode/loading change
  }, [loading, mode, sections]);

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

      const hasRealSection = curSections.some((s) => isDatabaseUuid(s.id));
      const draftHasNewLocalTables = draft.tables.some((t) =>
        t.id.startsWith(LOCAL_TABLE_ID_PREFIX),
      );
      if (draftHasNewLocalTables && !hasRealSection) {
        notifySaveStatus("error");
        toast.error(t("dashboard.floorPlan.saveNeedsFloor"));
        return;
      }

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
      setSelectedPanelTableId((pid) => (pid && idSet.has(pid) ? null : pid));
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

  const removeZoneFromDraft = useCallback(
    (id: string) => {
      const zones = (layoutDraft.zones ?? []).filter((z) => z.id !== id);
      dispatch({
        type: "PUSH",
        entry: { tables: tablesDraft, layout: { ...layoutDraft, zones } },
      });
      setSelectedZoneId((prev) => (prev === id ? null : prev));
    },
    [tablesDraft, layoutDraft],
  );

  function handleZoneDragEnd(id: string, x: number, y: number) {
    const zones = (layoutDraft.zones ?? []).map((z) => (z.id === id ? { ...z, x, y } : z));
    pushHistory(tablesDraft, { ...layoutDraft, zones });
  }

  function handleZoneTransformEnd(
    id: string,
    patch: Partial<Pick<FloorPlanZone, "x" | "y" | "width" | "height">>,
  ) {
    const zones = (layoutDraft.zones ?? []).map((z) => (z.id === id ? { ...z, ...patch } : z));
    pushHistory(tablesDraft, { ...layoutDraft, zones });
  }

  const handleZoneSelect = useCallback(
    (id: string) => {
      if (mode !== "edit" || !canEdit) return;
      if (activeTool === "delete") {
        removeZoneFromDraft(id);
        return;
      }
      setSelectedZoneId(id);
      setSelectedTableIds([]);
      setSelectedPanelTableId(null);
      setSelectedDecorationId(null);
      setSelectedWallIds([]);
    },
    [mode, canEdit, activeTool, removeZoneFromDraft],
  );

  useEffect(() => {
    setSelectedZoneId(null);
  }, [selectedSection]);

  useEffect(() => {
    if (mode !== "edit" || !canEdit) return;
    if (
      selectedTableIds.length === 0 &&
      !selectedDecorationId &&
      selectedWallIds.length === 0 &&
      !selectedZoneId
    )
      return;

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
      if (selectedZoneId) {
        e.preventDefault();
        removeZoneFromDraft(selectedZoneId);
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
    selectedZoneId,
    deleteTablesFromDraft,
    removeDecoration,
    removeWallsFromDraft,
    removeZoneFromDraft,
  ]);

  function handleDecorationClick(id: string) {
    if (activeTool === "delete") {
      removeDecoration(id);
      return;
    }
    setSelectedTableIds([]);
    setSelectedPanelTableId(null);
    setSelectedWallIds([]);
    setSelectedZoneId(null);
    setSelectedDecorationId((prev) => (prev === id ? null : id));
  }

  function handleWallClick(wallId: string) {
    setSelectedTableIds([]);
    setSelectedPanelTableId(null);
    setSelectedDecorationId(null);
    setSelectedZoneId(null);
    if (activeTool === "delete") {
      removeWallsFromDraft([wallId]);
      return;
    }
    setSelectedWallIds((prev) => (prev.length === 1 && prev[0] === wallId ? [] : [wallId]));
  }

  function handleTableClick(id: string, e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    setSelectedDecorationId(null);
    setSelectedWallIds([]);
    setSelectedZoneId(null);
    if (activeTool === "delete") {
      handleDeleteTable(id);
      setSelectedPanelTableId(null);
      return;
    }
    const shiftHeld = "shiftKey" in e.evt && e.evt.shiftKey;
    setSelectedTableIds((prev) => {
      let next: string[];
      if (mode === "live") {
        next = prev.length === 1 && prev[0] === id ? [] : [id];
      } else if (shiftHeld && canResizeTables) {
        next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      } else {
        next = prev.length === 1 && prev[0] === id ? [] : [id];
      }
      setSelectedPanelTableId(next.length === 1 ? next[0]! : null);
      return next;
    });
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
      setSelectedPanelTableId(null);
      setSelectedDecorationId(null);
      setSelectedWallIds([]);
      setSelectedZoneId(null);
      return;
    }
    if (activeTool === "add-zone") {
      if (!selectedRestaurantId) return;
      const presetKeys = [
        "dashboard.floorPlan.zoneMainDining",
        "dashboard.floorPlan.zonePatio",
        "dashboard.floorPlan.zoneBar",
        "dashboard.floorPlan.zoneVip",
      ] as const;
      const zones = layoutDraft.zones ?? [];
      const label = t(presetKeys[zones.length % presetKeys.length]);
      const w = 240;
      const h = 168;
      const gx = snapEnabled
        ? Math.round(worldX / FLOOR_PLAN_GRID_STEP) * FLOOR_PLAN_GRID_STEP
        : worldX;
      const gy = snapEnabled
        ? Math.round(worldY / FLOOR_PLAN_GRID_STEP) * FLOOR_PLAN_GRID_STEP
        : worldY;
      let px = gx - w / 2;
      let py = gy - h / 2;
      px = Math.max(0, Math.min(effectiveWorld.w - w, px));
      py = Math.max(0, Math.min(effectiveWorld.h - h, py));
      const newZone: FloorPlanZone = {
        id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        x: px,
        y: py,
        width: w,
        height: h,
        label,
      };
      pushHistory(tablesDraft, { ...layoutDraft, zones: [...zones, newZone] });
      setSelectedZoneId(newZone.id);
      setSelectedTableIds([]);
      setSelectedPanelTableId(null);
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

    const gx = snapEnabled
      ? Math.round(worldX / FLOOR_PLAN_GRID_STEP) * FLOOR_PLAN_GRID_STEP
      : worldX;
    const gy = snapEnabled
      ? Math.round(worldY / FLOOR_PLAN_GRID_STEP) * FLOOR_PLAN_GRID_STEP
      : worldY;
    const px = Math.max(0, Math.min(effectiveWorld.w, gx));
    const py = Math.max(0, Math.min(effectiveWorld.h, gy));

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
    const isMulti = selectedTableIds.length > 1 && selectedTableIds.includes(id);
    if (isMulti) {
      const dragged = tablesDraft.find((t) => t.id === id);
      if (!dragged) return;
      const dx = x - (dragged.position_x ?? 0);
      const dy = y - (dragged.position_y ?? 0);
      const selectedSet = new Set(selectedTableIds);
      const updated = tablesDraft.map((t) =>
        selectedSet.has(t.id)
          ? { ...t, position_x: (t.position_x ?? 0) + dx, position_y: (t.position_y ?? 0) + dy }
          : t,
      );
      pushHistory(updated, layoutDraft);
    } else {
      const updated = tablesDraft.map((t) =>
        t.id === id ? { ...t, position_x: x, position_y: y } : t,
      );
      pushHistory(updated, layoutDraft);
    }
  }

  function handleTablePatch(id: string, patch: Partial<TableRow>) {
    const updated = tablesDraft.map((t) => (t.id === id ? { ...t, ...patch } : t));
    pushHistory(updated, layoutDraft);
  }

  const handleDuplicateTable = useCallback(
    (id: string) => {
      const row = tablesDraft.find((r) => r.id === id);
      if (!row || !selectedRestaurantId) return;
      const newTable = buildLocalDraftTable(
        row.shape,
        (row.position_x ?? 0) + FLOOR_PLAN_GRID_STEP * 2,
        (row.position_y ?? 0) + FLOOR_PLAN_GRID_STEP * 2,
        selectedRestaurantId,
        sections,
        tablesDraft,
        row.section_id ?? (selectedSection || null),
      );
      const merged: TableRow = {
        ...newTable,
        table_number: nextSequentialTableNumber([...tablesDraft, newTable]),
        capacity: row.capacity,
        min_party: row.min_party,
        label: row.label,
        notes: row.notes,
        shape: row.shape,
      };
      pushHistory([...tablesDraft, merged], layoutDraft);
      setSelectedTableIds([merged.id]);
      setSelectedPanelTableId(merged.id);
    },
    [tablesDraft, selectedRestaurantId, sections, layoutDraft, selectedSection],
  );

  const handleCombineTable = useCallback(() => {
    toast.info(t("dashboard.floorPlan.combineComingSoon"));
  }, [t]);

  // ── Editor keyboard shortcuts (edit-mode only) ─────────────────────────────
  useEffect(() => {
    if (mode !== "edit" || !canEdit) return;

    function handleKey(e: KeyboardEvent) {
      if (e.isComposing) return;
      const meta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;

      // Ctrl/Cmd + D — duplicate selected table
      if (meta && (e.key === "d" || e.key === "D")) {
        if (!selectedPanelTableId) return;
        e.preventDefault();
        handleDuplicateTable(selectedPanelTableId);
        return;
      }

      // Non-modifier shortcuts only below
      if (meta || e.altKey) return;

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          setActiveTool("select");
          setSelectedTableIds([]);
          setSelectedPanelTableId(null);
          setSelectedWallIds([]);
          setSelectedDecorationId(null);
          setSelectedZoneId(null);
          break;
        case "1":
          e.preventDefault();
          setActiveTool("add-rect-table");
          break;
        case "2":
          e.preventDefault();
          setActiveTool("add-circle-table");
          break;
        case "3":
          e.preventDefault();
          setActiveTool("add-square-table");
          break;
        case "g":
        case "G":
          if (e.shiftKey) break;
          e.preventDefault();
          setShowGrid((v) => !v);
          break;
        case "s":
        case "S":
          if (e.shiftKey) break;
          e.preventDefault();
          setSnapEnabled((v) => !v);
          break;
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    mode, canEdit,
    selectedPanelTableId, handleDuplicateTable,
    setActiveTool, setSelectedTableIds, setSelectedPanelTableId,
    setSelectedWallIds, setSelectedDecorationId, setSelectedZoneId,
    setShowGrid, setSnapEnabled,
  ]);

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
    await refetch({ silent: true });
  }

  function handleControlStatusChange(tableId: string, status: string, seatedCount?: number) {
    if (mode === "edit") {
      const patch: Partial<TableRow> = { status };
      if (seatedCount !== undefined) patch.seated_count = seatedCount;
      handleTablePatch(tableId, patch);
      return;
    }
    void handleLiveStatusChange(tableId, status, seatedCount);
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
    const w = effectiveWorld.w;
    const h = effectiveWorld.h;
    const updatedDecorations = layoutDraft.decorations.map((d) => {
      if (d.id !== id) return d;
      const hw = d.width / 2;
      const hh = d.height / 2;
      const nx = Math.max(hw, Math.min(w - hw, x));
      const ny = Math.max(hh, Math.min(h - hh, y));
      return { ...d, x: nx, y: ny };
    });
    pushHistory(tablesDraft, { ...layoutDraft, decorations: updatedDecorations });
  }

  // ── Zoom helpers ───────────────────────────────────────────────────────────
  /** Toolbar +/- steps match the zoom label: 10% per click vs last full-view fit (see ZoomControls). */
  const ZOOM_DISPLAY_STEP_PCT = 10;
  const ZOOM_STEP_MULT = 1 + ZOOM_DISPLAY_STEP_PCT / 100;

  function readZoomViewportSize(): { cw: number; ch: number } {
    return {
      cw: Math.max(
        1,
        Math.round((containerSize.w || canvasSlotRef.current?.clientWidth) ?? 0),
      ),
      ch: Math.max(
        1,
        Math.round((containerSize.h || canvasSlotRef.current?.clientHeight) ?? 0),
      ),
    };
  }

  function zoomIn() {
    const { cw, ch } = readZoomViewportSize();
    const w = effectiveWorld.w;
    const h = effectiveWorld.h;
    const base = fullViewBaselineScale;
    if (base < 1e-9) return;
    const curPct = (stageScale / base) * 100;
    const maxPct = (floorPlanScaleBounds.max / base) * 100;
    const nextPct = Math.min(
      maxPct,
      Math.floor(curPct / ZOOM_DISPLAY_STEP_PCT) * ZOOM_DISPLAY_STEP_PCT + ZOOM_DISPLAY_STEP_PCT,
    );
    let newScale = Math.min(
      floorPlanScaleBounds.max,
      Math.max(floorPlanScaleBounds.min, base * (nextPct / 100)),
    );
    const zoomEps = Math.max(1e-9, stageScale * 1e-9);
    if (newScale <= stageScale + zoomEps) {
      newScale = Math.min(floorPlanScaleBounds.max, stageScale * ZOOM_STEP_MULT);
    }
    newScale = Math.min(
      floorPlanScaleBounds.max,
      Math.max(floorPlanScaleBounds.min, newScale),
    );
    const raw = stagePositionAfterZoomAtScreenPoint(cw / 2, ch / 2, stagePos, stageScale, newScale);
    setStageScale(newScale);
    setStagePos(clampFloorPlanStagePosition(raw, newScale, w, h, cw, ch));
  }

  function zoomOut() {
    const { cw, ch } = readZoomViewportSize();
    const w = effectiveWorld.w;
    const h = effectiveWorld.h;
    const base = fullViewBaselineScale;
    if (base < 1e-9) return;
    const curPct = (stageScale / base) * 100;
    const minPct = (floorPlanScaleBounds.min / base) * 100;
    const nextPct = Math.max(
      minPct,
      Math.ceil(curPct / ZOOM_DISPLAY_STEP_PCT) * ZOOM_DISPLAY_STEP_PCT - ZOOM_DISPLAY_STEP_PCT,
    );
    let newScale = Math.min(
      floorPlanScaleBounds.max,
      Math.max(floorPlanScaleBounds.min, base * (nextPct / 100)),
    );
    const zoomEps = Math.max(1e-9, stageScale * 1e-9);
    if (newScale >= stageScale - zoomEps) {
      newScale = Math.max(floorPlanScaleBounds.min, stageScale / ZOOM_STEP_MULT);
    }
    newScale = Math.min(
      floorPlanScaleBounds.max,
      Math.max(floorPlanScaleBounds.min, newScale),
    );
    const raw = stagePositionAfterZoomAtScreenPoint(cw / 2, ch / 2, stagePos, stageScale, newScale);
    setStageScale(newScale);
    setStagePos(clampFloorPlanStagePosition(raw, newScale, w, h, cw, ch));
  }

  function resetZoom() {
    fitWorldToViewport();
  }

  // ── Loading / error ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col gap-4 bg-bg-surface p-6">
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
      <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-bg-surface p-8 text-center">
        <p className="text-sm text-danger">{error.message}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          {t("common.actions.retry")}
        </Button>
      </div>
    );
  }

  const hasActiveSections = sections.filter((s) => s.is_active).length > 0;
  const isEmpty = hasActiveSections && dbTables.length === 0;

  const showRightColumn = !needsFloorFirst && !(isEmpty && mode === "live");
  const rightPanelKey = selectedPanelTableId ? `table-${selectedPanelTableId}` : "overview";

  return (
    <div
      className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden"
      style={{ backgroundColor: CANVAS_COLORS.zoneBodyFill }}
    >
      <FloorPlanCommandBar
        mode={mode}
        canEdit={canEdit}
        needsFloorFirst={needsFloorFirst}
        sectionTabsSlot={
          <SectionTabs
            sections={sections.filter((s) => s.is_active)}
            selected={selectedSection}
            onChange={setSelectedSection}
            disabled={mode === "edit"}
          />
        }
        addFloorSlot={
          canEdit &&
          isSupabaseConfigured() &&
          selectedRestaurantId != null &&
          !needsFloorFirst ? (
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
          ) : undefined
        }
        undoDisabled={historyState.past.length === 0}
        redoDisabled={historyState.future.length === 0}
        onUndo={() => {
          dispatch({ type: "UNDO" });
          setEditSeq((n) => n + 1);
        }}
        onRedo={() => {
          dispatch({ type: "REDO" });
          setEditSeq((n) => n + 1);
        }}
        saveIndicatorSlot={
          <AutosaveIndicator statusRef={saveStatusRef} listenersRef={saveStatusListenersRef} />
        }
        onEnterEdit={enterEditMode}
        onExitEdit={() => void exitEditMode()}
      />

      {/* Canvas + side rails — floor editor uses one continuous floor colour (matches Konva world). */}
      <div
        className="relative z-0 flex min-h-0 min-w-0 flex-1 overflow-hidden"
        style={{ backgroundColor: CANVAS_COLORS.zoneBodyFill }}
      >
        {mode === "edit" && (
          <div className="flex shrink-0 flex-col overflow-y-auto border-r border-border/80 bg-bg-surface/95 px-3 py-3">
            <FloorPlanToolbar activeTool={activeTool} onToolChange={setActiveTool} />
          </div>
        )}

        {/* Main canvas — ref on flex slot (not absolute child) so width tracks the row. */}
        <div
          ref={canvasSlotRef}
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
          style={{ backgroundColor: CANVAS_COLORS.zoneBodyFill }}
        >
          <div
            className="absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden"
            style={{ backgroundColor: CANVAS_COLORS.zoneBodyFill }}
          >
          {needsFloorFirst ? (
            <FloorPlanNoSectionState
              canEdit={
                canEdit && isSupabaseConfigured() && selectedRestaurantId != null
              }
              onAddFloor={() => setAddFloorOpen(true)}
            />
          ) : isEmpty && mode === "live" ? (
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
              scaleMin={floorPlanScaleBounds.min}
              scaleMax={floorPlanScaleBounds.max}
              worldWidth={effectiveWorld.w}
              worldHeight={effectiveWorld.h}
              containerWidth={Math.max(1, containerSize.w)}
              containerHeight={Math.max(1, containerSize.h)}
              onViewportPixelSize={onCanvasViewportSize}
              onTableClick={handleTableClick}
              onTableHover={queueTableHover}
              onCanvasClick={(x, y) => void handleCanvasClick(x, y)}
              onTableDragEnd={handleTableDragEnd}
              onWallDrawn={handleWallDrawn}
              onWallEndpointUpdate={handleWallEndpointUpdate}
              onDecorationClick={mode === "edit" && canEdit ? handleDecorationClick : undefined}
              onDecorationDragEnd={handleDecorationDragEnd}
              onStageScaleChange={clampedSetStageScale}
              onStagePosChange={setStagePos}
              tableTransforms={layoutDraft.tableTransforms}
              resizeEnabled={canResizeTables}
              onTableTransformEnd={handleTableTransformEnd}
              marqueeSelectEnabled={canEdit}
              onMarqueeSelect={({ tableIds, wallIds }) => {
                setSelectedTableIds(tableIds);
                setSelectedPanelTableId(tableIds.length === 1 ? tableIds[0]! : null);
                setSelectedWallIds(wallIds);
                setSelectedDecorationId(null);
              }}
              selectedWallIds={selectedWallIds}
              onWallClick={mode === "edit" && canEdit ? handleWallClick : undefined}
              showGrid={showGrid}
              snapEnabled={snapEnabled}
              zones={layoutDraft.zones ?? []}
              selectedZoneId={selectedZoneId}
              onZoneSelect={handleZoneSelect}
              onZoneDragEnd={handleZoneDragEnd}
              onZoneTransformEnd={handleZoneTransformEnd}
              zoneTransformEnabled={canEdit}
            />
          )}

          {/* Mobile: legend when the right rail is hidden */}
          {!needsFloorFirst && !(isEmpty && mode === "live") && (
            <div className="pointer-events-none absolute bottom-4 left-4 lg:hidden">
              <div className="pointer-events-auto">
                <StatusLegend />
              </div>
            </div>
          )}
          </div>

          {/* ── Floating canvas controls: zoom · grid · snap ────────────────── */}
          {!needsFloorFirst && !(isEmpty && mode === "live") && (
            <div className="pointer-events-none absolute bottom-4 right-4 z-50 flex items-center gap-2">
              {/* Grid + Snap icon toggles */}
              <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-border/70 bg-bg-surface/90 px-1 py-1 shadow-md shadow-black/30 backdrop-blur-sm">
                <button
                  type="button"
                  title={`Grid (G) — ${showGrid ? "on" : "off"}`}
                  aria-label={t("dashboard.floorPlan.toggleGrid")}
                  aria-pressed={showGrid}
                  onClick={() => setShowGrid((v) => !v)}
                  className={`flex size-7 items-center justify-center rounded-md transition-colors ${
                    showGrid
                      ? "bg-gold/15 text-gold"
                      : "text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
                  }`}
                >
                  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                    <path d="M1 5.5h14M1 10.5h14M5.5 1v14M10.5 1v14" />
                  </svg>
                </button>
                <button
                  type="button"
                  title={`Snap (S) — ${snapEnabled ? "on" : "off"}`}
                  aria-label={t("dashboard.floorPlan.toggleSnap")}
                  aria-pressed={snapEnabled}
                  onClick={() => setSnapEnabled((v) => !v)}
                  className={`flex size-7 items-center justify-center rounded-md transition-colors ${
                    snapEnabled
                      ? "bg-gold/15 text-gold"
                      : "text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
                  }`}
                >
                  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="8" cy="8" r="2.5" />
                    <path d="M8 1v2M8 13v2M1 8h2M13 8h2" />
                    <path d="M3.5 3.5l1.2 1.2M11.3 11.3l1.2 1.2M11.3 4.7l-1.2 1.2M4.7 11.3l-1.2 1.2" />
                  </svg>
                </button>
              </div>
              {/* Zoom controls */}
              <div className="pointer-events-auto">
                <ZoomControls
                  scale={stageScale}
                  baselineScale={fullViewBaselineScale}
                  onZoomIn={zoomIn}
                  onZoomOut={zoomOut}
                  onReset={resetZoom}
                />
              </div>
            </div>
          )}
        </div>

        {showRightColumn && (
          <div className="relative hidden min-h-0 w-[min(26rem,40vw)] max-w-md shrink-0 lg:flex lg:flex-col">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={rightPanelKey}
                role="region"
                aria-label={
                  selectedTable
                    ? t("dashboard.floorPlan.ariaTableControl")
                    : t("dashboard.floorPlan.ariaFloorOverview")
                }
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -14 }}
                transition={{ duration: 0.24, ease: [0.33, 1, 0.68, 1] }}
                className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border/80 bg-bg-surface"
              >
                {selectedTable ? (
                  mode === "edit" ? (
                    <Tabs
                      value={editRightTab}
                      onValueChange={(v) => setEditRightTab(v as "control" | "layout")}
                      className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
                    >
                      <div className="shrink-0 border-b border-gold/15 bg-bg-elevated/50 px-3 pt-3">
                        <TabsList className="h-10 w-full gap-1 border border-border/60 bg-bg-base/90 p-1">
                          <TabsTrigger
                            value="control"
                            className="flex-1 text-xs font-semibold data-[state=active]:border data-[state=active]:border-gold/35 data-[state=active]:bg-gold/12 data-[state=active]:text-gold data-[state=active]:shadow-none"
                          >
                            {t("dashboard.floorPlan.floorPlanRightTabControl")}
                          </TabsTrigger>
                          <TabsTrigger
                            value="layout"
                            className="flex-1 text-xs font-semibold data-[state=active]:border data-[state=active]:border-gold/35 data-[state=active]:bg-gold/12 data-[state=active]:text-gold data-[state=active]:shadow-none"
                          >
                            {t("dashboard.floorPlan.floorPlanRightTabLayout")}
                          </TabsTrigger>
                        </TabsList>
                      </div>
                      <TabsContent
                        value="control"
                        className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden p-0 outline-none"
                      >
                        <LiveServiceTablePanel
                          variant="edit"
                          table={selectedTable}
                          sections={sections}
                          zoneLabel={selectedZoneLabel}
                          onUpdateStatus={handleControlStatusChange}
                          onCombine={handleCombineTable}
                          onEditTable={canEdit ? () => setEditRightTab("layout") : undefined}
                          canEdit={canEdit}
                        />
                      </TabsContent>
                      <TabsContent
                        value="layout"
                        className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden p-0 outline-none"
                      >
                        <TablePropertiesPanel
                          embedded
                          table={selectedTable}
                          sections={sections}
                          onPatch={handleTablePatch}
                          onDelete={handleDeleteTable}
                          onDuplicate={handleDuplicateTable}
                          onCombine={handleCombineTable}
                        />
                      </TabsContent>
                    </Tabs>
                  ) : (
                    <LiveServiceTablePanel
                      variant="live"
                      table={selectedTable}
                      sections={sections}
                      zoneLabel={selectedZoneLabel}
                      onUpdateStatus={handleControlStatusChange}
                      onCombine={handleCombineTable}
                      onEditTable={canEdit ? () => enterEditMode() : undefined}
                      canEdit={canEdit}
                    />
                  )
                ) : (
                  <FloorInspectorEmpty
                    mode={mode}
                    sections={sections}
                    selectedSectionId={selectedSection}
                    showGrid={showGrid}
                    snapEnabled={snapEnabled}
                    tableCount={tablesForCanvas.length}
                    totalSeats={totalSeatsForInspector}
                    zoneCount={zoneCountForInspector}
                    statusCounts={floorStatusCounts}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>

      {mode === "live" && (
        <div className="lg:hidden">
          <TableDetailDrawer
            table={selectedTable}
            sections={sections}
            zoneLabel={selectedZoneLabel}
            onClose={() => {
              setSelectedTableIds([]);
              setSelectedPanelTableId(null);
            }}
            onUpdateStatus={handleControlStatusChange}
            onCombine={handleCombineTable}
            onEditTable={canEdit ? () => enterEditMode() : undefined}
            canEdit={canEdit}
          />
        </div>
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
