"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import {
  Plus,
  Pencil,
  Trash2,
  Copy,
  GripVertical,
  LayoutGrid,
  Circle,
  Square,
  RectangleHorizontal,
  Layers,
  SquareStack,
  Edit3,
  Eye,
  Save,
  Minus,
  ZoomIn,
  Undo2,
  Redo2,
  Wine,
  Sofa,
  Armchair,
  Music2,
} from "lucide-react";
import {
  loadFloorPlanData,
  saveFloorPlanData,
  applyLayoutTemplate,
  LAYOUT_TEMPLATES,
  getTableShapeBorderRadiusClass,
  normalizeTableShape,
  clampInteriorDimension,
  INTERIOR_DIM_MIN,
  INTERIOR_DIM_MAX,
  isSeatingInterior,
  defaultSeatedCapacityForInterior,
  normalizeFloorPlanRotation,
  stepFloorPlanRotation,
  rotateWallEndpoints45Degrees,
  wallRotationDisplayDegrees,
  FLOOR_PLAN_ROTATION_DEGREES,
  type FloorPlanData,
  type FloorPlanTable,
  type FloorPlanLevel,
  type FloorPlanWall,
  type FloorPlanInterior,
  type TableShape,
  type InteriorType,
} from "@/lib/floor-plan";
import { colours } from "@seatly/tokens";
import { InteriorCanvasVisual } from "@/components/floor-plan/interior-canvas-visual";
import { FloorPlanRotationHandle } from "@/components/floor-plan/floor-plan-rotation-handle";

const SAVE_DEBOUNCE_MS = 250;
const GRID_SIZE = 24;
const MAX_UNDO_HISTORY = 50;

function snapToGrid(val: number) {
  return Math.round(val / GRID_SIZE) * GRID_SIZE;
}

function getTableSize(capacity: number, shape: TableShape | undefined) {
  const s = normalizeTableShape(shape);
  const base = capacity <= 2 ? 44 : capacity <= 4 ? 52 : capacity <= 6 ? 60 : 68;
  if (s === "rectangle") return { w: base + 16, h: base - 8 };
  return { w: base, h: base };
}

/** Chair positions around table center, in px from center. Radius ~ table radius + 6. */
function getChairPositions(capacity: number, tableW: number, tableH: number): { x: number; y: number }[] {
  const n = Math.max(2, Math.min(capacity, 12));
  const r = Math.min(tableW, tableH) / 2 + 8;
  const positions: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (i * (360 / n) - 90) * (Math.PI / 180);
    positions.push({
      x: tableW / 2 + r * Math.cos(angle),
      y: tableH / 2 + r * Math.sin(angle),
    });
  }
  return positions;
}

/** Section options are derived from levels - levels and sections stay in sync */
const SHAPE_OPTIONS: { value: TableShape; label: string; Icon: typeof Circle }[] = [
  { value: "round", label: "Round", Icon: Circle },
  { value: "square", label: "Square", Icon: Square },
  { value: "rectangle", label: "Rectangle", Icon: RectangleHorizontal },
];

const INTERIOR_PRESETS: { type: InteriorType; label: string; w: number; h: number }[] = [
  { type: "bar", label: "Bar", w: 160, h: 40 },
  { type: "counter", label: "Counter", w: 100, h: 36 },
  { type: "pillar", label: "Pillar", w: 40, h: 40 },
  { type: "stage", label: "Stage", w: 180, h: 80 },
  { type: "sofa", label: "Sofa", w: 120, h: 48 },
  { type: "booth", label: "Booth", w: 70, h: 36 },
  { type: "lounge", label: "Lounge", w: 160, h: 56 },
];

const INTERIOR_ICONS: Record<InteriorType, typeof Wine> = {
  bar: Wine,
  counter: RectangleHorizontal,
  pillar: Circle,
  stage: Music2,
  sofa: Sofa,
  booth: LayoutGrid,
  lounge: Armchair,
};

function useDebouncedSave(onSaved?: () => void) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  return useCallback((data: FloorPlanData) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      saveFloorPlanData(data);
      timeoutRef.current = null;
      onSavedRef.current?.();
    }, SAVE_DEBOUNCE_MS);
  }, []);
}

