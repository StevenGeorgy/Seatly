import { useMemo, useState } from "react";
import { addDays, format, parse, startOfToday } from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Utensils,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useReservations,
  type ReservationFilters,
  type ReservationRow,
} from "@/hooks/useReservations";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import {
  defaultRestaurantHours,
  parseRestaurantHoursJson,
  parseRestaurantTimeToMinutes,
} from "@/lib/restaurant-hours";
import { useUser } from "@/hooks/useUser";
import { hostActionNeedsManagerApproval } from "@/lib/auth/host-action-permissions";
import {
  reservationDisplayStatus,
  reservationDisplayStatusKey,
  type ReservationDisplayStatus,
} from "@/lib/reservations/displayStatus";
import { matchesReservationSearch } from "@/lib/reservations/search";
import { cn } from "@/lib/utils";
import { formatCompactTimeLabel } from "@/lib/utils/time";

type ViewMode = "day" | "week" | "list";
type QuickFilter = "all" | ReservationDisplayStatus | "modified";

type ReservationBoardRow = {
  id: string;
  time: string;
  dateKey: string;
  dateLabel: string;
  guest: string;
  phone: string;
  party: number;
  table: string;
  duration: string;
  confirmationCode: string | null;
  notes: string;
  status: ReservationDisplayStatus;
  tag?: string;
  tableCount: number;
  tableCapacity: number;
  source?: ReservationRow;
  startsAt: number;
  durationMinutes: number;
  searchValues: string[];
};

type TimelineTableRow = {
  table: string;
  room: string;
  seats: number;
  bookings: ReservationBoardRow[];
};

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h += 1) {
  for (const m of [0, 30]) {
    const ampm = h < 12 ? "AM" : "PM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    TIME_OPTIONS.push(`${h12}:${m === 0 ? "00" : "30"} ${ampm}`);
  }
}

const DEFAULT_DURATION_MINUTES = 90;
const BOARD_SLOT_MINUTES = 30;
const BOARD_FALLBACK_OPEN_MINUTES = 11 * 60;
const BOARD_FALLBACK_CLOSE_MINUTES = 22 * 60;

type BoardWindow = {
  startMin: number;
  endMin: number;
  rangeMin: number;
  times: string[];
};

function buildBoardWindow(openMin: number, closeMin: number): BoardWindow {
  const startMin = openMin;
  const endMin = closeMin <= openMin ? closeMin + 1440 : closeMin;
  const times: string[] = [];
  for (let m = startMin; m <= endMin; m += BOARD_SLOT_MINUTES) {
    const normalized = ((m % 1440) + 1440) % 1440;
    const hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    times.push(formatCompactTimeLabel(`${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`));
  }
  return { startMin, endMin, rangeMin: Math.max(endMin - startMin, BOARD_SLOT_MINUTES), times };
}

function boardWindowForDate(
  hoursJson: Record<string, unknown> | null | undefined,
  date: Date,
): BoardWindow {
  const { regular } = parseRestaurantHoursJson(hoursJson ?? null);
  const fallback = defaultRestaurantHours();
  const dayIndex = (date.getDay() + 6) % 7; // Monday-first
  const day = regular[dayIndex];
  const fallbackDay = fallback[dayIndex];
  const source = day?.open ? day : fallbackDay;
  const openMin = parseRestaurantTimeToMinutes(source.from) ?? BOARD_FALLBACK_OPEN_MINUTES;
  const closeMin = parseRestaurantTimeToMinutes(source.to) ?? BOARD_FALLBACK_CLOSE_MINUTES;
  return buildBoardWindow(openMin, closeMin);
}

type TranslationFn = ReturnType<typeof useTranslation>["t"];

function formatDurationMinutes(minutes: number, t: TranslationFn): string {
  if (minutes < 60) return t("dashboard.reservations.durationMinutes", { count: minutes });
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) return t("dashboard.reservations.durationHours", { count: hours });
  return t("dashboard.reservations.durationHoursMinutes", { hours, minutes: remainder });
}

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const match = /^(\d+):(\d+)\s+(AM|PM)$/i.exec(timeStr);
  if (!match) return { hours: 12, minutes: 0 };
  let h = parseInt(match[1], 10);
  const min = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === "PM" && h !== 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return { hours: h, minutes: min };
}

function isDinerModifiedReservation(row: ReservationRow): boolean {
  return row.internal_notes?.includes("[Diner modified booking") ?? false;
}

