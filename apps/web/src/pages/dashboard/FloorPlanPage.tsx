import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Eye, ZoomIn, ZoomOut, Grid3X3, Plus } from "lucide-react";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { useUser } from "@/hooks/useUser";
import {
  type DecorationItem,
  useFloorPlan,
  type FloorPlanLayout,
  type FloorPlanRow,
  type TableRow,
} from "@/hooks/useFloorPlan";

const STATUS_FILLS: Record<string, string> = {
  empty: "#C9A84C",
  reserved: "#C9A84C",
  occupied: "#EF4444",
  cleaning: "#6B7280",
  blocked: "#374151",
};

const STATUS_LABELS: Record<string, string> = {
  empty: "Empty",
  reserved: "Reserved",
  occupied: "Occupied",
  cleaning: "Cleaning",
  blocked: "Blocked",
};

type Segment = { id: string; x1: number; y1: number; x2: number; y2: number };
type ObjectKind = "seating" | "fixture";
type FloorPlanSnapshot = {
  tablesDraft: TableRow[];
  layoutDraft: FloorPlanLayout;
  selectedTableId: string | null;
  selectedFixtureId: string | null;
};

function normalizeLayout(layout: FloorPlanRow["layout"]): FloorPlanLayout {
  const source = (layout ?? {}) as Record<string, unknown>;
  return {
    walls: Array.isArray(source.walls) ? (source.walls as Segment[]) : [],
    doors: Array.isArray(source.doors) ? (source.doors as Segment[]) : [],
    windows: Array.isArray(source.windows) ? (source.windows as Segment[]) : [],
    tableTransforms:
      source.tableTransforms && typeof source.tableTransforms === "object"
        ? (source.tableTransforms as Record<
            string,
            { rotation: number; scale?: number; scaleX?: number; scaleY?: number }
          >)
        : {},
    decorations: Array.isArray(source.decorations)
      ? (source.decorations as DecorationItem[])
      : [],
  };
}

function getSeatingType(shape: string): string {
  if (shape === "rectangle") return "TABLE";
  if (shape === "booth") return "BOOTH";
  if (shape === "bar") return "BAR";
  if (shape === "desk") return "DESK";
  return "ROUND";
}

function seatingSubtitle(shape: string, capacity: number): string {
  return `${getSeatingType(shape)} · ${capacity}P`;
}

function snapRotationAngle(angle: number, threshold = 6): number {
  const normalized = ((angle % 360) + 360) % 360;
  const snapPoints = [0, 90, 180, 270, 360];
  for (const point of snapPoints) {
    if (Math.abs(normalized - point) <= threshold) {
      return point === 360 ? 0 : point;
    }
  }
  return normalized;
}

