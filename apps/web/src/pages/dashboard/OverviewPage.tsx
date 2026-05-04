import { useMemo } from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  Bot,
  CalendarDays,
  DollarSign,
  Phone,
  Plus,
  ShieldAlert,
  ShoppingBag,
  Users,
} from "lucide-react";
import { motion } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics } from "@/hooks/useAnalytics";
import { useReservations, type ReservationRow } from "@/hooks/useReservations";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
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
  time: string;
  guest: string;
  party: number;
  table: string;
  notes: string;
  status: string;
};

const DEMO_RESERVATIONS: ServiceReservation[] = [
  {
    id: "demo-lefebvre",
    time: "7:30pm",
    guest: "Lefebvre, Camille",
    party: 4,
    table: "T12 · Patio",
    notes: "Birthday · cake req",
    status: "seated",
  },
  {
    id: "demo-chen",
    time: "7:45pm",
    guest: "Chen, David",
    party: 2,
    table: "T06 · Main",
    notes: "VIP · pre-order $214",
    status: "confirmed",
  },
  {
    id: "demo-singh",
    time: "8pm",
    guest: "Singh, Anaya",
    party: 6,
    table: "T15 · Banquette",
    notes: "82% no-show risk",
    status: "at_risk",
  },
  {
    id: "demo-tromblay",
    time: "8:15pm",
    guest: "Tromblay, M.",
    party: 8,
    table: "T03 · Main",
    notes: "Allergies: shellfish",
    status: "confirmed",
  },
  {
    id: "demo-walkin",
    time: "8:30pm",
    guest: "Walk-in queue",
    party: 2,
    table: "—",
    notes: "15min wait quoted",
    status: "pending",
  },
];

const ATTENTION_ITEMS = [
  {
    icon: Phone,
    title: "Singh · 8pm · 6 top",
    detail: "82% no-show risk · call now",
    tone: "warning",
  },
  {
    icon: ShieldAlert,
    title: "86 the morels",
    detail: "Only 2 portions left",
    tone: "danger",
  },
  {
    icon: CalendarDays,
    title: "Birthday tonight",
    detail: "Lefebvre · T12 patio · cake?",
    tone: "blue",
  },
  {
    icon: ShoppingBag,
    title: "Pre-order ready",
    detail: "Chen · 7:45pm · $214",
    tone: "gold",
  },
  {
    icon: AlertTriangle,
    title: "Staff arriving late",
    detail: "2 runners · ETA 6:45pm",
    tone: "muted",
  },
];

function compactTime(date: Date): string {
  return formatCompactTimeLabel(date);
}

function reservationToServiceRow(row: ReservationRow, index: number): ServiceReservation {
  const guest = row.guests?.full_name ?? row.guest_full_name ?? "Walk-in guest";
  const risk = row.no_show_risk_score ?? 0;
  const notes = row.special_request || row.occasion || row.dietary_notes || (risk >= 60 ? `${risk}% no-show risk` : "—");

  return {
    id: row.id,
    time: compactTime(new Date(row.reserved_at)),
    guest,
    party: row.party_size,
    table: row.table_id ? `T${String(index + 3).padStart(2, "0")} · Main` : "—",
    notes,
    status: risk >= 60 ? "at_risk" : row.status,
  };
}

function MiniSparkline({ tone }: { tone: ServiceMetric["tone"] }) {
  const stroke =
    tone === "green"
      ? "var(--chart-2)"
      : tone === "blue"
        ? "var(--chart-3)"
        : tone === "warning"
          ? "var(--chart-4)"
          : "var(--gold)";

  return (
    <svg viewBox="0 0 240 44" className="mt-4 h-9 w-full overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={`spark-${tone}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.1" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.65" />
        </linearGradient>
      </defs>
      <path
        d="M0 33 C38 30, 52 36, 84 31 C116 26, 132 21, 164 23 C194 24, 208 19, 240 16"
        fill="none"
        stroke={`url(#spark-${tone})`}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M0 33 C38 30, 52 36, 84 31 C116 26, 132 21, 164 23 C194 24, 208 19, 240 16 L240 44 L0 44 Z"
        fill={stroke}
        opacity="0.08"
      />
    </svg>
  );
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
      <MiniSparkline tone={metric.tone} />
    </motion.article>
  );
}

