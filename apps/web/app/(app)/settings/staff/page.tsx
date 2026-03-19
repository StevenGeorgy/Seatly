import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

type StaffRole = "owner" | "admin" | "host" | "waiter" | "kitchen";

type StaffMember = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  lastLoginLabel: string;
  clockedIn: boolean;
};

const STAFF: StaffMember[] = [
  {
    id: "s-1",
    name: "Sarah K.",
    email: "sarah@seatly.local",
    role: "host",
    lastLoginLabel: "2h ago",
    clockedIn: true,
  },
  {
    id: "s-2",
    name: "Mike T.",
    email: "mike@seatly.local",
    role: "waiter",
    lastLoginLabel: "9h ago",
    clockedIn: true,
  },
  {
    id: "s-3",
    name: "Alex L.",
    email: "alex@seatly.local",
    role: "waiter",
    lastLoginLabel: "1d ago",
    clockedIn: false,
  },
  {
    id: "s-4",
    name: "Jamie C.",
    email: "jamie@seatly.local",
    role: "kitchen",
    lastLoginLabel: "3h ago",
    clockedIn: true,
  },
];

export default function StaffPage({
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
        <PageHeader title="Staff Management" />
        <LoadingState />
      </div>
    );
  }

  if (empty) {
    return (
      <div>
        <PageHeader title="Staff Management" />
        <EmptyState
          title="No staff profiles"
          message="Add staff to start managing roles and scheduling."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Staff Management" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/settings/staff?state=loading"
            className="mt-lg rounded-md bg-error px-lg py-sm text-sm font-medium text-text-on-gold hover:opacity-90"
          >
            Retry
          </Link>
        </div>
      </div>
    );
  }

  const clockPill = (clockedIn: boolean) =>
    clockedIn
      ? "border-gold/50 bg-gold/10 text-gold"
      : "border-border-dark bg-surface-dark-elevated text-text-muted-on-dark";

  return (
    <div>
      <PageHeader title="Staff Management" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 app-card-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Staff profiles
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Assign roles and review who is clocked in tonight. (Mock UI)
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-md">
              <button
                type="button"
                disabled
                className="rounded-md bg-gold px-lg py-md text-sm font-semibold text-text-on-gold opacity-70 hover:scale-[1.02] transition-transform duration-400"
              >
                Add staff (coming soon)
              </button>
            </div>
          </div>

          <div className="space-y-md">
            {STAFF.map((m) => (
              <article
                key={m.id}
                className="app-card p-xl"
              >
                <div className="flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-md">
                      <p className="text-lg font-semibold text-text-on-dark">
                        {m.name}
                      </p>
                      <div className="rounded-full border border-gold/30 bg-gold/10 px-sm py-xs">
                        <span className="text-xs font-medium uppercase tracking-widest text-gold">
                          {m.role}
                        </span>
                      </div>
                      <div
                        className={`rounded-full border px-sm py-xs text-xs uppercase tracking-widest ${clockPill(
                          m.clockedIn,
                        )}`}
                      >
                        {m.clockedIn ? "Clocked in" : "Off shift"}
                      </div>
                    </div>
                    <p className="mt-xs text-sm text-text-muted-on-dark">
                      {m.email} · Last login {m.lastLoginLabel}
                    </p>
                  </div>

                  <div className="flex flex-col gap-md sm:items-end">
                    <button
                      type="button"
                      disabled
                      className="rounded-md border border-gold px-lg py-md text-sm font-semibold text-gold opacity-70 hover:bg-gold/10 hover:scale-[1.02] transition-transform duration-400"
                    >
                      Edit profile (mock)
                    </button>
                    <Link
                      href="/staff/schedule?state=ready"
                      className="rounded-md border border-border-card bg-surface-dark px-lg py-md text-sm font-semibold text-text-muted-on-dark hover:bg-gold/5 hover:text-text-on-dark transition-transform duration-400"
                    >
                      View schedule
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
