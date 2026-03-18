"use client";

import { SectionWithFade } from "./SectionWithFade";
import { LandingSectionLabel } from "./LandingSectionLabel";

const NAV_ITEMS = [
  { label: "Floor", active: true },
  { label: "CRM", active: false },
  { label: "Orders", active: false },
  { label: "Analytics", active: false },
];

const STATS = [
  { label: "Covers tonight", value: "42", accent: "gold" as const },
  { label: "Revenue", value: "$4,280" },
  { label: "VIPs arriving", value: "3", accent: "gold" as const },
  { label: "No-show risk", value: "2 flagged", accent: "red" as const },
];

type TableStatus = "empty" | "seated" | "arriving" | "overdue" | "reserved";

const TABLES: { id: number; status: TableStatus; label: string }[] = [
  { id: 1, status: "empty", label: "" },
  { id: 2, status: "seated", label: "Smith x4" },
  { id: 3, status: "arriving", label: "Arriving 8pm" },
  { id: 4, status: "overdue", label: "Overdue 20m" },
  { id: 5, status: "empty", label: "" },
  { id: 6, status: "seated", label: "Jones x2" },
  { id: 7, status: "reserved", label: "7:30 PM" },
  { id: 8, status: "empty", label: "" },
  { id: 9, status: "seated", label: "Lee x6" },
  { id: 10, status: "empty", label: "" },
  { id: 11, status: "arriving", label: "Arriving 7pm" },
  { id: 12, status: "empty", label: "" },
  { id: 13, status: "seated", label: "Kim x2" },
  { id: 14, status: "seated", label: "Park x4" },
  { id: 15, status: "empty", label: "" },
  { id: 16, status: "overdue", label: "Overdue 15m" },
  { id: 17, status: "empty", label: "" },
  { id: 18, status: "seated", label: "Chen x3" },
];

const LEGEND_ITEMS: { status: TableStatus; label: string }[] = [
  { status: "empty", label: "Empty" },
  { status: "seated", label: "Seated" },
  { status: "arriving", label: "Arriving" },
  { status: "overdue", label: "Overdue" },
  { status: "reserved", label: "Reserved" },
];

function getTableStyles(status: TableStatus) {
  switch (status) {
    case "empty":
      return "bg-floor-plan-empty border-floor-plan-empty-border";
    case "seated":
      return "bg-floor-plan-seated border-floor-plan-seated-border";
    case "arriving":
      return "bg-floor-plan-arriving border-floor-plan-arriving-border";
    case "overdue":
      return "bg-floor-plan-overdue border-floor-plan-overdue-border";
    case "reserved":
      return "bg-floor-plan-reserved border-floor-plan-reserved-border";
  }
}

function getLegendDotStyles(status: TableStatus) {
  return getTableStyles(status);
}

export function LandingDashboardPreview() {
  return (
    <SectionWithFade
      id="dashboard-preview"
      className="border-t border-border-dark/50 bg-surface-dark-alt py-20 lg:py-32"
    >
      <div className="mx-auto max-w-6xl px-xl">
        <div className="mb-3xl flex flex-col items-center text-center">
          <LandingSectionLabel>Built for restaurants</LandingSectionLabel>
          <h2 className="text-4xl font-semibold tracking-tight-section text-text-on-dark">
            Everything in one place
          </h2>
          <p className="mx-auto mt-lg max-w-2xl leading-relaxed text-text-muted-on-dark">
            Your floor plan, guest CRM, orders, and analytics — all live, all in real time
          </p>
        </div>

        <div className="relative">
          <div
            className="absolute -inset-4 rounded-xl bg-gold/5 blur-2xl"
            aria-hidden
          />
          <div className="relative overflow-hidden rounded-lg border border-gold/40 bg-surface-dark shadow-gold-glow">
            <div className="flex min-h-[480px]">
              <aside className="w-48 border-r border-border-dark bg-surface-dark-elevated py-lg">
                <nav className="space-y-xs px-md">
                  {NAV_ITEMS.map((item) => (
                    <div
                      key={item.label}
                      className={`flex items-center gap-sm rounded-md px-md py-sm text-sm ${
                        item.active
                          ? "border-l-2 border-gold bg-gold/10 font-medium text-gold"
                          : "text-text-muted-on-dark"
                      }`}
                    >
                      {item.label}
                    </div>
                  ))}
                </nav>
              </aside>

              <main className="flex-1 p-lg">
                <div className="mb-lg grid grid-cols-4 gap-md">
                  {STATS.map((stat) => (
                    <div
                      key={stat.label}
                      className={`rounded-md border p-md ${
                        stat.accent === "gold"
                          ? "border-gold/50 bg-gold-tint"
                          : stat.accent === "red"
                            ? "border-error/50 bg-error-muted/20"
                            : "border-border-card bg-surface-dark-elevated"
                      }`}
                    >
                      <p className="text-xs text-text-muted-on-dark">{stat.label}</p>
                      <p
                        className={`mt-xs text-xl font-bold ${
                          stat.accent === "gold"
                            ? "text-gold"
                            : stat.accent === "red"
                              ? "text-error"
                              : "text-text-on-dark"
                        }`}
                      >
                        {stat.value}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="rounded-md border border-border-card bg-surface-dark-elevated p-lg">
                  <p className="mb-md text-xs font-medium text-text-muted-on-dark">
                    Floor plan
                  </p>
                  <div className="grid min-h-[280px] grid-cols-6 grid-rows-3 gap-x-lg gap-y-xl">
                    {TABLES.map((table) => (
                      <div
                        key={table.id}
                        className="flex flex-col items-center justify-center gap-xs"
                      >
                        <div
                          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 ${getTableStyles(table.status)}`}
                        >
                          <span className="text-xs font-semibold text-text-on-dark">
                            T{table.id}
                          </span>
                        </div>
                        {table.label && (
                          <span className="max-w-full truncate text-center text-[10px] text-text-muted-on-dark">
                            {table.label}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-lg flex flex-wrap items-center justify-center gap-xl border-t border-border-dark pt-lg">
                    {LEGEND_ITEMS.map((item) => (
                      <div
                        key={item.status}
                        className="flex items-center gap-xs text-xs text-text-muted-on-dark"
                      >
                        <div
                          className={`h-3 w-3 shrink-0 rounded-full border ${getLegendDotStyles(item.status)}`}
                        />
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </main>
            </div>
          </div>
        </div>
      </div>
    </SectionWithFade>
  );
}