function TimelineChart() {
  const labels = ["6pm", "7pm", "8pm", "9pm", "10pm", "11pm"];
  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl text-white">Tonight's timeline</h2>
          <p className="mt-1 text-xs text-text-muted">6pm - 11pm · 58 reservations</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-success/30 bg-success/10 px-3 py-1 text-[11px] text-success">
            Seated · 12
          </span>
          <span className="rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-[11px] text-gold">
            Confirmed · 28
          </span>
          <span className="rounded-full border border-warning/30 bg-warning/10 px-3 py-1 text-[11px] text-warning">
            At risk · 3
          </span>
        </div>
      </div>

      <div className="relative mt-8 h-56 overflow-hidden rounded-xl bg-bg-base/40">
        <div className="absolute inset-x-5 top-0 h-full">
          <div className="grid h-full grid-cols-6">
            {labels.map((label) => (
              <div key={label} className="relative border-l border-border/40 last:border-r">
                <span className="absolute bottom-3 left-2 font-mono text-[10px] text-text-muted">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
        <svg viewBox="0 0 760 210" className="absolute inset-x-5 bottom-8 h-[180px] w-[calc(100%-2.5rem)]" preserveAspectRatio="none">
          <defs>
            <linearGradient id="timeline-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0 155 C120 138, 150 132, 230 114 C330 84, 415 55, 520 61 C612 66, 677 93, 760 130 L760 210 L0 210 Z"
            fill="url(#timeline-fill)"
          />
          <path
            d="M0 155 C120 138, 150 132, 230 114 C330 84, 415 55, 520 61 C612 66, 677 93, 760 130"
            fill="none"
            stroke="var(--gold)"
            strokeOpacity="0.8"
            strokeWidth="3"
          />
          <line x1="300" x2="300" y1="0" y2="185" stroke="var(--text-muted)" strokeOpacity="0.5" />
          <circle cx="300" cy="58" r="4" fill="var(--text-primary)" />
        </svg>
        <div className="absolute left-[39%] top-4 rounded-md bg-bg-elevated px-2 py-1 font-mono text-[10px] text-text-secondary">
          Now · 7:52pm
        </div>
      </div>
    </section>
  );
}

function AttentionPanel() {
  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-xl text-white">Needs attention</h2>
        <span className="flex size-6 items-center justify-center rounded-full bg-gold/15 text-xs text-gold">
          {ATTENTION_ITEMS.length}
        </span>
      </div>
      <div className="mt-5 space-y-3">
        {ATTENTION_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="flex gap-3 rounded-xl border border-border/50 bg-bg-elevated/50 p-3">
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg border",
                  item.tone === "danger"
                    ? "border-danger/30 bg-danger/10 text-danger"
                    : item.tone === "warning"
                      ? "border-warning/30 bg-warning/10 text-warning"
                      : item.tone === "blue"
                        ? "border-info/30 bg-info/10 text-info"
                        : item.tone === "gold"
                          ? "border-gold/30 bg-gold/10 text-gold"
                          : "border-border bg-bg-surface text-text-muted",
                )}
              >
                <Icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{item.title}</p>
                <p className="mt-0.5 truncate text-xs text-text-muted">{item.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReservationsTable({ rows }: { rows: ServiceReservation[] }) {
  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-serif text-2xl text-white">Reservations · next 2 hours</h2>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-gold/40 hover:text-white"
        >
          <Plus className="size-3.5 text-gold" />
          New booking
        </button>
      </div>

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
                  <StatusBadge status={row.status === "at_risk" ? "pending" : row.status} label={row.status.replace("_", " ")} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AiBriefing({ currency }: { currency: string }) {
  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
      <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-gold">
        <Bot className="size-3.5" />
        AI briefing
      </p>
      <h2 className="mt-4 font-serif text-2xl text-white">Tonight's read</h2>
      <div className="mt-4 space-y-4 text-sm leading-relaxed text-text-secondary">
        <p>
          Saturday after a Leafs win: expect aggressive walk-ins between 9:30pm-11pm.
          Bar four-tops are 50% likely to overrun.
        </p>
        <p>
          Sardines sit at 0.4% order rate this month. Replacing with Burrata projects{" "}
          <span className="text-gold">{formatCurrency(2140, currency)}</span> / wk.
        </p>
        <p>
          Camille Lefebvre (7:30pm) - 6th visit. Last 5 bills exceeded{" "}
          <span className="text-gold">{formatCurrency(400, currency)}</span>. Consider amuse from chef.
        </p>
      </div>
      <button
        type="button"
        className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-md border border-border text-sm text-text-secondary transition-colors hover:border-gold/40 hover:text-white"
      >
        View all insights
      </button>
    </section>
  );
}

export default function OverviewPage() {
  const { selectedRestaurant } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const today = new Date().toISOString().split("T")[0];
  const { todayRow, loading: analyticsLoading } = useAnalytics({ from: today, to: today });
  const { reservations, loading: reservationsLoading } = useReservations({ date: today });

  const loading = analyticsLoading || reservationsLoading;

  const visibleReservations = useMemo(() => {
    const rows = reservations
      .filter((row) => row.status !== "cancelled" && row.status !== "completed")
      .slice(0, 7)
      .map(reservationToServiceRow);
    return rows.length > 0 ? rows : DEMO_RESERVATIONS;
  }, [reservations]);

  const totalCovers = todayRow?.total_covers ?? visibleReservations.reduce((sum, row) => sum + row.party, 0) ?? 142;
  const revenue = todayRow?.total_revenue ?? 24860;
  const openOrders = todayRow?.total_orders ?? 9;
  const noShowRisks =
    reservations.filter((row) => (row.no_show_risk_score ?? 0) >= 60).length ||
    visibleReservations.filter((row) => row.status === "at_risk").length ||
    3;

  const metrics: ServiceMetric[] = [
    {
      label: "Tonight's covers",
      value: String(totalCovers),
      delta: "+28%",
      icon: Users,
      tone: "gold",
    },
    {
      label: "Projected revenue",
      value: formatCurrency(revenue, currency),
      delta: "+$3.1k",
      icon: DollarSign,
      tone: "green",
    },
    {
      label: "Open tickets",
      value: String(openOrders),
      delta: "4 pre-ordered",
      icon: ShoppingBag,
      tone: "blue",
    },
    {
      label: "No-show risk",
      value: String(noShowRisks),
      delta: "requires action",
      icon: AlertTriangle,
      tone: "warning",
    },
  ];

  return (
    <AnimatedPage className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-border/50 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-gold">
            {format(new Date(), "EEEE")} · {format(new Date(), "MMM d")} · {totalCovers} covers booked
          </p>
          <h1 className="mt-2 font-serif text-5xl leading-none text-white">Service tonight</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-bg-surface px-3 text-sm text-text-secondary"
          >
            <CalendarDays className="size-4 text-gold" />
            {format(new Date(), "EEE, MMM d")}
          </button>
          <span className="flex size-9 items-center justify-center rounded-full bg-gold/15 font-mono text-xs text-gold">
            {selectedRestaurant?.name?.slice(0, 2).toUpperCase() ?? "JD"}
          </span>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-36 rounded-2xl" />
            ))
          : metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.9fr)_minmax(320px,0.9fr)]">
        <TimelineChart />
        <AttentionPanel />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.9fr)_minmax(320px,0.9fr)]">
        <ReservationsTable rows={visibleReservations} />
        <AiBriefing currency={currency} />
      </div>
    </AnimatedPage>
  );
}
