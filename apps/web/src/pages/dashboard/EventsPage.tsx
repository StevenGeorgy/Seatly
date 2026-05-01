import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, Plus, Sparkles } from "lucide-react";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type EventStatus = "on_sale" | "sold_out" | "confirmed" | "draft";
type EventKind = "Wine dinner" | "Chef's table" | "Holiday" | "Buyout";
type EventPhase = "active" | "past";

type EventCard = {
  id: string;
  status: EventStatus;
  kind: EventKind;
  date: string;
  time: string;
  isoDate: string;
  title: string;
  seatsSold: number;
  seatsTotal: number;
  perCover: number;
  phase: EventPhase;
};

const EVENTS: EventCard[] = [
  { id: "loire", status: "on_sale", kind: "Wine dinner", date: "May 4", time: "7:00 PM", isoDate: "2026-05-04", title: "Loire Valley Tasting", seatsSold: 22, seatsTotal: 24, perCover: 185, phase: "active" },
  { id: "truffle", status: "sold_out", kind: "Chef's table", date: "May 11", time: "6:30 PM", isoDate: "2026-05-11", title: "Spring Truffle Menu", seatsSold: 12, seatsTotal: 12, perCover: 240, phase: "active" },
  { id: "mday", status: "on_sale", kind: "Holiday", date: "May 12", time: "11–3 PM", isoDate: "2026-05-12", title: "Mother's Day Brunch", seatsSold: 54, seatsTotal: 80, perCover: 95, phase: "active" },
  { id: "westin", status: "confirmed", kind: "Buyout", date: "May 18", time: "7:00 PM", isoDate: "2026-05-18", title: "Westin Group · Private", seatsSold: 60, seatsTotal: 60, perCover: 140, phase: "active" },
  { id: "somm", status: "on_sale", kind: "Wine dinner", date: "May 22", time: "7:30 PM", isoDate: "2026-05-22", title: "Sommelier Society", seatsSold: 8, seatsTotal: 30, perCover: 195, phase: "active" },
  { id: "pride", status: "draft", kind: "Holiday", date: "Jun 1", time: "11–4 PM", isoDate: "2026-06-01", title: "Pride Brunch · Patio", seatsSold: 0, seatsTotal: 64, perCover: 75, phase: "active" },
  { id: "easter", status: "sold_out", kind: "Holiday", date: "Apr 20", time: "11–3 PM", isoDate: "2026-04-20", title: "Easter Brunch", seatsSold: 72, seatsTotal: 72, perCover: 110, phase: "past" },
  { id: "burgundy", status: "confirmed", kind: "Wine dinner", date: "Apr 12", time: "7:00 PM", isoDate: "2026-04-12", title: "Burgundy & Beef", seatsSold: 24, seatsTotal: 24, perCover: 220, phase: "past" },
  { id: "buyout-q1", status: "confirmed", kind: "Buyout", date: "Mar 28", time: "6:00 PM", isoDate: "2026-03-28", title: "Q1 Closing · Private", seatsSold: 48, seatsTotal: 48, perCover: 160, phase: "past" },
];

const STATS = [
  { label: "Upcoming events", value: "5", caption: "next 60 days", delta: null, deltaTone: null as null },
  { label: "Seats sold", value: "156", caption: "this week", delta: "42", deltaTone: "up" as const },
  { label: "Event revenue", value: "$22.0k", caption: "booked", delta: "$3.2k", deltaTone: "up" as const },
  { label: "Sell-through", value: "78%", caption: "vs Q1", delta: "6pt", deltaTone: "up" as const },
];

const STATUS_BADGE: Record<EventStatus, { label: string; cls: string }> = {
  on_sale: { label: "On sale", cls: "border-info/40 bg-info/10 text-info" },
  sold_out: { label: "Sold out", cls: "border-success/40 bg-success/10 text-success" },
  confirmed: { label: "Confirmed", cls: "border-gold/40 bg-gold/10 text-gold" },
  draft: { label: "Draft", cls: "border-border bg-bg-elevated text-text-muted" },
};

function fillBarColor(seatsSold: number, seatsTotal: number): string {
  if (seatsSold >= seatsTotal && seatsTotal > 0) return "bg-success";
  if (seatsSold === 0) return "bg-text-muted/40";
  return "bg-gold";
}

