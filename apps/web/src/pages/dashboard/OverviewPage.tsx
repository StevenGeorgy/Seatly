import { useMemo, useState } from "react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  DollarSign,
  Plus,
  ShoppingBag,
  Ticket,
  Users,
} from "lucide-react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { DataCardRow } from "@/components/dashboard/DataCard";
import { EventAttendeesDialog } from "@/components/dashboard/EventAttendeesDialog";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  useTonightEvents,
  type EventTimelineRow,
} from "@/hooks/useEventAttendees";
import { useOverviewStats, type OverviewOrderStats } from "@/hooks/useOverviewStats";
import { useReservations, type ReservationRow } from "@/hooks/useReservations";
import { useRestaurant } from "@/hooks/useRestaurant";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { useRestaurantSetupCompletion } from "@/hooks/useRestaurantSetupCompletion";
import {
  reservationDisplayStatus,
  reservationDisplayStatusKey,
  type ReservationDisplayStatus,
} from "@/lib/reservations/displayStatus";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatCompactTimeLabel } from "@/lib/utils/time";

type ServiceMetric = {
  label: string;
  value: string;
  delta: string;
  icon: typeof Users;
  tone: "gold" | "green" | "blue" | "warning";
};

type ServiceReservation = {
  id: string;
  reservedAt: Date;
  time: string;
  guest: string;
  party: number;
  table: string;
  notes: string;
  status: ReservationDisplayStatus;
};

type TimelineBucket = {
  label: string;
  count: number;
};

type ReservationStatusCounts = {
  upcoming: number;
  current: number;
  past: number;
};

const HIDDEN_RESERVATION_STATUSES = new Set(["cancelled", "no_show"]);
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function compactTime(date: Date): string {
  return formatCompactTimeLabel(date);
}

function isoDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function dayRange(date: Date): { from: string; to: string } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { from: start.toISOString(), to: end.toISOString() };
}

function tableName(table: NonNullable<ReservationRow["tables"]>): string {
  const name = table.label || (table.table_number ? `T${table.table_number}` : "Table");
  return table.section ? `${name} · ${table.section}` : name;
}

function reservationTableLabel(row: ReservationRow): string {
  const assignedTables = row.reservation_tables
    ?.map((assignment) => assignment.tables)
    .filter((table): table is NonNullable<typeof table> => Boolean(table))
    .map(tableName);

  if (assignedTables && assignedTables.length > 0) return assignedTables.join(", ");
  if (row.tables) return tableName(row.tables);
  return "Unassigned";
}

function reservationToServiceRow(row: ReservationRow): ServiceReservation | null {
  const reservedAt = new Date(row.reserved_at);
  if (Number.isNaN(reservedAt.getTime())) return null;

  const guest = row.guests?.full_name ?? row.guest_full_name ?? "Walk-in guest";
  const notes = row.special_request || row.occasion || row.dietary_notes || "—";

  return {
    id: row.id,
    reservedAt,
    time: compactTime(reservedAt),
    guest,
    party: row.party_size,
    table: reservationTableLabel(row),
    notes,
    status: reservationDisplayStatus(row),
  };
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function activeReservationRows(rows: ReservationRow[]): ServiceReservation[] {
  return rows
    .filter((row) => !HIDDEN_RESERVATION_STATUSES.has(row.status))
    .map(reservationToServiceRow)
    .filter((row): row is ServiceReservation => Boolean(row));
}

function reservationStatusCounts(rows: ServiceReservation[]): ReservationStatusCounts {
  return rows.reduce(
    (counts, row) => {
      if (row.status === "cancelled") return counts;
      counts[row.status] += 1;
      return counts;
    },
    { upcoming: 0, current: 0, past: 0 },
  );
}

function nextTwoHourReservations(rows: ServiceReservation[], now: Date): ServiceReservation[] {
  const windowEnd = new Date(now.getTime() + TWO_HOURS_MS);
  return rows
    .filter((row) => row.reservedAt >= now && row.reservedAt <= windowEnd)
    .slice(0, 7);
}

function serviceWindowLabel(rows: ServiceReservation[]): string {
  if (rows.length === 0) return "No reservations today";
  const first = rows[0];
  const last = rows[rows.length - 1];
  return first.id === last.id ? first.time : `${first.time} - ${last.time}`;
}

function buildTimelineBuckets(rows: ServiceReservation[]): TimelineBucket[] {
  if (rows.length === 0) return [];

  const firstHour = rows[0].reservedAt.getHours();
  const lastHour = rows[rows.length - 1].reservedAt.getHours();
  const buckets: TimelineBucket[] = [];

  for (let hour = firstHour; hour <= lastHour; hour += 1) {
    buckets.push({
      label: compactTime(new Date(2026, 0, 1, hour, 0)),
      count: rows.filter((row) => row.reservedAt.getHours() === hour).length,
    });
  }

  return buckets;
}

function tableTitle(now: Date): string {
  return `Reservations · ${compactTime(now)} - ${compactTime(new Date(now.getTime() + TWO_HOURS_MS))}`;
}

function MetricCard({ metric }: { metric: ServiceMetric }) {
  const Icon = metric.icon;
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-2xl border border-border bg-bg-surface p-5 shadow-2xl shadow-black/10"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
            {metric.label}
          </p>
          <p className="mt-3 font-serif text-3xl text-white">{metric.value}</p>
          <p className="mt-1 text-xs text-text-secondary">{metric.delta}</p>
        </div>
        <span className="flex size-10 items-center justify-center rounded-2xl bg-gold/10 text-gold">
          <Icon className="size-5" />
        </span>
      </div>
    </motion.article>
  );
}

