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
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";

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
import { cn } from "@/lib/utils";

type ViewMode = "day" | "week" | "list";
type QuickFilter = "all" | "confirmed" | "seated" | "at_risk" | "waitlist" | "pending";

type ReservationBoardRow = {
  id: string;
  time: string;
  guest: string;
  phone: string;
  party: number;
  table: string;
  notes: string;
  status: QuickFilter | "completed";
  tag?: string;
  source?: ReservationRow;
  startsAt: number;
  durationMinutes: number;
};

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h += 1) {
  for (const m of [0, 30]) {
    const ampm = h < 12 ? "AM" : "PM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    TIME_OPTIONS.push(`${h12}:${m === 0 ? "00" : "30"} ${ampm}`);
  }
}

const BOARD_TIMES = ["5:30p", "6:00p", "6:30p", "7:00p", "7:30p", "8:00p", "8:30p", "9:00p", "10:00p", "11:00p", "12:00a", "1:00a", "2:00a"];
const BOARD_START_MINUTES = 17 * 60 + 30;
const BOARD_END_MINUTES = 26 * 60;
const BOARD_RANGE_MINUTES = BOARD_END_MINUTES - BOARD_START_MINUTES;

const TABLE_ROWS = [
  { table: "T01", room: "Patio", seats: 2 },
  { table: "T03", room: "Main", seats: 4 },
  { table: "T05", room: "Main", seats: 2 },
  { table: "T06", room: "Main", seats: 8 },
  { table: "T07", room: "Bar", seats: 2 },
  { table: "T12", room: "Patio", seats: 4 },
  { table: "T18", room: "Banquette", seats: 6 },
  { table: "T20", room: "Patio", seats: 6 },
  { table: "T09", room: "Main", seats: 4 },
];

const DEMO_ROWS: ReservationBoardRow[] = [
  row("demo-anand", "5:30 PM", "Anand, R.", "1416 555-0119", 2, "T07 · Bar", "Birthday · Cake brought", "completed"),
  row("demo-chen", "6:00 PM", "Chen, M.", "1416 555-0144", 4, "T03 · Main", "Loire wines · quiet table", "seated", "VIP"),
  row("demo-walkin", "6:15 PM", "Walk-in", "-", 2, "T07 · Bar", "Limit 90 min", "seated", "Walk-in"),
  row("demo-park-j", "6:30 PM", "Park, J.", "1418 555-0177", 5, "T06 · Main", "Anniversary · Champagne pour", "seated", "Returning"),
  row("demo-tremblay", "7:00 PM", "Tremblay, L.", "1418 555-0233", 4, "T03 · Main", "Pre-ordered tasting", "confirmed"),
  row("demo-kapoor", "7:15 PM", "Kapoor, S.", "1410 555-0124", 2, "T01 · Patio", "Morel allergy (high)", "confirmed", "Loyalty"),
  row("demo-singh", "7:30 PM", "Singh, A.", "1410 555-0208", 6, "T18 · Banquette", "Awaiting deposit · 24h hold", "at_risk", "Large party"),
  row("demo-lefebvre", "7:45 PM", "Lefebvre, P.", "1418 555-0144", 4, "T12 · Patio", "Stroller · kid-friendly", "confirmed"),
  row("demo-hassan", "8:00 PM", "Hassan, M.", "1416 555-0109", 3, "Waitlist", "Quoted 12 min", "waitlist", "Walk-in"),
  row("demo-wong", "8:15 PM", "Wong, K.", "1416 555-0451", 2, "T05 · Main", "-", "confirmed"),
  row("demo-park-a", "8:30 PM", "Park, A.", "1418 555-0184", 6, "T20 · Patio", "Sommelier pour · Loire", "confirmed", "VIP · Anniv."),
  row("demo-cohen", "9:00 PM", "Cohen, R.", "1415 555-2511", 4, "Unassigned", "Vegetarian · 1GF", "pending", "New guest"),
];