function EventCardView({ event }: { event: EventCard }) {
  const fillPct = event.seatsTotal === 0 ? 0 : Math.round((event.seatsSold / event.seatsTotal) * 100);
  const badge = STATUS_BADGE[event.status];

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative flex h-72 flex-col overflow-hidden rounded-2xl border border-border bg-bg-surface p-5 transition-colors hover:border-gold/40"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(circle at 30% 30%, rgba(200,169,81,0.18), transparent 60%), radial-gradient(circle at 80% 80%, rgba(200,169,81,0.05), transparent 65%)",
        }}
      />
      <div className="relative flex items-start justify-between">
        <span className={cn("inline-flex rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider", badge.cls)}>
          {badge.label}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">{event.kind}</span>
      </div>

      <div className="relative mt-auto">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-gold">
          {event.date} · {event.time}
        </p>
        <h3 className="mt-2 font-serif text-2xl text-white">{event.title}</h3>
      </div>

      <div className="relative mt-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Seats</p>
            <p className="mt-1 font-serif text-xl text-white">
              {event.seatsSold}
              <span className="text-text-muted">/{event.seatsTotal}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Per cover</p>
            <p className="mt-1 font-serif text-xl text-white">${event.perCover}</p>
          </div>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
          <div className={cn("h-full rounded-full", fillBarColor(event.seatsSold, event.seatsTotal))} style={{ width: `${fillPct}%` }} />
        </div>
      </div>
    </motion.article>
  );
}

