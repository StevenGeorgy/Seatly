import { useMemo } from "react";
import { motion } from "framer-motion";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import {
  useAnalytics,
  useAnalyticsDishPerformance,
  useAnalyticsReservations,
  type AnalyticsDateRange,
  type AnalyticsDishPerformance,
  type AnalyticsReservationPoint,
  type AnalyticsRow,
} from "@/hooks/useAnalytics";
import { useExpenses, type ExpenseRow } from "@/hooks/useExpenses";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { formatCompactTimeLabel } from "@/lib/utils/time";

type AnalyticsStat = {
  label: string;
  value: string;
  delta: string;
  deltaTone: "positive" | "negative" | "neutral";
  caption: string;
};

type AnalyticsSummary = {
  revenue: number;
  covers: number;
  orders: number;
  avgSpendPerCover: number;
  avgTableTurn: number | null;
};

const COLORS = {
  income: "var(--chart-2)",
  expenses: "var(--gold)",
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function currentAnalyticsRange(): AnalyticsDateRange {
  const today = new Date();
  return { from: isoDate(addDays(today, -29)), to: isoDate(today) };
}

function monthlyChartRange(): AnalyticsDateRange {
  const today = new Date();
  const start = new Date(today.getFullYear(), 0, 1, 12);
  const end = new Date(today.getFullYear(), 11, 31, 12);
  return { from: isoDate(start), to: isoDate(end) };
}

function monthKey(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date.slice(0, 7);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
}

function monthsInRange(range: AnalyticsDateRange): Array<{ key: string; label: string }> {
  const start = new Date(`${range.from}T12:00:00`);
  const end = new Date(`${range.to}T12:00:00`);
  const months: Array<{ key: string; label: string }> = [];

  for (let date = new Date(start.getFullYear(), start.getMonth(), 1, 12); date <= end; date = addMonths(date, 1)) {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    months.push({
      key,
      label: date.toLocaleDateString("en-US", { month: "short" }),
    });
  }

  return months;
}

type IncomeExpensesMonth = {
  label: string;
  income: number;
  expenses: number;
};

function chartTicks(rows: IncomeExpensesMonth[]): string[] {
  return rows.map((row) => row.label);
}

function previousAnalyticsRange(): AnalyticsDateRange {
  const today = new Date();
  return { from: isoDate(addDays(today, -59)), to: isoDate(addDays(today, -30)) };
}

function currentWeekRange(): AnalyticsDateRange {
  const today = new Date();
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = addDays(today, mondayOffset);
  return { from: isoDate(monday), to: isoDate(addDays(monday, 6)) };
}

function summarizeAnalytics(rows: AnalyticsRow[]): AnalyticsSummary {
  const revenue = rows.reduce((sum, row) => sum + Number(row.total_revenue ?? 0), 0);
  const covers = rows.reduce((sum, row) => sum + Number(row.total_covers ?? 0), 0);
  const orders = rows.reduce((sum, row) => sum + Number(row.total_orders ?? 0), 0);
  const turnRows = rows.filter((row) => row.avg_table_turn_minutes !== null && row.avg_table_turn_minutes !== undefined);
  const turnWeight = turnRows.reduce((sum, row) => sum + Math.max(Number(row.total_covers ?? 0), 1), 0);
  const avgTableTurn = turnRows.length > 0
    ? turnRows.reduce((sum, row) => sum + Number(row.avg_table_turn_minutes ?? 0) * Math.max(Number(row.total_covers ?? 0), 1), 0) / turnWeight
    : null;

  return {
    revenue,
    covers,
    orders,
    avgSpendPerCover: covers > 0 ? revenue / covers : 0,
    avgTableTurn,
  };
}

function percentDelta(current: number, previous: number): { label: string; tone: AnalyticsStat["deltaTone"] } {
  if (previous <= 0) return { label: "No prior period", tone: "neutral" };
  const value = ((current - previous) / previous) * 100;
  return {
    label: `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`,
    tone: value >= 0 ? "positive" : "negative",
  };
}

function minuteDelta(current: number | null, previous: number | null): { label: string; tone: AnalyticsStat["deltaTone"] } {
  if (current === null || previous === null) return { label: "No prior period", tone: "neutral" };
  const value = Math.round(current - previous);
  return {
    label: `${value >= 0 ? "+" : ""}${value} min`,
    tone: value <= 0 ? "positive" : "negative",
  };
}

function sumLedgerTransactions(rows: ExpenseRow[], type: "income" | "expense"): number {
  return rows
    .filter((row) => (row.transaction_type ?? "expense") === type)
    .reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0);
}

