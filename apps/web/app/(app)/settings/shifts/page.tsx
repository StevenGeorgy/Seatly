import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

type ShiftPeriod = {
  id: string;
  name: string;
  days: string[];
  start: string;
  end: string;
  slotDurationLabel: string;
};

const SHIFTS: ShiftPeriod[] = [
  {
    id: "sh-1",
    name: "Dinner",
    days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    start: "5:00 PM",
    end: "9:00 PM",
    slotDurationLabel: "30 min slots",
  },
  {
    id: "sh-2",
    name: "Prime",
    days: ["Fri", "Sat", "Sun"],
    start: "6:00 PM",
    end: "10:00 PM",
    slotDurationLabel: "20 min slots",
  },
];

const BLACKOUT_DATES = ["Apr 03", "Apr 14"];

export default function ShiftsPage({
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
        <PageHeader title="Shift Management" />
        <LoadingState />
      </div>
    );
  }

  if (empty) {
    return (
      <div>
        <PageHeader title="Shift Management" />
        <EmptyState
          title="No shifts defined"
          message="Create service periods to enable booking slots."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Shift Management" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/settings/shifts?state=loading"
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
      <PageHeader title="Shift Management" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 xl:col-span-8 app-card-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Service periods
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Edit service windows, slot duration, and blackout dates. (Mock UI)
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-md">
              <button
                type="button"
                disabled
                className="rounded-md bg-gold px-lg py-md text-sm font-semibold text-text-on-gold opacity-70 hover:scale-[1.02] transition-transform duration-400"
              >
                Create shift (coming soon)
              </button>
            </div>
          </div>

          <div className="space-y-md">
            {SHIFTS.map((s) => (
              <article
                key={s.id}
                className="app-card p-xl"
              >
                <div className="flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-md">
                      <p className="text-lg font-semibold text-text-on-dark">
                        {s.name}
                      </p>
                      <div className="rounded-full border border-gold/30 bg-gold/10 px-sm py-xs">
                        <p className="text-xs font-medium uppercase tracking-widest text-gold">
                          {s.slotDurationLabel}
                        </p>
                      </div>
                    </div>
                    <p className="mt-xs text-sm text-text-muted-on-dark">
                      {s.start} - {s.end}
                    </p>
                    <div className="mt-md flex flex-wrap gap-sm">
                      {s.days.map((d) => (
                        <span
                          key={d}
                          className="rounded-md border border-border-dark bg-surface-dark-elevated px-sm py-xs text-xs font-medium uppercase tracking-widest text-text-muted-on-dark"
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-md sm:items-end">
                    <button
                      type="button"
                      disabled
                      className="rounded-md border border-gold px-lg py-md text-sm font-semibold text-gold opacity-70"
                    >
                      Edit shift (coming soon)
                    </button>
                    <button
                      type="button"
                      disabled
                      className="rounded-md bg-gold/10 px-lg py-md text-sm font-semibold text-text-on-gold opacity-70"
                    >
                      Manage slots (coming soon)
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="col-span-12 xl:col-span-4 app-card-elevated p-xl">
          <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
            Blackout dates
          </p>
          <p className="mt-xs text-sm text-text-muted-on-dark">
            Hide bookings for these dates. (Mock list)
          </p>

          <div className="mt-md flex flex-col gap-md">
            {BLACKOUT_DATES.map((d) => (
              <div
                key={d}
                className="rounded-lg border border-error/30 bg-error-muted/20 p-md"
              >
                <p className="text-xs font-medium uppercase tracking-widest text-error">
                  {d}
                </p>
                <p className="mt-xs text-sm text-text-muted-on-dark">
                  Bookings disabled
                </p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
