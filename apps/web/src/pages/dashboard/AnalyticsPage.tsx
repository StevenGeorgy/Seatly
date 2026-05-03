import { useMemo } from "react";
import { motion } from "framer-motion";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { cn } from "@/lib/utils";

const STATS = [
  { label: "Revenue", value: "$642,180", delta: "+14.2%", deltaTone: "up" as const, caption: "vs last period" },
  { label: "Covers", value: "7,318", delta: "+8.6%", deltaTone: "up" as const, caption: "avg $87.74 / cover" },
  { label: "Avg table turn", value: "86 min", delta: "-4 min", deltaTone: "down" as const, caption: "target 90" },
  { label: "No-show rate", value: "3.8%", delta: "-1.1%", deltaTone: "down" as const, caption: "industry 6%" },
];

const TOP_DISHES = [
  { name: "Lamb · two ways", value: 18240, pct: 100 },
  { name: "Spring tasting", value: 15890, pct: 87 },
  { name: "Trout · cured", value: 11520, pct: 63 },
  { name: "Asparagus", value: 9840, pct: 54 },
  { name: "Bread service", value: 3420, pct: 19 },
];

const SOURCES = [
  { name: "Cenalva · web", pct: 58, color: "var(--gold)" },
  { name: "Cenalva · mobile", pct: 24, color: "var(--gold)" },
  { name: "Walk-in", pct: 12, color: "var(--info, #6BA4FF)" },
  { name: "Phone", pct: 6, color: "var(--text-muted)" },
];

const COLORS = {
  food: "#C8A951",
  drinks: "#6BA4FF",
  tips: "#62D38B",
};

function buildRevenueSeries() {
  const seed = [62, 70, 74, 75, 73, 38, 41, 36, 32, 40, 60, 70, 74, 78, 82, 84, 80, 65, 60, 56, 60, 64, 68, 72, 72, 70, 68, 70, 76, 78];
  const start = new Date(2026, 2, 28); // Mar 28
  return seed.map((mag, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const food = Math.round(mag * 220);
    const drinks = Math.round(mag * 110);
    const tips = Math.round(mag * 38);
    return {
      label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      food,
      drinks,
      tips,
    };
  });
}

function buildHeatmapMatrix(): number[][] {
  // 7 rows (5p..11p), 7 cols (Mon..Sun) — values 0..4
  return [
    [1, 2, 1, 0, 0, 2, 3],
    [2, 2, 3, 1, 1, 1, 2],
    [1, 1, 0, 2, 3, 2, 1],
    [2, 3, 2, 2, 3, 2, 2],
    [3, 1, 1, 1, 2, 1, 2],
    [1, 1, 1, 2, 1, 1, 2],
    [1, 2, 1, 2, 2, 1, 2],
  ];
}

const HEAT_FILLS = [
  "rgba(200,169,81,0.08)",
  "rgba(200,169,81,0.22)",
  "rgba(200,169,81,0.40)",
  "rgba(200,169,81,0.65)",
  "rgba(200,169,81,0.95)",
];

function StatCardCustom({ stat }: { stat: (typeof STATS)[number] }) {
  return (
    <article className="rounded-2xl border border-border bg-bg-surface p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">{stat.label}</p>
      <p className="mt-3 font-serif text-4xl text-white">{stat.value}</p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-text-muted">
        <span className={cn("font-medium", stat.deltaTone === "up" ? "text-success" : "text-danger")}>
          {stat.delta}
        </span>
        <span>{stat.caption}</span>
      </p>
    </article>
  );
}

function RevenueChart() {
  const data = useMemo(buildRevenueSeries, []);
  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl text-white">Revenue · last 30 days</h2>
          <p className="mt-1 text-xs text-text-muted">Food · Drinks · Tips</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-text-muted">
          {[
            { label: "Food", color: COLORS.food },
            { label: "Drinks", color: COLORS.drinks },
            { label: "Tips", color: COLORS.tips },
          ].map((entry) => (
            <span key={entry.label} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: entry.color }} />
              {entry.label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-6 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 12, right: 0, left: 0, bottom: 0 }} barCategoryGap={4}>
            <XAxis
              dataKey="label"
              ticks={[data[0]?.label, data[10]?.label, data[20]?.label, data[data.length - 1]?.label].filter(Boolean) as string[]}
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
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
                return [`$${amount.toLocaleString()}`, String(name)];
              }}
            />
            <Bar dataKey="food" stackId="rev" fill={COLORS.food} radius={[0, 0, 0, 0]} />
            <Bar dataKey="drinks" stackId="rev" fill={COLORS.drinks} radius={[0, 0, 0, 0]} />
            <Bar dataKey="tips" stackId="rev" fill={COLORS.tips} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function TopDishes() {
  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
      <h2 className="font-serif text-2xl text-white">Top dishes</h2>
      <p className="mt-1 text-xs text-text-muted">By revenue, last 30 days</p>
      <div className="mt-6 space-y-5">
        {TOP_DISHES.map((dish) => (
          <div key={dish.name}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-primary">{dish.name}</span>
              <span className="font-mono text-xs text-gold">${dish.value.toLocaleString()}</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
              <div className="h-full rounded-full bg-gold" style={{ width: `${dish.pct}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PeakHoursHeatmap() {
  const matrix = useMemo(buildHeatmapMatrix, []);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
      <h2 className="font-serif text-2xl text-white">Peak hours · this week</h2>
      <div className="mt-6 grid grid-cols-7 gap-1.5">
        {days.map((day) => (
          <div key={day} className="text-center font-mono text-[10px] uppercase tracking-wider text-text-muted">
            {day}
          </div>
        ))}
        {matrix.map((row, rIdx) =>
          row.map((value, cIdx) => (
            <div
              key={`${rIdx}-${cIdx}`}
              className="aspect-square rounded-md border border-border/40"
              style={{ background: HEAT_FILLS[value] ?? HEAT_FILLS[0] }}
            />
          )),
        )}
      </div>
      <div className="mt-4 flex items-center justify-between text-[10px] text-text-muted">
        <span className="font-mono">5p</span>
        <div className="flex items-center gap-2 font-mono">
          <span>Less</span>
          {HEAT_FILLS.map((fill, i) => (
            <span key={i} className="size-3 rounded-sm border border-border/40" style={{ background: fill }} />
          ))}
          <span>More</span>
        </div>
        <span className="font-mono">11p</span>
      </div>
    </section>
  );
}

function BookingSources() {
  return (
    <section className="rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
      <h2 className="font-serif text-2xl text-white">Booking sources</h2>
      <div className="mt-6 space-y-5">
        {SOURCES.map((src) => (
          <div key={src.name}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-primary">{src.name}</span>
              <span className="font-mono text-xs text-text-muted">{src.pct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
              <div className="h-full rounded-full" style={{ width: `${src.pct}%`, background: src.color }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function AnalyticsPage() {
  return (
    <AnimatedPage className="flex flex-col gap-6">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="min-w-0"
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
          Last 30 days · Apr 28 — Mar 28
        </p>
        <h1 className="mt-2 font-serif text-3xl text-white sm:text-4xl">Analytics</h1>
      </motion.header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <StatCardCustom key={stat.label} stat={stat} />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RevenueChart />
        </div>
        <TopDishes />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <PeakHoursHeatmap />
        <BookingSources />
      </section>
    </AnimatedPage>
  );
}