function buildStats(
  current: AnalyticsSummary,
  previous: AnalyticsSummary,
  currency: string,
  currentIncome: number,
  previousIncome: number,
): AnalyticsStat[] {
  const incomeDelta = percentDelta(currentIncome, previousIncome);
  const coversDelta = percentDelta(current.covers, previous.covers);
  const turnDelta = minuteDelta(current.avgTableTurn, previous.avgTableTurn);

  return [
    {
      label: "Income",
      value: formatCurrency(currentIncome, currency),
      delta: incomeDelta.label,
      deltaTone: incomeDelta.tone,
      caption: "vs previous 30 days",
    },
    {
      label: "Covers",
      value: current.covers.toLocaleString(),
      delta: coversDelta.label,
      deltaTone: coversDelta.tone,
      caption: `avg ${formatCurrency(current.avgSpendPerCover, currency)} / cover`,
    },
    {
      label: "Avg table turn",
      value: current.avgTableTurn === null ? "N/A" : `${Math.round(current.avgTableTurn)} min`,
      delta: turnDelta.label,
      deltaTone: turnDelta.tone,
      caption: current.orders > 0 ? `${current.orders.toLocaleString()} orders tracked` : "No completed order data",
    },
  ];
}

function reservationDayIndex(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
}

function buildHeatmapMatrix(hourLabels: number[], reservations: AnalyticsReservationPoint[]): number[][] {
  const counts = hourLabels.map(() => Array.from({ length: DAY_KEYS.length }, () => 0));

  reservations.forEach((reservation) => {
    const date = new Date(reservation.reserved_at);
    if (Number.isNaN(date.getTime())) return;
    const dayIndex = reservationDayIndex(date);
    const minutes = date.getHours() * 60 + date.getMinutes();
    const hourIndex = hourLabels.findIndex((hour, index) => {
      const next = hourLabels[index + 1] ?? hour + 60;
      return minutes >= hour && minutes < next;
    });
    if (hourIndex < 0) return;
    counts[hourIndex][dayIndex] += 1;
  });

  const maxCount = Math.max(...counts.flat(), 0);
  if (maxCount === 0) return counts;

  return counts.map((row) => row.map((count) => Math.min(4, Math.ceil((count / maxCount) * 4))));
}

const HEAT_FILLS = [
  "color-mix(in srgb, var(--gold) 12%, var(--bg-elevated))",
  "color-mix(in srgb, var(--gold) 28%, var(--bg-elevated))",
  "color-mix(in srgb, var(--gold) 44%, var(--bg-elevated))",
  "color-mix(in srgb, var(--gold) 68%, var(--bg-elevated))",
  "var(--gold)",
];

const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const DEFAULT_OPERATING_HOURS = { open: 17 * 60, close: 23 * 60 };
type OperatingHours = { open: number; close: number };
type DayOperatingHours = OperatingHours | null;

function parseTimeToMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();

  const meridiemMatch = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?$/i.exec(trimmed);
  if (meridiemMatch) {
    let hours = Number(meridiemMatch[1]);
    const minutes = Number(meridiemMatch[2] ?? "0");
    const period = meridiemMatch[3].toLowerCase();
    if (period === "pm" && hours !== 12) hours += 12;
    if (period === "am" && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  const twentyFourHourMatch = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
  if (twentyFourHourMatch) {
    return Number(twentyFourHourMatch[1]) * 60 + Number(twentyFourHourMatch[2]);
  }

  return null;
}

function formatMinutesAsTime(minutes: number): string {
  const normalized = minutes % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return formatCompactTimeLabel(`${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`);
}

function buildOperatingHours(hoursJson: Record<string, unknown> | null | undefined): DayOperatingHours[] {
  const hours = DAY_KEYS.map((day) => {
    const entry = hoursJson?.[day];
    if (!entry || typeof entry !== "object") return null;
    const record = entry as Record<string, unknown>;
    const open = parseTimeToMinutes(record.open);
    const close = parseTimeToMinutes(record.close);
    if (open === null || close === null) return null;
    const adjustedClose = close <= open ? close + 24 * 60 : close;
    return { open, close: adjustedClose };
  });

  return hours.some(Boolean)
    ? hours
    : DAY_KEYS.map(() => DEFAULT_OPERATING_HOURS);
}

function buildHourLabels(operatingHours: DayOperatingHours[]): number[] {
  const openDays = operatingHours.filter((hours): hours is OperatingHours => hours !== null);
  const earliestOpen = Math.min(...openDays.map((hours) => hours.open));
  const latestClose = Math.max(...openDays.map((hours) => hours.close));
  const labels: number[] = [];

  for (let minutes = earliestOpen; minutes <= latestClose; minutes += 60) {
    labels.push(minutes);
  }

  if (labels[labels.length - 1] !== latestClose) labels.push(latestClose);
  return labels;
}

function StatCardCustom({ stat }: { stat: AnalyticsStat }) {
  return (
    <article className="rounded-2xl border border-border bg-bg-surface p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">{stat.label}</p>
      <p className="mt-3 font-serif text-4xl text-white">{stat.value}</p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
        <span className={cn(
          "font-medium",
          stat.deltaTone === "positive" && "text-success",
          stat.deltaTone === "negative" && "text-danger",
          stat.deltaTone === "neutral" && "text-text-muted",
        )}>
          {stat.delta}
        </span>
        <span>{stat.caption}</span>
      </p>
    </article>
  );
}

function IncomeExpensesChart({
  expenses,
  range,
  currency,
  loading,
}: {
  expenses: ExpenseRow[];
  range: AnalyticsDateRange;
  currency: string;
  loading: boolean;
}) {
  const data = useMemo(() => {
    const incomeByDate = new Map<string, number>();
    const expensesByDate = new Map<string, number>();

    expenses.forEach((expense) => {
      const type = expense.transaction_type ?? "expense";
      const key = monthKey(expense.expense_date);
      if (type === "income") {
        incomeByDate.set(
          key,
          (incomeByDate.get(key) ?? 0) + Number(expense.total_amount ?? 0),
        );
      } else {
        expensesByDate.set(
          key,
          (expensesByDate.get(key) ?? 0) + Number(expense.total_amount ?? 0),
        );
      }
    });

    return monthsInRange(range).map((month) => ({
      label: month.label,
      income: incomeByDate.get(month.key) ?? 0,
      expenses: expensesByDate.get(month.key) ?? 0,
    }));
  }, [expenses, range]);
  const hasData = data.some((row) => row.income > 0 || row.expenses > 0);
  const ticks = useMemo(() => chartTicks(data), [data]);

  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl text-white">Income & expenses · by month</h2>
          <p className="mt-1 text-xs text-text-muted">Monthly totals from ledger</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-text-muted">
          {[
            { label: "Income", color: COLORS.income },
            { label: "Expenses", color: COLORS.expenses },
          ].map((entry) => (
            <span key={entry.label} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: entry.color }} />
              {entry.label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-6 h-64">
        {loading && <div className="flex h-full items-center text-sm text-text-muted">Loading income and expenses...</div>}
        {!loading && !hasData && (
          <div className="flex h-full items-center rounded-xl border border-dashed border-border p-4 text-sm text-text-muted">
            No income or expense data found for this monthly range yet.
          </div>
        )}
        {!loading && hasData && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 12, right: 0, left: 0, bottom: 0 }} barCategoryGap={4}>
              <XAxis
                dataKey="label"
                ticks={ticks}
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <YAxis hide />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                contentStyle={{
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                labelStyle={{ color: "var(--text-muted)" }}
                itemStyle={{ color: "var(--text-primary)" }}
                formatter={(value, name) => {
                  const amount = typeof value === "number" ? value : Number(value ?? 0);
                  return [formatCurrency(amount, currency), String(name)];
                }}
              />
              <Bar dataKey="income" fill={COLORS.income} radius={[3, 3, 0, 0]} />
              <Bar dataKey="expenses" fill={COLORS.expenses} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function TopDishes({
  dishes,
  loading,
  currency,
}: {
  dishes: AnalyticsDishPerformance[];
  loading: boolean;
  currency: string;
}) {
  const topRevenue = Math.max(...dishes.map((dish) => dish.revenue), 0);

  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
      <h2 className="font-serif text-2xl text-white">Top dishes</h2>
      <p className="mt-1 text-xs text-text-muted">Paid order income, last 30 days</p>
      <div className="mt-6 space-y-5">
        {loading && <p className="text-sm text-text-muted">Loading menu performance...</p>}
        {!loading && dishes.length === 0 && (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-text-muted">
            No paid dish sales found for the last 30 days yet.
          </p>
        )}
        {!loading && dishes.map((dish) => (
          <div key={dish.name}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-primary">{dish.name}</span>
              <span className="font-mono text-xs text-gold">{formatCurrency(dish.revenue, currency)}</span>
            </div>
            <p className="mt-1 text-[11px] text-text-muted">{dish.quantity.toLocaleString()} sold</p>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
              <div className="h-full rounded-full bg-gold" style={{ width: `${topRevenue > 0 ? (dish.revenue / topRevenue) * 100 : 0}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PeakHoursHeatmap() {
  const { selectedRestaurant } = useRestaurantScope();
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekRange = useMemo(currentWeekRange, []);
  const { reservations, loading } = useAnalyticsReservations(weekRange);
  const operatingHours = useMemo(
    () => buildOperatingHours(selectedRestaurant?.hours_json),
    [selectedRestaurant?.hours_json],
  );
  const hourLabels = useMemo(() => buildHourLabels(operatingHours), [operatingHours]);
  const matrix = useMemo(() => buildHeatmapMatrix(hourLabels, reservations), [hourLabels, reservations]);
  const heatmapRows = useMemo(
    () => hourLabels.map((hour, index) => ({ hour, values: matrix[index] ?? [] })).reverse(),
    [hourLabels, matrix],
  );
  return (
    <section className="w-full rounded-2xl border border-border bg-bg-surface p-4 lg:p-5">
      <div className="w-full">
        <h2 className="font-serif text-xl text-white">Peak hours · this week</h2>
        <div className="mt-5 grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] gap-1">
          <div aria-hidden="true" />
          {days.map((day) => (
            <div key={day} className="text-center font-mono text-[10px] uppercase tracking-wider text-text-muted">
              {day}
            </div>
          ))}
          {heatmapRows.map((row, rIdx) => (
            <div key={row.hour} className="contents">
              <div
                className="flex items-center font-mono text-[10px] text-text-muted"
              >
                {formatMinutesAsTime(row.hour)}
              </div>
              {row.values.map((value, cIdx) => {
                const dayHours = operatingHours[cIdx];
                const isOpenHour = dayHours ? row.hour >= dayHours.open && row.hour < dayHours.close : true;
                return (
                  <div
                    key={`${rIdx}-${cIdx}`}
                    className="aspect-[2/1] rounded border border-border/40"
                    style={{ background: isOpenHour ? HEAT_FILLS[value] ?? HEAT_FILLS[0] : "var(--bg-elevated)", opacity: isOpenHour ? 1 : 0.35 }}
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-center text-[10px] text-text-muted">
          <div className="flex items-center gap-2 font-mono">
            <span>Less</span>
            {HEAT_FILLS.map((fill, i) => (
              <span key={i} className="size-3 rounded-sm border border-border/40" style={{ background: fill }} />
            ))}
            <span>More</span>
          </div>
        </div>
        {!loading && reservations.length === 0 && (
          <p className="mt-3 text-xs text-text-muted">No reservation traffic recorded for this week yet.</p>
        )}
      </div>
    </section>
  );
}

export default function AnalyticsPage() {
  const { selectedRestaurant } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const currentRange = useMemo(currentAnalyticsRange, []);
  const previousRange = useMemo(previousAnalyticsRange, []);
  const chartRange = useMemo(monthlyChartRange, []);
  const { rows, error } = useAnalytics(currentRange);
  const { rows: previousRows } = useAnalytics(previousRange);
  const { dishes, loading: dishesLoading } = useAnalyticsDishPerformance(currentRange);
  const { expenses } = useExpenses({
    dateFrom: currentRange.from,
    dateTo: currentRange.to,
  });
  const { expenses: chartExpenses, loading: chartExpensesLoading } = useExpenses({
    dateFrom: chartRange.from,
    dateTo: chartRange.to,
  });
  const { expenses: previousExpenses } = useExpenses({
    dateFrom: previousRange.from,
    dateTo: previousRange.to,
  });
  const currentSummary = useMemo(() => summarizeAnalytics(rows), [rows]);
  const previousSummary = useMemo(() => summarizeAnalytics(previousRows), [previousRows]);
  const currentIncome = useMemo(() => sumLedgerTransactions(expenses, "income"), [expenses]);
  const previousIncome = useMemo(() => sumLedgerTransactions(previousExpenses, "income"), [previousExpenses]);
  const stats = useMemo(
    () => buildStats(currentSummary, previousSummary, currency, currentIncome, previousIncome),
    [currency, currentIncome, currentSummary, previousIncome, previousSummary],
  );

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="min-w-0"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
          Last 30 days · {currentRange.from} to {currentRange.to}
        </p>
        <h1 className="mt-2 font-serif text-3xl text-white sm:text-4xl">Analytics</h1>
      </motion.header>

      {error && (
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          Could not load analytics: {error.message}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <StatCardCustom key={stat.label} stat={stat} />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <IncomeExpensesChart
            expenses={chartExpenses}
            range={chartRange}
            currency={currency}
            loading={chartExpensesLoading}
          />
        </div>
        <TopDishes dishes={dishes} loading={dishesLoading} currency={currency} />
      </section>

      <section className="grid gap-4">
        <PeakHoursHeatmap />
      </section>
    </AnimatedPage>
  );
}
