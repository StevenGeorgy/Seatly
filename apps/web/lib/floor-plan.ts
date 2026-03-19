/**
 * Floor plan data model and storage.
 * Supports levels, tables, walls, and interior elements.
 */

export type TableShape = "round" | "square" | "rectangle";

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

export type FloorPlanInterior = {
  id: string;
  levelId: string;
  type: InteriorType;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
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
