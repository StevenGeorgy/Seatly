"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Layers } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  loadFloorPlanData,
  type FloorPlanData,
  type FloorPlanTable,
} from "@/lib/floor-plan";

const GRID_SIZE = 24;

type TableStatus = "empty" | "seated" | "arriving" | "overdue" | "reserved";

function getTableSize(capacity: number, shape: string) {
  const base = capacity <= 2 ? 36 : capacity <= 4 ? 44 : capacity <= 6 ? 52 : 60;
  if (shape === "rectangle") return { w: base + 16, h: base - 8 };
  return { w: base, h: base };
}

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

/** OpenTable/SevenRooms-style: brighter status colors, larger indicators, at-a-glance readability */
const getTableStyles = (status: TableStatus) => {
  switch (status) {
    case "empty":
      return "bg-table-empty/20 border-2 border-table-empty";
    case "seated":
      return "bg-table-seated/25 border-2 border-table-seated";
    case "arriving":
      return "bg-table-arriving/25 border-2 border-table-arriving";
    case "overdue":
      return "bg-table-overdue/25 border-2 border-table-overdue";
    case "reserved":
      return "bg-table-reserved/20 border-2 border-table-reserved";
  }
};

export default function FloorPlanPage() {
  const [data, setData] = useState<FloorPlanData | null>(null);
  const [currentLevelId, setCurrentLevelId] = useState<string | null>(null);
  const [statusByTable] = useState<Record<string, TableStatus>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [partySizeFilter, setPartySizeFilter] = useState<number | null>(null);
  const [tableLabelMode, setTableLabelMode] = useState<"table" | "guest" | "server">("table");
  const [vipTableIds, setVipTableIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const loaded = loadFloorPlanData();
    setData(loaded);
    if (loaded.levels.length > 0 && !currentLevelId) {
      setCurrentLevelId(loaded.levels[0].id);
    }
  }, []);

  const levelTables =
    data && currentLevelId
      ? data.tables.filter((t) => t.levelId === currentLevelId && t.isActive && !t.isGhost)
      : [];
  const filteredTables =
    partySizeFilter != null
      ? levelTables.filter((t) => {
          const max = t.maxCapacity ?? t.capacity;
          const min = t.minCapacity ?? t.capacity;
          return partySizeFilter >= min && partySizeFilter <= max;
        })
      : levelTables;
  const walls = data?.walls.filter((w) => w.levelId === currentLevelId) ?? [];
  const interior = data?.interior.filter((i) => i.levelId === currentLevelId) ?? [];
  const selectedTable = selectedId
    ? data?.tables.find((t) => t.id === selectedId)
    : null;
  const currentLevel = data?.levels.find((l) => l.id === currentLevelId);

  const toggleVip = (tableId: string) => {
    setVipTableIds((prev) => {
      const next = new Set(prev);
      if (next.has(tableId)) next.delete(tableId);
      else next.add(tableId);
      return next;
    });
  };

  const hasAnyTables = (data?.tables.length ?? 0) > 0;

  if (!hasAnyTables) {
    return (
      <div>
        <PageHeader title="Live Floor Plan" />
        <EmptyState
          title="No tables to display"
          message="Add tables in the Floor Plan Editor to see your layout here."
          action={
            <Link
              href="/settings/floor-plan"
              className="rounded-md bg-gold px-lg py-md text-sm font-semibold text-text-on-gold transition-colors hover:bg-gold-muted"
            >
              Set up floor plan
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Live Floor Plan" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 lg:col-span-8 app-card-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                {currentLevel?.name ?? "Floor plan"}
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Tap a table to view details. Switch levels to see different areas.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-md">
              <div className="flex items-center gap-xs">
                <span className="text-xs text-text-muted-on-dark">Show:</span>
                <select
                  value={tableLabelMode}
                  onChange={(e) => setTableLabelMode(e.target.value as "table" | "guest" | "server")}
                  className="rounded-md border border-card-border bg-surface-dark px-sm py-xs text-xs text-text-on-dark focus:border-gold focus:outline-none"
                >
                  <option value="table">Table #</option>
                  <option value="guest">Guest name</option>
                  <option value="server">Server</option>
                </select>
              </div>
              <div className="flex items-center gap-xs">
                <span className="text-xs text-text-muted-on-dark">Party:</span>
                <select
                  value={partySizeFilter ?? ""}
                  onChange={(e) => setPartySizeFilter(e.target.value ? Number(e.target.value) : null)}
                  className="rounded-md border border-card-border bg-surface-dark px-sm py-xs text-xs text-text-on-dark focus:border-gold focus:outline-none"
                >
                  <option value="">All</option>
                  {[2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                    <option key={n} value={n}>
                      {n} guests
                    </option>
                  ))}
                </select>
              </div>
              {data?.levels.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setCurrentLevelId(l.id)}
                  className={`flex items-center gap-xs rounded-md px-md py-sm text-sm font-medium transition-all ${
                    currentLevelId === l.id
                      ? "bg-gold/20 text-gold border border-gold/40"
                      : "border border-card-border bg-card-bg text-text-muted-on-dark hover:bg-gold/5"
                  }`}
                >
                  <Layers className="h-4 w-4" strokeWidth={1.5} />
                  {l.name}
                </button>
              ))}
              {(
                [
                  ["empty", "Empty"],
                  ["seated", "Seated"],
                  ["arriving", "Arriving"],
                  ["overdue", "Overdue"],
                  ["reserved", "Reserved"],
                ] as const
              ).map(([status, label]) => (
                <div
                  key={status}
                  className="flex items-center gap-sm rounded-md border border-card-border bg-surface-dark px-sm py-xs"
                >
                  <div
                    className={`h-3 w-3 rounded-full border-2 ${getTableStyles(status)}`}
                    aria-hidden
                  />
                  <span className="text-xs font-medium text-text-on-dark">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div
            className="relative overflow-hidden rounded-xl border border-card-border bg-surface-dark-alt shadow-inner"
            style={{
              width: 600,
              height: 400,
              backgroundImage: `
                radial-gradient(ellipse 120% 120% at 50% 50%, rgba(212, 175, 55, 0.02), transparent 60%),
                linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
              `,
              backgroundSize: `100% 100%, ${GRID_SIZE}px ${GRID_SIZE}px, ${GRID_SIZE}px ${GRID_SIZE}px`,
            }}
          >
            <svg className="absolute inset-0 h-full w-full" style={{ pointerEvents: "none" }}>
              {walls.map((w) => (
                <g key={w.id}>
                  <line
                    x1={w.x1}
                    y1={w.y1}
                    x2={w.x2}
                    y2={w.y2}
                    stroke="rgba(212, 175, 55, 0.12)"
                    strokeWidth={4}
                    strokeLinecap="round"
                  />
                  <line
                    x1={w.x1}
                    y1={w.y1}
                    x2={w.x2}
                    y2={w.y2}
                    stroke="rgba(255,255,255,0.2)"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                </g>
              ))}
            </svg>
            {interior.map((i) => {
              const isLoungeFurniture = ["sofa", "booth", "lounge"].includes(i.type);
              return (
                <div
                  key={i.id}
                  className={`absolute flex items-center justify-center border border-gold/20 bg-white/[0.06] shadow-soft ${
                    isLoungeFurniture ? "rounded-xl" : "rounded-lg"
                  }`}
                  style={{ left: i.x, top: i.y, width: i.w, height: i.h }}
                >
                  <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted-on-dark">
                    {i.type}
                  </span>
                </div>
              );
            })}
            <div className="relative h-full w-full overflow-visible">
              {filteredTables.map((t) => {
                const status = statusByTable[t.id] ?? "empty";
                const isSelected = selectedId === t.id;
                const isVip = vipTableIds.has(t.id);
                const size = getTableSize(t.capacity, t.shape);
                const chairPositions = getChairPositions(t.capacity, size.w, size.h);
                const guestName = status === "seated" ? "Guest" : "—";
                const serverInitials = status === "seated" ? "—" : "—";
                const primaryLabel =
                  tableLabelMode === "table"
                    ? t.tableNumber
                    : tableLabelMode === "guest"
                      ? guestName
                      : serverInitials;
                const secondaryLabel =
                  tableLabelMode === "table"
                    ? `${t.capacity}`
                    : tableLabelMode === "guest"
                      ? t.tableNumber
                      : t.tableNumber;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedId(isSelected ? null : t.id)}
                    className={`absolute overflow-visible transition-all duration-200 shadow-soft hover:scale-[1.02] hover:shadow-gold-glow ${
                      isSelected ? "ring-2 ring-gold ring-offset-2 ring-offset-surface-dark-alt shadow-gold-glow" : ""
                    } ${isVip ? "ring-2 ring-gold" : ""}`}
                    style={{
                      left: t.positionX,
                      top: t.positionY,
                      width: size.w,
                      height: size.h,
                    }}
                  >
                    {chairPositions.map((pos, i) => (
                      <div
                        key={i}
                        className="absolute z-0 rounded-full border border-gold/20 bg-surface-dark-elevated shadow-sm"
                        style={{
                          left: pos.x - 6,
                          top: pos.y - 6,
                          width: 12,
                          height: 12,
                        }}
                      />
                    ))}
                    <div
                      className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-0 rounded-lg shadow-inner ${
                        t.shape === "round" ? "rounded-full" : ""
                      } ${getTableStyles(status)} ${isVip ? "ring-2 ring-gold ring-inset" : ""}`}
                    >
                      <span className="text-sm font-bold text-text-on-dark leading-tight">
                        {primaryLabel}
                      </span>
                      <span className="text-[10px] font-medium text-text-muted-on-dark">
                        {secondaryLabel}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="col-span-12 lg:col-span-4">
          <div className="app-card-elevated p-xl">
            <p className="mb-md text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
              Table details
            </p>

            {selectedTable ? (
              <div className="flex flex-col gap-md">
                <div>
                  <p className="text-lg font-semibold text-text-on-dark">
                    {selectedTable.tableNumber}
                  </p>
                  <p className="mt-xs text-sm text-text-muted-on-dark">
                    Capacity: {selectedTable.capacity} · {selectedTable.section}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleVip(selectedTable.id)}
                  className={`flex items-center gap-sm rounded-md border px-md py-sm text-sm font-medium transition-colors ${
                    vipTableIds.has(selectedTable.id)
                      ? "border-gold bg-gold/20 text-gold"
                      : "border-card-border bg-card-bg text-text-muted-on-dark hover:border-gold/40"
                  }`}
                >
                  ★ VIP
                </button>
                <p className="text-sm text-text-muted-on-dark">
                  Shape: {selectedTable.shape}
                </p>
                <Link
                  href="/settings/floor-plan"
                  className="rounded-md border border-gold/30 px-lg py-md text-sm font-semibold text-gold transition-colors hover:bg-gold/10"
                >
                  Edit in Floor Plan Editor
                </Link>
              </div>
            ) : (
              <EmptyState
                title="Select a table"
                message="Choose a table on the floor plan to view its details."
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
