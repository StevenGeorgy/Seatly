import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

type BillingInvoice = {
  id: string;
  dateLabel: string;
  amountLabel: string;
  status: "paid" | "open" | "failed";
};

const INVOICES: BillingInvoice[] = [
  { id: "inv-101", dateLabel: "Mar 01", amountLabel: "$299", status: "paid" },
  { id: "inv-102", dateLabel: "Feb 01", amountLabel: "$299", status: "paid" },
  { id: "inv-103", dateLabel: "Jan 02", amountLabel: "$299", status: "paid" },
];

const statusPill = (s: BillingInvoice["status"]) => {
  switch (s) {
    case "paid":
      return "border-success/50 bg-success/10 text-success";
    case "open":
      return "border-warning/50 bg-warning/10 text-warning";
    case "failed":
      return "border-error/50 bg-error-muted/20 text-error";
  }
};

export default function BillingPage({
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
        <PageHeader title="Billing" />
        <LoadingState />
      </div>
    );
  }

  if (empty) {
    return (
      <div>
        <PageHeader title="Billing" />
        <EmptyState
          title="No billing history"
          message="Invoices and plan details will appear here."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Billing" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/billing?state=loading"
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
      <PageHeader title="Billing" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 xl:col-span-5 app-card-elevated p-xl">
          <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
            Current plan (mock)
          </p>

          <div className="mt-md rounded-lg border border-gold/50 bg-gold/10 p-xl">
            <p className="text-sm font-semibold text-text-on-gold">Pro</p>
            <p className="mt-xs text-sm text-text-muted-on-dark">
              Includes AI briefing + full analytics
            </p>
            <p className="mt-md text-2xl font-bold text-gold">$299 / month</p>
          </div>

          <div className="mt-lg flex flex-col gap-md">
            <button
              type="button"
              disabled
              className="rounded-md bg-gold px-lg py-md text-sm font-semibold text-text-on-gold opacity-70 hover:scale-[1.02] transition-transform duration-400"
            >
              Manage in Stripe (coming soon)
            </button>
            <button
              type="button"
              disabled
              className="rounded-md border border-gold px-lg py-md text-sm font-semibold text-gold opacity-70 hover:bg-gold/10 hover:scale-[1.02] transition-transform duration-400"
            >
              Upgrade/downgrade (coming soon)
            </button>
          </div>

          <div className="mt-lg app-card p-xl">
            <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
              Billing notifications (mock)
            </p>
            <p className="mt-xs text-sm text-text-muted-on-dark">
              You will receive invoices and payment updates automatically.
            </p>
          </div>
        </section>

        <section className="col-span-12 xl:col-span-7 app-card-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Billing history
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Downloadable invoices and payment status.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-md">
              <Link
                href="/billing?state=ready"
                className="rounded-md border border-border-card bg-surface-dark px-lg py-sm text-xs font-medium uppercase tracking-widest text-text-muted-on-dark hover:bg-gold/5 hover:text-text-on-dark transition-transform duration-400 hover:scale-[1.02]"
              >
                Refresh (mock)
              </Link>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs uppercase tracking-widest text-text-muted-on-dark">
                  <th className="pb-sm whitespace-nowrap">Invoice</th>
                  <th className="pb-sm whitespace-nowrap">Date</th>
                  <th className="pb-sm whitespace-nowrap">Amount</th>
                  <th className="pb-sm whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-dark/50">
                {INVOICES.map((inv) => (
                  <tr key={inv.id}>
                    <td className="py-sm">
                      <p className="font-semibold text-text-on-dark">{inv.id}</p>
                    </td>
                    <td className="py-sm text-sm text-text-muted-on-dark">
                      {inv.dateLabel}
                    </td>
                    <td className="py-sm text-sm text-text-on-dark">
                      {inv.amountLabel}
                    </td>
                    <td className="py-sm">
                      <div
                        className={`rounded-full border px-sm py-xs text-xs uppercase tracking-widest ${statusPill(
                          inv.status,
                        )}`}
                      >
                        {inv.status}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
