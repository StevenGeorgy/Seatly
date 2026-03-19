/**
 * Floor plan data model and storage.
 * Supports levels, tables, walls, and interior elements.
 */

export type TableShape = "round" | "square" | "rectangle";

const VALID_SHAPES: TableShape[] = ["round", "square", "rectangle"];

/** Tailwind border-radius classes for canvas — mutually exclusive (no rounded-lg + rounded-full conflict). */
export function getTableShapeBorderRadiusClass(shape: TableShape | string | undefined): string {
  if (shape === "round") return "rounded-full";
  if (shape === "rectangle") return "rounded-lg";
  if (shape === "square") return "rounded-md";
  return "rounded-full";
}

export function normalizeTableShape(shape: unknown): TableShape {
  return VALID_SHAPES.includes(shape as TableShape) ? (shape as TableShape) : "round";
}

export type FloorPlanLevel = {
  id: string;
  name: string;
  order: number;
};

export type FloorPlanTable = {
  id: string;
  levelId: string;
  tableNumber: string;
  capacity: number;
  minCapacity?: number;
  maxCapacity?: number;
  section: string;
  shape: TableShape;
  positionX: number;
  positionY: number;
  /** Degrees; multiples of 45 only (0–315). */
  rotation?: number;
  isActive: boolean;
  isCombinable?: boolean;
  isGhost?: boolean;
};

