import { useMemo } from "react";
import { format } from "date-fns";
import {
  CalendarDays,
  DollarSign,
  Plus,
  ShoppingBag,
  Users,
} from "lucide-react";
import { motion } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { useOverviewStats, type OverviewOrderStats } from "@/hooks/useOverviewStats";
import { useReservations, type ReservationRow } from "@/hooks/useReservations";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
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
  status: string;
};

type TimelineBucket = {
  label: string;
  count: number;
};

type ReservationStatusCounts = {
  pending: number;
  confirmed: number;
  seated: number;
};

const INACTIVE_RESERVATION_STATUSES = new Set(["cancelled", "completed", "no_show"]);
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
    status: row.status,
  };
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function activeReservationRows(rows: ReservationRow[]): ServiceReservation[] {
  return rows
    .filter((row) => !INACTIVE_RESERVATION_STATUSES.has(row.status))
    .map(reservationToServiceRow)
    .filter((row): row is ServiceReservation => Boolean(row));
}

function reservationStatusCounts(rows: ServiceReservation[]): ReservationStatusCounts {
  return rows.reduce(
    (counts, row) => {
      if (row.status === "pending") counts.pending += 1;
      if (row.status === "confirmed") counts.confirmed += 1;
      if (row.status === "seated") counts.seated += 1;
      return counts;
    },
    { pending: 0, confirmed: 0, seated: 0 },
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

function TimelineChart({
  buckets,
  counts,
  now,
  rows,
}: {
  buckets: TimelineBucket[];
  counts: ReservationStatusCounts;
  now: Date;
  rows: ServiceReservation[];
}) {
  const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 1);

  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl text-white">Tonight's timeline</h2>
          <p className="mt-1 text-xs text-text-muted">
            {serviceWindowLabel(rows)} · {pluralize(rows.length, "reservation")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-success/30 bg-success/10 px-3 py-1 text-[11px] text-success">
            Seated · {counts.seated}
          </span>
          <span className="rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-[11px] text-gold">
            Confirmed · {counts.confirmed}
          </span>
          <span className="rounded-full border border-info/30 bg-info/10 px-3 py-1 text-[11px] text-info">
            Pending · {counts.pending}
          </span>
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
    </section>
  );
}

function ReservationsTable({ rows, title }: { rows: ServiceReservation[]; title: string }) {
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
        <div className="mt-5 overflow-x-auto">
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
                    <StatusBadge status={row.status} label={row.status.replace("_", " ")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
          {pluralize(orderStats.paidOrderCount, "paid order")} today.
        </p>
      </div>
    </section>
  );
}

export default function OverviewPage() {
  const { selectedRestaurant } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const now = new Date();
  const today = isoDate(now);
  const statsRange = useMemo(() => dayRange(now), [today]);
  const { stats: orderStats, loading: statsLoading, error: statsError } = useOverviewStats(statsRange);
  const { reservations, loading: reservationsLoading } = useReservations({ date: today });

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
      label: "Paid income",
      value: formatCurrency(orderStats.paidIncome, currency),
      delta: `${orderStats.paidOrderCount.toLocaleString()} paid today`,
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
      <header className="flex flex-col gap-4 border-b border-border/50 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-gold">
            {format(now, "EEEE")} · {format(now, "MMM d")} · {pluralize(totalCovers, "cover")} booked
          </p>
          <h1 className="mt-2 font-serif text-5xl leading-none text-white">Service tonight</h1>
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
        <TimelineChart buckets={timelineBuckets} counts={statusCounts} now={now} rows={activeReservations} />
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
    </AnimatedPage>
  );
}
