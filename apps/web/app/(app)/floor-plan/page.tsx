import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";

type TableStatus = "empty" | "seated" | "arriving" | "overdue" | "reserved";

type FloorTable = {
  id: number;
  status: TableStatus;
  label?: string;
};

type ArrivalGuest = {
  tableLabel: string;
  guestName: string;
  partySize: number;
  isVip: boolean;
  allergies: string[];
  seatingPreference: string;
  noisePreference: string;
  lastVisitLabel: string;
};

const getTableStyles = (status: TableStatus) => {
  switch (status) {
    case "empty":
      return "bg-floor-plan-empty border-floor-plan-empty-border";
    case "seated":
      return "bg-floor-plan-seated border-floor-plan-seated-border";
    case "arriving":
      return "bg-floor-plan-arriving border-floor-plan-arriving-border";
    case "overdue":
      return "bg-floor-plan-overdue border-floor-plan-overdue-border";
    case "reserved":
      return "bg-floor-plan-reserved border-floor-plan-reserved-border";
  }
};

const TABLES: FloorTable[] = [
  { id: 1, status: "empty" },
  { id: 2, status: "seated", label: "Smith x4" },
  { id: 3, status: "arriving", label: "Arriving 8pm" },
  { id: 4, status: "empty" },
  { id: 5, status: "seated", label: "Jones x2" },
  { id: 6, status: "overdue", label: "Overdue 20m" },
  { id: 7, status: "reserved", label: "7:30 PM" },
  { id: 8, status: "empty" },
  { id: 9, status: "seated", label: "Lee x6" },
  { id: 10, status: "empty" },
  { id: 11, status: "arriving", label: "Arriving 7pm" },
  { id: 12, status: "empty" },
];

const GUEST_BY_TABLE_ID: Record<number, ArrivalGuest> = {
  2: {
    tableLabel: "Table 2",
    guestName: "Smith",
    partySize: 4,
    isVip: true,
    allergies: ["Nuts", "Milk"],
    seatingPreference: "Window",
    noisePreference: "Low",
    lastVisitLabel: "Last visit: 42 days ago",
  },
  3: {
    tableLabel: "Table 3",
    guestName: "Riley",
    partySize: 2,
    isVip: false,
    allergies: ["Gluten"],
    seatingPreference: "Booth",
    noisePreference: "Balanced",
    lastVisitLabel: "Last visit: 11 months ago",
  },
  5: {
    tableLabel: "Table 5",
    guestName: "Jones",
    partySize: 2,
    isVip: false,
    allergies: [],
    seatingPreference: "Open floor",
    noisePreference: "High",
    lastVisitLabel: "Last visit: 7 days ago",
  },
  6: {
    tableLabel: "Table 6",
    guestName: "Chen",
    partySize: 3,
    isVip: true,
    allergies: ["Shellfish"],
    seatingPreference: "Corner",
    noisePreference: "Low",
    lastVisitLabel: "Last visit: 3 months ago",
  },
  9: {
    tableLabel: "Table 9",
    guestName: "Lee",
    partySize: 6,
    isVip: false,
    allergies: ["Egg"],
    seatingPreference: "Center",
    noisePreference: "Balanced",
    lastVisitLabel: "Last visit: 18 days ago",
  },
  11: {
    tableLabel: "Table 11",
    guestName: "Park",
    partySize: 2,
    isVip: false,
    allergies: [],
    seatingPreference: "Booth",
    noisePreference: "Low",
    lastVisitLabel: "Last visit: 5 months ago",
  },
};