export type FloorPlanWall = {
  id: string;
  levelId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type InteriorType = "bar" | "counter" | "pillar" | "stage" | "sofa" | "booth" | "lounge";

/** Sofa, booth, lounge can store how many guests can sit there. */
export const SEATING_INTERIOR_TYPES: InteriorType[] = ["sofa", "booth", "lounge"];

export function isSeatingInterior(type: InteriorType): boolean {
  return SEATING_INTERIOR_TYPES.includes(type);
}

/** Default seat counts when adding seating furniture from presets. */
export function defaultSeatedCapacityForInterior(type: InteriorType): number | undefined {
  if (type === "sofa") return 4;
  if (type === "booth") return 4;
  if (type === "lounge") return 6;
  return undefined;
}

export const INTERIOR_DIM_MIN = 16;
export const INTERIOR_DIM_MAX = 480;

export function clampInteriorDimension(n: number): number {
  return Math.max(INTERIOR_DIM_MIN, Math.min(INTERIOR_DIM_MAX, Math.round(n)));
}

/** Valid floor-plan rotation steps in degrees. */
export const FLOOR_PLAN_ROTATION_DEGREES = [0, 45, 90, 135, 180, 225, 270, 315] as const;

/** Snap to nearest 45° and normalize to 0–315. */
export function normalizeFloorPlanRotation(deg: number): number {
  const stepped = Math.round(deg / 45) * 45;
  const m = stepped % 360;
  return m < 0 ? m + 360 : m;
}

/** Next rotation in 45° steps (e.g. 315 → 0). */
export function stepFloorPlanRotation(rotation: number, deltaSteps: number): number {
  const current = normalizeFloorPlanRotation(rotation);
  let idx = FLOOR_PLAN_ROTATION_DEGREES.indexOf(current as (typeof FLOOR_PLAN_ROTATION_DEGREES)[number]);
  if (idx < 0) idx = 0;
  const len = FLOOR_PLAN_ROTATION_DEGREES.length;
  const j = (((idx + deltaSteps) % len) + len) % len;
  return FLOOR_PLAN_ROTATION_DEGREES[j];
}

/** Rotate wall endpoints 45° around segment midpoint (no separate rotation field on wall). */
export function rotateWallEndpoints45Degrees(w: FloorPlanWall, direction: 1 | -1): FloorPlanWall {
  const cx = (w.x1 + w.x2) / 2;
  const cy = (w.y1 + w.y2) / 2;
  const rad = (direction * Math.PI) / 4;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rot = (x: number, y: number) => {
    const dx = x - cx;
    const dy = y - cy;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    };
  };
  const p1 = rot(w.x1, w.y1);
  const p2 = rot(w.x2, w.y2);
  return { ...w, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
}

/** Display angle (0–315, 45° steps) derived from wall segment geometry. */
export function wallRotationDisplayDegrees(w: FloorPlanWall): number {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return normalizeFloorPlanRotation(deg);
}

export type FloorPlanInterior = {
  id: string;
  levelId: string;
  type: InteriorType;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  /** Degrees; multiples of 45 only (0–315). */
  rotation?: number;
  /** Guests that can sit on sofa / booth / lounge (optional). */
  seatedCapacity?: number;
};

export type FloorPlanData = {
  levels: FloorPlanLevel[];
  tables: FloorPlanTable[];
  walls: FloorPlanWall[];
  interior: FloorPlanInterior[];
};

const STORAGE_KEY = "seatly-floor-plan";
const DEFAULT_LEVELS: FloorPlanLevel[] = [
  { id: "l-ground", name: "Ground Floor", order: 0 },
  { id: "l-upstairs", name: "Upstairs", order: 1 },
  { id: "l-patio", name: "Patio", order: 2 },
];

function isLegacyFormat(data: unknown): data is Array<Record<string, unknown>> {
  return Array.isArray(data) && data.length >= 0;
}

function migrateLegacyTables(legacy: Array<Record<string, unknown>>): FloorPlanData {
  const groundId = DEFAULT_LEVELS[0].id;
  const tables: FloorPlanTable[] = legacy.map((t, i) => ({
    id: (t.id as string) ?? `t-${Date.now()}-${i}`,
    levelId: (t.levelId as string) ?? groundId,
    tableNumber: (t.tableNumber as string) ?? String(i + 1),
    capacity: (t.capacity as number) ?? 2,
    minCapacity: (t.minCapacity as number) ?? undefined,
    maxCapacity: (t.maxCapacity as number) ?? undefined,
    section: (t.section as string) ?? "Main Floor",
    shape: (t.shape as TableShape) ?? "round",
    positionX: (t.positionX as number) ?? 50,
    positionY: (t.positionY as number) ?? 50,
    isActive: (t.isActive as boolean) ?? true,
    isCombinable: (t.isCombinable as boolean) ?? false,
    isGhost: (t.isGhost as boolean) ?? false,
    rotation: normalizeFloorPlanRotation((t.rotation as number) ?? 0),
  }));
  return {
    levels: [...DEFAULT_LEVELS],
    tables,
    walls: [],
    interior: [],
  };
}

export function loadFloorPlanData(): FloorPlanData {
  if (typeof window === "undefined") {
    return { levels: [...DEFAULT_LEVELS], tables: [], walls: [], interior: [] };
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { levels: [...DEFAULT_LEVELS], tables: [], walls: [], interior: [] };
    const parsed = JSON.parse(stored) as unknown;
    if (isLegacyFormat(parsed)) {
      return migrateLegacyTables(parsed);
    }
    const data = parsed as FloorPlanData;
    if (!data.levels?.length) data.levels = [...DEFAULT_LEVELS];
    if (!data.tables) data.tables = [];
    if (!data.walls) data.walls = [];
    if (!data.interior) data.interior = [];
    data.tables.forEach((t) => {
      if (!t.levelId) t.levelId = data.levels[0]?.id ?? "l-ground";
      t.shape = normalizeTableShape(t.shape);
      t.rotation = normalizeFloorPlanRotation(t.rotation ?? 0);
    });
    data.interior.forEach((item) => {
      item.w = clampInteriorDimension(item.w || INTERIOR_DIM_MIN);
      item.h = clampInteriorDimension(item.h || INTERIOR_DIM_MIN);
      item.rotation = normalizeFloorPlanRotation(item.rotation ?? 0);
      if (item.type === "pillar") {
        const s = Math.min(item.w, item.h);
        item.w = s;
        item.h = s;
      }
      if (!isSeatingInterior(item.type)) {
        item.seatedCapacity = undefined;
      } else {
        const def = defaultSeatedCapacityForInterior(item.type) ?? 4;
        const raw = item.seatedCapacity ?? def;
        item.seatedCapacity = Math.max(1, Math.min(24, Math.round(raw)));
      }
    });
    return data;
  } catch {
    return { levels: [...DEFAULT_LEVELS], tables: [], walls: [], interior: [] };
  }
}

export function saveFloorPlanData(data: FloorPlanData) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export const DEFAULT_LEVELS_EXPORT = DEFAULT_LEVELS;

/** Layout templates based on industry standards (Tableo, Simple Host, Social Tables) */
export type LayoutTemplateId = "fine_dining" | "casual" | "cafe" | "bar" | "empty";

export type LayoutTemplate = {
  id: LayoutTemplateId;
  name: string;
  description: string;
  levels: FloorPlanLevel[];
  tables: Omit<FloorPlanTable, "id" | "positionX" | "positionY" | "levelId">[];
  walls: Omit<FloorPlanWall, "id" | "levelId">[];
  interior: Omit<FloorPlanInterior, "id" | "levelId">[];
};

const GRID = 24;
function snap(v: number) {
  return Math.round(v / GRID) * GRID;
}

export function applyLayoutTemplate(template: LayoutTemplate): FloorPlanData {
  const levels = template.levels.map((l, i) => ({ ...l, id: `l-${template.id}-${i}-${Date.now()}`, order: i }));
  const levelIds = levels.map((l) => l.id);
  const sectionToLevel = new Map<string, string>();
  levels.forEach((l) => sectionToLevel.set(l.name, l.id));
  template.tables.forEach((t) => {
    if (!sectionToLevel.has(t.section)) sectionToLevel.set(t.section, levelIds[0] ?? "");
  });

  const tablesByLevel = new Map<string, typeof template.tables>();
  template.tables.forEach((t) => {
    const lid = sectionToLevel.get(t.section) ?? levelIds[0] ?? "";
    const list = tablesByLevel.get(lid) ?? [];
    list.push(t);
    tablesByLevel.set(lid, list);
  });

  const tables: FloorPlanTable[] = [];
  tablesByLevel.forEach((list, levelId) => {
    list.forEach((t, i) => {
      const col = i % 5;
      const row = Math.floor(i / 5);
      tables.push({
        ...t,
        id: `t-${Date.now()}-${i}`,
        levelId,
        positionX: snap(GRID + col * 72),
        positionY: snap(GRID + row * 68),
        rotation: normalizeFloorPlanRotation(t.rotation ?? 0),
      });
    });
  });

  const walls: FloorPlanWall[] = template.walls.map((w, i) => ({
    ...w,
    id: `w-${Date.now()}-${i}`,
    levelId: levelIds[0] ?? "",
  }));

  const interior: FloorPlanInterior[] = template.interior.map((i, idx) => ({
    ...i,
    id: `i-${Date.now()}-${idx}`,
    levelId: levelIds[0] ?? "",
    rotation: normalizeFloorPlanRotation(i.rotation ?? 0),
  }));

  return { levels, tables, walls, interior };
}

export const LAYOUT_TEMPLATES: LayoutTemplate[] = [
  {
    id: "fine_dining",
    name: "Fine Dining",
    description: "Intimate layout with round tables, private sections",
    levels: [
      { id: "l-main", name: "Main Dining", order: 0 },
      { id: "l-private", name: "Private Room", order: 1 },
    ],
    tables: [
      { tableNumber: "1", capacity: 2, minCapacity: 2, maxCapacity: 2, section: "Main Dining", shape: "round", isActive: true },
      { tableNumber: "2", capacity: 2, minCapacity: 2, maxCapacity: 2, section: "Main Dining", shape: "round", isActive: true },
      { tableNumber: "3", capacity: 4, minCapacity: 2, maxCapacity: 4, section: "Main Dining", shape: "round", isActive: true },
      { tableNumber: "4", capacity: 4, minCapacity: 2, maxCapacity: 4, section: "Main Dining", shape: "round", isActive: true },
      { tableNumber: "5", capacity: 6, minCapacity: 4, maxCapacity: 6, section: "Private Room", shape: "rectangle", isActive: true, isCombinable: true },
    ],
    walls: [],
    interior: [{ type: "bar", x: 480, y: 20, w: 100, h: 24 }],
  },
  {
    id: "casual",
    name: "Casual Dining",
    description: "Mix of tables and booths, high capacity",
    levels: [
      { id: "l-main", name: "Main Floor", order: 0 },
      { id: "l-patio", name: "Patio", order: 1 },
    ],
    tables: [
      { tableNumber: "1", capacity: 4, section: "Main Floor", shape: "square", isActive: true, isCombinable: true },
      { tableNumber: "2", capacity: 4, section: "Main Floor", shape: "square", isActive: true, isCombinable: true },
      { tableNumber: "3", capacity: 6, section: "Main Floor", shape: "rectangle", isActive: true, isCombinable: true },
      { tableNumber: "4", capacity: 4, section: "Main Floor", shape: "round", isActive: true },
      { tableNumber: "5", capacity: 2, section: "Patio", shape: "round", isActive: true },
      { tableNumber: "6", capacity: 4, section: "Patio", shape: "round", isActive: true },
    ],
    walls: [],
    interior: [
      { type: "bar", x: 0, y: 0, w: 120, h: 24 },
      { type: "booth", x: 400, y: 80, w: 70, h: 36 },
    ],
  },
  {
    id: "cafe",
    name: "Café",
    description: "Compact layout with small tables and counter",
    levels: [{ id: "l-main", name: "Main", order: 0 }],
    tables: [
      { tableNumber: "1", capacity: 2, section: "Main", shape: "round", isActive: true },
      { tableNumber: "2", capacity: 2, section: "Main", shape: "round", isActive: true },
      { tableNumber: "3", capacity: 4, section: "Main", shape: "square", isActive: true },
      { tableNumber: "4", capacity: 2, section: "Main", shape: "round", isActive: true },
    ],
    walls: [],
    interior: [{ type: "counter", x: 0, y: 40, w: 150, h: 20 }],
  },
  {
    id: "bar",
    name: "Bar & Lounge",
    description: "Bar-focused with lounge seating",
    levels: [
      { id: "l-main", name: "Main", order: 0 },
      { id: "l-lounge", name: "Lounge", order: 1 },
    ],
    tables: [
      { tableNumber: "1", capacity: 4, section: "Main", shape: "round", isActive: true },
      { tableNumber: "2", capacity: 6, section: "Main", shape: "rectangle", isActive: true },
      { tableNumber: "3", capacity: 4, section: "Lounge", shape: "round", isActive: true },
      { tableNumber: "4", capacity: 2, section: "Lounge", shape: "round", isActive: true },
    ],
    walls: [],
    interior: [
      { type: "bar", x: 0, y: 0, w: 180, h: 28 },
      { type: "sofa", x: 350, y: 100, w: 80, h: 28 },
      { type: "lounge", x: 200, y: 200, w: 90, h: 32 },
    ],
  },
  {
    id: "empty",
    name: "Start from scratch",
    description: "Blank canvas with default levels",
    levels: [...DEFAULT_LEVELS],
    tables: [],
    walls: [],
    interior: [],
  },
];