function CalendarView({ events }: { events: EventCard[] }) {
  const [cursor, setCursor] = useState(new Date(2026, 4, 1));

  const grid = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: Array<{ key: string; date: Date | null; events: EventCard[] }> = [];
    for (let i = 0; i < startOffset; i += 1) {
      cells.push({ key: `pad-${i}`, date: null, events: [] });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day);
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      cells.push({
        key: `d-${day}`,
        date,
        events: events.filter((e) => e.isoDate === iso),
      });
    }
    while (cells.length % 7 !== 0) cells.push({ key: `tail-${cells.length}`, date: null, events: [] });
    return cells;
  }, [cursor, events]);

  const monthLabel = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-serif text-2xl text-white">{monthLabel}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            className="flex size-8 items-center justify-center rounded-md border border-border text-text-muted transition-colors hover:border-gold/40 hover:text-text-primary"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            className="flex size-8 items-center justify-center rounded-md border border-border text-text-muted transition-colors hover:border-gold/40 hover:text-text-primary"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {dow.map((d) => (
          <div key={d} className="text-center font-mono text-[10px] uppercase tracking-wider text-text-muted">
            {d}
          </div>
        ))}
        {grid.map((cell) => (
          <div
            key={cell.key}
            className={cn(
              "min-h-24 rounded-lg border p-2",
              cell.date ? "border-border/60 bg-bg-elevated/30" : "border-transparent bg-transparent",
            )}
          >
            {cell.date && (
              <>
                <div className="font-mono text-[11px] text-text-muted">{cell.date.getDate()}</div>
                <div className="mt-1 flex flex-col gap-1">
                  {cell.events.map((e) => (
                    <div
                      key={e.id}
                      className={cn(
                        "truncate rounded border px-1.5 py-0.5 text-[10px]",
                        STATUS_BADGE[e.status].cls,
                      )}
                      title={`${e.title} · ${e.time}`}
                    >
                      {e.title}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

type CreateEventDraft = {
  title: string;
  kind: EventKind;
  date: string;
  time: string;
  seats: string;
  perCover: string;
};

const EMPTY_DRAFT: CreateEventDraft = {
  title: "",
  kind: "Wine dinner",
  date: "",
  time: "",
  seats: "",
  perCover: "",
};

function CreateEventDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onCreate: (draft: CreateEventDraft) => void;
}) {
  const [draft, setDraft] = useState<CreateEventDraft>(EMPTY_DRAFT);

  const update = <K extends keyof CreateEventDraft>(key: K, value: CreateEventDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const canSave = draft.title.trim().length > 0 && draft.date && draft.seats;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-bg-surface sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl text-white">Create event</DialogTitle>
        </DialogHeader>
        <div className="mt-4 grid gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Title</Label>
            <Input value={draft.title} onChange={(e) => update("title", e.target.value)} placeholder="Loire Valley Tasting" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Type</Label>
              <Select value={draft.kind} onValueChange={(v) => update("kind", v as EventKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Wine dinner">Wine dinner</SelectItem>
                  <SelectItem value="Chef's table">Chef's table</SelectItem>
                  <SelectItem value="Holiday">Holiday</SelectItem>
                  <SelectItem value="Buyout">Buyout</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Date</Label>
              <Input type="date" value={draft.date} onChange={(e) => update("date", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Time</Label>
              <Input value={draft.time} onChange={(e) => update("time", e.target.value)} placeholder="7:00 PM" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Seats</Label>
              <Input type="number" value={draft.seats} onChange={(e) => update("seats", e.target.value)} placeholder="24" />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Per cover ($)</Label>
              <Input type="number" value={draft.perCover} onChange={(e) => update("perCover", e.target.value)} placeholder="185" />
            </div>
          </div>
        </div>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canSave}
            onClick={() => {
              onCreate(draft);
              setDraft(EMPTY_DRAFT);
              onOpenChange(false);
            }}
          >
            Create event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type View = "grid" | "calendar";
type Phase = "active" | "past";

export default function EventsPage() {
  const [view, setView] = useState<View>("grid");
  const [phase, setPhase] = useState<Phase>("active");
  const [createOpen, setCreateOpen] = useState(false);
  const [extraEvents, setExtraEvents] = useState<EventCard[]>([]);

  const allEvents = useMemo(() => [...extraEvents, ...EVENTS], [extraEvents]);
  const counts = useMemo(() => ({
    active: allEvents.filter((e) => e.phase === "active").length,
    past: allEvents.filter((e) => e.phase === "past").length,
  }), [allEvents]);

  const visibleEvents = useMemo(
    () => allEvents.filter((e) => e.phase === phase),
    [allEvents, phase],
  );

  const handleCreate = (draft: CreateEventDraft) => {
    const seats = Number(draft.seats) || 0;
    const perCover = Number(draft.perCover) || 0;
    const dateObj = draft.date ? new Date(draft.date) : new Date();
    const fmtDate = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    setExtraEvents((prev) => [
      {
        id: `new-${Date.now()}`,
        status: "draft",
        kind: draft.kind,
        date: fmtDate,
        time: draft.time || "TBD",
        isoDate: draft.date || dateObj.toISOString().slice(0, 10),
        title: draft.title.trim(),
        seatsSold: 0,
        seatsTotal: seats,
        perCover,
        phase: dateObj < new Date() ? "past" : "active",
      },
      ...prev,
    ]);
    setPhase("active");
  };

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
            <Sparkles className="size-3.5" />
            Programs
          </p>
          <h1 className="mt-2 font-serif text-3xl text-white sm:text-4xl">Events &amp; private dining</h1>
          <p className="mt-1 text-sm italic text-text-muted">
            Wine dinners, chef's tables, buyouts, holidays — your standalone programs.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="default"
            className="gap-2"
            onClick={() => setView((v) => (v === "grid" ? "calendar" : "grid"))}
          >
            {view === "grid" ? <CalendarDays className="size-4" /> : <LayoutGrid className="size-4" />}
            {view === "grid" ? "Calendar view" : "Grid view"}
          </Button>
          <Button size="default" className="gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Create event
          </Button>
        </div>
      </motion.header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <article key={stat.label} className="rounded-2xl border border-border bg-bg-surface p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">{stat.label}</p>
            <p className="mt-3 font-serif text-4xl text-white">{stat.value}</p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
              {stat.deltaTone && (
                <span className={cn("font-medium", stat.deltaTone === "up" ? "text-success" : "text-danger")}>
                  ↑ {stat.delta}
                </span>
              )}
              <span>{stat.caption}</span>
            </p>
          </article>
        ))}
      </section>

      <div className="flex items-center gap-1 self-start rounded-lg border border-border bg-bg-elevated/40 p-1">
        {(["active", "past"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setPhase(key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
              phase === key ? "bg-gold/15 text-gold" : "text-text-muted hover:text-text-secondary",
            )}
          >
            {key}
            <span className={cn("font-mono text-[10px]", phase === key ? "text-gold/80" : "text-text-muted")}>
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {view === "calendar" ? (
        <CalendarView events={visibleEvents} />
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleEvents.map((event) => (
            <EventCardView key={event.id} event={event} />
          ))}
          {visibleEvents.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-border bg-bg-surface/40 p-10 text-center text-sm text-text-muted">
              No {phase} events.
            </div>
          )}
        </section>
      )}

      <CreateEventDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} />
    </AnimatedPage>
  );
}
