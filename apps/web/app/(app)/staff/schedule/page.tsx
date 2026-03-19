import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

type Availability = {
  id: string;
  day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  shiftLabel: string;
  assignedStaff: string[];
};

const WEEK_AVAILABILITY: Availability[] = [
  {
    id: "a-1",
    day: "Mon",
    shiftLabel: "Dinner · 5:00–9:00",
    assignedStaff: ["Sarah K.", "Alex L."],
  },
  {
    id: "a-2",
    day: "Tue",
    shiftLabel: "Dinner · 5:00–9:00",
    assignedStaff: ["Mike T.", "Alex L."],
  },
  {
    id: "a-3",
    day: "Wed",
    shiftLabel: "Dinner · 5:00–9:00",
    assignedStaff: ["Sarah K.", "Mike T.", "Jamie C."],
  },
  {
    id: "a-4",
    day: "Thu",
    shiftLabel: "Dinner · 5:00–9:00",
    assignedStaff: ["Mike T.", "Jamie C."],
  },
  {
    id: "a-5",
    day: "Fri",
    shiftLabel: "Prime · 6:00–10:00",
    assignedStaff: ["Sarah K.", "Mike T.", "Alex L."],
  },
  {
    id: "a-6",
    day: "Sat",
    shiftLabel: "Prime · 6:00–10:00",
    assignedStaff: ["Sarah K.", "Jamie C."],
  },
];

const DAYS: Availability["day"][] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function StaffSchedulePage({
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
        <PageHeader title="Staff Scheduling" />
        <LoadingState />
      </div>
    );
  }

  if (empty) {
    return (
      <div>
        <PageHeader title="Staff Scheduling" />
        <EmptyState
          title="Schedule is empty"
          message="Assign staff to shifts to populate the weekly view."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Staff Scheduling" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/staff/schedule?state=loading"
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
      <PageHeader title="Staff Scheduling" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Weekly calendar (mock)
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Drag-and-drop scheduling will connect later.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-md">
              <Link
                href="/settings/shifts?state=ready"
                className="rounded-md border border-gold px-lg py-sm text-xs font-medium uppercase tracking-widest text-gold hover:bg-gold/10 hover:scale-[1.02] transition-transform duration-400"
              >
                Manage service periods
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-md">
            {DAYS.map((d) => {
              const entries = WEEK_AVAILABILITY.filter((a) => a.day === d);
              return (
                <div key={d} className="rounded-lg border border-border-card bg-surface-dark p-xl">
                  <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                    {d}
                  </p>
                  <div className="mt-md flex flex-col gap-md">
                    {entries.length > 0 ? (
                      entries.map((e) => (
                        <div
                          key={e.id}
                          className="rounded-md border border-border-dark bg-surface-dark-elevated p-md"
                        >
                          <p className="text-sm font-semibold text-text-on-dark">
                            {e.shiftLabel}
                          </p>
                          <div className="mt-xs flex flex-wrap gap-sm">
                            {e.assignedStaff.map((s) => (
                              <span
                                key={s}
                                className="rounded-md border border-gold/30 bg-gold/10 px-sm py-xs text-xs font-medium text-gold"
                              >
                                {s.split(" ")[0]}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-md border border-border-card bg-surface-dark p-md text-sm text-text-muted-on-dark">
                        No shifts assigned
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
