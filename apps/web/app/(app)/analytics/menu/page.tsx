import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

type RankedDish = {
  name: string;
  orders: number;
  revenueLabel: string;
  marginLabel: string;
  bestDay: string;
  bestTime: string;
  pairedWith: string;
};

const RANKED_DISHES: RankedDish[] = [
  {
    name: "Spicy Tuna Roll",
    orders: 128,
    revenueLabel: "$4,120",
    marginLabel: "$1,760",
    bestDay: "Friday",
    bestTime: "7:30 PM",
    pairedWith: "Truffle Fries",
  },
  {
    name: "Wood-Grilled Chicken",
    orders: 96,
    revenueLabel: "$3,420",
    marginLabel: "$1,420",
    bestDay: "Saturday",
    bestTime: "6:15 PM",
    pairedWith: "Lemon Ricotta Tart",
  },
  {
    name: "Truffle Fries",
    orders: 88,
    revenueLabel: "$2,980",
    marginLabel: "$1,080",
    bestDay: "Thursday",
    bestTime: "8:10 PM",
    pairedWith: "Citrus Sorbet",
  },
  {
    name: "Braised Short Rib",
    orders: 74,
    revenueLabel: "$3,110",
    marginLabel: "$1,420",
    bestDay: "Sunday",
    bestTime: "7:55 PM",
    pairedWith: "Classic Caesar Salad",
  },
  {
    name: "Margherita Pizza",
    orders: 61,
    revenueLabel: "$2,130",
    marginLabel: "$780",
    bestDay: "Wednesday",
    bestTime: "6:35 PM",
    pairedWith: "Citrus Sorbet",
  },
];

export default function MenuAnalyticsPage({
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

  if (loading) {
    return (
      <div>
        <PageHeader title="Most Ordered Items" />
        <LoadingState />
      </div>
    );
  }

  if (empty) {
    return (
      <div>
        <PageHeader title="Most Ordered Items" />
        <EmptyState
          title="No menu performance data"
          message="Once you have orders, this screen will rank items by orders, revenue, and margin."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Most Ordered Items" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/analytics/menu?state=loading"
            className="mt-lg rounded-md bg-error px-lg py-sm text-sm font-medium text-text-on-gold hover:opacity-90"
          >
            Retry
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Most Ordered Items" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 xl:col-span-9 rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Menu performance
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Ranked by orders and revenue, including margin and best pairing.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-md">
              <Link
                href="/analytics?state=ready"
                className="rounded-md border border-gold px-lg py-sm text-xs font-medium uppercase tracking-widest text-gold hover:bg-gold/10 hover:scale-[1.02] transition-transform duration-400"
              >
                Back to analytics
              </Link>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs uppercase tracking-widest text-text-muted-on-dark">
                  <th className="pb-sm whitespace-nowrap">Dish</th>
                  <th className="pb-sm whitespace-nowrap">Orders</th>
                  <th className="pb-sm whitespace-nowrap">Revenue</th>
                  <th className="pb-sm whitespace-nowrap">Margin</th>
                  <th className="pb-sm whitespace-nowrap">Best day/time</th>
                  <th className="pb-sm whitespace-nowrap">Pairs with</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-dark/50">
                {RANKED_DISHES.map((d) => (
                  <tr key={d.name}>
                    <td className="py-sm">
                      <p className="font-semibold text-text-on-dark">{d.name}</p>
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
                    <td className="py-sm text-sm text-text-muted-on-dark">
                      {d.bestDay} · {d.bestTime}
                    </td>
                    <td className="py-sm text-sm text-text-muted-on-dark">
                      {d.pairedWith}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="col-span-12 xl:col-span-3 rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
          <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
            Insights (mock)
          </p>
          <div className="mt-md space-y-md">
            <div className="rounded-lg border border-border-card bg-surface-dark p-md">
              <p className="text-sm font-semibold text-text-on-dark">
                Best growth opportunity
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Promote paired items during their best day/time windows.
              </p>
            </div>
            <div className="rounded-lg border border-border-card bg-surface-dark p-md">
              <p className="text-sm font-semibold text-text-on-dark">
                Margin highlight
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Short rib and tuna rolls are top margin contributors this
                range.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