export default function FloorPlanPage({
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

  const empty = state === "empty" || searchParams.empty === "1";
  const loading = state === "loading";
  const error = state === "error" || searchParams.error === "1";

  const selectedTableIdParam = searchParams.table;
  const selectedTableId =
    typeof selectedTableIdParam === "string"
      ? Number(selectedTableIdParam)
      : Array.isArray(selectedTableIdParam)
        ? Number(selectedTableIdParam[0])
        : null;

  const selectedGuest = selectedTableId
    ? GUEST_BY_TABLE_ID[selectedTableId] ?? null
    : null;

  if (loading) {
    return (
      <div>
        <PageHeader title="Live Floor Plan" />
        <LoadingState />
      </div>
    );
  }

  if (empty) {
    return (
      <div>
        <PageHeader title="Live Floor Plan" />
        <EmptyState
          title="No tables to display"
          message="Your floor plan will appear here once your restaurant setup is complete."
        />
      </div>
    );
  }

  const errorMessage =
    typeof searchParams.message === "string" ? searchParams.message : null;
  if (error) {
    return (
      <div>
        <PageHeader title="Live Floor Plan" />
        <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
          <p className="text-base font-medium text-error">
            {errorMessage ?? "Something went wrong. Please try again."}
          </p>
          <Link
            href="/floor-plan?state=loading"
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
      <PageHeader title="Live Floor Plan" />

      <div className="grid grid-cols-12 gap-lg">
        <section className="col-span-8 rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
          <div className="mb-lg flex items-center justify-between gap-lg">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                Tables
              </p>
              <p className="mt-xs text-sm text-text-muted-on-dark">
                Tap a table to view arrival details.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-md">
              {(
                [
                  ["empty", "Empty"],
                  ["seated", "Seated"],
                  ["arriving", "Arriving"],
                  ["overdue", "Overdue"],
                  ["reserved", "Reserved"],
                ] as const
              ).map(([status, label]) => (
                <div
                  key={status}
                  className="flex items-center gap-sm rounded-md border border-border-card bg-surface-dark px-sm py-xs"
                >
                  <div
                    className={`h-2 w-2 rounded-full border ${
                      getTableStyles(status)
                    }`}
                    aria-hidden
                  />
                  <span className="text-xs text-text-muted-on-dark">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-6 gap-lg">
            {TABLES.map((t) => {
              const isSelected = selectedTableId === t.id;
              return (
                <Link
                  key={t.id}
                  href={`/floor-plan?table=${t.id}`}
                  className={`relative flex items-center justify-center rounded-lg border-2 p-md transition-transform duration-400 ease-out hover:scale-[1.02] ${
                    getTableStyles(t.status)
                  } ${isSelected ? "ring-1 ring-gold" : "ring-0"}`}
                  aria-pressed={isSelected}
                >
                  <div className="flex flex-col items-center gap-xs">
                    <span className="text-xs font-semibold text-text-on-dark">
                      T{t.id}
                    </span>
                    {t.label ? (
                      <span className="max-w-full truncate text-xs text-text-muted-on-dark">
                        {t.label}
                      </span>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <aside className="col-span-4">
          <div className="rounded-lg border border-border-card bg-surface-dark-elevated p-xl">
            <p className="mb-md text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
              Guest Arrival
            </p>

            {selectedGuest ? (
              <div className="flex flex-col gap-md">
                <div className="flex items-start justify-between gap-md">
                  <div>
                    <p className="text-lg font-semibold text-text-on-dark">
                      {selectedGuest.guestName}
                    </p>
                    <p className="mt-xs text-sm text-text-muted-on-dark">
                      Party of {selectedGuest.partySize} · {selectedGuest.tableLabel}
                    </p>
                  </div>
                  {selectedGuest.isVip ? (
                    <div className="rounded-full border border-gold px-sm py-xs">
                      <span className="text-xs font-medium uppercase tracking-widest text-gold">
                        VIP
                      </span>
                    </div>
                  ) : null}
                </div>

                {selectedGuest.allergies.length > 0 ? (
                  <div className="flex flex-col gap-xs">
                    {selectedGuest.allergies.map((a) => (
                      <div
                        key={a}
                        className="rounded-md border-l-4 border-error bg-error-muted px-md py-sm text-sm text-error"
                      >
                        {a} allergy
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-border-card bg-surface-dark p-md text-sm text-text-muted-on-dark">
                    No allergies flagged
                  </div>
                )}

                <div className="flex flex-col gap-xs rounded-md border border-border-card bg-surface-dark p-md">
                  <div className="text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
                    Preferences
                  </div>
                  <div className="text-sm text-text-muted-on-dark">
                    Seating: {selectedGuest.seatingPreference}
                  </div>
                  <div className="text-sm text-text-muted-on-dark">
                    Noise: {selectedGuest.noisePreference}
                  </div>
                  <div className="mt-sm text-sm text-text-muted-on-dark">
                    {selectedGuest.lastVisitLabel}
                  </div>
                </div>

                <div className="flex flex-col gap-md pt-md">
                  <button
                    type="button"
                    disabled
                    className="rounded-md bg-gold/10 px-lg py-md text-sm font-semibold text-text-on-gold opacity-70"
                  >
                    Seat now (coming soon)
                  </button>
                  <button
                    type="button"
                    disabled
                    className="rounded-md border border-gold px-lg py-md text-sm font-semibold text-gold opacity-70"
                  >
                    Add note (coming soon)
                  </button>
                </div>
              </div>
            ) : (
              <EmptyState
                title="Select a table"
                message="Choose a table on the floor plan to preview the arrival card."
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

