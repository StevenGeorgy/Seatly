/**
 * Floor plan — editorial, content-first design ported from the CenaIva
 * mobile prototype. SVG canvas with pan/zoom, draggable tables/walls/entrance,
 * undo/redo, mini-map, and a context-aware right rail.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  isDatabaseUuid,
  useFloorPlan,
  type FloorPlanLayout,
  type FloorPlanRow,
  type TableRow,
} from "@/hooks/useFloorPlan";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { useReservations, type ReservationRow } from "@/hooks/useReservations";
import { useUser } from "@/hooks/useUser";
import { markReservationTablesSeated } from "@/lib/table-assignment";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────
type Status = "free" | "reserved" | "occupied" | "cleaning" | "blocked";

type TableShape = "round" | "rect";

type FloorTable = {
  id: string;
  dbId?: string;
  reservationId?: string | null;
  reservationStatus?: string | null;
  reservedAt?: string | null;
  durationMinutes?: number | null;
  tableNumber?: string | null;
  label?: string | null;
  sectionId?: string | null;
  combinedWith?: string[];
  shape: TableShape;
  x: number;
  y: number;
  size: number;
  cap: number;
  status: Status;
  guest: string | null;
  party: number;
  time: string | null;
  long?: boolean;
};

type Wall = { id: string; x1: number; y1: number; x2: number; y2: number };

type EntranceSide = "top" | "right" | "bottom" | "left";
type Entrance = { side: EntranceSide; pos: number; width: number };

type Floor = { id: string; name: string };
type Room = { w: number; h: number };

type Selection =
  | { kind: "table"; id: string }
  | { kind: "wall"; id: string }
  | { kind: "entrance" }
  | null;

type Snapshot = {
  floor: string;
  tables: Record<string, FloorTable[]>;
  walls: Record<string, Wall[]>;
  entrance: Record<string, Entrance>;
  rooms: Record<string, Room>;
  floors: Floor[];
  deletedTableIds: string[];
  deletedFloorIds: string[];
};

type DragState =
  | { kind: "table"; id: string; sx: number; sy: number; ox: number; oy: number }
  | {
      kind: "wall";
      id: string;
      sx: number;
      sy: number;
      ox1: number;
      oy1: number;
      ox2: number;
      oy2: number;
    }
  | {
      kind: "wall-pt";
      id: string;
      end: "start" | "end";
      sx: number;
      sy: number;
      ox: number;
      oy: number;
    }
  | { kind: "entrance"; sx: number; sy: number; opos: number };

// ─── Seed data ─────────────────────────────────────────────────────────────
const FLOORS: Floor[] = [
  { id: "main", name: "Main Dining" },
  { id: "patio", name: "Patio" },
  { id: "private", name: "Private Room" },
  { id: "banquet", name: "Banquet Hall" },
];

const ROOMS: Record<string, Room> = {
  main: { w: 720, h: 560 },
  patio: { w: 480, h: 380 },
  private: { w: 520, h: 440 },
  banquet: { w: 1400, h: 900 },
};

const BANQUET_TABLES: FloorTable[] = (() => {
  const out: FloorTable[] = [];
  let n = 1;
  const cols = 8,
    rows = 7;
  const startX = 90,
    startY = 90,
    gapX = 150,
    gapY = 110;
  const statuses: Status[] = [
    "free",
    "reserved",
    "occupied",
    "free",
    "free",
    "reserved",
    "occupied",
    "cleaning",
  ];
  const guests = [
    "Patel",
    "Nakamura",
    "Brown",
    "Singh",
    "Rivera",
    "Cohen",
    "Martin",
    "Park",
    "Lee",
    "Adams",
    "Khan",
    "Webb",
    "Diaz",
    "Hall",
    "Yang",
    "Roy",
  ];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const status = statuses[(r * cols + c) % statuses.length];
      const cap = (r + c) % 3 === 0 ? 2 : 4;
      const guest =
        status === "occupied" || status === "reserved"
          ? guests[(r * cols + c) % guests.length]
          : null;
      out.push({
        id: `B${n}`,
        shape: "round",
        x: startX + c * gapX,
        y: startY + r * gapY,
        size: cap === 2 ? 70 : 85,
        cap,
        status,
        guest,
        party: guest ? cap : 0,
        time: guest
          ? `${5 + ((r * cols + c) % 4)}:${(c % 4) * 15 || "00"}`
              .replace(":0", "0:00")
              .replace("00:", "7:")
          : null,
      });
      n++;
    }
  }
  return out;
})();

const TABLES: Record<string, FloorTable[]> = {
  main: [
    { id: "1", shape: "round", x: 80, y: 80, size: 80, cap: 2, status: "occupied", guest: "M. Chen", party: 2, time: "6:00" },
    { id: "2", shape: "round", x: 200, y: 80, size: 80, cap: 2, status: "free", guest: null, party: 0, time: null },
    { id: "3", shape: "rect", x: 320, y: 80, size: 90, cap: 4, status: "reserved", guest: "Tremblay", party: 4, time: "7:00" },
    { id: "4", shape: "rect", x: 450, y: 80, size: 90, cap: 4, status: "occupied", guest: "Anand", party: 3, time: "5:30" },
    { id: "5", shape: "rect", x: 580, y: 80, size: 90, cap: 4, status: "free", guest: null, party: 0, time: null },
    { id: "6", shape: "round", x: 80, y: 230, size: 90, cap: 4, status: "reserved", guest: "Khoury", party: 4, time: "7:15" },
    { id: "7", shape: "round", x: 210, y: 230, size: 90, cap: 4, status: "cleaning", guest: null, party: 0, time: null },
    { id: "8", shape: "rect", x: 340, y: 230, size: 120, cap: 6, status: "occupied", guest: "Wong", party: 5, time: "6:30" },
    { id: "9", shape: "rect", x: 490, y: 230, size: 120, cap: 6, status: "reserved", guest: "Foster", party: 6, time: "7:30" },
    { id: "10", shape: "rect", x: 80, y: 380, size: 220, cap: 6, status: "occupied", guest: "Schaefer", party: 6, time: "5:45", long: true },
    { id: "11", shape: "rect", x: 330, y: 380, size: 220, cap: 6, status: "free", guest: null, party: 0, time: null, long: true },
  ],
  patio: [
    { id: "P1", shape: "round", x: 90, y: 90, size: 75, cap: 2, status: "reserved", guest: "Reyes", party: 2, time: "7:00" },
    { id: "P2", shape: "round", x: 220, y: 90, size: 75, cap: 2, status: "free", guest: null, party: 0, time: null },
    { id: "P3", shape: "round", x: 350, y: 90, size: 75, cap: 2, status: "occupied", guest: "O’Hara", party: 2, time: "6:45" },
    { id: "P4", shape: "round", x: 90, y: 230, size: 75, cap: 2, status: "free", guest: null, party: 0, time: null },
    { id: "P5", shape: "round", x: 220, y: 230, size: 75, cap: 2, status: "free", guest: null, party: 0, time: null },
    { id: "P6", shape: "round", x: 350, y: 230, size: 75, cap: 2, status: "reserved", guest: "Bauer", party: 2, time: "8:00" },
  ],
  private: [
    { id: "PR1", shape: "rect", x: 120, y: 120, size: 280, cap: 12, status: "reserved", guest: "Foster", party: 12, time: "7:30", long: true },
    { id: "PR2", shape: "rect", x: 120, y: 280, size: 280, cap: 12, status: "free", guest: null, party: 0, time: null, long: true },
  ],
  banquet: BANQUET_TABLES,
};

const WALLS: Record<string, Wall[]> = {
  main: [
    { id: "w1", x1: 30, y1: 340, x2: 300, y2: 340 },
    { id: "w2", x1: 430, y1: 340, x2: 690, y2: 340 },
    { id: "w3", x1: 625, y1: 60, x2: 625, y2: 200 },
  ],
  patio: [],
  private: [],
  banquet: [],
};

const ENTRANCES: Record<string, Entrance> = {
  main: { side: "top", pos: 360, width: 50 },
  patio: { side: "left", pos: 190, width: 50 },
  private: { side: "top", pos: 260, width: 50 },
  banquet: { side: "top", pos: 700, width: 80 },
};

const TBL_STATUS: Record<
  Status,
  { color: string; soft: string; edge: string; label: string; hint: string }
> = {
  free: {
    color: "#7DB87D",
    soft: "rgba(125,184,125,0.08)",
    edge: "rgba(125,184,125,0.35)",
    label: "Open",
    hint: "Available now",
  },
  reserved: {
    color: "#C9A84C",
    soft: "rgba(201,168,76,0.10)",
    edge: "rgba(201,168,76,0.45)",
    label: "Reserved",
    hint: "Booked",
  },
  occupied: {
    color: "#C97A6F",
    soft: "rgba(201,122,111,0.10)",
    edge: "rgba(201,122,111,0.40)",
    label: "Seated",
    hint: "Guests dining",
  },
  cleaning: {
    color: "#6b6b66",
    soft: "rgba(107,107,102,0.10)",
    edge: "rgba(107,107,102,0.35)",
    label: "Resetting",
    hint: "Being cleared",
  },
  blocked: {
    color: "#6B7280",
    soft: "rgba(107,114,128,0.10)",
    edge: "rgba(107,114,128,0.35)",
    label: "Blocked",
    hint: "Temporarily unavailable for bookings",
  },
};

const BORDER_SOFT = "rgba(255,255,255,0.07)";
const SURFACE_BG = "rgba(20,20,22,0.85)";
const DEFAULT_ROOM: Room = { w: 720, h: 560 };
const DEFAULT_TURN_TIME_MINUTES = 90;
const RESERVATION_HOLD_BEFORE_MINUTES = 30;
const TIME_WHEEL_INCREMENT_MINUTES = 15;
const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1));
const MINUTES = ["00", "15", "30", "45"];
const PERIODS = ["AM", "PM"] as const;

type FloorServiceAction = "walkin" | "reserve";
type FloorServiceFormValues = {
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  partySize: number;
  reservationDate: string;
  reservationTime: string;
  specialRequest: string;
};

type ReservationLinkRow = {
  reservation_id: string;
  reservations:
    | {
        id: string;
        status: string | null;
        reserved_at: string | null;
        duration_minutes: number | null;
      }
    | Array<{
        id: string;
        status: string | null;
        reserved_at: string | null;
        duration_minutes: number | null;
      }>
    | null;
};

type GuestLookupRow = { id: string };

function tableDisplayLabel(table: FloorTable): string {
  return table.label || table.tableNumber || table.id;
}

function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInputValue(value: string): Date | undefined {
  const [year, month, day] = value.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return undefined;
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function formatPickerDate(value: string): string {
  const parsed = parseDateInputValue(value);
  if (!parsed) return "Choose date";
  return parsed.toLocaleDateString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function timeInputValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function normalizeTimeValue(value: string): string {
  const [hourPart, minutePart = "00"] = value.split(":");
  const hour = Number(hourPart);
  const minute = Number(minutePart);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "";

  const totalMinutes = hour * 60 + minute;
  const roundedMinutes = Math.round(totalMinutes / TIME_WHEEL_INCREMENT_MINUTES) * TIME_WHEEL_INCREMENT_MINUTES;
  const normalizedMinutes = ((roundedMinutes % 1440) + 1440) % 1440;
  const normalizedHour = Math.floor(normalizedMinutes / 60);
  const normalizedMinute = normalizedMinutes % 60;
  return `${String(normalizedHour).padStart(2, "0")}:${String(normalizedMinute).padStart(2, "0")}`;
}

function toTimeValue(hour: string, minute: string, period: (typeof PERIODS)[number]): string {
  const hourNumber = Number(hour);
  const normalized = period === "AM"
    ? hourNumber % 12
    : hourNumber === 12 ? 12 : hourNumber + 12;
  return `${String(normalized).padStart(2, "0")}:${minute}`;
}

function splitTimeValue(value: string): { hour: string; minute: string; period: (typeof PERIODS)[number] } {
  if (!value) return { hour: "7", minute: "00", period: "PM" };
  const normalizedValue = normalizeTimeValue(value);
  const [hourPart, minutePart] = normalizedValue.split(":");
  const hour24 = Number(hourPart);
  const period: (typeof PERIODS)[number] = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return {
    hour: String(hour12),
    minute: minutePart ?? "00",
    period,
  };
}

function formatPickerTime(value: string): string {
  if (!value) return "Choose time";
  const normalizedValue = normalizeTimeValue(value);
  if (!normalizedValue) return "Choose time";
  const [hourPart, minutePart = "00"] = normalizedValue.split(":");
  const hour24 = Number(hourPart);
  const minute = Number(minutePart);
  if (!Number.isFinite(hour24) || !Number.isFinite(minute)) return "Choose time";
  const date = new Date();
  date.setHours(hour24, minute, 0, 0);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function roundToNextHalfHour(date: Date): Date {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  const minutes = rounded.getMinutes();
  const remainder = minutes % TIME_WHEEL_INCREMENT_MINUTES;
  const addMinutes = remainder === 0 ? 0 : TIME_WHEEL_INCREMENT_MINUTES - remainder;
  rounded.setMinutes(minutes + addMinutes);
  return rounded;
}

function combineDateAndTime(dateValue: string, timeValue: string): Date | null {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);
  if (![year, month, day, hours, minutes].every(Number.isFinite)) return null;
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function serviceTimeLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function restaurantTurnTimeMinutes(settings: { turnTimeMinutes?: number } | null | undefined): number {
  const value = settings?.turnTimeMinutes;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : DEFAULT_TURN_TIME_MINUTES;
}

function reservationTableIds(row: ReservationRow): string[] {
  const assigned = row.reservation_tables
    ?.map((assignment) => assignment.table_id)
    .filter((id): id is string => Boolean(id)) ?? [];
  if (assigned.length > 0) return assigned;
  return row.table_id ? [row.table_id] : [];
}

function reservationGuestName(row: ReservationRow): string {
  return row.guests?.full_name ?? row.guest_full_name ?? "Guest";
}

function isReservationInFloorWindow(row: ReservationRow, now: Date, fallbackTurnMinutes: number): boolean {
  const reservedAt = new Date(row.reserved_at);
  if (Number.isNaN(reservedAt.getTime())) return false;
  const duration = row.duration_minutes ?? fallbackTurnMinutes;
  const windowStart = new Date(reservedAt.getTime() - RESERVATION_HOLD_BEFORE_MINUTES * 60_000);
  const windowEnd = new Date(reservedAt.getTime() + duration * 60_000);
  return now >= windowStart && now <= windowEnd;
}

function reservationPriority(row: ReservationRow): number {
  if (row.status === "seated") return 3;
  if (row.status === "confirmed") return 2;
  return 0;
}

function toLocalStatus(status: string | null | undefined): Status {
  if (status === "reserved" || status === "occupied" || status === "cleaning" || status === "blocked") return status;
  return "free";
}

function toDbStatus(status: Status): string {
  return status === "free" ? "empty" : status;
}

function tableSize(shape: TableShape, capacity: number): { size: number; long: boolean } {
  if (shape === "round") {
    return { size: capacity > 4 ? Math.max(90, 70 + capacity * 4) : capacity > 2 ? 90 : 75, long: false };
  }
  const long = capacity > 4;
  return { size: long ? Math.max(140, 90 + capacity * 12) : 90, long };
}

function toLocalShape(shape: string | null | undefined): TableShape {
  return shape === "circle" || shape === "round" ? "round" : "rect";
}

function toDbShape(shape: TableShape): string {
  return shape === "round" ? "circle" : "rectangle";
}

function tableCenter(table: FloorTable): { x: number; y: number } {
  return {
    x: table.x + table.size / 2,
    y: table.y + (table.shape === "round" ? table.size : table.long ? 70 : 80) / 2,
  };
}

function tableRowToFloorTable(row: TableRow): FloorTable {
  const shape = toLocalShape(row.shape);
  const capacity = Math.max(1, row.capacity);
  const size = tableSize(shape, capacity);
  return {
    id: row.id,
    dbId: row.id,
    tableNumber: row.table_number,
    label: row.label,
    sectionId: row.section_id,
    combinedWith: row.combined_with ?? [],
    shape,
    x: row.position_x ?? 120,
    y: row.position_y ?? 120,
    size: size.size,
    cap: capacity,
    status: toLocalStatus(row.status),
    guest: null,
    party: row.seated_count ?? 0,
    time: null,
    long: size.long,
  };
}

function layoutFromPlan(plan: FloorPlanRow | undefined): FloorPlanLayout {
  const layout = plan?.layout;
  if (!layout || typeof layout !== "object") {
    return { walls: [], doors: [], windows: [], tableTransforms: {}, decorations: [], zones: [] };
  }
  const partial = layout as Partial<FloorPlanLayout>;
  return {
    walls: Array.isArray(partial.walls) ? partial.walls : [],
    doors: Array.isArray(partial.doors) ? partial.doors : [],
    windows: Array.isArray(partial.windows) ? partial.windows : [],
    tableTransforms: partial.tableTransforms && typeof partial.tableTransforms === "object" ? partial.tableTransforms : {},
    decorations: Array.isArray(partial.decorations) ? partial.decorations : [],
    zones: Array.isArray(partial.zones) ? partial.zones : [],
  };
}

// ─── Seat dots ─────────────────────────────────────────────────────────────
function SeatDots({
  t,
  w,
  h,
  cx,
  cy,
  color,
}: {
  t: FloorTable;
  w: number;
  h: number;
  cx: number;
  cy: number;
  color: string;
}) {
  const isRound = t.shape === "round";
  const seats: Array<{ x: number; y: number }> = [];
  const r = 4,
    gap = 8;
  if (isRound) {
    const radius = w / 2 + gap;
    for (let i = 0; i < t.cap; i++) {
      const a = (i / t.cap) * Math.PI * 2 - Math.PI / 2;
      seats.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
    }
  } else {
    const top = Math.ceil(t.cap / 2);
    const bot = t.cap - top;
    const place = (count: number, y: number) => {
      for (let i = 0; i < count; i++) {
        const x = t.x + (w / (count + 1)) * (i + 1);
        seats.push({ x, y });
      }
    };
    place(top, t.y - gap);
    place(bot, t.y + h + gap);
  }
  return (
    <g style={{ pointerEvents: "none" }}>
      {seats.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          cy={s.y}
          r={r}
          fill="rgba(255,255,255,0.06)"
          stroke={color}
          strokeWidth="1"
          strokeOpacity="0.55"
        />
      ))}
    </g>
  );
}

type Density = "full" | "compact" | "minimal";

function TableNode({
  t,
  selected,
  editing,
  focused,
  density = "full",
  onClick,
  onDragStart,
}: {
  t: FloorTable;
  selected: boolean;
  editing: boolean;
  focused: boolean;
  density?: Density;
  onClick: (t: FloorTable) => void;
  onDragStart: (e: ReactPointerEvent<SVGElement>, t: FloorTable) => void;
}) {
  const s = TBL_STATUS[t.status];
  const isRound = t.shape === "round";
  const w = t.size;
  const h = isRound ? t.size : t.long ? 70 : 80;
  const cx = t.x + w / 2,
    cy = t.y + h / 2;
  const showGuest = density === "full" && !!t.guest;
  const showSeats = density !== "minimal";
  const idSize = density === "minimal" ? 26 : 22;
  return (
    <g
      onClick={(e) => {
        e.stopPropagation();
        onClick(t);
      }}
      onPointerDown={editing ? (e) => onDragStart(e, t) : undefined}
      style={{ cursor: editing ? "move" : "pointer" }}
    >
      {(selected || focused) &&
        (isRound ? (
          <circle
            cx={cx}
            cy={cy}
            r={w / 2 + 18}
            fill="rgba(201,168,76,0.05)"
            stroke={focused ? "rgba(201,168,76,0.85)" : "rgba(201,168,76,0.5)"}
            strokeWidth={focused ? 1.5 : 1}
          />
        ) : (
          <rect
            x={t.x - 18}
            y={t.y - 18}
            width={w + 36}
            height={h + 36}
            rx="16"
            fill="rgba(201,168,76,0.05)"
            stroke={focused ? "rgba(201,168,76,0.85)" : "rgba(201,168,76,0.5)"}
            strokeWidth={focused ? 1.5 : 1}
          />
        ))}
      {showSeats && <SeatDots t={t} w={w} h={h} cx={cx} cy={cy} color={s.color} />}
      {isRound ? (
        <circle cx={cx} cy={cy} r={w / 2} fill={s.soft} stroke={s.edge} strokeWidth="1" />
      ) : (
        <rect x={t.x} y={t.y} width={w} height={h} rx="8" fill={s.soft} stroke={s.edge} strokeWidth="1" />
      )}
      <circle cx={t.x + w - 10} cy={t.y + 10} r="2.5" fill={s.color} />
      <text
        x={cx}
        y={cy + (showGuest ? 0 : 6)}
        textAnchor="middle"
        fontSize={idSize}
        fontWeight="500"
        fill="rgba(255,255,255,0.92)"
        fontFamily="Fraunces, serif"
        style={{ pointerEvents: "none", letterSpacing: "-0.02em" }}
      >
        {tableDisplayLabel(t)}
      </text>
      {showGuest && (
        <text
          x={cx}
          y={cy + 18}
          textAnchor="middle"
          fontSize="10.5"
          fill="rgba(255,255,255,0.55)"
          style={{ pointerEvents: "none", letterSpacing: "0.01em" }}
          fontFamily="Geist, system-ui"
        >
          {t.guest} · {t.time}
        </text>
      )}
    </g>
  );
}

function WallNode({
  w,
  selected,
  editing,
  onClick,
  onDragStart,
  onEndpointDrag,
}: {
  w: Wall;
  selected: boolean;
  editing: boolean;
  onClick: (w: Wall) => void;
  onDragStart: (e: ReactPointerEvent<SVGElement>, w: Wall) => void;
  onEndpointDrag: (e: ReactPointerEvent<SVGElement>, w: Wall, end: "start" | "end") => void;
}) {
  return (
    <g
      onClick={(e) => {
        e.stopPropagation();
        onClick(w);
      }}
      style={{ cursor: editing ? "move" : "pointer" }}
    >
      <line
        x1={w.x1}
        y1={w.y1}
        x2={w.x2}
        y2={w.y2}
        stroke="transparent"
        strokeWidth="14"
        onPointerDown={editing ? (e) => onDragStart(e, w) : undefined}
      />
      <line
        x1={w.x1}
        y1={w.y1}
        x2={w.x2}
        y2={w.y2}
        stroke={selected ? "rgba(201,168,76,0.85)" : "rgba(255,255,255,0.22)"}
        strokeWidth={selected ? 4 : 3}
        strokeLinecap="round"
      />
      {selected && editing && (
        <>
          <circle
            cx={w.x1}
            cy={w.y1}
            r="6"
            fill="#0E0E0F"
            stroke="var(--gold)"
            strokeWidth="1.5"
            style={{ cursor: "crosshair" }}
            onPointerDown={(e) => onEndpointDrag(e, w, "start")}
          />
          <circle
            cx={w.x2}
            cy={w.y2}
            r="6"
            fill="#0E0E0F"
            stroke="var(--gold)"
            strokeWidth="1.5"
            style={{ cursor: "crosshair" }}
            onPointerDown={(e) => onEndpointDrag(e, w, "end")}
          />
        </>
      )}
    </g>
  );
}

type EntranceLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  labelX: number;
  labelY: number;
  labelAnchor: "middle";
  rotate?: number;
};

function entranceLine(entrance: Entrance, room: Room): EntranceLine {
  const { side, pos, width } = entrance;
  const half = width / 2;
  if (side === "top")
    return { x1: pos - half, y1: 30, x2: pos + half, y2: 30, labelX: pos, labelY: 20, labelAnchor: "middle" };
  if (side === "bottom")
    return {
      x1: pos - half,
      y1: room.h - 30,
      x2: pos + half,
      y2: room.h - 30,
      labelX: pos,
      labelY: room.h - 14,
      labelAnchor: "middle",
    };
  if (side === "left")
    return {
      x1: 30,
      y1: pos - half,
      x2: 30,
      y2: pos + half,
      labelX: 14,
      labelY: pos,
      labelAnchor: "middle",
      rotate: -90,
    };
  return {
    x1: room.w - 30,
    y1: pos - half,
    x2: room.w - 30,
    y2: pos + half,
    labelX: room.w - 14,
    labelY: pos,
    labelAnchor: "middle",
    rotate: 90,
  };
}

function entranceFromLayout(plan: FloorPlanRow | undefined, room: Room): Entrance {
  const door = layoutFromPlan(plan).doors[0];
  if (!door) return { side: "top", pos: room.w / 2, width: 50 };
  const horizontal = Math.abs(door.x2 - door.x1) >= Math.abs(door.y2 - door.y1);
  const width = Math.max(30, Math.round(Math.hypot(door.x2 - door.x1, door.y2 - door.y1)));
  if (horizontal) {
    const y = (door.y1 + door.y2) / 2;
    return {
      side: y > room.h / 2 ? "bottom" : "top",
      pos: (door.x1 + door.x2) / 2,
      width,
    };
  }
  const x = (door.x1 + door.x2) / 2;
  return {
    side: x > room.w / 2 ? "right" : "left",
    pos: (door.y1 + door.y2) / 2,
    width,
  };
}

function entranceToDoor(entrance: Entrance, room: Room): FloorPlanLayout["doors"][number] {
  const line = entranceLine(entrance, room);
  return { id: "entrance", x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 };
}

function EntranceNode({
  entrance,
  room,
  selected,
  editing,
  onClick,
  onDragStart,
}: {
  entrance: Entrance;
  room: Room;
  selected: boolean;
  editing: boolean;
  onClick: () => void;
  onDragStart: (e: ReactPointerEvent<SVGElement>) => void;
}) {
  const g = entranceLine(entrance, room);
  return (
    <g
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{ cursor: editing ? "move" : "pointer" }}
    >
      <line
        x1={g.x1}
        y1={g.y1}
        x2={g.x2}
        y2={g.y2}
        stroke="transparent"
        strokeWidth="20"
        onPointerDown={editing ? (e) => onDragStart(e) : undefined}
      />
      {selected && (
        <line
          x1={g.x1}
          y1={g.y1}
          x2={g.x2}
          y2={g.y2}
          stroke="rgba(201,168,76,0.20)"
          strokeWidth="14"
          strokeLinecap="round"
        />
      )}
      <line
        x1={g.x1}
        y1={g.y1}
        x2={g.x2}
        y2={g.y2}
        stroke={selected ? "var(--gold-light)" : "rgba(201,168,76,0.6)"}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <text
        x={g.labelX}
        y={g.labelY}
        textAnchor={g.labelAnchor}
        fontSize="9"
        fill={selected ? "rgba(229,203,124,0.9)" : "rgba(255,255,255,0.30)"}
        letterSpacing="2.5"
        fontFamily="Geist, system-ui"
        transform={g.rotate ? `rotate(${g.rotate} ${g.labelX} ${g.labelY})` : undefined}
      >
        ENTRANCE
      </text>
    </g>
  );
}

function MiniMap({
  tables,
  walls,
  room,
  viewport,
}: {
  tables: FloorTable[];
  walls: Wall[];
  room: Room;
  viewport: { x: number; y: number; w: number; h: number } | null;
}) {
  const W = 140;
  const H = Math.round((W * room.h) / room.w);
  const sx = W / room.w;
  const sy = H / room.h;
  return (
    <div
      className="absolute bottom-3 right-3 overflow-hidden rounded-md"
      style={{
        padding: 4,
        background: "rgba(14,14,15,0.85)",
        backdropFilter: "blur(8px)",
        border: `1px solid ${BORDER_SOFT}`,
      }}
    >
      <svg width={W} height={H} style={{ display: "block" }}>
        <rect width={W} height={H} fill="rgba(255,255,255,0.02)" />
        {walls.map((w) => (
          <line
            key={w.id}
            x1={w.x1 * sx}
            y1={w.y1 * sy}
            x2={w.x2 * sx}
            y2={w.y2 * sy}
            stroke="rgba(255,255,255,0.25)"
            strokeWidth="0.8"
          />
        ))}
        {tables.map((t) => {
          const tw = t.size * sx;
          const th = (t.shape === "round" ? t.size : t.long ? 70 : 80) * sy;
          return (
            <rect
              key={t.id}
              x={t.x * sx}
              y={t.y * sy}
              width={tw}
              height={th}
              rx="1.5"
              fill={TBL_STATUS[t.status].color}
              fillOpacity="0.55"
            />
          );
        })}
        {viewport && (
          <rect
            x={viewport.x * sx}
            y={viewport.y * sy}
            width={viewport.w * sx}
            height={viewport.h * sy}
            fill="none"
            stroke="rgba(201,168,76,0.85)"
            strokeWidth="1.2"
          />
        )}
      </svg>
    </div>
  );
}

// ─── Side-rail cards ───────────────────────────────────────────────────────
const cardStyle: React.CSSProperties = {
  background: SURFACE_BG,
  border: `1px solid ${BORDER_SOFT}`,
  backdropFilter: "blur(8px)",
};
const eyebrowCls = "text-[10px] uppercase tracking-[0.16em] text-text-muted";
const softBtnCls =
  "rounded-md text-[13px] text-text-secondary hover:text-white hover:bg-white/5 transition-colors";
const goldBtnCls = "rounded-md font-medium text-[13.5px] hover:opacity-90 transition-opacity";

type ActionKind =
  | "walkin"
  | "reserve"
  | "seat"
  | "text"
  | "cancel"
  | "paid"
  | "check"
  | "move"
  | "ready";

function WheelColumn({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<number | null>(null);
  const wheelDeltaRef = useRef(0);
  const selectedIndex = Math.max(values.indexOf(value), 0);
  const selectedValue = values[selectedIndex] ?? values[0] ?? "";
  const move = (direction: 1 | -1) => {
    const nextIndex = (selectedIndex + direction + values.length) % values.length;
    onChange(values[nextIndex]);
  };

  useEffect(() => {
    const selectedButton = scrollRef.current?.querySelector<HTMLButtonElement>(
      `[data-wheel-value="${CSS.escape(selectedValue)}"]`,
    );
    selectedButton?.scrollIntoView({ block: "center" });
  }, [selectedValue]);

  const commitNearestValue = () => {
    const container = scrollRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const centerY = containerRect.top + containerRect.height / 2;
    const options = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-wheel-option]"));
    const nearest = options.reduce<HTMLButtonElement | null>((closest, option) => {
      if (!closest) return option;
      const optionRect = option.getBoundingClientRect();
      const closestRect = closest.getBoundingClientRect();
      const optionDistance = Math.abs(optionRect.top + optionRect.height / 2 - centerY);
      const closestDistance = Math.abs(closestRect.top + closestRect.height / 2 - centerY);
      return optionDistance < closestDistance ? option : closest;
    }, null);

    const nextValue = nearest?.dataset.wheelValue;
    if (nextValue && nextValue !== value) onChange(nextValue);
  };

  return (
    <div
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onWheel={(event) => {
        event.preventDefault();
        wheelDeltaRef.current += event.deltaY;
        if (Math.abs(wheelDeltaRef.current) < 24) return;
        move(wheelDeltaRef.current > 0 ? 1 : -1);
        wheelDeltaRef.current = 0;
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") move(1);
        if (event.key === "ArrowUp") move(-1);
      }}
      className="relative h-44 overflow-hidden rounded-3xl border border-border bg-bg-base/80 outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-5 top-1/2 z-10 h-9 -translate-y-1/2 border-y border-gold/20" />
      <div
        ref={scrollRef}
        onScroll={() => {
          if (scrollTimerRef.current !== null) window.clearTimeout(scrollTimerRef.current);
          scrollTimerRef.current = window.setTimeout(commitNearestValue, 90);
        }}
        className="h-full overflow-y-auto overscroll-contain py-[72px] pr-1 [scrollbar-color:var(--gold)_transparent] [scrollbar-width:thin]"
      >
        {values.map((item) => {
          const active = item === selectedValue;
          return (
            <button
              key={item}
              type="button"
              role="option"
              aria-selected={active}
              data-wheel-option
              data-wheel-value={item}
              onClick={() => onChange(item)}
              className={cn(
                "flex h-9 w-full items-center justify-center text-lg transition-all",
                active ? "scale-110 font-semibold text-gold" : "text-text-muted hover:text-text-secondary",
              )}
            >
              {item}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FloorDatePickerButton({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => parseDateInputValue(value), [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex h-10 w-full cursor-pointer items-center rounded-lg border border-border bg-bg-elevated pl-9 pr-3 text-left outline-none transition-colors hover:border-gold/30 focus-visible:ring-2 focus-visible:ring-gold/40"
        >
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
          <span className={cn("truncate text-sm leading-none", value ? "text-text-primary" : "text-text-muted")}>
            {value ? formatPickerDate(value) : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-border bg-bg-elevated p-2 text-text-primary shadow-2xl">
        <Calendar
          mode="single"
          required={false}
          showOutsideDays={false}
          selected={selected}
          onSelect={(date) => {
            if (!date) return;
            onChange(dateInputValue(date));
            setOpen(false);
          }}
          classNames={{
            day: "group/day relative flex-1 p-0 text-center select-none",
            day_button: "relative isolate z-10 flex size-9 min-w-9 items-center justify-center rounded-md border-0 leading-none font-normal text-text-secondary hover:bg-gold/10 hover:text-white disabled:pointer-events-none disabled:opacity-30 data-[selected-single=true]:bg-gold data-[selected-single=true]:font-semibold data-[selected-single=true]:text-black data-[anchor=true]:border data-[anchor=true]:border-gold/60 data-[anchor=true]:text-gold",
            hidden: "invisible pointer-events-none",
            outside: "invisible pointer-events-none",
            disabled: "text-text-muted opacity-25",
            today: "text-white",
          }}
          className="rounded-md border-0 bg-transparent"
        />
      </PopoverContent>
    </Popover>
  );
}

function FloorTimePickerButton({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const parts = splitTimeValue(value);
  const setPart = (next: Partial<typeof parts>) => {
    const merged = { ...parts, ...next };
    onChange(toTimeValue(merged.hour, merged.minute, merged.period));
  };
  const normalizedValue = normalizeTimeValue(value);

  useEffect(() => {
    if (value && normalizedValue && value !== normalizedValue) onChange(normalizedValue);
  }, [normalizedValue, onChange, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-10 w-full items-center justify-between rounded-lg border border-border bg-bg-elevated px-3 text-left text-sm text-text-primary outline-none transition-colors hover:border-gold/30 focus-visible:ring-2 focus-visible:ring-gold/40"
        >
          <span className={normalizedValue ? "text-text-primary" : "text-text-muted"}>
            {normalizedValue ? formatPickerTime(normalizedValue) : placeholder}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Time</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 border-border bg-bg-elevated p-3">
        <div className="mb-3 flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
            Scroll columns
          </p>
          <p className="text-sm font-medium text-white">{normalizedValue ? formatPickerTime(normalizedValue) : "7:00 PM"}</p>
        </div>
        <div className="grid grid-cols-[1fr_1fr_0.9fr] gap-2">
          <WheelColumn label="Hour" values={HOURS} value={parts.hour} onChange={(hour) => setPart({ hour })} />
          <WheelColumn label="Minute" values={MINUTES} value={parts.minute} onChange={(minute) => setPart({ minute })} />
          <WheelColumn label="Period" values={PERIODS} value={parts.period} onChange={(period) => setPart({ period: period as (typeof PERIODS)[number] })} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onChange("")}>
            Clear
          </Button>
          <Button type="button" size="sm" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FloorReservationDialog({
  open,
  action,
  table,
  turnTimeMinutes,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  action: FloorServiceAction | null;
  table: FloorTable | null;
  turnTimeMinutes: number;
  saving: boolean;
  onClose: () => void;
  onSubmit: (values: FloorServiceFormValues) => Promise<void>;
}) {
  const now = useMemo(() => new Date(), [open]);
  const reserveDefault = useMemo(() => roundToNextHalfHour(now), [now]);
  const [guestName, setGuestName] = useState(action === "walkin" ? "Walk-in" : "");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [partySize, setPartySize] = useState(String(Math.max(1, Math.min(table?.cap ?? 2, 2))));
  const [reservationDate, setReservationDate] = useState(dateInputValue(action === "walkin" ? now : reserveDefault));
  const [reservationTime, setReservationTime] = useState(normalizeTimeValue(timeInputValue(action === "walkin" ? now : reserveDefault)));
  const [specialRequest, setSpecialRequest] = useState("");

  useEffect(() => {
    if (!open) return;
    const nextNow = new Date();
    const nextReserveDefault = roundToNextHalfHour(nextNow);
    const defaultDate = action === "walkin" ? nextNow : nextReserveDefault;
    setGuestName(action === "walkin" ? "Walk-in" : "");
    setGuestEmail("");
    setGuestPhone("");
    setPartySize(String(Math.max(1, Math.min(table?.cap ?? 2, 2))));
    setReservationDate(dateInputValue(defaultDate));
    setReservationTime(normalizeTimeValue(timeInputValue(defaultDate)));
    setSpecialRequest("");
  }, [action, open, table?.cap]);

  const title = action === "walkin" ? "Seat a walk-in" : "Add a reservation";

  const handleSubmit = async () => {
    await onSubmit({
      guestName,
      guestEmail,
      guestPhone,
      partySize: Math.max(1, Number.parseInt(partySize, 10) || 1),
      reservationDate,
      reservationTime,
      specialRequest,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {title}
            {table ? <span className="ml-2 text-sm font-normal text-text-muted">· Table {tableDisplayLabel(table)}</span> : null}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-muted">Guest name</label>
            <Input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Walk-in" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-muted">Party size</label>
              <Input
                type="number"
                min={1}
                max={99}
                value={partySize}
                onChange={(event) => setPartySize(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-muted">Turn time</label>
              <div className="flex h-10 items-center rounded-md border border-border bg-bg-elevated px-3 text-sm text-text-secondary">
                {turnTimeMinutes} min
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-muted">Date</label>
              <FloorDatePickerButton
                value={reservationDate}
                onChange={setReservationDate}
                placeholder="Choose date"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-muted">Time</label>
              <FloorTimePickerButton
                value={reservationTime}
                onChange={setReservationTime}
                placeholder="Choose time"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-muted">Email</label>
              <Input value={guestEmail} onChange={(event) => setGuestEmail(event.target.value)} placeholder="Optional" />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-muted">Phone</label>
              <Input value={guestPhone} onChange={(event) => setGuestPhone(event.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div className="grid gap-2">
            <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-muted">Notes</label>
            <Textarea
              rows={3}
              value={specialRequest}
              onChange={(event) => setSpecialRequest(event.target.value)}
              placeholder={action === "walkin" ? "Walk-in from floor plan" : "Optional reservation notes"}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? "Saving..." : action === "walkin" ? "Seat now" : "Add reservation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TableCard({
  t,
  editing,
  canAdjustSeats,
  onAction,
  onClose,
  onSeatChange,
  onDelete,
}: {
  t: FloorTable;
  editing: boolean;
  canAdjustSeats: boolean;
  onAction: (a: ActionKind, t: FloorTable) => void;
  onClose: () => void;
  onSeatChange: (t: FloorTable, n: number) => void;
  onDelete: (t: FloorTable) => void;
}) {
  const s = TBL_STATUS[t.status];
  return (
    <div className="overflow-hidden rounded-xl" style={cardStyle}>
      <div style={{ height: 2, background: s.color, opacity: 0.7 }} />
      <div className="p-6">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <div className={cn(eyebrowCls, "mb-1.5")}>Table</div>
            <div className="font-serif text-[42px] leading-none" style={{ letterSpacing: "-0.04em" }}>
              {tableDisplayLabel(t)}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[12px]">
              <span className="size-1.5 rounded-full" style={{ background: s.color }} />
              <span style={{ color: s.color }}>{s.label}</span>
              <span className="text-text-muted">·</span>
              <span className="text-text-secondary">Seats {t.cap}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 size-7 rounded text-[20px] leading-none text-text-muted hover:bg-white/5 hover:text-text-secondary"
          >
            ×
          </button>
        </div>

        {editing && (
          <div className="mb-5 border-y py-4" style={{ borderColor: BORDER_SOFT }}>
            <div className="flex items-center justify-between">
              <div>
                <div className={cn(eyebrowCls, "mb-1")}>Seats</div>
                <div
                  className="font-serif text-[24px] leading-none tabular-nums"
                  style={{ letterSpacing: "-0.02em" }}
                >
                  {t.cap}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onSeatChange(t, t.cap - 1)}
                  className="size-9 rounded-md text-[16px] text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
                  style={{ border: `1px solid ${BORDER_SOFT}` }}
                >
                  −
                </button>
                <button
                  onClick={() => onSeatChange(t, t.cap + 1)}
                  className="size-9 rounded-md text-[16px] text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
                  style={{ border: `1px solid ${BORDER_SOFT}` }}
                >
                  +
                </button>
              </div>
            </div>
            <button
              onClick={() => onDelete(t)}
              className="mt-3 text-[12px] text-text-muted transition-colors hover:text-[#C97A6F]"
            >
              Remove this table
            </button>
          </div>
        )}

        {!editing && (t.combinedWith?.length ?? 0) > 0 && (
          <div className="mb-5 rounded-lg border border-gold/20 bg-gold/10 px-3 py-2 text-[12.5px] text-gold-light">
            Combined with {t.combinedWith?.length} other table{t.combinedWith?.length === 1 ? "" : "s"} for this booking.
          </div>
        )}

        {!editing && t.guest ? (
          <div className="mb-5 border-y py-4" style={{ borderColor: BORDER_SOFT }}>
            <div className={cn(eyebrowCls, "mb-1.5")}>Guest</div>
            <div className="font-serif text-[20px] leading-tight" style={{ letterSpacing: "-0.02em" }}>
              {t.guest}
            </div>
            <div className="mt-1 text-[12px] tabular-nums text-text-secondary">
              Party of {t.party} · {t.time}
            </div>
          </div>
        ) : !editing ? (
          <div className="mb-5 border-y py-4" style={{ borderColor: BORDER_SOFT }}>
            <div className="text-[13px] leading-relaxed text-text-secondary">{s.hint}.</div>
          </div>
        ) : null}

        <div className="space-y-2">
          {!editing && t.status === "free" && (
            <>
              <button
                onClick={() => onAction("walkin", t)}
                className={cn(goldBtnCls, "w-full bg-gold py-2.5 text-black")}
              >
                Seat a walk-in
              </button>
              <button onClick={() => onAction("reserve", t)} className={cn(softBtnCls, "w-full py-2.5")}>
                Add a reservation
              </button>
            </>
          )}
          {!editing && t.status === "reserved" && (
            <>
              <button
                onClick={() => onAction("seat", t)}
                className={cn(goldBtnCls, "w-full bg-gold py-2.5 text-black")}
              >
                Seat them now
              </button>
              <div className="grid grid-cols-2 gap-1">
                <button onClick={() => onAction("text", t)} className={cn(softBtnCls, "py-2.5")}>
                  Text guest
                </button>
                <button onClick={() => onAction("cancel", t)} className={cn(softBtnCls, "py-2.5")}>
                  No-show
                </button>
              </div>
            </>
          )}
          {!editing && t.status === "occupied" && (
            <>
              <button
                onClick={() => onAction("paid", t)}
                className={cn(goldBtnCls, "w-full bg-gold py-2.5 text-black")}
              >
                Mark paid &amp; close
              </button>
              <div className="grid grid-cols-2 gap-1">
                <button onClick={() => onAction("check", t)} className={cn(softBtnCls, "py-2.5")}>
                  Drop check
                </button>
                <button onClick={() => onAction("move", t)} className={cn(softBtnCls, "py-2.5")}>
                  Move table
                </button>
              </div>
            </>
          )}
          {!editing && t.status === "cleaning" && (
            <button
              onClick={() => onAction("ready", t)}
              className={cn(goldBtnCls, "w-full bg-gold py-2.5 text-black")}
            >
              Mark ready
            </button>
          )}
        </div>

        {!editing && canAdjustSeats && (
          <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${BORDER_SOFT}` }}>
            <div className={cn(eyebrowCls, "mb-2")}>Adjust seats</div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onSeatChange(t, t.cap - 1)}
                className="size-8 rounded-md text-[14px] text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
                style={{ border: `1px solid ${BORDER_SOFT}` }}
              >
                −
              </button>
              <span
                className="mx-3 font-serif text-[18px] tabular-nums"
                style={{ letterSpacing: "-0.02em" }}
              >
                {t.cap}
              </span>
              <button
                onClick={() => onSeatChange(t, t.cap + 1)}
                className="size-8 rounded-md text-[14px] text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
                style={{ border: `1px solid ${BORDER_SOFT}` }}
              >
                +
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WallCard({ w, onDelete, onClose }: { w: Wall; onDelete: (w: Wall) => void; onClose: () => void }) {
  const length = Math.round(Math.hypot(w.x2 - w.x1, w.y2 - w.y1));
  return (
    <div className="overflow-hidden rounded-xl" style={cardStyle}>
      <div style={{ height: 2, background: "rgba(255,255,255,0.3)" }} />
      <div className="p-6">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <div className={cn(eyebrowCls, "mb-1.5")}>Divider</div>
            <div className="font-serif text-[26px] leading-none" style={{ letterSpacing: "-0.025em" }}>
              Wall
            </div>
            <div className="mt-2 text-[12px] tabular-nums text-text-secondary">{length} units long</div>
          </div>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 size-7 rounded text-[20px] leading-none text-text-muted hover:bg-white/5 hover:text-text-secondary"
          >
            ×
          </button>
        </div>
        <p
          className="mb-3 border-t py-3 text-[12.5px] leading-relaxed text-text-secondary"
          style={{ borderColor: BORDER_SOFT }}
        >
          Drag the wall to move it, or pull either endpoint to reshape.
        </p>
        <button
          onClick={() => onDelete(w)}
          className="w-full rounded-md py-2.5 text-[13px] text-text-secondary transition-colors hover:bg-[rgba(201,122,111,0.05)] hover:text-[#C97A6F]"
          style={{ border: `1px solid ${BORDER_SOFT}` }}
        >
          Remove wall
        </button>
      </div>
    </div>
  );
}

function EntranceCard({
  entrance,
  onChangeSide,
  onChangeWidth,
  onClose,
}: {
  entrance: Entrance;
  onChangeSide: (s: EntranceSide) => void;
  onChangeWidth: (w: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl" style={cardStyle}>
      <div style={{ height: 2, background: "var(--gold)", opacity: 0.7 }} />
      <div className="p-6">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <div className={cn(eyebrowCls, "mb-1.5")}>Floor entry</div>
            <div className="font-serif text-[26px] leading-none" style={{ letterSpacing: "-0.025em" }}>
              Entrance
            </div>
            <div className="mt-2 text-[12px] capitalize text-text-secondary">On the {entrance.side}</div>
          </div>
          <button
            onClick={onClose}
            className="-mr-1 -mt-1 size-7 rounded text-[20px] leading-none text-text-muted hover:bg-white/5 hover:text-text-secondary"
          >
            ×
          </button>
        </div>
        <div className={cn(eyebrowCls, "mb-2")}>Side</div>
        <div className="mb-5 grid grid-cols-4 gap-1">
          {(["top", "right", "bottom", "left"] as const).map((s) => (
            <button
              key={s}
              onClick={() => onChangeSide(s)}
              className="rounded-md py-2 text-[11.5px] capitalize transition-colors"
              style={{
                border: `1px solid ${BORDER_SOFT}`,
                background: entrance.side === s ? "rgba(201,168,76,0.1)" : "transparent",
                color: entrance.side === s ? "var(--gold-light)" : "var(--text-secondary)",
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <div className={cn(eyebrowCls, "mb-2")}>
          Width <span className="ml-2 normal-case tabular-nums text-text-secondary">{entrance.width}</span>
        </div>
        <div className="mb-3 flex items-center gap-1">
          <button
            onClick={() => onChangeWidth(entrance.width - 10)}
            className="size-9 rounded-md text-[16px] text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
            style={{ border: `1px solid ${BORDER_SOFT}` }}
          >
            −
          </button>
          <button
            onClick={() => onChangeWidth(entrance.width + 10)}
            className="size-9 rounded-md text-[16px] text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
            style={{ border: `1px solid ${BORDER_SOFT}` }}
          >
            +
          </button>
        </div>
        <p className="text-[12px] leading-relaxed text-text-muted">
          Drag the entrance along its side to reposition.
        </p>
      </div>
    </div>
  );
}

function IdleCard({
  summary,
  onSearch,
  query,
  onJump,
  results,
}: {
  summary: string;
  onSearch: (q: string) => void;
  query: string;
  onJump: (t: FloorTable) => void;
  results: FloorTable[];
}) {
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl p-6" style={cardStyle}>
        <div className={cn(eyebrowCls, "mb-3")}>This evening</div>
        <p className="font-serif text-[19px] leading-snug text-white" style={{ letterSpacing: "-0.015em" }}>
          {summary}
        </p>
        <p className="mt-3 text-[12.5px] leading-relaxed text-text-muted">
          Select any table to see who's there or take an action.
        </p>
      </div>
      <div className="overflow-hidden rounded-xl p-5" style={cardStyle}>
        <div className={cn(eyebrowCls, "mb-2")}>Find a table</div>
        <input
          value={query}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Table number or guest name"
          className="w-full rounded-md bg-transparent px-3 py-2.5 text-[13px] outline-none transition-colors focus:bg-white/[0.03]"
          style={{ border: `1px solid ${BORDER_SOFT}`, color: "var(--text-primary)" }}
        />
        {query && results.length > 0 && (
          <div className="mt-3 max-h-48 space-y-1 overflow-y-auto">
            {results.slice(0, 8).map((t) => {
              const s = TBL_STATUS[t.status];
              return (
                <button
                  key={t.id}
                  onClick={() => onJump(t)}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-white/5"
                >
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span
                    className="w-8 font-serif text-[15px] tabular-nums"
                    style={{ letterSpacing: "-0.02em" }}
                  >
                    {tableDisplayLabel(t)}
                  </span>
                  <span className="flex-1 truncate text-[12px] text-text-secondary">
                    {t.guest || s.label} {t.time ? `· ${t.time}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {query && results.length === 0 && <p className="mt-3 text-[12px] text-text-muted">No matches.</p>}
      </div>
    </div>
  );
}

function EditCard({
  onAddTable,
  onAddWall,
  onAddFloor,
}: {
  onAddTable: (shape: TableShape, cap: number) => void;
  onAddWall: () => void;
  onAddFloor: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl" style={cardStyle}>
      <div style={{ height: 2, background: "var(--gold)", opacity: 0.7 }} />
      <div className="p-6">
        <div className={cn(eyebrowCls, "mb-1.5")}>Editing layout</div>
        <p className="mb-4 font-serif text-[18px] leading-snug" style={{ letterSpacing: "-0.02em" }}>
          Add and arrange your tables.
        </p>

        <div className={cn(eyebrowCls, "mb-2")}>Add a table</div>
        <div className="mb-5 grid grid-cols-2 gap-1.5">
          {[
            { k: "r2", shape: "round" as const, cap: 2, label: "Round · 2" },
            { k: "r4", shape: "round" as const, cap: 4, label: "Round · 4" },
            { k: "s4", shape: "rect" as const, cap: 4, label: "Square · 4" },
            { k: "l6", shape: "rect" as const, cap: 6, label: "Long · 6" },
          ].map((p) => (
            <button
              key={p.k}
              onClick={() => onAddTable(p.shape, p.cap)}
              className="flex items-center justify-center gap-2 rounded-md py-3 text-[12px] text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
              style={{ border: `1px solid ${BORDER_SOFT}` }}
            >
              <span
                className={cn("block", p.shape === "round" ? "rounded-full" : "rounded-sm")}
                style={{
                  width: p.cap > 4 ? 16 : 12,
                  height: p.shape === "round" ? (p.cap > 4 ? 16 : 12) : 8,
                  border: "1px solid rgba(201,168,76,0.45)",
                  background: "rgba(201,168,76,0.08)",
                }}
              />
              {p.label}
            </button>
          ))}
        </div>

        <div className={cn(eyebrowCls, "mb-2")}>Walls &amp; dividers</div>
        <button
          onClick={onAddWall}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-[12.5px] text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
          style={{ border: `1px solid ${BORDER_SOFT}` }}
        >
          <span
            style={{
              display: "inline-block",
              width: 18,
              height: 2,
              background: "rgba(255,255,255,0.4)",
              borderRadius: 1,
            }}
          />
          Add a wall
        </button>

        <button
          onClick={onAddFloor}
          className="mb-5 w-full rounded-md py-2.5 text-[13px] text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
          style={{ border: `1px solid ${BORDER_SOFT}` }}
        >
          + Add another floor
        </button>

        <p className="mb-5 text-[11.5px] leading-relaxed text-text-muted">
          Tip: click the entrance to move it.
        </p>
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────
export default function FloorPlanPage() {
  const { t } = useTranslation();
  const {
    tables: dbTables,
    floorPlans: dbFloorPlans,
    sections: dbSections,
    loading: floorPlanLoading,
    createSectionAndFloor,
    createTable: createDbTable,
    updateFloorName,
    updateTable: updateDbTable,
    updateTableServiceStatus,
    deleteTable: deleteDbTable,
    deleteFloor: deleteDbFloor,
    updateLayout,
    refetch: refetchFloorPlan,
  } = useFloorPlan({ pauseRealtime: true });
  const {
    reservations,
    updateStatus: updateReservationStatus,
    refetch: refetchReservations,
  } = useReservations();
  const { rolesAtRestaurant } = useUser();
  const { selectedRestaurantId, selectedRestaurant } = useRestaurantScope();
  const [floors, setFloors] = useState<Floor[]>(FLOORS);
  const [activeFloor, setActiveFloor] = useState("main");
  const [rooms, setRooms] = useState<Record<string, Room>>(ROOMS);
  const [tablesByFloor, setTables] = useState<Record<string, FloorTable[]>>(TABLES);
  const [wallsByFloor, setWalls] = useState<Record<string, Wall[]>>(WALLS);
  const [entranceByFloor, setEntrance] = useState<Record<string, Entrance>>(ENTRANCES);
  const [sel, setSel] = useState<Selection>(null);
  const [editing, setEditing] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [deletedTableIds, setDeletedTableIds] = useState<string[]>([]);
  const [deletedFloorIds, setDeletedFloorIds] = useState<string[]>([]);
  const [renamingFloorId, setRenamingFloorId] = useState<string | null>(null);
  const [renameFloorValue, setRenameFloorValue] = useState("");
  const [confirmDeleteFloorId, setConfirmDeleteFloorId] = useState<string | null>(null);
  const [serviceDialog, setServiceDialog] = useState<{ action: FloorServiceAction; table: FloorTable } | null>(null);
  const [savingService, setSavingService] = useState(false);
  const turnTimeMinutes = restaurantTurnTimeMinutes(selectedRestaurant?.settings_json);

  // Visual scale for "100%". Keep this at true room scale so the floor
  // outline fills the viewport instead of feeling zoomed out.
  const BASE_ZOOM = 1;
  const [zoom, setZoom] = useState(BASE_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const canEditLayout = useMemo(
    () =>
      selectedRestaurantId
        ? rolesAtRestaurant(selectedRestaurantId).some((role) => role.role === "owner" || role.role === "manager")
        : false,
    [rolesAtRestaurant, selectedRestaurantId],
  );

  useEffect(() => {
    if (canEditLayout || !editing) return;
    void Promise.resolve().then(() => {
      setEditing(false);
      setSel(null);
      setRenamingFloorId(null);
      setConfirmDeleteFloorId(null);
    });
  }, [canEditLayout, editing]);

  useEffect(() => {
    if (floorPlanLoading) return;
    if (!isSupabaseConfigured()) return;

    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;

      const sourceFloors: Floor[] = dbSections.length > 0
        ? dbSections.map((section) => ({ id: section.id, name: section.name }))
        : dbFloorPlans.map((plan) => ({ id: plan.section_id ?? plan.id, name: plan.name }));
      const nextFloors = sourceFloors.length > 0 ? sourceFloors : [{ id: "main", name: "Main Dining" }];
      const floorIds = new Set(nextFloors.map((floor) => floor.id));

      const nextRooms: Record<string, Room> = {};
      const nextWalls: Record<string, Wall[]> = {};
      const nextEntrances: Record<string, Entrance> = {};
      const nextTables: Record<string, FloorTable[]> = {};

      nextFloors.forEach((floor) => {
        const plan = dbFloorPlans.find((candidate) => (candidate.section_id ?? candidate.id) === floor.id);
        const room = {
          w: plan?.canvas_width ?? DEFAULT_ROOM.w,
          h: plan?.canvas_height ?? DEFAULT_ROOM.h,
        };
        nextRooms[floor.id] = room;
        nextWalls[floor.id] = layoutFromPlan(plan).walls as Wall[];
        nextEntrances[floor.id] = entranceFromLayout(plan, room);
        nextTables[floor.id] = [];
      });

      dbTables.forEach((table) => {
        const floorId = table.section_id && floorIds.has(table.section_id) ? table.section_id : nextFloors[0].id;
        nextTables[floorId] = [...(nextTables[floorId] ?? []), tableRowToFloorTable(table)];
      });

      const now = new Date();
      const serviceReservations = reservations
        .filter((reservation) => ["confirmed", "seated"].includes(reservation.status))
        .filter((reservation) => isReservationInFloorWindow(reservation, now, turnTimeMinutes))
        .sort((a, b) => {
          const priorityDiff = reservationPriority(b) - reservationPriority(a);
          if (priorityDiff !== 0) return priorityDiff;
          return new Date(a.reserved_at).getTime() - new Date(b.reserved_at).getTime();
        });

      for (const reservation of serviceReservations) {
        const assignedTableIds = new Set(reservationTableIds(reservation));
        if (assignedTableIds.size === 0) continue;
        const reservedAt = new Date(reservation.reserved_at);
        const reservationStatus: Status = reservation.status === "seated" ? "occupied" : "reserved";

        for (const floorId of Object.keys(nextTables)) {
          nextTables[floorId] = nextTables[floorId].map((table) => {
            const tableId = table.dbId ?? table.id;
            if (!assignedTableIds.has(tableId)) return table;
            return {
              ...table,
              reservationId: reservation.id,
              reservationStatus: reservation.status,
              reservedAt: reservation.reserved_at,
              durationMinutes: reservation.duration_minutes,
              status: reservationStatus,
              guest: reservationGuestName(reservation),
              party: reservation.party_size,
              time: Number.isNaN(reservedAt.getTime()) ? null : serviceTimeLabel(reservedAt),
            };
          });
        }
      }

      setFloors(nextFloors);
      setRooms(nextRooms);
      setWalls(nextWalls);
      setEntrance(nextEntrances);
      setTables(nextTables);
      setActiveFloor((current) => (floorIds.has(current) ? current : nextFloors[0].id));
      setDeletedTableIds([]);
      setDeletedFloorIds([]);
      setRenamingFloorId(null);
      setConfirmDeleteFloorId(null);
      setSel(null);
    });

    return () => {
      cancelled = true;
    };
  }, [dbFloorPlans, dbSections, dbTables, floorPlanLoading, reservations, turnTimeMinutes]);

  const tables = useMemo(() => tablesByFloor[activeFloor] ?? [], [activeFloor, tablesByFloor]);
  const walls = useMemo(() => wallsByFloor[activeFloor] ?? [], [activeFloor, wallsByFloor]);
  const entrance = entranceByFloor[activeFloor];
  const baseRoom = rooms[activeFloor] || { w: 720, h: 560 };

  const room = useMemo(() => {
    const PAD = 90;
    let maxX = baseRoom.w;
    let maxY = baseRoom.h;
    tables.forEach((t) => {
      const w = t.size;
      const h = t.shape === "round" ? t.size : t.long ? 70 : 80;
      maxX = Math.max(maxX, t.x + w + PAD);
      maxY = Math.max(maxY, t.y + h + PAD);
    });
    walls.forEach((w) => {
      maxX = Math.max(maxX, w.x1 + 30, w.x2 + 30);
      maxY = Math.max(maxY, w.y1 + 30, w.y2 + 30);
    });
    return { w: Math.round(maxX), h: Math.round(maxY) };
  }, [tables, walls, baseRoom.w, baseRoom.h]);

  const selTable = sel?.kind === "table" ? tables.find((t) => t.id === sel.id) ?? null : null;
  const selWall = sel?.kind === "wall" ? walls.find((w) => w.id === sel.id) ?? null : null;
  const selEntrance = sel?.kind === "entrance" ? entrance : null;

  const snapshot = useCallback(
    (): Snapshot => ({
      floor: activeFloor,
      tables: JSON.parse(JSON.stringify(tablesByFloor)) as Record<string, FloorTable[]>,
      walls: JSON.parse(JSON.stringify(wallsByFloor)) as Record<string, Wall[]>,
      entrance: JSON.parse(JSON.stringify(entranceByFloor)) as Record<string, Entrance>,
      rooms: JSON.parse(JSON.stringify(rooms)) as Record<string, Room>,
      floors: JSON.parse(JSON.stringify(floors)) as Floor[],
      deletedTableIds: [...deletedTableIds],
      deletedFloorIds: [...deletedFloorIds],
    }),
    [activeFloor, tablesByFloor, wallsByFloor, entranceByFloor, rooms, floors, deletedTableIds, deletedFloorIds],
  );

  const pushHistory = useCallback(() => {
    setPast((p) => [...p.slice(-49), snapshot()]);
    setFuture([]);
  }, [snapshot]);

  const restore = (snap: Snapshot) => {
    setTables(snap.tables);
    setWalls(snap.walls);
    setEntrance(snap.entrance);
    setRooms(snap.rooms);
    setFloors(snap.floors);
    setDeletedTableIds(snap.deletedTableIds);
    setDeletedFloorIds(snap.deletedFloorIds);
    if (snap.floors.find((f) => f.id === snap.floor)) setActiveFloor(snap.floor);
  };

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    const cur = snapshot();
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [...f, cur]);
    restore(prev);
  }, [past, snapshot]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const nxt = future[future.length - 1];
    const cur = snapshot();
    setFuture((f) => f.slice(0, -1));
    setPast((p) => [...p, cur]);
    restore(nxt);
  }, [future, snapshot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!editing) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (meta && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, undo, redo]);

  const updateTable = (id: string, patch: Partial<FloorTable>, skipHistory?: boolean) => {
    if (!skipHistory) pushHistory();
    setTables((byF) => ({
      ...byF,
      [activeFloor]: (byF[activeFloor] || []).map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  };
  const updateWall = (id: string, patch: Partial<Wall>, skipHistory?: boolean) => {
    if (!skipHistory) pushHistory();
    setWalls((byF) => ({
      ...byF,
      [activeFloor]: (byF[activeFloor] || []).map((w) => (w.id === id ? { ...w, ...patch } : w)),
    }));
  };
  const updateEntrance = (patch: Partial<Entrance>, skipHistory?: boolean) => {
    if (!skipHistory) pushHistory();
    setEntrance((byF) => ({ ...byF, [activeFloor]: { ...byF[activeFloor], ...patch } }));
  };
  const deleteTable = (id: string) => {
    if (!canEditLayout) return;
    pushHistory();
    const table = tables.find((t) => t.id === id);
    const tableDbId = table?.dbId;
    if (tableDbId && isDatabaseUuid(tableDbId)) {
      setDeletedTableIds((ids) => (ids.includes(tableDbId) ? ids : [...ids, tableDbId]));
    }
    setTables((byF) => ({
      ...byF,
      [activeFloor]: (byF[activeFloor] || []).filter((t) => t.id !== id),
    }));
    setSel(null);
  };
  const deleteWall = (id: string) => {
    if (!canEditLayout) return;
    pushHistory();
    setWalls((byF) => ({
      ...byF,
      [activeFloor]: (byF[activeFloor] || []).filter((w) => w.id !== id),
    }));
    setSel(null);
  };

  const addWall = () => {
    if (!canEditLayout) return;
    pushHistory();
    const id = "w" + Date.now().toString(36);
    const cx = room.w / 2;
    const cy = room.h / 2;
    const newW: Wall = { id, x1: cx - 90, y1: cy, x2: cx + 90, y2: cy };
    setWalls((byF) => ({ ...byF, [activeFloor]: [...(byF[activeFloor] || []), newW] }));
    setSel({ kind: "wall", id });
  };

  const setSeats = (t: FloorTable, n: number) => {
    if (!canEditLayout) return;
    const cap = Math.max(1, Math.min(20, n));
    const nextSize = tableSize(t.shape, cap);
    const size = nextSize.size;
    const long = nextSize.long;
    updateTable(t.id, { cap, size, long });
  };

  const persistServiceStatus = async (
    t: FloorTable,
    status: Status,
    seatedCount: number,
  ) => {
    const tableId = t.dbId ?? t.id;
    const saved = await updateTableServiceStatus(tableId, toDbStatus(status), seatedCount);
    if (!saved) {
      toast.error("Could not update table status.");
      await refetchFloorPlan({ silent: true });
    }
  };

  const findGuestId = async (payload: FloorServiceFormValues): Promise<string | null> => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) return null;
    const guestEmail = payload.guestEmail.trim();
    const guestPhone = payload.guestPhone.trim();
    if (!guestEmail && !guestPhone) return null;

    const client = getSupabaseBrowserClient();
    let query = client
      .from("guests")
      .select("id")
      .eq("restaurant_id", selectedRestaurantId)
      .limit(1);

    if (guestEmail && guestPhone) {
      query = query.or(`email.eq.${guestEmail},phone.eq.${guestPhone}`);
    } else if (guestEmail) {
      query = query.eq("email", guestEmail);
    } else {
      query = query.eq("phone", guestPhone);
    }

    const { data } = await query;
    const first = (data ?? [])[0] as GuestLookupRow | undefined;
    return first?.id ?? null;
  };

  const ensureTableAvailableForReservation = async (
    tableId: string,
    reservedAt: Date,
    partySize: number,
  ): Promise<void> => {
    if (partySize > (tables.find((table) => (table.dbId ?? table.id) === tableId)?.cap ?? 0)) {
      throw new Error("Party size exceeds this table's capacity.");
    }

    const client = getSupabaseBrowserClient();
    const { data, error } = await client
      .from("reservation_tables")
      .select("reservation_id, reservations(id, status, reserved_at, duration_minutes)")
      .eq("table_id", tableId)
      .is("released_at", null);

    if (error) throw new Error(error.message);

    const requestedStart = reservedAt.getTime();
    const requestedEnd = requestedStart + turnTimeMinutes * 60_000;
    for (const link of (data ?? []) as ReservationLinkRow[]) {
      const reservation = Array.isArray(link.reservations) ? link.reservations[0] : link.reservations;
      if (!reservation || !["confirmed", "seated"].includes(reservation.status ?? "")) continue;
      if (!reservation.reserved_at) continue;
      const existingStart = new Date(reservation.reserved_at).getTime();
      if (Number.isNaN(existingStart)) continue;
      const existingDuration = reservation.duration_minutes ?? turnTimeMinutes;
      const existingEnd = existingStart + existingDuration * 60_000;
      if (existingStart < requestedEnd && existingEnd > requestedStart) {
        throw new Error("This table is already reserved during that turn time.");
      }
    }
  };

  const createFloorReservation = async (
    action: FloorServiceAction,
    t: FloorTable,
    values: FloorServiceFormValues,
  ): Promise<string> => {
    if (!selectedRestaurantId) throw new Error("No restaurant selected.");
    const tableId = t.dbId ?? t.id;
    if (!isDatabaseUuid(tableId)) throw new Error("Save this table before assigning reservations.");

    const reservedAt = combineDateAndTime(values.reservationDate, values.reservationTime);
    if (!reservedAt || Number.isNaN(reservedAt.getTime())) throw new Error("Choose a valid reservation time.");
    const guestName = values.guestName.trim() || (action === "walkin" ? "Walk-in" : "");
    if (!guestName) throw new Error("Guest name is required.");
    await ensureTableAvailableForReservation(tableId, reservedAt, values.partySize);

    const guestId = await findGuestId(values);
    const client = getSupabaseBrowserClient();
    const { data, error } = await client
      .from("reservations")
      .insert({
        restaurant_id: selectedRestaurantId,
        guest_id: guestId,
        guest_full_name: guestName,
        guest_email: values.guestEmail.trim() || null,
        guest_phone: values.guestPhone.trim() || null,
        party_size: values.partySize,
        reserved_at: reservedAt.toISOString(),
        duration_minutes: turnTimeMinutes,
        table_id: tableId,
        special_request: values.specialRequest.trim() || null,
        status: action === "walkin" ? "seated" : "confirmed",
        source: action === "walkin" ? "floor_walkin" : "floor_plan",
        is_guest_checkout: true,
        confirmed_at: new Date().toISOString(),
        checked_in_at: action === "walkin" ? new Date().toISOString() : null,
        seated_at: action === "walkin" ? new Date().toISOString() : null,
        confirmation_code: crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase(),
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    const reservationId = (data as { id: string }).id;
    const { error: assignmentError } = await client.from("reservation_tables").insert({
      restaurant_id: selectedRestaurantId,
      reservation_id: reservationId,
      table_id: tableId,
      is_primary: true,
    });
    if (assignmentError) throw new Error(assignmentError.message);

    return reservationId;
  };

  const handleFloorReservationSubmit = async (values: FloorServiceFormValues) => {
    if (!serviceDialog) return;
    if (!isSupabaseConfigured()) {
      toast.error(t("auth.errors.supabaseNotConfigured"));
      return;
    }

    const { action, table } = serviceDialog;
    setSavingService(true);
    try {
      await createFloorReservation(action, table, values);
      const reservedAt = combineDateAndTime(values.reservationDate, values.reservationTime) ?? new Date();
      const status: Status = action === "walkin" ? "occupied" : "reserved";
      const nextParty = Math.max(1, values.partySize);
      updateTable(table.id, {
        status,
        guest: values.guestName.trim() || (action === "walkin" ? "Walk-in" : "Guest"),
        party: nextParty,
        time: serviceTimeLabel(reservedAt),
        durationMinutes: turnTimeMinutes,
      }, true);
      if (action === "walkin") {
        void persistServiceStatus(table, "occupied", nextParty);
      } else {
        void persistServiceStatus(table, "reserved", 0);
      }
      await Promise.all([refetchReservations(), refetchFloorPlan({ silent: true })]);
      setServiceDialog(null);
      toast.success(action === "walkin" ? "Walk-in seated." : "Reservation added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save reservation.");
    } finally {
      setSavingService(false);
    }
  };

  const seatReservedTable = async (t: FloorTable, partySize: number) => {
    if (!t.reservationId) return;
    const tableId = t.dbId ?? t.id;
    if (!isDatabaseUuid(tableId)) {
      toast.error("Save this table before seating reservations.");
      return;
    }

    try {
      const client = getSupabaseBrowserClient();
      const seatedAt = new Date().toISOString();
      const { error } = await client
        .from("reservations")
        .update({
          status: "seated",
          table_id: tableId,
          checked_in_at: seatedAt,
          seated_at: seatedAt,
        })
        .eq("id", t.reservationId);
      if (error) throw new Error(error.message);

      const seated = await markReservationTablesSeated(t.reservationId, partySize);
      if (seated.error) throw new Error(seated.error);

      await Promise.all([refetchReservations(), refetchFloorPlan({ silent: true })]);
      toast.success("Reservation seated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not seat reservation.");
      await refetchFloorPlan({ silent: true });
    }
  };

  const handleAction = (action: ActionKind, t: FloorTable) => {
    if (action === "walkin" || action === "reserve") {
      setServiceDialog({ action, table: t });
      return;
    }
    if (action === "seat") {
      const nextParty = t.party || 2;
      updateTable(
        t.id,
        { status: "occupied", guest: t.guest || "Walk-in", party: nextParty, time: t.time || "now" },
        true,
      );
      if (action === "seat" && t.reservationId) {
        void seatReservedTable(t, nextParty);
      } else {
        void persistServiceStatus(t, "occupied", nextParty);
      }
    }
    if (action === "paid") {
      updateTable(t.id, { status: "cleaning", guest: null, party: 0, time: null }, true);
      if (t.reservationId) {
        void (async () => {
          try {
            await updateReservationStatus(t.reservationId ?? "", "completed");
            await persistServiceStatus(t, "cleaning", 0);
            await Promise.all([refetchReservations(), refetchFloorPlan({ silent: true })]);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not close reservation.");
          }
        })();
      } else {
        void persistServiceStatus(t, "cleaning", 0);
      }
    }
    if (action === "ready") {
      updateTable(t.id, { status: "free", guest: null, party: 0, time: null }, true);
      void persistServiceStatus(t, "free", 0);
    }
    if (action === "cancel") {
      updateTable(t.id, { status: "free", guest: null, party: 0, time: null }, true);
      if (t.reservationId) {
        void (async () => {
          try {
            await updateReservationStatus(t.reservationId ?? "", "no_show");
            await persistServiceStatus(t, "free", 0);
            await Promise.all([refetchReservations(), refetchFloorPlan({ silent: true })]);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not mark no-show.");
          }
        })();
      } else {
        void persistServiceStatus(t, "free", 0);
      }
    }
  };

  const addTable = (shape: TableShape, cap: number) => {
    if (!canEditLayout) return;
    pushHistory();
    const idx = (tables.length || 0) + 1;
    const id = activeFloor === "patio" ? `P${idx}` : activeFloor === "private" ? `PR${idx}` : String(idx);
    const nextSize = tableSize(shape, cap);
    const newT: FloorTable = {
      id,
      tableNumber: id,
      sectionId: activeFloor,
      combinedWith: [],
      shape,
      x: 140,
      y: 140,
      size: nextSize.size,
      cap,
      status: "free",
      guest: null,
      party: 0,
      time: null,
      long: nextSize.long,
    };
    setTables((byF) => ({ ...byF, [activeFloor]: [...(byF[activeFloor] || []), newT] }));
    setSel({ kind: "table", id });
  };

  const addFloor = () => {
    if (!canEditLayout) return;
    pushHistory();
    const n = floors.length + 1;
    const id = `floor${n}`;
    setFloors((f) => [...f, { id, name: `Floor ${n}` }]);
    setTables((byF) => ({ ...byF, [id]: [] }));
    setWalls((byF) => ({ ...byF, [id]: [] }));
    setEntrance((byF) => ({ ...byF, [id]: { side: "top", pos: 360, width: 50 } }));
    setRooms((r) => ({ ...r, [id]: { w: 720, h: 560 } }));
    setActiveFloor(id);
  };

  const startRenameFloor = (floor: Floor) => {
    if (!canEditLayout) return;
    setConfirmDeleteFloorId(null);
    setRenamingFloorId(floor.id);
    setRenameFloorValue(floor.name);
  };

  const commitRenameFloor = () => {
    if (!canEditLayout) return;
    if (!renamingFloorId) return;
    const nextName = renameFloorValue.trim();
    if (!nextName) {
      toast.error("Floor name cannot be empty.");
      return;
    }
    pushHistory();
    setFloors((current) =>
      current.map((floor) => (floor.id === renamingFloorId ? { ...floor, name: nextName } : floor)),
    );
    setRenamingFloorId(null);
    setRenameFloorValue("");
  };

  const deleteFloor = (floorId: string) => {
    if (!canEditLayout) return;
    if (floors.length <= 1) {
      toast.error("At least one floor is required.");
      return;
    }
    pushHistory();
    const nextFloors = floors.filter((floor) => floor.id !== floorId);
    const nextActiveFloor = activeFloor === floorId ? nextFloors[0]?.id : activeFloor;
    const floorTables = tablesByFloor[floorId] ?? [];
    const dbTableIds = floorTables
      .map((table) => table.dbId)
      .filter((id): id is string => Boolean(id && isDatabaseUuid(id)));

    setFloors(nextFloors);
    setTables((current) => {
      const next = { ...current };
      delete next[floorId];
      return next;
    });
    setWalls((current) => {
      const next = { ...current };
      delete next[floorId];
      return next;
    });
    setEntrance((current) => {
      const next = { ...current };
      delete next[floorId];
      return next;
    });
    setRooms((current) => {
      const next = { ...current };
      delete next[floorId];
      return next;
    });
    setDeletedTableIds((ids) => Array.from(new Set([...ids, ...dbTableIds])));
    if (isDatabaseUuid(floorId)) {
      setDeletedFloorIds((ids) => (ids.includes(floorId) ? ids : [...ids, floorId]));
    }
    if (nextActiveFloor) setActiveFloor(nextActiveFloor);
    setConfirmDeleteFloorId(null);
    setRenamingFloorId(null);
    setSel(null);
  };

  const saveFloorPlanLayout = async () => {
    if (!canEditLayout) {
      setEditing(false);
      toast.error("Only owners and managers can edit the floor plan layout.");
      return;
    }
    if (!isSupabaseConfigured()) {
      setEditing(false);
      return;
    }

    setSavingLayout(true);
    try {
      const floorMappings: Record<string, { sectionId: string; floorPlanId: string | null }> = {};

      for (const floor of floors) {
        const existingPlan = dbFloorPlans.find((plan) => (plan.section_id ?? plan.id) === floor.id);
        if (isDatabaseUuid(floor.id)) {
          const renamed = await updateFloorName(floor.id, floor.name);
          if (!renamed) {
            throw new Error(`Could not rename ${floor.name}.`);
          }
          floorMappings[floor.id] = {
            sectionId: floor.id,
            floorPlanId: existingPlan?.id ?? null,
          };
          continue;
        }

        const created = await createSectionAndFloor(floor.name);
        if (!created) {
          throw new Error(`Could not save ${floor.name}.`);
        }
        floorMappings[floor.id] = {
          sectionId: created.sectionId,
          floorPlanId: created.floorPlanId,
        };
      }

      for (const floorId of deletedFloorIds) {
        const deleted = await deleteDbFloor(floorId, { refetchAfter: false });
        if (!deleted) {
          throw new Error("Could not delete floor.");
        }
      }

      for (const tableId of deletedTableIds) {
        await deleteDbTable(tableId, { refetchAfter: false });
      }

      for (const floor of floors) {
        const mapping = floorMappings[floor.id];
        if (!mapping) continue;

        const plan = dbFloorPlans.find((candidate) => candidate.id === mapping.floorPlanId)
          ?? dbFloorPlans.find((candidate) => (candidate.section_id ?? candidate.id) === floor.id);
        const roomForFloor = rooms[floor.id] ?? DEFAULT_ROOM;
        const existingLayout = layoutFromPlan(plan);
        if (mapping.floorPlanId) {
          await updateLayout(mapping.floorPlanId, {
            ...existingLayout,
            walls: wallsByFloor[floor.id] ?? [],
            doors: [entranceToDoor(entranceByFloor[floor.id] ?? { side: "top", pos: roomForFloor.w / 2, width: 50 }, roomForFloor)],
          });
        }

        for (const table of tablesByFloor[floor.id] ?? []) {
          const patch = {
            table_number: table.tableNumber ?? tableDisplayLabel(table),
            label: table.label ?? null,
            capacity: table.cap,
            section_id: mapping.sectionId,
            section: floor.name,
            position_x: table.x,
            position_y: table.y,
            shape: toDbShape(table.shape),
            status: toDbStatus(table.status),
            is_active: true,
          };
          if (table.dbId && isDatabaseUuid(table.dbId)) {
            await updateDbTable(table.dbId, patch);
          } else {
            await createDbTable({
              sectionId: mapping.sectionId,
              label: table.label ?? tableDisplayLabel(table),
              shape: toDbShape(table.shape),
              capacity: table.cap,
              x: table.x,
              y: table.y,
              tableNumber: table.tableNumber ?? tableDisplayLabel(table),
              minParty: 1,
              status: toDbStatus(table.status),
            });
          }
        }
      }

      await refetchFloorPlan({ silent: true });
      setDeletedTableIds([]);
      setDeletedFloorIds([]);
      setEditing(false);
      toast.success("Floor plan saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the floor plan.");
    } finally {
      setSavingLayout(false);
    }
  };

  const setZoomClamped = (z: number, originX?: number, originY?: number) => {
    const newZoom = Math.max(0.4, Math.min(3, z));
    if (originX != null && originY != null) {
      const ratio = newZoom / zoom;
      setPan((p) => ({
        x: originX - (originX - p.x) * ratio,
        y: originY - (originY - p.y) * ratio,
      }));
    }
    setZoom(newZoom);
  };

  /**
   * Reset to 100% zoom and center the room outline in the canvas.
   *
   * Math is in viewBox units. SVG uses `preserveAspectRatio="xMinYMin
   * meet"` so it scales uniformly to fit but doesn't auto-center; we
   * convert canvas pixels to viewBox units via `meetScale` and place the
   * room's center at the canvas center.
   */
  const fitToRoom = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    // Bail without touching state if the SVG hasn't been laid out yet —
    // a follow-up RAF / ResizeObserver call will run once it has, and
    // we don't want a transient 0×0 measurement to stomp the user's
    // current pan back to (0,0).
    if (!rect || rect.width === 0 || rect.height === 0) return;

    const meetScale = Math.min(rect.width / room.w, rect.height / room.h);
    const visW = rect.width / meetScale;
    const visH = rect.height / meetScale;
    setZoom(BASE_ZOOM);
    setPan({
      x: visW / 2 - (room.w / 2) * BASE_ZOOM,
      y: visH / 2 - (room.h / 2) * BASE_ZOOM,
    });
  }, [room.w, room.h]);

  // Stable reference to the latest fitToRoom so the ResizeObserver
  // doesn't get torn down and recreated every render (which was causing
  // it to fire with stale rect measurements and stomp `pan` back to 0,0).
  const fitToRoomRef = useRef(fitToRoom);
  useLayoutEffect(() => {
    fitToRoomRef.current = fitToRoom;
  }, [fitToRoom]);

  // Center on mount and on every floor change. useLayoutEffect runs
  // synchronously after layout so the centered state is applied before
  // the browser paints — no flash of an off-center plan.
  //
  // We call via the ref so we always use the closure that has the new
  // floor's tables/walls — and we re-run on the next frame as a safety
  // net (e.g. if the SVG hasn't been laid out yet on initial mount).
  useLayoutEffect(() => {
    fitToRoomRef.current();
    const id = requestAnimationFrame(() => fitToRoomRef.current());
    return () => cancelAnimationFrame(id);
  }, [activeFloor]);

  // Re-center when the canvas itself resizes (window resize, sidebar
  // toggle). Subscribed once — uses the ref so it always calls the
  // latest fit.
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el || typeof ResizeObserver === "undefined") return;
    const updateCanvasSize = () => {
      const rect = el.getBoundingClientRect();
      setCanvasSize({ width: rect.width, height: rect.height });
    };
    updateCanvasSize();
    const obs = new ResizeObserver(() => {
      updateCanvasSize();
      fitToRoomRef.current();
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ox = e.clientX - rect.left;
    const oy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoomClamped(zoom * factor, ox, oy);
  };

  const onCanvasPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const target = e.target as Element;
    if (target.tagName !== "svg" && !target.classList?.contains("fp-bg")) return;
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
    setIsPanning(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const svgPoint = (e: ReactPointerEvent<SVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    return pt.matrixTransform(ctm.inverse());
  };

  const onTableDragStart = (e: ReactPointerEvent<SVGElement>, t: FloorTable) => {
    if (!canEditLayout) return;
    e.stopPropagation();
    setSel({ kind: "table", id: t.id });
    pushHistory();
    const p = svgPoint(e);
    if (!p) return;
    dragRef.current = { kind: "table", id: t.id, sx: p.x, sy: p.y, ox: t.x, oy: t.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onWallDragStart = (e: ReactPointerEvent<SVGElement>, w: Wall) => {
    if (!canEditLayout) return;
    e.stopPropagation();
    setSel({ kind: "wall", id: w.id });
    pushHistory();
    const p = svgPoint(e);
    if (!p) return;
    dragRef.current = {
      kind: "wall",
      id: w.id,
      sx: p.x,
      sy: p.y,
      ox1: w.x1,
      oy1: w.y1,
      ox2: w.x2,
      oy2: w.y2,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onEndpointDrag = (e: ReactPointerEvent<SVGElement>, w: Wall, end: "start" | "end") => {
    if (!canEditLayout) return;
    e.stopPropagation();
    setSel({ kind: "wall", id: w.id });
    pushHistory();
    const p = svgPoint(e);
    if (!p) return;
    dragRef.current = {
      kind: "wall-pt",
      id: w.id,
      end,
      sx: p.x,
      sy: p.y,
      ox: end === "start" ? w.x1 : w.x2,
      oy: end === "start" ? w.y1 : w.y2,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onEntranceDragStart = (e: ReactPointerEvent<SVGElement>) => {
    if (!canEditLayout) return;
    e.stopPropagation();
    setSel({ kind: "entrance" });
    pushHistory();
    const p = svgPoint(e);
    if (!p) return;
    dragRef.current = { kind: "entrance", sx: p.x, sy: p.y, opos: entrance.pos };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (panRef.current) {
      const dx = e.clientX - panRef.current.sx;
      const dy = e.clientY - panRef.current.sy;
      setPan({ x: panRef.current.ox + dx, y: panRef.current.oy + dy });
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    if (!canEditLayout) {
      dragRef.current = null;
      return;
    }
    const p = svgPoint(e);
    if (!p) return;
    const snap = (v: number) => Math.max(20, Math.round(v / 10) * 10);
    if (d.kind === "table") {
      updateTable(d.id, { x: snap(d.ox + (p.x - d.sx)), y: snap(d.oy + (p.y - d.sy)) }, true);
    } else if (d.kind === "wall") {
      const dx = p.x - d.sx;
      const dy = p.y - d.sy;
      updateWall(
        d.id,
        {
          x1: snap(d.ox1 + dx),
          y1: snap(d.oy1 + dy),
          x2: snap(d.ox2 + dx),
          y2: snap(d.oy2 + dy),
        },
        true,
      );
    } else if (d.kind === "wall-pt") {
      const nx = snap(d.ox + (p.x - d.sx));
      const ny = snap(d.oy + (p.y - d.sy));
      updateWall(d.id, d.end === "start" ? { x1: nx, y1: ny } : { x2: nx, y2: ny }, true);
    } else if (d.kind === "entrance") {
      const isHorizontal = entrance.side === "top" || entrance.side === "bottom";
      const delta = isHorizontal ? p.x - d.sx : p.y - d.sy;
      const max = isHorizontal ? room.w : room.h;
      const half = entrance.width / 2;
      const newPos = Math.max(half + 10, Math.min(max - half - 10, d.opos + delta));
      updateEntrance({ pos: Math.round(newPos / 10) * 10 }, true);
    }
  };
  const onUp = () => {
    dragRef.current = null;
    panRef.current = null;
    setIsPanning(false);
  };

  const searchResults = useMemo(() => {
    if (!query) return [];
    const q = query.toLowerCase().trim();
    return tables.filter(
      (t) => t.id.toLowerCase().includes(q) || (t.guest && t.guest.toLowerCase().includes(q)),
    );
  }, [query, tables]);

  const jumpTo = (t: FloorTable) => {
    setSel({ kind: "table", id: t.id });
    setFocusId(t.id);
    setQuery("");
    const w = t.size;
    const h = t.shape === "round" ? t.size : t.long ? 70 : 80;
    const cx = t.x + w / 2;
    const cy = t.y + h / 2;
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect) {
      setZoom(1.5);
      setPan({ x: rect.width / 2 - cx * 1.5, y: rect.height / 2 - cy * 1.5 });
    }
    setTimeout(() => setFocusId(null), 1800);
  };

  const totals = useMemo(() => {
    const all = Object.values(tablesByFloor).flat();
    const seated = all.filter((t) => t.status === "occupied");
    return {
      total: all.length,
      seated: seated.length,
      reserved: all.filter((t) => t.status === "reserved").length,
      guests: seated.reduce((a, t) => a + (t.party || 0), 0),
    };
  }, [tablesByFloor]);

  const summary = (() => {
    if (totals.seated === 0 && totals.reserved === 0) return "A quiet evening so far.";
    const parts: string[] = [];
    parts.push(`${totals.seated} of ${totals.total} tables seated`);
    if (totals.guests) parts.push(`${totals.guests} guests dining`);
    if (totals.reserved)
      parts.push(`${totals.reserved} reservation${totals.reserved === 1 ? "" : "s"} ahead`);
    return parts.join(" · ") + ".";
  })();

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const serviceDateLabel = dateStr.toUpperCase();

  const viewportRect = (() => {
    if (!canvasSize) return null;
    const visW = canvasSize.width / zoom;
    const visH = canvasSize.height / zoom;
    const visX = -pan.x / zoom;
    const visY = -pan.y / zoom;
    return { x: visX, y: visY, w: visW, h: visH };
  })();

  const density: Density = zoom < 0.55 ? "minimal" : zoom < 0.85 ? "compact" : "full";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      {/* Editorial header */}
      <div
        className="sticky top-0 z-30 bg-background/95 px-10 pb-7 pt-10 backdrop-blur-xl"
        style={{ borderBottom: `1px solid ${BORDER_SOFT}` }}
      >
        <div className="flex items-end justify-between gap-6">
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.24em] text-gold/70">
              {serviceDateLabel} · Table Management
            </div>
            <h1
              className="font-serif text-[40px] leading-[1.05] tracking-tight"
              style={{ letterSpacing: "-0.025em" }}
            >
              Floor Plan
            </h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {editing && canEditLayout && (
              <>
                <button
                  onClick={undo}
                  disabled={past.length === 0}
                  className="flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] text-text-secondary transition-colors hover:text-white disabled:cursor-not-allowed disabled:text-text-muted"
                  style={{ border: `1px solid ${BORDER_SOFT}`, opacity: past.length === 0 ? 0.4 : 1 }}
                  title="Undo (⌘Z)"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 7v6h6" />
                    <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
                  </svg>
                  Undo
                </button>
                <button
                  onClick={redo}
                  disabled={future.length === 0}
                  className="flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] text-text-secondary transition-colors hover:text-white disabled:cursor-not-allowed disabled:text-text-muted"
                  style={{ border: `1px solid ${BORDER_SOFT}`, opacity: future.length === 0 ? 0.4 : 1 }}
                  title="Redo (⌘⇧Z)"
                >
                  Redo
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 7v6h-6" />
                    <path d="M3 17a9 9 0 0 1 15-6.7L21 13" />
                  </svg>
                </button>
                <div className="mx-1 h-6 w-px" style={{ background: BORDER_SOFT }} />
              </>
            )}
            {!editing ? (
              canEditLayout && (
                <button
                  onClick={() => {
                    setEditing(true);
                    setSel(null);
                  }}
                  className="rounded-md px-3.5 py-2 text-[13px] text-text-secondary transition-colors hover:text-white"
                  style={{ border: `1px solid ${BORDER_SOFT}` }}
                >
                  Edit layout
                </button>
              )
            ) : (
              <>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-md px-3.5 py-2 text-[12px] text-text-secondary transition-colors hover:text-white"
                  style={{ border: `1px solid ${BORDER_SOFT}` }}
                >
                  Exit without saving
                </button>
                <button
                  onClick={() => void saveFloorPlanLayout()}
                  disabled={savingLayout}
                  className="rounded-md bg-gold px-4 py-2 text-[13px] font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingLayout ? "Saving..." : "Save layout"}
                </button>
              </>
            )}
          </div>
        </div>

        <p
          className="mt-5 max-w-2xl font-serif text-[17px] text-text-secondary"
          style={{ letterSpacing: "-0.01em", fontStyle: "italic", opacity: 0.85 }}
        >
          {editing ? "Changes are not saved until you click Save layout." : summary}
        </p>
      </div>

      {/* Floor switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-10 pb-4 pt-6">
        <div className="flex flex-wrap items-center gap-1">
          {floors.map((f) => {
            const fc = (tablesByFloor[f.id] || []).length;
            const isActive = activeFloor === f.id;
            const isRenaming = renamingFloorId === f.id;
            const isConfirmingDelete = confirmDeleteFloorId === f.id;
            return (
              <div
                key={f.id}
                className="flex items-center gap-1 rounded-full px-1 py-1 transition-all"
                style={{
                  background: isActive ? "rgba(201,168,76,0.10)" : "transparent",
                  color: isActive ? "var(--gold-light)" : "var(--text-secondary)",
                  border: isActive ? "1px solid rgba(201,168,76,0.30)" : "1px solid transparent",
                }}
              >
                {isRenaming ? (
                  <>
                    <input
                      value={renameFloorValue}
                      autoFocus
                      onChange={(event) => setRenameFloorValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitRenameFloor();
                        if (event.key === "Escape") {
                          setRenamingFloorId(null);
                          setRenameFloorValue("");
                        }
                      }}
                      className="h-8 w-36 rounded-full border border-gold/30 bg-bg-elevated px-3 text-[13px] text-text-primary outline-none focus:border-gold/60"
                    />
                    <button
                      type="button"
                      onClick={commitRenameFloor}
                      className="rounded-full bg-gold px-3 py-1.5 text-[11px] font-medium text-black"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingFloorId(null);
                        setRenameFloorValue("");
                      }}
                      className="rounded-full px-3 py-1.5 text-[11px] text-text-muted transition-colors hover:bg-white/5 hover:text-text-secondary"
                    >
                      Cancel
                    </button>
                  </>
                ) : isConfirmingDelete ? (
                  <>
                    <span className="px-3 text-[12px] text-text-secondary">Delete {f.name}?</span>
                    <button
                      type="button"
                      onClick={() => deleteFloor(f.id)}
                      className="rounded-full border border-danger/30 bg-danger/10 px-3 py-1.5 text-[11px] text-danger transition-colors hover:bg-danger/15"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteFloorId(null)}
                      className="rounded-full px-3 py-1.5 text-[11px] text-text-muted transition-colors hover:bg-white/5 hover:text-text-secondary"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveFloor(f.id);
                        setSel(null);
                        setConfirmDeleteFloorId(null);
                        // Centering is handled by useLayoutEffect[activeFloor]
                        // which uses the up-to-date tables/walls for the new
                        // floor. Calling fitToRoom() directly here would use
                        // the stale closure from this render.
                      }}
                      className="rounded-full px-3 py-1 text-[13px] transition-all"
                    >
                      {f.name}
                      <span
                        className="ml-2 text-[11px] tabular-nums"
                        style={{ color: isActive ? "rgba(229,203,124,0.7)" : "var(--text-muted)" }}
                      >
                        {fc}
                      </span>
                    </button>
                    {editing && canEditLayout && isActive && (
                      <>
                        <button
                          type="button"
                          onClick={() => startRenameFloor(f)}
                          className="rounded-full px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:bg-white/5 hover:text-gold-light"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingFloorId(null);
                            setConfirmDeleteFloorId(f.id);
                          }}
                          className="rounded-full px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {editing && canEditLayout && (
            <button onClick={addFloor} className="ml-1 px-3 py-2 text-[13px] text-gold hover:underline">
              + Add floor
            </button>
          )}
        </div>

        <div className="flex items-center gap-5 text-[11.5px] text-text-muted">
          {(
            [
              ["free", "Open"],
              ["reserved", "Reserved"],
              ["occupied", "Seated"],
              ["cleaning", "Resetting"],
              ["blocked", "Blocked"],
            ] as const
          ).map(([k, l]) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full" style={{ background: TBL_STATUS[k].color }} />
              <span>{l}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Canvas + side rail */}
      <div className="grid gap-6 px-10 pb-10" style={{ gridTemplateColumns: "1fr 340px" }}>
        <div
          className="relative overflow-hidden rounded-xl"
          style={{
            background:
              "radial-gradient(ellipse at 30% 20%, color-mix(in srgb, var(--bg-elevated) 70%, transparent) 0%, var(--background) 62%, color-mix(in srgb, var(--background) 92%, black) 100%)",
            border: `1px solid ${BORDER_SOFT}`,
            height: 660,
            touchAction: "none",
          }}
          onWheel={onWheel}
        >
          <div
            className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-md"
            style={{
              background: "rgba(14,14,15,0.85)",
              backdropFilter: "blur(8px)",
              border: `1px solid ${BORDER_SOFT}`,
              padding: 3,
            }}
          >
            <button
              onClick={() => setZoomClamped(zoom + BASE_ZOOM * 0.1)}
              className="size-7 rounded text-[15px] text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-white"
              title="Zoom in (+10%)"
            >
              +
            </button>
            <button
              onClick={() => setZoomClamped(zoom - BASE_ZOOM * 0.1)}
              className="size-7 rounded text-[15px] text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-white"
              title="Zoom out (−10%)"
            >
              −
            </button>
            <div className="h-4 w-px" style={{ background: BORDER_SOFT }} />
            <button
              onClick={fitToRoom}
              className="h-7 rounded px-2 text-[11px] text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-white"
              title="Fit floor to view"
            >
              Fit
            </button>
            <span className="px-2 text-[11px] tabular-nums text-text-muted">
              {Math.round((zoom / BASE_ZOOM) * 100)}%
            </span>
          </div>
          {(zoom !== BASE_ZOOM || pan.x !== 0 || pan.y !== 0) && (
            <div
              className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-text-muted"
              style={{ background: "rgba(14,14,15,0.7)", border: `1px solid ${BORDER_SOFT}` }}
            >
              Hold ⌘ + scroll to zoom · drag empty space to pan
            </div>
          )}

          <svg
            ref={svgRef}
            viewBox={`0 0 ${room.w} ${room.h}`}
            preserveAspectRatio="xMinYMin meet"
            className="size-full"
            style={{
              display: "block",
              cursor: isPanning ? "grabbing" : "default",
            }}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerDown={onCanvasPointerDown}
            onClick={() => setSel(null)}
          >
            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
              <rect className="fp-bg" x="0" y="0" width={room.w} height={room.h} fill="transparent" />

              {editing && canEditLayout && (
                <>
                  <defs>
                    <pattern id="fp-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path
                        d="M 20 0 L 0 0 0 20"
                        fill="none"
                        stroke="rgba(255,255,255,0.025)"
                        strokeWidth="1"
                      />
                    </pattern>
                  </defs>
                  <rect width={room.w} height={room.h} fill="url(#fp-grid)" />
                </>
              )}

              {(() => {
                const e = entrance;
                const half = e.width / 2;
                const segs: Array<[number, number, number, number]> = [];
                if (e.side === "top") {
                  segs.push([30, 30, e.pos - half, 30]);
                  segs.push([e.pos + half, 30, room.w - 30, 30]);
                } else segs.push([30, 30, room.w - 30, 30]);
                if (e.side === "right") {
                  segs.push([room.w - 30, 30, room.w - 30, e.pos - half]);
                  segs.push([room.w - 30, e.pos + half, room.w - 30, room.h - 30]);
                } else segs.push([room.w - 30, 30, room.w - 30, room.h - 30]);
                if (e.side === "bottom") {
                  segs.push([room.w - 30, room.h - 30, e.pos + half, room.h - 30]);
                  segs.push([e.pos - half, room.h - 30, 30, room.h - 30]);
                } else segs.push([room.w - 30, room.h - 30, 30, room.h - 30]);
                if (e.side === "left") {
                  segs.push([30, room.h - 30, 30, e.pos + half]);
                  segs.push([30, e.pos - half, 30, 30]);
                } else segs.push([30, room.h - 30, 30, 30]);
                return segs.map((s, i) => (
                  <line
                    key={i}
                    x1={s[0]}
                    y1={s[1]}
                    x2={s[2]}
                    y2={s[3]}
                    stroke="rgba(255,255,255,0.06)"
                    strokeWidth="1"
                  />
                ));
              })()}

              <EntranceNode
                entrance={entrance}
                room={room}
                selected={sel?.kind === "entrance"}
                editing={editing && canEditLayout}
                onClick={() => {
                  if (editing && canEditLayout) setSel({ kind: "entrance" });
                }}
                onDragStart={onEntranceDragStart}
              />

              {walls.map((w) => (
                <WallNode
                  key={w.id}
                  w={w}
                  selected={sel?.kind === "wall" && sel.id === w.id}
                  editing={editing && canEditLayout}
                  onClick={(ww) => {
                    if (editing && canEditLayout) setSel({ kind: "wall", id: ww.id });
                  }}
                  onDragStart={onWallDragStart}
                  onEndpointDrag={onEndpointDrag}
                />
              ))}

              {tables.flatMap((table) => {
                const from = tableCenter(table);
                return (table.combinedWith ?? [])
                  .map((combinedId) => tables.find((candidate) => candidate.dbId === combinedId || candidate.id === combinedId))
                  .filter((combined): combined is FloorTable => Boolean(combined))
                  .filter((combined) => table.id < combined.id)
                  .map((combined) => {
                    const to = tableCenter(combined);
                    return (
                      <line
                        key={`${table.id}-${combined.id}`}
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke="rgba(201,168,76,0.55)"
                        strokeDasharray="6 6"
                        strokeLinecap="round"
                        strokeWidth="2"
                      />
                    );
                  });
              })}

              {tables.map((t) => (
                <TableNode
                  key={t.id}
                  t={t}
                  selected={sel?.kind === "table" && sel.id === t.id}
                  focused={focusId === t.id}
                  editing={editing && canEditLayout}
                  density={density}
                  onClick={(tt) => setSel({ kind: "table", id: tt.id })}
                  onDragStart={onTableDragStart}
                />
              ))}
            </g>
          </svg>

          {tables.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <p
                  className="mb-1 font-serif text-[18px] text-text-secondary"
                  style={{ letterSpacing: "-0.015em" }}
                >
                  This floor is empty.
                </p>
                {editing && canEditLayout && (
                  <p className="text-[12px] text-text-muted">Add a table from the panel on the right.</p>
                )}
              </div>
            </div>
          )}

          {(zoom > 1.05 || tables.length > 20) && (
            <MiniMap tables={tables} walls={walls} room={room} viewport={viewportRect} />
          )}
        </div>

        <div className="space-y-4">
          {selTable ? (
            <TableCard
              t={selTable}
              editing={editing && canEditLayout}
              canAdjustSeats={canEditLayout}
              onAction={handleAction}
              onSeatChange={setSeats}
              onDelete={(t) => deleteTable(t.id)}
              onClose={() => setSel(null)}
            />
          ) : selWall && editing && canEditLayout ? (
            <WallCard w={selWall} onDelete={(w) => deleteWall(w.id)} onClose={() => setSel(null)} />
          ) : selEntrance && editing && canEditLayout ? (
            <EntranceCard
              entrance={entrance}
              onChangeSide={(s) =>
                updateEntrance({
                  side: s,
                  pos: s === "top" || s === "bottom" ? room.w / 2 : room.h / 2,
                })
              }
              onChangeWidth={(w) => updateEntrance({ width: Math.max(30, Math.min(180, w)) })}
              onClose={() => setSel(null)}
            />
          ) : editing && canEditLayout ? (
            <EditCard
              onAddTable={addTable}
              onAddWall={addWall}
              onAddFloor={addFloor}
            />
          ) : (
            <IdleCard
              summary={summary}
              query={query}
              onSearch={setQuery}
              onJump={jumpTo}
              results={searchResults}
            />
          )}
        </div>
      </div>
      <FloorReservationDialog
        open={serviceDialog !== null}
        action={serviceDialog?.action ?? null}
        table={serviceDialog?.table ?? null}
        turnTimeMinutes={turnTimeMinutes}
        saving={savingService}
        onClose={() => setServiceDialog(null)}
        onSubmit={handleFloorReservationSubmit}
      />
    </div>
  );
}
