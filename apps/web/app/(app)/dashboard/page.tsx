import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

type NoShowFlag = {
  label: string;
  risk: "low" | "medium" | "high";
  guestName: string;
};

type VipArriving = {
  name: string;
  eta: string;
  partySize: number;
};

const VIP_ARRIVING: VipArriving[] = [
  { name: "Smith", eta: "7:15 PM", partySize: 4 },
  { name: "Chen", eta: "8:00 PM", partySize: 3 },
  { name: "Park", eta: "8:45 PM", partySize: 2 },
];

const NO_SHOW_FLAGS: NoShowFlag[] = [
  { label: "High risk", risk: "high", guestName: "Lee" },
  { label: "Medium risk", risk: "medium", guestName: "Riley" },
  { label: "Low risk", risk: "low", guestName: "Jordan" },
];

export default function DashboardPage({
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
        <PageHeader title="Owner Dashboard" />
        <LoadingState />
      </div>
    );
  }

  if (empty) {
    return (
      <div>
        <PageHeader title="Owner Dashboard" />
        <EmptyState
          title="No dashboard data yet"
          message="Once your restaurant begins taking reservations, today’s metrics and AI briefing will appear here."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Owner Dashboard" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/dashboard?state=loading"
            className="mt-lg rounded-md bg-error px-lg py-sm text-sm font-medium text-text-on-gold hover:opacity-90"
          >
            Retry
          </Link>
        </div>
      </div>
    );
  }

  const riskClass = (risk: NoShowFlag["risk"]) => {
    switch (risk) {
      case "high":
        return "border-error/50 bg-error-muted/20 text-error";
      case "medium":
        return "border-warning/50 bg-warning/10 text-warning";
      case "low":
        return "border-success/50 bg-success/10 text-success";
    }
  };

  return (
    <div>
      <PageHeader title="Owner Dashboard" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 lg:col-span-8 rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Today at a glance
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Covers, revenue snapshot, VIP arrivals, and no-show risk flags.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-md">
              <div className="rounded-md border border-border-card bg-surface-dark px-md py-sm text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Live preview
              </div>
              <Link
                href="/ai"
                className="rounded-md border border-gold px-lg py-sm text-xs font-medium uppercase tracking-widest text-gold hover:bg-gold/10 hover:scale-[1.02] transition-transform duration-400"
              >
                Open AI briefing
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-md md:grid-cols-4">
            <div className="rounded-lg border border-border-card bg-surface-dark p-xl">
              <p className="text-xs text-text-muted-on-dark">Covers tonight</p>
              <p className="mt-xs text-xl font-bold text-gold">42</p>
            </div>
            <div className="rounded-lg border border-border-card bg-surface-dark p-xl">
              <p className="text-xs text-text-muted-on-dark">Revenue so far</p>
              <p className="mt-xs text-xl font-bold text-text-on-dark">$3,940</p>
            </div>
            <div className="rounded-lg border border-border-card bg-surface-dark p-xl">
              <p className="text-xs text-text-muted-on-dark">VIPs arriving</p>
              <p className="mt-xs text-xl font-bold text-gold">3</p>
            </div>
            <div className="rounded-lg border border-border-card bg-surface-dark p-xl">
              <p className="text-xs text-text-muted-on-dark">No-show risk flagged</p>
              <p className="mt-xs text-xl font-bold text-error">2</p>
            </div>
          </div>

          <div className="mt-lg grid grid-cols-12 gap-lg">
            <div className="col-span-12 lg:col-span-6 rounded-lg border border-border-card bg-surface-dark p-xl">
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                VIPs arriving
              </p>
              <div className="mt-md space-y-md">
                {VIP_ARRIVING.map((v) => (
                  <div
                    key={v.name}
                    className="flex items-center justify-between gap-md rounded-md border border-border-dark bg-surface-dark-elevated px-md py-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text-on-dark">
                        {v.name}
                      </p>
                      <p className="mt-1 text-xs text-text-muted-on-dark">
                        ETA {v.eta} · Party {v.partySize}
                      </p>
                    </div>
                    <div className="rounded-full border border-gold px-sm py-xs">
                      <span className="text-xs font-medium uppercase tracking-widest text-gold">
                        VIP
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="col-span-12 lg:col-span-6 rounded-lg border border-border-card bg-surface-dark p-xl">
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                No-show risk flags
              </p>
              <div className="mt-md space-y-md">
                {NO_SHOW_FLAGS.map((f) => (
                  <div
                    key={f.guestName}
                    className="flex items-center justify-between gap-md rounded-md border border-border-dark bg-surface-dark-elevated px-md py-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text-on-dark">
                        {f.guestName}
                      </p>
                      <p className="mt-1 text-xs text-text-muted-on-dark">
                        {f.label}
                      </p>
                    </div>
                    <div
                      className={`rounded-full border px-sm py-xs text-xs font-medium uppercase tracking-widest ${riskClass(
                        f.risk,
                      )}`}
                    >
                      {f.risk}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <aside className="col-span-12 lg:col-span-4">
          <div className="rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
            <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
              AI shift briefing
            </p>
            <p className="mt-xs text-sm text-text-muted-on-dark">
              A quick, actionable briefing for tonight’s service.
            </p>

            <div className="mt-md space-y-md">
              <div className="rounded-lg border border-border-card bg-surface-dark p-xl">
                <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                  Priority
                </p>
                <p className="mt-xs text-sm text-text-on-dark">
                  Confirm allergy notes and keep an eye on high no-show risk guests.
                </p>
              </div>

              <div className="rounded-lg border border-border-card bg-surface-dark p-xl">
                <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                  Suggested table flow
                </p>
                <p className="mt-xs text-sm text-text-muted-on-dark">
                  Seat VIP arrivals early; avoid overdue tables receiving additional walk-ins.
                </p>
              </div>

              <div className="flex items-center justify-between gap-md pt-md">
                <Link
                  href="/ai?state=ready"
                  className="rounded-md bg-gold px-lg py-md text-sm font-semibold text-text-on-gold hover:scale-[1.02] transition-transform duration-400"
                >
                  Ask AI for actions
                </Link>
                <Link
                  href="/analytics?state=ready"
                  className="rounded-md border border-gold px-lg py-md text-sm font-semibold text-gold hover:bg-gold/10 hover:scale-[1.02] transition-transform duration-400"
                >
                  View metrics
                </Link>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
