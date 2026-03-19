import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

type ChartRange = "today" | "week" | "month" | "year";

const TOP_DISHES = [
  { name: "Spicy Tuna Roll", orders: 28, revenueLabel: "$980", marginLabel: "$420" },
  { name: "Truffle Fries", orders: 24, revenueLabel: "$860", marginLabel: "$360" },
  { name: "Wood-Grilled Chicken", orders: 20, revenueLabel: "$1,120", marginLabel: "$510" },
  { name: "Lemon Ricotta Tart", orders: 17, revenueLabel: "$740", marginLabel: "$250" },
  { name: "Braised Short Rib", orders: 15, revenueLabel: "$1,040", marginLabel: "$460" },
  { name: "Classic Caesar Salad", orders: 13, revenueLabel: "$520", marginLabel: "$210" },
  { name: "Margherita Pizza", orders: 11, revenueLabel: "$610", marginLabel: "$260" },
  { name: "Citrus Sorbet", orders: 9, revenueLabel: "$260", marginLabel: "$110" },
];

export default function AnalyticsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const stateParam = searchParams.state;
  const state =
    typeof stateParam === "string"
      ? stateParam
      : Array.isArray(stateParam)
        ? stateParam[0]
        : undefined;

  const loading = state === "loading";
  const empty = state === "empty";
  const error = state === "error";

  const rangeParam = searchParams.range;
  const range =
    typeof rangeParam === "string"
      ? (rangeParam as ChartRange)
      : Array.isArray(rangeParam)
        ? (rangeParam[0] as ChartRange)
        : "week";

  if (loading) {
    return (
      <div>
        <PageHeader title="Analytics Dashboard" />
        <LoadingState />
      </div>
    );
  }

  if (empty) {
    return (
      <div>
        <PageHeader title="Analytics Dashboard" />
        <EmptyState
          title="No analytics yet"
          message="Analytics will appear once your restaurant has sufficient data."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Analytics Dashboard" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/analytics?state=loading"
            className="mt-lg rounded-md bg-error px-lg py-sm text-sm font-medium text-text-on-gold hover:opacity-90"
          >
            Retry
          </Link>
        </div>
      </div>
    );
  }

  const rangeOptions: { key: ChartRange; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "week", label: "This week" },
    { key: "month", label: "This month" },
    { key: "year", label: "This year" },
  ];

  const barWidthClass = (valuePercent: number) => {
    if (valuePercent >= 45) return "w-11/12";
    if (valuePercent >= 35) return "w-9/12";
    if (valuePercent >= 25) return "w-7/12";
    return "w-5/12";
  };

  return (
    <div>
      <PageHeader title="Analytics Dashboard" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 xl:col-span-8 rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Revenue & operations
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Mock analytics charts — swap with real data later.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-md">
              {rangeOptions.map((opt) => {
                const isActive = opt.key === range;
                return (
                  <Link
                    key={opt.key}
                    href={`/analytics?range=${opt.key}`}
                    className={`rounded-md border px-md py-sm text-xs font-medium uppercase tracking-widest transition-transform duration-400 hover:scale-[1.02] ${
                      isActive
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-border-card bg-surface-dark text-text-muted-on-dark hover:bg-gold/5 hover:text-text-on-dark"
                    }`}
                  >
                    {opt.label}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-12 gap-md">
            <div className="col-span-12 lg:col-span-6 rounded-lg border border-border-card bg-surface-dark p-xl">
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Revenue line (placeholder)
              </p>
              <div className="mt-md grid grid-cols-12 gap-xs">
                {new Array(12).fill(null).map((_, i) => {
                  const isTall = i % 3 !== 0;
                  return (
                    <div
                      key={i}
                      className={`rounded-sm bg-gold-glass/30 ${isTall ? "h-10" : "h-6"}`}
                    />
                  );
                })}
              </div>
            </div>

            <div className="col-span-12 lg:col-span-6 rounded-lg border border-border-card bg-surface-dark p-xl">
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                No-show rate (placeholder)
              </p>
              <div className="mt-md grid grid-cols-2 gap-md">
                {[
                  { label: "Today", value: "6.2%" },
                  { label: "Last week", value: "8.9%" },
                ].map((m) => (
                  <div
                    key={m.label}
                    className="rounded-lg border border-border-card bg-surface-dark-elevated p-md"
                  >
                    <p className="text-xs text-text-muted-on-dark">{m.label}</p>
                    <p className="mt-xs text-lg font-bold text-text-on-dark">
                      {m.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="col-span-12 rounded-lg border border-border-card bg-surface-dark p-xl">
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Top 10 dishes (preview)
              </p>
              <div className="mt-md overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs uppercase tracking-widest text-text-muted-on-dark">
                      <th className="pb-sm whitespace-nowrap">Dish</th>
                      <th className="pb-sm whitespace-nowrap">Orders</th>
                      <th className="pb-sm whitespace-nowrap">Revenue</th>
                      <th className="pb-sm whitespace-nowrap">Margin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-dark/50">
                    {TOP_DISHES.map((d) => (
                      <tr key={d.name}>
                        <td className="py-sm">
                          <p className="font-semibold text-text-on-dark">
                            {d.name}
                          </p>
                        </td>
                        <td className="py-sm text-sm text-text-muted-on-dark">
                          {d.orders}
                        </td>
                        <td className="py-sm text-sm text-text-on-dark">
                          {d.revenueLabel}
                        </td>
                        <td className="py-sm text-sm text-text-muted-on-dark">
                          {d.marginLabel}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-lg">
                <Link
                  href="/analytics/menu"
                  className="rounded-md border border-gold px-lg py-md text-sm font-semibold text-gold hover:bg-gold/10 hover:scale-[1.02] transition-transform duration-400"
                >
                  View full menu analytics
                </Link>
              </div>
            </div>
          </div>
        </section>

        <aside className="col-span-12 xl:col-span-4 rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
          <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
            Booking sources (placeholder)
          </p>
          <p className="mt-xs text-sm text-text-muted-on-dark">
            Mock breakdown for this range.
          </p>

          <div className="mt-md space-y-md">
            {[
              { label: "Direct", value: 46 },
              { label: "Online travel", value: 28 },
              { label: "Walk-ins", value: 16 },
              { label: "Phone", value: 10 },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-border-card bg-surface-dark p-md">
                <div className="flex items-center justify-between gap-md">
                  <p className="text-sm font-semibold text-text-on-dark">{s.label}</p>
                  <p className="text-sm text-text-muted-on-dark">{s.value}%</p>
                </div>
                <div className="mt-sm h-2 w-full rounded-full bg-border-dark/50 overflow-hidden">
                  <div
                    className={`h-2 bg-gold/30 ${barWidthClass(s.value)}`}
                    aria-hidden
                  />
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