function reservationTableLabel(rowData: ReservationRow, t: TranslationFn): string {
  const assignments = rowData.reservation_tables ?? [];
  if (assignments.length > 0) {
    const sorted = [...assignments].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
    const labels = sorted.map((assignment) => {
      const table = assignment.tables;
      return table?.label || table?.table_number || t("dashboard.reservations.tableFallback");
    });
    const section = sorted[0]?.tables?.section;
    return `${labels.length > 1 ? t("dashboard.reservations.tablesLabel") : t("dashboard.reservations.tableLabel")} ${labels.join(" + ")}${section ? ` · ${section}` : ""}`;
  }

  if (rowData.tables) {
    const label = rowData.tables.label || rowData.tables.table_number || rowData.table_id?.slice(0, 8) || t("dashboard.reservations.unassigned");
    return `${t("dashboard.reservations.tableLabel")} ${label}${rowData.tables.section ? ` · ${rowData.tables.section}` : ""}`;
  }

  if (rowData.table_id) return `${t("dashboard.reservations.tableLabel")} ${rowData.table_id.slice(0, 8)}`;

  return t("dashboard.reservations.unassigned");
}

function reservationAssignedTables(rowData: ReservationRow): Array<{ capacity: number }> {
  const assignments = rowData.reservation_tables ?? [];
  if (assignments.length > 0) {
    return assignments.flatMap((assignment) => assignment.tables ? [{ capacity: assignment.tables.capacity }] : []);
  }
  return rowData.tables ? [{ capacity: rowData.tables.capacity }] : [];
}

function adaptReservation(rowData: ReservationRow, t: TranslationFn): ReservationBoardRow {
  const date = new Date(rowData.reserved_at);
  const guest = rowData.guests?.full_name ?? rowData.guest_full_name ?? t("dashboard.reservations.notApplicable");
  const phone = rowData.guest_phone ?? rowData.guests?.phone ?? rowData.guest_email ?? rowData.guests?.email ?? "-";
  const status = reservationDisplayStatus(rowData);
  const durationMinutes = rowData.duration_minutes ?? DEFAULT_DURATION_MINUTES;
  const notes =
    rowData.special_request ||
    rowData.occasion ||
    rowData.dietary_notes ||
    "-";
  const table = reservationTableLabel(rowData, t);
  const assignedTables = reservationAssignedTables(rowData);
  const confirmationCode = rowData.confirmation_code?.trim() || null;

  return {
    id: rowData.id,
    time: formatCompactTimeLabel(date),
    dateKey: format(date, "yyyy-MM-dd"),
    dateLabel: format(date, "EEE, MMM d"),
    guest,
    phone,
    party: rowData.party_size,
    table,
    duration: formatDurationMinutes(durationMinutes, t),
    confirmationCode,
    notes,
    status,
    tag: isDinerModifiedReservation(rowData)
      ? "Modified by diner"
      : assignedTables.length > 1
      ? t("dashboard.reservations.largePartyTag", { count: assignedTables.length })
      : rowData.source === "walk_in" ? "Walk-in" : rowData.deposit_amount ? "Deposit" : undefined,
    tableCount: assignedTables.length,
    tableCapacity: assignedTables.reduce((total, table) => total + table.capacity, 0),
    source: rowData,
    startsAt: date.getHours() * 60 + date.getMinutes(),
    durationMinutes,
    searchValues: [
      guest,
      phone,
      table,
      notes,
      confirmationCode,
      rowData.guest_phone,
      rowData.guest_email,
      rowData.guests?.phone,
      rowData.guests?.email,
    ].filter((value): value is string => Boolean(value)),
  };
}

function statusBadgeLabel(status: ReservationBoardRow["status"], t: TranslationFn): string {
  return t(reservationDisplayStatusKey(status));
}

function blockClasses(status: ReservationBoardRow["status"]): string {
  if (status === "current") return "border-gold/35 bg-gold/20 text-gold";
  if (status === "past") return "border-border/70 bg-bg-elevated/70 text-text-muted";
  if (status === "cancelled") return "border-danger/35 bg-danger/10 text-danger";
  return "border-success/35 bg-success/15 text-success";
}

function tableKey(table: string): string {
  return table.replace(/^Tables?\s+/, "").split(" + ")[0].split(" · ")[0];
}