function eventStartHour(event: EventTimelineRow, fallbackHour: number): number {
  if (!event.start_time) return fallbackHour;
  const [h] = event.start_time.split(":");
  const hour = Number(h);
  return Number.isFinite(hour) ? hour : fallbackHour;
}

function eventEndHour(event: EventTimelineRow, startHour: number): number {
  if (!event.end_time) return Math.min(startHour + 2, 23);
  const [h, m] = event.end_time.split(":");
  const hour = Number(h);
  const minutes = Number(m ?? 0);
  if (!Number.isFinite(hour)) return Math.min(startHour + 2, 23);
  return minutes > 0 ? hour + 0.999 : hour;
}

function formatEventTimeRange(event: EventTimelineRow): string {
  const fmt = (value: string | null) => {
    if (!value) return "";
    const [h, m] = value.split(":");
    const hours = Number(h);
    const minutes = Number(m ?? 0);
    if (!Number.isFinite(hours)) return value;
    const suffix = hours >= 12 ? "pm" : "am";
    const displayHour = hours % 12 || 12;
    return minutes === 0
      ? `${displayHour}${suffix}`
      : `${displayHour}:${String(minutes).padStart(2, "0")}${suffix}`;
  };
  if (event.start_time && event.end_time) {
    return `${fmt(event.start_time)} – ${fmt(event.end_time)}`;
  }
  if (event.start_time) return `from ${fmt(event.start_time)}`;
  if (event.end_time) return `until ${fmt(event.end_time)}`;
  return "all day";
}

