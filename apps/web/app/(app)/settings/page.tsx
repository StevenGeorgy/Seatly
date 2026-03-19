import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

export default function SettingsPage({
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
        <PageHeader title="Settings" />
        <LoadingState />
      </div>
    );
  }

  if (empty) {
    return (
      <div>
        <PageHeader title="Settings" />
        <EmptyState
          title="No settings configured"
          message="Complete your restaurant profile and booking rules to enable live reservations."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Settings" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/settings?state=loading"
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
      <PageHeader title="Settings" />

      <div className="space-y-lg">
        <section className="app-card-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Restaurant profile
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Mock settings forms. Backend wiring comes next.
              </p>
            </div>
            <button
              type="button"
              disabled
              className="rounded-md bg-gold px-lg py-md text-sm font-semibold text-text-on-gold opacity-70 hover:scale-[1.02] transition-transform duration-400"
            >
              Save (coming soon)
            </button>
          </div>

          <div className="grid grid-cols-12 gap-md">
            <div className="col-span-12 sm:col-span-6">
              <label className="text-xs uppercase tracking-widest text-gold">
                Restaurant name
              </label>
              <input
                disabled
                defaultValue="Seatly Test Kitchen"
                className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
              />
            </div>
            <div className="col-span-12 sm:col-span-6">
              <label className="text-xs uppercase tracking-widest text-gold">
                Cuisine type
              </label>
              <select
                disabled
                defaultValue="Japanese"
                className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
              >
                <option value="Japanese">Japanese</option>
                <option value="Italian">Italian</option>
                <option value="American">American</option>
              </select>
            </div>
            <div className="col-span-12">
              <label className="text-xs uppercase tracking-widest text-gold">
                Booking description
              </label>
              <textarea
                disabled
                rows={4}
                defaultValue="Welcome to Seatly Test Kitchen — real-time reservations, allergy alerts, and a premium guest experience."
                className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
              />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-12 gap-lg">
          <div className="col-span-12 lg:col-span-6 app-card-elevated p-xl">
            <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
              Booking window
            </p>
            <div className="mt-md space-y-md">
              <div>
                <label className="text-xs uppercase tracking-widest text-gold">
                  Advance reservations
                </label>
                <input
                  disabled
                  defaultValue="14 days"
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-widest text-gold">
                  Minimum notice
                </label>
                <input
                  disabled
                  defaultValue="30 minutes"
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
                />
              </div>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-6 app-card-elevated p-xl">
            <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
              Deposit policy (mock)
              </p>
            <div className="mt-md space-y-md">
              <div>
                <label className="text-xs uppercase tracking-widest text-gold">
                  Deposit enabled
                </label>
                <select
                  disabled
                  defaultValue="enabled"
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
                >
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-widest text-gold">
                  Deposit amount
                </label>
                <input
                  disabled
                  defaultValue="$10 per guest"
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-12 gap-lg">
          <div className="col-span-12 lg:col-span-6 app-card-elevated p-xl">
            <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
              Loyalty config (mock)
            </p>
            <div className="mt-md space-y-md">
              <div>
                <label className="text-xs uppercase tracking-widest text-gold">
                  Points per $1
                </label>
                <input
                  disabled
                  defaultValue="10 points"
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-widest text-gold">
                  VIP threshold
                </label>
                <input
                  disabled
                  defaultValue="2500 points"
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
                />
              </div>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-6 app-card-elevated p-xl">
            <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
              Notifications (mock)
            </p>
            <div className="mt-md space-y-md">
              <div>
                <label className="text-xs uppercase tracking-widest text-gold">
                  Email updates
                </label>
                <select
                  disabled
                  defaultValue="enabled"
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
                >
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-widest text-gold">
                  SMS alerts
                </label>
                <select
                  disabled
                  defaultValue="enabled"
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark opacity-70"
                >
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        <section className="app-card p-xl">
          <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
            Next steps
          </p>
          <p className="mt-xs text-sm text-text-muted-on-dark">
            Wire these forms to the exact tables/functions from `SCREENS.md` when you’re ready.
          </p>
          <div className="mt-md flex flex-wrap items-center gap-md">
            <Link
              href="/settings/shifts?state=ready"
              className="rounded-md border border-gold px-lg py-md text-sm font-semibold text-gold hover:bg-gold/10 hover:scale-[1.02] transition-transform duration-400"
            >
              Configure service periods
            </Link>
            <Link
              href="/settings/floor-plan?state=ready"
              className="rounded-md border border-border-card bg-surface-dark px-lg py-md text-sm font-semibold text-text-muted-on-dark hover:bg-gold/5 hover:text-text-on-dark transition-transform duration-400"
            >
              Edit floor plan
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
