import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Eye, ZoomIn, ZoomOut, Grid3X3 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useFloorPlan, type TableRow } from "@/hooks/useFloorPlan";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

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

function ChairDot({ x, y }: { x: number; y: number }) {
  return (
    <circle cx={x} cy={y} r={6} fill="#555" stroke="#333" strokeWidth={1.5} />
  );
}

function RoundTable({
  table,
  onClick,
}: {
  table: TableRow;
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
      transform={`translate(${table.position_x ?? 0}, ${table.position_y ?? 0})`}
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
        fontSize={14}
        fontWeight={700}
      >
        {table.label ?? table.table_number}
      </text>
    </g>
  );
}

function RectTable({
  table,
  onClick,
}: {
  table: TableRow;
  onClick: () => void;
}) {
  const fill = STATUS_FILLS[table.status] ?? STATUS_FILLS.empty;
  const w = Math.max(100, table.capacity * 18);
  const h = 44;
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
      transform={`translate(${table.position_x ?? 0}, ${table.position_y ?? 0})`}
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
        fontSize={14}
        fontWeight={700}
      >
        {table.label ?? table.table_number}
      </text>
    </g>
  );
}

function BoothTable({
  table,
  onClick,
}: {
  table: TableRow;
  onClick: () => void;
}) {
  const w = 80;
  const h = 36;
  const boothH = 10;

  return (
    <g
      transform={`translate(${table.position_x ?? 0}, ${table.position_y ?? 0})`}
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
        fontSize={13}
        fontWeight={700}
      >
        {table.label ?? table.table_number}
      </text>
    </g>
  );
}

function BarTable({
  table,
  onClick,
}: {
  table: TableRow;
  onClick: () => void;
}) {
  const w = 120;
  const h = 36;
  const seatCount = table.capacity;

  const chairs: { x: number; y: number }[] = [];
  for (let i = 0; i < seatCount; i++) {
    const xOff = -w / 2 + (w / (seatCount + 1)) * (i + 1);
    chairs.push({ x: xOff, y: h / 2 + 14 });
  }

  return (
    <g
      transform={`translate(${table.position_x ?? 0}, ${table.position_y ?? 0})`}
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
        fill="#92702A"
        opacity={table.status === "empty" ? 0.85 : 1}
      />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fill="white"
        fontSize={13}
        fontWeight={700}
      >
        {table.label ?? table.table_number}
      </text>
    </g>
  );
}

function FloorTableSvg({
  table,
  onClick,
}: {
  table: TableRow;
  onClick: () => void;
}) {
  switch (table.shape) {
    case "rectangle":
      return <RectTable table={table} onClick={onClick} />;
    case "booth":
      return <BoothTable table={table} onClick={onClick} />;
    case "bar":
      return <BarTable table={table} onClick={onClick} />;
    default:
      return <RoundTable table={table} onClick={onClick} />;
  }
}

export default function FloorPlanPage() {
  const { t } = useTranslation();
  const { tables, sections, loading, refetch } = useFloorPlan();
  const [selectedSection, setSelectedSection] = useState<string>("all");
  const [selectedTable, setSelectedTable] = useState<TableRow | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [showGrid, setShowGrid] = useState(true);

  const filteredTables = useMemo(
    () =>
      selectedSection === "all"
        ? tables
        : tables.filter((tb) => tb.section_id === selectedSection),
    [tables, selectedSection],
  );

  const updateTableStatus = async (tableId: string, status: string) => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    await client.from("tables").update({ status }).eq("id", tableId);
    setSelectedTable(null);
    void refetch();
  };

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
              onClick={() => setEditMode(!editMode)}
            >
              {editMode ? <Eye className="size-4" /> : <Pencil className="size-4" />}
              {editMode ? t("dashboard.floorPlan.liveMode") : t("dashboard.floorPlan.editMode")}
            </Button>
            <Button size="default" className="gap-2">
              {t("dashboard.floorPlan.saveLayout")}
            </Button>
          </div>
        }
      />

      {/* Controls bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant={showGrid ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
            onClick={() => setShowGrid(!showGrid)}
          >
            <Grid3X3 className="size-3.5" />
            Grid
          </Button>

          {sections.length > 0 && (
            <Tabs value={selectedSection} onValueChange={setSelectedSection}>
              <TabsList>
                <TabsTrigger value="all">{t("dashboard.reservations.all")}</TabsTrigger>
                {sections.map((s) => (
                  <TabsTrigger key={s.id} value={s.id}>{s.name}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        </div>

        <div className="flex items-center gap-1">
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
        </div>
      </div>

      {/* Canvas */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-[#111111]">
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
              width={600 * (zoom / 100)}
              height={500 * (zoom / 100)}
              viewBox="0 0 600 500"
              className="block"
            >
              {/* Grid pattern */}
              {showGrid && (
                <>
                  <defs>
                    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1E1E1E" strokeWidth={0.5} />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#grid)" />
                </>
              )}

              {/* Tables */}
              <AnimatePresence>
                {filteredTables.map((tb) => (
                  <motion.g
                    key={tb.id}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.3 }}
                  >
                    <FloorTableSvg
                      table={tb}
                      onClick={() => setSelectedTable(tb)}
                    />
                  </motion.g>
                ))}
              </AnimatePresence>
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

      {/* Table Detail Sheet */}
      <Sheet open={!!selectedTable} onOpenChange={() => setSelectedTable(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>
              {t("dashboard.floorPlan.tableNumber")} {selectedTable?.table_number ?? selectedTable?.label}
            </SheetTitle>
          </SheetHeader>
          {selectedTable ? (
            <div className="mt-6 flex flex-col gap-4">
              <div className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-4 py-3">
                <span className="text-sm text-text-secondary">{t("dashboard.floorPlan.capacity")}</span>
                <span className="text-sm font-medium text-text-primary">{selectedTable.capacity}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-4 py-3">
                <span className="text-sm text-text-secondary">{t("dashboard.reservations.status")}</span>
                <span className="text-sm font-medium capitalize text-text-primary">{selectedTable.status}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-4 py-3">
                <span className="text-sm text-text-secondary">Shape</span>
                <span className="text-sm font-medium capitalize text-text-primary">{selectedTable.shape}</span>
              </div>
              <div className="flex flex-col gap-2 pt-2">
                {selectedTable.status !== "empty" && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => void updateTableStatus(selectedTable.id, "empty")}
                  >
                    {t("dashboard.floorPlan.clearTable")}
                  </Button>
                )}
                {selectedTable.status === "occupied" && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => void updateTableStatus(selectedTable.id, "cleaning")}
                  >
                    {t("dashboard.floorPlan.markCleaning")}
                  </Button>
                )}
                {selectedTable.status === "empty" && (
                  <>
                    <Button
                      className="w-full"
                      onClick={() => void updateTableStatus(selectedTable.id, "occupied")}
                    >
                      {t("dashboard.floorPlan.seatGuest")}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => void updateTableStatus(selectedTable.id, "blocked")}
                    >
                      {t("dashboard.floorPlan.blockTable")}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </AnimatedPage>
  );
}
