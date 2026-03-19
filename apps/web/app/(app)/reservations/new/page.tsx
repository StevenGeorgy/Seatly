import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";
import { PAGE_HEADERS } from "@/lib/page-headers";

export default function NewReservationPage({
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
        <PageHeader {...PAGE_HEADERS.newReservation} />
        <LoadingState />
      </div>
    );
  }

  if (empty) {
    return (
      <div>
        <PageHeader {...PAGE_HEADERS.newReservation} />
        <EmptyState
          title="Nothing to show"
          message="Open the reservation form to capture the guest details."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader {...PAGE_HEADERS.newReservation} />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/reservations/new?state=loading"
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
      <PageHeader {...PAGE_HEADERS.newReservation} />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 app-card-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Guest details
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Collect the reservation details from the caller. (Mock UI)
              </p>
            </div>

            <div className="rounded-lg border border-border-card bg-surface-dark p-md">
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Status
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Creating reservations will be connected to backend next.
              </p>
            </div>
          </div>

          <form action="#">
            <div className="grid grid-cols-12 gap-md">
              <div className="col-span-12 sm:col-span-6">
                <label className="text-xs uppercase tracking-widest text-gold">
                  Full name
                </label>
                <input
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark focus:border-gold focus:ring-1 focus:ring-gold"
                  defaultValue=""
                  placeholder="e.g., Alex Johnson"
                />
              </div>

              <div className="col-span-12 sm:col-span-6">
                <label className="text-xs uppercase tracking-widest text-gold">
                  Phone number
                </label>
                <input
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark focus:border-gold focus:ring-1 focus:ring-gold"
                  defaultValue=""
                  placeholder="e.g., (555) 123-4567"
                />
              </div>

              <div className="col-span-12 sm:col-span-4">
                <label className="text-xs uppercase tracking-widest text-gold">
                  Party size
                </label>
                <select
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark focus:border-gold focus:ring-1 focus:ring-gold"
                  defaultValue="2"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-12 sm:col-span-4">
                <label className="text-xs uppercase tracking-widest text-gold">
                  Date
                </label>
                <input
                  type="date"
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark focus:border-gold focus:ring-1 focus:ring-gold"
                  defaultValue=""
                />
              </div>

              <div className="col-span-12 sm:col-span-4">
                <label className="text-xs uppercase tracking-widest text-gold">
                  Time
                </label>
                <select
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark focus:border-gold focus:ring-1 focus:ring-gold"
                  defaultValue="19:30"
                >
                  {["17:30", "17:45", "18:00", "18:15", "18:30", "19:00", "19:30"].map(
                    (t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ),
                  )}
                </select>
              </div>

              <div className="col-span-12 sm:col-span-6">
                <label className="text-xs uppercase tracking-widest text-gold">
                  Occasion
                </label>
                <select
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark focus:border-gold focus:ring-1 focus:ring-gold"
                  defaultValue="none"
                >
                  {["none", "birthday", "anniversary", "date night", "business"].map(
                    (o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ),
                  )}
                </select>
              </div>

              <div className="col-span-12 sm:col-span-6">
                <label className="text-xs uppercase tracking-widest text-gold">
                  Allergies (optional)
                </label>
                <input
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark focus:border-gold focus:ring-1 focus:ring-gold"
                  defaultValue=""
                  placeholder="e.g., Nuts, Shellfish"
                />
              </div>

              <div className="col-span-12">
                <label className="text-xs uppercase tracking-widest text-gold">
                  Special request
                </label>
                <textarea
                  rows={4}
                  className="mt-xs w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark focus:border-gold focus:ring-1 focus:ring-gold"
                  placeholder="Seating preference, noise level, access needs, etc."
                  defaultValue=""
                />
              </div>
            </div>

            <div className="mt-lg flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between">
              <div className="rounded-lg border border-border-card bg-surface-dark p-md">
                <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                  Reminder
                </p>
                <p className="mt-xs text-sm text-text-muted-on-dark">
                  Confirm allergy details before confirming the table.
                </p>
              </div>

              <button
                type="button"
                disabled
                className="rounded-md bg-gold px-lg py-md text-sm font-semibold text-text-on-gold hover:scale-[1.02] transition-transform duration-400 opacity-70"
              >
                Create reservation (coming soon)
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
