import { useMemo, useState } from "react";
import { format, parse, startOfToday } from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Plus,
  Search,
  Utensils,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { SeatReservationDialog } from "@/components/dashboard/SeatReservationDialog";
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
import { useUser } from "@/hooks/useUser";
import { hostActionNeedsManagerApproval } from "@/lib/auth/host-action-permissions";
import { cn } from "@/lib/utils";
import { formatCompactTimeLabel } from "@/lib/utils/time";

type ViewMode = "day" | "week" | "list";
type QuickFilter = "all" | "confirmed" | "seated" | "at_risk" | "waitlist" | "pending";

type ReservationBoardRow = {
  id: string;
  time: string;
  guest: string;
  phone: string;
  party: number;
  table: string;
  duration: string;
  notes: string;
  status: QuickFilter | "completed";
  tag?: string;
  source?: ReservationRow;
  startsAt: number;
  durationMinutes: number;
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

const BOARD_TIMES = ["5:30pm", "6pm", "6:30pm", "7pm", "7:30pm", "8pm", "8:30pm", "9pm", "10pm", "11pm", "12am", "1am", "2am"];
const BOARD_START_MINUTES = 17 * 60 + 30;
const BOARD_END_MINUTES = 26 * 60;
const BOARD_RANGE_MINUTES = BOARD_END_MINUTES - BOARD_START_MINUTES;
const DEFAULT_DURATION_MINUTES = 90;

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

function timeToBoardMinutes(timeStr: string): number {
  const { hours, minutes } = parseTime(timeStr);
  const normalizedHour = hours < 5 ? hours + 24 : hours;
  return normalizedHour * 60 + minutes;
}

function normalizeStatus(row: ReservationRow): ReservationBoardRow["status"] {
  if ((row.no_show_risk_score ?? 0) >= 60) return "at_risk";
  if (row.status === "waiting" || row.status === "waitlist") return "waitlist";
  if (row.status === "seated") return "seated";
  if (row.status === "pending") return "pending";
  if (row.status === "completed") return "completed";
  return "confirmed";
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

  return normalizeStatus(rowData) === "waitlist" ? t("dashboard.reservations.waitlist") : t("dashboard.reservations.unassigned");
}

function adaptReservation(rowData: ReservationRow, t: TranslationFn): ReservationBoardRow {
  const date = new Date(rowData.reserved_at);
  const guest = rowData.is_guest_checkout
    ? t("dashboard.reservations.notApplicable")
    : rowData.guests?.full_name ?? rowData.guest_full_name ?? t("dashboard.reservations.notApplicable");
  const phone = rowData.guest_phone ?? rowData.guests?.phone ?? rowData.guest_email ?? rowData.guests?.email ?? "-";
  const status = normalizeStatus(rowData);
  const durationMinutes = rowData.duration_minutes ?? DEFAULT_DURATION_MINUTES;
  const notes =
    rowData.special_request ||
    rowData.occasion ||
    rowData.dietary_notes ||
    ((rowData.no_show_risk_score ?? 0) >= 60 ? "Awaiting deposit · 24h hold" : "-");
  const table = reservationTableLabel(rowData, t);

  return {
    id: rowData.id,
    time: formatCompactTimeLabel(date),
    guest,
    phone,
    party: rowData.party_size,
    table,
    duration: formatDurationMinutes(durationMinutes, t),
    notes,
    status,
    tag: rowData.source === "walk_in" ? "Walk-in" : rowData.deposit_amount ? "Deposit" : undefined,
    source: rowData,
    startsAt: timeToBoardMinutes(format(date, "h:mm a")),
    durationMinutes,
  };
}

function statusBadgeStatus(status: ReservationBoardRow["status"]): string {
  if (status === "at_risk") return "pending";
  if (status === "waitlist") return "waiting";
  return status;
}

function blockClasses(status: ReservationBoardRow["status"]): string {
  if (status === "at_risk") return "border-warning/35 bg-warning/20 text-warning";
  if (status === "seated") return "border-gold/35 bg-gold/20 text-gold";
  if (status === "waitlist") return "border-text-muted/30 bg-text-muted/10 text-text-secondary";
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
      seats: reservation.party,
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
  const [seatTarget, setSeatTarget] = useState<ReservationRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ReservationRow | null>(null);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const { selectedRestaurantId } = useRestaurantScope();
  const { rolesAtRestaurant } = useUser();

  const filters = useMemo(
    (): ReservationFilters => ({
      date: selectedDate,
      search: search || undefined,
    }),
    [search, selectedDate],
  );

  const {
    reservations,
    loading,
    seatReservation,
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
    const q = search.trim().toLowerCase();
    return base.filter((reservation) => {
      const matchesQuick =
        quickFilter === "all" ||
        reservation.status === quickFilter ||
        (quickFilter === "confirmed" && reservation.status === "completed");
      const matchesSearch =
        !q ||
        reservation.guest.toLowerCase().includes(q) ||
        reservation.phone.toLowerCase().includes(q) ||
        reservation.table.toLowerCase().includes(q);
      return matchesQuick && matchesSearch;
    });
  }, [quickFilter, reservations, search, t]);

  const allRows = useMemo(() => reservations.map((reservation) => adaptReservation(reservation, t)), [reservations, t]);
  const bookedTonight = allRows.length;
  const coversExpected = allRows.reduce((total, reservation) => total + reservation.party, 0);
  const seatedCount = allRows.filter((reservation) => reservation.status === "seated").length;
  const upcomingCount = allRows.filter((reservation) => reservation.status === "confirmed").length;
  const atRiskCount = allRows.filter((reservation) => reservation.status === "at_risk").length;
  const waitlistCount = allRows.filter((reservation) => reservation.status === "waitlist").length;

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

  const selectedDateObject = new Date(`${selectedDate}T12:00:00`);
  const selectedDateLabel =
    selectedDate === format(new Date(), "yyyy-MM-dd")
      ? `${t("dashboard.reservations.today")} · ${format(selectedDateObject, "MMM d")}`
      : format(selectedDateObject, "EEE · MMM d");

  return (
    <AnimatedPage className="space-y-6">
      <header className="flex flex-col gap-5 border-b border-border/50 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-gold">
            {format(selectedDateObject, "EEEE, MMMM d")} · Dinner service
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Booked tonight" value={String(bookedTonight)} detail={`${coversExpected} covers expected`} />
        <MetricCard label="Currently seated" value={String(seatedCount)} detail={`${seatedCount} finishing entrees`} />
        <MetricCard label="Upcoming" value={String(upcomingCount)} detail="Next: 7pm · Tremblay" />
        <MetricCard label="At risk" value={String(atRiskCount)} detail="Awaiting deposit" />
        <MetricCard label="Waitlist" value={String(waitlistCount)} detail="Quoted 12 min" />
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
                    previous.setDate(previous.getDate() - 1);
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
                    next.setDate(next.getDate() + 1);
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

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="h-9 rounded-lg gap-1.5 px-3 text-xs">
                <Filter className="size-3.5" />
                {t("dashboard.reservations.allShifts")}
              </Button>
              <Button variant="outline" size="sm" className="h-9 rounded-lg gap-1.5 px-3 text-xs">
                <Download className="size-3.5" />
                {t("dashboard.reservations.export")}
              </Button>
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
                  { id: "confirmed" as QuickFilter, label: t("dashboard.reservations.confirmed"), count: allRows.filter((item) => item.status === "confirmed").length },
                  { id: "seated" as QuickFilter, label: t("dashboard.reservations.seated"), count: seatedCount },
                  { id: "at_risk" as QuickFilter, label: t("dashboard.reservations.atRisk"), count: atRiskCount },
                  { id: "waitlist" as QuickFilter, label: t("dashboard.reservations.waitlist"), count: waitlistCount },
                  { id: "pending" as QuickFilter, label: t("dashboard.reservations.pending"), count: allRows.filter((item) => item.status === "pending").length },
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

      <FloorTimeline rows={boardRows} loading={loading} />
      <ReservationsTable
        rows={boardRows}
        loading={loading}
        onSeat={(rowData) => {
          if (rowData.source) setSeatTarget(rowData.source);
        }}
        onNotify={() => toast.info("Guest notification queued.")}
        onCall={() => toast.info("Call task created.")}
        onCancel={(rowData) => {
          if (!rowData.source) return;
          if (!canCancelDirectly) {
            toast.info("Manager approval required to cancel this reservation.");
          }
          setCancelTarget(rowData.source);
        }}
      />

      <SeatReservationDialog
        open={seatTarget !== null}
        onOpenChange={(open) => {
          if (!open) setSeatTarget(null);
        }}
        reservation={seatTarget}
        onSeat={async (tableId) => {
          if (!seatTarget) return;
          await seatReservation(seatTarget.id, tableId, seatTarget.party_size);
          toast.success("Guest seated.");
          setSeatTarget(null);
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

function FloorTimeline({ rows, loading }: { rows: ReservationBoardRow[]; loading: boolean }) {
  const byTable = buildTimelineRows(rows);

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="font-serif text-xl text-white">Floor timeline</h2>
          <p className="mt-1 text-xs text-text-muted">Drag a booking to reassign - click to open guest</p>
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] text-text-muted">
          <Legend color="bg-success" label="Confirmed" />
          <Legend color="bg-gold" label="Seated" />
          <Legend color="bg-warning" label="At risk" />
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
          <div className="min-w-[1120px]">
            <div className="grid grid-cols-[110px_1fr] border-b border-border/60">
              <div className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                Table
              </div>
              <div className="grid" style={{ gridTemplateColumns: `repeat(${BOARD_TIMES.length}, minmax(72px, 1fr))` }}>
                {BOARD_TIMES.map((time) => (
                  <div key={time} className="border-l border-border/50 px-2 py-3 font-mono text-[10px] text-text-muted">
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
                  style={{ gridTemplateColumns: `repeat(${BOARD_TIMES.length}, minmax(72px, 1fr))` }}
                >
                  {BOARD_TIMES.map((time) => (
                    <div key={time} className="border-l border-border/30" />
                  ))}
                  {table.bookings.map((booking) => {
                    const left = Math.max(0, ((booking.startsAt - BOARD_START_MINUTES) / BOARD_RANGE_MINUTES) * 100);
                    const width = Math.max(7, (booking.durationMinutes / BOARD_RANGE_MINUTES) * 100);
                    return (
                      <button
                        key={booking.id}
                        type="button"
                        className={cn(
                          "absolute top-4 h-9 overflow-hidden rounded-lg border px-3 text-left text-xs font-semibold shadow-lg shadow-black/20",
                          blockClasses(booking.status),
                        )}
                        style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                      >
                        <span className="truncate">
                          {booking.guest.split(",")[0]} · {booking.time}
                        </span>
                        {booking.tag ? (
                          <span className="float-right ml-2 font-mono text-[9px] uppercase opacity-80">
                            {booking.tag}
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
  onSeat,
  onNotify,
  onCall,
  onCancel,
}: {
  rows: ReservationBoardRow[];
  loading: boolean;
  onSeat: (row: ReservationBoardRow) => void;
  onNotify: (row: ReservationBoardRow) => void;
  onCall: (row: ReservationBoardRow) => void;
  onCancel: (row: ReservationBoardRow) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="font-serif text-xl text-white">All reservations · {rows.length}</h2>
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
                {rows.map((reservation, index) => (
                  <motion.tr
                    key={reservation.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18, delay: index * 0.01 }}
                    className="text-sm"
                  >
                    <td className="px-5 py-4 font-mono text-white">{reservation.time}</td>
                    <td className="px-5 py-4">
                      <p className="font-medium text-white">{reservation.guest}</p>
                      <p className="mt-0.5 text-xs text-text-muted">{reservation.phone}</p>
                    </td>
                    <td className="px-5 py-4 text-text-secondary">{reservation.party}</td>
                    <td className="px-5 py-4 text-text-secondary">{reservation.table}</td>
                    <td className="px-5 py-4 text-text-secondary">{reservation.duration}</td>
                    <td className="px-5 py-4">
                      <StatusBadge
                        status={statusBadgeStatus(reservation.status)}
                        label={reservation.status.replace("_", " ")}
                      />
                    </td>
                    <td className="px-5 py-4 text-text-muted">{reservation.notes}</td>
                    <td className="px-5 py-4 text-right">
                      {reservation.status === "confirmed" || reservation.status === "pending" ? (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" className="h-8 px-3 text-xs" onClick={() => onSeat(reservation)}>
                            Seat
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-3 text-xs"
                            onClick={() => onCancel(reservation)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : reservation.status === "waitlist" ? (
                        <Button size="sm" className="h-8 px-3 text-xs" onClick={() => onNotify(reservation)}>
                          Notify
                        </Button>
                      ) : reservation.status === "at_risk" ? (
                        <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => onCall(reservation)}>
                          Call
                        </Button>
                      ) : (
                        <Button size="icon-sm" variant="ghost" aria-label="Open reservation">
                          <ChevronRight className="size-4" />
                        </Button>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