function normalizeRotation(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function ChairDot({ x, y }: { x: number; y: number }) {
  return (
    <circle cx={x} cy={y} r={6} fill="#555" stroke="#333" strokeWidth={1.5} />
  );
}

function RoundTable({
  table,
  rotation,
  scaleX,
  scaleY,
  onMouseDown,
  onClick,
}: {
  table: TableRow;
  rotation: number;
  scaleX: number;
  scaleY: number;
  onMouseDown: (e: MouseEvent<SVGGElement>) => void;
  onClick: () => void;
}) {
  const fill = STATUS_FILLS[table.status] ?? STATUS_FILLS.empty;
  const r = table.capacity <= 2 ? 32 : table.capacity <= 4 ? 38 : 44;
  const chairCount = Math.min(table.capacity, 8);
  const chairs: { x: number; y: number }[] = [];

  for (let i = 0; i < chairCount; i++) {
    const angle = (2 * Math.PI * i) / chairCount - Math.PI / 2;
    chairs.push({
      x: Math.cos(angle) * (r + 14),
      y: Math.sin(angle) * (r + 14),
    });
  }

  return (
    <g
      transform={`translate(${table.position_x ?? 0}, ${table.position_y ?? 0}) rotate(${rotation}) scale(${scaleX}, ${scaleY})`}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className="cursor-pointer"
    >
      {chairs.map((c, i) => (
        <ChairDot key={i} x={c.x} y={c.y} />
      ))}
      <circle
        r={r}
        fill={fill}
        opacity={table.status === "empty" ? 0.85 : 1}
        className="transition-opacity duration-200 hover:opacity-100"
      />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fill="white"
        fontSize={13}
        fontWeight={700}
      >
        <tspan x={0} dy={-6}>{table.label ?? table.table_number ?? "N/A"}</tspan>
        <tspan x={0} dy={12} fontSize={9} fill="currentColor" className="text-gold-light">
          {seatingSubtitle(table.shape, table.capacity)}
        </tspan>
      </text>
    </g>
  );
}

function RectTable({
  table,
  rotation,
  scaleX,
  scaleY,
  onMouseDown,
  onClick,
}: {
  table: TableRow;
  rotation: number;
  scaleX: number;
  scaleY: number;
  onMouseDown: (e: MouseEvent<SVGGElement>) => void;
  onClick: () => void;
}) {
  const fill = STATUS_FILLS[table.status] ?? STATUS_FILLS.empty;
  const w = Math.max(96, table.capacity * 20);
  const h = table.capacity >= 6 ? 52 : 44;
  const seatsPerSide = Math.ceil(table.capacity / 2);

  const chairs: { x: number; y: number }[] = [];
  for (let i = 0; i < seatsPerSide; i++) {
    const xOff = -w / 2 + (w / (seatsPerSide + 1)) * (i + 1);
    chairs.push({ x: xOff, y: -(h / 2 + 14) });
    if (i < table.capacity - seatsPerSide) {
      chairs.push({ x: xOff, y: h / 2 + 14 });
    }
  }

  return (
    <g
      transform={`translate(${table.position_x ?? 0}, ${table.position_y ?? 0}) rotate(${rotation}) scale(${scaleX}, ${scaleY})`}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className="cursor-pointer"
    >
      {chairs.map((c, i) => (
        <ChairDot key={i} x={c.x} y={c.y} />
      ))}
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={8}
        fill={fill}
        opacity={table.status === "empty" ? 0.85 : 1}
        className="transition-opacity duration-200 hover:opacity-100"
      />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fill="white"
        fontSize={13}
        fontWeight={700}
      >
        <tspan x={0} dy={-6}>{table.label ?? table.table_number ?? "N/A"}</tspan>
        <tspan x={0} dy={12} fontSize={9} fill="currentColor" className="text-gold-light">
          {seatingSubtitle(table.shape, table.capacity)}
        </tspan>
      </text>
    </g>
  );
}

function BoothTable({
  table,
  rotation,
  scaleX,
  scaleY,
  onMouseDown,
  onClick,
}: {
  table: TableRow;
  rotation: number;
  scaleX: number;
  scaleY: number;
  onMouseDown: (e: MouseEvent<SVGGElement>) => void;
  onClick: () => void;
}) {
  const w = Math.max(84, table.capacity * 16);
  const h = table.capacity >= 6 ? 44 : 36;
  const boothH = 10;

  return (
    <g
      transform={`translate(${table.position_x ?? 0}, ${table.position_y ?? 0}) rotate(${rotation}) scale(${scaleX}, ${scaleY})`}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className="cursor-pointer"
    >
      {/* Top bench */}
      <rect x={-w / 2} y={-(h / 2 + boothH + 2)} width={w} height={boothH} rx={3} fill="#B91C1C" />
      {/* Bottom bench */}
      <rect x={-w / 2} y={h / 2 + 2} width={w} height={boothH} rx={3} fill="#B91C1C" />
      {/* Table surface */}
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={6}
        fill={STATUS_FILLS[table.status] ?? STATUS_FILLS.empty}
        opacity={table.status === "empty" ? 0.85 : 1}
      />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fill="white"
        fontSize={12}
        fontWeight={700}
      >
        <tspan x={0} dy={-5}>{table.label ?? table.table_number ?? "N/A"}</tspan>
        <tspan x={0} dy={11} fontSize={8} fill="currentColor" className="text-gold-light">
          {seatingSubtitle(table.shape, table.capacity)}
        </tspan>
      </text>
    </g>
  );
}

function BarTable({
  table,
  rotation,
  scaleX,
  scaleY,
  onMouseDown,
  onClick,
}: {
  table: TableRow;
  rotation: number;
  scaleX: number;
  scaleY: number;
  onMouseDown: (e: MouseEvent<SVGGElement>) => void;
  onClick: () => void;
}) {
  const w = Math.max(100, table.capacity * 20);
  const h = 36;
  const seatCount = table.capacity;

  const chairs: { x: number; y: number }[] = [];
  for (let i = 0; i < seatCount; i++) {
    const xOff = -w / 2 + (w / (seatCount + 1)) * (i + 1);
    chairs.push({ x: xOff, y: h / 2 + 14 });
  }

  return (
    <g
      transform={`translate(${table.position_x ?? 0}, ${table.position_y ?? 0}) rotate(${rotation}) scale(${scaleX}, ${scaleY})`}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className="cursor-pointer"
    >
      {chairs.map((c, i) => (
        <ChairDot key={i} x={c.x} y={c.y} />
      ))}
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={6}
        fill={STATUS_FILLS.reserved}
        opacity={table.status === "empty" ? 0.85 : 1}
      />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fill="white"
        fontSize={12}
        fontWeight={700}
      >
        <tspan x={0} dy={-5}>{table.label ?? table.table_number ?? "N/A"}</tspan>
        <tspan x={0} dy={11} fontSize={8} fill="currentColor" className="text-gold-light">
          {seatingSubtitle(table.shape, table.capacity)}
        </tspan>
      </text>
    </g>
  );
}

function DeskTable({
  table,
  rotation,
  scaleX,
  scaleY,
  onMouseDown,
  onClick,
}: {
  table: TableRow;
  rotation: number;
  scaleX: number;
  scaleY: number;
  onMouseDown: (e: MouseEvent<SVGGElement>) => void;
  onClick: () => void;
}) {
  return (
    <g
      transform={`translate(${table.position_x ?? 0}, ${table.position_y ?? 0}) rotate(${rotation}) scale(${scaleX}, ${scaleY})`}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className="cursor-pointer"
    >
      <rect x={-48} y={-26} width={96} height={52} rx={8} fill={STATUS_FILLS.cleaning} />
      <text textAnchor="middle" dominantBaseline="central" fill="white" fontSize={12} fontWeight={700}>
        <tspan x={0} dy={-5}>{table.label ?? table.table_number ?? "N/A"}</tspan>
        <tspan x={0} dy={11} fontSize={8} fill="currentColor" className="text-gold-light">
          {seatingSubtitle(table.shape, table.capacity)}
        </tspan>
      </text>
    </g>
  );
}

function FixtureItem({
  item,
  onMouseDown,
  onClick,
}: {
  item: DecorationItem;
  onMouseDown: (e: MouseEvent<SVGGElement>) => void;
  onClick: () => void;
}) {
  const w = item.width;
  const h = item.height;
  const typeText = item.type.replace(/_/g, " ").toUpperCase();
  const base = (
    <>
      {item.type === "host_stand" && (
        <>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={8} fill="currentColor" className="text-bg-elevated" />
          <rect x={-w / 2 + 6} y={-h / 2 + 6} width={w - 12} height={8} rx={4} fill="currentColor" className="text-text-muted" />
        </>
      )}
      {item.type === "sofa" && (
        <>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={10} fill="currentColor" className="text-danger" />
          <rect x={-w / 2 + 8} y={-h / 2 + 8} width={w - 16} height={h - 16} rx={8} fill="currentColor" className="text-warning" />
        </>
      )}
      {item.type === "planter" && (
        <>
          <rect x={-w / 2} y={-h / 2 + h * 0.35} width={w} height={h * 0.65} rx={6} fill="currentColor" className="text-text-muted" />
          <ellipse cx={0} cy={-h * 0.1} rx={w * 0.45} ry={h * 0.35} fill="currentColor" className="text-success" />
        </>
      )}
      {item.type === "divider" && (
        <>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={4} fill="currentColor" className="text-border" />
          <rect x={-w / 2 + 8} y={-h / 2 + 3} width={w - 16} height={h - 6} rx={3} fill="currentColor" className="text-text-muted" />
        </>
      )}
      {item.type === "service_station" && (
        <>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={8} fill="currentColor" className="text-info" />
          <rect x={-w / 2 + 8} y={-h / 2 + 8} width={w - 16} height={h - 16} rx={6} fill="currentColor" className="text-bg-elevated" />
          <circle cx={-w * 0.22} cy={0} r={6} fill="currentColor" className="text-gold-light" />
          <circle cx={w * 0.22} cy={0} r={6} fill="currentColor" className="text-gold-light" />
        </>
      )}
    </>
  );

  return (
    <g
      transform={`translate(${item.x}, ${item.y}) rotate(${item.rotation})`}
      onMouseDown={onMouseDown}
      onClick={onClick}
      className="cursor-pointer"
    >
      {base}
      {item.label ? (
        <text textAnchor="middle" dominantBaseline="central" fill="white" fontSize={10} fontWeight={700}>
          <tspan x={0} dy={-5}>{item.label}</tspan>
          <tspan x={0} dy={11} fontSize={8} fill="currentColor" className="text-gold-light">
            {typeText}
          </tspan>
        </text>
      ) : (
        <text textAnchor="middle" dominantBaseline="central" fill="white" fontSize={9} fontWeight={700}>
          {typeText}
        </text>
      )}
    </g>
  );
}

function FloorTableSvg({
  table,
  rotation,
  scaleX,
  scaleY,
  onMouseDown,
  onClick,
}: {
  table: TableRow;
  rotation: number;
  scaleX: number;
  scaleY: number;
  onMouseDown: (e: MouseEvent<SVGGElement>) => void;
  onClick: () => void;
}) {
  switch (table.shape) {
    case "rectangle":
      return <RectTable table={table} rotation={rotation} scaleX={scaleX} scaleY={scaleY} onMouseDown={onMouseDown} onClick={onClick} />;
    case "booth":
      return <BoothTable table={table} rotation={rotation} scaleX={scaleX} scaleY={scaleY} onMouseDown={onMouseDown} onClick={onClick} />;
    case "bar":
      return <BarTable table={table} rotation={rotation} scaleX={scaleX} scaleY={scaleY} onMouseDown={onMouseDown} onClick={onClick} />;
    case "desk":
      return <DeskTable table={table} rotation={rotation} scaleX={scaleX} scaleY={scaleY} onMouseDown={onMouseDown} onClick={onClick} />;
    default:
      return <RoundTable table={table} rotation={rotation} scaleX={scaleX} scaleY={scaleY} onMouseDown={onMouseDown} onClick={onClick} />;
  }
}

export default function FloorPlanPage() {
  const { t } = useTranslation();
  const { selectedRestaurantId } = useRestaurantScope();
  const { restaurantRoles } = useUser();
  const {
    tables,
    floorPlans,
    sections,
    loading,
    refetch,
    createSectionAndFloor,
    createTable,
    updateTable,
    deleteTable,
    updateLayout,
  } = useFloorPlan();
  const [selectedSection, setSelectedSection] = useState<string>("");
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [showGrid, setShowGrid] = useState(true);
  const [objectKind, setObjectKind] = useState<ObjectKind>("seating");
  const [newFloorName, setNewFloorName] = useState("");
  const [newTableLabel, setNewTableLabel] = useState("");
  const [newTableShape, setNewTableShape] = useState("circle");
  const [newTableCapacity, setNewTableCapacity] = useState(4);
  const [newFixtureType, setNewFixtureType] = useState<DecorationItem["type"]>("host_stand");
  const [newFixtureLabel, setNewFixtureLabel] = useState("");
  const [newFixtureSeats, setNewFixtureSeats] = useState(2);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [autosaving, setAutosaving] = useState(false);
  const [layoutDraft, setLayoutDraft] = useState<FloorPlanLayout>({
    walls: [],
    doors: [],
    windows: [],
    tableTransforms: {},
    decorations: [],
  });
  const [tablesDraft, setTablesDraft] = useState<TableRow[]>([]);
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const dragRef = useRef<
    | { kind: "table"; id: string; dx: number; dy: number }
    | { kind: "fixture"; id: string; dx: number; dy: number }
    | null
  >(null);
  const rotateRef = useRef<{
    id: string;
    centerX: number;
    centerY: number;
    startAngle: number;
    startRotation: number;
  } | null>(null);
  const resizeRef = useRef<
    | {
        kind: "table";
        id: string;
        handle:
          | "n"
          | "s"
          | "e"
          | "w"
          | "ne"
          | "nw"
          | "se"
          | "sw";
        startScaleX: number;
        startScaleY: number;
        halfWidth: number;
        halfHeight: number;
      }
    | { kind: "fixture"; id: string; startWidth: number; startHeight: number; startDx: number; startDy: number }
    | null
  >(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const interactionMovedRef = useRef(false);
  const historyRef = useRef<FloorPlanSnapshot[]>([]);
  const interactionSnapshotTakenRef = useRef(false);
  const tablesDraftRef = useRef<TableRow[]>([]);
  const layoutDraftRef = useRef<FloorPlanLayout>(layoutDraft);
  const selectedTableIdRef = useRef<string | null>(null);
  const selectedFixtureIdRef = useRef<string | null>(null);

  const rolesAtRestaurant = useMemo(
    () =>
      selectedRestaurantId
        ? restaurantRoles
            .filter((r) => r.restaurant_id === selectedRestaurantId)
            .map((r) => r.role)
        : [],
    [restaurantRoles, selectedRestaurantId],
  );
  const canEdit = rolesAtRestaurant.includes("owner") || rolesAtRestaurant.includes("manager");
  const HISTORY_MAX = 60;

  useEffect(() => {
    tablesDraftRef.current = tablesDraft;
  }, [tablesDraft]);
  useEffect(() => {
    layoutDraftRef.current = layoutDraft;
  }, [layoutDraft]);
  useEffect(() => {
    selectedTableIdRef.current = selectedTableId;
  }, [selectedTableId]);
  useEffect(() => {
    selectedFixtureIdRef.current = selectedFixtureId;
  }, [selectedFixtureId]);

  const pushHistorySnapshot = useCallback(() => {
    const snapshot: FloorPlanSnapshot = {
      tablesDraft: JSON.parse(JSON.stringify(tablesDraftRef.current)),
      layoutDraft: JSON.parse(JSON.stringify(layoutDraftRef.current)),
      selectedTableId: selectedTableIdRef.current,
      selectedFixtureId: selectedFixtureIdRef.current,
    };
    historyRef.current.push(snapshot);
    if (historyRef.current.length > HISTORY_MAX) {
      historyRef.current.shift();
    }
    setCanUndo(historyRef.current.length > 0);
  }, []);

  const undoLastChange = useCallback(() => {
    const last = historyRef.current.pop();
    if (!last) return;
    setTablesDraft(last.tablesDraft);
    setLayoutDraft(last.layoutDraft);
    setSelectedTableId(last.selectedTableId);
    setSelectedFixtureId(last.selectedFixtureId);
    setDirty(true);
    setCanUndo(historyRef.current.length > 0);
  }, []);

  const beginInteractionSnapshot = useCallback(() => {
    if (interactionSnapshotTakenRef.current) return;
    pushHistorySnapshot();
    interactionSnapshotTakenRef.current = true;
  }, [pushHistorySnapshot]);

  useEffect(() => {
    // Keep in-progress edits stable; only hydrate drafts when not actively editing.
    if (dirty || editMode) return;
    setTablesDraft(tables);
    setDirty(false);
    historyRef.current = [];
    setCanUndo(false);
  }, [tables, dirty, editMode]);

  useEffect(() => {
    if (!selectedSection && sections[0]?.id) {
      setSelectedSection(sections[0].id);
    }
  }, [sections, selectedSection]);

  const currentFloorPlan = useMemo(
    () => floorPlans.find((f) => f.section_id === selectedSection) ?? floorPlans[0] ?? null,
    [floorPlans, selectedSection],
  );
  const canvasWidth = currentFloorPlan?.canvas_width ?? 1000;
  const canvasHeight = currentFloorPlan?.canvas_height ?? 700;

  useEffect(() => {
    // Avoid clobbering local draft layout during interactive editing/autosave.
    if (dirty || editMode) return;
    setLayoutDraft(normalizeLayout(currentFloorPlan?.layout ?? null));
    setDirty(false);
    historyRef.current = [];
    setCanUndo(false);
  }, [currentFloorPlan, dirty, editMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      undoLastChange();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undoLastChange]);

  const filteredTables = useMemo(
    () => tablesDraft.filter((tb) => !selectedSection || tb.section_id === selectedSection),
    [selectedSection, tablesDraft],
  );

  const selectedTable = useMemo(
    () => (selectedTableId ? tablesDraft.find((tb) => tb.id === selectedTableId) ?? null : null),
    [selectedTableId, tablesDraft],
  );
  const selectedFixture = useMemo(
    () =>
      selectedFixtureId
        ? layoutDraft.decorations.find((d) => d.id === selectedFixtureId) ?? null
        : null,
    [layoutDraft.decorations, selectedFixtureId],
  );

  const setTablePatch = (tableId: string, patch: Partial<TableRow>) => {
    setTablesDraft((prev) => prev.map((tb) => (tb.id === tableId ? { ...tb, ...patch } : tb)));
    setDirty(true);
  };
  const setFixturePatch = (fixtureId: string, patch: Partial<DecorationItem>) => {
    setLayoutDraft((prev) => ({
      ...prev,
      decorations: prev.decorations.map((d) => (d.id === fixtureId ? { ...d, ...patch } : d)),
    }));
    setDirty(true);
  };

  const getRotation = (tableId: string): number =>
    layoutDraft.tableTransforms[tableId]?.rotation ?? 0;
  const getScaleX = (tableId: string): number => {
    const t = layoutDraft.tableTransforms[tableId];
    if (!t) return 1;
    return t.scaleX ?? t.scale ?? 1;
  };
  const getScaleY = (tableId: string): number => {
    const t = layoutDraft.tableTransforms[tableId];
    if (!t) return 1;
    return t.scaleY ?? t.scale ?? 1;
  };

  const getTableBaseSize = (table: TableRow): { width: number; height: number } => {
    if (table.shape === "rectangle") return { width: Math.max(100, table.capacity * 18), height: 44 };
    if (table.shape === "booth") return { width: 80, height: 56 };
    if (table.shape === "bar") return { width: 120, height: 36 };
    if (table.shape === "desk") return { width: 96, height: 52 };
    const r = table.capacity <= 2 ? 32 : table.capacity <= 4 ? 38 : 44;
    return { width: r * 2, height: r * 2 };
  };

  const pointOnSvg = (
    e: MouseEvent<SVGSVGElement> | MouseEvent<SVGGElement> | MouseEvent<SVGCircleElement>,
  ) => {
    if (!svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvasWidth,
      y: ((e.clientY - rect.top) / rect.height) * canvasHeight,
    };
  };

  const onTableDown = (tableId: string, e: MouseEvent<SVGGElement>) => {
    if (!editMode || !canEdit) return;
    beginInteractionSnapshot();
    interactionMovedRef.current = false;
    const p = pointOnSvg(e);
    const table = tablesDraft.find((tb) => tb.id === tableId);
    if (!p || !table) return;
    const centerX = table.position_x ?? 0;
    const centerY = table.position_y ?? 0;
    const base = getTableBaseSize(table);
    const scaleX = getScaleX(tableId);
    const scaleY = getScaleY(tableId);
    const halfW = (base.width * scaleX) / 2;
    const halfH = (base.height * scaleY) / 2;
    const relX = p.x - centerX;
    const relY = p.y - centerY;
    const absX = Math.abs(relX);
    const absY = Math.abs(relY);
    const edgeThreshold = 7;
    const cornerThreshold = 10;

    const nearLeft = Math.abs(absX - halfW) <= edgeThreshold;
    const nearTop = Math.abs(absY - halfH) <= edgeThreshold;
    const inVerticalRange = absY <= halfH + edgeThreshold;
    const inHorizontalRange = absX <= halfW + edgeThreshold;

    const nearCornerX = Math.abs(absX - halfW) <= cornerThreshold;
    const nearCornerY = Math.abs(absY - halfH) <= cornerThreshold;

    if (nearCornerX && nearCornerY) {
      const handle =
        relX >= 0 && relY >= 0
          ? "se"
          : relX >= 0 && relY < 0
            ? "ne"
            : relX < 0 && relY >= 0
              ? "sw"
              : "nw";
      onTableResizeStart(tableId, handle, e as unknown as MouseEvent<SVGCircleElement>);
      return;
    }

    if (nearLeft && inVerticalRange) {
      const handle = relX >= 0 ? "e" : "w";
      onTableResizeStart(tableId, handle, e as unknown as MouseEvent<SVGCircleElement>);
      return;
    }

    if (nearTop && inHorizontalRange) {
      const handle = relY >= 0 ? "s" : "n";
      onTableResizeStart(tableId, handle, e as unknown as MouseEvent<SVGCircleElement>);
      return;
    }

    if (e.shiftKey) {
      rotateRef.current = {
        id: tableId,
        centerX,
        centerY,
        startAngle: Math.atan2(p.y - centerY, p.x - centerX),
        startRotation: getRotation(tableId),
      };
      return;
    }
    dragRef.current = { kind: "table", id: tableId, dx: p.x - (table.position_x ?? 0), dy: p.y - (table.position_y ?? 0) };
  };

  const onFixtureDown = (fixtureId: string, e: MouseEvent<SVGGElement>) => {
    if (!editMode || !canEdit) return;
    beginInteractionSnapshot();
    interactionMovedRef.current = false;
    const p = pointOnSvg(e);
    const fixture = layoutDraft.decorations.find((d) => d.id === fixtureId);
    if (!p || !fixture) return;
    dragRef.current = { kind: "fixture", id: fixtureId, dx: p.x - fixture.x, dy: p.y - fixture.y };
  };

  const onTableResizeStart = (
    tableId: string,
    handle:
      | "n"
      | "s"
      | "e"
      | "w"
      | "ne"
      | "nw"
      | "se"
      | "sw",
    e: MouseEvent<SVGCircleElement>,
  ) => {
    if (!editMode || !canEdit) return;
    beginInteractionSnapshot();
    interactionMovedRef.current = false;
    dragRef.current = null;
    rotateRef.current = null;
    e.stopPropagation();
    e.preventDefault();
    const table = tablesDraft.find((tb) => tb.id === tableId);
    if (!table) return;
    const base = getTableBaseSize(table);
    const startScaleX = getScaleX(tableId);
    const startScaleY = getScaleY(tableId);
    resizeRef.current = {
      kind: "table",
      id: tableId,
      handle,
      startScaleX,
      startScaleY,
      halfWidth: (base.width * startScaleX) / 2,
      halfHeight: (base.height * startScaleY) / 2,
    };
  };

  const onFixtureResizeStart = (fixtureId: string, e: MouseEvent<SVGCircleElement>) => {
    if (!editMode || !canEdit) return;
    beginInteractionSnapshot();
    interactionMovedRef.current = false;
    dragRef.current = null;
    rotateRef.current = null;
    e.stopPropagation();
    e.preventDefault();
    const point = pointOnSvg(e);
    const fixture = layoutDraft.decorations.find((d) => d.id === fixtureId);
    if (!point || !fixture) return;
    resizeRef.current = {
      kind: "fixture",
      id: fixtureId,
      startWidth: fixture.width,
      startHeight: fixture.height,
      startDx: point.x - fixture.x,
      startDy: point.y - fixture.y,
    };
  };

  const onCanvasMove = (e: MouseEvent<SVGSVGElement>) => {
    if (rotateRef.current) {
      const p = pointOnSvg(e);
      if (!p) return;
      const currentAngle = Math.atan2(
        p.y - rotateRef.current.centerY,
        p.x - rotateRef.current.centerX,
      );
      const deltaDeg = (currentAngle - rotateRef.current.startAngle) * (180 / Math.PI);
      const nextRotation = normalizeRotation(rotateRef.current.startRotation + deltaDeg);
      setLayoutDraft((prev) => ({
        ...prev,
        tableTransforms: {
          ...prev.tableTransforms,
          [rotateRef.current!.id]: {
            rotation: nextRotation,
            scaleX:
              prev.tableTransforms[rotateRef.current!.id]?.scaleX ??
              prev.tableTransforms[rotateRef.current!.id]?.scale ??
              1,
            scaleY:
              prev.tableTransforms[rotateRef.current!.id]?.scaleY ??
              prev.tableTransforms[rotateRef.current!.id]?.scale ??
              1,
          },
        },
      }));
      setDirty(true);
      interactionMovedRef.current = true;
      return;
    }
    if (resizeRef.current) {
      const p = pointOnSvg(e);
      if (!p) return;
      if (resizeRef.current.kind === "table") {
        const table = tablesDraft.find((tb) => tb.id === resizeRef.current!.id);
        if (!table) return;
        const cx = table.position_x ?? 0;
        const cy = table.position_y ?? 0;
        const relX = Math.abs(p.x - cx);
        const relY = Math.abs(p.y - cy);
        const xRatio = relX / Math.max(resizeRef.current.halfWidth, 1);
        const yRatio = relY / Math.max(resizeRef.current.halfHeight, 1);
        const handle = resizeRef.current.handle;
        const nextScaleX = Math.max(
          0.6,
          Math.min(
            2.4,
            resizeRef.current.startScaleX *
              (handle === "n" || handle === "s" ? 1 : xRatio),
          ),
        );
        const nextScaleY = Math.max(
          0.6,
          Math.min(
            2.4,
            resizeRef.current.startScaleY *
              (handle === "e" || handle === "w" ? 1 : yRatio),
          ),
        );
        setLayoutDraft((prev) => ({
          ...prev,
          tableTransforms: {
            ...prev.tableTransforms,
            [table.id]: {
              rotation: prev.tableTransforms[table.id]?.rotation ?? 0,
              scaleX: nextScaleX,
              scaleY: nextScaleY,
            },
          },
        }));
        setDirty(true);
        interactionMovedRef.current = true;
      } else {
        const fixture = layoutDraft.decorations.find((d) => d.id === resizeRef.current!.id);
        if (!fixture) return;
        const dx = Math.abs(p.x - fixture.x);
        const dy = Math.abs(p.y - fixture.y);
        setFixturePatch(fixture.id, {
          width: Math.max(24, Math.min(320, dx * 2)),
          height: Math.max(24, Math.min(320, dy * 2)),
        });
        interactionMovedRef.current = true;
      }
      return;
    }
    if (!dragRef.current) return;
    const p = pointOnSvg(e);
    if (!p) return;
    if (dragRef.current.kind === "table") {
      setTablePatch(dragRef.current.id, {
        position_x: Math.max(20, Math.min(canvasWidth - 20, p.x - dragRef.current.dx)),
        position_y: Math.max(20, Math.min(canvasHeight - 20, p.y - dragRef.current.dy)),
      });
      interactionMovedRef.current = true;
    } else {
      setFixturePatch(dragRef.current.id, {
        x: Math.max(20, Math.min(canvasWidth - 20, p.x - dragRef.current.dx)),
        y: Math.max(20, Math.min(canvasHeight - 20, p.y - dragRef.current.dy)),
      });
      interactionMovedRef.current = true;
    }
  };

  const onCanvasUp = () => {
    if (rotateRef.current) {
      const id = rotateRef.current.id;
      setLayoutDraft((prev) => ({
        ...prev,
        tableTransforms: {
          ...prev.tableTransforms,
          [id]: {
            rotation: snapRotationAngle(prev.tableTransforms[id]?.rotation ?? 0),
            scaleX: prev.tableTransforms[id]?.scaleX ?? prev.tableTransforms[id]?.scale ?? 1,
            scaleY: prev.tableTransforms[id]?.scaleY ?? prev.tableTransforms[id]?.scale ?? 1,
          },
        },
      }));
    }
    dragRef.current = null;
    resizeRef.current = null;
    rotateRef.current = null;
    interactionSnapshotTakenRef.current = false;
  };

  const onAddFloor = async () => {
    if (!newFloorName.trim() || !canEdit) return;
    const created = await createSectionAndFloor(newFloorName.trim());
    if (created) {
      setSelectedSection(created.sectionId);
      setNewFloorName("");
    }
  };

  const onAddObject = async () => {
    if (!selectedSection || !canEdit) return;
    pushHistorySnapshot();
    if (objectKind === "seating") {
      const created = await createTable({
        sectionId: selectedSection,
        label: newTableLabel.trim() || `T${Date.now().toString().slice(-3)}`,
        shape: newTableShape,
        capacity: Math.max(1, newTableCapacity),
        x: Math.round(canvasWidth / 2),
        y: Math.round(canvasHeight / 2),
      });
      if (created) {
        setTablesDraft((prev) => [...prev, created]);
        setSelectedTableId(created.id);
        setSelectedFixtureId(null);
        setNewTableLabel("");
        setDirty(true);
      }
      return;
    }

    const presetSize: Record<DecorationItem["type"], { w: number; h: number }> = {
      host_stand: { w: 96, h: 56 },
      sofa: { w: 120, h: 60 },
      planter: { w: 64, h: 64 },
      divider: { w: 140, h: 24 },
      service_station: { w: 120, h: 72 },
    };
    const size = presetSize[newFixtureType];
    const newDecoration: DecorationItem = {
      id: `decor-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: newFixtureType,
      x: Math.round(canvasWidth / 2),
      y: Math.round(canvasHeight / 2),
      rotation: 0,
      width: size.w,
      height: size.h,
      label: newFixtureLabel.trim() || null,
      seats: newFixtureType === "sofa" ? Math.max(1, newFixtureSeats) : null,
    };
    setLayoutDraft((prev) => ({ ...prev, decorations: [...prev.decorations, newDecoration] }));
    setDirty(true);
    setSelectedFixtureId(newDecoration.id);
    setSelectedTableId(null);
    setNewFixtureLabel("");
    setDirty(true);
  };

  const persistDraft = useCallback(async (manual = false) => {
    if (!canEdit || !currentFloorPlan || !dirty) return;
    if (manual) {
      setSaving(true);
    } else {
      setAutosaving(true);
    }
    const originalMap = new Map(tables.map((tb) => [tb.id, tb]));
    for (const tb of filteredTables) {
      const prev = originalMap.get(tb.id);
      if (!prev) continue;
      if (
        prev.position_x !== tb.position_x ||
        prev.position_y !== tb.position_y ||
        prev.status !== tb.status ||
        prev.capacity !== tb.capacity ||
        prev.shape !== tb.shape ||
        prev.label !== tb.label
      ) {
        await updateTable(tb.id, {
          position_x: tb.position_x,
          position_y: tb.position_y,
          status: tb.status,
          capacity: tb.capacity,
          shape: tb.shape,
          label: tb.label,
        });
      }
    }
    await updateLayout(currentFloorPlan.id, layoutDraft);
    setDirty(false);
    if (manual) {
      setSaving(false);
    } else {
      setAutosaving(false);
    }
  }, [canEdit, currentFloorPlan, dirty, tables, filteredTables, updateTable, updateLayout, layoutDraft]);

  const onSave = async () => {
    await persistDraft(true);
  };

  useEffect(() => {
    if (!editMode || !canEdit || !currentFloorPlan || !dirty) return;
    const timer = setTimeout(() => {
      void persistDraft(false);
    }, 900);
    return () => clearTimeout(timer);
  }, [editMode, canEdit, currentFloorPlan, dirty, persistDraft]);

  const onDeleteSelectedTable = async () => {
    if (!selectedTable || !canEdit) return;
    pushHistorySnapshot();
    setSaving(true);
    const ok = await deleteTable(selectedTable.id);
    if (ok) {
      setTablesDraft((prev) => prev.filter((tb) => tb.id !== selectedTable.id));
      setLayoutDraft((prev) => {
        const next = { ...prev.tableTransforms };
        delete next[selectedTable.id];
        return { ...prev, tableTransforms: next };
      });
      setSelectedTableId(null);
      setDirty(false);
    }
    setSaving(false);
  };

  const commitTableRotationSnap = (tableId: string) => {
    setLayoutDraft((prev) => ({
      ...prev,
      tableTransforms: {
        ...prev.tableTransforms,
        [tableId]: {
          rotation: snapRotationAngle(prev.tableTransforms[tableId]?.rotation ?? 0),
          scaleX: prev.tableTransforms[tableId]?.scaleX ?? prev.tableTransforms[tableId]?.scale ?? 1,
          scaleY: prev.tableTransforms[tableId]?.scaleY ?? prev.tableTransforms[tableId]?.scale ?? 1,
        },
      },
    }));
    setDirty(true);
  };

  const commitFixtureRotationSnap = (fixtureId: string) => {
    setLayoutDraft((prev) => ({
      ...prev,
      decorations: prev.decorations.map((d) =>
        d.id === fixtureId
          ? { ...d, rotation: snapRotationAngle(d.rotation) }
          : d,
      ),
    }));
    setDirty(true);
  };

  const saveStatusLabel = autosaving
    ? t("dashboard.floorPlan.statusAutosaving")
    : saving
      ? t("dashboard.floorPlan.statusSaving")
      : dirty
        ? t("dashboard.floorPlan.statusUnsaved")
        : t("dashboard.floorPlan.statusSaved");
  const saveStatusClass = autosaving || saving
    ? "text-info border-info/40 bg-info/10"
    : dirty
      ? "text-warning border-warning/40 bg-warning/10"
      : "text-success border-success/40 bg-success/10";

  return (
    <AnimatedPage className="flex flex-col gap-5">
      <PageHeader
        title={t("dashboard.floorPlan.title")}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant={editMode ? "default" : "outline"}
              size="default"
              className="gap-2"
              onClick={() => setEditMode((v) => !v)}
              disabled={!canEdit}
            >
              {editMode ? <Eye className="size-4" /> : <Pencil className="size-4" />}
              {editMode ? t("dashboard.floorPlan.liveMode") : t("dashboard.floorPlan.editMode")}
            </Button>
            <Button size="default" className="gap-2" disabled={!canEdit || saving} onClick={() => void onSave()}>
              {t("dashboard.floorPlan.saveLayout")}
            </Button>
            <Button
              size="default"
              variant="outline"
              className="gap-2"
              disabled={!canUndo}
              onClick={() => undoLastChange()}
            >
              {t("dashboard.floorPlan.undo")}
            </Button>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${saveStatusClass}`}
              aria-live="polite"
            >
              {saveStatusLabel}
            </span>
          </div>
        }
      />

      <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={showGrid ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => setShowGrid(!showGrid)}
          >
            <Grid3X3 className="size-3.5" />
            {t("dashboard.floorPlan.grid")}
          </Button>

          {sections.length > 0 && (
            <Tabs value={selectedSection} onValueChange={setSelectedSection}>
              <TabsList>
                {sections.map((s) => (
                  <TabsTrigger key={s.id} value={s.id}>{s.name}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          {editMode && canEdit && (
            <>
              <Input
                value={newFloorName}
                onChange={(e) => setNewFloorName(e.target.value)}
                placeholder={t("dashboard.floorPlan.floorNamePlaceholder")}
                className="h-8 w-40"
              />
              <Button size="sm" variant="outline" onClick={() => void onAddFloor()} className="gap-1">
                <Plus className="size-3.5" />
                {t("dashboard.floorPlan.addFloor")}
              </Button>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => setZoom((z) => Math.max(50, z - 10))}
          >
            <ZoomOut className="size-3.5" />
          </Button>
          <span className="min-w-[48px] text-center text-xs font-medium text-text-secondary">
            {zoom}%
          </span>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => setZoom((z) => Math.min(200, z + 10))}
          >
            <ZoomIn className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoom(100)}
          >
            {t("dashboard.floorPlan.resetZoom")}
          </Button>
        </div>
      </div>

      {editMode && canEdit && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-surface p-2">
          <Select value={objectKind} onValueChange={(v) => setObjectKind(v as ObjectKind)}>
            <SelectTrigger className="h-8 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="seating">{t("dashboard.floorPlan.kindSeating")}</SelectItem>
              <SelectItem value="fixture">{t("dashboard.floorPlan.kindFixture")}</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={objectKind === "seating" ? newTableShape : newFixtureType}
            onValueChange={(v) => {
              if (objectKind === "seating") {
                setNewTableShape(v);
              } else {
                setNewFixtureType(v as DecorationItem["type"]);
              }
            }}
          >
            <SelectTrigger className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {objectKind === "seating" ? (
                <>
                  <SelectItem value="circle">{t("dashboard.floorPlan.shapeCircle")}</SelectItem>
                  <SelectItem value="rectangle">{t("dashboard.floorPlan.shapeRectangle")}</SelectItem>
                  <SelectItem value="booth">{t("dashboard.floorPlan.shapeBooth")}</SelectItem>
                  <SelectItem value="bar">{t("dashboard.floorPlan.shapeBar")}</SelectItem>
                  <SelectItem value="desk">{t("dashboard.floorPlan.shapeDesk")}</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="host_stand">{t("dashboard.floorPlan.fixtureHostStand")}</SelectItem>
                  <SelectItem value="sofa">{t("dashboard.floorPlan.fixtureSofa")}</SelectItem>
                  <SelectItem value="planter">{t("dashboard.floorPlan.fixturePlanter")}</SelectItem>
                  <SelectItem value="divider">{t("dashboard.floorPlan.fixtureDivider")}</SelectItem>
                  <SelectItem value="service_station">{t("dashboard.floorPlan.fixtureServiceStation")}</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>

          <Input
            className="h-8 w-32"
            value={objectKind === "seating" ? newTableLabel : newFixtureLabel}
            onChange={(e) => {
              if (objectKind === "seating") {
                setNewTableLabel(e.target.value);
              } else {
                setNewFixtureLabel(e.target.value);
              }
            }}
            placeholder={
              objectKind === "seating"
                ? t("dashboard.floorPlan.tableLabel")
                : t("dashboard.floorPlan.fixtureLabel")
            }
          />

          <Input
            className="h-8 w-24"
            type="number"
            min={1}
            value={objectKind === "seating" ? newTableCapacity : (newFixtureType === "sofa" ? newFixtureSeats : 1)}
            disabled={objectKind === "fixture" && newFixtureType !== "sofa"}
            onChange={(e) => {
              const next = Number(e.target.value) || 1;
              if (objectKind === "seating") {
                setNewTableCapacity(next);
              } else {
                setNewFixtureSeats(next);
              }
            }}
            placeholder={t("dashboard.floorPlan.seats")}
          />

          <Button size="sm" onClick={() => void onAddObject()}>
            {objectKind === "seating"
              ? t("dashboard.floorPlan.addSeating")
              : t("dashboard.floorPlan.addFixture")}
          </Button>
        </div>
      )}

      <div className="relative overflow-hidden rounded-xl border border-border bg-bg-surface">
        {loading ? (
          <div className="flex h-[500px] items-center justify-center">
            <div className="size-8 animate-spin rounded-full border-2 border-gold border-t-transparent" />
          </div>
        ) : (
          <div
            className="overflow-auto"
            style={{ maxHeight: "calc(100vh - 280px)" }}
          >
            <svg
              ref={svgRef}
              width={canvasWidth * (zoom / 100)}
              height={canvasHeight * (zoom / 100)}
              viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
              className="block"
              onMouseMove={onCanvasMove}
              onMouseUp={onCanvasUp}
              onMouseLeave={onCanvasUp}
            >
              {showGrid && (
                <>
                  <defs>
                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth={0.5} className="text-border" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#grid)" />
                </>
              )}
              {layoutDraft.walls.map((w) => (
                <line key={w.id} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke="currentColor" className="text-text-primary" strokeWidth={8} />
              ))}
              {layoutDraft.decorations.map((item) => (
                <FixtureItem
                  key={item.id}
                  item={item}
                  onMouseDown={(e) => onFixtureDown(item.id, e)}
                  onClick={() => {
                    if (interactionMovedRef.current) {
                      interactionMovedRef.current = false;
                      return;
                    }
                    setSelectedFixtureId(item.id);
                    setSelectedTableId(null);
                  }}
                />
              ))}
              {editMode && canEdit && selectedFixture ? (
                <circle
                  cx={selectedFixture.x + selectedFixture.width / 2 + 10}
                  cy={selectedFixture.y + selectedFixture.height / 2 + 10}
                  r={7}
                  fill="currentColor"
                  className="cursor-nwse-resize text-gold"
                  onMouseDown={(e) => onFixtureResizeStart(selectedFixture.id, e)}
                />
              ) : null}

              {filteredTables.map((tb) => (
                <FloorTableSvg
                  key={tb.id}
                  table={tb}
                  rotation={getRotation(tb.id)}
                  scaleX={getScaleX(tb.id)}
                  scaleY={getScaleY(tb.id)}
                  onMouseDown={(e) => onTableDown(tb.id, e)}
                  onClick={() => {
                    if (interactionMovedRef.current) {
                      interactionMovedRef.current = false;
                      return;
                    }
                    setSelectedTableId(tb.id);
                    setSelectedFixtureId(null);
                  }}
                />
              ))}
            </svg>
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded-lg border border-border bg-bg-elevated/90 px-3 py-2 backdrop-blur-sm">
          {Object.entries(STATUS_FILLS).map(([status, color]) => (
            <div key={status} className="flex items-center gap-1.5">
              <div
                className="size-2.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-[10px] font-medium text-text-muted">
                {STATUS_LABELS[status]}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Sheet open={!!selectedTable} onOpenChange={() => setSelectedTableId(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>
              {t("dashboard.floorPlan.tableNumber")} {selectedTable?.table_number ?? selectedTable?.label}
            </SheetTitle>
          </SheetHeader>
          {selectedTable ? (
            <div className="mt-6 flex flex-col gap-4">
              <div className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-4 py-3">
                <span className="text-sm text-text-secondary">{t("dashboard.floorPlan.tableName")}</span>
                <Input
                  className="h-8 w-36"
                  value={selectedTable.label ?? selectedTable.table_number ?? ""}
                  onChange={(e) =>
                    setTablePatch(selectedTable.id, {
                      label: e.target.value || null,
                      table_number: e.target.value || selectedTable.table_number,
                    })
                  }
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-4 py-3">
                <span className="text-sm text-text-secondary">{t("dashboard.floorPlan.capacity")}</span>
                <Input
                  type="number"
                  min={1}
                  className="h-8 w-24"
                  value={selectedTable.capacity}
                  onChange={(e) => setTablePatch(selectedTable.id, { capacity: Number(e.target.value) || 1 })}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-4 py-3">
                <span className="text-sm text-text-secondary">{t("dashboard.reservations.status")}</span>
                <Select value={selectedTable.status} onValueChange={(status) => setTablePatch(selectedTable.id, { status })}>
                  <SelectTrigger className="h-8 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="empty">empty</SelectItem>
                    <SelectItem value="reserved">reserved</SelectItem>
                    <SelectItem value="occupied">occupied</SelectItem>
                    <SelectItem value="cleaning">cleaning</SelectItem>
                    <SelectItem value="blocked">blocked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-4 py-3">
                <span className="text-sm text-text-secondary">{t("dashboard.floorPlan.shape")}</span>
                <Select value={selectedTable.shape} onValueChange={(shape) => setTablePatch(selectedTable.id, { shape })}>
                  <SelectTrigger className="h-8 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="circle">{t("dashboard.floorPlan.shapeCircle")}</SelectItem>
                    <SelectItem value="rectangle">{t("dashboard.floorPlan.shapeRectangle")}</SelectItem>
                    <SelectItem value="booth">{t("dashboard.floorPlan.shapeBooth")}</SelectItem>
                    <SelectItem value="bar">{t("dashboard.floorPlan.shapeBar")}</SelectItem>
                    <SelectItem value="desk">{t("dashboard.floorPlan.shapeDesk")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-lg border border-border bg-bg-elevated px-4 py-3">
                <Label className="text-sm text-text-secondary">{t("dashboard.floorPlan.rotation")}</Label>
                <p className="mt-1 text-xs text-text-muted">
                  {t("dashboard.floorPlan.rotateHint")}
                </p>
                <Input
                  className="mt-2"
                  type="range"
                  min={0}
                  max={360}
                  value={getRotation(selectedTable.id)}
                  onChange={(e) => {
                    const next = normalizeRotation(Number(e.target.value));
                    setLayoutDraft((prev) => ({
                      ...prev,
                      tableTransforms: {
                        ...prev.tableTransforms,
                        [selectedTable.id]: {
                          rotation: next,
                          scaleX:
                            prev.tableTransforms[selectedTable.id]?.scaleX ??
                            prev.tableTransforms[selectedTable.id]?.scale ??
                            1,
                          scaleY:
                            prev.tableTransforms[selectedTable.id]?.scaleY ??
                            prev.tableTransforms[selectedTable.id]?.scale ??
                            1,
                        },
                      },
                    }));
                    setDirty(true);
                  }}
                  onMouseUp={() => commitTableRotationSnap(selectedTable.id)}
                  onTouchEnd={() => commitTableRotationSnap(selectedTable.id)}
                />
              </div>
              {canEdit && (
                <Button
                  variant="destructive"
                  onClick={() => void onDeleteSelectedTable()}
                  disabled={saving}
                >
                  {t("dashboard.floorPlan.deleteTable")}
                </Button>
              )}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={!!selectedFixture} onOpenChange={() => setSelectedFixtureId(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t("dashboard.floorPlan.fixtureSettings")}</SheetTitle>
          </SheetHeader>
          {selectedFixture ? (
            <div className="mt-6 flex flex-col gap-4">
              <div className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-4 py-3">
                <span className="text-sm text-text-secondary">{t("dashboard.floorPlan.fixtureLabel")}</span>
                <Input
                  className="h-8 w-36"
                  value={selectedFixture.label ?? ""}
                  onChange={(e) => setFixturePatch(selectedFixture.id, { label: e.target.value || null })}
                />
              </div>
              {selectedFixture.type === "sofa" ? (
                <div className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-4 py-3">
                  <span className="text-sm text-text-secondary">{t("dashboard.floorPlan.seats")}</span>
                  <Input
                    className="h-8 w-24"
                    type="number"
                    min={1}
                    value={selectedFixture.seats ?? 1}
                    onChange={(e) => setFixturePatch(selectedFixture.id, { seats: Number(e.target.value) || 1 })}
                  />
                </div>
              ) : null}
              <div className="rounded-lg border border-border bg-bg-elevated px-4 py-3">
                <Label className="text-sm text-text-secondary">{t("dashboard.floorPlan.rotation")}</Label>
                <Input
                  className="mt-2"
                  type="range"
                  min={0}
                  max={360}
                  value={selectedFixture.rotation}
                  onChange={(e) =>
                    setFixturePatch(selectedFixture.id, {
                      rotation: normalizeRotation(Number(e.target.value)),
                    })
                  }
                  onMouseUp={() => commitFixtureRotationSnap(selectedFixture.id)}
                  onTouchEnd={() => commitFixtureRotationSnap(selectedFixture.id)}
                />
              </div>
              {canEdit ? (
                <Button
                  variant="destructive"
                  disabled={saving}
                  onClick={() => {
                    setLayoutDraft((prev) => ({
                      ...prev,
                      decorations: prev.decorations.filter((d) => d.id !== selectedFixture.id),
                    }));
                    setDirty(true);
                  }}
                >
                  {t("dashboard.floorPlan.deleteFixture")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </AnimatedPage>
  );
}
