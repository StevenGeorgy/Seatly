import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";
import { PAGE_HEADERS } from "@/lib/page-headers";

type EventStatus = "draft" | "live" | "ended";

type EventCard = {
  id: string;
  name: string;
  dateLabel: string;
  status: EventStatus;
  capacity: number;
  sold: number;
  revenueLabel: string;
};

const EVENTS: EventCard[] = [
  {
    id: "e-1",
    name: "Sushi Night",
    dateLabel: "Fri · Mar 28",
    status: "live",
    capacity: 60,
    sold: 42,
    revenueLabel: "$1,680",
  },
  {
    id: "e-2",
    name: "Italian Wine Pairing",
    dateLabel: "Sat · Apr 12",
    status: "draft",
    capacity: 40,
    sold: 0,
    revenueLabel: "$0",
  },
  {
    id: "e-3",
    name: "Chef’s Tasting Menu",
    dateLabel: "Sun · Apr 20",
    status: "ended",
    capacity: 50,
    sold: 50,
    revenueLabel: "$2,250",
  },
];

export default function EventsPage({
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
        <PageHeader {...PAGE_HEADERS.events} />
        <LoadingState />
      </div>
    );
  }

  if (empty) {
    return (
      <div>
        <PageHeader {...PAGE_HEADERS.events} />
        <EmptyState
          title="No events yet"
          message="Create your first event to start collecting ticket reservations."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader {...PAGE_HEADERS.events} />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/events?state=loading"
            className="mt-lg rounded-md bg-error px-lg py-sm text-sm font-medium text-text-on-gold hover:opacity-90"
          >
            Retry
          </Link>
        </div>
      </div>
    );
  }

  const statusPill = (s: EventStatus) => {
    switch (s) {
      case "live":
        return "border-gold/50 bg-gold/10 text-gold";
      case "draft":
        return "border-border-dark bg-surface-dark-elevated text-text-muted-on-dark";
      case "ended":
        return "border-success/50 bg-success/10 text-success";
    }
  };

  const soldPercent = (e: EventCard) =>
    e.capacity <= 0 ? 0 : Math.round((e.sold / e.capacity) * 100);

  const barWidthClass = (valuePercent: number) => {
    if (valuePercent >= 80) return "w-11/12";
    if (valuePercent >= 60) return "w-9/12";
    if (valuePercent >= 40) return "w-7/12";
    return "w-5/12";
  };

  return (
    <div>
      <PageHeader {...PAGE_HEADERS.events} />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 app-card-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Upcoming events
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Ticket sales overview + mock revenue preview.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-md">
              <button
                type="button"
                disabled
                className="rounded-md bg-gold px-lg py-md text-sm font-semibold text-text-on-gold opacity-70 hover:scale-[1.02] transition-transform duration-400"
              >
                Create event (coming soon)
              </button>
            </div>
          </div>

          <div className="space-y-md">
            {EVENTS.map((e) => (
              <article
                key={e.id}
                className="app-card p-xl"
              >
                <div className="flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-md">
                      <p className="text-lg font-semibold text-text-on-dark">
                        {e.name}
                      </p>
                      <div
                        className={`rounded-full border px-sm py-xs text-xs uppercase tracking-widest ${statusPill(
                          e.status,
                        )}`}
                      >
                        {e.status}
                      </div>
                    </div>
                    <p className="mt-xs text-sm text-text-muted-on-dark">
                      {e.dateLabel} · Capacity {e.capacity}
                    </p>
                  </div>

                  <div className="flex flex-col gap-md sm:items-end">
                    <p className="text-sm text-text-muted-on-dark">
                      Revenue (mock)
                    </p>
                    <p className="text-lg font-bold text-text-on-dark">
                      {e.revenueLabel}
                    </p>
                  </div>
                </div>

                <div className="mt-md rounded-lg border border-border-dark bg-surface-dark-elevated p-md">
                  <div className="flex items-center justify-between gap-md">
                    <p className="text-sm font-medium text-text-muted-on-dark">
                      Tickets sold
                    </p>
                    <p className="text-sm font-semibold text-text-on-dark">
                      {e.sold} / {e.capacity} · {soldPercent(e)}%
                    </p>
                  </div>
                  <div className="mt-sm h-2 w-full overflow-hidden rounded-full bg-border-dark/50">
                    <div
                      className={`h-2 bg-gold/30 ${barWidthClass(
                        soldPercent(e),
                      )}`}
                      aria-hidden
                    />
                  </div>
                </div>

                <div className="mt-md flex flex-col gap-md sm:flex-row sm:items-center sm:justify-end">
                  <Link
                    href={`/events?state=ready&event=${e.id}`}
                    className="rounded-md border border-gold px-lg py-md text-sm font-semibold text-gold hover:bg-gold/10 hover:scale-[1.02] transition-transform duration-400"
                  >
                    View details (mock)
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
