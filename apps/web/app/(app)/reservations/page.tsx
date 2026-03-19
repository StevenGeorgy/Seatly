import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

type ReservationStatus = "confirmed" | "seated" | "cancelled" | "pending";

type Reservation = {
  id: string;
  timeLabel: string;
  guestName: string;
  partySize: number;
  status: ReservationStatus;
  isVip: boolean;
  allergies: string[];
  notes?: string;
};

const RESERVATIONS: Reservation[] = [
  {
    id: "res-1",
    timeLabel: "5:30 PM",
    guestName: "Smith",
    partySize: 4,
    status: "confirmed",
    isVip: true,
    allergies: ["Nuts", "Milk"],
    notes: "Window table if possible.",
  },
  {
    id: "res-2",
    timeLabel: "5:45 PM",
    guestName: "Riley",
    partySize: 2,
    status: "pending",
    isVip: false,
    allergies: ["Gluten"],
  },
  {
    id: "res-3",
    timeLabel: "6:00 PM",
    guestName: "Jones",
    partySize: 3,
    status: "seated",
    isVip: false,
    allergies: [],
    notes: "Asked for low-noise booth.",
  },
  {
    id: "res-4",
    timeLabel: "6:15 PM",
    guestName: "Park",
    partySize: 5,
    status: "confirmed",
    isVip: false,
    allergies: ["Egg"],
  },
  {
    id: "res-5",
    timeLabel: "6:30 PM",
    guestName: "Chen",
    partySize: 2,
    status: "cancelled",
    isVip: true,
    allergies: [],
    notes: "No longer attending.",
  },
];

function getStatusPill(status: ReservationStatus) {
  switch (status) {
    case "confirmed":
      return "border-gold/50 bg-gold/10 text-gold";
    case "seated":
      return "border-success/50 bg-success/10 text-success";
    case "pending":
      return "border-warning/50 bg-warning/10 text-warning";
    case "cancelled":
      return "border-error/50 bg-error-muted/20 text-error";
  }
}

export default function ReservationsPage({
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
        <PageHeader title="Today's Reservations" />
        <LoadingState />
      </div>
    );
  }

  if (empty || RESERVATIONS.length === 0) {
    return (
      <div>
        <PageHeader title="Today's Reservations" />
        <EmptyState
          title="No reservations yet"
          message="When guests book, their reservations appear in this timeline."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Today's Reservations" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/reservations?state=loading"
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
      <PageHeader title="Today's Reservations" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-12 app-card-elevated p-xl">
          <div className="mb-lg flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Timeline
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Bookings ordered by time. Use filters to focus your shift.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-md">
              {[
                ["all", "All"],
                ["confirmed", "Confirmed"],
                ["pending", "Pending"],
                ["seated", "Seated"],
              ].map(([key, label]) => (
                <Link
                  key={key}
                  href={`/reservations?filter=${key}`}
                  className="rounded-md border border-border-card bg-surface-dark px-md py-sm text-xs font-medium uppercase tracking-widest text-text-muted-on-dark hover:bg-gold/5 hover:text-text-on-dark"
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>

          <div className="space-y-md">
            {RESERVATIONS.map((r) => (
              <div
                key={r.id}
                className="app-card p-xl"
              >
                <div className="flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-md">
                      <p className="text-lg font-semibold text-text-on-dark">
                        {r.guestName}
                      </p>
                      <p className="text-sm text-text-muted-on-dark">
                        Party of {r.partySize}
                      </p>
                    </div>
                    <p className="mt-xs text-sm text-text-muted-on-dark">
                      {r.timeLabel}
                      {r.notes ? ` · ${r.notes}` : ""}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-md">
                    <div
                      className={`rounded-full border px-sm py-xs text-xs uppercase tracking-widest ${getStatusPill(r.status)}`}
                    >
                      {r.status}
                    </div>
                    {r.isVip ? (
                      <div className="rounded-full border border-gold px-sm py-xs">
                        <span className="text-xs font-medium uppercase tracking-widest text-gold">
                          VIP
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>

                {r.allergies.length > 0 ? (
                  <div className="mt-md flex flex-wrap gap-sm">
                    {r.allergies.map((a) => (
                      <div
                        key={a}
                        className="rounded-md border-l-4 border-error bg-error-muted px-sm py-xs text-xs font-medium text-error"
                      >
                        {a}
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="mt-md flex flex-col gap-md sm:flex-row sm:items-center sm:justify-end">
                  <button
                    type="button"
                    disabled
                    className="rounded-md bg-gold/10 px-lg py-md text-sm font-semibold text-text-on-gold opacity-70"
                  >
                    View details (coming soon)
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