function row(
  id: string,
  time: string,
  guest: string,
  phone: string,
  party: number,
  table: string,
  notes: string,
  status: ReservationBoardRow["status"],
  tag?: string,
): ReservationBoardRow {
  const startsAt = timeToBoardMinutes(time);
  return {
    id,
    time: shortTimeLabel(time),
    guest,
    phone,
    party,
    table,
    notes,
    status,
    tag,
    startsAt,
    durationMinutes: party >= 6 ? 120 : 90,
  };
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

function shortTimeLabel(timeStr: string): string {
  return timeStr
    .replace(":00 PM", "p")
    .replace(":15 PM", ":15p")
    .replace(":30 PM", ":30p")
    .replace(":45 PM", ":45p")
    .replace(":00 AM", "a")
    .replace(":30 AM", ":30a");
}

function normalizeStatus(row: ReservationRow): ReservationBoardRow["status"] {
  if ((row.no_show_risk_score ?? 0) >= 60) return "at_risk";
  if (row.status === "waiting" || row.status === "waitlist") return "waitlist";
  if (row.status === "seated") return "seated";
  if (row.status === "pending") return "pending";
  if (row.status === "completed") return "completed";
  return "confirmed";
}

function adaptReservation(rowData: ReservationRow, index: number): ReservationBoardRow {
  const date = new Date(rowData.reserved_at);
  const guest = rowData.guests?.full_name ?? rowData.guest_full_name ?? "Walk-in";
  const status = normalizeStatus(rowData);
  const notes =
    rowData.special_request ||
    rowData.occasion ||
    rowData.dietary_notes ||
    ((rowData.no_show_risk_score ?? 0) >= 60 ? "Awaiting deposit · 24h hold" : "-");
  const table = rowData.table_id
    ? `${TABLE_ROWS[index % TABLE_ROWS.length].table} · ${TABLE_ROWS[index % TABLE_ROWS.length].room}`
    : status === "waitlist"
      ? "Waitlist"
      : "Unassigned";

  return {
    id: rowData.id,
    time: shortTimeLabel(format(date, "h:mm a")),
    guest,
    phone: rowData.guests?.phone ?? rowData.guest_phone ?? "-",
    party: rowData.party_size,
    table,
    notes,
    status,
    tag: rowData.source === "walk_in" ? "Walk-in" : rowData.deposit_amount ? "Deposit" : undefined,
    source: rowData,
    startsAt: timeToBoardMinutes(format(date, "h:mm a")),
    durationMinutes: rowData.party_size >= 6 ? 120 : 90,
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
  return table.split(" ")[0];
}

export default function ReservationsPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [seatTarget, setSeatTarget] = useState<ReservationRow | null>(null);
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const filters = useMemo(
    (): ReservationFilters => ({
      date: selectedDate,
      search: search || undefined,
    }),
    [search, selectedDate],
  );

  const { reservations, loading, seatReservation, createReservation } = useReservations(filters);

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
    const adapted = reservations.map(adaptReservation);
    const base = adapted.length > 0 ? adapted : DEMO_ROWS;
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
  }, [quickFilter, reservations, search]);

  const allRows = reservations.length > 0 ? reservations.map(adaptReservation) : DEMO_ROWS;
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
        <MetricCard label="Upcoming" value={String(upcomingCount)} detail="Next: 7:00 PM · Tremblay" />
        <MetricCard label="At risk" value={String(atRiskCount)} detail="Awaiting deposit" />
        <MetricCard label="Waitlist" value={String(waitlistCount)} detail="Quoted 12 min" />
      </div>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
            <div className="inline-flex h-8 rounded-lg border border-border bg-bg-surface p-0.5">
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
                  {mode}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                const previous = new Date(`${selectedDate}T12:00:00`);
                previous.setDate(previous.getDate() - 1);
                setSelectedDate(format(previous, "yyyy-MM-dd"));
              }}
              className="flex size-8 items-center justify-center rounded-lg border border-border bg-bg-surface text-text-secondary hover:text-white"
              aria-label="Previous day"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setSelectedDate(format(new Date(), "yyyy-MM-dd"))}
              className="h-8 rounded-lg border border-border bg-bg-surface px-3 text-xs text-text-secondary hover:text-white"
            >
              Today · {format(selectedDateObject, "MMM d")}
            </button>
            <button
              type="button"
              onClick={() => {
                const next = new Date(`${selectedDate}T12:00:00`);
                next.setDate(next.getDate() + 1);
                setSelectedDate(format(next, "yyyy-MM-dd"));
              }}
              className="flex size-8 items-center justify-center rounded-lg border border-border bg-bg-surface text-text-secondary hover:text-white"
              aria-label="Next day"
            >
              <ChevronRight className="size-3.5" />
            </button>
            <div className="relative w-full min-w-72 sm:w-[320px]">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
              <Input
                placeholder="Search guest, phone, table..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-8 rounded-lg pl-9 text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
            <Button variant="outline" size="sm" className="h-8 rounded-lg gap-1.5 px-3 text-xs">
              <Filter className="size-3.5" />
              All shifts
            </Button>
            <Button variant="outline" size="sm" className="h-8 rounded-lg gap-1.5 px-3 text-xs">
              <Download className="size-3.5" />
              Export
            </Button>
            <Button size="sm" className="h-8 rounded-lg gap-1.5 px-3 text-xs" onClick={() => setDrawerOpen(true)}>
              <Plus className="size-3.5" />
              Add reservation
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: "all" as QuickFilter, label: "All", count: allRows.length },
                { id: "confirmed" as QuickFilter, label: "Confirmed", count: allRows.filter((item) => item.status === "confirmed").length },
                { id: "seated" as QuickFilter, label: "Seated", count: seatedCount },
                { id: "at_risk" as QuickFilter, label: "At risk", count: atRiskCount },
                { id: "waitlist" as QuickFilter, label: "Waitlist", count: waitlistCount },
                { id: "pending" as QuickFilter, label: "Pending", count: allRows.filter((item) => item.status === "pending").length },
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
          <span className="ml-auto text-[11px] text-text-muted">Last refreshed 12s ago</span>
        </div>
      </section>

      <FloorTimeline rows={boardRows} loading={loading} />
      <ReservationsTable
        rows={boardRows}
        loading={loading}
        onSeat={(rowData) => {
          if (rowData.source) setSeatTarget(rowData.source);
          else toast.info("Demo reservation - connect data to seat this guest.");
        }}
        onNotify={() => toast.info("Guest notification queued.")}
        onCall={() => toast.info("Call task created.")}
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
                    <option key={time}>{time}</option>
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
  const byTable = TABLE_ROWS.map((table) => ({
    ...table,
    bookings: rows.filter((reservation) => tableKey(reservation.table) === table.table),
  }));

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

function ReservationsTable({
  rows,
  loading,
  onSeat,
  onNotify,
  onCall,
}: {
  rows: ReservationBoardRow[];
  loading: boolean;
  onSeat: (row: ReservationBoardRow) => void;
  onNotify: (row: ReservationBoardRow) => void;
  onCall: (row: ReservationBoardRow) => void;
}) {
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
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left">
            <thead>
              <tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                <th className="px-5 py-4 font-medium">Time</th>
                <th className="px-5 py-4 font-medium">Guest</th>
                <th className="px-5 py-4 font-medium">Party</th>
                <th className="px-5 py-4 font-medium">Table</th>
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
                    <td className="px-5 py-4">
                      <StatusBadge
                        status={statusBadgeStatus(reservation.status)}
                        label={reservation.status.replace("_", " ")}
                      />
                    </td>
                    <td className="px-5 py-4 text-text-muted">{reservation.notes}</td>
                    <td className="px-5 py-4 text-right">
                      {reservation.status === "confirmed" || reservation.status === "pending" ? (
                        <Button size="sm" className="h-8 px-3 text-xs" onClick={() => onSeat(reservation)}>
                          Seat
                        </Button>
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