function TimelineChart({
  buckets,
  counts,
  events,
  now,
  rows,
  onEventClick,
}: {
  buckets: TimelineBucket[];
  counts: ReservationStatusCounts;
  events: EventTimelineRow[];
  now: Date;
  rows: ServiceReservation[];
  onEventClick: (event: EventTimelineRow) => void;
}) {
  const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 1);
  const firstReservationHour = rows[0]?.reservedAt.getHours() ?? null;
  const lastReservationHour = rows[rows.length - 1]?.reservedAt.getHours() ?? null;

  const eventOverlay = useMemo(() => {
    if (buckets.length === 0 || events.length === 0) return null;
    const parsedBucketHour = Number(buckets[0].label);
    const firstHour = firstReservationHour ?? (Number.isFinite(parsedBucketHour) ? parsedBucketHour : 17);
    const lastHour = lastReservationHour ?? firstHour + buckets.length - 1;
    const totalHours = Math.max(lastHour - firstHour + 1, 1);

    return events
      .map((event) => {
        const startHour = eventStartHour(event, firstHour);
        const endHour = eventEndHour(event, startHour);
        const clampedStart = Math.max(startHour, firstHour);
        const clampedEnd = Math.min(endHour, lastHour + 1);
        if (clampedEnd <= clampedStart) return null;
        const leftPct = ((clampedStart - firstHour) / totalHours) * 100;
        const widthPct = ((clampedEnd - clampedStart) / totalHours) * 100;
        return {
          event,
          leftPct,
          widthPct: Math.max(widthPct, 4),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }, [buckets, events, firstReservationHour, lastReservationHour]);

  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl text-white">Tonight's timeline</h2>
          <p className="mt-1 text-xs text-text-muted">
            {serviceWindowLabel(rows)} · {pluralize(rows.length, "reservation")}
            {events.length > 0 ? (
              <> · {pluralize(events.length, "event")}</>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-[11px] text-gold">
            Current · {counts.current}
          </span>
          <span className="rounded-full border border-success/30 bg-success/10 px-3 py-1 text-[11px] text-success">
            Upcoming · {counts.upcoming}
          </span>
          <span className="rounded-full border border-border bg-bg-elevated px-3 py-1 text-[11px] text-text-secondary">
            Past · {counts.past}
          </span>
          {events.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/40 bg-purple-500/15 px-3 py-1 text-[11px] text-purple-300">
              <Ticket className="size-3" />
              Events · {events.length}
            </span>
          ) : null}
        </div>
      </div>

      <div className="relative mt-8 min-h-56 overflow-hidden rounded-xl bg-bg-base/40 p-5">
        {buckets.length > 0 ? (
          <div className="flex h-44 items-end gap-2">
            {buckets.map((bucket) => {
              const height = bucket.count === 0 ? 8 : 24 + (bucket.count / maxCount) * 120;
              return (
                <div key={bucket.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                  <div className="flex h-36 w-full items-end rounded-lg border border-border/40 bg-bg-elevated/30 p-1">
                    <div
                      className="w-full rounded-md bg-gold/75"
                      style={{ height }}
                      title={`${bucket.label}: ${pluralize(bucket.count, "reservation")}`}
                    />
                  </div>
                  <span className="font-mono text-[10px] text-text-muted">{bucket.label}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-border/60 text-sm text-text-muted">
            No reservations scheduled for today.
          </div>
        )}
        <div className="absolute right-5 top-5 rounded-md bg-bg-elevated px-2 py-1 font-mono text-[10px] text-text-secondary">
          Now · {compactTime(now)}
        </div>
      </div>

      {events.length > 0 ? (
        <div className="mt-4 rounded-xl border border-purple-500/20 bg-purple-500/[0.05] p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-purple-300">
              <Ticket className="size-3.5" />
              Tonight's events
            </p>
            <p className="text-[11px] text-text-muted">Click a bar to see attendees</p>
          </div>
          {eventOverlay && eventOverlay.length > 0 ? (
            <div className="relative h-12 rounded-lg border border-purple-500/20 bg-bg-base/40">
              {eventOverlay.map((entry) => (
                <button
                  key={entry.event.id}
                  type="button"
                  onClick={() => onEventClick(entry.event)}
                  className={cn(
                    "group absolute top-1.5 h-9 overflow-hidden rounded-md border border-purple-400/60 bg-gradient-to-r from-purple-500/70 to-purple-400/60 px-3 text-left text-xs font-medium text-white shadow-lg shadow-purple-500/20 transition-all duration-150 hover:-translate-y-0.5 hover:border-purple-300 hover:shadow-purple-400/30 focus-visible:-translate-y-0.5 focus-visible:border-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/60",
                  )}
                  style={{ left: `${entry.leftPct}%`, width: `${entry.widthPct}%` }}
                  title={`${entry.event.name} · ${formatEventTimeRange(entry.event)}`}
                >
                  <span className="flex items-center gap-1.5">
                    <Ticket className="size-3 shrink-0" />
                    <span className="truncate font-semibold">{entry.event.name}</span>
                  </span>
                  <span className="block truncate text-[10px] opacity-80">
                    {formatEventTimeRange(entry.event)} ·{" "}
                    {entry.event.capacity != null
                      ? `${entry.event.tickets_sold}/${entry.event.capacity}`
                      : `${entry.event.tickets_sold} sold`}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {events.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => onEventClick(event)}
                  className="inline-flex items-center gap-2 rounded-lg border border-purple-500/40 bg-purple-500/15 px-3 py-1.5 text-xs text-purple-200 transition-colors hover:border-purple-300 hover:bg-purple-500/25 hover:text-white"
                >
                  <Ticket className="size-3.5" />
                  <span className="font-semibold">{event.name}</span>
                  <span className="text-purple-300/80">·</span>
                  <span className="text-purple-300/80">{formatEventTimeRange(event)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ReservationsTable({ rows, title }: { rows: ServiceReservation[]; title: string }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-serif text-2xl text-white">{title}</h2>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-gold/40 hover:text-white"
        >
          <Plus className="size-3.5 text-gold" />
          New booking
        </button>
      </div>

      {rows.length > 0 ? (
        <>
        <div className="mt-5 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-border font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">
                <th className="pb-3 font-medium">Time</th>
                <th className="pb-3 font-medium">Guest</th>
                <th className="pb-3 font-medium">Party</th>
                <th className="pb-3 font-medium">Table</th>
                <th className="pb-3 font-medium">Notes</th>
                <th className="pb-3 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((row) => (
                <tr key={row.id} className="text-sm">
                  <td className="py-4 font-mono text-gold">{row.time}</td>
                  <td className="py-4 text-white">{row.guest}</td>
                  <td className="py-4 text-text-secondary">{row.party}</td>
                  <td className="py-4 text-text-secondary">{row.table}</td>
                  <td className="py-4 text-text-muted">{row.notes}</td>
                  <td className="py-4 text-right">
                    <StatusBadge status={row.status} label={t(reservationDisplayStatusKey(row.status))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: same rows as the table above, as cards (md:hidden) */}
        <div className="mt-5 divide-y divide-border/60 md:hidden">
          {rows.map((row) => (
            <article key={row.id} className="py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-gold">{row.time}</p>
                  <p className="mt-0.5 text-white">{row.guest}</p>
                </div>
                <StatusBadge status={row.status} label={t(reservationDisplayStatusKey(row.status))} />
              </div>
              <div className="mt-2 space-y-1.5">
                <DataCardRow label="Party">{row.party}</DataCardRow>
                <DataCardRow label="Table">{row.table}</DataCardRow>
                {row.notes ? <DataCardRow label="Notes">{row.notes}</DataCardRow> : null}
              </div>
            </article>
          ))}
        </div>
        </>
      ) : (
        <div className="mt-5 rounded-xl border border-dashed border-border/70 bg-bg-elevated/30 p-6 text-sm text-text-muted">
          No reservations in the next two hours.
        </div>
      )}
    </section>
  );
}

function ServiceSummary({
  currency,
  orderStats,
  rows,
  totalCovers,
  upcomingRows,
}: {
  currency: string;
  orderStats: OverviewOrderStats;
  rows: ServiceReservation[];
  totalCovers: number;
  upcomingRows: ServiceReservation[];
}) {
  const nextReservation = upcomingRows[0] ?? rows.find((row) => row.reservedAt >= new Date());

  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
      <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-gold">
        <CalendarDays className="size-3.5" />
        Service summary
      </p>
      <h2 className="mt-4 font-serif text-2xl text-white">Live overview</h2>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-text-secondary">
        <p>
          {pluralize(totalCovers, "cover")} booked across {pluralize(rows.length, "active reservation")} today.
        </p>
        <p>
          {nextReservation
            ? `Next reservation: ${nextReservation.guest} at ${nextReservation.time} for ${nextReservation.party}.`
            : "No upcoming reservations remain for today."}
        </p>
        <p>
          {pluralize(orderStats.preorderCount, "pre-order")} logged today, with{" "}
          {pluralize(orderStats.activePreorderCount, "active pre-order")} still in service.
        </p>
        <p>
          {formatCurrency(orderStats.paidIncome, currency)} paid income from{" "}
          {pluralize(orderStats.paidPreorderCount, "paid pre-order")} today.
        </p>
      </div>
    </section>
  );
}

export default function OverviewPage() {
  const navigate = useNavigate();
  const { selectedRestaurant } = useRestaurantScope();
  const { restaurant: scopedRestaurant } = useRestaurant(selectedRestaurant?.id);
  const setupCompletion = useRestaurantSetupCompletion(selectedRestaurant?.id ?? null);
  const isUnpublished = scopedRestaurant?.is_published === false;
  const currency = selectedRestaurant?.currency ?? "cad";
  const timezone = selectedRestaurant?.timezone ?? null;
  const now = useMemo(() => new Date(), []);
  const today = isoDate(now);
  const statsRange = useMemo(() => dayRange(now), [now]);
  const { stats: orderStats, loading: statsLoading, error: statsError } = useOverviewStats(statsRange);
  const { reservations, loading: reservationsLoading } = useReservations({
    date: today,
    timezone,
  });
  const { events: tonightEvents } = useTonightEvents(today);
  const [activeEvent, setActiveEvent] = useState<EventTimelineRow | null>(null);

  const loading = statsLoading || reservationsLoading;

  const activeReservations = useMemo(() => activeReservationRows(reservations), [reservations]);
  const upcomingReservations = useMemo(() => nextTwoHourReservations(activeReservations, now), [activeReservations, now]);
  const timelineBuckets = useMemo(() => buildTimelineBuckets(activeReservations), [activeReservations]);
  const statusCounts = useMemo(() => reservationStatusCounts(activeReservations), [activeReservations]);

  const totalCovers = activeReservations.reduce((sum, row) => sum + row.party, 0);

  const metrics: ServiceMetric[] = [
    {
      label: "Tonight's covers",
      value: String(totalCovers),
      delta: "from active reservations",
      icon: Users,
      tone: "gold",
    },
    {
      label: "Paid pre-order income",
      value: formatCurrency(orderStats.paidIncome, currency),
      delta: `${orderStats.paidPreorderCount.toLocaleString()} paid pre-orders today`,
      icon: DollarSign,
      tone: "green",
    },
    {
      label: "Today's pre-orders",
      value: String(orderStats.preorderCount),
      delta: `${orderStats.activePreorderCount.toLocaleString()} active now`,
      icon: ShoppingBag,
      tone: "blue",
    },
  ];

  return (
    <AnimatedPage className="space-y-6">
      {isUnpublished && !setupCompletion.loading ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-100 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">🟡 Your restaurant is in setup</p>
            <p className="text-xs text-yellow-100/80">
              {setupCompletion.stepsComplete} of {setupCompletion.totalSteps} steps complete — finish setup to publish to diners.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="self-start border-yellow-400/40 text-yellow-100 hover:bg-yellow-500/20 sm:self-auto"
            onClick={() => navigate("/setup")}
          >
            Resume setup →
          </Button>
        </div>
      ) : null}

      <header className="flex flex-col gap-4 border-b border-border/50 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-gold">
            {format(now, "EEEE")} · {format(now, "MMM d")} · {pluralize(totalCovers, "cover")} booked
          </p>
          <h1 className="mt-2 font-serif text-3xl leading-tight text-white sm:text-5xl sm:leading-none">Service tonight</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-bg-surface px-3 text-sm text-text-secondary"
          >
            <CalendarDays className="size-4 text-gold" />
            {format(now, "EEE, MMM d")}
          </button>
        </div>
      </header>

      {statsError ? (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {statsError.message}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {loading
          ? Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-36 rounded-2xl" />
            ))
          : metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
      </div>

      <div className="grid gap-5">
        <TimelineChart
          buckets={timelineBuckets}
          counts={statusCounts}
          events={tonightEvents}
          now={now}
          rows={activeReservations}
          onEventClick={setActiveEvent}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.9fr)_minmax(320px,0.9fr)]">
        <ReservationsTable rows={upcomingReservations} title={tableTitle(now)} />
        <ServiceSummary
          currency={currency}
          orderStats={orderStats}
          rows={activeReservations}
          totalCovers={totalCovers}
          upcomingRows={upcomingReservations}
        />
      </div>

      <EventAttendeesDialog
        event={activeEvent}
        open={activeEvent !== null}
        timezone={timezone}
        onOpenChange={(open) => {
          if (!open) setActiveEvent(null);
        }}
      />
    </AnimatedPage>
  );
}