function buildTimelineRows(rows: ReservationBoardRow[]): TimelineTableRow[] {
  const rowMap = new Map<string, TimelineTableRow>();
  for (const reservation of rows) {
    const table = reservation.table;
    const key = tableKey(table);
    const existing = rowMap.get(key);
    if (existing) {
      existing.bookings.push(reservation);
      continue;
    }
    rowMap.set(key, {
      table: key,
      room: table.includes(" · ") ? table.split(" · ").at(-1) ?? "Floor" : "Floor",
      seats: reservation.tableCapacity || reservation.party,
      bookings: [reservation],
    });
  }
  return Array.from(rowMap.values()).sort((a, b) => a.table.localeCompare(b.table, undefined, { numeric: true }));
}

export default function ReservationsPage() {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ReservationRow | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<ReservationBoardRow | null>(null);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const { selectedRestaurantId, selectedRestaurant } = useRestaurantScope();
  const { rolesAtRestaurant } = useUser();
  const selectedDateObject = useMemo(() => new Date(`${selectedDate}T12:00:00`), [selectedDate]);
  const rangeEndObject = viewMode === "week" ? addDays(selectedDateObject, 6) : selectedDateObject;
  const rangeStart = format(selectedDateObject, "yyyy-MM-dd");
  const rangeEnd = format(rangeEndObject, "yyyy-MM-dd");
  const dateStepDays = viewMode === "week" ? 7 : 1;

  const filters: ReservationFilters = {
    dateFrom: rangeStart,
    dateTo: rangeEnd,
    search: search || undefined,
  };

  const {
    reservations,
    loading,
    createReservation,
    updateStatus,
    requestManagerApproval,
  } = useReservations(filters);
  const [managerEmail, setManagerEmail] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const scopedRoles = selectedRestaurantId ? rolesAtRestaurant(selectedRestaurantId) : [];
  const canManageRiskyActions = scopedRoles.some((role) => role.role === "owner" || role.role === "manager");
  const canCancelDirectly = canManageRiskyActions || !hostActionNeedsManagerApproval("reservation.cancel");

  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [partySize, setPartySize] = useState("2");
  const [reservationDate, setReservationDate] = useState("");
  const [calOpen, setCalOpen] = useState(false);
  const [selectedTime, setSelectedTime] = useState("7:00 PM");
  const [specialRequest, setSpecialRequest] = useState("");
  const [saving, setSaving] = useState(false);

  const boardRows = useMemo(() => {
    const base = reservations.map((reservation) => adaptReservation(reservation, t));
    return base.filter((reservation) => {
      const matchesQuick =
        quickFilter === "all" ||
        reservation.status === quickFilter ||
        (quickFilter === "modified" && reservation.source ? isDinerModifiedReservation(reservation.source) : false);
      const matchesSearch = matchesReservationSearch(search, reservation.searchValues);
      return matchesQuick && matchesSearch;
    });
  }, [quickFilter, reservations, search, t]);

  const allRows = useMemo(() => reservations.map((reservation) => adaptReservation(reservation, t)), [reservations, t]);
  const activeTimelineRows = useMemo(
    () => boardRows.filter((reservation) => reservation.status !== "cancelled"),
    [boardRows],
  );
  const boardWindow = useMemo(
    () => boardWindowForDate(selectedRestaurant?.hours_json ?? null, selectedDateObject),
    [selectedRestaurant?.hours_json, selectedDateObject],
  );
  const bookedTonight = allRows.length;
  const coversExpected = allRows.reduce((total, reservation) => total + reservation.party, 0);
  const currentCount = allRows.filter((reservation) => reservation.status === "current").length;
  const upcomingCount = allRows.filter((reservation) => reservation.status === "upcoming").length;
  const pastCount = allRows.filter((reservation) => reservation.status === "past").length;
  const cancelledCount = allRows.filter((reservation) => reservation.status === "cancelled").length;
  const modifiedCount = allRows.filter(
    (reservation) => reservation.source ? isDinerModifiedReservation(reservation.source) : false,
  ).length;

  const calSelectedDay = useMemo(() => {
    if (!reservationDate) return undefined;
    const d = parse(reservationDate, "yyyy-MM-dd", new Date());
    return Number.isNaN(d.getTime()) ? undefined : d;
  }, [reservationDate]);

  const resetForm = () => {
    setGuestName("");
    setGuestEmail("");
    setGuestPhone("");
    setPartySize("2");
    setReservationDate("");
    setCalOpen(false);
    setSelectedTime("7:00 PM");
    setSpecialRequest("");
  };

  const resetApprovalForm = () => {
    setManagerEmail("");
    setManagerPassword("");
  };

  const handleCreate = async () => {
    if (!guestName.trim()) {
      toast.error("Guest name is required.");
      return;
    }
    if (!reservationDate) {
      toast.error("Please select a date.");
      return;
    }

    const { hours, minutes } = parseTime(selectedTime);
    const [year, month, day] = reservationDate.split("-").map(Number);
    const reservedAt = new Date(year, month - 1, day, hours, minutes, 0, 0);

    setSaving(true);
    try {
      await createReservation({
        guest_name: guestName.trim(),
        guest_email: guestEmail.trim(),
        guest_phone: guestPhone.trim(),
        party_size: Math.max(1, parseInt(partySize, 10) || 1),
        reserved_at: reservedAt.toISOString(),
        special_request: specialRequest.trim(),
      });
      toast.success("Reservation created.");
      setDrawerOpen(false);
      resetForm();
    } catch (error) {
      toast.error("Failed: " + (error instanceof Error ? error.message : "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  const selectedDateLabel =
    viewMode === "week"
      ? `${format(selectedDateObject, "MMM d")} - ${format(rangeEndObject, "MMM d")}`
      : selectedDate === format(new Date(), "yyyy-MM-dd")
      ? `${t("dashboard.reservations.today")} · ${format(selectedDateObject, "MMM d")}`
      : format(selectedDateObject, "EEE · MMM d");
  const serviceLabel =
    viewMode === "week"
      ? `${format(selectedDateObject, "MMMM d")} - ${format(rangeEndObject, "MMMM d")} · Dinner service`
      : `${format(selectedDateObject, "EEEE, MMMM d")} · Dinner service`;
  const bookedLabel = viewMode === "week" ? "Booked this week" : "Booked tonight";
  const coversLabel = viewMode === "week" ? `${coversExpected} covers expected this week` : `${coversExpected} covers expected`;
  const listTitle = viewMode === "week" ? "Week reservations" : viewMode === "list" ? "Reservation list" : "All reservations";

  return (
    <AnimatedPage className="space-y-6">
      <header className="flex flex-col gap-5 border-b border-border/50 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-gold">
            {serviceLabel}
          </p>
          <h1 className="mt-2 font-serif text-5xl leading-none text-white">Reservations</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-bg-surface px-3 text-sm text-text-secondary"
          >
            <CalendarDays className="size-4 text-gold" />
            {format(selectedDateObject, "EEE, MMM d")}
          </button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label={bookedLabel} value={String(bookedTonight)} detail={coversLabel} />
        <MetricCard label="Current bookings" value={String(currentCount)} detail={`${currentCount} active now`} />
        <MetricCard label="Upcoming" value={String(upcomingCount)} detail={`${pastCount} past for this view`} />
      </div>

      <section className="rounded-2xl border border-border bg-bg-surface/80 p-4 shadow-lg shadow-black/10">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex h-9 rounded-lg border border-border bg-bg-elevated p-0.5">
                {(["day", "week", "list"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    className={cn(
                      "rounded-md px-3 text-xs font-medium capitalize transition-colors",
                      viewMode === mode ? "bg-gold text-black" : "text-text-secondary hover:text-white",
                    )}
                  >
                    {t(`dashboard.reservations.${mode}`)}
                  </button>
                ))}
              </div>
              <div className="flex h-9 items-center rounded-lg border border-border bg-bg-elevated p-0.5">
                <button
                  type="button"
                  onClick={() => {
                    const previous = new Date(`${selectedDate}T12:00:00`);
                    previous.setDate(previous.getDate() - dateStepDays);
                    setSelectedDate(format(previous, "yyyy-MM-dd"));
                  }}
                  className="flex size-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
                  aria-label={t("dashboard.reservations.previousDay")}
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="h-8 rounded-md px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-gold/40"
                    >
                      {selectedDateLabel}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="center" className="w-auto border-border bg-bg-elevated p-2 text-text-primary shadow-2xl">
                    <Calendar
                      mode="single"
                      required={false}
                      showOutsideDays={false}
                      selected={selectedDateObject}
                      onSelect={(day) => {
                        if (!day) return;
                        setSelectedDate(format(day, "yyyy-MM-dd"));
                        setDatePickerOpen(false);
                      }}
                      classNames={{
                        day: "group/day relative flex-1 p-0 text-center select-none",
                        day_button: "relative isolate z-10 flex size-9 min-w-9 items-center justify-center rounded-md border-0 leading-none font-normal text-text-secondary hover:bg-gold/10 hover:text-white disabled:pointer-events-none disabled:opacity-30 data-[selected-single=true]:bg-gold data-[selected-single=true]:font-semibold data-[selected-single=true]:text-black",
                        hidden: "invisible pointer-events-none",
                        outside: "invisible pointer-events-none",
                        disabled: "text-text-muted opacity-25",
                        today: "text-white",
                      }}
                      className="rounded-md border-0 bg-transparent"
                    />
                  </PopoverContent>
                </Popover>
                <button
                  type="button"
                  onClick={() => {
                    const next = new Date(`${selectedDate}T12:00:00`);
                    next.setDate(next.getDate() + dateStepDays);
                    setSelectedDate(format(next, "yyyy-MM-dd"));
                  }}
                  className="flex size-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-white/5 hover:text-white"
                  aria-label={t("dashboard.reservations.nextDay")}
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>

            <Button size="sm" className="h-9 rounded-lg gap-1.5 px-4 text-xs xl:ml-auto" onClick={() => setDrawerOpen(true)}>
              <Plus className="size-3.5" />
              {t("dashboard.reservations.addReservation")}
            </Button>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(280px,1fr)_auto] xl:items-center">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
              <Input
                placeholder={t("dashboard.reservations.searchDetailedPlaceholder")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-9 rounded-lg border-border bg-bg-elevated pl-9 text-xs"
              />
            </div>
          </div>

          <div className="border-t border-border/60 pt-3">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
              {t("dashboard.reservations.status")}
            </p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: "all" as QuickFilter, label: t("dashboard.reservations.all"), count: allRows.length },
                  { id: "upcoming" as QuickFilter, label: t("dashboard.reservations.upcoming"), count: upcomingCount },
                  { id: "current" as QuickFilter, label: t("dashboard.reservations.current"), count: currentCount },
                  { id: "past" as QuickFilter, label: t("dashboard.reservations.past"), count: pastCount },
                  { id: "cancelled" as QuickFilter, label: t("dashboard.reservations.cancelled"), count: cancelledCount },
                  { id: "modified" as QuickFilter, label: t("dashboard.reservations.modified"), count: modifiedCount },
                ]
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setQuickFilter(item.id)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    quickFilter === item.id
                      ? "border-gold bg-gold text-black"
                      : "border-border bg-bg-surface text-text-secondary hover:text-white",
                  )}
                >
                  {item.label} · {item.count}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {viewMode === "day" ? (
        <FloorTimeline
          rows={activeTimelineRows}
          loading={loading}
          window={boardWindow}
          onOpen={setDetailsTarget}
        />
      ) : null}
      <ReservationsTable
        rows={boardRows}
        loading={loading}
        title={listTitle}
        groupByDate={viewMode === "week"}
        onOpen={setDetailsTarget}
        onCancel={(rowData) => {
          if (!rowData.source) return;
          if (!canCancelDirectly) {
            toast.info("Manager approval required to cancel this reservation.");
          }
          setCancelTarget(rowData.source);
        }}
      />

      <ReservationDetailsDialog
        reservation={detailsTarget}
        onOpenChange={(open) => {
          if (!open) setDetailsTarget(null);
        }}
      />

      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCancelTarget(null);
            resetApprovalForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel reservation</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-text-secondary">
            <p>
              Canceling a reservation is a risky action. Managers and owners can approve it immediately;
              host cancellations are audited with manager approval.
            </p>
            {cancelTarget ? (
              <p className="rounded-lg border border-border bg-bg-surface p-3 text-text-primary">
                {cancelTarget.guests?.full_name ?? cancelTarget.guest_full_name ?? "Guest"} · Party of{" "}
                {cancelTarget.party_size}
              </p>
            ) : null}
            {!canCancelDirectly ? (
              <div className="grid gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
                <p className="text-xs text-warning">
                  Manager approval required. The manager signs only this action and does not switch the host account.
                </p>
                <div className="grid gap-2">
                  <Label>Manager email</Label>
                  <Input
                    type="email"
                    value={managerEmail}
                    onChange={(event) => setManagerEmail(event.target.value)}
                    placeholder="manager@example.com"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Manager password</Label>
                  <Input
                    type="password"
                    value={managerPassword}
                    onChange={(event) => setManagerPassword(event.target.value)}
                    placeholder="Password"
                  />
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              Keep reservation
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!cancelTarget || !selectedRestaurantId) return;
                try {
                  const approvalToken = canCancelDirectly
                    ? undefined
                    : await requestManagerApproval({
                        restaurantId: selectedRestaurantId,
                        action: "reservation.cancel",
                        managerEmail,
                        managerPassword,
                      });
                  await updateStatus(cancelTarget.id, "cancelled", approvalToken ?? undefined);
                  toast.success("Reservation cancelled.");
                  setCancelTarget(null);
                  resetApprovalForm();
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not cancel reservation.");
                }
              }}
            >
              Cancel reservation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={drawerOpen}
        onOpenChange={(open) => {
          setDrawerOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add reservation</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>Guest name *</Label>
                <Input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Jane Smith" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Party size</Label>
                <Input type="number" min="1" max="99" value={partySize} onChange={(event) => setPartySize(event.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Email</Label>
                <Input type="email" value={guestEmail} onChange={(event) => setGuestEmail(event.target.value)} placeholder="jane@example.com" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Phone</Label>
                <Input type="tel" value={guestPhone} onChange={(event) => setGuestPhone(event.target.value)} placeholder="+1 555 000 0000" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>Date *</Label>
                <Popover open={calOpen} onOpenChange={setCalOpen} modal={false}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="relative flex h-10 w-full cursor-pointer items-center rounded-lg border border-border bg-bg-elevated pl-9 pr-2 text-left outline-none transition-colors hover:border-gold/30 focus-visible:ring-2 focus-visible:ring-gold/40"
                    >
                      <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
                      <span className={cn("truncate text-xs leading-none", reservationDate ? "text-text-primary" : "text-text-muted")}>
                        {reservationDate
                          ? new Date(`${reservationDate}T12:00:00`).toLocaleDateString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "Select date"}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto border-border bg-bg-elevated p-0 text-text-primary shadow-2xl">
                    <Calendar
                      mode="single"
                      required={false}
                      selected={calSelectedDay}
                      onSelect={(date) => {
                        setReservationDate(date ? format(date, "yyyy-MM-dd") : "");
                        if (date) setCalOpen(false);
                      }}
                      disabled={{ before: startOfToday() }}
                      className="rounded-md border-0 bg-transparent [--cell-size:--spacing(8)]"
                    />
                    {reservationDate ? (
                      <div className="border-t border-border p-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-full text-text-secondary hover:bg-bg-surface hover:text-text-primary"
                          onClick={() => {
                            setReservationDate("");
                            setCalOpen(false);
                          }}
                        >
                          Clear date
                        </Button>
                      </div>
                    ) : null}
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Time</Label>
                <select
                  value={selectedTime}
                  onChange={(event) => setSelectedTime(event.target.value)}
                  className="h-10 w-full appearance-none rounded-lg border border-border bg-bg-elevated px-3 pr-7 text-xs text-text-primary outline-none focus:border-gold/40"
                >
                  {TIME_OPTIONS.map((time) => (
                    <option key={time} value={time}>{formatCompactTimeLabel(time)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Special request</Label>
              <Input value={specialRequest} onChange={(event) => setSpecialRequest(event.target.value)} placeholder="Dietary requirements, occasion..." />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDrawerOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button disabled={saving} onClick={() => void handleCreate()}>
              {saving ? "Saving..." : "Create reservation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <section className="min-h-[76px] rounded-xl border border-border/70 bg-bg-surface px-4 py-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-muted">{label}</p>
      <p className="mt-1 font-serif text-3xl leading-none text-gold">{value}</p>
      <p className="mt-1 text-[11px] text-text-muted">{detail}</p>
    </section>
  );
}

function ReservationDetailsDialog({
  reservation,
  onOpenChange,
}: {
  reservation: ReservationBoardRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const source = reservation?.source;
  const contact = [
    source?.guest_phone,
    source?.guests?.phone,
    source?.guest_email,
    source?.guests?.email,
  ].filter(Boolean).join(" · ");

  return (
    <Dialog open={reservation !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{reservation?.guest ?? t("dashboard.reservations.guest")}</DialogTitle>
        </DialogHeader>
        {reservation ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-gold/25 bg-gold/10 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold/80">
                {t("dashboard.reservations.confirmationCode")}
              </p>
              <p className="mt-2 font-mono text-2xl font-semibold uppercase tracking-[0.08em] text-gold">
                {reservation.confirmationCode ?? t("dashboard.reservations.confirmationCodeMissing")}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <DetailItem label={t("dashboard.reservations.time")} value={`${reservation.dateLabel} · ${reservation.time}`} />
              <DetailItem label={t("dashboard.reservations.party")} value={String(reservation.party)} />
              <DetailItem label={t("dashboard.reservations.tableLabel")} value={reservation.table} />
              <DetailItem label={t("dashboard.reservations.duration")} value={reservation.duration} />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-surface px-3 py-2">
              <span className="text-xs text-text-muted">{t("dashboard.reservations.status")}</span>
              <StatusBadge status={reservation.status} label={statusBadgeLabel(reservation.status, t)} />
            </div>
            <DetailItem label={t("dashboard.reservations.guest")} value={contact || reservation.phone} />
            <DetailItem label={t("dashboard.reservations.specialRequest")} value={reservation.notes} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg-surface px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">{label}</p>
      <p className="mt-1 break-words text-sm text-text-primary">{value || "-"}</p>
    </div>
  );
}

function FloorTimeline({
  rows,
  loading,
  window: boardWindow,
  onOpen,
}: {
  rows: ReservationBoardRow[];
  loading: boolean;
  window: BoardWindow;
  onOpen: (row: ReservationBoardRow) => void;
}) {
  const byTable = buildTimelineRows(rows);
  const { startMin, rangeMin, times } = boardWindow;
  const minWidthPx = 110 + times.length * 72;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="font-serif text-xl text-white">Floor timeline</h2>
          <p className="mt-1 text-xs text-text-muted">Drag a booking to reassign - click to open guest</p>
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] text-text-muted">
          <Legend color="bg-success" label="Upcoming" />
          <Legend color="bg-gold" label="Current" />
          <Legend color="bg-bg-elevated" label="Past" />
          <Legend color="bg-bg-elevated" label="Available" />
        </div>
      </div>

      {loading ? (
        <div className="p-5">
          <Skeleton className="h-[420px] rounded-xl" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyReservationsState />
      ) : (
        <div className="overflow-x-auto">
          <div style={{ minWidth: `${minWidthPx}px` }}>
            <div className="grid grid-cols-[110px_1fr] border-b border-border/60">
              <div className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                Table
              </div>
              <div className="grid" style={{ gridTemplateColumns: `repeat(${times.length}, minmax(72px, 1fr))` }}>
                {times.map((time, idx) => (
                  <div key={`${time}-${idx}`} className="border-l border-border/50 px-2 py-3 font-mono text-[10px] text-text-muted">
                    {time}
                  </div>
                ))}
              </div>
            </div>
            {byTable.map((table) => (
              <div key={table.table} className="grid min-h-[72px] grid-cols-[110px_1fr] border-b border-border/50 last:border-b-0">
                <div className="border-r border-border/50 px-4 py-4">
                  <p className="font-mono text-sm font-semibold text-white">{table.table}</p>
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    {table.room} · {table.seats}
                  </p>
                </div>
                <div
                  className="relative grid"
                  style={{ gridTemplateColumns: `repeat(${times.length}, minmax(72px, 1fr))` }}
                >
                  {times.map((time, idx) => (
                    <div key={`${time}-${idx}`} className="border-l border-border/30" />
                  ))}
                  {table.bookings.map((booking) => {
                    const effectiveStart = booking.startsAt < startMin ? booking.startsAt + 1440 : booking.startsAt;
                    const left = Math.max(0, Math.min(100, ((effectiveStart - startMin) / rangeMin) * 100));
                    const width = Math.max(3, (booking.durationMinutes / rangeMin) * 100);
                    return (
                      <button
                        key={booking.id}
                        type="button"
                        onClick={() => onOpen(booking)}
                        className={cn(
                          "absolute top-4 h-9 overflow-hidden rounded-lg border px-3 text-left text-xs font-semibold shadow-lg shadow-black/20 transition-all duration-150 hover:-translate-y-0.5 hover:border-gold/70 hover:shadow-gold/10 focus-visible:-translate-y-0.5 focus-visible:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/45",
                          blockClasses(booking.status),
                        )}
                        style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                      >
                        <span className="block truncate">
                          {booking.guest.split(",")[0]} · {booking.time}
                        </span>
                        {booking.confirmationCode ? (
                          <span className="block truncate font-mono text-[9px] uppercase opacity-80">
                            {booking.confirmationCode}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2 rounded-sm", color)} />
      {label}
    </span>
  );
}

function EmptyReservationsState() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-full border border-border bg-bg-elevated text-gold">
        <Utensils className="size-5" />
      </div>
      <div>
        <h3 className="font-serif text-2xl text-white">{t("dashboard.reservations.emptyTitle")}</h3>
        <p className="mt-2 max-w-md text-sm text-text-muted">
          {t("dashboard.reservations.emptyDesc")}
        </p>
      </div>
    </div>
  );
}

function ReservationsTable({
  rows,
  loading,
  title,
  groupByDate = false,
  onOpen,
  onCancel,
}: {
  rows: ReservationBoardRow[];
  loading: boolean;
  title: string;
  groupByDate?: boolean;
  onOpen: (row: ReservationBoardRow) => void;
  onCancel: (row: ReservationBoardRow) => void;
}) {
  const { t } = useTranslation();
  const groupedRows = useMemo(() => {
    if (!groupByDate) return [{ key: "all", label: null as string | null, rows }];
    const groups = new Map<string, { label: string; rows: ReservationBoardRow[] }>();
    rows.forEach((row) => {
      const group = groups.get(row.dateKey) ?? { label: row.dateLabel, rows: [] };
      group.rows.push(row);
      groups.set(row.dateKey, group);
    });
    return Array.from(groups.entries()).map(([key, group]) => ({ key, label: group.label, rows: group.rows }));
  }, [groupByDate, rows]);

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="font-serif text-xl text-white">{title} · {rows.length}</h2>
          <p className="mt-1 text-xs text-text-muted">Sorted by reservation time</p>
        </div>
        <p className="text-xs text-text-muted">Sort: <span className="text-gold">Time</span> · Party size · Status</p>
      </div>
      {loading ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyReservationsState />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left">
            <thead>
              <tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                <th className="px-5 py-4 font-medium">Time</th>
                <th className="px-5 py-4 font-medium">Guest</th>
                <th className="px-5 py-4 font-medium">Party</th>
                <th className="px-5 py-4 font-medium">Table</th>
                <th className="px-5 py-4 font-medium">{t("dashboard.reservations.duration")}</th>
                <th className="px-5 py-4 font-medium">Status</th>
                <th className="px-5 py-4 font-medium">Notes</th>
                <th className="px-5 py-4 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              <AnimatePresence initial={false}>
                {groupedRows.flatMap((group, groupIndex) => [
                  ...(group.label
                    ? [
                        <tr key={`${group.key}-label`} className="bg-bg-elevated/40">
                          <td colSpan={8} className="px-5 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-gold">
                            {group.label} · {group.rows.length}
                          </td>
                        </tr>,
                      ]
                    : []),
                  ...group.rows.map((reservation, index) => (
                    <motion.tr
                      key={reservation.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18, delay: (groupIndex + index) * 0.01 }}
                      className="text-sm"
                    >
                      <td className="px-5 py-4 font-mono text-white">{reservation.time}</td>
                      <td className="px-5 py-4">
                        <button
                          type="button"
                          onClick={() => onOpen(reservation)}
                          className="block max-w-56 truncate text-left font-medium text-white transition-colors hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
                        >
                          {reservation.guest}
                        </button>
                        <p className="mt-0.5 text-xs text-text-muted">{reservation.phone}</p>
                        {reservation.confirmationCode ? (
                          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-gold/80">
                            {reservation.confirmationCode}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-5 py-4 text-text-secondary">
                        <div className="flex flex-col gap-1">
                          <span>{reservation.party}</span>
                          {reservation.tableCount > 1 ? (
                            <span className="w-fit rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                              {t("dashboard.reservations.largePartyTag", { count: reservation.tableCount })}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-text-secondary">
                        <div className="flex flex-col gap-1">
                          <span>{reservation.table}</span>
                          {reservation.tableCapacity > 0 ? (
                            <span className="text-[11px] text-text-muted">
                              {t("dashboard.reservations.tableCapacity", { count: reservation.tableCapacity })}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-text-secondary">{reservation.duration}</td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col items-start gap-1.5">
                          <StatusBadge
                            status={reservation.status}
                            label={statusBadgeLabel(reservation.status, t)}
                          />
                          {reservation.source && isDinerModifiedReservation(reservation.source) ? (
                            <span className="rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                              Modified by diner
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-text-muted">{reservation.notes}</td>
                      <td className="px-5 py-4 text-right">
                        {reservation.status === "upcoming" || reservation.status === "current" ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 px-3 text-xs"
                              onClick={() => onCancel(reservation)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Open reservation"
                            onClick={() => onOpen(reservation)}
                          >
                            <ChevronRight className="size-4" />
                          </Button>
                        )}
                      </td>
                    </motion.tr>
                  )),
                ])}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