export function FloorPlanEditor() {
  const [data, setData] = useState<FloorPlanData>({ levels: [], tables: [], walls: [], interior: [] });
  const [currentLevelId, setCurrentLevelId] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const [draggingWallId, setDraggingWallId] = useState<string | null>(null);
  const [draggingWallEndpoint, setDraggingWallEndpoint] = useState<"1" | "2" | null>(null);
  const [dragWallPosition, setDragWallPosition] = useState({ x1: 0, y1: 0, x2: 0, y2: 0 });
  const [draggingInteriorId, setDraggingInteriorId] = useState<string | null>(null);
  const [dragInteriorPosition, setDragInteriorPosition] = useState({ x: 0, y: 0 });
  const [addLevelModalOpen, setAddLevelModalOpen] = useState(false);
  const [editMode, setEditMode] = useState(true);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [zoom, setZoom] = useState(100);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(null);
  const [selectedInteriorId, setSelectedInteriorId] = useState<string | null>(null);
  const [undoHistory, setUndoHistory] = useState<FloorPlanData[]>([]);
  const [redoHistory, setRedoHistory] = useState<FloorPlanData[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedSave = useDebouncedSave(() => {
    setSaveStatus("saved");
    if (saveStatusTimeoutRef.current) clearTimeout(saveStatusTimeoutRef.current);
    saveStatusTimeoutRef.current = setTimeout(() => {
      setSaveStatus("idle");
      saveStatusTimeoutRef.current = null;
    }, 2000);
  });
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 400 });

  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? { width: 600, height: 400 };
      setCanvasSize({ w: Math.max(400, width), h: Math.max(300, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!editMode) {
      setSelectedTableId(null);
      setSelectedWallId(null);
      setSelectedInteriorId(null);
    }
  }, [editMode]);

  useEffect(() => {
    const loaded = loadFloorPlanData();
    setData(loaded);
    if (!currentLevelId && loaded.levels.length > 0) {
      setCurrentLevelId(loaded.levels[0].id);
    }
  }, []);

  useEffect(() => {
    if (data.levels.length > 0 && !currentLevelId) {
      const firstLevel = data.levels[0];
      setCurrentLevelId(firstLevel.id);
      setSectionFilter(firstLevel.name);
    }
  }, [data.levels, currentLevelId]);

  const persist = useCallback(
    (next: FloorPlanData) => {
      setData((prev) => {
        setUndoHistory((h) => {
          const nextHistory = [...h, prev];
          return nextHistory.slice(-MAX_UNDO_HISTORY);
        });
        setRedoHistory([]);
        return next;
      });
      setSaveStatus("saving");
      debouncedSave(next);
    },
    [debouncedSave]
  );

  const handleUndo = useCallback(() => {
    setUndoHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setData((current) => {
        setRedoHistory((r) => [...r, current].slice(-MAX_UNDO_HISTORY));
        return prev;
      });
      saveFloorPlanData(prev);
      setSaveStatus("saved");
      if (saveStatusTimeoutRef.current) clearTimeout(saveStatusTimeoutRef.current);
      saveStatusTimeoutRef.current = setTimeout(() => {
        setSaveStatus("idle");
        saveStatusTimeoutRef.current = null;
      }, 2000);
      return h.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setRedoHistory((r) => {
      if (r.length === 0) return r;
      const next = r[r.length - 1];
      setData((current) => {
        setUndoHistory((h) => [...h, current].slice(-MAX_UNDO_HISTORY));
        return next;
      });
      saveFloorPlanData(next);
      setSaveStatus("saved");
      if (saveStatusTimeoutRef.current) clearTimeout(saveStatusTimeoutRef.current);
      saveStatusTimeoutRef.current = setTimeout(() => {
        setSaveStatus("idle");
        saveStatusTimeoutRef.current = null;
      }, 2000);
      return r.slice(0, -1);
    });
  }, []);

  const handleSaveLayout = useCallback(() => {
    setSaveStatus("saving");
    saveFloorPlanData(data);
    setSaveStatus("saved");
    if (saveStatusTimeoutRef.current) clearTimeout(saveStatusTimeoutRef.current);
    saveStatusTimeoutRef.current = setTimeout(() => {
      setSaveStatus("idle");
      saveStatusTimeoutRef.current = null;
    }, 2000);
  }, [data]);

  const tables = data.tables;
  const levels = data.levels;
  const walls = data.walls.filter((w) => w.levelId === currentLevelId);
  const interior = data.interior.filter((i) => i.levelId === currentLevelId);
  const levelTables = tables.filter((t) => t.levelId === currentLevelId);

  const getNextTableNumber = useCallback(() => {
    const nums = tables
      .map((t) => parseInt(t.tableNumber.replace(/\D/g, ""), 10))
      .filter((n) => !Number.isNaN(n));
    const max = nums.length > 0 ? Math.max(...nums) : 0;
    return String(max + 1);
  }, [tables]);

  const handleQuickAdd = (capacity: number) => {
    if (!currentLevelId) return;
    const currentLevel = levels.find((l) => l.id === currentLevelId);
    const id = `t-${Date.now()}`;
    const col = levelTables.length % 5;
    const row = Math.floor(levelTables.length / 5);
    const newTable: FloorPlanTable = {
      id,
      levelId: currentLevelId,
      tableNumber: getNextTableNumber(),
      capacity,
      section: currentLevel?.name ?? "Main Floor",
      shape: "round",
      positionX: snapToGrid(GRID_SIZE + col * 80),
      positionY: snapToGrid(GRID_SIZE + row * 70),
      rotation: normalizeFloorPlanRotation(0),
      isActive: true,
    };
    persist({ ...data, tables: [...tables, newTable] });
  };

  const handleAdd = (tableData: Omit<FloorPlanTable, "id" | "positionX" | "positionY" | "levelId">) => {
    const levelId =
      tableData.section && levels.length > 0
        ? levels.find((l) => l.name === tableData.section)?.id ?? currentLevelId
        : currentLevelId;
    if (!levelId) return;
    const id = `t-${Date.now()}`;
    const levelTablesForPlacement = tables.filter((t) => t.levelId === levelId);
    const col = levelTablesForPlacement.length % 5;
    const row = Math.floor(levelTablesForPlacement.length / 5);
    const newTable: FloorPlanTable = {
      ...tableData,
      id,
      levelId,
      positionX: snapToGrid(GRID_SIZE + col * 80),
      positionY: snapToGrid(GRID_SIZE + row * 70),
      rotation: normalizeFloorPlanRotation(tableData.rotation ?? 0),
      isActive: tableData.isActive ?? true,
    };
    persist({ ...data, tables: [...tables, newTable] });
    setAddModalOpen(false);
  };

  const handleDuplicate = (table: FloorPlanTable) => {
    const id = `t-${Date.now()}`;
    const offset = GRID_SIZE * 2;
    const newTable: FloorPlanTable = {
      ...table,
      id,
      tableNumber: `${table.tableNumber}-copy`,
      positionX: snapToGrid(table.positionX + offset),
      positionY: snapToGrid(table.positionY + offset),
    };
    persist({ ...data, tables: [...tables, newTable] });
  };

  const handleTidyUp = () => {
    const bySection = new Map<string, FloorPlanTable[]>();
    levelTables.forEach((t) => {
      const list = bySection.get(t.section) ?? [];
      list.push(t);
      bySection.set(t.section, list);
    });
    const sections = Array.from(bySection.keys());
    const updatedTables = tables.map((t) => {
      if (t.levelId !== currentLevelId) return t;
      const sectionTables = bySection.get(t.section) ?? [];
      const i = sectionTables.indexOf(t);
      const col = i % 5;
      const row = Math.floor(i / 5);
      const baseX = GRID_SIZE + sections.indexOf(t.section) * 130;
      return {
        ...t,
        positionX: snapToGrid(baseX + col * 68),
        positionY: snapToGrid(GRID_SIZE + row * 60),
      };
    });
    persist({ ...data, tables: updatedTables });
  };

  const handleEdit = (id: string, editData: Partial<FloorPlanTable>) => {
    const patch = { ...editData };
    if (patch.rotation !== undefined) patch.rotation = normalizeFloorPlanRotation(patch.rotation);
    persist({
      ...data,
      tables: tables.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    if (confirm("Remove this table from the floor plan?")) {
      persist({ ...data, tables: tables.filter((t) => t.id !== id) });
      setEditingId(null);
    }
  };

  const handleAddWall = () => {
    if (!currentLevelId) return;
    const id = `w-${Date.now()}`;
    const newWall: FloorPlanWall = {
      id,
      levelId: currentLevelId,
      x1: 48,
      y1: 120,
      x2: 200,
      y2: 120,
    };
    persist({ ...data, walls: [...data.walls, newWall] });
  };

  const handleDeleteWall = (id: string) => {
    persist({ ...data, walls: data.walls.filter((w) => w.id !== id) });
  };

  const handleAddInterior = (type: InteriorType, w: number, h: number) => {
    if (!currentLevelId) return;
    const id = `i-${Date.now()}`;
    const levelInterior = data.interior.filter((i) => i.levelId === currentLevelId);
    const col = levelInterior.length % 4;
    const row = Math.floor(levelInterior.length / 4);
    const seated = defaultSeatedCapacityForInterior(type);
    const newInterior: FloorPlanInterior = {
      id,
      levelId: currentLevelId,
      type,
      x: snapToGrid(48 + col * (w + 24)),
      y: snapToGrid(60 + row * (h + 24)),
      w: clampInteriorDimension(w),
      h: clampInteriorDimension(h),
      rotation: normalizeFloorPlanRotation(0),
      ...(seated != null ? { seatedCapacity: seated } : {}),
    };
    persist({ ...data, interior: [...data.interior, newInterior] });
  };

  const handleDeleteInterior = (id: string) => {
    persist({ ...data, interior: data.interior.filter((i) => i.id !== id) });
  };

  const handleRotateTable = (id: string) => {
    const t = tables.find((x) => x.id === id);
    if (!t) return;
    const next = stepFloorPlanRotation(t.rotation ?? 0, 1);
    persist({
      ...data,
      tables: tables.map((x) => (x.id === id ? { ...x, rotation: next } : x)),
    });
  };

  const handleRotateInterior = (id: string) => {
    const item = data.interior.find((x) => x.id === id);
    if (!item) return;
    const next = stepFloorPlanRotation(item.rotation ?? 0, 1);
    persist({
      ...data,
      interior: data.interior.map((x) => (x.id === id ? { ...x, rotation: next } : x)),
    });
  };

  const handleRotateWall = (id: string, direction: 1 | -1) => {
    const w = data.walls.find((x) => x.id === id);
    if (!w) return;
    const next = rotateWallEndpoints45Degrees(w, direction);
    persist({
      ...data,
      walls: data.walls.map((x) => (x.id === id ? next : x)),
    });
  };

  const handleApplyTemplate = (templateId: string) => {
    const template = LAYOUT_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    const applied = applyLayoutTemplate(template);
    persist(applied);
    setCurrentLevelId(applied.levels[0]?.id ?? null);
    setTemplateModalOpen(false);
  };

  const handleAddLevel = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = `l-${Date.now()}`;
    const newLevel: FloorPlanLevel = {
      id,
      name: trimmed,
      order: levels.length,
    };
    persist({ ...data, levels: [...levels, newLevel] });
    setCurrentLevelId(id);
    setAddLevelModalOpen(false);
  };

  const handleDeleteLevel = (levelId: string) => {
    const levelTables = tables.filter((t) => t.levelId === levelId);
    if (levelTables.length > 0 && !confirm(`This level has ${levelTables.length} table(s). Delete anyway? Tables will be removed.`)) return;
    const nextLevels = levels.filter((l) => l.id !== levelId);
    if (nextLevels.length === 0) return;
    const nextTables = tables.filter((t) => t.levelId !== levelId);
    const nextWalls = data.walls.filter((w) => w.levelId !== levelId);
    const nextInterior = data.interior.filter((i) => i.levelId !== levelId);
    persist({ ...data, levels: nextLevels, tables: nextTables, walls: nextWalls, interior: nextInterior });
    if (currentLevelId === levelId) setCurrentLevelId(nextLevels[0].id);
  };

  const scale = zoom / 100;

  const handleWallDragStart = (e: React.MouseEvent, wall: FloorPlanWall, wallWasAlreadySelected: boolean) => {
    e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const clickX = (e.clientX - rect.left) / scale;
    const clickY = (e.clientY - rect.top) / scale;
    const dist1 = Math.hypot(clickX - wall.x1, clickY - wall.y1);
    const dist2 = Math.hypot(clickX - wall.x2, clickY - wall.y2);
    const endpointRadius = 24;
    const allowEndpoints = editMode && wallWasAlreadySelected;
    setDraggingWallId(wall.id);
    setDragWallPosition({ x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2 });
    if (allowEndpoints && dist1 < endpointRadius && dist1 <= dist2) {
      setDraggingWallEndpoint("1");
      setDragOffset({ x: clickX - wall.x1, y: clickY - wall.y1 });
    } else if (allowEndpoints && dist2 < endpointRadius) {
      setDraggingWallEndpoint("2");
      setDragOffset({ x: clickX - wall.x2, y: clickY - wall.y2 });
    } else {
      setDraggingWallEndpoint(null);
      const midX = (wall.x1 + wall.x2) / 2;
      const midY = (wall.y1 + wall.y2) / 2;
      setDragOffset({ x: clickX - midX, y: clickY - midY });
    }
  };

  const handleInteriorDragStart = (e: React.MouseEvent, item: FloorPlanInterior) => {
    e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!item || !rect) return;
    setDraggingInteriorId(item.id);
    setDragOffset({
      x: (e.clientX - rect.left) / scale - item.x,
      y: (e.clientY - rect.top) / scale - item.y,
    });
    setDragInteriorPosition({ x: item.x, y: item.y });
  };

  const handleDragStart = (e: React.MouseEvent, id: string) => {
    const table = tables.find((t) => t.id === id);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!table || !rect) return;
    setDraggingId(id);
    setDragOffset({
      x: (e.clientX - rect.left) / scale - table.positionX,
      y: (e.clientY - rect.top) / scale - table.positionY,
    });
    setDragPosition({ x: table.positionX, y: table.positionY });
  };

  const handleDragMove = (e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const rawX = (e.clientX - rect.left) / scale - dragOffset.x;
    const rawY = (e.clientY - rect.top) / scale - dragOffset.y;
    if (draggingId) {
      const x = Math.max(0, Math.min(canvasSize.w - 80, rawX));
      const y = Math.max(0, Math.min(canvasSize.h - 80, rawY));
      setDragPosition({ x, y });
    }
    if (draggingWallId) {
      const wall = data.walls.find((w) => w.id === draggingWallId);
      if (wall) {
        if (draggingWallEndpoint === "1") {
          setDragWallPosition((prev) => ({
            ...prev,
            x1: Math.max(0, Math.min(canvasSize.w, rawX)),
            y1: Math.max(0, Math.min(canvasSize.h, rawY)),
          }));
        } else if (draggingWallEndpoint === "2") {
          setDragWallPosition((prev) => ({
            ...prev,
            x2: Math.max(0, Math.min(canvasSize.w, rawX)),
            y2: Math.max(0, Math.min(canvasSize.h, rawY)),
          }));
        } else {
          const dx = rawX - (wall.x1 + wall.x2) / 2;
          const dy = rawY - (wall.y1 + wall.y2) / 2;
          setDragWallPosition({
            x1: Math.max(0, Math.min(canvasSize.w, wall.x1 + dx)),
            y1: Math.max(0, Math.min(canvasSize.h, wall.y1 + dy)),
            x2: Math.max(0, Math.min(canvasSize.w, wall.x2 + dx)),
            y2: Math.max(0, Math.min(canvasSize.h, wall.y2 + dy)),
          });
        }
      }
    }
    if (draggingInteriorId) {
      const item = data.interior.find((i) => i.id === draggingInteriorId);
      if (item) {
        const x = Math.max(0, Math.min(canvasSize.w - item.w, rawX));
        const y = Math.max(0, Math.min(canvasSize.h - item.h, rawY));
        setDragInteriorPosition({ x, y });
      }
    }
  };

  const tablesRef = useRef(tables);
  const dragPositionRef = useRef(dragPosition);
  tablesRef.current = tables;
  dragPositionRef.current = dragPosition;

  const wallsRef = useRef(data.walls);
  const interiorRef = useRef(data.interior);
  const dragWallPositionRef = useRef(dragWallPosition);
  const dragInteriorPositionRef = useRef(dragInteriorPosition);
  wallsRef.current = data.walls;
  interiorRef.current = data.interior;
  dragWallPositionRef.current = dragWallPosition;
  dragInteriorPositionRef.current = dragInteriorPosition;

  const handleDragEnd = useCallback(() => {
    const tableId = draggingId;
    const wallId = draggingWallId;
    const interiorId = draggingInteriorId;
    if (tableId) {
      const pos = dragPositionRef.current;
      const snapped = { x: snapToGrid(pos.x), y: snapToGrid(pos.y) };
      persist({
        ...data,
        tables: tablesRef.current.map((t) =>
          t.id === tableId ? { ...t, positionX: snapped.x, positionY: snapped.y } : t
        ),
      });
      setDraggingId(null);
    }
    if (wallId) {
      const pos = dragWallPositionRef.current;
      persist({
        ...data,
        walls: data.walls.map((w) =>
          w.id === wallId
            ? {
                ...w,
                x1: snapToGrid(pos.x1),
                y1: snapToGrid(pos.y1),
                x2: snapToGrid(pos.x2),
                y2: snapToGrid(pos.y2),
              }
            : w
        ),
      });
      setDraggingWallId(null);
      setDraggingWallEndpoint(null);
    }
    if (interiorId) {
      const pos = dragInteriorPositionRef.current;
      persist({
        ...data,
        interior: data.interior.map((i) =>
          i.id === interiorId ? { ...i, x: snapToGrid(pos.x), y: snapToGrid(pos.y) } : i
        ),
      });
      setDraggingInteriorId(null);
    }
  }, [draggingId, draggingWallId, draggingInteriorId, persist, data]);

  const isDragging = draggingId || draggingWallId || draggingInteriorId;
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => handleDragMove(e as unknown as React.MouseEvent);
    const onUp = () => handleDragEnd();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, dragOffset, handleDragEnd]);

  const sectionOptions = levels.length > 0 ? levels.map((l) => l.name) : ["Main Floor"];
  const visibleTables =
    sectionFilter === "all"
      ? levelTables
      : levelTables.filter((t) => {
          const tableLevel = levels.find((l) => l.id === t.levelId);
          return (tableLevel?.name === sectionFilter || t.id === draggingId);
        });
  const editingTable = editingId ? tables.find((t) => t.id === editingId) : null;

  const displayTables =
    sectionFilter === "all"
      ? levelTables
      : levelTables.filter((t) => {
          const tableLevel = levels.find((l) => l.id === t.levelId);
          return tableLevel?.name === sectionFilter;
        });

  const selectedTable = selectedTableId ? tables.find((t) => t.id === selectedTableId) : null;

  const selectedInterior = selectedInteriorId ? data.interior.find((i) => i.id === selectedInteriorId) : null;
  const selectedWall = selectedWallId ? data.walls.find((w) => w.id === selectedWallId) : null;
  const hasSelection = selectedTable || selectedInterior || selectedWall;

  return (
    <div className="flex h-full w-full flex-row min-h-[500px] overflow-hidden">
      <section className="flex h-full w-[260px] min-w-[260px] shrink-0 flex-col overflow-hidden border-r bg-[var(--fp-panel-bg)] [border-color:var(--fp-panel-border)]">
        <div className="flex shrink-0 flex-col overflow-hidden px-floor-plan-panel-padding-compact pt-floor-plan-panel-padding-compact">
          <div className="flex min-w-0 items-center justify-between gap-sm">
            <h2 className="min-w-0 truncate text-floor-plan-header-title-compact font-semibold text-text-on-dark">Floor Plan</h2>
            <div className="flex shrink-0 items-center gap-xs">
              <button
                type="button"
                onClick={handleUndo}
                disabled={undoHistory.length === 0}
                className="rounded p-xs transition-colors disabled:opacity-50 [color:var(--fp-icon-muted)] hover:[color:var(--fp-icon-hover)]"
                aria-label="Undo"
                title="Undo"
              >
                <Undo2 className="h-floor-plan-undo-redo-icon w-floor-plan-undo-redo-icon" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={handleRedo}
                disabled={redoHistory.length === 0}
                className="rounded p-xs transition-colors disabled:opacity-50 [color:var(--fp-icon-muted)] hover:[color:var(--fp-icon-hover)]"
                aria-label="Redo"
                title="Redo"
              >
                <Redo2 className="h-floor-plan-undo-redo-icon w-floor-plan-undo-redo-icon" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={handleSaveLayout}
                disabled={saveStatus === "saving"}
                className="flex h-floor-plan-save-h shrink-0 items-center gap-xs rounded-md bg-gold px-floor-plan-save-px py-floor-plan-save-py text-floor-plan-save-btn font-semibold text-text-on-gold transition-all duration-400 hover:bg-gold-muted disabled:opacity-70"
              >
                <Save className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                <span className="truncate">{saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved ✓" : "Save"}</span>
              </button>
            </div>
          </div>
          <div className="mt-floor-plan-header-divider border-t [border-color:var(--fp-panel-border)]" />
        </div>
        <div className="flex flex-1 flex-col overflow-y-auto p-floor-plan-panel-padding-compact">

        {editMode && (
          <>
          <div>
            <p className="mb-floor-plan-section-label-mb text-floor-plan-section-label-size font-bold uppercase tracking-floor-plan-label-tracking [color:var(--fp-section-label)]">
              Levels
            </p>
            <div className="flex flex-wrap gap-floor-plan-level-pill-gap">
              {levels.map((l) => (
                <div key={l.id} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentLevelId(l.id);
                      setSectionFilter(l.name);
                    }}
                    className={`inline-flex h-floor-plan-level-pill-h items-center gap-floor-plan-level-pill-gap rounded-md px-floor-plan-level-pill-px text-floor-plan-level-tab font-medium transition-all ${
                      currentLevelId === l.id
                        ? "bg-gold text-text-on-gold"
                        : "border bg-transparent hover:border-floor-plan-inactive-hover-border [border-color:var(--fp-inactive-border)] [color:var(--fp-inactive-text)]"
                    }`}
                  >
                    <Layers className="h-3.5 w-3.5" strokeWidth={1.5} />
                    {l.name}
                  </button>
                  {levels.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDeleteLevel(l.id)}
                      className="ml-1 rounded-r-md border border-l-0 bg-transparent px-xs py-floor-plan-level-pill-h opacity-0 transition-opacity group-hover:opacity-100 hover:bg-error/20 hover:text-error hover:border-error/30 [border-color:var(--fp-inactive-border)] [color:var(--fp-inactive-text)]"
                      aria-label={`Remove ${l.name}`}
                    >
                      <span className="text-floor-plan-walls-placed-size">×</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setAddLevelModalOpen(true)}
              className="mt-floor-plan-add-level-mt flex h-floor-plan-level-pill-h w-full items-center justify-center gap-xs rounded-md border border-dashed bg-transparent text-floor-plan-add-level font-medium transition-colors hover:border-floor-plan-inactive-hover-border hover:text-floor-plan-add-level-hover [border-color:var(--fp-inactive-border)] [color:var(--fp-add-level-text)]"
              aria-label="Add level"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              Add level
            </button>
          </div>

          <div className="my-floor-plan-section-divider-m border-t [border-color:var(--fp-section-divider)]" />

          <div>
            <p className="mb-floor-plan-section-label-mb text-floor-plan-section-label-size font-bold uppercase tracking-floor-plan-label-tracking [color:var(--fp-section-label)]">
              Add tables
            </p>
            <div className="flex gap-floor-plan-level-pill-gap">
              {([2, 4, 6] as const).map((cap) => (
                <button
                  key={cap}
                  type="button"
                  onClick={() => handleQuickAdd(cap)}
                  className="flex min-w-0 flex-1 flex-col items-center justify-center gap-floor-plan-table-card-gap rounded-floor-plan-card border transition-colors hover:border-floor-plan-card-hover-border hover:bg-floor-plan-card-hover-bg aspect-square [background-color:var(--fp-card-bg)] [border-color:var(--fp-card-border)]"
                >
                  <div className="h-floor-plan-circle-icon w-floor-plan-circle-icon rounded-full border-[1.5px] border-floor-plan-circle-border bg-transparent" />
                  <span className="font-medium [color:var(--fp-card-label)]">{cap}-top</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setAddModalOpen(true)}
                className="flex min-w-0 flex-1 flex-col items-center justify-center gap-floor-plan-table-card-gap rounded-floor-plan-card border bg-transparent transition-colors hover:border-floor-plan-card-hover-border hover:bg-floor-plan-card-hover-bg aspect-square [border-color:var(--fp-inactive-border)]"
              >
                <Plus className="h-floor-plan-circle-icon w-floor-plan-circle-icon text-gold" strokeWidth={2} />
                <span className="text-floor-plan-table-card-label font-medium text-gold">Custom</span>
              </button>
            </div>
          </div>

          <div className="my-floor-plan-section-divider-m border-t [border-color:var(--fp-section-divider)]" />

          <div>
            <p className="mb-floor-plan-section-label-mb text-floor-plan-section-label-size font-bold uppercase tracking-floor-plan-label-tracking [color:var(--fp-section-label)]">
              Interior & walls
            </p>
            <div className="flex flex-wrap gap-floor-plan-level-pill-gap">
              {INTERIOR_PRESETS.map(({ type, label, w, h }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleAddInterior(type, w, h)}
                  className="inline-flex h-floor-plan-interior-pill-h items-center gap-floor-plan-interior-pill-gap rounded-floor-plan-pill border px-floor-plan-interior-pill-px text-floor-plan-interior-pill font-medium transition-colors hover:border-floor-plan-pill-hover-border hover:text-floor-plan-pill-hover-text [background-color:var(--fp-card-bg)] [border-color:var(--fp-pill-border)] [color:var(--fp-card-label)]"
                >
                  <SquareStack className="h-3 w-3" strokeWidth={1.5} />
                  {label}
                </button>
              ))}
              <button
                type="button"
                onClick={handleAddWall}
                className="inline-flex h-floor-plan-interior-pill-h items-center gap-floor-plan-interior-pill-gap rounded-floor-plan-pill border border-floor-plan-wall-pill-border bg-transparent px-floor-plan-interior-pill-px text-floor-plan-interior-pill font-medium transition-colors hover:border-gold hover:text-gold [color:var(--fp-wall-pill-text)]"
              >
                + Wall
              </button>
            </div>
            {walls.length > 0 && (
              <p className="mt-floor-plan-walls-placed-mt flex items-center gap-xs text-floor-plan-walls-placed-size [color:var(--fp-walls-placed)]">
                <RectangleHorizontal className="h-3 w-3" strokeWidth={1.5} />
                {walls.length} wall{walls.length !== 1 ? "s" : ""} placed
              </p>
            )}
          </div>
          </>
          )}

        <div className="mt-auto shrink-0 border-t pt-floor-plan-section-divider-m [border-color:var(--fp-section-divider)]">
          <p className="mb-floor-plan-section-label-mb text-floor-plan-section-label-size font-bold uppercase tracking-floor-plan-label-tracking [color:var(--fp-section-label)]">
            Selected
          </p>
          {hasSelection ? (
            <>
              {selectedTable && (
                <SelectedTableCard
                  table={selectedTable}
                  sections={[...new Set([...sectionOptions, selectedTable.section])]}
                  shapeOptions={SHAPE_OPTIONS}
                  onSave={(d) => {
                    if (d.section) {
                      const level = levels.find((l) => l.name === d.section);
                      if (level) d = { ...d, levelId: level.id };
                    }
                    handleEdit(selectedTable.id, d);
                  }}
                  onDelete={() => {
                    handleDelete(selectedTable.id);
                    setSelectedTableId(null);
                  }}
                />
              )}
              {selectedInterior && (
                <SelectedInteriorCard
                  item={selectedInterior}
                  snapDim={(n) => clampInteriorDimension(snapToGrid(n))}
                  onSave={(updates) => {
                    persist({
                      ...data,
                      interior: data.interior.map((i) =>
                        i.id === selectedInterior.id ? { ...i, ...updates } : i
                      ),
                    });
                  }}
                  onDelete={() => {
                    handleDeleteInterior(selectedInterior.id);
                    setSelectedInteriorId(null);
                  }}
                />
              )}
              {selectedWall && (
                <SelectedWallCard
                  wall={selectedWall}
                  onRotate={(direction) => handleRotateWall(selectedWall.id, direction)}
                  onDelete={() => {
                    handleDeleteWall(selectedWall.id);
                    setSelectedWallId(null);
                  }}
                />
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-floor-plan-empty-padding text-center">
              <LayoutGrid className="h-floor-plan-empty-icon-panel w-floor-plan-empty-icon-panel [color:var(--fp-panel-border)]" />
              <p className="mt-xs text-floor-plan-empty-size [color:var(--fp-empty-text)]">
                Select an element
              </p>
            </div>
          )}
        </div>
        </div>
      </section>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden border border-border-dark rounded-lg bg-surface-dark">
        <div className="flex h-floor-plan-toolbar shrink-0 items-center gap-md border-b border-border-dark bg-surface-dark px-lg py-md">
            <select
              value={sectionFilter}
              onChange={(e) => {
                const value = e.target.value;
                setSectionFilter(value);
                if (value !== "all") {
                  const level = levels.find((l) => l.name === value);
                  if (level) setCurrentLevelId(level.id);
                }
              }}
              className="rounded-md border border-border-dark bg-surface-dark px-md py-sm text-sm text-text-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            >
              <option value="all">All levels</option>
              {sectionOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-0 rounded-lg border border-gold-glass bg-gold-glass overflow-hidden backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setEditMode(true)}
                className={`flex items-center gap-xs px-md py-sm text-sm font-medium transition-all ${
                  editMode ? "bg-gold/20 text-gold border-r border-gold/30" : "bg-transparent text-text-muted-on-dark hover:bg-gold/5 hover:text-text-on-dark"
                }`}
              >
                <Edit3 className="h-4 w-4" strokeWidth={1.5} />
                Edit
              </button>
              <button
                type="button"
                onClick={() => setEditMode(false)}
                className={`flex items-center gap-xs px-md py-sm text-sm font-medium transition-all ${
                  !editMode ? "bg-gold/20 text-gold border-l border-gold/30" : "bg-transparent text-text-muted-on-dark hover:bg-gold/5 hover:text-text-on-dark"
                }`}
              >
                <Eye className="h-4 w-4" strokeWidth={1.5} />
                View
              </button>
            </div>
            {editMode && (
              <button
                type="button"
                onClick={handleTidyUp}
                className="rounded-md border border-gold px-md py-sm text-sm font-semibold text-gold transition-all duration-400 hover:bg-gold/10"
              >
                Tidy up
              </button>
            )}
            <Link
              href="/floor-plan"
              className="rounded-md border border-border-dark px-md py-sm text-sm font-semibold text-text-on-dark transition-all duration-400 hover:border-gold/30 hover:bg-gold/5"
            >
              Preview
            </Link>
            <div className="flex items-center gap-0 rounded-md border border-border-dark overflow-hidden">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(50, z - 5))}
                className="flex items-center justify-center p-sm text-text-muted-on-dark hover:bg-gold/5 hover:text-gold transition-colors"
                aria-label="Zoom out"
              >
                <Minus className="h-3 w-3" strokeWidth={2} />
              </button>
              <span className="px-sm py-xs text-xs font-medium text-text-muted-on-dark min-w-[3rem] text-center">
                {zoom}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(150, z + 5))}
                className="flex items-center justify-center p-sm text-text-muted-on-dark hover:bg-gold/5 hover:text-gold transition-colors"
                aria-label="Zoom in"
              >
                <ZoomIn className="h-3 w-3" strokeWidth={2} />
              </button>
            </div>
          </div>

        <div
          ref={canvasContainerRef}
          className="relative flex min-h-0 flex-1 flex-col overflow-auto"
          style={{
            backgroundColor: "rgba(10, 10, 10, 0.98)",
            backgroundImage: "radial-gradient(circle, rgba(255, 255, 255, 0.07) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            backgroundPosition: "0 0",
          }}
        >
        <div
          className="shrink-0 bg-transparent"
          style={{
            width: canvasSize.w * (zoom / 100),
            height: canvasSize.h * (zoom / 100),
            minWidth: canvasSize.w * (zoom / 100),
            minHeight: canvasSize.h * (zoom / 100),
          }}
        >
        <div
          ref={canvasRef}
          className="relative bg-transparent"
          style={{
            width: canvasSize.w,
            height: canvasSize.h,
            transform: `scale(${zoom / 100})`,
            transformOrigin: "0 0",
          }}
          onClick={(e) => {
            if (e.target === canvasRef.current) {
              setSelectedTableId(null);
              setSelectedInteriorId(null);
              setSelectedWallId(null);
            }
          }}
        >
          {walls.map((w) => {
            const isDragging = draggingWallId === w.id;
            const isSelected = selectedWallId === w.id;
            const x1 = isDragging ? dragWallPosition.x1 : w.x1;
            const y1 = isDragging ? dragWallPosition.y1 : w.y1;
            const x2 = isDragging ? dragWallPosition.x2 : w.x2;
            const y2 = isDragging ? dragWallPosition.y2 : w.y2;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const length = Math.hypot(dx, dy) || 1;
            const displayLength = Math.max(length, 80);
            const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            const padding = 24;
            const minX = Math.min(x1, x2) - padding;
            const minY = Math.min(y1, y2) - padding;
            const boxW = Math.abs(x2 - x1) + padding * 2;
            const boxH = Math.abs(y2 - y1) + padding * 2;
            const rectLeft = centerX - displayLength / 2 - minX;
            const rectTop = centerY - 8 - minY;
            return (
              <div
                key={w.id}
                className={`absolute select-none transition-opacity duration-200 ${
                  editMode ? "cursor-grab hover:opacity-100" : "cursor-default"
                } ${isDragging ? "cursor-grabbing z-20 opacity-100" : "z-0 opacity-90"}`}
                style={{ left: minX, top: minY, width: boxW, height: boxH }}
                onMouseDown={(e) => {
                  if (editMode) {
                    const wasSelected = selectedWallId === w.id;
                    setSelectedWallId(w.id);
                    setSelectedTableId(null);
                    setSelectedInteriorId(null);
                    handleWallDragStart(e, w, wasSelected);
                  }
                }}
                title="Drag to move · Drag endpoints to change length or angle"
              >
                {editMode && isSelected && (
                  <FloorPlanRotationHandle onRotateClick={() => handleRotateWall(w.id, 1)} ariaLabel="Rotate wall 45 degrees" />
                )}
                <div
                  className={`absolute flex items-center justify-center rounded-sm border text-xs font-medium uppercase tracking-wider ${
                    isSelected ? "border-gold shadow-gold-glow-hover" : ""
                  }`}
                  style={{
                    left: rectLeft,
                    top: rectTop,
                    width: displayLength,
                    height: 16,
                    transform: `rotate(${angleDeg}deg)`,
                    transformOrigin: "center center",
                    backgroundColor: colours.floorPlanInteriorWallSegmentBg,
                    borderColor: isSelected ? colours.gold : colours.floorPlanInteriorWallSegmentBorder,
                    borderWidth: 1,
                    color: colours.floorPlanWallsPlacedText,
                  }}
                >
                  WALL
                </div>
                {editMode && isSelected && (
                  <>
                    <div
                      className="absolute cursor-grab rounded-full border-2 border-gold/50 bg-gold/25 hover:bg-gold/40"
                      style={{
                        left: x1 - minX - 6,
                        top: y1 - minY - 6,
                        width: 12,
                        height: 12,
                      }}
                    />
                    <div
                      className="absolute cursor-grab rounded-full border-2 border-gold/50 bg-gold/25 hover:bg-gold/40"
                      style={{
                        left: x2 - minX - 6,
                        top: y2 - minY - 6,
                        width: 12,
                        height: 12,
                      }}
                    />
                  </>
                )}
              </div>
            );
          })}
          {interior.map((i) => {
            const isDragging = draggingInteriorId === i.id;
            const x = isDragging ? dragInteriorPosition.x : i.x;
            const y = isDragging ? dragInteriorPosition.y : i.y;
            const isInteriorSelected = selectedInteriorId === i.id;
            const isSmall = i.w <= 32 || i.h <= 32;
            const IconComponent = INTERIOR_ICONS[i.type];
            const preset = INTERIOR_PRESETS.find((p) => p.type === i.type);
            const displayLabel = i.label?.trim() || preset?.label || i.type;
            const rotationDeg = normalizeFloorPlanRotation(i.rotation ?? 0);
            const seatedLine =
              isSeatingInterior(i.type) && i.seatedCapacity != null && i.seatedCapacity > 0
                ? `${i.seatedCapacity} seats`
                : null;
            return (
              <div
                key={i.id}
                className={`group absolute select-none overflow-visible transition-all duration-400 ease-out ${
                  editMode ? "cursor-grab hover:border-gold/40 hover:shadow-gold-glow-hover" : "cursor-default"
                } border ${
                  isDragging ? "cursor-grabbing z-20 border-gold/40 shadow-gold-glow-hover" : "z-0 border-transparent"
                } ${isInteriorSelected ? "ring-2 ring-gold ring-offset-2 ring-offset-background-dark" : ""}`}
                style={{ left: x, top: y, width: i.w, height: i.h }}
                onMouseDown={(e) => {
                  if (editMode) {
                    handleInteriorDragStart(e, i);
                    setSelectedInteriorId(i.id);
                    setSelectedTableId(null);
                    setSelectedWallId(null);
                  }
                }}
                title="Drag to move"
              >
                {editMode && isInteriorSelected && (
                  <FloorPlanRotationHandle onRotateClick={() => handleRotateInterior(i.id)} />
                )}
                <div
                  className="h-full w-full"
                  style={{
                    transform: `rotate(${rotationDeg}deg)`,
                    transformOrigin: "center center",
                  }}
                >
                  <div
                    className={`flex h-full w-full min-h-0 min-w-0 overflow-hidden transition-transform duration-400 ease-out ${
                      isDragging ? "scale-[1.02]" : "group-hover:scale-[1.02]"
                    }`}
                  >
                    <InteriorCanvasVisual
                      type={i.type}
                      w={i.w}
                      h={i.h}
                      displayLabel={displayLabel}
                      seatedLine={seatedLine}
                      IconComponent={IconComponent}
                      isSmall={isSmall}
                    />
                  </div>
                </div>
                {editMode && (
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      handleDeleteInterior(i.id);
                    }}
                    className="absolute -right-1 -top-1 z-40 flex h-5 w-5 items-center justify-center rounded-full border border-error/50 bg-error/90 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-error"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
          {visibleTables.map((t) => {
            const isDragging = draggingId === t.id;
            const isSelected = selectedTableId === t.id;
            const x = isDragging ? dragPosition.x : t.positionX;
            const y = isDragging ? dragPosition.y : t.positionY;
            const shape = normalizeTableShape(t.shape);
            const size = getTableSize(t.capacity, shape);
            const chairPositions = getChairPositions(t.capacity, size.w, size.h);
            const rotationDeg = normalizeFloorPlanRotation(t.rotation ?? 0);
            return (
              <div
                key={t.id}
                className={`group absolute overflow-visible transition-all duration-400 ease-out ${
                  editMode ? "cursor-grab hover:shadow-gold-glow-hover" : "cursor-default"
                } ${isDragging ? "cursor-grabbing z-10 shadow-gold-glow-hover" : "shadow-soft"} ${
                  isSelected ? "ring-2 ring-gold ring-offset-2 ring-offset-background-dark" : ""
                }`}
                style={{
                  left: x,
                  top: y,
                  width: size.w,
                  height: size.h,
                  transition: isDragging ? "none" : "box-shadow 0.4s ease-out",
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (editMode) {
                    handleDragStart(e, t.id);
                    setSelectedTableId(t.id);
                    setSelectedWallId(null);
                    setSelectedInteriorId(null);
                  }
                }}
                title="Drag to move"
              >
                {editMode && isSelected && (
                  <FloorPlanRotationHandle onRotateClick={() => handleRotateTable(t.id)} />
                )}
                <div
                  className="relative h-full w-full"
                  style={{
                    transform: `rotate(${rotationDeg}deg)`,
                    transformOrigin: "center center",
                  }}
                >
                  <div
                    className={`relative h-full w-full transition-transform duration-400 ease-out ${
                      isDragging ? "scale-[1.02]" : "group-hover:scale-[1.02]"
                    }`}
                  >
                    <div
                      className={`absolute inset-0 flex flex-col items-center justify-center gap-0 border-2 shadow-inner ${getTableShapeBorderRadiusClass(shape)} bg-gradient-to-b from-surface-dark-elevated to-surface-dark ${
                        isSelected ? "border-gold" : t.isActive ? "border-gold/40" : "border-border-dark"
                      }`}
                    >
                      <span className="text-base font-bold text-text-on-dark leading-tight">
                        {t.tableNumber}
                      </span>
                      <span className="text-xs font-medium text-text-muted-on-dark">
                        {t.capacity}
                      </span>
                    </div>
                    {chairPositions.map((pos, i) => (
                      <div
                        key={i}
                        className="absolute rounded-full border border-gold/20 bg-surface-dark-elevated shadow-sm"
                        style={{
                          left: pos.x - 6,
                          top: pos.y - 6,
                          width: 12,
                          height: 12,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </div>
        </div>

        <div
          className="flex shrink-0 items-center justify-between gap-md px-md"
          style={{
            height: 36,
            minHeight: 36,
            backgroundColor: "rgba(10, 10, 10, 0.9)",
            borderTop: "1px solid rgba(255, 255, 255, 0.05)",
            fontSize: 12,
            color: "rgba(255, 255, 255, 0.3)",
          }}
        >
          <span>
            {levelTables.length} tables · {walls.length + interior.length} elements
          </span>
          <span
            className={saveStatus === "saving" ? "font-medium text-floor-plan-save-pending" : "font-medium"}
            style={
              saveStatus === "saved"
                ? { color: "rgba(34, 197, 94, 0.7)" }
                : saveStatus === "saving"
                  ? undefined
                  : { color: "rgba(255, 255, 255, 0.3)" }
            }
          >
            {saveStatus === "saving" ? "Unsaved changes" : saveStatus === "saved" ? "All changes saved ✓" : "All changes saved ✓"}
          </span>
        </div>
      </section>

      {addModalOpen && (
        <TableFormModal
          sections={sectionOptions}
          shapeOptions={SHAPE_OPTIONS}
          levelName={levels.find((l) => l.id === currentLevelId)?.name}
          onClose={() => setAddModalOpen(false)}
          onSubmit={(d) => handleAdd(d)}
        />
      )}
      {addLevelModalOpen && (
        <AddLevelModal
          onClose={() => setAddLevelModalOpen(false)}
          onSubmit={handleAddLevel}
        />
      )}
      {templateModalOpen && (
        <TemplateModal
          onClose={() => setTemplateModalOpen(false)}
          onSelect={handleApplyTemplate}
        />
      )}
    </div>
  );
}

type TemplateModalProps = {
  onClose: () => void;
  onSelect: (templateId: string) => void;
};

function TemplateModal({ onClose, onSelect }: TemplateModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg app-card-elevated p-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-text-on-dark">Layout templates</h2>
        <p className="mt-xs text-sm text-text-muted-on-dark">
          Start with a preset layout. Your current floor plan will be replaced.
        </p>
        <div className="mt-lg space-y-md">
          {LAYOUT_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              className="flex w-full flex-col items-start gap-xs rounded-lg border border-card-border bg-card-bg p-md text-left transition-all hover:border-gold/40 hover:bg-gold/5"
            >
              <span className="font-medium text-text-on-dark">{t.name}</span>
              <span className="text-xs text-text-muted-on-dark">{t.description}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-lg w-full rounded-md border border-card-border bg-card-bg px-lg py-md text-sm font-semibold text-text-on-dark"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

type AddLevelModalProps = {
  onClose: () => void;
  onSubmit: (name: string) => void;
};

function AddLevelModal({ onClose, onSubmit }: AddLevelModalProps) {
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md app-card-elevated p-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-text-on-dark">Add level</h2>
        <p className="mt-xs text-sm text-text-muted-on-dark">
          Create a custom level (e.g. Rooftop, Basement, Terrace).
        </p>
        <form onSubmit={handleSubmit} className="mt-lg space-y-lg">
          <div>
            <label className="mb-xs block text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
              Level name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rooftop, Basement, Terrace"
              className="w-full rounded-md border border-card-border bg-card-bg px-md py-sm text-text-on-dark placeholder-text-muted-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
              autoFocus
            />
          </div>
          <div className="flex gap-md pt-md">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-md border border-card-border bg-card-bg px-lg py-md text-sm font-semibold text-text-on-dark transition-colors hover:bg-gold/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 rounded-md bg-gold px-lg py-md text-sm font-semibold text-text-on-gold transition-colors hover:bg-gold-muted"
            >
              Add level
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type SelectedTableCardProps = {
  table: FloorPlanTable;
  sections: string[];
  shapeOptions: { value: TableShape; label: string; Icon: typeof Circle }[];
  onSave: (data: Partial<FloorPlanTable>) => void;
  onDelete: () => void;
};

function SelectedTableCard({
  table,
  sections,
  shapeOptions,
  onSave,
  onDelete,
}: SelectedTableCardProps) {
  const [tableNumber, setTableNumber] = useState(table.tableNumber);
  const [capacity, setCapacity] = useState(table.capacity);
  const [section, setSection] = useState(table.section);
  const [shape, setShape] = useState<TableShape>(table.shape);
  const [isActive, setIsActive] = useState(table.isActive);
  const [rotation, setRotation] = useState(() => normalizeFloorPlanRotation(table.rotation ?? 0));

  useEffect(() => {
    setTableNumber(table.tableNumber);
    setCapacity(table.capacity);
    setSection(table.section);
    setShape(table.shape);
    setIsActive(table.isActive);
    setRotation(normalizeFloorPlanRotation(table.rotation ?? 0));
  }, [table.id, table.tableNumber, table.capacity, table.section, table.shape, table.isActive, table.rotation]);

  const handleSave = () => {
    if (!tableNumber.trim()) return;
    const cap = Math.max(1, Math.min(20, capacity));
    onSave({
      tableNumber: tableNumber.trim(),
      capacity: cap,
      section: section || (sections[0] ?? "Main Floor"),
      shape,
      isActive,
      rotation: normalizeFloorPlanRotation(rotation),
    });
  };

  return (
    <div className="rounded-floor-plan-card border border-floor-plan-selected-card-border bg-floor-plan-selected-card-bg p-floor-plan-selected-padding">
      <div className="space-y-floor-plan-selected-field-gap">
        <div>
          <label className="mb-xs block text-floor-plan-field-label-size font-medium uppercase tracking-floor-plan-label-tracking text-floor-plan-field-label">
            Table number
          </label>
          <input
            type="text"
            value={tableNumber}
            onChange={(e) => setTableNumber(e.target.value)}
            onBlur={handleSave}
            className="h-floor-plan-input-h-compact w-full rounded-floor-plan-pill border border-floor-plan-input-border bg-floor-plan-input-bg px-floor-plan-input-px text-floor-plan-input-font text-text-on-dark placeholder-text-muted-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
          />
        </div>
        <div>
          <label className="mb-xs block text-floor-plan-field-label-size font-medium uppercase tracking-floor-plan-label-tracking text-floor-plan-field-label">
            Capacity
          </label>
          <input
            type="number"
            min={1}
            max={20}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value) || 2)}
            onBlur={handleSave}
            className="h-floor-plan-input-h-compact w-full rounded-floor-plan-pill border border-floor-plan-input-border bg-floor-plan-input-bg px-floor-plan-input-px text-floor-plan-input-font text-text-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
          />
        </div>
        <div>
          <label className="mb-xs block text-floor-plan-field-label-size font-medium uppercase tracking-floor-plan-label-tracking text-floor-plan-field-label">
            Section
          </label>
          <select
            value={section}
            onChange={(e) => {
              setSection(e.target.value);
              onSave({ section: e.target.value });
            }}
            className="h-floor-plan-input-h-compact w-full rounded-floor-plan-pill border border-floor-plan-input-border bg-floor-plan-input-bg px-floor-plan-input-px text-floor-plan-input-font text-text-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
          >
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-xs block text-floor-plan-field-label-size font-medium uppercase tracking-floor-plan-label-tracking text-floor-plan-field-label">
            Shape
          </label>
          <div className="flex flex-wrap gap-xs">
            {shapeOptions.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                title={label}
                onClick={() => {
                  setShape(value);
                  onSave({ shape: value });
                }}
                className={`flex h-floor-plan-input-h-compact flex-1 items-center justify-center rounded-floor-plan-pill border px-sm transition-all ${
                  shape === value
                    ? "border-gold bg-gold/10 text-gold"
                    : "border-floor-plan-input-border bg-floor-plan-input-bg text-floor-plan-card-label hover:border-gold"
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={1.5} />
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-xs block text-floor-plan-field-label-size font-medium uppercase tracking-floor-plan-label-tracking text-floor-plan-field-label">
            Rotation
          </label>
          <select
            value={rotation}
            onChange={(e) => {
              const v = normalizeFloorPlanRotation(Number(e.target.value));
              setRotation(v);
              onSave({ rotation: v });
            }}
            className="h-floor-plan-input-h-compact w-full rounded-floor-plan-pill border border-floor-plan-input-border bg-floor-plan-input-bg px-floor-plan-input-px text-floor-plan-input-font text-text-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
          >
            {FLOOR_PLAN_ROTATION_DEGREES.map((deg) => (
              <option key={deg} value={deg}>
                {deg}°
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between">
          <label className="text-floor-plan-field-label-size font-medium uppercase tracking-floor-plan-label-tracking text-floor-plan-field-label">
            Active
          </label>
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            onClick={() => {
              setIsActive(!isActive);
              onSave({ isActive: !isActive });
            }}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              isActive ? "bg-gold" : "bg-border-dark"
            }`}
          >
            <span
              className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all duration-200 ${
                isActive ? "left-7" : "left-1"
              }`}
            />
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm("Remove this table from the floor plan?")) onDelete();
          }}
          className="mt-floor-plan-delete-mt flex h-floor-plan-delete-h-compact w-full items-center justify-center rounded-floor-plan-pill border border-floor-plan-delete-border bg-floor-plan-delete-bg text-floor-plan-delete-size font-medium text-floor-plan-delete-text transition-colors hover:bg-floor-plan-delete-hover-bg"
        >
          Delete table
        </button>
      </div>
    </div>
  );
}

type SelectedInteriorCardProps = {
  item: FloorPlanInterior;
  snapDim: (n: number) => number;
  onSave: (updates: Partial<Pick<FloorPlanInterior, "label" | "w" | "h" | "seatedCapacity" | "rotation">>) => void;
  onDelete: () => void;
};

function SelectedInteriorCard({ item, snapDim, onSave, onDelete }: SelectedInteriorCardProps) {
  const preset = INTERIOR_PRESETS.find((p) => p.type === item.type);
  const seating = isSeatingInterior(item.type);
  const defaultSeats = defaultSeatedCapacityForInterior(item.type) ?? 4;

  const [label, setLabel] = useState(item.label ?? preset?.label ?? item.type);
  const [w, setW] = useState(item.w);
  const [h, setH] = useState(item.h);
  const [rotation, setRotation] = useState(() => normalizeFloorPlanRotation(item.rotation ?? 0));
  const [seatedCapacity, setSeatedCapacity] = useState(
    item.seatedCapacity ?? (seating ? defaultSeats : 0)
  );

  useEffect(() => {
    setLabel(item.label ?? preset?.label ?? item.type);
    setW(item.w);
    setH(item.h);
    setRotation(normalizeFloorPlanRotation(item.rotation ?? 0));
    setSeatedCapacity(item.seatedCapacity ?? (isSeatingInterior(item.type) ? defaultSeatedCapacityForInterior(item.type) ?? 4 : 0));
  }, [item.id, item.label, item.type, item.w, item.h, item.rotation, item.seatedCapacity, preset?.label]);

  const commitDims = () => {
    let nw = snapDim(Number(w) || preset?.w || 24);
    let nh = snapDim(Number(h) || preset?.h || 24);
    if (item.type === "pillar") {
      const s = Math.min(nw, nh);
      nw = s;
      nh = s;
    }
    setW(nw);
    setH(nh);
    onSave({ w: nw, h: nh });
  };

  const commitSeats = () => {
    if (!seating) return;
    const n = Math.max(1, Math.min(24, Math.round(Number(seatedCapacity) || 1)));
    setSeatedCapacity(n);
    onSave({ seatedCapacity: n });
  };

  return (
    <div className="rounded-floor-plan-card border border-floor-plan-selected-card-border bg-floor-plan-selected-card-bg p-floor-plan-selected-padding">
      <div className="space-y-floor-plan-selected-field-gap">
        <div>
          <label className="mb-xs block text-floor-plan-field-label-size font-medium uppercase tracking-floor-plan-label-tracking text-floor-plan-field-label">
            Element type
          </label>
          <p className="flex h-floor-plan-input-h-compact items-center rounded-floor-plan-pill border border-floor-plan-input-border bg-floor-plan-input-bg px-floor-plan-input-px text-floor-plan-input-font text-text-on-dark capitalize">
            {preset?.label ?? item.type}
          </p>
        </div>
        <div>
          <label className="mb-xs block text-floor-plan-field-label-size font-medium uppercase tracking-floor-plan-label-tracking text-floor-plan-field-label">
            Label
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => onSave({ label })}
            className="h-floor-plan-input-h-compact w-full rounded-floor-plan-pill border border-floor-plan-input-border bg-floor-plan-input-bg px-floor-plan-input-px text-floor-plan-input-font text-text-on-dark placeholder-text-muted-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
          />
        </div>
        <div className="grid grid-cols-2 gap-xs">
          <div>
            <label className="mb-xs block text-floor-plan-field-label-size font-medium uppercase tracking-floor-plan-label-tracking text-floor-plan-field-label">
              Width
            </label>
            <input
              type="number"
              min={16}
              max={480}
              value={w}
              onChange={(e) => setW(Number(e.target.value) || 0)}
              onBlur={commitDims}
              className="h-floor-plan-input-h-compact w-full rounded-floor-plan-pill border border-floor-plan-input-border bg-floor-plan-input-bg px-floor-plan-input-px text-floor-plan-input-font text-text-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            />
          </div>
          <div>
            <label className="mb-xs block text-floor-plan-field-label-size font-medium uppercase tracking-floor-plan-label-tracking text-floor-plan-field-label">
              Height
            </label>
            <input
              type="number"
              min={INTERIOR_DIM_MIN}
              max={INTERIOR_DIM_MAX}
              value={h}
              onChange={(e) => setH(Number(e.target.value) || 0)}
              onBlur={commitDims}
              className="h-floor-plan-input-h-compact w-full rounded-floor-plan-pill border border-floor-plan-input-border bg-floor-plan-input-bg px-floor-plan-input-px text-floor-plan-input-font text-text-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            />
          </div>
        </div>
        <p className="text-floor-plan-field-label-size text-text-muted-on-dark">
          Width and height snap to the layout grid when you leave the field.
          {item.type === "pillar" ? " Pillars stay square (uses the smaller side)." : ""}
        </p>
        <div>
          <label className="mb-xs block text-floor-plan-field-label-size font-medium uppercase tracking-floor-plan-label-tracking text-floor-plan-field-label">
            Rotation
          </label>
          <select
            value={rotation}
            onChange={(e) => {
              const v = normalizeFloorPlanRotation(Number(e.target.value));
              setRotation(v);
              onSave({ rotation: v });
            }}
            className="h-floor-plan-input-h-compact w-full rounded-floor-plan-pill border border-floor-plan-input-border bg-floor-plan-input-bg px-floor-plan-input-px text-floor-plan-input-font text-text-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
          >
            {FLOOR_PLAN_ROTATION_DEGREES.map((deg) => (
              <option key={deg} value={deg}>
                {deg}°
              </option>
            ))}
          </select>
        </div>
        {seating && (
          <div>
            <label className="mb-xs block text-floor-plan-field-label-size font-medium uppercase tracking-floor-plan-label-tracking text-floor-plan-field-label">
              Seats
            </label>
            <input
              type="number"
              min={1}
              max={24}
              value={seatedCapacity}
              onChange={(e) => setSeatedCapacity(Number(e.target.value) || 1)}
              onBlur={commitSeats}
              className="h-floor-plan-input-h-compact w-full rounded-floor-plan-pill border border-floor-plan-input-border bg-floor-plan-input-bg px-floor-plan-input-px text-floor-plan-input-font text-text-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            />
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            if (confirm("Remove this element from the floor plan?")) onDelete();
          }}
          className="mt-floor-plan-delete-mt flex h-floor-plan-delete-h-compact w-full items-center justify-center rounded-floor-plan-pill border border-floor-plan-delete-border bg-floor-plan-delete-bg text-floor-plan-delete-size font-medium text-floor-plan-delete-text transition-colors hover:bg-floor-plan-delete-hover-bg"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

type SelectedWallCardProps = {
  wall: FloorPlanWall;
  onRotate: (direction: 1 | -1) => void;
  onDelete: () => void;
};

function SelectedWallCard({ wall, onRotate, onDelete }: SelectedWallCardProps) {
  const displayAngle = wallRotationDisplayDegrees(wall);
  return (
    <div className="rounded-floor-plan-card border border-floor-plan-selected-card-border bg-floor-plan-selected-card-bg p-floor-plan-selected-padding">
      <div className="space-y-floor-plan-selected-field-gap">
        <div>
          <label className="mb-xs block text-floor-plan-field-label-size font-medium uppercase tracking-floor-plan-label-tracking text-floor-plan-field-label">
            Element type
          </label>
          <p className="flex h-floor-plan-input-h-compact items-center rounded-floor-plan-pill border border-floor-plan-input-border bg-floor-plan-input-bg px-floor-plan-input-px text-floor-plan-input-font text-text-on-dark">
            Wall
          </p>
        </div>
        <div>
          <label className="mb-xs block text-floor-plan-field-label-size font-medium uppercase tracking-floor-plan-label-tracking text-floor-plan-field-label">
            Rotation
          </label>
          <div className="flex items-center gap-xs">
            <button
              type="button"
              onClick={() => onRotate(-1)}
              className="h-floor-plan-input-h-compact shrink-0 rounded-floor-plan-pill border border-floor-plan-input-border bg-floor-plan-input-bg px-sm text-floor-plan-input-font text-text-on-dark transition-colors hover:border-gold"
            >
              −45°
            </button>
            <span className="min-w-0 flex-1 text-center text-floor-plan-input-font text-text-on-dark">{displayAngle}°</span>
            <button
              type="button"
              onClick={() => onRotate(1)}
              className="h-floor-plan-input-h-compact shrink-0 rounded-floor-plan-pill border border-floor-plan-input-border bg-floor-plan-input-bg px-sm text-floor-plan-input-font text-text-on-dark transition-colors hover:border-gold"
            >
              +45°
            </button>
          </div>
          <p className="mt-xs text-floor-plan-field-label-size text-text-muted-on-dark">
            Angle follows wall direction (endpoints). Use the handle on the canvas or ±45° here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm("Remove this wall from the floor plan?")) onDelete();
          }}
          className="mt-floor-plan-delete-mt flex h-floor-plan-delete-h-compact w-full items-center justify-center rounded-floor-plan-pill border border-floor-plan-delete-border bg-floor-plan-delete-bg text-floor-plan-delete-size font-medium text-floor-plan-delete-text transition-colors hover:bg-floor-plan-delete-hover-bg"
        >
          Delete wall
        </button>
      </div>
    </div>
  );
}

type TableEditPopoverProps = {
  table: FloorPlanTable;
  sections: string[];
  shapeOptions: { value: TableShape; label: string; Icon: typeof Circle }[];
  onSave: (data: Partial<FloorPlanTable>) => void;
  onCancel: () => void;
};

function TableEditPopover({
  table,
  sections,
  shapeOptions,
  onSave,
  onCancel,
}: TableEditPopoverProps) {
  const [tableNumber, setTableNumber] = useState(table.tableNumber);
  const [capacity, setCapacity] = useState(table.capacity);
  const [minCapacity, setMinCapacity] = useState(table.minCapacity ?? table.capacity);
  const [maxCapacity, setMaxCapacity] = useState(table.maxCapacity ?? table.capacity);
  const [section, setSection] = useState(table.section);
  const [shape, setShape] = useState<TableShape>(table.shape);
  const [isActive, setIsActive] = useState(table.isActive);
  const [isCombinable, setIsCombinable] = useState(table.isCombinable ?? false);
  const [isGhost, setIsGhost] = useState(table.isGhost ?? false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tableNumber.trim()) return;
    const cap = Math.max(1, Math.min(20, capacity));
    const min = Math.max(1, Math.min(cap, minCapacity));
    const max = Math.max(cap, Math.min(20, maxCapacity));
    onSave({
      tableNumber: tableNumber.trim(),
      capacity: cap,
      minCapacity: min,
      maxCapacity: max,
      section: section || (sections[0] ?? "Main Floor"),
      shape,
      isActive,
      isCombinable,
      isGhost,
      rotation: normalizeFloorPlanRotation(table.rotation ?? 0),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-md">
      <input
        type="text"
        value={tableNumber}
        onChange={(e) => setTableNumber(e.target.value)}
        placeholder="Table label"
        className="w-full rounded-md border border-card-border bg-card-bg px-md py-sm text-sm text-text-on-dark placeholder-text-muted-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
        autoFocus
      />
      <div className="flex gap-md">
        <input
          type="number"
          min={1}
          max={20}
          value={capacity}
          onChange={(e) => setCapacity(Number(e.target.value) || 2)}
          className="w-20 rounded-md border border-card-border bg-card-bg px-md py-sm text-sm text-text-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
        />
        <select
          value={section}
          onChange={(e) => setSection(e.target.value)}
          className="flex-1 rounded-md border border-card-border bg-card-bg px-md py-sm text-sm text-text-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
        >
          {sections.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-xs">
        {shapeOptions.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            title={label}
            onClick={() => setShape(value)}
            className={`flex flex-1 items-center justify-center rounded-md border px-sm py-xs transition-all ${
              shape === value
                ? "border-gold bg-gold/10 text-gold"
                : "border-card-border bg-card-bg text-text-muted-on-dark hover:border-gold/50"
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={1.5} />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-md">
        <div className="flex items-center gap-sm">
          <input
            type="checkbox"
            id="active"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-3 w-3 rounded border-card-border bg-card-bg text-gold focus:ring-gold"
          />
          <label htmlFor="active" className="text-xs text-text-on-dark">Active</label>
        </div>
        <div className="flex items-center gap-sm">
          <input
            type="checkbox"
            id="combinable"
            checked={isCombinable}
            onChange={(e) => setIsCombinable(e.target.checked)}
            className="h-3 w-3 rounded border-card-border bg-card-bg text-gold focus:ring-gold"
          />
          <label htmlFor="combinable" className="text-xs text-text-on-dark">Combinable</label>
        </div>
        <div className="flex items-center gap-sm">
          <input
            type="checkbox"
            id="ghost"
            checked={isGhost}
            onChange={(e) => setIsGhost(e.target.checked)}
            className="h-3 w-3 rounded border-card-border bg-card-bg text-gold focus:ring-gold"
          />
          <label htmlFor="ghost" className="text-xs text-text-on-dark">Ghost (no booking)</label>
        </div>
      </div>
      <div className="flex gap-xs">
        <div>
          <label className="text-[10px] text-text-muted-on-dark">Min</label>
          <input
            type="number"
            min={1}
            max={20}
            value={minCapacity}
            onChange={(e) => setMinCapacity(Number(e.target.value) || 1)}
            className="w-14 rounded border border-card-border bg-card-bg px-xs py-xs text-xs"
          />
        </div>
        <div>
          <label className="text-[10px] text-text-muted-on-dark">Max</label>
          <input
            type="number"
            min={1}
            max={20}
            value={maxCapacity}
            onChange={(e) => setMaxCapacity(Number(e.target.value) || capacity)}
            className="w-14 rounded border border-card-border bg-card-bg px-xs py-xs text-xs"
          />
        </div>
      </div>
      <div className="flex gap-sm pt-xs">
        <button type="button" onClick={onCancel} className="flex-1 rounded-md border border-card-border bg-card-bg px-md py-sm text-xs font-semibold text-text-on-dark">
          Cancel
        </button>
        <button type="submit" className="flex-1 rounded-md bg-gold px-md py-sm text-xs font-semibold text-text-on-gold">
          Save
        </button>
      </div>
    </form>
  );
}

type TableFormModalProps = {
  sections: string[];
  shapeOptions: { value: TableShape; label: string; Icon: typeof Circle }[];
  levelName?: string;
  onClose: () => void;
  onSubmit: (data: Omit<FloorPlanTable, "id" | "positionX" | "positionY" | "levelId">) => void;
};

function TableFormModal({
  sections,
  shapeOptions,
  levelName,
  onClose,
  onSubmit,
}: TableFormModalProps) {
  const [tableNumber, setTableNumber] = useState("");
  const [capacity, setCapacity] = useState(2);
  const [minCapacity, setMinCapacity] = useState(2);
  const [maxCapacity, setMaxCapacity] = useState(2);
  const [section, setSection] = useState(levelName ?? sections[0] ?? "Main Floor");
  const [shape, setShape] = useState<TableShape>("round");
  const [isActive, setIsActive] = useState(true);
  const [isCombinable, setIsCombinable] = useState(false);
  const [isGhost, setIsGhost] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tableNumber.trim()) return;
    const cap = Math.max(1, Math.min(20, capacity));
    const min = Math.max(1, Math.min(cap, minCapacity));
    const max = Math.max(cap, Math.min(20, maxCapacity));
    onSubmit({
      tableNumber: tableNumber.trim(),
      capacity: cap,
      minCapacity: min,
      maxCapacity: max,
      section: section || (sections[0] ?? "Main Floor"),
      shape,
      isActive,
      isCombinable,
      isGhost,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md app-card-elevated p-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-text-on-dark">Add table{levelName ? ` to ${levelName}` : ""}</h2>
        <form onSubmit={handleSubmit} className="mt-lg space-y-lg">
          <div>
            <label className="mb-xs block text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
              Table number / label
            </label>
            <input
              type="text"
              value={tableNumber}
              onChange={(e) => setTableNumber(e.target.value)}
              placeholder="e.g. 1, A3, Patio-2"
              className="w-full rounded-md border border-card-border bg-card-bg px-md py-sm text-text-on-dark placeholder-text-muted-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
              required
            />
          </div>
          <div className="grid grid-cols-3 gap-md">
            <div>
              <label className="mb-xs block text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Capacity
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={capacity}
                onChange={(e) => {
                  const v = Number(e.target.value) || 2;
                  setCapacity(v);
                  setMaxCapacity((prev) => Math.max(prev, v));
                }}
                className="w-full rounded-md border border-card-border bg-card-bg px-md py-sm text-text-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
              />
            </div>
            <div>
              <label className="mb-xs block text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Min
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={minCapacity}
                onChange={(e) => setMinCapacity(Number(e.target.value) || 1)}
                className="w-full rounded-md border border-card-border bg-card-bg px-md py-sm text-text-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
              />
            </div>
            <div>
              <label className="mb-xs block text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Max
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={maxCapacity}
                onChange={(e) => setMaxCapacity(Number(e.target.value) || capacity)}
                className="w-full rounded-md border border-card-border bg-card-bg px-md py-sm text-text-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
              />
            </div>
          </div>
          <div>
            <label className="mb-xs block text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
              Section
            </label>
            <select
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className="w-full rounded-md border border-card-border bg-card-bg px-md py-sm text-text-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            >
              {sections.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-xs block text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
              Shape
            </label>
            <div className="flex gap-md">
              {shapeOptions.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  title={label}
                  onClick={() => setShape(value)}
                  className={`flex flex-1 items-center justify-center rounded-md border px-md py-sm transition-all ${
                    shape === value
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-card-border bg-card-bg text-text-muted-on-dark hover:border-gold/50"
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.5} />
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-lg">
            <div className="flex items-center gap-md">
              <input
                type="checkbox"
                id="isActive"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-card-border bg-card-bg text-gold focus:ring-gold"
              />
              <label htmlFor="isActive" className="text-sm text-text-on-dark">Active</label>
            </div>
            <div className="flex items-center gap-md">
              <input
                type="checkbox"
                id="isCombinable"
                checked={isCombinable}
                onChange={(e) => setIsCombinable(e.target.checked)}
                className="h-4 w-4 rounded border-card-border bg-card-bg text-gold focus:ring-gold"
              />
              <label htmlFor="isCombinable" className="text-sm text-text-on-dark">Combinable</label>
            </div>
            <div className="flex items-center gap-md">
              <input
                type="checkbox"
                id="isGhost"
                checked={isGhost}
                onChange={(e) => setIsGhost(e.target.checked)}
                className="h-4 w-4 rounded border-card-border bg-card-bg text-gold focus:ring-gold"
              />
              <label htmlFor="isGhost" className="text-sm text-text-on-dark">Ghost (no booking)</label>
            </div>
          </div>
          <div className="flex gap-md pt-md">
            <button type="button" onClick={onClose} className="flex-1 rounded-md border border-card-border bg-card-bg px-lg py-md text-sm font-semibold text-text-on-dark transition-colors hover:bg-gold/5">
              Cancel
            </button>
            <button type="submit" className="flex-1 rounded-md bg-gold px-lg py-md text-sm font-semibold text-text-on-gold transition-colors hover:bg-gold-muted">
              Add table
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
